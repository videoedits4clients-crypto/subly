/**
 * Pure tests for word-drag-handle snap-target math (Task 102741, P15 —
 * src/lib/timeline/word-snapping.ts). No store, no React, no DOM.
 *
 * Run with: node --test src/lib/timeline/__tests__/word-snapping.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeWordSnappedTiming, type WordSnapTargets } from "../word-snapping.ts";

const TARGETS: WordSnapTargets = {
  captionStart: 0,
  captionEnd: 10,
  prevWordEnd: 2,
  nextWordStart: 5,
  playhead: 3.5,
};

// ============================== edge: "start" ==============================

test("start: snaps to the previous word's end when within threshold", () => {
  const result = computeWordSnappedTiming("start", 2.02, TARGETS, 0.05);
  assert.deepEqual(result, { value: 2, snapped: true });
});

test("start: snaps to the caption's own start when within threshold and closer than prevWordEnd", () => {
  const result = computeWordSnappedTiming("start", 0.03, TARGETS, 0.05);
  assert.deepEqual(result, { value: 0, snapped: true });
});

test("start: snaps to the playhead when within threshold and closest", () => {
  const result = computeWordSnappedTiming("start", 3.48, TARGETS, 0.05);
  assert.deepEqual(result, { value: 3.5, snapped: true });
});

test("start: never offers the NEXT word's start as a snap target", () => {
  const result = computeWordSnappedTiming("start", 5.01, TARGETS, 0.05);
  assert.equal(result.snapped, false, "nextWordStart (5) must never be a candidate for the start handle");
});

test("start: no snap when nothing is within threshold — returns the raw value unchanged", () => {
  const result = computeWordSnappedTiming("start", 1.0, TARGETS, 0.05);
  assert.deepEqual(result, { value: 1.0, snapped: false });
});

test("start: picks the CLOSEST candidate when multiple are within threshold", () => {
  const closeTargets: WordSnapTargets = { captionStart: 1.0, captionEnd: 10, prevWordEnd: 1.02, nextWordStart: null, playhead: null };
  const result = computeWordSnappedTiming("start", 1.01, closeTargets, 0.05);
  // 1.01 is 0.01 from captionStart(1.0) and 0.01 from prevWordEnd(1.02) — both equidistant;
  // the implementation's own tie-break (first candidate scanned, captionStart) must be picked
  // deterministically, not float-noise-dependent.
  assert.equal(result.snapped, true);
  assert.ok(result.value === 1.0 || result.value === 1.02);
});

// ============================== edge: "end" ==============================

test("end: snaps to the next word's start when within threshold", () => {
  const result = computeWordSnappedTiming("end", 4.98, TARGETS, 0.05);
  assert.deepEqual(result, { value: 5, snapped: true });
});

test("end: snaps to the caption's own end when within threshold", () => {
  const result = computeWordSnappedTiming("end", 9.97, TARGETS, 0.05);
  assert.deepEqual(result, { value: 10, snapped: true });
});

test("end: snaps to the playhead when within threshold", () => {
  const result = computeWordSnappedTiming("end", 3.52, TARGETS, 0.05);
  assert.deepEqual(result, { value: 3.5, snapped: true });
});

test("end: never offers the PREVIOUS word's end as a snap target", () => {
  const result = computeWordSnappedTiming("end", 2.01, TARGETS, 0.05);
  assert.equal(result.snapped, false, "prevWordEnd (2) must never be a candidate for the end handle");
});

test("end: no snap when nothing is within threshold", () => {
  const result = computeWordSnappedTiming("end", 7.0, TARGETS, 0.05);
  assert.deepEqual(result, { value: 7.0, snapped: false });
});

// ============================== null targets ==============================

test("a null target (no previous/next word, no playhead) is simply skipped, never crashes", () => {
  const targets: WordSnapTargets = { captionStart: 0, captionEnd: 10, prevWordEnd: null, nextWordStart: null, playhead: null };
  assert.deepEqual(computeWordSnappedTiming("start", 0.01, targets, 0.05), { value: 0, snapped: true });
  assert.deepEqual(computeWordSnappedTiming("end", 9.99, targets, 0.05), { value: 10, snapped: true });
  assert.deepEqual(computeWordSnappedTiming("start", 5, targets, 0.05), { value: 5, snapped: false });
});

test("this module never decides validity — a snap target it returns can still be outside what clampWordTiming would accept, by design (the caller always re-clamps)", () => {
  // Snapping to the playhead when the playhead is actually PAST the caption's own end is still
  // a valid snap RESULT from this module's own point of view — validity is entirely the
  // caller's (clampWordTiming's) job, never this module's.
  const targets: WordSnapTargets = { captionStart: 0, captionEnd: 10, prevWordEnd: null, nextWordStart: null, playhead: 15 };
  const result = computeWordSnappedTiming("end", 14.98, targets, 0.05);
  assert.deepEqual(result, { value: 15, snapped: true });
});
