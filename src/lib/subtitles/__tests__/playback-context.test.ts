import { test } from "node:test";
import assert from "node:assert/strict";
import { isTimeWithinCaption, findActiveCaption, findActiveWordIndex } from "../playback-context.ts";

function cap(start: number, end: number) {
  return { start, end };
}
function word(start: number, end: number) {
  return { start, end };
}

// ============================== isTimeWithinCaption / findActiveCaption ==============================

test("isTimeWithinCaption: true inside [start, end)", () => {
  assert.equal(isTimeWithinCaption(cap(1, 2), 1), true);
  assert.equal(isTimeWithinCaption(cap(1, 2), 1.5), true);
});

test("isTimeWithinCaption: end is exclusive", () => {
  assert.equal(isTimeWithinCaption(cap(1, 2), 2), false);
});

test("isTimeWithinCaption: false before start", () => {
  assert.equal(isTimeWithinCaption(cap(1, 2), 0.999), false);
});

test("findActiveCaption: finds the caption whose range contains the time", () => {
  const subs = [cap(0, 1), cap(1, 2), cap(3, 4)];
  assert.equal(findActiveCaption(subs, 1.5), subs[1]);
});

test("findActiveCaption: undefined in a gap between captions", () => {
  const subs = [cap(0, 1), cap(3, 4)];
  assert.equal(findActiveCaption(subs, 2), undefined);
});

test("findActiveCaption: undefined before the first / after the last caption", () => {
  const subs = [cap(1, 2), cap(3, 4)];
  assert.equal(findActiveCaption(subs, 0), undefined);
  assert.equal(findActiveCaption(subs, 5), undefined);
});

test("findActiveCaption: empty list returns undefined", () => {
  assert.equal(findActiveCaption([], 5), undefined);
});

test("findActiveCaption: overlapping (malformed/legacy) data — first in array order wins, not a new rule", () => {
  // The app always keeps subtitles sorted by start (editor-store.ts's own invariant), so "first
  // in array order" and "earliest start" are the same thing here — matching Array.prototype.find
  // semantics, exactly what video-canvas.tsx's own pre-existing lookup already did.
  const subs = [cap(0, 5), cap(2, 3)]; // the second caption is entirely inside the first (legacy/malformed overlap)
  assert.equal(findActiveCaption(subs, 2.5), subs[0]);
});

// ============================== findActiveWordIndex ==============================

test("findActiveWordIndex: finds the word whose range contains the time", () => {
  const words = [word(0, 1), word(1, 2), word(2, 3)];
  assert.equal(findActiveWordIndex(words, 1.5), 1);
});

test("findActiveWordIndex: end is exclusive", () => {
  const words = [word(0, 1), word(1, 2)];
  assert.equal(findActiveWordIndex(words, 1), 1);
  assert.equal(findActiveWordIndex(words, 2), null);
});

test("findActiveWordIndex: null in a gap between words", () => {
  const words = [word(0, 1), word(2, 3)];
  assert.equal(findActiveWordIndex(words, 1.5), null);
});

test("findActiveWordIndex: null (not -1) when nothing matches — matches selectedWordIndex's own convention", () => {
  assert.equal(findActiveWordIndex([], 5), null);
  assert.equal(findActiveWordIndex([word(0, 1)], 10), null);
});

test("findActiveWordIndex: first matching index wins for overlapping/malformed word data", () => {
  const words = [word(0, 3), word(1, 2)];
  assert.equal(findActiveWordIndex(words, 1.5), 0);
});
