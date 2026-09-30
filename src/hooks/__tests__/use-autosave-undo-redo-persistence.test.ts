/**
 * Task 143208 (P19.15) — regression coverage for the P1 "undo/redo doesn't autosave" defect
 * P19.14 reported. Exercises the REAL `wireAutosave` wiring (src/hooks/use-autosave.ts) against
 * the REAL editor store (src/store/editor-store.ts) — not a hand-written reimplementation of the
 * subscribe/debounce logic, and not just the Zustand store in isolation — mocking only
 * `global.fetch` (the actual persistence/network boundary) and `localStorage` (jsdom-less Node
 * has none; the crash-snapshot calls are wrapped in try/catch in local-snapshot.ts and silently
 * no-op here, which is fine — this file's own persistence claims rest on the mocked `fetch`
 * payloads, not on the local snapshot).
 *
 * Investigation summary (see also use-autosave.ts's own doc comment on `wireAutosave`): P19.14's
 * claim that `undo()`/`redo()` don't trigger the autosave subscription did NOT reproduce here.
 * Every test below passes against the CURRENT, unmodified wireAutosave/editor-store logic — no
 * change was needed there. Live re-investigation in the actual packaged app (see
 * research/p19_15_undo_redo_persistence_fix_report.md) found the real cause: pressing Ctrl+Z
 * while focus remained inside (or returned to) the caption textarea just edited triggered the
 * BROWSER'S OWN per-field native undo instead of ever calling this store's `undo()` — fixed in
 * captions-panel.tsx's Textarea `onKeyDown`, not here.
 *
 * Run with: node --test src/hooks/__tests__/use-autosave-undo-redo-persistence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../../store/editor-store.ts";
import { wireAutosave } from "../use-autosave.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";

const DEBOUNCE_WAIT_MS = 1300; // 900ms debounce + margin, matching the task's own "5-8s in the real app" spirit scaled to a fast unit test

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "a", index: 0, start: 0, end: 2, text: "नमस्ते दुनिया", words: [{ text: "नमस्ते", start: 0, end: 1 }, { text: "दुनिया", start: 1, end: 2 }] },
    { id: "b", index: 1, start: 3, end: 4, text: "hello there", words: [{ text: "hello", start: 3, end: 3.5 }, { text: "there", start: 3.5, end: 4 }] },
  ];
  return {
    id: "p1",
    name: "Undo/redo persistence fixture",
    status: "READY",
    language: "hi",
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

/** Records every PATCH body sent to /api/projects/:id, standing in for "what's currently
 * persisted on the server" — the ground truth this whole test file cares about. */
