/**
 * Regression tests for timeline caption-drag snapping (Task 91342, P7.1 — src/lib/timeline/snapping.ts).
 * Pure math only — no DOM, no store, no React. The store's own overlap-prevention clamp
 * (updateSubtitleTiming, editor-store.ts) is exercised separately by its own existing tests
 * (editor-store-undo-redo.test.ts, tests 3b/3c/3d) and is NOT re-implemented or duplicated here —
 * per the task's own "the timeline must never duplicate the store's overlap rules" instruction,
 * this module only ever proposes a (start, end); it has no concept of what's "valid."
 *
 * Run with: node --test src/lib/timeline/__tests__/snapping.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeSnappedTiming, type SnapTargets } from "../snapping.ts";

const THRESHOLD = 0.1; // seconds — stands in for pixelsToTime(SNAP_THRESHOLD_PX, pxPerSec) in these pure tests

test("1. caption edge (start, left-edge resize) snaps to the previous caption's end when within threshold", () => {
  const targets: SnapTargets = { prevEnd: 10.0, nextStart: null, playhead: 50 };
  const result = computeSnappedTiming("start", 10.05, 12, targets, THRESHOLD);
  assert.equal(result.start, 10.0);
  assert.equal(result.end, 12, "only the dragged edge (start) may move on an edge resize");
  assert.equal(result.snappedEdge, "start");
  assert.equal(result.snapTime, 10.0);
});

test("2. caption edge (end, right-edge resize) snaps to the next caption's start when within threshold", () => {
  const targets: SnapTargets = { prevEnd: null, nextStart: 20.0, playhead: 50 };
  const result = computeSnappedTiming("end", 8, 19.96, targets, THRESHOLD);
  assert.equal(result.start, 8, "only the dragged edge (end) may move on an edge resize");
  assert.equal(result.end, 20.0);
  assert.equal(result.snappedEdge, "end");
});

test("3. caption edge snaps to the playhead", () => {
  const targets: SnapTargets = { prevEnd: null, nextStart: null, playhead: 15.0 };
  const startResult = computeSnappedTiming("start", 15.07, 20, targets, THRESHOLD);
  assert.equal(startResult.start, 15.0);
  assert.equal(startResult.snappedEdge, "start");

  const endResult = computeSnappedTiming("end", 5, 15.03, targets, THRESHOLD);
  assert.equal(endResult.end, 15.0);
  assert.equal(endResult.snappedEdge, "end");
});

test("4. outside the threshold, nothing snaps — the continuous drag position passes through unchanged", () => {
  const targets: SnapTargets = { prevEnd: 10.0, nextStart: 20.0, playhead: 15.0 };
  const result = computeSnappedTiming("start", 10.5, 12, targets, THRESHOLD); // 0.5s away, threshold is 0.1s
  assert.equal(result.start, 10.5);
  assert.equal(result.end, 12);
  assert.equal(result.snappedEdge, null);
  assert.equal(result.snapTime, null);
});

test("5. snapping never decides validity — a snap target that would itself be invalid (e.g. crossing the neighbor) is still just a proposal for updateSubtitleTiming's own clamp to accept or reject", () => {
  // This module has no min-duration or overlap concept at all — proven by construction: it will
  // happily "snap" end BELOW start if asked to, because policing that is explicitly NOT this
  // module's job (see the module's own doc comment on the required drag -> snap -> clamp flow).
  const targets: SnapTargets = { prevEnd: null, nextStart: 5.0, playhead: null };
  const result = computeSnappedTiming("end", 8, 5.05, targets, THRESHOLD);
  assert.equal(result.end, 5.0);
  assert.ok(result.end < 8, "the snapped end is now before the (unmoved) start — this module does not prevent that; the caller's existing clamp must");
});

test("6. respects minimum duration indirectly: this module doesn't enforce it, confirming the responsibility stays with the existing store clamp, not a duplicate rule here", () => {
  const targets: SnapTargets = { prevEnd: null, nextStart: 10.02, playhead: null };
  const result = computeSnappedTiming("end", 9.95, 10.0, targets, THRESHOLD);
  // Snaps end to 10.02 even though that leaves only a 0.07s (start=9.95) gap — well under any
  // real minimum-duration rule. This module has no opinion on that; it's exactly why the task's
  // required flow always routes the result through updateSubtitleTiming() afterward.
  assert.equal(result.end, 10.02);
});

test("7. body (move) drag preserves the caption's exact duration when a snap applies", () => {
  const targets: SnapTargets = { prevEnd: 10.0, nextStart: null, playhead: null };
  const originalDuration = 15 - 12; // 3s
  const result = computeSnappedTiming("move", 10.04, 13.04, targets, THRESHOLD);
  assert.equal(result.start, 10.0);
  assert.equal(result.end, 13.0);
  assert.equal(result.end - result.start, originalDuration, "duration must be preserved exactly by translating both edges by the same delta");
});

test("7b. body (move) drag: when both edges have a qualifying target, the CLOSER one wins and both edges shift by its delta", () => {
  // start is 0.02s from prevEnd (closer); end is 0.08s from nextStart (further, but still within threshold).
  const targets: SnapTargets = { prevEnd: 10.0, nextStart: 20.08, playhead: null };
  const result = computeSnappedTiming("move", 10.02, 20.0, targets, THRESHOLD);
  assert.equal(result.snappedEdge, "start", "start's snap distance (0.02) is smaller than end's (0.08)");
  assert.equal(result.start, 10.0);
  assert.equal(result.end, 20.0 + (10.0 - 10.02), "end shifts by the SAME delta that resolved start's snap");
});

test("8. left-edge resize only ever changes start, never end", () => {
  const targets: SnapTargets = { prevEnd: 4.99, nextStart: null, playhead: 4.99 };
  const result = computeSnappedTiming("start", 5.0, 12.3456, targets, THRESHOLD);
  assert.equal(result.end, 12.3456, "end must be byte-identical to the input — untouched");
});

test("9. right-edge resize only ever changes end, never start", () => {
  const targets: SnapTargets = { prevEnd: null, nextStart: 30.01, playhead: 30.01 };
  const result = computeSnappedTiming("end", 4.3456, 30.0, targets, THRESHOLD);
  assert.equal(result.start, 4.3456, "start must be byte-identical to the input — untouched");
});

test("10. a caption is never snapped against itself — prevEnd/nextStart represent only genuinely adjacent neighbors by construction (the caller never passes the dragged caption's own values)", () => {
  // This is really a caller-contract test: if the caller accidentally passed the dragged
  // caption's OWN current end as `prevEnd` (a self-snap bug), this module would happily snap to
  // it — proving the "don't snap to self" guarantee has to come from timeline.tsx's own
  // neighbor lookup (see startDrag), not from this module refusing a suspicious-looking target.
  // Documented here as the explicit boundary of this module's responsibility.
  const ownCurrentStart = 10.0;
  const targets: SnapTargets = { prevEnd: null, nextStart: null, playhead: null };
  const result = computeSnappedTiming("start", ownCurrentStart + 0.01, 15, targets, THRESHOLD);
  assert.equal(result.snappedEdge, null, "with no external targets supplied, there is nothing to snap to — confirms self-snapping can only happen if the CALLER wrongly supplies its own value as a target");
});

test("11. no targets at all (first/only caption, no playhead) never snaps", () => {
  const targets: SnapTargets = { prevEnd: null, nextStart: null, playhead: null };
  const moveResult = computeSnappedTiming("move", 5.0, 8.0, targets, THRESHOLD);
  assert.deepEqual(moveResult, { start: 5.0, end: 8.0, snappedEdge: null, snapTime: null });
});

test("12. exactly-at-threshold distance still snaps (inclusive boundary, matches other clamp conventions in this codebase)", () => {
  const targets: SnapTargets = { prevEnd: 10.0, nextStart: null, playhead: null };
  const result = computeSnappedTiming("start", 10.1, 15, targets, THRESHOLD); // distance === THRESHOLD exactly
  assert.equal(result.start, 10.0);
});
