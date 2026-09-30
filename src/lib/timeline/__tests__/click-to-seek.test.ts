/**
 * Task 124572 (P19.4) — pure tests for timeline click-to-seek/scrub's own x -> time mapping.
 * `timeFromClientX` itself lives inline in timeline.tsx (a thin wrapper combining
 * `pixelsToTime`, P7.1, with `clampTimelineTime`, P19.3) — this replicates its exact formula
 * without requiring it to be exported first, the same "test a component's own inline arithmetic
 * directly" precedent already used for this file's zoom min/max clamp (fit-view.test.ts) and the
 * waveform's own canvas-sizing formula (long-timeline-performance.test.ts). No React, no DOM.
 *
 * Run with: node --test src/lib/timeline/__tests__/click-to-seek.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pixelsToTime } from "../time-scale.ts";
import { clampTimelineTime } from "../timecode.ts";

/** Mirrors timeline.tsx's own `timeFromClientX`: a raw x-offset (already relative to the track's
 * own left edge, scrollLeft already added) -> seconds, via the canonical pixelsToTime, then
 * clamped to [0, duration] via the SAME clampTimelineTime the "Go to time" input already uses. */
function timeFromOffsetX(offsetX: number, pxPerSec: number, duration: number): number {
  return clampTimelineTime(pixelsToTime(offsetX, pxPerSec), duration);
}

const DURATION = 12;
const DEFAULT_PX_PER_SEC = 70;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 220;

test("1. click-to-seek mapping: a mid-track offset resolves to the expected time", () => {
  assert.equal(timeFromOffsetX(350, DEFAULT_PX_PER_SEC, DURATION), 5);
});

test("2. t=0 clamp: an offset at or before the track's own left edge never goes negative", () => {
  assert.equal(timeFromOffsetX(0, DEFAULT_PX_PER_SEC, DURATION), 0);
  assert.equal(timeFromOffsetX(-50, DEFAULT_PX_PER_SEC, DURATION), 0);
});

test("3. duration clamp: an offset past the track's own visual width never exceeds duration", () => {
  // The track's own rendered width floors at 800px even when duration*pxPerSec is smaller (see
  // timeline.tsx's own `width = Math.max(800, duration * pxPerSec)`) — at MIN_PX_PER_SEC, a 12s
  // project is only 240px of "real" track (12*20), well inside that 800px floor, so clicking
  // anywhere in the trailing 560px of empty space must still land on exactly `duration`, never
  // past it.
  assert.equal(timeFromOffsetX(500, MIN_PX_PER_SEC, DURATION), DURATION);
  assert.equal(timeFromOffsetX(100000, DEFAULT_PX_PER_SEC, DURATION), DURATION);
});

test("4. fractional-time seek: a non-round offset produces a non-round, exact time", () => {
  const t = timeFromOffsetX(123, DEFAULT_PX_PER_SEC, DURATION);
  assert.ok(Math.abs(t - 123 / 70) < 1e-9);
});

test("17. min zoom: mapping stays correct and clamped at MIN_PX_PER_SEC", () => {
  assert.equal(timeFromOffsetX(240, MIN_PX_PER_SEC, DURATION), DURATION); // 240/20=12, at the edge
  assert.equal(timeFromOffsetX(200, MIN_PX_PER_SEC, DURATION), 10);
});

test("18. max zoom: mapping stays correct and clamped at MAX_PX_PER_SEC", () => {
  assert.equal(timeFromOffsetX(1100, MAX_PX_PER_SEC, DURATION), 5);
  assert.equal(timeFromOffsetX(5000, MAX_PX_PER_SEC, DURATION), DURATION); // far past the track, still clamped
});

test("19. caption boundary: an offset exactly at a caption's own start/end resolves to that exact time", () => {
  // Caption at [1.75, 6.00] (the disposable QA fixture's own BRAVO CHARLIE DELTA caption).
  assert.equal(timeFromOffsetX(1.75 * DEFAULT_PX_PER_SEC, DEFAULT_PX_PER_SEC, DURATION), 1.75);
  assert.equal(timeFromOffsetX(6.0 * DEFAULT_PX_PER_SEC, DEFAULT_PX_PER_SEC, DURATION), 6.0);
});

test("20. word boundary (non-monotonic fixture): an offset at a word's own start/end resolves exactly, independent of array position", () => {
  // CHARLIE is chronologically the MIDDLE word (3.5-4.5) despite being LAST in the words array —
  // the x->time mapping itself has no notion of "words" at all, so it's trivially safe here: it
  // maps a pixel offset to a time, full stop. This test exists to make that explicit for the
  // exact boundary values this task calls out.
  assert.equal(timeFromOffsetX(3.5 * DEFAULT_PX_PER_SEC, DEFAULT_PX_PER_SEC, DURATION), 3.5);
  assert.equal(timeFromOffsetX(4.5 * DEFAULT_PX_PER_SEC, DEFAULT_PX_PER_SEC, DURATION), 4.5);
});

test("no NaN/negative/stuck values for adversarial offsets", () => {
  for (const offsetX of [NaN, -Infinity, Infinity, -1, 0, 1e9]) {
    for (const pxPerSec of [MIN_PX_PER_SEC, DEFAULT_PX_PER_SEC, MAX_PX_PER_SEC]) {
      const t = timeFromOffsetX(offsetX, pxPerSec, DURATION);
      assert.ok(Number.isFinite(t), `expected finite time for offsetX=${offsetX}, pxPerSec=${pxPerSec}, got ${t}`);
      assert.ok(t >= 0 && t <= DURATION, `expected [0, ${DURATION}], got ${t}`);
    }
  }
});

test("duration unavailable (0/negative/NaN) clamps to exactly 0 rather than guessing", () => {
  for (const duration of [0, -1, NaN]) {
    assert.equal(timeFromOffsetX(500, DEFAULT_PX_PER_SEC, duration), 0);
  }
});
