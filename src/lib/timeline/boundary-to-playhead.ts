/**
 * Task 100742 (P13) — "move the selected caption's start (or end) to the current playhead" — a
 * professional, bounded interaction (common in NLEs as "set in"/"set out"), NOT arbitrary
 * destructive resizing. Pure validation only: this module decides whether the requested boundary
 * is even legal (never invents a clamped-but-different value the user didn't ask for — an
 * invalid request is REJECTED, not silently adjusted, per this task's own "reject cleanly, no
 * partial mutation" instruction). The caller (editor-store.ts's `setSubtitleBoundaryToPlayhead`)
 * only ever calls the EXISTING `updateSubtitleTiming` — which already owns overlap prevention,
 * the minimum-duration floor, and word-bounds clamping (Task 93471, P7.3) — when this module
 * says the request is valid, so there is exactly one place that actually mutates timing, not a
 * second nudge/resize implementation.
 */

export type BoundaryEdge = "start" | "end";

export interface BoundaryToPlayheadInput {
  captionStart: number;
  captionEnd: number;
  playheadTime: number;
  /** The immediately previous caption's own `end`, or `null` if this is the first caption. */
  prevEnd: number | null;
  /** The immediately next caption's own `start`, or `null` if this is the last caption. */
  nextStart: number | null;
  minDurationSec: number;
}

export interface BoundaryToPlayheadResult {
  start: number;
  end: number;
}

/**
 * Returns the new `{start, end}` to pass straight to `updateSubtitleTiming`, or `null` when the
 * request must be rejected outright:
 *  - a negative playhead time,
 *  - a start that would land before the previous caption's own end (would overlap it) or at/after
 *    `end - minDurationSec` (would violate the minimum-duration floor),
 *  - an end that would land after the next caption's own start (would overlap it) or at/before
 *    `start + minDurationSec`,
 *  - or a playhead that's already exactly AT the current boundary (nothing to do — a genuine
 *    no-op is a rejection too, per this task's own "no history entry" requirement for a request
 *    that wouldn't change anything).
 * Every other field of the caption (duration of the OTHER edge, word timings, style, ...) is left
 * for `updateSubtitleTiming` itself to carry over exactly as it already does for any other timing
 * mutation — this function only ever returns the two numbers that change.
 */
export function resolveBoundaryToPlayhead(edge: BoundaryEdge, input: BoundaryToPlayheadInput): BoundaryToPlayheadResult | null {
  const { captionStart, captionEnd, playheadTime, prevEnd, nextStart, minDurationSec } = input;
  if (playheadTime < 0) return null;

  if (edge === "start") {
    if (playheadTime === captionStart) return null;
    if (prevEnd !== null && playheadTime < prevEnd) return null;
    if (playheadTime > captionEnd - minDurationSec) return null;
    return { start: playheadTime, end: captionEnd };
  }

  if (playheadTime === captionEnd) return null;
  if (nextStart !== null && playheadTime > nextStart) return null;
  if (playheadTime < captionStart + minDurationSec) return null;
  return { start: captionStart, end: playheadTime };
}
