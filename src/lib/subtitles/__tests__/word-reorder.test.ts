/**
 * Pure tests for word reorder (Task 113528, P18.6 — src/lib/subtitles/word-reorder.ts).
 * No store, no React.
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-reorder.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reorderSubtitleWord } from "../word-reorder.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

function word(text: string, start: number, end: number, extra: Partial<Word> = {}): Word {
  return { text, start, end, ...extra };
}

function subtitle(words: Word[], extra: Partial<Subtitle> = {}): Subtitle {
  return { id: "a", index: 0, start: 0, end: 10, text: words.map((w) => w.text).join(" "), words, ...extra };
}

function fourWords(): Word[] {
  return [
    word("this", 0, 1, { confidence: 0.9 }),
    word("is", 1, 2, { confidence: 0.8, style: { fontWeight: 700 } }),
    word("a", 2, 3, { removed: true }),
    word("test", 3, 4, { confidence: 0.7, hinglishText: "test", gujaratiScriptText: "ટેસ્ટ" }),
  ];
}

// ============================== ordering scenarios ==============================

test("reorderSubtitleWord: first -> second (adjacent move)", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 0, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.subtitle.words.map((w) => w.text),
    ["is", "this", "a", "test"],
  );
});

test("reorderSubtitleWord: second -> first (adjacent move)", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 1, 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.subtitle.words.map((w) => w.text),
    ["is", "this", "a", "test"],
  );
});

test("reorderSubtitleWord: first -> last", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 0, 3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.subtitle.words.map((w) => w.text),
    ["is", "a", "test", "this"],
  );
});

test("reorderSubtitleWord: last -> first", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 3, 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.subtitle.words.map((w) => w.text),
    ["test", "this", "is", "a"],
  );
});

test("reorderSubtitleWord: the task's own worked example — 'this is a test' -> 'this test is a'", () => {
  const sub = subtitle(fourWords()); // this(0) is(1) a(2) test(3)
  // Move "test" (index 3) to index 1.
  const result = reorderSubtitleWord(sub, 3, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.subtitle.words.map((w) => w.text),
    ["this", "test", "is", "a"],
  );
});

test("reorderSubtitleWord: no-op move (fromIndex === toIndex) is rejected, original reference returned", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 2, 2);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "noop");
  assert.equal(result.subtitle, sub, "rejected result returns the exact same subtitle reference");
});

// ============================== invalid indices ==============================

test("reorderSubtitleWord: negative index is rejected", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, -1, 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "invalid-index");
  assert.equal(result.subtitle, sub);
});

test("reorderSubtitleWord: out-of-range index is rejected", () => {
  const sub = subtitle(fourWords());
  assert.equal(reorderSubtitleWord(sub, 0, 4).ok, false);
  assert.equal(reorderSubtitleWord(sub, 4, 0).ok, false);
});

test("reorderSubtitleWord: non-integer index is rejected", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 0.5, 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "invalid-index");
});

test("reorderSubtitleWord: NaN index is rejected, never crashes", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, NaN, 1);
  assert.equal(result.ok, false);
});

// ============================== edge-case word counts ==============================

test("reorderSubtitleWord: a single-word caption has no valid non-noop move", () => {
  const sub = subtitle([word("solo", 0, 1)]);
  assert.equal(reorderSubtitleWord(sub, 0, 0).ok, false); // noop, the only "in range" pair
  const outOfRange = reorderSubtitleWord(sub, 0, 1);
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) assert.equal(outOfRange.reason, "invalid-index");
});

test("reorderSubtitleWord: an empty words array rejects any index as out of range", () => {
  const sub = subtitle([]);
  const result = reorderSubtitleWord(sub, 0, 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid-index");
});

// ============================== metadata/timing preservation ==============================

test("reorderSubtitleWord: every word's start/end are EXACTLY unchanged after the move (timing travels with the object)", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 3, 0); // "test" (3-4) moves to the front
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const moved = result.subtitle.words.find((w) => w.text === "test")!;
  assert.equal(moved.start, 3, "the moved word keeps its OWN original start, not the slot's start");
  assert.equal(moved.end, 4, "the moved word keeps its OWN original end, not the slot's end");
});

test("reorderSubtitleWord: word timing becomes non-monotonic as the DIRECT consequence of the move, and is NOT silently re-sorted", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 3, 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const starts = result.subtitle.words.map((w) => w.start);
  assert.deepEqual(starts, [3, 0, 1, 2], "array order is now non-chronological — this is expected, not corrected");
});

test("reorderSubtitleWord: confidence stays attached to the moved word, not left behind at the old slot", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 0, 3); // "this" (confidence 0.9) moves to the end
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const moved = result.subtitle.words.find((w) => w.text === "this")!;
  assert.equal(moved.confidence, 0.9);
});

test("reorderSubtitleWord: word-level style override stays attached to the moved word", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 1, 3); // "is" (fontWeight 700) moves to the end
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const moved = result.subtitle.words.find((w) => w.text === "is")!;
  assert.deepEqual(moved.style, { fontWeight: 700 });
});

test("reorderSubtitleWord: removed state stays attached to the moved word", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 2, 0); // "a" (removed: true) moves to the front
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const moved = result.subtitle.words.find((w) => w.text === "a")!;
  assert.equal(moved.removed, true);
});

test("reorderSubtitleWord: derived fields (hinglishText, gujaratiScriptText) stay attached to the moved word", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 3, 0); // "test" moves to the front
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const moved = result.subtitle.words.find((w) => w.text === "test")!;
  assert.equal(moved.hinglishText, "test");
  assert.equal(moved.gujaratiScriptText, "ટેસ્ટ");
});

test("reorderSubtitleWord: every word object not directly involved in the splice range is unaffected in value", () => {
  const words = fourWords();
  const sub = subtitle(words);
  const result = reorderSubtitleWord(sub, 3, 2); // only "a"(2) and "test"(3) swap
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.subtitle.words[0], words[0], "'this' untouched");
  assert.deepEqual(result.subtitle.words[1], words[1], "'is' untouched");
});

// ============================== caption-level invariants ==============================

test("reorderSubtitleWord: the caption's own start/end/duration are exactly unchanged", () => {
  const sub = subtitle(fourWords(), { start: 5, end: 15 });
  const result = reorderSubtitleWord(sub, 0, 3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.start, 5);
  assert.equal(result.subtitle.end, 15);
});

test("reorderSubtitleWord: caption-level style/animation/id/index are carried over untouched", () => {
  const sub = subtitle(fourWords(), { id: "xyz", index: 7, style: { color: "#ff0000" } });
  const result = reorderSubtitleWord(sub, 0, 3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.id, "xyz");
  assert.equal(result.subtitle.index, 7);
  assert.deepEqual(result.subtitle.style, { color: "#ff0000" });
});

test("reorderSubtitleWord: does NOT touch subtitle.text, hinglishText, or gujaratiScriptText — that is the caller's job", () => {
  const sub = subtitle(fourWords(), { text: "this is a test", hinglishText: "yeh hai ek test", gujaratiScriptText: "આ એક ટેસ્ટ છે" });
  const result = reorderSubtitleWord(sub, 0, 3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.text, "this is a test", "unchanged — deliberately stale until the caller resyncs it");
  assert.equal(result.subtitle.hinglishText, "yeh hai ek test");
  assert.equal(result.subtitle.gujaratiScriptText, "આ એક ટેસ્ટ છે");
});

// ============================== object/reference behavior ==============================

test("reorderSubtitleWord: does not mutate the input subtitle or its words array", () => {
  const words = fourWords();
  const originalWordsRef = words;
  const sub = subtitle(words);
  reorderSubtitleWord(sub, 0, 3);
  assert.equal(sub.words, originalWordsRef, "input subtitle.words reference is untouched");
  assert.deepEqual(
    sub.words.map((w) => w.text),
    ["this", "is", "a", "test"],
    "input word order is untouched",
  );
});

test("reorderSubtitleWord: individual word objects that don't move keep their own exact reference", () => {
  const words = fourWords();
  const sub = subtitle(words);
  const result = reorderSubtitleWord(sub, 3, 2); // only positions 2/3 change
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.words[0], words[0]);
  assert.equal(result.subtitle.words[1], words[1]);
  assert.equal(result.subtitle.words[2], words[3], "the moved word object itself is the exact same reference, just relocated");
  assert.equal(result.subtitle.words[3], words[2], "the displaced word object itself is the exact same reference, just relocated");
});

test("reorderSubtitleWord: on success, a genuinely NEW subtitle object is returned (never the same reference)", () => {
  const sub = subtitle(fourWords());
  const result = reorderSubtitleWord(sub, 0, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.subtitle, sub);
  assert.notEqual(result.subtitle.words, sub.words);
});
