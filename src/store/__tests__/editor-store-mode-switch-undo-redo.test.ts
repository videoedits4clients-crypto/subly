/**
 * Task 137421 (P19.12) — fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md
 * §6: undo/redo crossing an Original/Hinglish/Gujarati-Script output-mode switch could leave the
 * restored snapshot's captions with no `hinglishText`/`gujaratiScriptText` even though the editor
 * was still displaying that mode — because `captionOutputMode` lives OUTSIDE `HistorySnapshot`
 * (setCaptionOutputMode is deliberately not a commit), so undo/redo never regenerated derived text
 * for whatever mode the restored snapshot predates.
 *
 * The fix applies the SAME `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` gap-filling
 * regeneration `commit()`/`load()` already use, now also inside `undo()`/`redo()`, against the
 * CURRENT `captionOutputMode` — never overwriting existing (generated or user-edited) derived
 * text, only filling what a given restored snapshot is missing. Does not redesign display modes,
 * does not make derived modes editable copies of Original, does not touch the mode separation
 * itself or add a new persistence architecture.
 *
 * Run with: node --test src/store/__tests__/editor-store-mode-switch-undo-redo.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";

// Devanagari text so Hinglish (any Devanagari) and Gujarati Script (language: "gu") mode are both
// meaningfully reachable — the same convention editor-store-output-mode.test.ts already uses.
function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "a", index: 0, start: 0, end: 2, text: "नमस्ते दुनिया", words: [{ text: "नमस्ते", start: 0, end: 1 }, { text: "दुनिया", start: 1, end: 2 }] },
    { id: "b", index: 1, start: 3, end: 4, text: "ठीक है", words: [{ text: "ठीक", start: 3, end: 3.5 }, { text: "है", start: 3.5, end: 4 }] },
  ];
  return {
    id: "p1",
    name: "Mode-switch undo/redo fixture",
    status: "READY",
    language: "gu",
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

function everyCaptionHasHinglish(): boolean {
  return useEditorStore.getState().project!.subtitles.every((s) => s.hinglishText !== undefined && s.words.every((w) => w.hinglishText !== undefined));
}

// ============================== undo across a mode switch ==============================

test("[MANDATORY REGRESSION] Original -> edit -> switch to Hinglish -> edit -> UNDO across the switch -> derived text exists and is consistent", () => {
  // 1. Original mode, make a real commit.
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते दुनिया");
  // 2. Switch to derived mode (not a commit — captionOutputMode lives outside HistorySnapshot).
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  assert.ok(everyCaptionHasHinglish(), "switching to hinglish must generate derived text for every caption immediately");
  // 3. Make/edit state while in Hinglish mode — a real commit whose OWN "before" snapshot already
  //    has hinglishText (captured after step 2).
  useEditorStore.getState().updateSubtitleText("b", "sub-b edited");
  // 4. Undo across the mode switch — back past the point where hinglishText didn't exist yet.
  useEditorStore.getState().undo(); // undoes step 3's edit
  useEditorStore.getState().undo(); // undoes step 1's edit — now at the pre-Hinglish-generation snapshot
  // 5. The editor is STILL in hinglish mode (setCaptionOutputMode was never itself undone), so
  //    every caption must have valid, non-stale derived text right now, not after another commit.
  assert.equal(useEditorStore.getState().project!.captionOutputMode, "hinglish", "mode itself is untouched by undo");
  assert.ok(everyCaptionHasHinglish(), "[THE BUG THIS FIXES] every caption must have hinglishText immediately after undo, not left absent until the next commit/reload");
});

// ============================== redo across a mode switch ==============================

test("[MANDATORY REGRESSION] ... then REDO forward across the switch again -> derived text still exists and is consistent", () => {
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते दुनिया");
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().updateSubtitleText("b", "sub-b edited");
  useEditorStore.getState().undo();
  useEditorStore.getState().undo();
  assert.ok(everyCaptionHasHinglish());

  // Redo forward again, back across the same boundary.
  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  assert.ok(everyCaptionHasHinglish(), "derived text must remain present/consistent after redoing forward across the mode-switch boundary too");
});

// ============================== Gujarati Script mode (the SAME fix, the OTHER derived mode) ====

test("[MANDATORY REGRESSION] the same undo-across-a-mode-switch fix applies to Gujarati Script mode", () => {
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते दुनिया");
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  useEditorStore.getState().updateSubtitleText("b", "sub-b edited");
  useEditorStore.getState().undo();
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.captionOutputMode, "gujarati-script");
  const allHaveGujarati = useEditorStore
    .getState()
    .project!.subtitles.every((s) => s.gujaratiScriptText !== undefined && s.words.every((w) => w.gujaratiScriptText !== undefined));
  assert.ok(allHaveGujarati, "every caption must have gujaratiScriptText immediately after undo");
});

// ============================== does not overwrite existing / user-edited derived text ==========

test("undo/redo's regeneration NEVER overwrites a caption that already has its own (generated or user-edited) derived text", () => {
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  // User hand-edits the derived text for caption "a".
  useEditorStore.getState().updateSubtitleHinglishText("a", "My Own Custom Hinglish Text");
  useEditorStore.getState().updateSubtitleText("b", "sub-b edited"); // an unrelated real commit
  useEditorStore.getState().undo(); // undoes the "b" edit only
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.hinglishText, "My Own Custom Hinglish Text", "the user's own hand-edited derived text must survive an unrelated undo untouched");
});

// ============================== switching modes never creates its own undo entry (unchanged) ===

test("regression: setCaptionOutputMode itself still does not create an undo entry (this fix must not change that)", () => {
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "mode switching remains a non-undoable, non-commit action");
});

// ============================== word-level derived text also survives ==============================

test("word-level hinglishText (not just the caption-level cached field) is also regenerated after undo crosses the switch", () => {
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते दुनिया");
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().updateSubtitleText("b", "sub-b edited");
  useEditorStore.getState().undo();
  useEditorStore.getState().undo();
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.ok(a.words.every((w) => w.hinglishText !== undefined), "every WORD's own hinglishText, not just the caption-level cache, must be present");
});

// ============================== performance ==============================
// undo()/redo() now also run ensureHinglishCoverage/ensureGujaratiScriptCoverage (an O(n)
// `.every()` early-exit scan that returns the SAME array reference — no allocation — whenever
// nothing needs regenerating, the overwhelming majority of real undo/redo calls). Verifies this
// added O(n) scan stays comfortably within budget even at 5400 captions, in BOTH the common
// "nothing to regenerate" case and the "actually regenerating everything" case this task added.

function manyDevanagariCaptions(count: number): Subtitle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    index: i,
    start: i,
    end: i + 0.9,
    text: "नमस्ते दुनिया",
    words: [
      { text: "नमस्ते", start: i, end: i + 0.4 },
      { text: "दुनिया", start: i + 0.4, end: i + 0.9 },
    ],
  }));
}

for (const captionCount of [30, 300, 1800, 5400]) {
  test(`performance: undo() stays fast at ${captionCount} captions in Original mode (the common case — ensureCoverage is a same-reference no-op)`, () => {
    useEditorStore.getState().load(fixtureProject({ subtitles: manyDevanagariCaptions(captionCount) }));
    useEditorStore.getState().updateSubtitleText("s0", "edited");
    const start = performance.now();
    useEditorStore.getState().undo();
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 150, `undo() took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);
  });

  test(`performance: undo() crossing a Hinglish mode-switch boundary (the regenerating case) stays fast at ${captionCount} captions`, () => {
    useEditorStore.getState().load(fixtureProject({ subtitles: manyDevanagariCaptions(captionCount) }));
    useEditorStore.getState().updateSubtitleText("s0", "before switch");
    useEditorStore.getState().setCaptionOutputMode("hinglish");
    useEditorStore.getState().updateSubtitleText("s1", "after switch");
    const start = performance.now();
    useEditorStore.getState().undo(); // undoes "after switch"
    useEditorStore.getState().undo(); // crosses back past the pre-Hinglish-generation snapshot
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 2000, `two undo() calls (one regenerating ${captionCount} captions' worth of Hinglish text) took ${elapsedMs.toFixed(1)}ms — expected well under 2000ms`);
    assert.ok(everyCaptionHasHinglish());
  });
}
