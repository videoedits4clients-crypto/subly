/**
 * Pure tests for word-level SPLIT/MERGE/DELETE (Task 102741, P15 — src/lib/subtitles/word-edit.ts).
 * No store, no React.
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-edit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  splitWordText,
  defaultWordSplit,
  mergeWords,
  deleteWordConservative,
  normalizeInsertedWordText,
  computeInsertionGap,
  resolveWordInsertion,
  remapWordMetadataForTextReplacement,
} from "../word-edit.ts";
import { MIN_WORD_DURATION_SEC } from "../word-timing.ts";
import type { Word } from "../../../types/subtitle.ts";

function word(text: string, start: number, end: number, extra: Partial<Word> = {}): Word {
  return { text, start, end, ...extra };
}

// ============================== splitWordText ==============================

test("splitWordText divides timing proportionally by character length (the spec's own worked example)", () => {
  const result = splitWordText(word("hello", 10, 10.5), "hel", "lo");
  assert.ok(result);
  assert.equal(result!.left.text, "hel");
  assert.equal(result!.left.start, 10);
  assert.equal(result!.left.end, 10.3);
  assert.equal(result!.right.text, "lo");
  assert.equal(result!.right.start, 10.3);
  assert.equal(result!.right.end, 10.5);
});

test("splitWordText: an even split produces equal halves", () => {
  const result = splitWordText(word("abcd", 0, 1), "ab", "cd");
  assert.equal(result!.left.end, 0.5);
  assert.equal(result!.right.start, 0.5);
});

test("splitWordText: rejects empty text on either side", () => {
  assert.equal(splitWordText(word("hi", 0, 1), "", "hi"), null);
  assert.equal(splitWordText(word("hi", 0, 1), "hi", ""), null);
  assert.equal(splitWordText(word("hi", 0, 1), "   ", "hi"), null, "whitespace-only counts as empty");
});

test("splitWordText: trims surrounding whitespace from each resulting token", () => {
  const result = splitWordText(word("hello", 0, 1), "  hel ", " lo  ");
  assert.equal(result!.left.text, "hel");
  assert.equal(result!.right.text, "lo");
});

test("splitWordText: rejects when the proportional split would leave either half below MIN_WORD_DURATION_SEC", () => {
  // A 0.03s word split 1:99 in length ratio would leave a sliver far under the minimum.
  const result = splitWordText(word("a", 0, 0.03), "a", "extremelylongsecondtoken");
  assert.equal(result, null);
});

test("splitWordText: accepts a split that lands exactly at the minimum duration", () => {
  // duration 1.0s, MIN_WORD_DURATION_SEC = 0.02 -> need a length ratio giving >= 0.02s per side.
  // 2 chars vs 98 chars over 1.0s gives the short side exactly 0.02s.
  const left = "ab";
  const right = "c".repeat(98);
  const result = splitWordText(word("x", 0, 1), left, right);
  assert.ok(result);
  assert.ok(result!.left.end - result!.left.start >= MIN_WORD_DURATION_SEC - 1e-9);
});

test("splitWordText: never fabricates confidence on either resulting word", () => {
  const result = splitWordText(word("hello", 10, 10.5, { confidence: 0.95 }), "hel", "lo");
  assert.equal(result!.left.confidence, undefined);
  assert.equal(result!.right.confidence, undefined);
});

test("splitWordText: propagates a per-word style override to both halves unchanged", () => {
  const style = { color: "#ff0000" };
  const result = splitWordText(word("hello", 0, 1, { style }), "hel", "lo");
  assert.deepEqual(result!.left.style, style);
  assert.deepEqual(result!.right.style, style);
});

test("splitWordText: propagates `removed` unchanged to both halves", () => {
  const result = splitWordText(word("hello", 0, 1, { removed: true }), "hel", "lo");
  assert.equal(result!.left.removed, true);
  assert.equal(result!.right.removed, true);
});

test("splitWordText: never sets hinglishText/gujaratiScriptText on the new words (caller clears them; this function simply never produces them)", () => {
  const result = splitWordText(word("hello", 0, 1, { hinglishText: "hello", gujaratiScriptText: "હેલો" }), "hel", "lo");
  assert.equal(result!.left.hinglishText, undefined);
  assert.equal(result!.right.hinglishText, undefined);
  assert.equal(result!.left.gujaratiScriptText, undefined);
  assert.equal(result!.right.gujaratiScriptText, undefined);
});

// ============================== defaultWordSplit ==============================

test("defaultWordSplit: splits at the character midpoint, biasing the extra character left for odd lengths", () => {
  assert.deepEqual(defaultWordSplit("abcd"), { left: "ab", right: "cd" });
  assert.deepEqual(defaultWordSplit("abc"), { left: "ab", right: "c" });
});

test("defaultWordSplit: returns null for text under 2 characters", () => {
  assert.equal(defaultWordSplit("a"), null);
  assert.equal(defaultWordSplit(""), null);
  assert.equal(defaultWordSplit("  "), null);
});

test("defaultWordSplit: trims surrounding whitespace before splitting", () => {
  assert.deepEqual(defaultWordSplit("  abcd  "), { left: "ab", right: "cd" });
});

test("defaultWordSplit (P16): never splits a Devanagari grapheme cluster apart — the spec's own नमस्ते example", () => {
  // "नमस्ते" is 6 UTF-16 code units but only 4 grapheme clusters: न, म, स्ते (स + ् + त + े) has
  // 3 clusters as न,म,स्ते? Actually Intl.Segmenter groups न | म | स्ते as 3 clusters total.
  // The old P15 raw-character split (midpoint of 6 -> 3/3) produced "नमस"/"्ते", severing स from े.
  // The fix must never propose a boundary inside "स्ते".
  const result = defaultWordSplit("नमस्ते")!;
  assert.ok(result, "must still produce a split for a multi-cluster word");
  assert.notEqual(result.left, "नमस", "must not sever the combining vowel sign from its base consonant");
  assert.notEqual(result.right, "्ते", "must not start a token with a bare combining mark");
  // Rejoining both halves must reproduce the original text exactly.
  assert.equal(result.left + result.right, "नमस्ते");
});

// ============================== mergeWords ==============================

test("mergeWords: joins text with a space, spans the full original range (the spec's own worked example)", () => {
  const merged = mergeWords(word("hello", 10, 10.5), word("world", 10.5, 11));
  assert.equal(merged.text, "hello world");
  assert.equal(merged.start, 10);
  assert.equal(merged.end, 11);
});

test("mergeWords: never fabricates or averages confidence", () => {
  const merged = mergeWords(word("hello", 0, 1, { confidence: 0.9 }), word("world", 1, 2, { confidence: 0.5 }));
  assert.equal(merged.confidence, undefined);
});

test("mergeWords: takes the FIRST word's style override (documented, deterministic tie-break)", () => {
  const merged = mergeWords(word("a", 0, 1, { style: { color: "red" } }), word("b", 1, 2, { style: { color: "blue" } }));
  assert.deepEqual(merged.style, { color: "red" });
});

test("mergeWords: takes the first word's style even when only the SECOND word has one", () => {
  const merged = mergeWords(word("a", 0, 1), word("b", 1, 2, { style: { color: "blue" } }));
  assert.equal(merged.style, undefined);
});

test("mergeWords: `removed` is true if EITHER original word was soft-deleted", () => {
  assert.equal(mergeWords(word("a", 0, 1, { removed: true }), word("b", 1, 2)).removed, true);
  assert.equal(mergeWords(word("a", 0, 1), word("b", 1, 2, { removed: true })).removed, true);
  assert.equal(mergeWords(word("a", 0, 1), word("b", 1, 2)).removed, undefined);
});

test("mergeWords: never fabricates hinglishText/gujaratiScriptText when only ONE side has a value", () => {
  const merged = mergeWords(word("a", 0, 1, { hinglishText: "a" }), word("b", 1, 2, { gujaratiScriptText: "b" }));
  assert.equal(merged.hinglishText, undefined, "word 'a' had hinglishText but 'b' didn't — never fabricate 'b's own missing value");
  assert.equal(merged.gujaratiScriptText, undefined, "word 'b' had gujaratiScriptText but 'a' didn't — same rule, same reason");
});

// ---- Task 106284 (P17.1): mergeWords preserves derived fields when BOTH sides have them ----

test("mergeWords: preserves hinglishText by the SAME join-by-space rule as .text, when BOTH words already have one", () => {
  const merged = mergeWords(word("hello", 10, 10.5, { hinglishText: "namaste" }), word("world", 10.5, 11, { hinglishText: "duniya" }));
  assert.equal(merged.text, "hello world");
  assert.equal(merged.hinglishText, "namaste duniya");
});

test("mergeWords: preserves gujaratiScriptText by the same join-by-space rule, when BOTH words already have one", () => {
  const merged = mergeWords(word("नमस्ते", 0, 1, { gujaratiScriptText: "નમસ્તે" }), word("दुनिया", 1, 2, { gujaratiScriptText: "દુનિયા" }));
  assert.equal(merged.gujaratiScriptText, "નમસ્તે દુનિયા");
});

test("mergeWords: hinglishText missing on the FIRST word only — left undefined, not fabricated from the second", () => {
  const merged = mergeWords(word("hello", 0, 1), word("world", 1, 2, { hinglishText: "duniya" }));
  assert.equal(merged.hinglishText, undefined);
});

test("mergeWords: hinglishText missing on the SECOND word only — left undefined, not fabricated from the first", () => {
  const merged = mergeWords(word("hello", 0, 1, { hinglishText: "namaste" }), word("world", 1, 2));
  assert.equal(merged.hinglishText, undefined);
});

test("mergeWords: hinglishText missing on BOTH words — stays undefined (the ordinary Original-mode case)", () => {
  const merged = mergeWords(word("hello", 0, 1), word("world", 1, 2));
  assert.equal(merged.hinglishText, undefined);
});

test("mergeWords: gujaratiScriptText missing on the FIRST word only — left undefined", () => {
  const merged = mergeWords(word("a", 0, 1), word("b", 1, 2, { gujaratiScriptText: "બ" }));
  assert.equal(merged.gujaratiScriptText, undefined);
});

test("mergeWords: gujaratiScriptText missing on the SECOND word only — left undefined", () => {
  const merged = mergeWords(word("a", 0, 1, { gujaratiScriptText: "અ" }), word("b", 1, 2));
  assert.equal(merged.gujaratiScriptText, undefined);
});

test("mergeWords: hinglishText and gujaratiScriptText are decided COMPLETELY INDEPENDENTLY — one can be preserved while the other is dropped", () => {
  const merged = mergeWords(word("a", 0, 1, { hinglishText: "a-hi", gujaratiScriptText: "a-gu" }), word("b", 1, 2, { hinglishText: "b-hi" }));
  assert.equal(merged.hinglishText, "a-hi b-hi", "both sides had hinglishText — preserved");
  assert.equal(merged.gujaratiScriptText, undefined, "only 'a' had gujaratiScriptText — never fabricated for 'b'");
});

test("mergeWords: preserving derived fields never affects the existing confidence/style/removed/timestamp policy", () => {
  const merged = mergeWords(
    word("hello", 10, 10.5, { hinglishText: "namaste", confidence: 0.9, style: { color: "red" }, removed: true }),
    word("world", 10.5, 11, { hinglishText: "duniya", confidence: 0.8 }),
  );
  assert.equal(merged.start, 10, "timestamp policy unchanged");
  assert.equal(merged.end, 11, "timestamp policy unchanged");
  assert.equal(merged.confidence, undefined, "confidence policy unchanged — never fabricated regardless of derived-field preservation");
  assert.deepEqual(merged.style, { color: "red" }, "style tie-break (first word wins) unchanged");
  assert.equal(merged.removed, true, "removed-if-either policy unchanged");
  assert.equal(merged.hinglishText, "namaste duniya", "and the NEW derived-field preservation still applies alongside all of the above");
});

// ============================== deleteWordConservative ==============================

test("deleteWordConservative: deleting a MIDDLE word extends the previous word's end to absorb it", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const result = deleteWordConservative(words, 1)!;
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "A");
  assert.equal(result[0].start, 0);
  assert.equal(result[0].end, 2, "A must absorb B's own former end");
  assert.equal(result[1].text, "C");
  assert.deepEqual([result[1].start, result[1].end], [2, 3], "C must be completely untouched");
});

test("deleteWordConservative: deleting the FIRST word pulls the next word's start back instead", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const result = deleteWordConservative(words, 0)!;
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "B");
  assert.equal(result[0].start, 0, "B must absorb A's own former start");
  assert.equal(result[0].end, 2);
  assert.deepEqual([result[1].start, result[1].end], [2, 3], "C must be completely untouched");
});

test("deleteWordConservative: deleting the LAST word extends the previous word's end", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const result = deleteWordConservative(words, 2)!;
  assert.equal(result.length, 2);
  assert.equal(result[1].text, "B");
  assert.equal(result[1].end, 3, "B must absorb C's own former end");
});

test("deleteWordConservative: deleting the ONLY word returns an empty array (never rejected)", () => {
  const result = deleteWordConservative([word("A", 0, 1)], 0);
  assert.deepEqual(result, []);
});

test("deleteWordConservative: never leaves a gap or overlap, and never violates minimum duration, across many positions", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3), word("D", 3, 4), word("E", 4, 5)];
  for (let i = 0; i < words.length; i++) {
    const result = deleteWordConservative(words, i)!;
    for (let j = 1; j < result.length; j++) {
      assert.ok(result[j].start >= result[j - 1].end - 1e-9, `no overlap/gap after deleting index ${i}`);
    }
    for (const w of result) {
      assert.ok(w.end - w.start >= MIN_WORD_DURATION_SEC - 1e-9, `no sub-minimum duration after deleting index ${i}`);
    }
  }
});

test("deleteWordConservative: never mutates non-timing fields on the absorbing neighbor", () => {
  const words = [word("A", 0, 1, { confidence: 0.9, style: { color: "red" } }), word("B", 1, 2)];
  const result = deleteWordConservative(words, 1)!;
  assert.equal(result[0].confidence, 0.9);
  assert.deepEqual(result[0].style, { color: "red" });
});

test("deleteWordConservative: returns null for an out-of-range index", () => {
  assert.equal(deleteWordConservative([word("A", 0, 1)], 5), null);
  assert.equal(deleteWordConservative([word("A", 0, 1)], -1), null);
});

test("deleteWordConservative: returns null (not a crash) for a non-array input", () => {
  assert.equal(deleteWordConservative(null as unknown as Word[], 0), null);
});

// ============================== normalizeInsertedWordText (Task 103884, P16) ==============================

test("normalizeInsertedWordText: trims surrounding whitespace", () => {
  assert.equal(normalizeInsertedWordText("  hello  "), "hello");
});

test("normalizeInsertedWordText: rejects empty/whitespace-only text", () => {
  assert.equal(normalizeInsertedWordText(""), null);
  assert.equal(normalizeInsertedWordText("   "), null);
});

test("normalizeInsertedWordText: rejects multi-token text rather than silently splitting it", () => {
  assert.equal(normalizeInsertedWordText("very good"), null);
  assert.equal(normalizeInsertedWordText("a b c"), null);
  assert.equal(normalizeInsertedWordText("  very   good  "), null);
});

test("normalizeInsertedWordText: accepts a single Unicode word (not an ASCII-only check)", () => {
  assert.equal(normalizeInsertedWordText("नमस्ते"), "नमस्ते");
  assert.equal(normalizeInsertedWordText("café"), "café");
  assert.equal(normalizeInsertedWordText("😀"), "😀");
});

test("normalizeInsertedWordText: allows punctuation attached to the word", () => {
  assert.equal(normalizeInsertedWordText("hello,"), "hello,");
  assert.equal(normalizeInsertedWordText("don't"), "don't");
});

// ============================== computeInsertionGap (Task 103884, P16) ==============================

test("computeInsertionGap: 'before' a middle word uses the previous word's own end", () => {
  const words = [word("A", 0, 1), word("B", 1.2, 2)];
  assert.deepEqual(computeInsertionGap(words, 1, "before", 0, 2), { start: 1, end: 1.2 });
});

test("computeInsertionGap: 'after' a middle word uses the next word's own start", () => {
  const words = [word("A", 0, 1), word("B", 1, 1.8), word("C", 2, 3)];
  assert.deepEqual(computeInsertionGap(words, 1, "after", 0, 3), { start: 1.8, end: 2 });
});

test("computeInsertionGap: 'before' the FIRST word falls back to the caption's own start", () => {
  const words = [word("A", 0.5, 1)];
  assert.deepEqual(computeInsertionGap(words, 0, "before", 0, 1), { start: 0, end: 0.5 });
});

test("computeInsertionGap: 'after' the LAST word falls back to the caption's own end", () => {
  const words = [word("A", 0, 0.5)];
  assert.deepEqual(computeInsertionGap(words, 0, "after", 0, 1), { start: 0.5, end: 1 });
});

test("computeInsertionGap: returns null for an out-of-range anchor index", () => {
  assert.equal(computeInsertionGap([word("A", 0, 1)], 5, "before", 0, 1), null);
  assert.equal(computeInsertionGap([word("A", 0, 1)], -1, "before", 0, 1), null);
});

// ============================== resolveWordInsertion (Task 103884, P16) ==============================

test("resolveWordInsertion: 'Insert Before' claims the WHOLE gap (the spec's own worked example)", () => {
  // Previous 0.00-1.00, Selected 1.20-2.00, insert "very" -> new word claims 1.00-1.20 entirely.
  const words = [word("Previous", 0, 1), word("Selected", 1.2, 2)];
  const result = resolveWordInsertion(words, 1, "before", "very", 0, 2)!;
  assert.ok(result);
  assert.equal(result.word.text, "very");
  assert.equal(result.word.start, 1);
  assert.equal(result.word.end, 1.2);
  assert.equal(result.index, 1, "splices in at the anchor's own current index");
});

test("resolveWordInsertion: 'Insert After' claims the whole gap on the other side", () => {
  const words = [word("Selected", 1.2, 2), word("Next", 2.5, 3)];
  const result = resolveWordInsertion(words, 0, "after", "hi", 1, 3)!;
  assert.equal(result.word.start, 2);
  assert.equal(result.word.end, 2.5);
  assert.equal(result.index, 1, "splices in immediately after the anchor");
});

test("resolveWordInsertion: inserting before the FIRST word uses the caption boundary fallback", () => {
  const words = [word("A", 0.5, 1)];
  const result = resolveWordInsertion(words, 0, "before", "hi", 0, 1)!;
  assert.equal(result.word.start, 0);
  assert.equal(result.word.end, 0.5);
  assert.equal(result.index, 0);
});

test("resolveWordInsertion: inserting after the LAST word uses the caption boundary fallback", () => {
  const words = [word("A", 0, 0.5)];
  const result = resolveWordInsertion(words, 0, "after", "hi", 0, 1)!;
  assert.equal(result.word.start, 0.5);
  assert.equal(result.word.end, 1);
  assert.equal(result.index, 1);
});

test("resolveWordInsertion: inserting into a MIDDLE position (not first/last) works from either side when a gap exists", () => {
  const words = [word("A", 0, 1), word("B", 1.2, 2), word("C", 2.2, 3)];
  const before = resolveWordInsertion(words, 1, "before", "x", 0, 3)!;
  assert.deepEqual([before.word.start, before.word.end, before.index], [1, 1.2, 1]);
  const after = resolveWordInsertion(words, 1, "after", "x", 0, 3)!;
  assert.deepEqual([after.word.start, after.word.end, after.index], [2, 2.2, 2]);
});

test("resolveWordInsertion: adjacent words with no gap between them reject cleanly (no mutation)", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  assert.equal(resolveWordInsertion(words, 1, "before", "x", 0, 3), null);
  assert.equal(resolveWordInsertion(words, 1, "after", "x", 0, 3), null);
});

test("resolveWordInsertion: rejects when the gap is smaller than MIN_WORD_DURATION_SEC", () => {
  const words = [word("A", 0, 1), word("B", 1 + MIN_WORD_DURATION_SEC / 2, 2)];
  assert.equal(resolveWordInsertion(words, 1, "before", "x", 0, 2), null);
});

test("resolveWordInsertion: accepts a gap exactly equal to MIN_WORD_DURATION_SEC", () => {
  const words = [word("A", 0, 1), word("B", 1 + MIN_WORD_DURATION_SEC, 2)];
  const result = resolveWordInsertion(words, 1, "before", "x", 0, 2)!;
  assert.ok(result);
  assert.ok(Math.abs(result.word.end - result.word.start - MIN_WORD_DURATION_SEC) < 1e-9);
});

test("resolveWordInsertion: never creates overlap or negative/zero-duration timing, swept across many gap sizes", () => {
  for (const gap of [0, MIN_WORD_DURATION_SEC / 2, MIN_WORD_DURATION_SEC, MIN_WORD_DURATION_SEC * 2, 0.5, 1]) {
    const words = [word("A", 0, 1), word("B", 1 + gap, 2 + gap)];
    const result = resolveWordInsertion(words, 1, "before", "x", 0, 2 + gap);
    if (gap < MIN_WORD_DURATION_SEC) {
      assert.equal(result, null, `gap ${gap} below minimum must reject`);
    } else {
      assert.ok(result, `gap ${gap} at/above minimum must accept`);
      assert.ok(result!.word.start >= words[0].end - 1e-9, "no overlap with previous word");
      assert.ok(result!.word.end <= words[1].start + 1e-9, "no overlap with next word");
      assert.ok(result!.word.end - result!.word.start >= MIN_WORD_DURATION_SEC - 1e-9, "no sub-minimum duration");
    }
  }
});

test("resolveWordInsertion: rejects whitespace-only text (no mutation shape to inspect — just confirms null)", () => {
  const words = [word("A", 0, 1), word("B", 1.5, 2)];
  assert.equal(resolveWordInsertion(words, 1, "before", "   ", 0, 2), null);
});

test("resolveWordInsertion: rejects multi-token text ('very good' must not silently create two words)", () => {
  const words = [word("A", 0, 1), word("B", 1.5, 2)];
  assert.equal(resolveWordInsertion(words, 1, "before", "very good", 0, 2), null);
});

test("resolveWordInsertion: accepts a single Unicode word (not ASCII-only)", () => {
  const words = [word("A", 0, 1), word("B", 1.5, 2)];
  const result = resolveWordInsertion(words, 1, "before", "नमस्ते", 0, 2)!;
  assert.equal(result.word.text, "नमस्ते");
});

test("resolveWordInsertion: returns null for an out-of-range anchor index", () => {
  const words = [word("A", 0, 1)];
  assert.equal(resolveWordInsertion(words, 5, "before", "x", 0, 1), null);
});

test("resolveWordInsertion metadata policy (Task 103884 Phase 10): confidence/hinglishText/gujaratiScriptText are undefined, removed is explicitly false, style propagates from the anchor", () => {
  const words = [word("A", 0, 1, { style: { color: "red" } }), word("B", 1.5, 2)];
  const result = resolveWordInsertion(words, 0, "after", "x", 0, 2)!;
  assert.equal(result.word.confidence, undefined);
  assert.equal(result.word.hinglishText, undefined);
  assert.equal(result.word.gujaratiScriptText, undefined);
  assert.equal(result.word.removed, false, "explicitly false, not undefined — this is a genuinely present new word");
  assert.deepEqual(result.word.style, { color: "red" }, "propagates from the ANCHOR word, mirroring splitWordText's own style precedent");
});

test("resolveWordInsertion: never fabricates confidence even when the anchor word has one", () => {
  const words = [word("A", 0, 1, { confidence: 0.99 }), word("B", 1.5, 2)];
  const result = resolveWordInsertion(words, 0, "after", "x", 0, 2)!;
  assert.equal(result.word.confidence, undefined);
});

// ============================== Task 118943 (P18.10) — non-monotonic Word[] order ==============================
// P18.6 made non-monotonic `words` array order (textual/array order != chronological timestamp
// order) a permanent, supported state. mergeWords/deleteWordConservative/computeInsertionGap all
// pre-date that and derived their timing purely from ARRAY adjacency (`word`/`nextWord` as given by
// the caller, or `words[index-1]`/`words[index+1]`), silently assuming array-adjacent was also
// chronologically-adjacent. These are the MANDATORY failing-before-the-fix regression tests.

test("[MANDATORY REGRESSION] mergeWords: merging two array-adjacent words that are NOT chronologically adjacent must not silently invert the resulting interval", () => {
  // Array order [DELTA, CHARLIE] (DELTA is array-first/`word`, CHARLIE is array-next/`nextWord`)
  // but CHARLIE is chronologically EARLIER than DELTA — mirrors the P18.6 reorder scenario
  // (BRAVO, DELTA, CHARLIE) isolated to just the two words actually being merged.
  const first = word("DELTA", 5.0, 6.0);
  const second = word("CHARLIE", 3.5, 4.5); // array-next, but chronologically EARLIER
  const merged = mergeWords(first, second);
  assert.ok(merged.start < merged.end, `merging DELTA[5,6] then CHARLIE[3.5,4.5] (array order) must never produce an inverted interval — got [${merged.start}, ${merged.end}]`);
  assert.equal(merged.start, 3.5, "must span the true minimum of both real timestamps");
  assert.equal(merged.end, 6.0, "must span the true maximum of both real timestamps");
});

test("[MANDATORY REGRESSION] deleteWordConservative: deleting a word must extend its REAL chronological neighbor, not its array-adjacent one, and must never create an overlap with a third word", () => {
  // Array order: BRAVO[2,3], DELTA[5,6], CHARLIE[3.5,4.5] — the exact P18.6 reorder reproduction.
  // Deleting DELTA (array index 1): the array-adjacent "previous" is BRAVO, but DELTA's REAL
  // chronological predecessor is CHARLIE (ends at 4.5, closer than BRAVO's 3.0).
  const words = [word("BRAVO", 2, 3), word("DELTA", 5, 6), word("CHARLIE", 3.5, 4.5)];
  const result = deleteWordConservative(words, 1)!;
  assert.equal(result.length, 2);
  const bravoAfter = result.find((w) => w.text === "BRAVO")!;
  const charlieAfter = result.find((w) => w.text === "CHARLIE")!;
  assert.deepEqual([bravoAfter.start, bravoAfter.end], [2, 3], "BRAVO (not DELTA's real neighbor) must be completely untouched");
  assert.equal(charlieAfter.end, 6, "CHARLIE (DELTA's real chronological predecessor) must absorb DELTA's own former end");
  assert.ok(charlieAfter.start < charlieAfter.end, "must remain a valid, non-inverted interval");
  assert.ok(!(bravoAfter.start < charlieAfter.end && bravoAfter.end > charlieAfter.start), "must never create an overlap between the two surviving words");
});

test("[MANDATORY REGRESSION] computeInsertionGap: the gap must be bounded by the anchor's REAL chronological neighbor, never a fake gap that overlaps a third word's real timing", () => {
  // Array order: BRAVO[2,3], DELTA[5,6], CHARLIE[3.5,4.5]. Inserting "before" DELTA (array index
  // 1): the array-adjacent previous is BRAVO (end=3), which would claim gap [3,5] — but that gap
  // entirely OVERLAPS CHARLIE's real [3.5,4.5]. The correct gap uses DELTA's real chronological
  // predecessor, CHARLIE (end=4.5): gap must be [4.5, 5].
  const words = [word("BRAVO", 2, 3), word("DELTA", 5, 6), word("CHARLIE", 3.5, 4.5)];
  const gap = computeInsertionGap(words, 1, "before", 0, 7)!;
  assert.deepEqual(gap, { start: 4.5, end: 5 }, "the gap must be bounded by CHARLIE's real end (4.5), not BRAVO's array-adjacent end (3)");
});

// ============================== remapWordMetadataForTextReplacement (Task 108762, P18.1) ==============================
// Fixes the exact P18 preflight-audit finding (research/p18_professional_editor_preflight_report.md
// §7): a same-token-count direct text edit used to carry the OLD word's confidence/style/removed
// onto completely different replacement text. The invariant under test: identical token text at a
// position -> the word is untouched; different token text -> confidence is cleared (never
// fabricated for text nobody measured), while style/removed are deliberately still preserved (see
// word-edit.ts's own top-of-file METADATA POLICY comment for why those two are NOT content-derived).

test("1. same token count + IDENTICAL token text -> the word is returned completely untouched (same object reference, not just equal values)", () => {
  const w = word("hello", 0, 0.5, { confidence: 0.9, style: { color: "red" } });
  const result = remapWordMetadataForTextReplacement(w, "hello");
  assert.equal(result, w, "no-op for this word: same reference, nothing recomputed");
});

test("2. same token count + ONE changed token -> confidence cleared, text updated, timing/style untouched", () => {
  const w = word("hello", 0, 0.5, { confidence: 0.9, style: { color: "red" } });
  const result = remapWordMetadataForTextReplacement(w, "hi");
  assert.equal(result.text, "hi");
  assert.equal(result.confidence, undefined, "must NOT survive onto different replacement text");
  assert.deepEqual(result.style, { color: "red" }, "style is positional/visual, not content-derived — preserved");
  assert.equal(result.start, 0);
  assert.equal(result.end, 0.5);
});

test("3. same token count + ALL tokens changed -> every changed word loses confidence independently", () => {
  const words = [word("hello", 0, 0.5, { confidence: 0.9 }), word("world", 0.5, 1, { confidence: 0.8 })];
  const newTokens = ["hi", "earth"];
  const result = words.map((w, i) => remapWordMetadataForTextReplacement(w, newTokens[i]));
  assert.equal(result[0].text, "hi");
  assert.equal(result[0].confidence, undefined);
  assert.equal(result[1].text, "earth");
  assert.equal(result[1].confidence, undefined);
});

test("6. punctuation-only change ('hello' -> 'hello,') is still a DIFFERENT token -> confidence cleared", () => {
  const w = word("hello", 0, 0.5, { confidence: 0.9 });
  const result = remapWordMetadataForTextReplacement(w, "hello,");
  assert.equal(result.text, "hello,");
  assert.equal(result.confidence, undefined, "the token literally changed (added punctuation) — not a no-op");
});

test("7. case-only change ('Hello' -> 'hello') is still a DIFFERENT token -> confidence cleared (exact string identity, not case-insensitive)", () => {
  const w = word("Hello", 0, 0.5, { confidence: 0.9 });
  const result = remapWordMetadataForTextReplacement(w, "hello");
  assert.equal(result.confidence, undefined);
});

test("8. Unicode/Hindi token edit: an unchanged Devanagari token is untouched; a changed one loses confidence, exactly like ASCII", () => {
  const unchanged = word("नमस्ते", 0, 0.5, { confidence: 0.95 });
  assert.equal(remapWordMetadataForTextReplacement(unchanged, "नमस्ते"), unchanged);

  const changed = word("नमस्ते", 0, 0.5, { confidence: 0.95 });
  const result = remapWordMetadataForTextReplacement(changed, "आज");
  assert.equal(result.text, "आज");
  assert.equal(result.confidence, undefined);
});

test("9. confidence already undefined + changed token -> stays undefined (never fabricated where none existed)", () => {
  const w = word("hello", 0, 0.5);
  const result = remapWordMetadataForTextReplacement(w, "hi");
  assert.equal(result.confidence, undefined);
});

test("10. confidence present + unchanged token -> exact value preserved (not rounded/recomputed)", () => {
  const w = word("hello", 0, 0.5, { confidence: 0.873 });
  const result = remapWordMetadataForTextReplacement(w, "hello");
  assert.equal(result.confidence, 0.873);
});

test("11. style: preserved on both an unchanged-text no-op AND a changed-text replacement (positional, not transcript-derived — matches splitWordText/mergeWords precedent)", () => {
  const w = word("hello", 0, 0.5, { style: { color: "blue", fontSize: 40 } });
  assert.deepEqual(remapWordMetadataForTextReplacement(w, "hello").style, { color: "blue", fontSize: 40 });
  assert.deepEqual(remapWordMetadataForTextReplacement(w, "hi").style, { color: "blue", fontSize: 40 });
});

test("12. removed: true survives a direct text replacement unchanged (conservative propagation — a text edit is not a 'restore this filler word' action; no removed:true is fabricated on an unrelated word either)", () => {
  const removedWord = word("um", 0, 0.5, { removed: true, confidence: 0.6 });
  const result = remapWordMetadataForTextReplacement(removedWord, "actually");
  assert.equal(result.text, "actually");
  assert.equal(result.removed, true, "removed propagates unchanged, matching split/merge's own conservative policy");
  assert.equal(result.confidence, undefined, "still cleared — the text genuinely changed");

  const notRemoved = word("hi", 0, 0.5);
  assert.equal(remapWordMetadataForTextReplacement(notRemoved, "hi").removed, undefined, "never fabricates removed:true on an unrelated no-op word");
});
