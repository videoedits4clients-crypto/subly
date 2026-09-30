import type { Subtitle, TimingRules } from "@/types/subtitle";
import { calculateCPS, FAST_READING_CPS } from "./reading-speed";

// Internal QA utility only — never surfaced to end users. Used by test scripts
// and (optionally) server-side logging to catch subtitle-generation regressions
// before they reach a creator's export. Not wired into any user-facing route.

export type ValidationSeverity = "pass" | "warn" | "fail";

export interface ValidationIssue {
  code: string;
  severity: Exclude<ValidationSeverity, "pass">;
  message: string;
  subtitleId?: string;
  subtitleIndex?: number;
}

export interface ValidationReport {
  verdict: ValidationSeverity;
  counts: { warn: number; fail: number };
  issues: ValidationIssue[];
}

// Heuristic floors/ceilings that apply regardless of a project's configured
// TimingRules — these catch captions no reasonable rule set should allow.
const HARD_MIN_DURATION = 0.4;
const HARD_MAX_DURATION = 8;
const WORD_BOUNDARY_SLACK = 0.05; // seconds of float/rounding slack

export function validateSubtitles(subtitles: Subtitle[], rules: TimingRules): ValidationReport {
  const issues: ValidationIssue[] = [];
  const flag = (severity: "warn" | "fail", code: string, message: string, sub?: Subtitle) =>
    issues.push({ code, severity, message, subtitleId: sub?.id, subtitleIndex: sub?.index });

  // 10. invalid ordering
  subtitles.forEach((s, i) => {
    if (s.index !== i) flag("fail", "invalid-ordering", `positioned at ${i} but carries index ${s.index}`, s);
    const prev = subtitles[i - 1];
    if (prev && s.start < prev.start) flag("fail", "invalid-ordering", `starts (${s.start}s) before the previous caption's start (${prev.start}s)`, s);
  });

  for (const s of subtitles) {
    const duration = s.end - s.start;

    // 3. negative duration
    if (duration < 0) {
      flag("fail", "negative-duration", `end (${s.end}s) is before start (${s.start}s)`, s);
      continue;
    }
    // 2. zero-duration
    if (duration === 0) {
      flag("fail", "zero-duration", `start and end are identical (${s.start}s)`, s);
    } else if (duration < HARD_MIN_DURATION) {
      // 4. excessively short
      flag("fail", "too-short", `${duration.toFixed(2)}s is below any readable floor (${HARD_MIN_DURATION}s)`, s);
    } else if (duration < rules.minDuration) {
      flag("warn", "too-short", `${duration.toFixed(2)}s is below the configured minimum (${rules.minDuration}s)`, s);
    }

    // 5. excessively long
    if (duration > HARD_MAX_DURATION) {
      flag("fail", "too-long", `${duration.toFixed(2)}s far exceeds a readable single caption (>${HARD_MAX_DURATION}s)`, s);
    } else if (duration > rules.maxDuration) {
      flag("warn", "too-long", `${duration.toFixed(2)}s exceeds the configured maximum (${rules.maxDuration}s)`, s);
    }

    if (duration > 0) {
      const flatText = s.text.replace(/\n/g, " ").trim();
      const cps = calculateCPS(s.text, duration);
      if (cps > FAST_READING_CPS) {
        flag("warn", "reading-speed", `~${cps.toFixed(1)} chars/sec — likely flashes by too fast to read`, s);
      }
      const wordCount = flatText.split(/\s+/).filter(Boolean).length;
      if (wordCount === 1 && duration > 0.2) {
        flag("warn", "single-word-caption", `caption is a single word ("${flatText}") — awkward on its own`, s);
      }
    }

    // 6/7. line length / count
    const lines = s.text.split("\n");
    if (lines.length > rules.maxLines) {
      flag("fail", "too-many-lines", `${lines.length} lines exceeds the configured max (${rules.maxLines})`, s);
    }
    lines.forEach((line, li) => {
      if (line.length > rules.maxCharsPerLine) {
        flag("warn", "line-too-long", `line ${li + 1} has ${line.length} chars (max ${rules.maxCharsPerLine})`, s);
      }
    });

    // 8. missing word timestamps
    const hasText = s.text.trim().length > 0;
    if (hasText && (!s.words || s.words.length === 0)) {
      flag("fail", "missing-word-timestamps", `no word-level timestamps for a non-empty caption`, s);
    } else if (s.words?.length) {
      // 9. words outside subtitle boundaries
      for (const w of s.words) {
        if (w.end < w.start) {
          flag("fail", "word-negative-duration", `word "${w.text}" ends (${w.end}s) before it starts (${w.start}s)`, s);
        }
        if (w.start < s.start - WORD_BOUNDARY_SLACK || w.end > s.end + WORD_BOUNDARY_SLACK) {
          flag(
            "fail",
            "word-out-of-bounds",
            `word "${w.text}" [${w.start}s–${w.end}s] falls outside caption bounds [${s.start}s–${s.end}s]`,
            s
          );
        }
      }
      for (let i = 1; i < s.words.length; i++) {
        if (s.words[i].start < s.words[i - 1].start - WORD_BOUNDARY_SLACK) {
          flag("warn", "word-order", `word "${s.words[i].text}" starts before the previous word ends`, s);
        }
      }
    }
  }

  // 1. overlapping subtitles
  for (let i = 1; i < subtitles.length; i++) {
    const prev = subtitles[i - 1];
    const cur = subtitles[i];
    if (cur.start < prev.end - 0.001) {
      flag("fail", "overlap", `overlaps the previous caption by ${(prev.end - cur.start).toFixed(2)}s`, cur);
    }
  }

  const counts = { warn: 0, fail: 0 };
  for (const issue of issues) counts[issue.severity]++;
  const verdict: ValidationSeverity = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
  return { verdict, counts, issues };
}
