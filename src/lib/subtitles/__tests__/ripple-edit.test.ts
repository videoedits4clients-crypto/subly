/**
 * Pure tests for ripple delete/insert (Task 112347, P18.5 — src/lib/subtitles/ripple-edit.ts).
 * No store, no React.
 *
 * Run with: node --test src/lib/subtitles/__tests__/ripple-edit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  shiftWordsByDelta,
  shiftSubtitleByDelta,
  isContiguousSelection,
  resolveRippleDelete,
  resolveRippleInsert,
  validateRippleDeleteResult,
} from "../ripple-edit.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

function word(text: string, start: number, end: number, extra: Partial<Word> = {}): Word {
  return { text, start, end, ...extra };
}

function subtitle(id: string, index: number, start: number, end: number, words: Word[], extra: Partial<Subtitle> = {}): Subtitle {
  return { id, index, start, end, text: words.map((w) => w.text).join(" "), words, ...extra };
}

// ============================== shiftWordsByDelta / shiftSubtitleByDelta ==============================

test("shiftWordsByDelta: delta 0 returns the exact same array reference (identity-preserving)", () => {
  const words = [word("a", 0, 1)];
  assert.equal(shiftWordsByDelta(words, 0), words);
});

test("shiftWordsByDelta: shifts every word's start/end by delta, preserves every other field", () => {
  const words = [word("a", 0, 1, { confidence: 0.9, style: { fontWeight: 700 }, removed: true, hinglishText: "aa", gujaratiScriptText: "અ" })];
  const result = shiftWordsByDelta(words, 5);
  assert.equal(result[0].start, 5);
  assert.equal(result[0].end, 6);
  assert.equal(result[0].text, "a");
  assert.equal(result[0].confidence, 0.9);
  assert.deepEqual(result[0].style, { fontWeight: 700 });
  assert.equal(result[0].removed, true);
  assert.equal(result[0].hinglishText, "aa");
  assert.equal(result[0].gujaratiScriptText, "અ");
});

test("shiftSubtitleByDelta: delta 0 returns the exact same object reference", () => {
  const s = subtitle("a", 0, 0, 1, [word("hi", 0, 1)]);
  assert.equal(shiftSubtitleByDelta(s, 0), s);
});

test("shiftSubtitleByDelta: preserves duration exactly, preserves style/animation/derived text/id/index", () => {
  const s = subtitle("a", 3, 10, 12.5, [word("hi", 10, 12.5)], {
    style: { color: "#ff0000" },
    animation: { word: "bounce" } as never,
    hinglishText: "namaste",
    gujaratiScriptText: "નમસ્તે",
  });
  const result = shiftSubtitleByDelta(s, 2);
  assert.equal(result.start, 12);
  assert.equal(result.end, 14.5);
  assert.equal(result.end - result.start, s.end - s.start, "duration must be exactly unchanged");
  assert.equal(result.id, "a");
  assert.equal(result.index, 3);
  assert.deepEqual(result.style, { color: "#ff0000" });
  assert.equal(result.hinglishText, "namaste");
  assert.equal(result.gujaratiScriptText, "નમસ્તે");
  assert.equal(result.words[0].start, 12);
  assert.equal(result.words[0].end, 14.5);
});

// ============================== isContiguousSelection ==============================

test("isContiguousSelection: empty selection is false", () => {
  const subs = [subtitle("a", 0, 0, 1, []), subtitle("b", 1, 1, 2, [])];
  assert.equal(isContiguousSelection(subs, new Set()), false);
});

test("isContiguousSelection: a single selected caption is trivially contiguous", () => {
  const subs = [subtitle("a", 0, 0, 1, []), subtitle("b", 1, 1, 2, [])];
  assert.equal(isContiguousSelection(subs, new Set(["b"])), true);
});

test("isContiguousSelection: adjacent-index captions are contiguous", () => {
  const subs = [subtitle("a", 0, 0, 1, []), subtitle("b", 1, 1, 2, []), subtitle("c", 2, 2, 3, [])];
  assert.equal(isContiguousSelection(subs, new Set(["a", "b"])), true);
  assert.equal(isContiguousSelection(subs, new Set(["a", "b", "c"])), true);
});

test("isContiguousSelection: a gap in the selected indices is non-contiguous", () => {
  const subs = [subtitle("a", 0, 0, 1, []), subtitle("b", 1, 1, 2, []), subtitle("c", 2, 2, 3, [])];
  assert.equal(isContiguousSelection(subs, new Set(["a", "c"])), false);
});

test("isContiguousSelection: an id not present in subtitles at all is simply not counted", () => {
  const subs = [subtitle("a", 0, 0, 1, []), subtitle("b", 1, 1, 2, [])];
  assert.equal(isContiguousSelection(subs, new Set(["a", "ghost"])), true);
});

// ============================== resolveRippleDelete ==============================

test("resolveRippleDelete: empty selection is rejected, no subtitles field to worry about", () => {
  const subs = [subtitle("a", 0, 0, 2, [])];
  const result = resolveRippleDelete(subs, new Set());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "empty-selection");
});

test("resolveRippleDelete: non-contiguous selection is rejected, original array is never touched", () => {
  const subs = [subtitle("a", 0, 0, 2, []), subtitle("b", 1, 2, 4, []), subtitle("c", 2, 4, 6, [])];
  const result = resolveRippleDelete(subs, new Set(["a", "c"]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "non-contiguous-selection");
});

test("resolveRippleDelete: the task's own worked example — deleting A (0-2) ahead of a 2-4 gap preserves the gap, just relocated earlier", () => {
  // Caption A: 0-2, gap 2-4, Caption B: 4-6.
  const a = subtitle("a", 0, 0, 2, [word("hi", 0, 2)]);
  const b = subtitle("b", 1, 4, 6, [word("bye", 4, 6)]);
  const result = resolveRippleDelete([a, b], new Set(["a"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.deltaSec, 2, "delta is A's own span (2-0), NOT the 4s gap-inclusive span");
  assert.equal(result.subtitles.length, 1);
  const shiftedB = result.subtitles[0];
  assert.equal(shiftedB.id, "b");
  assert.equal(shiftedB.start, 2, "B moves to 4-2=2, preserving the original 2s gap (now 0-2) rather than closing it");
  assert.equal(shiftedB.end, 4);
  assert.equal(shiftedB.index, 0);
});

test("resolveRippleDelete: single-caption ripple delete is the k=1 case — delta equals the caption's own duration", () => {
  const a = subtitle("a", 0, 5, 7.5, [word("hi", 5, 7.5)]);
  const b = subtitle("b", 1, 7.5, 9, [word("bye", 7.5, 9)]); // flush adjacent, no gap
  const result = resolveRippleDelete([a, b], new Set(["a"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.deltaSec, 2.5);
  assert.equal(result.subtitles[0].start, 5);
  assert.equal(result.subtitles[0].end, 6.5, "flush-adjacent B shifts to close the gap completely, ending up exactly where A started");
});

test("resolveRippleDelete: captions entirely BEFORE the deleted block keep the exact same object reference", () => {
  const before1 = subtitle("x", 0, 0, 1, [word("x", 0, 1)]);
  const before2 = subtitle("y", 1, 1, 2, [word("y", 1, 2)]);
  const deleted = subtitle("z", 2, 2, 3, [word("z", 2, 3)]);
  const after1 = subtitle("w", 3, 3, 4, [word("w", 3, 4)]);
  const result = resolveRippleDelete([before1, before2, deleted, after1], new Set(["z"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitles[0], before1, "untouched caption before the ripple must be the SAME object reference");
  assert.equal(result.subtitles[1], before2, "untouched caption before the ripple must be the SAME object reference");
  assert.notEqual(result.subtitles[2], after1, "the shifted caption must be a NEW object");
  assert.equal(result.subtitles[2].start, 2);
});

test("resolveRippleDelete: a contiguous multi-caption selection deletes as one block, using the block's own total span", () => {
  const a = subtitle("a", 0, 0, 1, [word("a", 0, 1)]);
  const b = subtitle("b", 1, 1, 2, [word("b", 1, 2)]);
  const c = subtitle("c", 2, 2, 3, [word("c", 2, 3)]);
  const d = subtitle("d", 3, 5, 6, [word("d", 5, 6)]); // 2s gap between c and d
  const result = resolveRippleDelete([a, b, c, d], new Set(["a", "b", "c"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.deltaSec, 3, "block span is 3-0=3, spanning across a and b's own internal (zero) gaps and c's own width");
  assert.equal(result.subtitles.length, 1);
  assert.equal(result.subtitles[0].id, "d");
  assert.equal(result.subtitles[0].start, 2, "the pre-existing 2s gap between c and d survives, relocated to start where the block used to start");
  assert.equal(result.subtitles[0].end, 3);
});

test("resolveRippleDelete: word timing shifts by exactly the caption's own delta, word durations and ordering preserved", () => {
  const deleted = subtitle("a", 0, 0, 2, [word("hi", 0, 2)]);
  const w1 = word("one", 4, 4.5);
  const w2 = word("two", 4.5, 5);
  const after = subtitle("b", 1, 4, 5, [w1, w2]);
  const result = resolveRippleDelete([deleted, after], new Set(["a"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const shifted = result.subtitles[0];
  assert.equal(shifted.words[0].start, 2);
  assert.equal(shifted.words[0].end, 2.5);
  assert.equal(shifted.words[0].end - shifted.words[0].start, w1.end - w1.start);
  assert.equal(shifted.words[1].start, 2.5);
  assert.equal(shifted.words[1].end, 3);
  assert.ok(shifted.words[0].end <= shifted.words[1].start, "word ordering preserved");
});

test("resolveRippleDelete: word/caption metadata (confidence, style, removed, hinglishText, gujaratiScriptText) is preserved exactly on shifted captions", () => {
  const deleted = subtitle("a", 0, 0, 2, [word("hi", 0, 2)]);
  const w = word("kept", 4, 5, { confidence: 0.42, style: { fontWeight: 700 }, removed: true, hinglishText: "kayapt", gujaratiScriptText: "કેપ્ટ" });
  const after = subtitle("b", 1, 4, 6, [w, word("extra", 5, 6)], { style: { color: "#00ff00" }, hinglishText: "capB", gujaratiScriptText: "કેપબી" });
  const result = resolveRippleDelete([deleted, after], new Set(["a"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const shifted = result.subtitles[0];
  assert.deepEqual(shifted.style, { color: "#00ff00" });
  assert.equal(shifted.hinglishText, "capB");
  assert.equal(shifted.gujaratiScriptText, "કેપબી");
  const shiftedWord = shifted.words[0];
  assert.equal(shiftedWord.confidence, 0.42);
  assert.deepEqual(shiftedWord.style, { fontWeight: 700 });
  assert.equal(shiftedWord.removed, true);
  assert.equal(shiftedWord.hinglishText, "kayapt");
  assert.equal(shiftedWord.gujaratiScriptText, "કેપ્ટ");
});

test("resolveRippleDelete: reindexes captions correctly after the deleted block, preserves ordering", () => {
  const subs = [
    subtitle("a", 0, 0, 1, []),
    subtitle("b", 1, 1, 2, []),
    subtitle("c", 2, 2, 3, []),
    subtitle("d", 3, 3, 4, []),
  ];
  const result = resolveRippleDelete(subs, new Set(["b", "c"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.subtitles.map((s) => s.id), ["a", "d"]);
  assert.deepEqual(result.subtitles.map((s) => s.index), [0, 1]);
});

test("resolveRippleDelete: deleting the LAST caption(s) in the project — nothing after to shift, still succeeds as one operation", () => {
  const a = subtitle("a", 0, 0, 2, []);
  const b = subtitle("b", 1, 2, 4, []);
  const result = resolveRippleDelete([a, b], new Set(["b"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitles.length, 1);
  assert.equal(result.subtitles[0], a, "the only remaining caption is untouched, same reference");
});

test("resolveRippleDelete: deleting the FIRST caption in the project never produces a negative timestamp", () => {
  const a = subtitle("a", 0, 0, 3, []);
  const b = subtitle("b", 1, 3, 5, []);
  const result = resolveRippleDelete([a, b], new Set(["a"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtitles[0].start, 0);
  assert.equal(result.subtitles[0].end, 2);
  assert.ok(result.subtitles[0].start >= 0);
});

test("resolveRippleDelete: deleting ALL captions is contiguous-by-definition and succeeds with an empty result", () => {
  const a = subtitle("a", 0, 0, 2, []);
  const b = subtitle("b", 1, 2, 4, []);
  const result = resolveRippleDelete([a, b], new Set(["a", "b"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.subtitles, []);
});

// ============================== Task 125843 (P19.5) — mandatory non-monotonic word-order regression ==============================
// The task's own worked example: BRAVO/DELTA/CHARLIE, deliberately in NON-chronological array
// order (DELTA sits before CHARLIE despite ending after it) — the same fixture P18.6+ established
// for every other structural operation (split/merge/reorder). Ripple delete must shift every
// surviving word by the caption's own delta WITHOUT ever re-sorting the array or otherwise
// confusing array position for chronological order.
test("resolveRippleDelete: non-monotonic word array order is preserved exactly — words shift by delta, array order untouched", () => {
  const deleted = subtitle("intro", 0, 0, 1, [word("hi", 0, 1)]);
  const nonMono = subtitle(
    "nonmono",
    1,
    2,
    6,
    [word("BRAVO", 2, 3), word("DELTA", 5, 6), word("CHARLIE", 3.5, 4.5)], // array order != chronological order
  );
  const result = resolveRippleDelete([deleted, nonMono], new Set(["intro"]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const shifted = result.subtitles[0];
  // delta = deleted's own span = 1 - 0 = 1
  assert.equal(shifted.start, 1);
  assert.equal(shifted.end, 5);
  // Array order is EXACTLY unchanged (still BRAVO, DELTA, CHARLIE at indices 0,1,2) — never
  // re-sorted into chronological order even though it now spans a shifted-but-still-non-monotonic
  // range. Each word's own identity travels with it, shifted by exactly -1.
  assert.equal(shifted.words[0].text, "BRAVO");
  assert.equal(shifted.words[0].start, 1);
  assert.equal(shifted.words[0].end, 2);
  assert.equal(shifted.words[1].text, "DELTA");
  assert.equal(shifted.words[1].start, 4);
  assert.equal(shifted.words[1].end, 5);
  assert.equal(shifted.words[2].text, "CHARLIE");
  assert.equal(shifted.words[2].start, 2.5);
  assert.equal(shifted.words[2].end, 3.5);
  // The fixture is still genuinely non-monotonic after the shift (array index 1 chronologically
  // AFTER array index 2) — proving this test exercises the real hazard, not an accidentally-sorted
  // fixture.
  assert.ok(shifted.words[1].start > shifted.words[2].start, "fixture must remain non-monotonic after shifting for this test to prove anything");
});

// ============================== validateRippleDeleteResult (Task 125843, P19.5 defense-in-depth) ==============================

test("validateRippleDeleteResult: a normal, valid ripple-delete result passes", () => {
  const a = subtitle("a", 0, 0, 2, []);
  const b = subtitle("b", 1, 4, 6, []);
  assert.equal(validateRippleDeleteResult([a, shiftSubtitleByDelta(b, -2)]), true);
});

test("validateRippleDeleteResult: rejects a caption with end <= start", () => {
  const bad = subtitle("a", 0, 2, 2, []); // zero duration
  assert.equal(validateRippleDeleteResult([bad]), false);
  const bad2 = subtitle("b", 0, 2, 1, []); // inverted
  assert.equal(validateRippleDeleteResult([bad2]), false);
});

test("validateRippleDeleteResult: rejects a caption starting before 0", () => {
  const bad = subtitle("a", 0, -0.5, 1, []);
  assert.equal(validateRippleDeleteResult([bad]), false);
});

test("validateRippleDeleteResult: rejects two consecutive captions that overlap", () => {
  const a = subtitle("a", 0, 0, 3, []);
  const b = subtitle("b", 1, 2, 4, []); // starts before a's own end
  assert.equal(validateRippleDeleteResult([a, b]), false);
});

test("validateRippleDeleteResult: accepts back-to-back (touching, non-overlapping) captions", () => {
  const a = subtitle("a", 0, 0, 2, []);
  const b = subtitle("b", 1, 2, 4, []); // starts exactly where a ends — touching, not overlapping
  assert.equal(validateRippleDeleteResult([a, b]), true);
});

test("validateRippleDeleteResult: an empty array is trivially valid", () => {
  assert.equal(validateRippleDeleteResult([]), true);
});

// ============================== resolveRippleInsert ==============================

test("resolveRippleInsert: zero duration is rejected", () => {
  const result = resolveRippleInsert([], 5, 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid-duration");
});

test("resolveRippleInsert: negative duration is rejected", () => {
  const result = resolveRippleInsert([], 5, -1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid-duration");
});

test("resolveRippleInsert: NaN/Infinity duration is rejected", () => {
  assert.equal(resolveRippleInsert([], 5, NaN).ok, false);
  assert.equal(resolveRippleInsert([], 5, Infinity).ok, false);
});

test("resolveRippleInsert: negative insertion point is rejected", () => {
  const result = resolveRippleInsert([], -1, 2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid-insertion-point");
});

test("resolveRippleInsert: the task's own worked example — insert +2s at t=10, captions before unchanged, after shift", () => {
  const before = subtitle("a", 0, 5, 8, [word("x", 5, 8)]);
  const after = subtitle("b", 1, 10, 12, [word("y", 10, 12)]);
  const result = resolveRippleInsert([before, after], 10, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.affectedCount, 1);
  assert.equal(result.subtitles[0], before, "entirely-before caption is untouched, same reference");
  assert.equal(result.subtitles[1].start, 12);
  assert.equal(result.subtitles[1].end, 14);
  assert.equal(result.subtitles[1].words[0].start, 12);
  assert.equal(result.subtitles[1].words[0].end, 14);
});

test("resolveRippleInsert: a caption strictly crossing the insertion point is rejected, not guessed", () => {
  // Caption 9.0-12.0, insert +2s at 10.0 — the task's own explicit ambiguous case.
  const crossing = subtitle("a", 0, 9, 12, [word("x", 9, 12)]);
  const result = resolveRippleInsert([crossing], 10, 2);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "crosses-caption");
    assert.equal(result.crossingSubtitleId, "a");
  }
});

test("resolveRippleInsert: a caption ending EXACTLY at the insertion point is 'before' and stays unchanged (boundary touch, not a cross)", () => {
  const touching = subtitle("a", 0, 8, 10, [word("x", 8, 10)]);
  const result = resolveRippleInsert([touching], 10, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.affectedCount, 0);
  assert.equal(result.subtitles[0], touching);
});

test("resolveRippleInsert: a caption starting EXACTLY at the insertion point shifts (boundary touch, not a cross)", () => {
  const touching = subtitle("a", 0, 10, 12, [word("x", 10, 12)]);
  const result = resolveRippleInsert([touching], 10, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.affectedCount, 1);
  assert.equal(result.subtitles[0].start, 12);
});

test("resolveRippleInsert: insert at t=0 shifts every caption in the project", () => {
  const a = subtitle("a", 0, 0, 2, [word("x", 0, 2)]);
  const b = subtitle("b", 1, 2, 4, [word("y", 2, 4)]);
  const result = resolveRippleInsert([a, b], 0, 3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.affectedCount, 2);
  assert.equal(result.subtitles[0].start, 3);
  assert.equal(result.subtitles[1].start, 5);
});

test("resolveRippleInsert: insert past every caption's end is a valid no-op — zero affected, no rejection", () => {
  const a = subtitle("a", 0, 0, 2, [word("x", 0, 2)]);
  const result = resolveRippleInsert([a], 100, 5);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.affectedCount, 0);
  assert.equal(result.subtitles[0], a, "unaffected caption keeps its exact reference");
});

test("resolveRippleInsert: metadata (confidence, style, removed, derived text) preserved exactly on shifted captions", () => {
  const w = word("kept", 10, 11, { confidence: 0.7, style: { fontWeight: 700 }, removed: true, hinglishText: "hi", gujaratiScriptText: "હાય" });
  const s = subtitle("a", 0, 10, 11, [w], { style: { color: "#123456" }, hinglishText: "capA", gujaratiScriptText: "કેપએ" });
  const result = resolveRippleInsert([s], 5, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const shifted = result.subtitles[0];
  assert.deepEqual(shifted.style, { color: "#123456" });
  assert.equal(shifted.hinglishText, "capA");
  assert.equal(shifted.gujaratiScriptText, "કેપએ");
  assert.equal(shifted.words[0].confidence, 0.7);
  assert.deepEqual(shifted.words[0].style, { fontWeight: 700 });
  assert.equal(shifted.words[0].removed, true);
  assert.equal(shifted.words[0].hinglishText, "hi");
  assert.equal(shifted.words[0].gujaratiScriptText, "હાય");
});
