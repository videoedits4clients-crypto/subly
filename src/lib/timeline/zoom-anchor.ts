/**
 * Pure "keep this time visually anchored across a zoom change" math (Task 91342, P7.1). Two
 * small pure functions, used together by timeline.tsx's zoom handlers:
 *
 *   1. computeZoomAnchor()      — BEFORE changing pxPerSec: decide what time to anchor on
 *                                  (the playhead, if visible; otherwise the viewport's center)
 *                                  and where within the viewport it currently sits.
 *   2. computeZoomScrollLeft()  — AFTER changing pxPerSec: find the scrollLeft that puts that
 *                                  same anchor time back at that same on-screen offset.
 *
 * Uses the EXISTING time↔pixel relationship (`time * pxPerSec`) rather than introducing a new
 * coordinate system — these are just two extra pure functions, not a replacement for
 * lib/timeline/time-scale.ts (which stays the one place the raw formula itself lives).
 */

export interface ZoomAnchorSource {
  currentTime: number;
  scrollLeft: number;
  viewportWidth: number;
  pxPerSec: number;
}

export interface ZoomAnchor {
  anchorTime: number;
  /** The anchor time's pixel offset from the LEFT EDGE OF THE VIEWPORT (not the full track) at
   * the moment of zooming — this is what must stay constant across the zoom change for the
   * anchor to look visually stable, rather than merely staying on-screen somewhere. */
  anchorOffsetPx: number;
}

/**
 * Decides the zoom anchor using the task's own preference order: the playhead if it's currently
 * within the visible viewport, otherwise the time currently at the viewport's horizontal center.
 * Called with the OLD `pxPerSec`/`scrollLeft` — i.e. right before the zoom level actually changes.
 */
export function computeZoomAnchor(src: ZoomAnchorSource): ZoomAnchor {
  const { currentTime, scrollLeft, viewportWidth, pxPerSec } = src;
  const playheadPx = currentTime * pxPerSec;
  const playheadVisible = playheadPx >= scrollLeft && playheadPx <= scrollLeft + viewportWidth;
  const anchorTime = playheadVisible ? currentTime : (scrollLeft + viewportWidth / 2) / pxPerSec;
  const anchorOffsetPx = anchorTime * pxPerSec - scrollLeft;
  return { anchorTime, anchorOffsetPx };
}

export interface ZoomScrollInput {
  anchorTime: number;
  anchorOffsetPx: number;
  newPxPerSec: number;
  duration: number;
  viewportWidth: number;
  /** Matches timeline.tsx's own `Math.max(800, duration * pxPerSec)` track-width floor, so a
   * short project's clamp behaves identically to the real component. */
  minTotalWidth?: number;
}

const DEFAULT_MIN_TOTAL_WIDTH = 800;

/**
 * Computes the `scrollLeft` that places `anchorTime` back at `anchorOffsetPx` from the
 * viewport's left edge under the NEW zoom level, clamped to a valid `[0, maxScrollLeft]` range
 * so this can never produce a negative scroll position or one beyond the (new) track's own
 * maximum — the two explicit "must not" cases the task calls out.
 */
export function computeZoomScrollLeft(input: ZoomScrollInput): number {
  const { anchorTime, anchorOffsetPx, newPxPerSec, duration, viewportWidth, minTotalWidth = DEFAULT_MIN_TOTAL_WIDTH } = input;
  const newAnchorPx = anchorTime * newPxPerSec;
  const newTotalWidth = Math.max(minTotalWidth, duration * newPxPerSec);
  const maxScrollLeft = Math.max(0, newTotalWidth - viewportWidth);
  return Math.max(0, Math.min(maxScrollLeft, newAnchorPx - anchorOffsetPx));
}
