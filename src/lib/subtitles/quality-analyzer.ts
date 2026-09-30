import type { Subtitle, TimingRules } from "@/types/subtitle";
import { calculateCPS, minDurationForReadableCPS, FAST_READING_CPS } from "./reading-speed.ts";
import { formatTime } from "../utils.ts";
import { normalizeSpaces, normalizeLineBreakWhitespace, normalizeRepeatedPunctuation, classifyCaptionContent } from "./text-cleanup.ts";

/**
 * Deterministic subtitle quality analysis — inspects an already-generated (and possibly
 * hand-edited) project's captions and reports concrete, measurable problems. No LLM, no
 * network call: every check here is arithmetic over `start`/`end`/`text`/`words`, the same kind
 * of check `quality-validator.ts` already does internally-only — this module supersedes that
 * role with a richer, UI-facing shape (see quality-validator.ts's own updated doc comment) while
 * reusing its shared building block (CPS, from reading-speed.ts) rather than recomputing it.
 *
 * Every issue type here is something segmentation (lib/subtitles/segment.ts) already actively
 * tries to prevent at GENERATION time — this analyzer exists because a project is not static
 * after generation: manual text edits, timing drags, reduced settings, or legacy/imported data
 * can all reintroduce exactly these problems after the fact. See
 * research/p2_subtitle_quality_control_report.md §3 for which checks are "generation already
 * prevents this, but editing can reintroduce it" vs genuinely new coverage.
 */

export type QualityIssueType =
  | "INVALID_DURATION"
  | "OVERLAP"
  | "WORD_TIMESTAMP_INVALID"
  | "EMPTY_CAPTION"
  | "TOO_MANY_WORDS"
  | "TOO_MANY_LINES"
  | "CHARACTER_LIMIT"
  | "AWKWARD_LINE_BREAK"
  | "ORPHAN_LINE"
  | "TOO_FAST"
  | "TOO_SLOW"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "WHITESPACE_ISSUE"
  | "REPEATED_PUNCTUATION"
  | "SUSPICIOUS_SHORT_TEXT";

/**
 * Task 98134 (P11) — coarse grouping for the compact "12 issues · 4 errors · ... · Timing 2 ·
 * Text 7 · Style 3" content-QA summary (quality-panel-dialog.tsx). Purely a display grouping —
 * never used by analysis itself — so adding/re-grouping a type here can never change WHICH
 * issues are reported, only how the summary counts them. */
export type QualityCategory = "Timing" | "Text" | "Style";
export const QUALITY_CATEGORY_BY_TYPE: Record<QualityIssueType, QualityCategory> = {
  INVALID_DURATION: "Timing",
  OVERLAP: "Timing",
  WORD_TIMESTAMP_INVALID: "Timing",
  TOO_FAST: "Timing",
  TOO_SLOW: "Timing",
  TOO_SHORT: "Timing",
  TOO_LONG: "Timing",
  EMPTY_CAPTION: "Text",
  WHITESPACE_ISSUE: "Text",
  REPEATED_PUNCTUATION: "Text",
  SUSPICIOUS_SHORT_TEXT: "Text",
  TOO_MANY_WORDS: "Text",
  TOO_MANY_LINES: "Style",
  CHARACTER_LIMIT: "Style",
  AWKWARD_LINE_BREAK: "Style",
  ORPHAN_LINE: "Style",
};

/**
 * - "error": objectively invalid/corrupted data — true regardless of any style/rule preference
 *   (a negative duration, an overlap, a malformed word timestamp, a caption with no content).
 *   These are bugs in the data, not readability opinions.
 * - "warning": a measurable readability/formatting shortfall against the PROJECT'S OWN configured
 *   rules (too many words/lines, over the character ceiling, faster/shorter/longer than the
 *   project's own thresholds). Objective given the rules, but not "corrupted" — the data is
 *   structurally valid, just outside the configured comfort zone.
 * - "info": a genuinely subjective suggestion, never presented as a problem. Only TOO_SLOW is
 *   info-level in this analyzer — "this caption could be shown for less time" is a stylistic
 *   pacing call some editors will actively disagree with, unlike every other check here.
 */
