import { nanoid } from "nanoid";
import type { Subtitle, TimingRules, Word } from "@/types/subtitle";
import type { TranscriptSegment } from "@/lib/transcription/types";
import { breakIntoLines } from "./linebreak.ts";
import { minDurationForReadableCPS } from "./reading-speed.ts";

// U+0964 DANDA and U+0965 DOUBLE DANDA are the Hindi/Sanskrit (Devanagari) sentence-terminal
// marks — the direct equivalent of "." for languages Whisper transcribes in Devanagari script.
// Without them, sentence-boundary preference silently never fires for Hindi audio (confirmed:
// a full Hindi transcript with several danda-terminated sentences segmented as one run-on
// caption capped only by maxWordsPerCaption). lib/subtitles/hinglish.ts already treats these
// the same way for its own (unrelated) Devanagari->Latin conversion — see its DANDA/DOUBLE_DANDA
// constants — this is the same real-world punctuation, just consumed here instead.
const SENTENCE_END = /[.!?…।॥]["')\]]?$/;
const CLAUSE_END = /[,;:—-]$/;

/**
 * Groups word-level timestamps into subtitle segments.
 *
 * Rules applied in order of priority:
 * 1. Never split a word.
 * 2. maxWordsPerCaption is a HARD ceiling — a caption never grows past it, no matter what
 *    (see spec: "Maximum words is a hard upper bound"). Below that ceiling, prefer breaking
 *    at an explicit transcript-segment boundary (if `segments` is given), then sentence end,
 *    then clause punctuation, then a natural pause (gap between word end / next word start)
 *    — but only once smartSegmentation is on; see below.
 * 3. Respect maxCharsPerLine * maxLines as the hard character ceiling per segment.
 * 4. Respect min/max subtitle duration, merging tiny trailing segments forward and forcing
 *    a break once maxDuration is exceeded.
 *
 * When `rules.smartSegmentation` is false, only the hard ceilings (words/chars/duration) and
 * explicit transcript-segment boundaries are used — sentence/clause/pause-based early breaks
 * are skipped, giving the "more basic" behavior the settings UI describes, while still never
 * exceeding maxWordsPerCaption.
 */
export function segmentWords(words: Word[], rules: TimingRules, segments?: TranscriptSegment[]): Subtitle[] {
  const active = words.filter((w) => !w.removed);
  if (active.length === 0) return [];

  const maxChars = rules.maxCharsPerLine * rules.maxLines;
  const maxWords = Math.max(1, rules.maxWordsPerCaption);
  const segmentIndexForTime = buildSegmentLookup(segments);

  const segs: Word[][] = [];
  // Parallel to `segs`: whether that segment ended AT an explicit transcript-segment
  // boundary (a real sentence/paragraph break the transcription provider supplied), as
  // opposed to a hard cap or a heuristic guess — see the merge-back pass below, which must
  // not silently undo one of these except for a genuinely tiny leftover fragment.
  const endedAtExplicitBoundary: boolean[] = [];
  let current: Word[] = [];

  const currentText = () => current.map((w) => w.text).join(" ");
  const currentDuration = () => (current.length ? current[current.length - 1].end - current[0].start : 0);

  for (let i = 0; i < active.length; i++) {
    const word = active[i];
    const next = active[i + 1];

    // Hard character ceiling: if adding this word would push the segment over maxChars,
    // close the segment BEFORE adding it — deferring the word to the next segment — instead
    // of after. Checking only after adding (the original approach) let a segment overshoot
    // the "hard ceiling" the function's own contract promises by up to one word's length,
    // since a word can never be split to make it fit. A single word that alone already
    // exceeds maxChars is still unavoidable (nothing to defer it to) and is left as its own
    // one-word segment below via the atMaxChars re-check after pushing.
    if (current.length > 0 && currentText().length + 1 + word.text.length > maxChars) {
      segs.push(current);
      endedAtExplicitBoundary.push(false);
      current = [];
    }

    current.push(word);

    const atMaxChars = currentText().length >= maxChars;
    const atMaxDuration = currentDuration() >= rules.maxDuration;
    const atMaxWords = current.length >= maxWords;
    const isLast = !next;

    let shouldBreak = isLast || atMaxChars || atMaxDuration || atMaxWords;

    // An explicit boundary between two transcript segments (sentence/paragraph break
    // supplied by the transcription provider itself, not inferred from timing) is a strong,
    // data-driven signal — respected even with Smart Segmentation off, since it's not a
    // heuristic guess. Computed regardless of whether shouldBreak is already true, so it's
    // still recorded (and protected from merge-back below) even when it coincides with a
    // hard cap.
    let explicitBoundary = false;
    if (next && segmentIndexForTime) {
      const wordSeg = segmentIndexForTime(word.start);
      const nextSeg = segmentIndexForTime(next.start);
      if (wordSeg !== null && nextSeg !== null && wordSeg !== nextSeg) {
        explicitBoundary = true;
        shouldBreak = true;
      }
    }

    if (!shouldBreak && rules.smartSegmentation && next && currentDuration() >= rules.minDuration) {
      const gap = next.start - word.end;
      const endsSentence = SENTENCE_END.test(word.text);
      const endsClause = CLAUSE_END.test(word.text);
      const longPause = gap >= 0.45;

      if (endsSentence || (endsClause && gap > 0.12) || longPause) {
        shouldBreak = true;
      }
    }

    if (shouldBreak) {
      segs.push(current);
      endedAtExplicitBoundary.push(explicitBoundary);
      current = [];
    }
  }
  if (current.length) {
    segs.push(current);
    endedAtExplicitBoundary.push(false);
  }

  // Merge segments that are too short in duration, or a stray single word, into the
  // previous one — a lone trailing word (e.g. slow speech with a long pause before the last
  // word) reads as an awkward single-word flash rather than a natural break, so fold it back
  // as long as the character ceiling, the word-count ceiling, and max duration are still
  // respected. Exception: never fold a MULTI-word segment backward across an explicit
  // transcript-segment boundary — that would silently undo a real sentence/paragraph break
  // the provider gave us. A genuinely tiny (single-word) leftover fragment can still merge
  // across it, per the spec's own "unless merging is necessary for a very short fragment".
  const merged: Word[][] = [];
  const mergedEndedAtExplicitBoundary: boolean[] = [];
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    const prev = merged[merged.length - 1];
    const prevWasExplicitBoundary = mergedEndedAtExplicitBoundary[mergedEndedAtExplicitBoundary.length - 1];
    const segDuration = seg[seg.length - 1].end - seg[0].start;
    const segText = seg.map((w) => w.text).join(" ");
    const fitsCharCap = !!prev && prev.map((w) => w.text).join(" ").length + 1 + segText.length <= maxChars;
    const fitsWordCap = !!prev && prev.length + seg.length <= maxWords;
    const crossesProtectedBoundary = !!prevWasExplicitBoundary && seg.length > 1;
    const combinedDuration = prev ? seg[seg.length - 1].end - prev[0].start : segDuration;
    const shouldMergeBack =
      fitsCharCap &&
      fitsWordCap &&
      !crossesProtectedBoundary &&
      (segDuration < rules.minDuration || (seg.length === 1 && combinedDuration <= rules.maxDuration));
    if (prev && shouldMergeBack) {
      merged[merged.length - 1] = [...prev, ...seg];
      mergedEndedAtExplicitBoundary[mergedEndedAtExplicitBoundary.length - 1] = endedAtExplicitBoundary[s];
    } else {
      merged.push(seg);
      mergedEndedAtExplicitBoundary.push(endedAtExplicitBoundary[s]);
    }
  }

  // Orphan-word readability (a stray single word, especially as the very first caption, where
  // the backward merge-back pass above has no predecessor to fold it into): deliberately
  // handled by extending its DURATION below rather than merging it into a neighbor. An
  // earlier version of this function also tried a symmetric forward-merge for just the first
  // segment, but that turned out to only ever be reachable when the orphan was itself created
  // by an explicit transcript-segment boundary — exactly the boundary this function must NOT
  // silently undo (see the backward pass's own crossesProtectedBoundary guard above) — so a
  // forward-merge would have had no safe case left to actually apply to. Holding the lone word
  // on screen long enough to read comfortably (below) fixes the actual symptom (an unreadable
  // flash) without ever combining words the transcript didn't put together.

  return merged.map((seg, index) => {
    const text = seg.map((w) => w.text).join(" ");
    const lines = breakIntoLines(text, rules.maxCharsPerLine, rules.maxLines);
    const start = seg[0].start;
    const rawEnd = seg[seg.length - 1].end;
    // Readability duration floor: hold a too-short or too-fast-reading caption on screen a
    // little longer than its last word's own timestamp, rather than letting it flash by —
    // the same convention real subtitle tools use (the shown end time is allowed to run past
    // the last spoken word). Never shrinks (extension only), never exceeds this caption's own
    // maxDuration ceiling, and never overlaps the next caption's own (unextended) start.
    const nextStart = merged[index + 1]?.[0]?.start ?? Infinity;
    const target = Math.min(rules.maxDuration, Math.max(rules.minDuration, minDurationForReadableCPS(text)));
    const end = Math.min(Math.max(rawEnd, start + target), nextStart);
    return {
      id: nanoid(10),
      index,
      start,
      end,
      text: lines.join("\n"),
      words: seg,
    } satisfies Subtitle;
  });
}

