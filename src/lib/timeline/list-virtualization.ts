/**
 * Pure windowing math for a fixed/estimated-row-height virtualized vertical list — factored out
 * of captions-panel.tsx so it's directly unit-testable without React/DOM (see
 * lib/timeline/__tests__/list-virtualization.test.ts and
 * research/p2_editor_performance_scalability_report.md for the measurements that motivated
 * this). Mirrors the same "viewport + overscan buffer" principle timeline.tsx's own
 * `visibleSubtitles` already uses for horizontal (time-based) virtualization — this is the
 * vertical (scroll-position-based) analogue, not a new architecture.
 */

export interface VisibleRange {
  startIndex: number;
  endIndex: number;
  /** False when `totalCount` is at or below the threshold — callers should render every item
   * unvirtualized in that case (startIndex/endIndex still span the full list either way). */
  virtualized: boolean;
}

/**
 * Which item indices [startIndex, endIndex) should actually be mounted, given the current
 * scroll position — plus an overscan buffer of extra rows on each side so nothing pops in/out
 * abruptly while scrolling. Below `threshold` total items, virtualization is skipped entirely
 * (the full range is returned, `virtualized: false`) — small/typical lists don't need it, and
 * skipping it keeps their behavior identical to a plain, unvirtualized render.
 */
export function computeVisibleRange(
  totalCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscanRows: number,
  threshold: number,
): VisibleRange {
  if (totalCount <= threshold) {
    return { startIndex: 0, endIndex: totalCount, virtualized: false };
  }
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const endIndex = Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows);
  return { startIndex, endIndex, virtualized: true };
}

/**
 * The new scrollTop needed to bring item `index` into view, given the current scroll position
 * and viewport height — or `null` if it's already fully visible (no scroll needed). Pure index
 * arithmetic, not a DOM query, so it works even when the target row isn't currently mounted
 * (the whole reason this exists — see captions-panel.tsx's scrollIndexIntoView, which is what a
 * DOM-query-based `scrollIntoView()` cannot do for a virtualized-out row).
 */
export function computeScrollTargetForIndex(
  index: number,
  rowHeight: number,
  currentScrollTop: number,
  viewportHeight: number,
): number | null {
  if (index < 0) return null;
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  if (rowTop < currentScrollTop) return rowTop;
  if (rowBottom > currentScrollTop + viewportHeight) return rowBottom - viewportHeight;
  return null;
}