export type QualitySeverity = "error" | "warning" | "info";

/**
 * - "safe": can be corrected deterministically with zero risk to transcript meaning — see
 *   research/p2_subtitle_quality_control_report.md §6 for the full safe-fix policy and why each
 *   type below is/isn't safe.
 * - "unsafe": a real problem, but correcting it would require guessing intent (what the "right"
 *   timestamp or wording should be) — reported so the editor can decide, never auto-applied.
 */
export type QualityFixability = "safe" | "unsafe";

export interface QualityIssue {
  /** Stable within one analysis run: `${captionId}:${type}` — a caption can carry at most one
   * issue of a given type, so this is enough to key/navigate by in the UI. */
  id: string;
  captionId: string;
  captionIndex: number;
  type: QualityIssueType;
  severity: QualitySeverity;
  message: string;
  /** The measured value that triggered this issue, when there is one number that best
   * represents it (a CPS reading, a duration in seconds, a word/line count). */
  value?: number;
  /** The configured or hard-coded threshold `value` was compared against. */
  threshold?: number;
  fixability: QualityFixability;
  /** Task 99261 (P12) — index into the caption's own `words` array, set only for the one issue
   * type that genuinely targets a specific word (`WORD_TIMESTAMP_INVALID`) rather than the whole
   * caption. `undefined` for every other type — review navigation (editor-store.ts's
   * `goToQualityIssue`) uses this to select the exact word (and show its existing word-level
   * highlight/timing UI) for a word-level issue, and to explicitly clear word selection
   * otherwise, rather than ever inventing a fake word focus for a caption-level issue. */
  wordIndex?: number;
}

export interface QualityReport {
  totalCaptions: number;
  captionsWithIssues: number;
  issueCountsByType: Partial<Record<QualityIssueType, number>>;
  issueCountsBySeverity: Record<QualitySeverity, number>;
  safeFixCount: number;
  issues: QualityIssue[];
}

// Hard floors/ceilings applied regardless of the project's configured TimingRules — mirrors
// quality-validator.ts's own (unchanged) HARD_MIN_DURATION/HARD_MAX_DURATION reasoning: below/
// above these, no reasonable rule set would call the caption valid, so a bad `rules` value can't
// mask real corruption. Exported so quality-fixes.ts's auto-fix targets agree with what this
// analyzer actually checks for — a fix that only satisfied `rules.minDuration` while ignoring
// this hard floor could "fix" a caption straight into still being flagged.
export const HARD_MIN_DURATION = 0.4;
export const HARD_MAX_DURATION = 8;
const WORD_BOUNDARY_SLACK = 0.05; // seconds of float/rounding slack, matches quality-validator.ts

/** A caption reads "unnecessarily slowly" only when it sits at multiple times the duration
 * actually needed for comfortable reading AND still exceeds the project's own configured
 * minimum — so shortening it never fights the minDuration setting. 3x is deliberately generous
 * (a merely "a bit longer than needed" caption should NOT be flagged — see the severity model:
 * TOO_SLOW is the one "info" case here precisely because it's the closest thing to a stylistic
 * judgment, so the threshold is set conservatively wide to avoid false positives). */
const SLOW_MULTIPLIER = 3;

/** A two-line caption is "awkward" when one line is dramatically shorter than the other despite
 * linebreak.ts's own balance() already trying to avoid exactly that — reachable only via a
 * manual edit (a pasted `\n`, or hand-typed line break) since normal generation already produces
 * balanced lines (confirmed in the prior segmentation-quality phase). 0.35 means the shorter
 * line is under 35% of the longer one's length — a level of imbalance the balancer itself would
 * never produce on its own. */
const LINE_BALANCE_RATIO = 0.35;

function flatText(text: string): string {
  return text.replace(/\n/g, " ").trim();
}

