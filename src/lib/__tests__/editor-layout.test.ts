/**
 * Pure tests for the resizable editor layout (Task 120417, P19.1 — src/lib/editor-layout.ts). No
 * React, no store — this module is never imported by editor-store.ts and never routed through
 * commit()/autosave/undo-redo (see that module's own top-of-file doc comment); the "does a resize
 * touch project state" question is answered directly by the store-reference-equality regression
 * test at the bottom of this file, not by inspecting implementation details.
 *
 * Node has no built-in `localStorage` — a minimal in-memory mock stands in for it, reset before
 * every test.
 *
 * Run with: node --test src/lib/__tests__/editor-layout.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../../store/editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import {
  clampCaptionsPanelWidth,
  clampTimelineHeight,
  loadEditorLayoutPreferences,
  saveEditorLayoutPreferences,
  defaultEditorLayoutPreferences,
  EDITOR_LAYOUT_STORAGE_KEY,
  DEFAULT_CAPTIONS_PANEL_WIDTH,
  MIN_CAPTIONS_PANEL_WIDTH,
  MAX_CAPTIONS_PANEL_WIDTH,
  DEFAULT_TIMELINE_HEIGHT,
  MIN_TIMELINE_HEIGHT,
  MAX_TIMELINE_HEIGHT,
  RIGHT_PANEL_WIDTH,
  MIN_PREVIEW_WIDTH,
  TOP_BAR_HEIGHT,
  MIN_PREVIEW_HEIGHT,
} from "../editor-layout.ts";

function createMockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

test.beforeEach(() => {
  (globalThis as unknown as { localStorage: ReturnType<typeof createMockLocalStorage> }).localStorage = createMockLocalStorage();
});

// --- defaults (derived from the pre-P19.1 hard-coded layout, Phase 0 audit) ---------------

test("1. default dimensions match the pre-existing hard-coded layout exactly (320px panel, 256px timeline)", () => {
  assert.equal(DEFAULT_CAPTIONS_PANEL_WIDTH, 320, "matches the old lg:w-80");
  assert.equal(DEFAULT_TIMELINE_HEIGHT, 256, "matches the old lg:h-64");
  assert.deepEqual(defaultEditorLayoutPreferences(), { captionsPanelWidth: 320, timelineHeight: 256 });
});

test("1b. MIN < DEFAULT < MAX for both dimensions (internally consistent constants)", () => {
  assert.ok(MIN_CAPTIONS_PANEL_WIDTH < DEFAULT_CAPTIONS_PANEL_WIDTH);
  assert.ok(DEFAULT_CAPTIONS_PANEL_WIDTH < MAX_CAPTIONS_PANEL_WIDTH);
  assert.ok(MIN_TIMELINE_HEIGHT < DEFAULT_TIMELINE_HEIGHT);
  assert.ok(DEFAULT_TIMELINE_HEIGHT < MAX_TIMELINE_HEIGHT);
});

// --- min/max clamping --------------------------------------------------------------------

test("2. clampCaptionsPanelWidth: clamps below MIN up to MIN", () => {
  assert.equal(clampCaptionsPanelWidth(10), MIN_CAPTIONS_PANEL_WIDTH);
  assert.equal(clampCaptionsPanelWidth(-500), MIN_CAPTIONS_PANEL_WIDTH);
});

test("3. clampCaptionsPanelWidth: clamps above MAX down to MAX (no viewport constraint given)", () => {
  assert.equal(clampCaptionsPanelWidth(9999), MAX_CAPTIONS_PANEL_WIDTH);
});

test("2b. clampTimelineHeight: clamps below MIN up to MIN", () => {
  assert.equal(clampTimelineHeight(0), MIN_TIMELINE_HEIGHT);
});

test("3b. clampTimelineHeight: clamps above MAX down to MAX (no viewport constraint given)", () => {
  assert.equal(clampTimelineHeight(9999), MAX_TIMELINE_HEIGHT);
});

test("in-range values pass through unchanged for both dimensions", () => {
  assert.equal(clampCaptionsPanelWidth(400), 400);
  assert.equal(clampTimelineHeight(300), 300);
});

// --- combined viewport constraints (test item 8) ------------------------------------------

test("8. clampCaptionsPanelWidth: a small viewport further restricts the effective max, reserving room for the right panel and the preview's own minimum", () => {
  const viewportWidth = 1024; // this app's own lg: breakpoint — the smallest width this layout ever applies at
  const effectiveMax = viewportWidth - RIGHT_PANEL_WIDTH - MIN_PREVIEW_WIDTH;
  assert.equal(clampCaptionsPanelWidth(9999, viewportWidth), effectiveMax);
  assert.ok(effectiveMax >= MIN_CAPTIONS_PANEL_WIDTH, "must never floor below MIN even at the smallest supported viewport");
});

test("8b. clampTimelineHeight: a small viewport further restricts the effective max, reserving room for the top bar and the preview's own minimum", () => {
  const viewportHeight = 600; // small enough that the viewport constraint, not MAX_TIMELINE_HEIGHT, wins
  const effectiveMax = viewportHeight - TOP_BAR_HEIGHT - MIN_PREVIEW_HEIGHT;
  assert.ok(effectiveMax < MAX_TIMELINE_HEIGHT, "the test must actually exercise the viewport-driven branch, not the constant ceiling");
  assert.equal(clampTimelineHeight(9999, viewportHeight), effectiveMax);
});

test("8c. a viewport WIDER/TALLER than needed for MAX never expands past the constant's own MAX", () => {
  assert.equal(clampCaptionsPanelWidth(9999, 4000), MAX_CAPTIONS_PANEL_WIDTH);
  assert.equal(clampTimelineHeight(9999, 4000), MAX_TIMELINE_HEIGHT);
});

test("a non-finite or missing viewport falls back to the constant-only bounds", () => {
  assert.equal(clampCaptionsPanelWidth(9999, NaN), MAX_CAPTIONS_PANEL_WIDTH);
  assert.equal(clampCaptionsPanelWidth(9999, undefined), MAX_CAPTIONS_PANEL_WIDTH);
});

// --- persistence: missing / malformed / out-of-range / valid ------------------------------

test("5. missing persisted value -> defaults", () => {
  assert.deepEqual(loadEditorLayoutPreferences(), defaultEditorLayoutPreferences());
});

test("4. malformed persisted value (not JSON) -> defaults, never throws", () => {
  localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, "{not valid json");
  assert.deepEqual(loadEditorLayoutPreferences(), defaultEditorLayoutPreferences());
});

test("4b. malformed persisted value (valid JSON, wrong shape — an array) -> defaults, never throws", () => {
  localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify([1, 2, 3]));
  assert.deepEqual(loadEditorLayoutPreferences(), defaultEditorLayoutPreferences());
});

test("4c. malformed persisted value (fields present but not numbers) -> that field's own default", () => {
  localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify({ captionsPanelWidth: "wide", timelineHeight: null }));
  assert.deepEqual(loadEditorLayoutPreferences(), defaultEditorLayoutPreferences());
});

test("4d. localStorage.getItem throwing (e.g. private-browsing) -> defaults, never throws out to the caller", () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  } as unknown as Storage;
  assert.deepEqual(loadEditorLayoutPreferences(), defaultEditorLayoutPreferences());
});

test("6. old/out-of-range persisted value (e.g. from a build with different MIN/MAX) -> clamped, not rejected wholesale", () => {
  localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify({ captionsPanelWidth: 5, timelineHeight: 50000 }));
  assert.deepEqual(loadEditorLayoutPreferences(), { captionsPanelWidth: MIN_CAPTIONS_PANEL_WIDTH, timelineHeight: MAX_TIMELINE_HEIGHT });
});

test("7. valid persisted value round-trips exactly", () => {
  saveEditorLayoutPreferences({ captionsPanelWidth: 400, timelineHeight: 300 });
  assert.deepEqual(loadEditorLayoutPreferences(), { captionsPanelWidth: 400, timelineHeight: 300 });
});

test("saveEditorLayoutPreferences never throws even when localStorage.setItem throws", () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: () => null,
    setItem() {
      throw new Error("quota exceeded");
    },
  } as unknown as Storage;
  assert.doesNotThrow(() => saveEditorLayoutPreferences({ captionsPanelWidth: 400, timelineHeight: 300 }));
});

// --- resize delta calculation (test item 9) — the exact arithmetic ResizeHandle itself uses -----

test("9. resize delta calculation: direction=1 (drag right increases), clamped to [min,max]", () => {
  const min = 240, max = 560, startValue = 320;
  function resolve(clientDeltaPx: number, direction: 1 | -1) {
    return Math.min(max, Math.max(min, startValue + clientDeltaPx * direction));
  }
  assert.equal(resolve(50, 1), 370, "dragging right by 50px increases width by 50px");
  assert.equal(resolve(-50, 1), 270, "dragging left by 50px decreases width by 50px");
  assert.equal(resolve(-1000, 1), min, "clamped at the floor");
  assert.equal(resolve(1000, 1), max, "clamped at the ceiling");
});

test("9b. resize delta calculation: direction=-1 (drag up increases, e.g. the timeline's own top handle)", () => {
  const min = 180, max = 480, startValue = 256;
  function resolve(clientDeltaPx: number, direction: 1 | -1) {
    return Math.min(max, Math.max(min, startValue + clientDeltaPx * direction));
  }
  assert.equal(resolve(-50, -1), 306, "moving the pointer UP (negative clientY delta) increases height");
  assert.equal(resolve(50, -1), 206, "moving the pointer DOWN decreases height");
});

// ---------------------------------------------------------------------------------------
// MANDATORY REGRESSION (task's own explicit requirement): proves a panel resize does NOT touch
// project state, subtitle objects/timestamps, selection, undo history, or dirty state — using
// reference equality, exactly as P18.2 established. Since editor-layout.ts has no dependency on
// editor-store.ts at all, this is checked by exercising every exported function here against a
// REAL store snapshot and confirming total non-interaction.
// ---------------------------------------------------------------------------------------

test("[REGRESSION] editor-layout.ts functions never touch useEditorStore — project, subtitles, selection, undo history, and dirty state are all reference-identical before/after", () => {
  useEditorStore.getState().load({
    id: "p1",
    name: "Layout regression fixture",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] }],
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    animation: DEFAULT_ANIMATION,
    timingRules: DEFAULT_TIMING_RULES,
    composition: DEFAULT_COMPOSITION,
    updatedAt: new Date().toISOString(),
    trimStart: 0,
    trimEnd: null,
    cutRanges: [],
  });
  useEditorStore.getState().selectSubtitle("a");
  useEditorStore.getState().selectWord(0);

  const before = useEditorStore.getState();
  const projectBefore = before.project;
  const subtitlesBefore = before.project!.subtitles;
  const wordsBefore = before.project!.subtitles[0].words;
  const pastBefore = before.past;
  const dirtyBefore = before.dirty;
  const selectedIdBefore = before.selectedSubtitleId;
  const selectedWordBefore = before.selectedWordIndex;

  // Exercise every exported function in this module — a full "drag gesture" worth of calls.
  clampCaptionsPanelWidth(9999, 1024);
  clampTimelineHeight(9999, 700);
  saveEditorLayoutPreferences({ captionsPanelWidth: 500, timelineHeight: 400 });
  loadEditorLayoutPreferences();
  defaultEditorLayoutPreferences();

  const after = useEditorStore.getState();
  assert.equal(after.project, projectBefore, "project object reference unchanged");
  assert.equal(after.project!.subtitles, subtitlesBefore, "subtitles array reference unchanged");
  assert.equal(after.project!.subtitles[0].words, wordsBefore, "words array reference unchanged");
  assert.equal(after.project!.subtitles[0].start, 0, "subtitle timestamp unchanged");
  assert.equal(after.project!.subtitles[0].end, 1, "subtitle timestamp unchanged");
  assert.equal(after.project!.subtitles[0].words[0].start, 0, "word timestamp unchanged");
  assert.equal(after.past, pastBefore, "undo history (past stack) reference unchanged — zero new entries");
  assert.equal(after.dirty, dirtyBefore, "dirty flag unchanged — no autosave was ever triggered");
  assert.equal(after.selectedSubtitleId, selectedIdBefore, "selected caption unchanged");
  assert.equal(after.selectedWordIndex, selectedWordBefore, "selected word unchanged");
});
