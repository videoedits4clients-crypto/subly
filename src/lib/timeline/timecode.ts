/**
 * Task 123041 (P19.3) — pure "Go to time" parsing/clamping, the one piece of this task's own
 * time-navigation scope that didn't already exist somewhere in the codebase (see this task's own
 * Phase-0 audit, research/p19_3_timecode_precision_navigation_report.md §4/§6): DISPLAY already
 * has an established convention (`formatTime`, lib/utils.ts — "MM:SS.cc", used everywhere from the
 * player transport bar to the caption/word timestamp labels), so it is reused here rather than
 * duplicated. Only the reverse direction — turning typed text back into seconds, and keeping a
 * seek target inside the project's own bounds — was missing, hence this new, small module.
 *
 * No React, no Zustand, no DOM: these are plain functions over numbers/strings, safe to call from
 * a pure test with no store or component involved.
 */

/**
 * Parses a typed "go to time" value into seconds. Accepts the same "MM:SS.cc" shape `formatTime`
 * displays, but is deliberately more lenient about what's typed back in — a lone number of seconds
 * ("12", "12.5"), "MM:SS[.fraction]", or "HH:MM:SS[.fraction]" (1–3 colon-separated parts) — since
 * a user retyping a displayed value shouldn't have to match its exact digit-padding/precision.
 * Returns `null` — never throws, never returns NaN/Infinity — for anything that doesn't cleanly
 * resolve to a finite, non-negative number of seconds: empty/whitespace input, more than 3 parts,
 * any empty or non-numeric part, or a negative component (a negative minutes/seconds component is
 * rejected here rather than silently flipping the overall sign).
 */
export function parseTimelineTime(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  if (parts.some((p) => p.trim() === "")) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  let seconds: number;
  if (nums.length === 1) seconds = nums[0];
  else if (nums.length === 2) seconds = nums[0] * 60 + nums[1];
  else seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Clamps a candidate seek target to `[0, duration]`. A non-finite `seconds` (NaN/Infinity — should
 * already be filtered out by `parseTimelineTime`, but this is the last line of defense before a
 * value ever reaches `store.seek()`) falls back to `0` rather than propagating. A non-finite,
 * zero, or negative `duration` (project has no video yet, or `video.duration` is unavailable) is
 * treated as "no known upper bound `>` 0" and clamps everything down to exactly `0` — matching
 * this task's own "disable/fail safely when duration is unavailable" instruction for the
 * surrounding UI, this is the pure-math half of that same guarantee.
 */
export function clampTimelineTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const max = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.max(0, Math.min(max, seconds));
}
