/**
 * Automated tests for "Split Here" (lib/subtitles/split.ts): splitting one caption into two AT
 * A TIME, preserving every word's original timestamp, and — Task 114761 (P18.7) — safe against
 * both a word straddling the split point and a non-monotonic (P18.6-reordered) word array.
 *
 * Run with: node --test src/lib/subtitles/__tests__/split.test.ts
 * (or the "test:segmentation" package.json script, which runs this alongside segment.test.ts)
 *
 * Undo/redo after a split is NOT covered here: splitSubtitleAt is a pure function with no
 * knowledge of history, and the store wires it through the same commit()/undo()/redo()
 * machinery every other editing action already uses (see editor-store.ts) — that machinery
 * isn't specific to splitting, so it's exercised via a dedicated store-level test
 * (editor-store-split-merge.test.ts) instead of here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { splitSubtitleAt } from "../split.ts";
import { DEFAULT_TIMING_RULES } from "../../../types/subtitle.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

function words(texts: string[]): Word[] {
  let t = 0;
  return texts.map((text) => {
    const start = t;
    const end = start + 0.4;
    t = end;
    return { text, start, end };
  });
}

function makeSubtitle(texts: string[]): Subtitle {
  const w = words(texts);
  return { id: "sub1", index: 0, start: w[0].start, end: w[w.length - 1].end, text: texts.join(" "), words: w };
}

// ============================== basic split-at-a-time behavior ==============================

test("splitSubtitleAt: creates exactly two captions, partitioned by time, at an exact word boundary", () => {
  const original = makeSubtitle(["se", "pach", "kolko", "ko", "lane", "ke", "lie", "par", "usv", "charee"]);
  // 10 words, each 0.4s, boundary between word 4 ("lane", ends 2.0) and word 5 ("ke", starts 2.0) is t=2.0.
  const result = splitSubtitleAt(original, 2.0, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.left.words.map((w) => w.text).join(" "), "se pach kolko ko lane");
  assert.equal(result.right.words.map((w) => w.text).join(" "), "ke lie par usv charee");
});

test("splitSubtitleAt: every word keeps its exact original start/end timestamp, never regenerated", () => {
  const original = makeSubtitle(["one", "two", "three", "four"]); // boundary between word 1/2 is t=0.8
  const originalTimestamps = original.words.map((w) => ({ start: w.start, end: w.end }));
  const result = splitSubtitleAt(original, 0.8, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const rejoined = [...result.left.words, ...result.right.words];
  rejoined.forEach((w, i) => {
    assert.equal(w.start, originalTimestamps[i].start);
    assert.equal(w.end, originalTimestamps[i].end);
  });
});

test("splitSubtitleAt: caption boundaries come from the split point and the ORIGINAL caption's own bounds — never derived from a word's own timing", () => {
  const original = makeSubtitle(["one", "two", "three", "four"]);
  const result = splitSubtitleAt(original, 0.8, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.left.start, original.start, "left.start is the ORIGINAL caption's start");
  assert.equal(result.left.end, 0.8, "left.end is exactly the split point");
  assert.equal(result.right.start, 0.8, "right.start is exactly the split point");
  assert.equal(result.right.end, original.end, "right.end is the ORIGINAL caption's end");
});

test("splitSubtitleAt: preserves the original caption's id on the left half, and its style/animation on both halves", () => {
  const original: Subtitle = {
    ...makeSubtitle(["one", "two", "three", "four"]),
    style: { color: "#FF0000" },
    animation: { entrance: "pop" },
  };
  const result = splitSubtitleAt(original, 0.8, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.left.id, original.id);
  assert.notEqual(result.right.id, original.id);
  assert.deepEqual(result.left.style, { color: "#FF0000" });
  assert.deepEqual(result.right.style, { color: "#FF0000" });
  assert.deepEqual(result.left.animation, { entrance: "pop" });
  assert.deepEqual(result.right.animation, { entrance: "pop" });
});

// ============================== rejection: invalid time ==============================

test("splitSubtitleAt: rejects a split time at or before the caption's own start", () => {
  const original = makeSubtitle(["one", "two", "three"]);
  const atStart = splitSubtitleAt(original, original.start, DEFAULT_TIMING_RULES);
  assert.equal(atStart.ok, false);
  if (!atStart.ok) assert.equal(atStart.reason, "invalid-time");
  const beforeStart = splitSubtitleAt(original, original.start - 1, DEFAULT_TIMING_RULES);
  assert.equal(beforeStart.ok, false);
});

test("splitSubtitleAt: rejects a split time at or after the caption's own end", () => {
  const original = makeSubtitle(["one", "two", "three"]);
  const atEnd = splitSubtitleAt(original, original.end, DEFAULT_TIMING_RULES);
  assert.equal(atEnd.ok, false);
  if (!atEnd.ok) assert.equal(atEnd.reason, "invalid-time");
  const afterEnd = splitSubtitleAt(original, original.end + 1, DEFAULT_TIMING_RULES);
  assert.equal(afterEnd.ok, false);
});

test("splitSubtitleAt: rejects NaN/Infinity split times", () => {
  const original = makeSubtitle(["one", "two", "three"]);
  assert.equal(splitSubtitleAt(original, NaN, DEFAULT_TIMING_RULES).ok, false);
  assert.equal(splitSubtitleAt(original, Infinity, DEFAULT_TIMING_RULES).ok, false);
});

// ============================== rejection: word straddles the split point ==============================

test("splitSubtitleAt: rejects (does not guess, does not cut the word) when the split time falls INSIDE a word's own span", () => {
  const original = makeSubtitle(["one", "two", "three", "four"]); // "two" spans [0.4, 0.8)
  const result = splitSubtitleAt(original, 0.6, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "word-straddles-split");
    assert.equal(result.straddlingWord?.text, "two");
  }
});

test("splitSubtitleAt: a split time exactly AT a word's own start or end is a clean boundary, not a straddle", () => {
  const original = makeSubtitle(["one", "two", "three", "four"]); // "two" is exactly [0.4, 0.8)
  const atStart = splitSubtitleAt(original, 0.4, DEFAULT_TIMING_RULES); // "two"'s own start
  assert.equal(atStart.ok, true);
  const atEnd = splitSubtitleAt(original, 0.8, DEFAULT_TIMING_RULES); // "two"'s own end
  assert.equal(atEnd.ok, true);
});

// ============================== rejection: empty side ==============================

test("splitSubtitleAt: rejects a split that would leave one side with zero words", () => {
  // A caption with a real gap between its own bounds and its first word — start=0, first word at 5.
  const original: Subtitle = {
    id: "s",
    index: 0,
    start: 0,
    end: 10,
    text: "one two",
    words: [
      { text: "one", start: 5, end: 5.4 },
      { text: "two", start: 5.4, end: 5.8 },
    ],
  };
  const result = splitSubtitleAt(original, 2, DEFAULT_TIMING_RULES); // before every word
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "empty-side");
});

// ============================== non-mutation ==============================

test("splitSubtitleAt: never mutates the input caption or its words", () => {
  const original = makeSubtitle(["one", "two", "three", "four"]);
  const wordsRef = original.words;
  splitSubtitleAt(original, 0.8, DEFAULT_TIMING_RULES);
  assert.equal(original.words, wordsRef);
  assert.equal(original.words.length, 4);
});

// ============================== Task 114761 (P18.7): non-monotonic word order (P18.6) ==============================

function nonMonotonicSubtitle(): Subtitle {
  // Array/textual order: BRAVO, CHARLIE, DELTA, ALFA — chronological order: ALFA, BRAVO, CHARLIE, DELTA.
  const w: Word[] = [
    { text: "BRAVO", start: 2.0, end: 3.0 },
    { text: "CHARLIE", start: 3.5, end: 4.5 },
    { text: "DELTA", start: 5.0, end: 6.0 },
    { text: "ALFA", start: 0.5, end: 1.5 },
  ];
  return { id: "nm", index: 0, start: 0.5, end: 6.0, text: "BRAVO CHARLIE DELTA ALFA", words: w };
}

test("P18.7: non-monotonic caption — split at a time that separates by ACTUAL TIMESTAMP, not array position", () => {
  const original = nonMonotonicSubtitle();
  // t=1.75 is after ALFA (0.5-1.5) and before BRAVO (2.0-3.0) chronologically — only ALFA is
  // "entirely before" 1.75; BRAVO/CHARLIE/DELTA are all "entirely at/after" it, regardless of
  // ALFA sitting LAST in the array.
  const result = splitSubtitleAt(original, 1.75, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.left.words.map((w) => w.text), ["ALFA"], "only the chronologically-earlier word, despite being textually LAST");
  assert.deepEqual(result.right.words.map((w) => w.text), ["BRAVO", "CHARLIE", "DELTA"], "existing relative array order preserved, NOT re-sorted");
});

test("P18.7: non-monotonic caption — a split that would produce an INVERTED caption under the OLD array-slice algorithm now either succeeds correctly or is safely rejected, never inverted", () => {
  const original = nonMonotonicSubtitle();
  // Splitting at t=4.75 (between CHARLIE and DELTA chronologically): LEFT gets everything
  // entirely before 4.75 (ALFA, BRAVO, CHARLIE), RIGHT gets DELTA. Under the OLD word-index
  // implementation, slicing this 4-word array at index 2 would have put [BRAVO, CHARLIE] on the
  // left (start=2.0, end=4.5) and [DELTA, ALFA] on the right — right.start=5.0, right.end=1.5,
  // an INVERTED, negative-duration caption. The new time-based partition cannot produce that.
  const result = splitSubtitleAt(original, 4.75, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.left.words.map((w) => w.text), ["BRAVO", "CHARLIE", "ALFA"], "array order preserved among left-side words");
  assert.deepEqual(result.right.words.map((w) => w.text), ["DELTA"]);
  assert.ok(result.left.end > result.left.start, "left caption is never inverted");
  assert.ok(result.right.end > result.right.start, "right caption is never inverted");
  assert.equal(result.left.end, 4.75);
  assert.equal(result.right.start, 4.75);
});

test("P18.7: non-monotonic caption — split exactly at a word's own boundary succeeds cleanly", () => {
  const original = nonMonotonicSubtitle();
  const result = splitSubtitleAt(original, 5.0, DEFAULT_TIMING_RULES); // DELTA's own start
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.left.words.map((w) => w.text), ["BRAVO", "CHARLIE", "ALFA"]);
  assert.deepEqual(result.right.words.map((w) => w.text), ["DELTA"]);
});

test("P18.7: non-monotonic caption — split time landing inside a word (array-last or not) is rejected, not guessed", () => {
  const original = nonMonotonicSubtitle();
  const result = splitSubtitleAt(original, 1.0, DEFAULT_TIMING_RULES); // inside ALFA's own 0.5-1.5 span
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "word-straddles-split");
    assert.equal(result.straddlingWord?.text, "ALFA", "correctly identifies ALFA as straddling, even though it's the LAST array element");
  }
});
