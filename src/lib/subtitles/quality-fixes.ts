import type { Subtitle, TimingRules } from "@/types/subtitle";
import { breakIntoLines } from "./linebreak.ts";
import { calculateCPS, minDurationForReadableCPS, FAST_READING_CPS } from "./reading-speed.ts";
import { segmentWords } from "./segment.ts";
import { analyzeSubtitleQuality, HARD_MIN_DURATION, HARD_MAX_DURATION, type QualityIssue } from "./quality-analyzer.ts";

// Mirrors quality-analyzer.ts's own LINE_BALANCE_RATIO — see that file's doc comment for why 0.35.
const LINE_BALANCE_RATIO = 0.35;

/**
 * Deterministic, safe-only auto-fix engine for the issues `quality-analyzer.ts` reports. See
 * research/p2_subtitle_quality_control_report.md §6 for the full policy this file implements —
 * in short: every fix here only ever adjusts a caption's OWN start/end/text/line-wrapping, or
 * removes a word/caption that is unambiguously empty/duplicated. Nothing here ever rewrites a
 * word's text, guesses a "correct" timestamp, or merges two captions together — those require
 * judgment this module deliberately never makes (see quality-analyzer.ts's WORD_TIMESTAMP_INVALID
 * "unsafe" case, and the complete absence of a merge-based fix anywhere in this file).
 *
 * Both exported functions are pure: they take a subtitles array and return a NEW one, never
 * mutating the input, so callers (the editor store) can drop the result straight into their own
 * undo/redo snapshot mechanism unchanged.
 */

// Matches the store's own MIN_CAPTION_DURATION_SEC (src/store/editor-store.ts) — kept as its own
// constant here because this module must stay a pure lib function with no dependency on the
// Zustand store (which has side effects on import). Change one, change both.
const MIN_CAPTION_DURATION_SEC = 0.1;

function reindex(subtitles: Subtitle[]): Subtitle[] {
  return subtitles.map((s, i) => (s.index === i ? s : { ...s, index: i }));
}

function rewrapLines(sub: Subtitle, rules: TimingRules): Subtitle {
  const text = sub.text.replace(/\n/g, " ").trim();
  const lines = breakIntoLines(text, rules.maxCharsPerLine, rules.maxLines);
  return { ...sub, text: lines.join("\n") };
}

/** Clamps a caption's desired `end` so it can never overlap the next caption and never collapses
 * below MIN_CAPTION_DURATION_SEC — the same guarantee editor-store.ts's updateSubtitleTiming
 * already gives interactive edits, applied here for auto-fixes too. */
function clampEnd(start: number, desiredEnd: number, nextStart: number): number {
  return Math.min(nextStart, Math.max(desiredEnd, start + MIN_CAPTION_DURATION_SEC));
}

/**
 * Applies exactly one issue's fix, if it is safe. Returns `null` if the issue's fixability is
 * "unsafe", or if the target caption can no longer be found (e.g. a stale issue after other
 * fixes already changed the array) — callers should treat `null` as "nothing to do", not an
 * error.
 */
