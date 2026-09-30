/**
 * Task 121684 (P19.2) — pure "Fit to Project" / "Fit to Selection" math. Two small pure functions,
 * mirroring lib/timeline/zoom-anchor.ts's own shape exactly (compute a PROPOSED pxPerSec/scrollLeft
 * pair; the caller — timeline.tsx — decides whether/how to apply it, same "propose, don't decide"
 * split every other pure timeline module in this directory already uses).
 *
 * Neither function touches React, the store, or DOM — timeline zoom/scroll is VIEW STATE only
 * (see this task's own explicit "Changing zoom must NEVER call commit()/mark dirty/create undo
 * history/trigger autosave" requirement); these are just arithmetic over the SAME time<->pixel
 * relationship lib/timeline/time-scale.ts already establishes as the one true mapping.
 */

export interface FitRange {
  start: number;
  end: number;
}

/**
 * The bounding time range across every selected caption — `Math.min` of every `start`,
 * `Math.max` of every `end` — regardless of how many captions are selected or whether they're
 * contiguous. A non-contiguous selection (e.g. captions 1 and 5 of 10) is deliberately NOT
 * treated as two separate "islands" to fit — this task's own explicit "fit the entire bounding
 * range rather than trying to fit separate islands" rule. Returns `null` for an empty selection
 * (never invents/guesses a range) or for malformed input (a caption whose own `end <= start`
 * contributes nothing meaningful to fit around).
 */
export function computeSelectionBoundingRange(selected: readonly { start: number; end: number }[]): FitRange | null {
  let start = Infinity;
  let end = -Infinity;
  for (const s of selected) {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) continue;
    if (s.start < start) start = s.start;
    if (s.end > end) end = s.end;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

export interface FitViewInput {
  /** The time range to bring fully into view — `{start: 0, end: duration}` for Fit to Project,
   * or `computeSelectionBoundingRange`'s own result for Fit to Selection. */
  range: FitRange;
  /** The project's own full duration — needed separately from `range` because Fit to Selection's
   * range is only a SUBSET of the timeline; the resulting scrollLeft must still be clamped
   * against the FULL track width, exactly like every other scrollLeft clamp in this codebase
   * (lib/timeline/zoom-anchor.ts's own computeZoomScrollLeft). */
  duration: number;
  viewportWidth: number;
  minPxPerSec: number;
  maxPxPerSec: number;
  /** Pixels of breathing room reserved on each side so the fitted range isn't flush against the
   * viewport edges — defaults to 40, the SAME margin timeline.tsx's own pre-existing
   * selectedId-scroll-into-view effect already uses, not a new invented value. */
  paddingPx?: number;
  /** Matches timeline.tsx's own `Math.max(800, duration * pxPerSec)` track-width floor. */
  minTotalWidth?: number;
}

export interface FitViewResult {
  pxPerSec: number;
  scrollLeft: number;
}

const DEFAULT_PADDING_PX = 40;
const DEFAULT_MIN_TOTAL_WIDTH = 800;

/**
 * Computes the `pxPerSec`/`scrollLeft` pair that brings `range` fully into view, with `paddingPx`
 * of margin on each side. `pxPerSec` is clamped to `[minPxPerSec, maxPxPerSec]` — this task's own
 * "preserve the existing zoom range" rule, so an extremely short range never zooms in absurdly far
 * and an extremely long one never zooms out past what the timeline otherwise allows (for a range
 * longer than the viewport can show even at `minPxPerSec`, the fit starts at the range's own
 * start and simply can't show the whole thing at once — a documented, honest limitation, not a
 * silently-broken result). `scrollLeft` is clamped to `[0, maxScrollLeft]` against the FULL
 * project duration's own track width, so this can never produce a negative or past-the-end
 * scroll position.
 *
 * Returns `null` — do nothing — for a zero/negative-duration range or a non-finite/non-positive
 * viewport width, matching this task's own explicit "fail safely" requirement (never a NaN/
 * Infinity pxPerSec or scrollLeft reaching the caller).
 */
export function computeFitView(input: FitViewInput): FitViewResult | null {
  const { range, duration, viewportWidth, minPxPerSec, maxPxPerSec, paddingPx = DEFAULT_PADDING_PX, minTotalWidth = DEFAULT_MIN_TOTAL_WIDTH } = input;
  const rangeDuration = range.end - range.start;
  if (!Number.isFinite(rangeDuration) || rangeDuration <= 0) return null;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return null;
  const available = Math.max(1, viewportWidth - paddingPx * 2);
  const idealPxPerSec = available / rangeDuration;
  const pxPerSec = Math.min(maxPxPerSec, Math.max(minPxPerSec, idealPxPerSec));
  const totalWidth = Math.max(minTotalWidth, duration * pxPerSec);
  const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);
  const scrollLeft = Math.max(0, Math.min(maxScrollLeft, range.start * pxPerSec - paddingPx));
  return { pxPerSec, scrollLeft };
}
