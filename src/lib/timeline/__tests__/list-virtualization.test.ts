/**
 * Regression tests for the captions-panel virtualization windowing math
 * (src/lib/timeline/list-virtualization.ts) — added for the P2 Editor Performance &
 * Scalability phase after measuring that mounting every CaptionRow unconditionally took
 * ~340ms-1.6s at 300-5,400 captions (see research/p2_editor_performance_scalability_report.md).
 *
 * Run with: node --test src/lib/timeline/__tests__/list-virtualization.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeVisibleRange, computeScrollTargetForIndex } from "../list-virtualization.ts";

const ROW_HEIGHT = 89;
const OVERSCAN = 10;
const THRESHOLD = 150;

test("1. below the threshold, virtualization is skipped — the full range is returned", () => {
  const r = computeVisibleRange(30, 0, 600, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  assert.deepEqual(r, { startIndex: 0, endIndex: 30, virtualized: false });
});

test("2. exactly at the threshold is still unvirtualized (threshold is inclusive of the small case)", () => {
  const r = computeVisibleRange(THRESHOLD, 0, 600, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  assert.equal(r.virtualized, false);
  assert.equal(r.endIndex, THRESHOLD);
});

test("3. above the threshold, only the viewport + overscan range is returned, not the full list", () => {
  const r = computeVisibleRange(5400, 0, 600, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  assert.equal(r.virtualized, true);
  assert.equal(r.startIndex, 0); // clamped — can't scroll above the top
  // ceil(600/89) + 10 overscan
  assert.equal(r.endIndex, Math.ceil(600 / ROW_HEIGHT) + OVERSCAN);
  assert.ok(r.endIndex < 5400, "must render far fewer than the total when scrolled to the top");
});

test("4. scrolled deep into a large list, the window follows scrollTop, with overscan on both sides", () => {
  const scrollTop = 100000;
  const r = computeVisibleRange(5400, scrollTop, 600, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  const expectedStart = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN;
  assert.equal(r.startIndex, expectedStart);
  assert.ok(r.startIndex > 0 && r.endIndex < 5400, "should be a genuine middle window, not clamped to an edge");
});

test("5. near the end of a large list, endIndex clamps to totalCount, never overruns", () => {
  const totalCount = 5400;
  const scrollTop = totalCount * ROW_HEIGHT - 300; // near the very bottom
  const r = computeVisibleRange(totalCount, scrollTop, 600, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  assert.equal(r.endIndex, totalCount);
  assert.ok(r.startIndex < totalCount);
});

test("6. viewport height changes the window size proportionally", () => {
  const small = computeVisibleRange(5400, 0, 300, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  const large = computeVisibleRange(5400, 0, 1200, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  assert.ok(large.endIndex > small.endIndex, "a taller viewport must render more rows");
});

test("7. scroll target: an index already fully visible needs no scroll (returns null)", () => {
  // viewport [0, 600); row 3 spans [267, 356) — fully inside.
  const target = computeScrollTargetForIndex(3, ROW_HEIGHT, 0, 600);
  assert.equal(target, null);
});

test("8. scroll target: an index above the current viewport scrolls up to its own top", () => {
  const index = 2;
  const target = computeScrollTargetForIndex(index, ROW_HEIGHT, 5000, 600);
  assert.equal(target, index * ROW_HEIGHT);
});

test("9. scroll target: an index below the current viewport scrolls down just enough to reveal its bottom edge", () => {
  const index = 100;
  const currentScrollTop = 0;
  const viewportHeight = 600;
  const target = computeScrollTargetForIndex(index, ROW_HEIGHT, currentScrollTop, viewportHeight);
  const rowBottom = (index + 1) * ROW_HEIGHT;
  assert.equal(target, rowBottom - viewportHeight);
});

test("10. scroll target: a negative index (not found, e.g. a stale/deleted caption id) is a safe no-op", () => {
  const target = computeScrollTargetForIndex(-1, ROW_HEIGHT, 0, 600);
  assert.equal(target, null);
});

test("11. scroll target followed by re-computing the visible range actually includes the target index", () => {
  // Simulates captions-panel's real flow: compute a scroll target for an off-window index,
  // then recompute the visible range at that new scrollTop, and confirm the index now falls
  // inside [startIndex, endIndex) — this is the exact invariant the P2 bug fix depends on.
  const totalCount = 5400;
  const targetIndex = 1423;
  const initialScrollTop = 0;
  const viewportHeight = 600;
  const newScrollTop = computeScrollTargetForIndex(targetIndex, ROW_HEIGHT, initialScrollTop, viewportHeight);
  assert.notEqual(newScrollTop, null);
  const range = computeVisibleRange(totalCount, newScrollTop!, viewportHeight, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  assert.ok(
    targetIndex >= range.startIndex && targetIndex < range.endIndex,
    `expected index ${targetIndex} to be within [${range.startIndex}, ${range.endIndex})`,
  );
});

test("12. an empty list (0 captions) is unvirtualized and renders an empty range without throwing", () => {
  const r = computeVisibleRange(0, 0, 600, ROW_HEIGHT, OVERSCAN, THRESHOLD);
  assert.deepEqual(r, { startIndex: 0, endIndex: 0, virtualized: false });
});
