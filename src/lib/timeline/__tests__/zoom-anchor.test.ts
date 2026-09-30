/**
 * Regression tests for zoom position preservation (Task 91342, P7.1 — src/lib/timeline/zoom-anchor.ts).
 * Pure math only. computeZoomAnchor captures "what to hold visually fixed" BEFORE pxPerSec
 * changes; computeZoomScrollLeft derives the new scrollLeft that keeps that same anchor at the
 * same pixel offset AFTER pxPerSec changes. timeline.tsx wires these together via
 * pendingZoomAnchorRef across the zoomBy() call and the [pxPerSec]-keyed effect.
 *
 * Run with: node --test src/lib/timeline/__tests__/zoom-anchor.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeZoomAnchor, computeZoomScrollLeft } from "../zoom-anchor.ts";

test("1. when the playhead is visible, it becomes the anchor (not the viewport center)", () => {
  // pxPerSec=50 -> playhead at 10s is at 500px. Viewport [200, 1200] contains 500, so it's visible.
  const anchor = computeZoomAnchor({ currentTime: 10, scrollLeft: 200, viewportWidth: 1000, pxPerSec: 50 });
  assert.equal(anchor.anchorTime, 10);
  assert.equal(anchor.anchorOffsetPx, 500 - 200);
});

test("2. when the playhead is NOT visible, the viewport center becomes the anchor", () => {
  // pxPerSec=50 -> playhead at 100s is at 5000px, well outside viewport [200, 1200].
  const anchor = computeZoomAnchor({ currentTime: 100, scrollLeft: 200, viewportWidth: 1000, pxPerSec: 50 });
  const expectedCenterTime = (200 + 500) / 50; // (scrollLeft + viewportWidth/2) / pxPerSec
  assert.equal(anchor.anchorTime, expectedCenterTime);
  assert.equal(anchor.anchorOffsetPx, 500); // center of viewport, by construction
});

test("3. zooming IN preserves the anchor's on-screen pixel position", () => {
  const anchor = { anchorTime: 30, anchorOffsetPx: 300 };
  const newScrollLeft = computeZoomScrollLeft({
    anchorTime: anchor.anchorTime,
    anchorOffsetPx: anchor.anchorOffsetPx,
    newPxPerSec: 100, // zoomed in from (implicitly) something smaller
    duration: 600,
    viewportWidth: 1000,
  });
  // anchor's new absolute px = 30 * 100 = 3000; scrollLeft should put it at offset 300 -> scrollLeft = 2700
  assert.equal(newScrollLeft, 2700);
});

test("4. zooming OUT preserves the anchor's on-screen pixel position", () => {
  const newScrollLeft = computeZoomScrollLeft({
    anchorTime: 30,
    anchorOffsetPx: 300,
    newPxPerSec: 20,
    duration: 600,
    viewportWidth: 1000,
  });
  // anchor's new absolute px = 30 * 20 = 600; scrollLeft = 600 - 300 = 300, but clamp to >=0
  assert.equal(newScrollLeft, 300);
});

test("5. the derived scrollLeft is clamped to the valid [0, maxScrollLeft] range", () => {
  // Zooming out far enough that the naive scrollLeft would go negative.
  const low = computeZoomScrollLeft({ anchorTime: 5, anchorOffsetPx: 900, newPxPerSec: 20, duration: 600, viewportWidth: 1000 });
  assert.equal(low, 0, "clamped up to 0 rather than going negative");

  // Anchored exactly at the timeline's end (with zero on-screen offset) puts the naive target
  // right at the total track width, which exceeds maxScrollLeft by exactly viewportWidth's worth.
  const high = computeZoomScrollLeft({ anchorTime: 600, anchorOffsetPx: 0, newPxPerSec: 220, duration: 600, viewportWidth: 1000 });
  const expectedMax = 600 * 220 - 1000; // duration * newPxPerSec - viewportWidth
  assert.equal(high, expectedMax);
});

test("6. short timelines respect the minimum total track width floor (matches timeline.tsx's own Math.max(800, ...))", () => {
  // A 5s timeline at pxPerSec=20 is only 100px wide -- far under the 800px floor -- so maxScrollLeft should be 0.
  const scrollLeft = computeZoomScrollLeft({ anchorTime: 2, anchorOffsetPx: 0, newPxPerSec: 20, duration: 5, viewportWidth: 1000 });
  assert.equal(scrollLeft, 0, "total width (800 floor) is still less than the viewport, so there is nothing to scroll");
});

test("7. long timelines produce a proportionally large scrollLeft with no artificial cap beyond duration*pxPerSec", () => {
  const scrollLeft = computeZoomScrollLeft({ anchorTime: 1795, anchorOffsetPx: 0, newPxPerSec: 220, duration: 1800, viewportWidth: 1000 });
  assert.equal(scrollLeft, 1795 * 220); // well under maxScrollLeft (395000), so returned unclamped
});

test("8. repeated zoom in/out around the same anchor does not drift (idempotent round-trip)", () => {
  let pxPerSec = 50;
  let scrollLeft = 400;
  const viewportWidth = 1000;
  const duration = 300;
  const currentTime = 20; // kept constant, playhead visible throughout at these zoom levels near scrollLeft

  const steps = [100, 150, 80, 50]; // zoom in, in, out, back to start
  for (const newPxPerSec of steps) {
    const anchor = computeZoomAnchor({ currentTime, scrollLeft, viewportWidth, pxPerSec });
    scrollLeft = computeZoomScrollLeft({
      anchorTime: anchor.anchorTime,
      anchorOffsetPx: anchor.anchorOffsetPx,
      newPxPerSec,
      duration,
      viewportWidth,
    });
    pxPerSec = newPxPerSec;
  }
  // Back to the original pxPerSec (50) — both scrollLeft and the anchor's on-screen offset
  // (600px: playheadPx 1000 - scrollLeft 400 at the start) should return to their starting values.
  assert.equal(scrollLeft, 400, "scrollLeft returns to its starting value after a full round trip");
  const finalAnchorPx = currentTime * pxPerSec;
  assert.equal(finalAnchorPx - scrollLeft, 600, "the anchor's on-screen offset also matches its original 600px position");
});
