/**
 * Task 95640 (P9) — pure unit tests for the collision-safe duplicate-placement fit-check
 * (lib/subtitles/duplicate-timing.ts). Store-level integration tests (the full duplicateSubtitle/
 * duplicateSubtitles behavior, undo/redo, style/animation/word-timing preservation) live in
 * src/store/__tests__/editor-store-undo-redo.test.ts, matching this codebase's existing
 * convention of testing a pure timing helper here and its store integration there (see
 * word-timing.ts / clampWordsToCaptionBounds's own split for the same pattern).
 *
 * Run with: node --test src/lib/subtitles/__tests__/duplicate-timing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveDuplicateShift, resolveSingleDuplicateShift, resolveBlockDuplicateShift } from "../duplicate-timing.ts";

test("Case A — enough space: returns the full width as the shift", () => {
  // A: 0.0 -> 2.0, B: 3.0 -> 5.0 — 1s of room after A, only 2s needed... wait, width is 2s and
  // room is 1s here, so use a case with more than enough room to unambiguously exercise "fits".
  assert.equal(resolveDuplicateShift(0, 2, 10), 2);
});

test("Case B — zero gap: the following caption starts exactly where the original ends — rejected", () => {
  // A: 0.0 -> 2.0, B: 2.0 -> 4.0 — zero room at all.
  assert.equal(resolveDuplicateShift(0, 2, 2), null);
});

test("Case C — tight gap smaller than the required width is rejected", () => {
  // A: 0.0 -> 2.0 (width 2), B: 2.1 -> 4.0 — only 0.1s of room, nowhere near the 2s needed.
  assert.equal(resolveDuplicateShift(0, 2, 2.1), null);
});

test("Case D — the 'next' caption already overlaps the original (negative available room) — rejected, not crashed", () => {
  // Pathological/corrupted input: nextCaptionStart before blockEnd at all.
  assert.equal(resolveDuplicateShift(0, 2, 1), null);
});

test("Case E — no following caption at all (null) — always fits", () => {
  assert.equal(resolveDuplicateShift(0, 2, null), 2);
});

test("boundary: available room exactly equal to the required width fits (flush placement, not overlapping)", () => {
  // A: 0 -> 2 (width 2), next starts at exactly 4 -> room is exactly 2, matching the width exactly.
  assert.equal(resolveDuplicateShift(0, 2, 4), 2);
});

test("float-noise tolerance: room a hair under the exact width (within the 0.001s epsilon) still fits", () => {
  assert.equal(resolveDuplicateShift(0, 2, 4 - 0.0005), 2);
});

test("float-noise tolerance: room meaningfully under the exact width (beyond the epsilon) is rejected", () => {
  assert.equal(resolveDuplicateShift(0, 2, 4 - 0.01), null);
});

test("resolveSingleDuplicateShift: wraps resolveDuplicateShift using the original caption's own start/end and the next caption's start", () => {
  assert.equal(resolveSingleDuplicateShift({ start: 0, end: 2 }, { start: 10 }), 2);
  assert.equal(resolveSingleDuplicateShift({ start: 0, end: 2 }, { start: 2.05 }), null);
});

test("resolveSingleDuplicateShift: null/undefined next caption (last caption in the project) always fits", () => {
  assert.equal(resolveSingleDuplicateShift({ start: 0, end: 2 }, null), 2);
  assert.equal(resolveSingleDuplicateShift({ start: 0, end: 2 }, undefined), 2);
});

test("resolveBlockDuplicateShift: uses the FIRST caption's start and the LAST caption's end of the block, not any individual caption in between", () => {
  const block = [
    { start: 1.5, end: 2.5 },
    { start: 3, end: 4 },
  ];
  // Block width is 4 - 1.5 = 2.5 (spans the internal gap too), not the sum of each caption's own duration.
  assert.equal(resolveBlockDuplicateShift(block, { start: 10 }), 2.5);
  assert.equal(resolveBlockDuplicateShift(block, { start: 4.1 }), null); // only 0.1s room, needs 2.5s
});

test("resolveBlockDuplicateShift: no following caption always fits", () => {
  const block = [{ start: 0, end: 1 }];
  assert.equal(resolveBlockDuplicateShift(block, null), 1);
});

test("resolveBlockDuplicateShift: an empty block is rejected defensively rather than throwing", () => {
  assert.equal(resolveBlockDuplicateShift([], null), null);
});
