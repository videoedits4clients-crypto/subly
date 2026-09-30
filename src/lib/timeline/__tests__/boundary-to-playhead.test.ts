import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBoundaryToPlayhead, type BoundaryToPlayheadInput } from "../boundary-to-playhead.ts";

const BASE: BoundaryToPlayheadInput = {
  captionStart: 10,
  captionEnd: 15,
  playheadTime: 0,
  prevEnd: null,
  nextStart: null,
  minDurationSec: 0.1,
};

function input(overrides: Partial<BoundaryToPlayheadInput>): BoundaryToPlayheadInput {
  return { ...BASE, ...overrides };
}

// ============================== edge: "start" ==============================

test("start: playhead inside the caption moves start there, preserving end", () => {
  const result = resolveBoundaryToPlayhead("start", input({ playheadTime: 12 }));
  assert.deepEqual(result, { start: 12, end: 15 });
});

test("start: rejects when playhead is already exactly at the current start (no-op)", () => {
  assert.equal(resolveBoundaryToPlayhead("start", input({ playheadTime: 10 })), null);
});

test("start: rejects a negative playhead time", () => {
  assert.equal(resolveBoundaryToPlayhead("start", input({ playheadTime: -1 })), null);
});

test("start: rejects when it would land before the previous caption's own end (overlap)", () => {
  assert.equal(resolveBoundaryToPlayhead("start", input({ playheadTime: 8, prevEnd: 9 })), null);
});

test("start: accepts exactly at the previous caption's end (flush, not overlapping)", () => {
  const result = resolveBoundaryToPlayhead("start", input({ playheadTime: 9, prevEnd: 9 }));
  assert.deepEqual(result, { start: 9, end: 15 });
});

test("start: rejects when it would violate the minimum caption duration", () => {
  assert.equal(resolveBoundaryToPlayhead("start", input({ playheadTime: 14.95, minDurationSec: 0.1 })), null);
});

test("start: accepts exactly at the minimum-duration boundary", () => {
  const result = resolveBoundaryToPlayhead("start", input({ playheadTime: 14.9, minDurationSec: 0.1 }));
  assert.deepEqual(result, { start: 14.9, end: 15 });
});

test("start: rejects when playhead is past the caption's own end entirely", () => {
  assert.equal(resolveBoundaryToPlayhead("start", input({ playheadTime: 20 })), null);
});

test("start: accepts when there is no previous caption (prevEnd null) and playhead is at 0", () => {
  const result = resolveBoundaryToPlayhead("start", input({ playheadTime: 0, prevEnd: null }));
  assert.deepEqual(result, { start: 0, end: 15 });
});

// ============================== edge: "end" ==============================

test("end: playhead inside the caption moves end there, preserving start", () => {
  const result = resolveBoundaryToPlayhead("end", input({ playheadTime: 13 }));
  assert.deepEqual(result, { start: 10, end: 13 });
});

test("end: rejects when playhead is already exactly at the current end (no-op)", () => {
  assert.equal(resolveBoundaryToPlayhead("end", input({ playheadTime: 15 })), null);
});

test("end: rejects when it would land after the next caption's own start (overlap)", () => {
  assert.equal(resolveBoundaryToPlayhead("end", input({ playheadTime: 17, nextStart: 16 })), null);
});

test("end: accepts exactly at the next caption's start (flush, not overlapping)", () => {
  const result = resolveBoundaryToPlayhead("end", input({ playheadTime: 16, nextStart: 16 }));
  assert.deepEqual(result, { start: 10, end: 16 });
});

test("end: rejects when it would violate the minimum caption duration", () => {
  assert.equal(resolveBoundaryToPlayhead("end", input({ playheadTime: 10.05, minDurationSec: 0.1 })), null);
});

test("end: accepts exactly at the minimum-duration boundary", () => {
  const result = resolveBoundaryToPlayhead("end", input({ playheadTime: 10.1, minDurationSec: 0.1 }));
  assert.deepEqual(result, { start: 10, end: 10.1 });
});

test("end: rejects when playhead is before the caption's own start entirely", () => {
  assert.equal(resolveBoundaryToPlayhead("end", input({ playheadTime: 5 })), null);
});

test("end: accepts when there is no next caption (nextStart null)", () => {
  const result = resolveBoundaryToPlayhead("end", input({ playheadTime: 100, nextStart: null }));
  assert.deepEqual(result, { start: 10, end: 100 });
});
