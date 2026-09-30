/**
 * Automated tests for "Merge With Next" (lib/subtitles/merge-subtitles.ts). Task 114761 (P18.7).
 *
 * Run with: node --test src/lib/subtitles/__tests__/merge-subtitles.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeSubtitles } from "../merge-subtitles.ts";
import { DEFAULT_TIMING_RULES } from "../../../types/subtitle.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

function word(text: string, start: number, end: number, extra: Partial<Word> = {}): Word {
  return { text, start, end, ...extra };
}

function subtitle(id: string, start: number, end: number, words: Word[], extra: Partial<Subtitle> = {}): Subtitle {
  return { id, index: 0, start, end, text: words.map((w) => w.text).join(" "), words, ...extra };
}

// ============================== basic merge behavior ==============================

test("mergeSubtitles: resulting caption spans a.start to b.end", () => {
  const a = subtitle("a", 0, 2, [word("hello", 0, 2)]);
  const b = subtitle("b", 2, 4, [word("world", 2, 4)]);
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.start, 0);
  assert.equal(result.subtitle.end, 4);
});

test("mergeSubtitles: word order is a.words followed by b.words, in their existing order — not re-sorted", () => {
  const a = subtitle("a", 0, 2, [word("hello", 0, 2)]);
  const b = subtitle("b", 3, 5, [word("world", 3, 5)]);
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.subtitle.words.map((w) => w.text), ["hello", "world"]);
  assert.equal(result.subtitle.text, "hello world");
});

test("mergeSubtitles: a pre-existing gap between a and b is preserved (words are concatenated, not redistributed)", () => {
  const a = subtitle("a", 0, 2, [word("hello", 0, 2)]);
  const b = subtitle("b", 5, 7, [word("world", 5, 7)]); // 3s gap between a.end and b.start
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.words[0].end, 2, "a's word keeps its own end");
  assert.equal(result.subtitle.words[1].start, 5, "b's word keeps its own start — the gap is preserved, not closed");
});

test("mergeSubtitles: keeps a's own id/index, and a's own style/animation ('A absorbs B')", () => {
  const a = subtitle("a", 0, 2, [word("hello", 0, 2)], { index: 3, style: { color: "#ff0000" }, animation: { entrance: "pop" } });
  const b = subtitle("b", 2, 4, [word("world", 2, 4)], { index: 4, style: { color: "#00ff00" } });
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.id, "a");
  assert.equal(result.subtitle.index, 3);
  assert.deepEqual(result.subtitle.style, { color: "#ff0000" });
  assert.deepEqual(result.subtitle.animation, { entrance: "pop" });
});

// ============================== metadata preservation ==============================

test("mergeSubtitles: preserves confidence, style, removed, and derived fields on every word from both sides", () => {
  const a = subtitle("a", 0, 2, [word("hello", 0, 2, { confidence: 0.9, style: { fontWeight: 700 }, hinglishText: "hi" })]);
  const b = subtitle("b", 2, 4, [word("world", 2, 4, { removed: true, gujaratiScriptText: "વર્લ્ડ" })]);
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const [hello, world] = result.subtitle.words;
  assert.equal(hello.confidence, 0.9);
  assert.deepEqual(hello.style, { fontWeight: 700 });
  assert.equal(hello.hinglishText, "hi");
  assert.equal(world.removed, true);
  assert.equal(world.gujaratiScriptText, "વર્લ્ડ");
});

test("mergeSubtitles: every word's start/end are exactly unchanged — never regenerated or redistributed", () => {
  const a = subtitle("a", 0, 2, [word("hello", 0.1, 1.9)]);
  const b = subtitle("b", 2, 4, [word("world", 2.1, 3.9)]);
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitle.words[0].start, 0.1);
  assert.equal(result.subtitle.words[0].end, 1.9);
  assert.equal(result.subtitle.words[1].start, 2.1);
  assert.equal(result.subtitle.words[1].end, 3.9);
});

// ============================== Task 114761: non-monotonic word order (P18.6) ==============================

test("P18.7: merging two captions whose OWN word arrays are already non-monotonic (P18.6) preserves both exactly — no re-sorting, no clamping-driven corruption", () => {
  // a's own words are reordered: CHARLIE(3.5-4.5) BRAVO(2-3) — array order != chronological order.
  const a = subtitle("a", 2, 4.5, [word("CHARLIE", 3.5, 4.5), word("BRAVO", 2, 3)]);
  const b = subtitle("b", 5, 8, [word("ECHO", 7, 8), word("DELTA", 5, 6)]);
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.subtitle.words.map((w) => `${w.text}:${w.start}-${w.end}`),
    ["CHARLIE:3.5-4.5", "BRAVO:2-3", "ECHO:7-8", "DELTA:5-6"],
    "each side's own existing (non-monotonic) order is preserved exactly — the OLD clamp-based merge would have dragged BRAVO/DELTA's timing forward to 'fix' this",
  );
});

test("P18.7: a non-monotonic word's timing is NOT relocated by the merge (the old clampWordsToCaptionBounds bug this task fixes)", () => {
  // Reproduces the exact scenario the old implementation corrupted: a word (BRAVO) whose own
  // timestamp is EARLIER than an array-preceding word's end.
  const a = subtitle("a", 2, 6, [word("DELTA", 5, 6), word("BRAVO", 2, 3)]); // array order: DELTA then BRAVO, but BRAVO is chronologically earlier
  const b = subtitle("b", 7, 8, [word("FOXTROT", 7, 8)]);
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const bravo = result.subtitle.words.find((w) => w.text === "BRAVO")!;
  assert.equal(bravo.start, 2, "BRAVO's own start must NOT have been dragged forward past DELTA's end");
  assert.equal(bravo.end, 3);
});

// ============================== rejection: genuinely invalid input ==============================

test("mergeSubtitles: rejects when a word falls outside the merged caption's own bounds", () => {
  const a = subtitle("a", 0, 2, [word("hello", -5, -3)]); // corrupt: before a.start
  const b = subtitle("b", 2, 4, [word("world", 2, 4)]);
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "out-of-bounds");
});

test("mergeSubtitles: rejects when two words overlap (genuinely corrupt input — captions overlapping)", () => {
  const a = subtitle("a", 0, 3, [word("hello", 0, 3)]);
  const b = subtitle("b", 2, 4, [word("world", 2, 4)]); // b starts before a ends — overlapping captions
  const result = mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "overlap");
});

test("mergeSubtitles: never mutates either input caption or their words", () => {
  const a = subtitle("a", 0, 2, [word("hello", 0, 2)]);
  const b = subtitle("b", 2, 4, [word("world", 2, 4)]);
  const aWordsRef = a.words;
  const bWordsRef = b.words;
  mergeSubtitles(a, b, DEFAULT_TIMING_RULES);
  assert.equal(a.words, aWordsRef);
  assert.equal(b.words, bWordsRef);
});