export function applyQualityFix(subtitles: Subtitle[], issue: QualityIssue, rules: TimingRules): Subtitle[] | null {
  if (issue.fixability !== "safe") return null;
  const idx = subtitles.findIndex((s) => s.id === issue.captionId);
  if (idx === -1) return null;
  const sub = subtitles[idx];
  const next = subtitles[idx + 1];
  const nextStart = next ? next.start : Infinity;

  switch (issue.type) {
    case "EMPTY_CAPTION": {
      // Deleting an empty caption is unambiguous — there is no content to lose. This is
      // distinct from the explicitly-UNSAFE "delete a caption because it looks unnecessary":
      // that's a judgment call about a caption WITH content; this caption has none at all.
      return reindex([...subtitles.slice(0, idx), ...subtitles.slice(idx + 1)]);
    }

    case "INVALID_DURATION": {
      const start = Math.max(0, sub.start);
      const end = clampEnd(start, start + MIN_CAPTION_DURATION_SEC, nextStart);
      const next2 = [...subtitles];
      next2[idx] = { ...sub, start, end };
      return next2;
    }

    case "OVERLAP": {
      const end = clampEnd(sub.start, nextStart, nextStart);
      const next2 = [...subtitles];
      next2[idx] = { ...sub, end };
      return next2;
    }

    case "WORD_TIMESTAMP_INVALID": {
      // Only the exact-duplicate-word sub-case is ever marked "safe" by the analyzer — find and
      // remove the first exact duplicate (same text AND same start/end as its predecessor).
      const words = sub.words;
      const dupIndex = words.findIndex(
        (w, i) => i > 0 && w.text === words[i - 1].text && w.start === words[i - 1].start && w.end === words[i - 1].end,
      );
      if (dupIndex === -1) return null;
      const newWords = [...words.slice(0, dupIndex), ...words.slice(dupIndex + 1)];
      const text = breakIntoLines(newWords.map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
      const next2 = [...subtitles];
      next2[idx] = { ...sub, words: newWords, text };
      return next2;
    }

    case "TOO_MANY_WORDS": {
      // Re-segment just this caption's own words with the project's current rules — the same
      // deterministic function generation itself uses, applied to one caption's word array
      // instead of the whole transcript. Every word/timestamp is preserved exactly (segmentWords
      // never touches them); the caption-level style/animation is propagated to every resulting
      // piece (matching split.ts's own convention of propagating overrides to both halves), and
      // the first piece keeps the original id.
      const pieces = segmentWords(sub.words, rules);
      if (pieces.length <= 1) return null; // nothing to split further
      const withOverrides = pieces.map((p, i) => ({ ...p, id: i === 0 ? sub.id : p.id, style: sub.style, animation: sub.animation }));
      return reindex([...subtitles.slice(0, idx), ...withOverrides, ...subtitles.slice(idx + 1)]);
    }

    case "TOO_MANY_LINES":
    case "CHARACTER_LIMIT":
    case "AWKWARD_LINE_BREAK":
    case "ORPHAN_LINE": {
      const next2 = [...subtitles];
      next2[idx] = rewrapLines(sub, rules);
      return next2;
    }

    case "TOO_FAST": {
      const target = Math.min(rules.maxDuration, Math.max(rules.minDuration, minDurationForReadableCPS(sub.text)));
      const end = clampEnd(sub.start, sub.start + target, nextStart);
      if (end <= sub.end) return null; // no room to extend — nothing safe to do
      const next2 = [...subtitles];
      next2[idx] = { ...sub, end };
      return next2;
    }

    case "TOO_SHORT": {
      // Target whichever floor is stricter — the project's own configured minDuration, or the
      // analyzer's hard floor — so this fix always actually clears the issue it was raised for
      // (a caption could satisfy rules.minDuration while still tripping HARD_MIN_DURATION, e.g.
      // when a project's minDuration is configured below 0.4s).
      const target = Math.max(rules.minDuration, HARD_MIN_DURATION, MIN_CAPTION_DURATION_SEC);
      const end = clampEnd(sub.start, sub.start + target, nextStart);
      if (end <= sub.end) return null;
      const next2 = [...subtitles];
      next2[idx] = { ...sub, end };
      return next2;
    }

    case "TOO_LONG": {
      const cap = Math.min(rules.maxDuration, HARD_MAX_DURATION);
      const end = Math.max(sub.start + MIN_CAPTION_DURATION_SEC, sub.start + cap);
      if (end >= sub.end) return null;
      const next2 = [...subtitles];
      next2[idx] = { ...sub, end };
      return next2;
    }

    case "TOO_SLOW": {
      const comfortable = Math.max(rules.minDuration, minDurationForReadableCPS(sub.text));
      const end = sub.start + comfortable;
      if (end >= sub.end) return null;
      const next2 = [...subtitles];
      next2[idx] = { ...sub, end };
      return next2;
    }

    default:
      return null;
  }
}

export interface SafeFixSummary {
  subtitles: Subtitle[];
  fixedCount: number;
  remainingUnsafeCount: number;
}

/** Duplicate-word check shared by the single-caption fixer above and the batch sweep below —
 * kept as one function so the two can never disagree about what counts as a duplicate. */
function findDuplicateWordIndex(words: Subtitle["words"]): number {
  return words.findIndex((w, i) => i > 0 && w.text === words[i - 1].text && w.start === words[i - 1].start && w.end === words[i - 1].end);
}

/**
 * One left-to-right O(n) pass applying every currently-safe, locally-decidable fix to every
 * caption at once — the batch counterpart to applyQualityFix's one-issue-at-a-time API. Using
 * `subtitles[i+1].start` (rather than re-deriving it from a fixed-up next caption) as each
 * caption's overlap/extension boundary is safe: no fix in this file ever changes a caption's OWN
 * `start`, only its `end`, so the next caption's start is stable for the whole sweep regardless
 * of what happens to it later in the same pass.
 */
function sweepOnce(subtitles: Subtitle[], rules: TimingRules): { result: Subtitle[]; changed: number } {
  const out: Subtitle[] = [];
  let changed = 0;

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    const nextStart = i + 1 < subtitles.length ? subtitles[i + 1].start : Infinity;

    if (sub.end <= sub.start) {
      const start = Math.max(0, sub.start);
      const end = clampEnd(start, start + MIN_CAPTION_DURATION_SEC, nextStart);
      out.push({ ...sub, start, end });
      changed++;
      continue;
    }

    const text = sub.text.replace(/\n/g, " ").trim();
    if (!text.length || !sub.words?.length) {
      changed++;
      continue; // EMPTY_CAPTION: drop it, nothing to preserve.
    }

    let working = sub;

    const dupIndex = findDuplicateWordIndex(working.words);
    if (dupIndex !== -1) {
      const newWords = [...working.words.slice(0, dupIndex), ...working.words.slice(dupIndex + 1)];
      const newText = breakIntoLines(newWords.map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
      working = { ...working, words: newWords, text: newText };
      changed++;
    }

    if (working.words.length > rules.maxWordsPerCaption) {
      const pieces = segmentWords(working.words, rules);
      if (pieces.length > 1) {
        out.push(...pieces.map((p, pi) => ({ ...p, id: pi === 0 ? working.id : p.id, style: working.style, animation: working.animation })));
        changed++;
        continue; // this original caption is now N pieces; each gets its own line/timing pass next round
      }
    }

    const lines = working.text.split("\n");
    const longestLine = Math.max(...lines.map((l) => l.length));
    const needsRewrap =
      lines.length > rules.maxLines ||
      longestLine > rules.maxCharsPerLine ||
      (lines.length === 2 &&
        lines.every((l) => l.length <= rules.maxCharsPerLine) &&
        (() => {
          const [a, b] = lines.map((l) => l.length);
          const longer = Math.max(a, b);
          return longer > 0 && Math.min(a, b) / longer < LINE_BALANCE_RATIO;
        })());
    if (needsRewrap) {
      working = rewrapLines(working, rules);
      changed++;
    }

    // Timing: at most one of overlap-trim / too-short-extend / too-long-shrink / too-slow-shrink
    // can apply to a given caption (they're mutually exclusive by construction), evaluated in
    // that priority order — then too-fast is checked independently, against whichever end the
    // caption now has.
    const { start } = working;
    let { end } = working;
    const duration = end - start;
    if (end > nextStart + 0.001) {
      end = clampEnd(start, nextStart, nextStart);
      changed++;
    } else if (duration < HARD_MIN_DURATION || duration < rules.minDuration) {
      const target = Math.max(rules.minDuration, HARD_MIN_DURATION, MIN_CAPTION_DURATION_SEC);
      const extended = clampEnd(start, start + target, nextStart);
      if (extended > end) {
        end = extended;
        changed++;
      }
    } else if (duration > HARD_MAX_DURATION || duration > rules.maxDuration) {
      const cap = Math.min(rules.maxDuration, HARD_MAX_DURATION);
      const shrunk = Math.max(start + MIN_CAPTION_DURATION_SEC, start + cap);
      if (shrunk < end) {
        end = shrunk;
        changed++;
      }
    } else {
      const comfortable = Math.max(rules.minDuration, minDurationForReadableCPS(working.text));
      const slowThreshold = Math.max(rules.minDuration, comfortable * 3);
      if (duration > slowThreshold) {
        const shrunk = start + comfortable;
        if (shrunk < end) {
          end = shrunk;
          changed++;
        }
      }
    }
    if (calculateCPS(working.text, end - start) > FAST_READING_CPS) {
      const target = Math.min(rules.maxDuration, Math.max(rules.minDuration, minDurationForReadableCPS(working.text)));
      const extended = clampEnd(start, start + target, nextStart);
      if (extended > end) {
        end = extended;
        changed++;
      }
    }

    out.push(end === working.end ? working : { ...working, end });
  }

  return { result: reindex(out), changed };
}

/**
 * Applies every currently-safe issue across the whole project in a small, bounded number of
 * O(n) sweeps (see sweepOnce above) rather than one full re-analysis + lookup per individual
 * fix — at 5,400 captions the naive "re-analyze, find one issue, fix it, repeat" approach this
 * replaced took over 40 seconds; this is sub-second (see
 * research/p2_subtitle_quality_control_report.md §13). A fixed-point is normally reached in just
 * a few rounds (one fix can occasionally make a neighbor newly fixable, e.g. trimming an overlap
 * can reveal a too-short caption underneath — the next round catches it); MAX_ROUNDS is a
 * generous constant safety net, not something real projects should ever actually hit.
 */
export function applyAllSafeFixes(subtitles: Subtitle[], rules: TimingRules): SafeFixSummary {
  let current = subtitles;
  let fixedCount = 0;
  const MAX_ROUNDS = 25;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { result, changed } = sweepOnce(current, rules);
    current = result;
    fixedCount += changed;
    if (changed === 0) break;
  }

  const finalReport = analyzeSubtitleQuality(current, rules);
  const remaining = finalReport.issueCountsBySeverity.error + finalReport.issueCountsBySeverity.warning + finalReport.issueCountsBySeverity.info - finalReport.safeFixCount;
  return { subtitles: current, fixedCount, remainingUnsafeCount: remaining };
}