function installFetchMock() {
  const patches: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/projects/") && init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return {
    patches,
    lastPatchedText: () => (patches.at(-1)?.subtitles as Subtitle[] | undefined)?.[1]?.text,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.beforeEach(() => {
  useEditorStore.getState().load(fixtureProject());
});

// ============================== TEST A ==============================
test("TEST A: ordinary edit -> autosave -> undo -> autosave -> persisted state is the undone state", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("b", "hello there EDITED");
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "hello there EDITED", "the ordinary edit must persist first");

    useEditorStore.getState().undo();
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "hello there", "the undo's resulting state must be persisted");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST B ==============================
test("TEST B: ordinary edit -> autosave -> undo -> redo -> autosave -> persisted state is the redone state", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("b", "hello there EDITED");
    await wait(DEBOUNCE_WAIT_MS);

    useEditorStore.getState().undo();
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "hello there");

    useEditorStore.getState().redo();
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "hello there EDITED", "the redo's resulting state must be persisted");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST C ==============================
test("TEST C: undo with no subsequent user interaction still persists after the debounce period", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("b", "hello there EDITED");
    await wait(DEBOUNCE_WAIT_MS);
    const patchCountBeforeUndo = mock.patches.length;

    useEditorStore.getState().undo();
    // Deliberately nothing else happens here — this is the exact scenario P19.14 reported as broken.
    await wait(DEBOUNCE_WAIT_MS);

    assert.ok(mock.patches.length > patchCountBeforeUndo, "undo alone must trigger a new save");
    assert.equal(mock.lastPatchedText(), "hello there");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST D ==============================
test("TEST D: redo with no subsequent user interaction still persists after the debounce period", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("b", "hello there EDITED");
    await wait(DEBOUNCE_WAIT_MS);
    useEditorStore.getState().undo();
    await wait(DEBOUNCE_WAIT_MS);
    const patchCountBeforeRedo = mock.patches.length;

    useEditorStore.getState().redo();
    // Nothing else happens.
    await wait(DEBOUNCE_WAIT_MS);

    assert.ok(mock.patches.length > patchCountBeforeRedo, "redo alone must trigger a new save");
    assert.equal(mock.lastPatchedText(), "hello there EDITED");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST E ==============================
test("TEST E: Original output mode — isolated undo persists", async () => {
  const mock = installFetchMock();
  assert.equal(useEditorStore.getState().project?.captionOutputMode, "original");
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("a", "नमस्ते संसार");
    await wait(DEBOUNCE_WAIT_MS);
    useEditorStore.getState().undo();
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal((mock.patches.at(-1)?.subtitles as Subtitle[])[0].text, "नमस्ते दुनिया");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST F ==============================
test("TEST F: Hinglish (derived) output mode — isolated undo persists", async () => {
  const mock = installFetchMock();
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  assert.equal(useEditorStore.getState().project?.captionOutputMode, "hinglish");
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleHinglishText("a", "Namaste Duniya EDITED");
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal((mock.patches.at(-1)?.subtitles as Subtitle[])[0].hinglishText, "Namaste Duniya EDITED");

    useEditorStore.getState().undo();
    await wait(DEBOUNCE_WAIT_MS);
    const persistedHinglish = (mock.patches.at(-1)?.subtitles as Subtitle[])[0].hinglishText;
    assert.notEqual(persistedHinglish, "Namaste Duniya EDITED", "the undo must actually persist, not leave the pre-undo edit behind");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST G ==============================
test("TEST G: undo followed by another edit still persists correctly", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("b", "hello there EDITED");
    await wait(DEBOUNCE_WAIT_MS);
    useEditorStore.getState().undo();
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "hello there");

    useEditorStore.getState().updateSubtitleText("b", "a completely different edit");
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "a completely different edit");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST H ==============================
test("TEST H: redo followed by another edit still persists correctly", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("b", "hello there EDITED");
    await wait(DEBOUNCE_WAIT_MS);
    useEditorStore.getState().undo();
    await wait(DEBOUNCE_WAIT_MS);
    useEditorStore.getState().redo();
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "hello there EDITED");

    useEditorStore.getState().updateSubtitleText("b", "yet another edit after redo");
    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "yet another edit after redo");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST I ==============================
test("TEST I: rapid undo/redo sequence does not create stale/out-of-order persistence", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    useEditorStore.getState().updateSubtitleText("b", "v1");
    await wait(DEBOUNCE_WAIT_MS);
    useEditorStore.getState().updateSubtitleText("b", "v2");
    await wait(DEBOUNCE_WAIT_MS);
    useEditorStore.getState().updateSubtitleText("b", "v3");
    await wait(DEBOUNCE_WAIT_MS);

    // Rapid-fire, no waits in between — the single-flight queue (save-queue.ts) must still land
    // on the LAST state, not an intermediate/stale one, regardless of how many debounce timers
    // got scheduled and re-cancelled along the way.
    useEditorStore.getState().undo(); // v3 -> v2
    useEditorStore.getState().undo(); // v2 -> v1
    useEditorStore.getState().redo(); // v1 -> v2
    useEditorStore.getState().undo(); // v2 -> v1

    const finalClientText = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.text;
    assert.equal(finalClientText, "v1", "sanity: the final in-memory state after this exact sequence must be v1");

    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.lastPatchedText(), "v1", "the persisted state must match the FINAL rapid undo/redo state, not an intermediate one");
  } finally {
    cleanup();
    mock.restore();
  }
});

// ============================== TEST J ==============================
test("TEST J: existing autosave behavior remains unchanged for ordinary edits", async () => {
  const mock = installFetchMock();
  const cleanup = wireAutosave("p1");
  try {
    assert.equal(useEditorStore.getState().dirty, false);
    useEditorStore.getState().updateSubtitleText("a", "एक नया परीक्षण");
    assert.equal(useEditorStore.getState().dirty, true, "an ordinary commit must mark dirty immediately (unchanged behavior)");
    assert.equal(mock.patches.length, 0, "must not save before the debounce elapses (unchanged behavior)");

    await wait(DEBOUNCE_WAIT_MS);
    assert.equal(mock.patches.length, 1);
    assert.equal((mock.patches[0].subtitles as Subtitle[])[0].text, "एक नया परीक्षण");
    assert.equal(useEditorStore.getState().dirty, false, "dirty must clear once the save lands (unchanged behavior)");
    assert.equal(useEditorStore.getState().saveState, "saved");
  } finally {
    cleanup();
    mock.restore();
  }
});
