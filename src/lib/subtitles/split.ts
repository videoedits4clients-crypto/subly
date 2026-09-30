import { nanoid } from "nanoid";
import type { Subtitle, TimingRules, Word } from "@/types/subtitle";
import { breakIntoLines } from "./linebreak.ts";

/**
 * Task 114761 (P18.7) — "Split Here": splits one caption into two AT A TIME, not a word index.
 *
 * CRITICAL FIX over the pre-P18.7 implementation: the old `splitSubtitleAt(original, wordIndex,
 * rules)` partitioned by ARRAY POSITION (`words.slice(0, wordIndex)` / `words.slice(wordIndex)`)
 * and derived each half's own `start`/`end` from `words[0].start`/`words[words.length-1].end` —
 * both of which silently assume `words[0]` is the EARLIEST word and the last array element is
 * the LATEST. Task 113528 (P18.6) made that assumption false: word arrays can now be
 * non-monotonic (array/textual order deliberately independent of chronological order). Fed a
 * non-monotonic caption, the old code could produce a "right" half whose derived `end` (its last
 * ARRAY word's end) was actually EARLIER than its derived `start` (its first ARRAY word's start)
 * — an inverted, negative-duration caption. Confirmed by direct analysis before writing this fix,
 * not assumed.
 *
 * NEW semantics (this task's own preferred model): a split at time `splitAtTime` produces
 *   LEFT:  start = original.start, end = splitAtTime
 *   RIGHT: start = splitAtTime,    end = original.end
 * independent of word array order entirely — caption boundaries come from the split point and
 * the original caption's own bounds, never from whichever word happens to sit at an array edge.
 * Every word is assigned by its OWN `[start, end)` interval relative to `splitAtTime`:
 *   - entirely before splitAtTime (`w.end <= splitAtTime`)      -> LEFT
 *   - entirely at/after splitAtTime (`w.start >= splitAtTime`)  -> RIGHT
 *   - straddles splitAtTime (`w.start < splitAtTime < w.end`)   -> REJECT the whole split
 * A word is never silently cut, duplicated, or dropped, and — per this task's own "prefer
 * rejection of ambiguous operations over silent destructive behavior" — a straddling word makes
 * the WHOLE operation fail rather than guessing which side it "should" go to. Each side keeps its
 * own words in their EXISTING relative array order (P18.6's textual ordering is preserved, never
 * re-sorted chronologically — this function has no reason to touch order at all, only to
 * partition by a pure per-word interval test).
 *
 * The old word-index-based API's "playhead lands inside a word -> snap to the nearer boundary"
 * behavior (`computeSplitWordIndex`) is deliberately REMOVED, not preserved: silently moving the
 * split point to "whichever side is closer" was itself a form of guessing what the user meant,
 * which this task's own spec asks to replace with an explicit rejection instead. Confirmed this
 * function has exactly one caller (editor-store.ts's `splitSubtitleAtTime`, itself only reachable
 * from the Timeline's "Split Here" button and the Ctrl/Cmd+Shift+S shortcut), so this is a
 * contained, deliberate API change, not a compatibility break for any other caller.
 */

export type SplitSubtitleRejectionReason = "invalid-time" | "word-straddles-split" | "empty-side";

export interface SplitSubtitleSuccess {
  ok: true;
  left: Subtitle;
  right: Subtitle;
}
export interface SplitSubtitleFailure {
  ok: false;
  reason: SplitSubtitleRejectionReason;
  /** Only set for "word-straddles-split" — the word whose span crosses the requested split
   * point, so the caller can name it in the rejection message. */
  straddlingWord?: Word;
}
export type SplitSubtitleResult = SplitSubtitleSuccess | SplitSubtitleFailure;

/**
 * Splits `original` into two captions at `splitAtTime`. Returns a rejection (no partial
 * mutation — `original` itself is never touched) for:
 *   - a non-finite split time, or one outside `(original.start, original.end)` — a split
 *     exactly ON either boundary would leave one side with zero duration, so both endpoints are
 *     excluded, not just checked for being "outside the range";
 *   - a word whose own span strictly straddles `splitAtTime` ("word-straddles-split");
 *   - a split that would leave either side with zero words ("empty-side") — every word landed
 *     entirely on one side (e.g. `splitAtTime` falls in the caption's own leading/trailing
 *     silence, past every word on one side).
 */
export function splitSubtitleAt(original: Subtitle, splitAtTime: number, rules: TimingRules): SplitSubtitleResult {
  if (!Number.isFinite(splitAtTime) || splitAtTime <= original.start || splitAtTime >= original.end) {
    return { ok: false, reason: "invalid-time" };
  }

  const leftWords: Word[] = [];
  const rightWords: Word[] = [];
  for (const w of original.words) {
    if (w.end <= splitAtTime) {
      leftWords.push(w);
    } else if (w.start >= splitAtTime) {
      rightWords.push(w);
    } else {
      return { ok: false, reason: "word-straddles-split", straddlingWord: w };
    }
  }
  if (leftWords.length === 0 || rightWords.length === 0) {
    return { ok: false, reason: "empty-side" };
  }

  const left: Subtitle = {
    id: original.id,
    index: original.index,
    start: original.start,
    end: splitAtTime,
    text: breakIntoLines(leftWords.map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n"),
    words: leftWords,
    style: original.style,
    animation: original.animation,
  };
  const right: Subtitle = {
    id: nanoid(10),
    index: original.index + 1,
    start: splitAtTime,
    end: original.end,
    text: breakIntoLines(rightWords.map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n"),
    words: rightWords,
    style: original.style,
    animation: original.animation,
  };

  return { ok: true, left, right };
}
