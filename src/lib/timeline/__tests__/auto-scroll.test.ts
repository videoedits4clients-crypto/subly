/**
 * Regression tests for playback auto-scroll (Task 91342, P7.1 — src/lib/timeline/auto-scroll.ts).
 * Pure math only. The "don't fight manual scroll" and "don't scroll while dragging" behaviors are
 * NOT this module's job — timeline.tsx itself gates calls to computeAutoScrollTarget behind
 * isPlaying/dragState/trimDragRef/manualScrollUntilRef checks before ever calling it (see the
 * component's own auto-scroll effect). This module only answers "given the current scroll
 * position and the playhead, is a scroll needed, and to where" — tested here in isolation.
 *
 * Run with: node --test src/lib/timeline/__tests__/auto-scroll.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeAutoScrollTarget } from "../auto-scroll.ts";

test("1. playhead inside the safe zone (75% of viewport, centered) triggers no scroll", () => {
  // viewport 1000px wide, scrollLeft 0 -> safe zone is [125, 875] (margin = 1000*0.25/2 = 125)
  const target = computeAutoScrollTarget({ playheadPx: 500, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 5000 });
  assert.equal(target, null);
});

test("2. playhead exactly at the safe-zone edge does not trigger a scroll (inclusive boundary)", () => {
  const target = computeAutoScrollTarget({ playheadPx: 875, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 5000 });
  assert.equal(target, null);
});

test("3. playhead past the right safe-zone edge triggers a scroll to bring it back to the safe-zone edge (not re-centered)", () => {
  const target = computeAutoScrollTarget({ playheadPx: 900, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 5000 });
  // target = playheadPx - viewportWidth + margin = 900 - 1000 + 125 = 25
  assert.equal(target, 25);
  // Verify the resulting safe zone right edge lands exactly on the playhead (minimal-adjustment property).
  assert.equal(target! + 1000 - 125, 900);
});

test("4. playhead past the left safe-zone edge triggers a scroll to bring it back to the safe-zone edge", () => {
  const target = computeAutoScrollTarget({ playheadPx: 1300, scrollLeft: 1200, viewportWidth: 1000, maxScrollLeft: 5000 });
  // safe zone at scrollLeft=1200 is [1325, 2075]; playhead 1300 is left of it.
  // target = playheadPx - margin = 1300 - 125 = 1175
  assert.equal(target, 1175);
});

test("5. scroll target is clamped to [0, maxScrollLeft]", () => {
  const clampedHigh = computeAutoScrollTarget({ playheadPx: 100000, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 5000 });
  assert.equal(clampedHigh, 5000);

  const clampedLow = computeAutoScrollTarget({ playheadPx: -50, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 5000 });
  assert.equal(clampedLow, 0);
});

test("6. zero-width viewport is a no-op (returns null, not NaN/Infinity)", () => {
  const target = computeAutoScrollTarget({ playheadPx: 500, scrollLeft: 0, viewportWidth: 0, maxScrollLeft: 5000 });
  assert.equal(target, null);
});

test("7. a custom safeZoneRatio narrows/widens the dead zone as expected", () => {
  // With a tiny safe zone (0.1 -> margin = 450), almost any movement near center should scroll.
  const target = computeAutoScrollTarget({ playheadPx: 500, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 5000, safeZoneRatio: 0.1 });
  assert.equal(target, null, "playhead still exactly centered, so even a narrow safe zone shouldn't trigger");

  // With safeZoneRatio=0.1, margin = 1000*0.9/2 = 450, so the safe zone narrows to [450, 550].
  const target2 = computeAutoScrollTarget({ playheadPx: 600, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 5000, safeZoneRatio: 0.1 });
  assert.notEqual(target2, null, "600 falls outside the narrowed [450, 550] safe zone");
});

test("8. maxScrollLeft of 0 (content narrower than viewport) always resolves to 0", () => {
  const target = computeAutoScrollTarget({ playheadPx: 900, scrollLeft: 0, viewportWidth: 1000, maxScrollLeft: 0 });
  assert.equal(target, 0);
});
