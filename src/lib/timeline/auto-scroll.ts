/**
 * Pure "where should the timeline scroll to keep the playhead visible during playback" math
 * (Task 91342, P7.1). Extracted as its own pure function — per the task's own instruction —
 * specifically so the scroll-decision logic has a real unit test without needing a browser DOM
 * or a fake scroll container; the actual `scrollLeft` write and the "was this scroll caused by
 * the user" bookkeeping stay in timeline.tsx, which is what a DOM-dependent integration/live-QA
 * pass is for (see the P7.1 report).
 */

export interface AutoScrollInput {
  /** The playhead's pixel position within the FULL (unscrolled) timeline track — i.e. `currentTime * pxPerSec`. */
  playheadPx: number;
  /** The timeline scroll container's current `scrollLeft`. */
  scrollLeft: number;
  /** The timeline scroll container's visible width (`clientWidth`). */
  viewportWidth: number;
  /** The furthest the container can scroll — `max(0, totalTrackWidth - viewportWidth)`. Passed
   * in (not recomputed here) so this module never needs to know how `totalTrackWidth` itself is
   * derived (currently `Math.max(800, duration * pxPerSec)` in timeline.tsx). */
  maxScrollLeft: number;
  /** Fraction of the viewport treated as the "safe zone" the playhead is allowed to roam inside
   * without triggering a scroll — e.g. 0.75 keeps the playhead within the middle 75% of the
   * viewport (12.5% margin on each side), matching the task's own "middle 70-80%" guidance. */
  safeZoneRatio?: number;
}

const DEFAULT_SAFE_ZONE_RATIO = 0.75;

/**
 * Returns the new `scrollLeft` the timeline should adopt to bring the playhead back inside the
 * safe zone, or `null` if the playhead is already inside it (the overwhelmingly common case
 * during smooth playback — this is what keeps auto-scroll from writing to `scrollLeft` on every
 * single `currentTime` update: a `null` result means "do nothing," and the caller should skip
 * the DOM write entirely). When a scroll IS needed, the playhead is moved to the near edge of
 * the safe zone it crossed, not re-centered — a minimal, "just enough" adjustment rather than a
 * jarring recenter, per the task's explicit "do NOT continuously force the playhead into the
 * exact center" instruction. The result is always clamped to `[0, maxScrollLeft]`.
 */
export function computeAutoScrollTarget(input: AutoScrollInput): number | null {
  const { playheadPx, scrollLeft, viewportWidth, maxScrollLeft, safeZoneRatio = DEFAULT_SAFE_ZONE_RATIO } = input;
  if (viewportWidth <= 0) return null;

  const margin = (viewportWidth * (1 - safeZoneRatio)) / 2;
  const safeLeft = scrollLeft + margin;
  const safeRight = scrollLeft + viewportWidth - margin;

  let target: number | null = null;
  if (playheadPx < safeLeft) {
    target = playheadPx - margin;
  } else if (playheadPx > safeRight) {
    target = playheadPx - viewportWidth + margin;
  }
  if (target === null) return null;

  return Math.max(0, Math.min(maxScrollLeft, target));
}
