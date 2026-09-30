/**
 * Store-level tests for word reorder (Task 113528, P18.6) — exercises the REAL editor store:
 * one commit (one undo step) per successful operation, undo/redo, the `dirty` flag autosave
 * watches, quality-report staleness, caption-level derived-text clearing, selection follow, and —
 * critically for P18.2 — that a reorder inside one caption leaves every OTHER caption's object
 * reference completely unchanged, at scale.
 *
 * Run with: node --test src/store/__tests__/editor-store-word-reorder.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality, isQualityReportStale } from "../../lib/subtitles/quality-analyzer.ts";
import { isWordTimingStale } from "../../lib/subtitles/word-timing.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 4,
      text: "this is a test",
      words: [
        { text: "this", start: 0, end: 1, confidence: 0.9 },
        { text: "is", start: 1, end: 2, confidence: 0.8, style: { fontWeight: 700 } },
        { text: "a", start: 2, end: 3 },
        { text: "test", start: 3, end: 4, confidence: 0.7, hinglishText: "test", gujaratiScriptText: "ટેસ્ટ" },
      ],
      hinglishText: "this is a test",
      gujaratiScriptText: "this is a test",
    },
    { id: "b", index: 1, start: 5, end: 6, text: "next", words: [{ text: "next", start: 5, end: 6 }] },
  ];
  return {
    id: "p1",
    name: "Word reorder fixture",
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

test("reorderWord: moves the word, rebuilds .text, one commit", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const result = store.reorderWord("a", 3, 1); // "test" moves to index 1: this test is a
  assert.equal(result, "ok");

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1, "exactly one commit");
  const a = after.project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["this", "test", "is", "a"]);
  assert.equal(a.text, "this test is a");
});

test("reorderWord: word timing is EXACTLY unchanged per word (travels with the object, not the slot)", () => {
  useEditorStore.getState().reorderWord("a", 3, 1);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  const moved = a.words.find((w) => w.text === "test")!;
  assert.equal(moved.start, 3);
  assert.equal(moved.end, 4);
});

test("reorderWord: caption start/end/duration are exactly unchanged", () => {
  useEditorStore.getState().reorderWord("a", 3, 1);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.start, 0);
  assert.equal(a.end, 4);
});

test("reorderWord: isWordTimingStale stays false — same word count, just resynced .text", () => {
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(isWordTimingStale(before), false);
  useEditorStore.getState().reorderWord("a", 3, 1);
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(isWordTimingStale(after), false, "reorder must never make an already-fresh caption look stale");
});

test("reorderWord: confidence, style, and per-word derived fields are preserved exactly", () => {
  useEditorStore.getState().reorderWord("a", 3, 1);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  const isWord = a.words.find((w) => w.text === "is")!;
  const testWord = a.words.find((w) => w.text === "test")!;
  assert.equal(isWord.confidence, 0.8);
  assert.deepEqual(isWord.style, { fontWeight: 700 });
  assert.equal(testWord.hinglishText, "test");
  assert.equal(testWord.gujaratiScriptText, "ટેસ્ટ");
});

test("reorderWord: removed state is preserved exactly on the moved word", () => {
  // Its own isolated fixture — sumWordTokens (word-timing.ts) deliberately excludes removed
  // words from its count, while this codebase's existing .text-rebuild convention (split/merge/
  // delete/insert, all unchanged by this task) does NOT filter removed words out of `.text` —
  // pre-existing, unrelated to reorder, so this test only checks what THIS task actually owns
  // (does `removed` travel with the word object) rather than mixing in isWordTimingStale.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "a",
          index: 0,
          start: 0,
          end: 3,
          text: "keep gone keep2",
          words: [
            { text: "keep", start: 0, end: 1 },
            { text: "gone", start: 1, end: 2, removed: true },
            { text: "keep2", start: 2, end: 3 },
          ],
        },
      ],
    }),
  );
  useEditorStore.getState().reorderWord("a", 1, 0); // "gone" moves to the front
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  const moved = a.words.find((w) => w.text === "gone")!;
  assert.equal(moved.removed, true, "removed state travels with the word object, never silently cleared or flipped");
});

test("reorderWord: clears the caption-level hinglishText/gujaratiScriptText cache (same as split/merge/insert)", () => {
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(before.hinglishText, "this is a test");
  useEditorStore.getState().reorderWord("a", 3, 1);
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(after.hinglishText, undefined, "caption-level cache cleared, forces lazy regeneration from the NEW word order");
  assert.equal(after.gujaratiScriptText, undefined);
});

test("reorderWord: does not touch the unrelated caption 'b'", () => {
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  useEditorStore.getState().reorderWord("a", 3, 1);
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(after, before, "unrelated caption keeps its exact object reference");
});

test("reorderWord: selection follows the moved word to its new index", () => {
  useEditorStore.getState().reorderWord("a", 3, 1);
  assert.equal(useEditorStore.getState().selectedWordIndex, 1);
});

test("reorderWord: undo restores exact original order, timing, and metadata", () => {
  useEditorStore.getState().reorderWord("a", 3, 1);
  useEditorStore.getState().undo();
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["this", "is", "a", "test"]);
  assert.equal(a.text, "this is a test");
  assert.equal(a.hinglishText, "this is a test", "undo restores the ORIGINAL caption-level cache too, not just word order");
  const testWord = a.words.find((w) => w.text === "test")!;
  assert.equal(testWord.confidence, 0.7);
});

test("reorderWord: redo re-applies the exact same reorder", () => {
  useEditorStore.getState().reorderWord("a", 3, 1);
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["this", "test", "is", "a"]);
});

test("reorderWord: sets dirty (autosave watches this)", () => {
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().reorderWord("a", 3, 1);
  assert.equal(useEditorStore.getState().dirty, true);
});

test("reorderWord: marks an existing quality report stale via the normal reference mechanism, no new quality state", () => {
  const project = useEditorStore.getState().project!;
  const report = analyzeSubtitleQuality(project.subtitles, project.timingRules);
  useEditorStore.setState({ qualityReport: report, qualityReportSubtitles: project.subtitles });
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles), false);

  useEditorStore.getState().reorderWord("a", 3, 1);

  assert.equal(
    isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles),
    true,
    "reorder is a subtitle mutation — the existing reference-inequality staleness check must catch it automatically",
  );
});

test("reorderWord: works identically while captionOutputMode is hinglish or gujarati-script (available in every mode)", () => {
  useEditorStore.getState().load(fixtureProject({ captionOutputMode: "hinglish" }));
  const result = useEditorStore.getState().reorderWord("a", 3, 1);
  assert.equal(result, "ok");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["this", "test", "is", "a"]);
});

test("reorderWord: no-op move (fromIndex === toIndex) is rejected, no commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().reorderWord("a", 1, 1);
  assert.equal(result, "noop");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("reorderWord: invalid index is rejected, no commit, no partial mutation", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().reorderWord("a", 0, 99);
  assert.equal(result, "invalid-index");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
  assert.equal(useEditorStore.getState().project!.subtitles, before);
});

test("reorderWord: unknown subtitleId is rejected as not-found, no commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().reorderWord("ghost", 0, 1);
  assert.equal(result, "not-found");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

// ============================== performance / reference stability at scale ==============================

function buildLargeProject(captionCount: number, targetWordCount: number, targetCaptionIndex: number): ProjectData {
  const subtitles: Subtitle[] = [];
  for (let i = 0; i < captionCount; i++) {
    const start = i * 20;
    const wordCount = i === targetCaptionIndex ? targetWordCount : 2;
    const words = [];
    for (let w = 0; w < wordCount; w++) {
      words.push({ text: `w${w}`, start: start + w, end: start + w + 1 });
    }
    subtitles.push({ id: `s${i}`, index: i, start, end: start + wordCount, text: words.map((w) => w.text).join(" "), words });
  }
  return {
    id: "big",
    name: "Large word-reorder fixture",
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
  };
}

const WORD_COUNTS = [1, 5, 20, 100, 500];
const CAPTION_COUNTS = [30, 300, 1800, 3600, 5400];

for (const captionCount of CAPTION_COUNTS) {
  for (const wordCount of WORD_COUNTS) {
    if (wordCount < 2) continue; // a reorder needs at least 2 words to be a non-noop move
    test(`performance: reorderWord on a caption with ${wordCount} words stays fast at ${captionCount} total captions, unrelated captions keep their exact references`, () => {
      const targetIndex = Math.floor(captionCount / 2);
      useEditorStore.getState().load(buildLargeProject(captionCount, wordCount, targetIndex));
      const before = useEditorStore.getState().project!.subtitles;
      const targetId = `s${targetIndex}`;

      const start = performance.now();
      const result = useEditorStore.getState().reorderWord(targetId, 0, wordCount - 1);
      const elapsedMs = performance.now() - start;

      assert.equal(result, "ok");
      assert.ok(
        elapsedMs < 150,
        `reorderWord took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions / ${wordCount} words — expected well under 150ms`,
      );

      const after = useEditorStore.getState().project!.subtitles;
      assert.equal(after.length, captionCount, "no caption added or removed");
      for (let i = 0; i < captionCount; i++) {
        if (i === targetIndex) continue;
        assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference — only the reordered caption should change`);
      }
    });
  }
}
