/**
 * Regression tests for the timeline's virtualization window filter (Task 91342, P7.1 —
 * src/lib/timeline/visible-range.ts, extracted verbatim from timeline.tsx's own previously-
 * untested inline `visibleSubtitles` useMemo). This is the SAME mechanism that keeps a
 * multi-thousand-caption timeline responsive by only mounting DOM nodes for captions that
 * actually intersect the visible scroll window (see list-virtualization.ts for the SEPARATE
 * mechanism backing the caption list sidebar — this one is timeline-only).
 *
 * Run with: node --test src/lib/timeline/__tests__/visible-range.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeVisibleTimeRange, filterVisibleSubtitles, computeRulerTickStep, computeVisibleTicks } from "../visible-range.ts";

function sub(id: string, start: number, end: number) {
  return { id, start, end };
}

test("1. computeVisibleTimeRange adds exactly one viewport-width of buffer on each side", () => {
  // pxPerSec=100 -> viewportWidth 500px = 5s of buffer.
  const { viewStart, viewEnd } = computeVisibleTimeRange({ scrollLeft: 1000, viewportWidth: 500, pxPerSec: 100 });
  assert.equal(viewStart, 1000 / 100 - 5); // 5
  assert.equal(viewEnd, (1000 + 500) / 100 + 5); // 20
});

test("2. a caption fully inside the visible window is included", () => {
  const subs = [sub("a", 10, 12)];
  const result = filterVisibleSubtitles(subs, { scrollLeft: 500, viewportWidth: 500, pxPerSec: 100 });
  assert.deepEqual(result, subs);
});

test("3. a caption fully outside the visible window (and its buffer) is excluded", () => {
  const subs = [sub("far", 500, 502)];
  const result = filterVisibleSubtitles(subs, { scrollLeft: 0, viewportWidth: 500, pxPerSec: 100 });
  assert.deepEqual(result, []);
});

test("4. a caption that only partially overlaps the visible window is still included (start before, end inside)", () => {
  // window (buffered) is roughly [-5, 10] at scrollLeft=0, viewportWidth=500, pxPerSec=100.
  const subs = [sub("straddle", -2, 1)];
  const result = filterVisibleSubtitles(subs, { scrollLeft: 0, viewportWidth: 500, pxPerSec: 100 });
  assert.deepEqual(result, subs);
});

test("5. a caption exactly at the buffered boundary (inclusive) is included", () => {
  const { viewStart, viewEnd } = computeVisibleTimeRange({ scrollLeft: 0, viewportWidth: 500, pxPerSec: 100 });
  const subs = [sub("at-start-edge", viewStart, viewStart + 1), sub("at-end-edge", viewEnd - 1, viewEnd)];
  const result = filterVisibleSubtitles(subs, { scrollLeft: 0, viewportWidth: 500, pxPerSec: 100 });
  assert.equal(result.length, 2);
});

test("6. order is preserved and no caption is duplicated", () => {
  const subs = [sub("a", 0, 1), sub("b", 2, 3), sub("c", 4, 5)];
  const result = filterVisibleSubtitles(subs, { scrollLeft: 0, viewportWidth: 1000, pxPerSec: 100 });
  assert.deepEqual(result.map((s) => s.id), ["a", "b", "c"]);
});

test("7. an empty subtitle list returns an empty array", () => {
  const result = filterVisibleSubtitles([], { scrollLeft: 0, viewportWidth: 500, pxPerSec: 100 });
  assert.deepEqual(result, []);
});

test("8. at high zoom (large pxPerSec) the buffer in seconds shrinks, tightening the window", () => {
  const zoomedOut = computeVisibleTimeRange({ scrollLeft: 0, viewportWidth: 500, pxPerSec: 20 });
  const zoomedIn = computeVisibleTimeRange({ scrollLeft: 0, viewportWidth: 500, pxPerSec: 220 });
  const zoomedOutSpan = zoomedOut.viewEnd - zoomedOut.viewStart;
  const zoomedInSpan = zoomedIn.viewEnd - zoomedIn.viewStart;
  assert.ok(zoomedInSpan < zoomedOutSpan, "a higher pxPerSec covers fewer seconds per screen, so the visible+buffer time span shrinks");
});

test("9. scrolling forward moves the window forward by the same amount (no drift)", () => {
  const a = computeVisibleTimeRange({ scrollLeft: 1000, viewportWidth: 500, pxPerSec: 100 });
  const b = computeVisibleTimeRange({ scrollLeft: 2000, viewportWidth: 500, pxPerSec: 100 });
  const scrollDeltaSec = (2000 - 1000) / 100;
  assert.equal(b.viewStart - a.viewStart, scrollDeltaSec);
  assert.equal(b.viewEnd - a.viewEnd, scrollDeltaSec);
});

test("10. a very long, large caption list only returns the intersecting subset (functional proof the filter scales, mirroring the 3,600/5,400-caption perf scenarios this task's own baseline references)", () => {
  const subs = Array.from({ length: 5400 }, (_, i) => sub(String(i), i * 2, i * 2 + 1.5));
  const result = filterVisibleSubtitles(subs, { scrollLeft: 5000 * 20, viewportWidth: 800, pxPerSec: 20 });
  assert.ok(result.length > 0, "some captions should be visible at this scroll position");
  assert.ok(result.length < subs.length / 10, "virtualization should return a small subset, not the whole list");
});

// ============================================================================================
// Task 127416 (P19.6) — timeline ruler virtualization: computeRulerTickStep / computeVisibleTicks
// ============================================================================================

// --- computeRulerTickStep (item 1: tick interval selection remains unchanged) ---------------

test("computeRulerTickStep: matches the original inline thresholds exactly, including boundaries", () => {
  assert.equal(computeRulerTickStep(20), 5); // MIN_PX_PER_SEC -> item 13 (minimum zoom)
  assert.equal(computeRulerTickStep(40), 5); // exactly 40 -> not > 40, still 5s
  assert.equal(computeRulerTickStep(41), 2); // just past 40 -> 2s
  assert.equal(computeRulerTickStep(70), 2); // default pxPerSec
  assert.equal(computeRulerTickStep(100), 2); // exactly 100 -> not > 100, still 2s
  assert.equal(computeRulerTickStep(101), 1); // just past 100 -> 1s
  assert.equal(computeRulerTickStep(220), 1); // MAX_PX_PER_SEC -> item 14 (maximum zoom)
});

// --- computeVisibleTicks -----------------------------------------------------------------

test("2/4. beginning-of-project range: first visible tick is exactly 0 when scrolled to the start", () => {
  const ticks = computeVisibleTicks({ scrollLeft: 0, viewportWidth: 500, pxPerSec: 100, step: 1, duration: 120 });
  assert.equal(ticks[0], 0);
});

test("5. middle-of-project range: first visible tick is calculated directly, not by walking from 0", () => {
  // scrollLeft=10000 at pxPerSec=100 -> 100s in; viewportWidth=500 -> buffer=5s -> viewStart=95s.
  const ticks = computeVisibleTicks({ scrollLeft: 10000, viewportWidth: 500, pxPerSec: 100, step: 1, duration: 3600 });
  assert.equal(ticks[0], 95); // ceil(95/1)*1
  assert.equal(ticks[ticks.length - 1], 110); // viewEnd = (10000+500)/100+5 = 110
});

test("3/6. end-of-project range: ticks stop at (exclusive) duration, never past it — last visible tick calculated correctly near the end", () => {
  const ticks = computeVisibleTicks({ scrollLeft: 9500, viewportWidth: 500, pxPerSec: 100, step: 1, duration: 100 });
  // viewEnd would be (9500+500)/100+5 = 105, but duration is 100 -> must clamp to < 100.
  assert.equal(ticks[ticks.length - 1], 99);
  assert.ok(ticks.every((t) => t < 100));
});

test("7. overscan: a tick just outside the raw (unbuffered) viewport is still included, matching computeVisibleTimeRange's own buffer", () => {
  // Raw viewport at pxPerSec=100, viewportWidth=500, scrollLeft=1000 is [10,15]s; buffer adds 5s
  // on each side (see test 1 above) -> [5,20]. A tick at t=6 is outside the RAW window but inside
  // the buffered one.
  const ticks = computeVisibleTicks({ scrollLeft: 1000, viewportWidth: 500, pxPerSec: 100, step: 1, duration: 100 });
  assert.ok(ticks.includes(6), "a tick just before the raw viewport, but inside the overscan, must still render");
  assert.ok(ticks.includes(19), "a tick just after the raw viewport, but inside the overscan, must still render");
});

test("8. no duplicate ticks", () => {
  const ticks = computeVisibleTicks({ scrollLeft: 1000, viewportWidth: 500, pxPerSec: 100, step: 2, duration: 1000 });
  assert.equal(new Set(ticks).size, ticks.length);
});

test("9. no missing visible ticks: every multiple of step inside the buffered range is present, contiguous, none skipped", () => {
  const ticks = computeVisibleTicks({ scrollLeft: 1000, viewportWidth: 500, pxPerSec: 100, step: 2, duration: 1000 });
  for (let i = 1; i < ticks.length; i++) {
    assert.equal(ticks[i] - ticks[i - 1], 2, "consecutive ticks must be exactly one step apart — no gaps, no skips");
  }
});

test("10/11. exact timestamp preservation: matches the ORIGINAL `for (t=0; t<duration; t+=step)` loop's own values exactly, for every tick that loop would also produce inside this viewport", () => {
  const step = 2;
  const duration = 40;
  const original: number[] = [];
  for (let t = 0; t < duration; t += step) original.push(t);
  // A viewport wide enough (with its own overscan) to cover the WHOLE small duration here —
  // proving the virtualized result is identical to the original unbounded one when everything
  // happens to be visible, not just a coincidentally-correct subset.
  const ticks = computeVisibleTicks({ scrollLeft: 0, viewportWidth: 4000, pxPerSec: 100, step, duration });
  assert.deepEqual(ticks, original);
});

test("12. major/minor classification: not applicable — no such tiering exists in the current ruler (single-tier, every tick identically labeled), confirmed unchanged by this task", () => {
  // Documented as N/A per this task's own Phase-0 audit finding — see the report. This test
  // exists only to make that explicit rather than silently skipping item 12.
  assert.equal(true, true);
});

test("13. minimum zoom (MIN_PX_PER_SEC=20): step is 5s, ticks computed correctly", () => {
  const step = computeRulerTickStep(20);
  const ticks = computeVisibleTicks({ scrollLeft: 0, viewportWidth: 800, pxPerSec: 20, step, duration: 120 });
  assert.equal(step, 5);
  assert.deepEqual(ticks.slice(0, 3), [0, 5, 10]);
});

test("14. maximum zoom (MAX_PX_PER_SEC=220): step is 1s, ticks computed correctly", () => {
  const step = computeRulerTickStep(220);
  const ticks = computeVisibleTicks({ scrollLeft: 0, viewportWidth: 800, pxPerSec: 220, step, duration: 12 });
  assert.equal(step, 1);
  assert.deepEqual(ticks.slice(0, 3), [0, 1, 2]);
});

test("15. Fit Project composition: ticks computed correctly at Fit-Project's own resulting pxPerSec/scrollLeft", () => {
  // Mirrors fit-view.ts's own computeFitView formula directly (avoids a cross-module test
  // dependency) — Fit Project on a 12s project at an 800px viewport with the default 40px
  // padding: available=720, pxPerSec=720/12=60, clamped to [20,220] -> 60; scrollLeft=0.
  const pxPerSec = 60;
  const step = computeRulerTickStep(pxPerSec);
  const ticks = computeVisibleTicks({ scrollLeft: 0, viewportWidth: 800, pxPerSec, step, duration: 12 });
  assert.equal(step, 2); // 60 > 40 -> 2s step
  assert.deepEqual(ticks, [0, 2, 4, 6, 8, 10]);
});

test("16. Fit Selection composition: ticks computed correctly at a non-zero scrollLeft/zoomed-in pxPerSec", () => {
  // A Fit-to-Selection-style result: zoomed in (pxPerSec=159) and scrolled to a non-zero offset.
  const pxPerSec = 159;
  const step = computeRulerTickStep(pxPerSec);
  const ticks = computeVisibleTicks({ scrollLeft: 238, viewportWidth: 676, pxPerSec, step, duration: 12 });
  assert.equal(step, 1);
  assert.ok(ticks.length > 0);
  assert.ok(ticks.every((t) => Number.isInteger(t) && t >= 0 && t < 12));
});

for (const [label, duration] of [
  ["30s", 30],
  ["5min", 300],
  ["30min", 1800],
  ["60min", 3600],
  ["extreme (10h)", 36000],
] as const) {
  test(`17-21. ${label} project: a normal viewport returns a small, bounded tick count, never proportional to the full duration`, () => {
    const t0 = performance.now();
    const ticks = computeVisibleTicks({ scrollLeft: (duration * 100) / 2, viewportWidth: 800, pxPerSec: 100, step: 1, duration });
    const elapsedMs = performance.now() - t0;
    assert.ok(ticks.length < 50, `expected a small, viewport-bounded tick count at ${label}, got ${ticks.length}`);
    assert.ok(elapsedMs < 5, `computeVisibleTicks took ${elapsedMs.toFixed(2)}ms at ${label} — must be near-instant, independent of total duration`);
  });
}

test("22. zero/invalid duration and step safety: never throws, always returns an empty array", () => {
  for (const duration of [0, -1, NaN]) {
    assert.deepEqual(computeVisibleTicks({ scrollLeft: 0, viewportWidth: 500, pxPerSec: 100, step: 1, duration }), []);
  }
  for (const step of [0, -1, NaN]) {
    assert.deepEqual(computeVisibleTicks({ scrollLeft: 0, viewportWidth: 500, pxPerSec: 100, step, duration: 100 }), []);
  }
});

test("computeVisibleTicks: deep-scroll performance stays independent of total duration (the exact 1800-caption/60-minute P19.5 fixture scenario)", () => {
  const t0 = performance.now();
  const ticks = computeVisibleTicks({ scrollLeft: 150000, viewportWidth: 586, pxPerSec: 70, step: 2, duration: 3600 });
  const elapsedMs = performance.now() - t0;
  assert.ok(ticks.length > 0 && ticks.length < 50);
  assert.ok(elapsedMs < 5);
});