/** Builds a fast "which transcript segment is this timestamp in" lookup, or returns
 * undefined if there are fewer than 2 segments (nothing meaningful to bound on).
 *
 * The returned function assumes it is only ever called with non-decreasing `time` values (true
 * of its one caller, segmentWords' forward pass over words in time order) and keeps a pointer
 * that only ever advances — once a segment's end has passed it can never match a later, equal-
 * or-greater query, so it's safe to skip permanently. This turns what was an O(words × segments)
 * linear rescan per call (restarting from segments[0] every time) into O(words + segments)
 * overall — matters once a long video has hundreds of transcript segments. */
function buildSegmentLookup(segments: TranscriptSegment[] | undefined): ((time: number) => number | null) | undefined {
  if (!segments || segments.length < 2) return undefined;
  let i = 0;
  return (time: number) => {
    // Half-open [start, end) so two adjacent segments sharing a boundary timestamp
    // (segment N's end === segment N+1's start, common in real transcripts) don't both
    // claim it — a word starting exactly on that boundary belongs to the later segment.
    // The very last segment is closed on the right so its own end timestamp still counts.
    while (i < segments.length - 1 && time >= segments[i].end) i++;
    const isLastSegment = i === segments.length - 1;
    if (time >= segments[i].start && (time < segments[i].end || isLastSegment)) return i;
    return null;
  };
}

/** Re-runs segmentation for a single subtitle's own words (used after inline text edits keep same words). */
export function resegmentOne(words: Word[], rules: TimingRules): string {
  const text = words.map((w) => w.text).join(" ");
  return breakIntoLines(text, rules.maxCharsPerLine, rules.maxLines).join("\n");
}
