/**
 * Pure extraction of timeline.tsx's virtualization window filter (Task 91342, P7.1 — added
 * because this filter had no dedicated test despite backing every subtitle block rendered on a
 * long timeline). Behavior is unchanged from the original inline computation in timeline.tsx:
 * one screen's worth of buffer on each side of the visible scroll window, so captions don't pop
 * in/out while scrolling.
 */
import type { Subtitle } from "@/types/subtitle";

export interface VisibleRangeInput {
  scrollLeft: number;
  viewportWidth: number;
  pxPerSec: number;
}

export function computeVisibleTimeRange({ scrollLeft, viewportWidth, pxPerSec }: VisibleRangeInput): { viewStart: number; viewEnd: number } {
  const buffer = viewportWidth / pxPerSec;
  const viewStart = scrollLeft / pxPerSec - buffer;
  const viewEnd = (scrollLeft + viewportWidth) / pxPerSec + buffer;
  return { viewStart, viewEnd };
}

export function filterVisibleSubtitles<T extends Pick<Subtitle, "start" | "end">>(subtitles: T[], input: VisibleRangeInput): T[] {
  const { viewStart, viewEnd } = computeVisibleTimeRange(input);
  return subtitles.filter((s) => s.end >= viewStart && s.start <= viewEnd);
}

/**
 * Task 127416 (P19.6) — the timeline ruler's own tick step: 1s once zoomed in past 100px/sec, 2s
 * past 40px/sec, 5s otherwise. Extracted unchanged from timeline.tsx's own pre-existing inline
 * expression (P19.5's own audit finding was that ruler ticks weren't viewport-virtualized at
 * all — this task's own explicit "tick interval selection remains unchanged" invariant means this
 * is a straight lift, not a redesign, of the SAME thresholds/values, now just a named, testable
 * function instead of a bare inline ternary).
 */
export function computeRulerTickStep(pxPerSec: number): number {
  return pxPerSec > 100 ? 1 : pxPerSec > 40 ? 2 : 5;
}

/**
 * Task 127416 (P19.6) — viewport-aware ruler ticks: only the tick TIMES that can actually affect
 * the current scroll window (+ the SAME one-viewport-width overscan `computeVisibleTimeRange`
 * already establishes for caption virtualization — reused here unchanged, not a second buffer
 * convention), never a `0 -> duration` loop. Tick times are computed by INDEX
 * (`i * step`, `i` an integer), not by repeated addition — the exact same sequence of values a
 * `for (t = 0; t < duration; t += step)` loop would produce (since `step` is always a small
 * positive integer, there is no floating-point drift either way), just reached by directly
 * computing the first/last relevant index instead of walking every earlier one. This is what
 * keeps the work proportional to the VIEWPORT (plus overscan), never to the project's own total
 * duration — a 60-minute project scrolled to any one spot costs the same as a 30-second one.
 *
 * Returns an empty array for a non-positive `step` or `duration` (matches this task's own
 * "zero/invalid duration safety" requirement) rather than guessing.
 */
export function computeVisibleTicks(input: VisibleRangeInput & { step: number; duration: number }): number[] {
  const { step, duration } = input;
  if (!(step > 0) || !(duration > 0)) return [];
  const { viewStart, viewEnd } = computeVisibleTimeRange(input);
  const rangeStart = Math.max(0, viewStart);
  const rangeEnd = Math.min(duration, viewEnd);
  if (rangeEnd < rangeStart) return [];
  const firstIndex = Math.max(0, Math.ceil(rangeStart / step));
  const lastIndex = Math.floor(rangeEnd / step);
  const ticks: number[] = [];
  for (let i = firstIndex; i <= lastIndex; i++) {
    const t = i * step;
    if (t < duration) ticks.push(t); // matches the original loop's own exclusive `t < duration` bound
  }
  return ticks;
}
