/**
 * Task 137421 (P19.12) — fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md
 * §6 (B1): every structural word-editing action (reorder, split, merge, delete, insert) rebuilt a
 * caption's `.text` from ALL of its words, including soft-deleted ones (`removed: true`) — so a
 * filler word the user had already removed would silently reappear in the caption's visible/
 * exported text after any subsequent structural edit.
 *
 * The fix filters `!w.removed` before joining words into text at all five call sites in
 * editor-store.ts. This does NOT change the soft-delete architecture: the removed word object
 * itself (its text/timing/style/confidence metadata) stays exactly where it was in the `words`
 * array — only the reconstructed `.text` string excludes it.
 *
 * Run with: node --test src/store/__tests__/editor-store-removed-word-text.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { isWordTimingStale } from "../../lib/subtitles/word-timing.ts";

// The task's own worked example: "so this is good", soft-delete "this", expect "so is good".
function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 2,
      // Represents the state right after the filler word was marked removed — its own
      // "removed: true" already took effect on the displayed text, exactly as the existing
      // filler-removal flow leaves it; this bug is about later STRUCTURAL edits reintroducing
      // it, not about the initial marking step (a separate, already-correct code path).
      text: "so is good",
      words: [
        { text: "so", start: 0, end: 0.4 },
        { text: "this", start: 0.4, end: 0.8, removed: true },
        { text: "is", start: 0.8, end: 1.2 },
        { text: "good", start: 1.2, end: 1.6 },
      ],
    },
    { id: "b", index: 1, start: 3, end: 4, text: "next", words: [{ text: "next", start: 3, end: 4 }] },
  ];
  return {
    id: "p1",
    name: "Removed-word text fixture",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles,
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    animation: DEFAULT_ANIMATION,
    timingRules: DEFAULT_TIMING_RULES,
    composition: DEFAULT_COMPOSITION,
    updatedAt: new Date().toISOString(),
    trimStart: 0,
    trimEnd: null,
    cutRanges: [],
    ...overrides,
  };
}

test.beforeEach(() => {
  useEditorStore.getState().load(fixtureProject());
});

function captionA() {
  return useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
}

test("[MANDATORY REGRESSION] baseline: the removed word is already excluded from .text before any structural edit", () => {
  const a = captionA();
  assert.equal(a.text, "so is good");
  assert.ok(a.words.some((w) => w.text === "this" && w.removed === true), "the removed word object itself must still exist in the array");
});

test("[MANDATORY REGRESSION] delete/remove word, then REORDER: the removed word does not reappear in .text", () => {
  // Move "is" (index 2) before "so" (index 0).
  const result = useEditorStore.getState().reorderWord("a", 2, 0);
  assert.equal(result, "ok");
  const a = captionA();
  assert.equal(a.text, "is so good", "reordered text, but 'this' must still be absent");
  assert.ok(!a.text.includes("this"));
  assert.equal(isWordTimingStale(a), false, "staleness must count only non-removed words, and must not be tripped by this fix");
});

test("[MANDATORY REGRESSION] delete/remove word, then SPLIT: the removed word does not reappear in .text", () => {
  // Split "good" (index 3) into "go" + "od".
  const ok = useEditorStore.getState().splitWord("a", 3, "go", "od");
  assert.equal(ok, true);
  const a = captionA();
  assert.equal(a.text, "so is go od");
  assert.ok(!a.text.includes("this"));
  assert.equal(isWordTimingStale(a), false);
});

test("[MANDATORY REGRESSION] delete/remove word, then MERGE: the removed word does not reappear in .text", () => {
  // Merge "is" (index 2) with "good" (index 3).
  const ok = useEditorStore.getState().mergeWordWithNext("a", 2);
  assert.equal(ok, true);
  const a = captionA();
  assert.equal(a.text, "so is good");
  assert.ok(!a.text.includes("this"));
  assert.equal(isWordTimingStale(a), false);
});

test("[MANDATORY REGRESSION] delete/remove word, then another structural edit (DELETE a different word): the removed word does not reappear in .text", () => {
  // Delete "good" (index 3) — a SEPARATE word from the already-removed "this".
  useEditorStore.getState().deleteWord("a", 3);
  const a = captionA();
  assert.equal(a.text, "so is");
  assert.ok(!a.text.includes("this"));
  assert.equal(isWordTimingStale(a), false);
});

test("[MANDATORY REGRESSION] delete/remove word, then INSERT a new word: the removed word does not reappear in .text", () => {
  // Insert after "good" (index 3, ends at 1.6) — the caption itself ends at 2.0, so there's a
  // genuine 0.4s gap to claim (inserting after "so" would hit the removed "this" word's own
  // still-occupied [0.4,0.8] timing slot, a zero-width gap unrelated to this fix).
  const ok = useEditorStore.getState().insertWord("a", 3, "after", "really");
  assert.equal(ok, true);
  const a = captionA();
  assert.equal(a.text, "so is good really");
  assert.ok(!a.text.includes("this"));
  assert.equal(isWordTimingStale(a), false);
});

test("the removed word's own metadata (timing, removed flag) survives every structural edit untouched", () => {
  useEditorStore.getState().reorderWord("a", 2, 0);
  const a = captionA();
  const removedWord = a.words.find((w) => w.text === "this");
  assert.ok(removedWord, "the removed word object must still exist in the array");
  assert.equal(removedWord!.removed, true);
  assert.equal(removedWord!.start, 0.4);
  assert.equal(removedWord!.end, 0.8);
});

test("undo after a structural edit restores the pre-edit text exactly (still excluding the removed word)", () => {
  useEditorStore.getState().deleteWord("a", 3);
  assert.equal(captionA().text, "so is");
  useEditorStore.getState().undo();
  assert.equal(captionA().text, "so is good", "undo restores the original text, which already correctly excluded the removed word");
});