export function analyzeSubtitleQuality(subtitles: Subtitle[], rules: TimingRules): QualityReport {
  const issues: QualityIssue[] = [];
  const push = (
    sub: Subtitle,
    type: QualityIssueType,
    severity: QualitySeverity,
    message: string,
    fixability: QualityFixability,
    value?: number,
    threshold?: number,
    wordIndex?: number,
  ) => {
    issues.push({ id: `${sub.id}:${type}`, captionId: sub.id, captionIndex: sub.index, type, severity, message, value, threshold, fixability, wordIndex });
  };

  for (let i = 0; i < subtitles.length; i++) {
    const s = subtitles[i];
    const duration = s.end - s.start;
    const text = flatText(s.text);

    // --- Structural correctness (severity: error) ---

    if (duration <= 0) {
      push(s, "INVALID_DURATION", "error", `end (${s.end}s) is not after start (${s.start}s)`, "safe", duration, 0);
      // A caption with no valid time range can't be meaningfully checked for anything else
      // (CPS, word bounds, etc. would all divide by an invalid duration) — skip further checks
      // for this caption, matching quality-validator.ts's own early `continue`.
      continue;
    }

    const next = subtitles[i + 1];
    if (next && s.end > next.start + 0.001) {
      push(
        s,
        "OVERLAP",
        "error",
        `overlaps the next caption by ${(s.end - next.start).toFixed(2)}s — this caption ${formatTime(s.start)} → ${formatTime(s.end)}, next caption ${formatTime(next.start)} → ${formatTime(next.end)}`,
        "safe",
        s.end - next.start,
        0,
      );
    }

    if (!text.length || !s.words?.length) {
      push(s, "EMPTY_CAPTION", "error", "caption has no usable text or words", "safe");
      continue; // nothing else to check on a caption with no content
    }

    // --- Text-content shortfalls (Task 98134, P11) — reported only, never auto-fixed here (see
    // this file's own doc comment and quality-fixes.ts, which has no case for any of these three
    // types): the fix is the batch Text Cleanup workflow (lib/subtitles/text-cleanup.ts), which
    // these checks deliberately reuse rather than redefine what "needs cleanup" means. ---

    const whitespaceCleaned = normalizeLineBreakWhitespace(normalizeSpaces(s.text)).trim();
    if (whitespaceCleaned !== s.text) {
      push(s, "WHITESPACE_ISSUE", "warning", "leading/trailing or repeated whitespace can be cleaned up (Text Cleanup)", "unsafe");
    }

    if (normalizeRepeatedPunctuation(s.text) !== s.text) {
      push(s, "REPEATED_PUNCTUATION", "warning", 'repeated punctuation (e.g. "!!", "????", "......") can be normalized (Text Cleanup)', "unsafe");
    }

    const contentClass = classifyCaptionContent(s.text);
    if (contentClass === "punctuation-only") {
      push(s, "SUSPICIOUS_SHORT_TEXT", "warning", "caption contains only punctuation, no actual words", "unsafe");
    } else if (contentClass === "suspicious-short") {
      push(s, "SUSPICIOUS_SHORT_TEXT", "warning", "caption is a single character — verify this is intentional", "unsafe");
    } else if (contentClass === "short-intentional") {
      push(s, "SUSPICIOUS_SHORT_TEXT", "info", "caption is very short — likely an intentional short utterance (e.g. \"OK\", \"No\")", "unsafe");
    }

    let invalidWord: { text: string; start: number; end: number; reason: string; index: number } | null = null;
    for (let w = 0; w < s.words.length; w++) {
      const word = s.words[w];
      if (word.end < word.start) {
        invalidWord = { text: word.text, start: word.start, end: word.end, reason: "ends before it starts", index: w };
        break;
      }
      if (word.start < s.start - WORD_BOUNDARY_SLACK || word.end > s.end + WORD_BOUNDARY_SLACK) {
        invalidWord = { text: word.text, start: word.start, end: word.end, reason: `falls outside the caption's own bounds (${formatTime(s.start)} → ${formatTime(s.end)})`, index: w };
        break;
      }
      const prevWord = s.words[w - 1];
      if (prevWord && (word.text === prevWord.text && word.start === prevWord.start && word.end === prevWord.end)) {
        // An exact duplicate (same text AND same timestamps) is unambiguous data corruption —
        // not "the same word spoken twice" (which would have distinct timestamps) — so this is
        // the one WORD_TIMESTAMP_INVALID sub-case marked safe to auto-fix (dedupe). Points
        // review navigation (Task 99261, P12) at the duplicate itself (`w`), not the original.
        push(s, "WORD_TIMESTAMP_INVALID", "error", `word "${word.text}" (${formatTime(word.start)} → ${formatTime(word.end)}) is an exact duplicate of the previous word (identical text and timestamps)`, "safe", undefined, undefined, w);
        invalidWord = null; // don't also flag it as the generic unsafe case below
      }
    }
    if (invalidWord) {
      push(
        s,
        "WORD_TIMESTAMP_INVALID",
        "error",
        `word "${invalidWord.text}" (${formatTime(invalidWord.start)} → ${formatTime(invalidWord.end)}) ${invalidWord.reason}`,
        "unsafe",
        undefined,
        undefined,
        invalidWord.index,
      );
    }

    // --- Configured-rule shortfalls (severity: warning) ---

    const wordCount = s.words.length;
    if (wordCount > rules.maxWordsPerCaption) {
      push(s, "TOO_MANY_WORDS", "warning", `${wordCount} words exceeds the configured maximum (${rules.maxWordsPerCaption})`, "safe", wordCount, rules.maxWordsPerCaption);
    }

    const lines = s.text.split("\n");
    if (lines.length > rules.maxLines) {
      push(s, "TOO_MANY_LINES", "warning", `${lines.length} lines exceeds the configured maximum (${rules.maxLines})`, "safe", lines.length, rules.maxLines);
    }
    const longestLine = Math.max(...lines.map((l) => l.length));
    if (longestLine > rules.maxCharsPerLine) {
      push(s, "CHARACTER_LIMIT", "warning", `longest line has ${longestLine} characters (max ${rules.maxCharsPerLine})`, "safe", longestLine, rules.maxCharsPerLine);
    } else if (lines.length === 2 && lines.every((l) => l.length <= rules.maxCharsPerLine)) {
      // Only meaningful to judge line BALANCE once both lines already fit the char cap on
      // their own — otherwise CHARACTER_LIMIT above is the real problem to report instead.
      const [a, b] = lines.map((l) => l.length);
      const shorter = Math.min(a, b);
      const longer = Math.max(a, b);
      if (longer > 0 && shorter / longer < LINE_BALANCE_RATIO) {
        const shortLineWordCount = (a < b ? lines[0] : lines[1]).trim().split(/\s+/).filter(Boolean).length;
        if (shortLineWordCount === 1) {
          push(s, "ORPHAN_LINE", "warning", `one line is a single isolated word ("${(a < b ? lines[0] : lines[1]).trim()}") next to a much longer line`, "safe", shorter, longer);
        } else {
          push(s, "AWKWARD_LINE_BREAK", "warning", `line lengths are very imbalanced (${a} vs ${b} characters)`, "safe", shorter, longer);
        }
      }
    }

    const cps = calculateCPS(s.text, duration);
    if (cps > FAST_READING_CPS) {
      push(s, "TOO_FAST", "warning", `~${cps.toFixed(1)} chars/sec exceeds the comfortable reading speed (${FAST_READING_CPS})`, "safe", cps, FAST_READING_CPS);
    }

    if (duration < HARD_MIN_DURATION) {
      push(s, "TOO_SHORT", "error", `${duration.toFixed(2)}s is below any readable floor (${HARD_MIN_DURATION}s)`, "safe", duration, HARD_MIN_DURATION);
    } else if (duration < rules.minDuration) {
      push(s, "TOO_SHORT", "warning", `${duration.toFixed(2)}s is below the configured minimum (${rules.minDuration}s)`, "safe", duration, rules.minDuration);
    }

    if (duration > HARD_MAX_DURATION) {
      push(s, "TOO_LONG", "error", `${duration.toFixed(2)}s far exceeds a readable single caption (${HARD_MAX_DURATION}s)`, "safe", duration, HARD_MAX_DURATION);
    } else if (duration > rules.maxDuration) {
      push(s, "TOO_LONG", "warning", `${duration.toFixed(2)}s exceeds the configured maximum (${rules.maxDuration}s)`, "safe", duration, rules.maxDuration);
    } else {
      // Only worth judging "unnecessarily slow" once TOO_LONG hasn't already flagged this
      // caption — a caption that's already over maxDuration has a real problem to fix first.
      const comfortable = minDurationForReadableCPS(s.text);
      const slowThreshold = Math.max(rules.minDuration, comfortable * SLOW_MULTIPLIER);
      if (duration > slowThreshold) {
        push(s, "TOO_SLOW", "info", `shown for ${duration.toFixed(2)}s while ~${comfortable.toFixed(2)}s is enough to read comfortably`, "safe", duration, slowThreshold);
      }
    }
  }

  const issueCountsByType: Partial<Record<QualityIssueType, number>> = {};
  const issueCountsBySeverity: Record<QualitySeverity, number> = { error: 0, warning: 0, info: 0 };
  const captionsWithIssues = new Set<string>();
  let safeFixCount = 0;
  for (const issue of issues) {
    issueCountsByType[issue.type] = (issueCountsByType[issue.type] ?? 0) + 1;
    issueCountsBySeverity[issue.severity]++;
    captionsWithIssues.add(issue.captionId);
    if (issue.fixability === "safe") safeFixCount++;
  }

  return {
    totalCaptions: subtitles.length,
    captionsWithIssues: captionsWithIssues.size,
    issueCountsByType,
    issueCountsBySeverity,
    safeFixCount,
    issues,
  };
}

