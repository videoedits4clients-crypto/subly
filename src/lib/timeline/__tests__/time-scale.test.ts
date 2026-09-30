/**
 * Regression tests for the shared time<->pixel mapping (src/lib/timeline/time-scale.ts) — the
 * ONE formula the timeline's click-to-seek/scrub/drag handlers and the waveform's rendering
 * both use (see components/editor/timeline.tsx's timeFromClientX and
 * components/editor/waveform.tsx), so a click on the waveform and a click anywhere else on the
 * timeline can never disagree about what time it represents.
 *
 * Run with: node --test src/lib/timeline/__tests__/time-scale.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { timeToPixels, pixelsToTime } from "../time-scale.ts";
import { effectiveCuts, isInsideCut } from "../edit-model.ts";

test("3. duration mapping: timeToPixels scales linearly with pxPerSec across the timeline's real zoom range (20-220 px/sec)", () => {
  for (const pxPerSec of [20, 70, 100, 150, 220]) {
    assert.equal(timeToPixels(0, pxPerSec), 0);
    assert.equal(timeToPixels(1, pxPerSec), pxPerSec);
    assert.equal(timeToPixels(10, pxPerSec), pxPerSec * 10);
  }
});

test("3. duration mapping: a project's full duration maps to the same total width the timeline itself computes", () => {
  const durationsToTest = [30, 60, 300, 900, 1800, 3600]; // 30s .. 60min, per the task's required durations
  for (const duration of durationsToTest) {
    for (const pxPerSec of [20, 70, 220]) {
      const expectedWidth = duration * pxPerSec;
      assert.equal(timeToPixels(duration, pxPerSec), expectedWidth);
    }
  }
});

test("4. playhead -> waveform position: the playhead's own left-offset formula and the waveform's column-time formula must place the same instant at the same pixel", () => {
  const pxPerSec = 87; // an arbitrary, non-round zoom level — the point is this isn't special-cased
  const currentTime = 12.345;
  // This IS the playhead's positioning formula (see timeline.tsx's playhead div: `left: currentTime * pxPerSec`).
  const playheadLeft = currentTime * pxPerSec;
  // This is the waveform's own mapping (see waveform.tsx computing tStart/tEnd per canvas column).
  const waveformColumnLeft = timeToPixels(currentTime, pxPerSec);
  assert.equal(playheadLeft, waveformColumnLeft);
});

test("5. waveform position -> timeline time: pixelsToTime is the exact inverse of timeToPixels at every zoom level", () => {
  for (const pxPerSec of [20, 45, 70, 130, 220]) {
    for (const time of [0, 0.5, 1, 30, 59.99, 300.123, 3599.999]) {
      const pixels = timeToPixels(time, pxPerSec);
      const roundTripped = pixelsToTime(pixels, pxPerSec);
      assert.ok(Math.abs(roundTripped - time) < 1e-9, `expected ${time}, got ${roundTripped} at ${pxPerSec}px/sec`);
    }
  }
});

test("5. a click at a given clientX (via the same rect-relative math timeline.tsx's timeFromClientX uses) resolves to the correct time", () => {
  // Mirrors timeline.tsx's timeFromClientX: (clientX - rect.left + scrollLeft) / pxPerSec
  const rectLeft = 240; // the track container's on-screen left edge
  const scrollLeft = 500; // horizontal scroll already applied
  const pxPerSec = 100;
  const clientX = 340; // where the user actually clicked on screen

  const time = pixelsToTime(clientX - rectLeft + scrollLeft, pxPerSec);
  assert.equal(time, (340 - 240 + 500) / 100);
});

test("6. trim/cut compatibility: a time inside a trimmed-away region is correctly identified via the same cuts the waveform's dimming overlay uses", () => {
  const duration = 120;
  const cuts = effectiveCuts(10, 100, duration, []); // trimmed to [10, 100] -> [0,10) and [100,120) are cut
  assert.ok(isInsideCut(5, cuts), "time before trimStart must be inside a cut");
  assert.ok(isInsideCut(110, cuts), "time after trimEnd must be inside a cut");
  assert.equal(isInsideCut(50, cuts), null, "time within the kept range must not be inside a cut");

  // The waveform's dimming overlay positions itself with the exact same timeToPixels calls the
  // rest of the timeline uses (see timeline.tsx's waveform-row overlays) — verify the pixel
  // span of a cut matches what timeToPixels would place it at.
  const trimEndCut = cuts.find((c) => c.start === 100);
  assert.ok(trimEndCut);
  const pxPerSec = 50;
  const left = timeToPixels(trimEndCut!.start, pxPerSec);
  const width = timeToPixels(trimEndCut!.end - trimEndCut!.start, pxPerSec);
  assert.equal(left, 5000);
  assert.equal(width, 1000);
});

test("6. trim/cut compatibility: a manual cut range in the middle of the timeline is correctly excluded from the kept/visible waveform area", () => {
  const duration = 60;
  const cuts = effectiveCuts(0, null, duration, [{ id: "c1", start: 20, end: 25, reason: "manual" }]);
  assert.ok(isInsideCut(22, cuts));
  assert.equal(isInsideCut(19.9, cuts), null);
  assert.equal(isInsideCut(25.1, cuts), null);
});