/**
 * Coarse, derived project-level quality state — never persisted (see
 * research/p2_subtitle_review_publish_readiness_report.md §6): it's a pure function of a
 * `QualityReport` the caller already has in hand (or `null` if analysis hasn't run yet this
 * session), recomputed on demand rather than stored as its own field anywhere.
 *
 * - `NOT_ANALYZED`: no report yet (or the project changed since the last one — see
 *   `isQualityReportStale`, a separate, deliberate concern from this function).
 * - `CLEAN`: analysis ran and found zero issues.
 * - `MANUAL_REVIEW_REQUIRED`: issues remain and NONE of them are safely auto-fixable — running
 *   "Fix all safe issues" again would do nothing further.
 * - `ISSUES_FOUND`: issues remain and at least one is still safely auto-fixable.
 */
export type QualityState = "NOT_ANALYZED" | "CLEAN" | "ISSUES_FOUND" | "MANUAL_REVIEW_REQUIRED";

export function deriveQualityState(report: QualityReport | null): QualityState {
  if (!report) return "NOT_ANALYZED";
  if (report.issues.length === 0) return "CLEAN";
  if (report.safeFixCount === 0) return "MANUAL_REVIEW_REQUIRED";
  return "ISSUES_FOUND";
}

/**
 * A quality report is stale once the project data it was computed from is no longer the
 * project's current data. Deliberately reference-based, not a deep comparison or a persisted
 * "revision" counter: `editor-store.ts`'s `commit()`/`undo()`/`redo()` already replace
 * `project.subtitles` with a new array on every single mutation (structural sharing, not
 * in-place edits — see that file's own doc comments), so `!==` is a correct, free, O(1)
 * staleness check with no schema or store-shape changes needed. `analyzedSubtitles` is whatever
 * array reference was passed to `analyzeSubtitleQuality` to produce the report being checked.
 */
export function isQualityReportStale(currentSubtitles: Subtitle[], analyzedSubtitles: Subtitle[] | null): boolean {
  return analyzedSubtitles !== null && currentSubtitles !== analyzedSubtitles;
}
