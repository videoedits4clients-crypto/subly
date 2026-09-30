/**
 * Task 137421 (P19.12) — fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md
 * §6 P1-3: the timeline's caption-edge/move drag used to call `updateSubtitleTiming` (a full
 * commit, one undo entry) on EVERY pointermove tick, against an unconditional `MAX_HISTORY = 60`
 * cap with no coalescing — so a single long drag gesture (more than 60 move ticks) could silently
 * evict every undo entry that existed before the drag started.
 *
 * The fix (timeline.tsx) now calls the exported, pure `resolveTimingUpdate` on every pointermove
 * for a LOCAL-ONLY live preview (no store access at all — see its own doc comment), and calls the
 * real `updateSubtitleTiming` exactly ONCE, on pointer-up/pointer-cancel, with the final validated
 * result. This project has no React-rendering test infrastructure (confirmed in the P19.11 audit),
 * so — per that task's own explicit fallback instruction — this suite tests the extracted pure
 * gesture logic (`resolveTimingUpdate`) and the store-level "one call, one commit" invariant
 * directly, simulating the exact sequence timeline.tsx's own handlers now produce, rather than
 * simulating real DOM pointer events.
 *
 * Run with: node --test src/store/__tests__/editor-store-caption-drag-coalescing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore, resolveTimingUpdate } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "a", index: 0, start: 0, end: 2, text: "first", words: [{ text: "first", start: 0, end: 2 }] },
    { id: "b", index: 1, start: 3, end: 5, text: "second", words: [{ text: "second", start: 3, end: 5 }] },
    { id: "c", index: 2, start: 10, end: 12, text: "third", words: [{ text: "third", start: 10, end: 12 }] },
  ];
  return {
    id: "p1",
    name: "Caption drag coalescing fixture",
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

// ============================== resolveTimingUpdate is pure (the live-preview half) ==============================

test("resolveTimingUpdate makes zero store commits, however many times it's called — simulating many pointermove ticks", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const subtitles = useEditorStore.getState().project!.subtitles;
  // Simulate 100 pointermove ticks of a drag resizing caption "b"'s end edge outward.
  for (let i = 0; i < 100; i++) {
    const resolution = resolveTimingUpdate(subtitles, "b", 3, 5 + i * 0.01);
    assert.ok(resolution.ok || resolution.reason, "always returns a real resolution, never throws");
  }
  assert.equal(useEditorStore.getState().past.length, pastBefore, "resolveTimingUpdate must never itself push a commit");
  assert.equal(useEditorStore.getState().project!.subtitles, subtitles, "resolveTimingUpdate must never mutate or replace the live subtitles array");
});

test("resolveTimingUpdate's own clamp/validation is unchanged — it rejects a resize that would push a word out of bounds", () => {
  const subtitles = useEditorStore.getState().project!.subtitles;
  // Shrinking caption "a" (word "first" spans its full [0,2]) down to [0,1] would leave "first" partly outside.
  const resolution = resolveTimingUpdate(subtitles, "a", 0, 1);
  assert.equal(resolution.ok, false);
  assert.equal((resolution as { reason: string }).reason, "word-out-of-bounds");
});

// ============================== one gesture -> exactly one commit ==============================

test("[MANDATORY REGRESSION] a long simulated drag (many resolveTimingUpdate calls) followed by exactly ONE updateSubtitleTiming call produces exactly ONE new undo entry", () => {
  const pastBefore = useEditorStore.getState().past.length;
  let finalStart = 3;
  let finalEnd = 5;
  // Simulate 80 pointermove ticks (deliberately more than MAX_HISTORY=60) dragging caption "b"'s
  // end edge — each tick only resolves a candidate position, exactly like timeline.tsx's own
  // onPointerMove now does; none of them touch the store.
  for (let i = 1; i <= 80; i++) {
    const subtitles = useEditorStore.getState().project!.subtitles;
    const resolution = resolveTimingUpdate(subtitles, "b", 3, 5 + i * 0.01);
    if (resolution.ok) {
      finalStart = resolution.clampedStart;
      finalEnd = resolution.clampedEnd;
    }
  }
  // The ONE commit the whole gesture produces, on "pointer-up".
  const result = useEditorStore.getState().updateSubtitleTiming("b", finalStart, finalEnd);
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "exactly one commit for the entire 80-tick gesture");
  const b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.ok(Math.abs(b.end - finalEnd) < 1e-9, "the final committed position matches the last resolved preview");
});

test("[MANDATORY REGRESSION] undo history from BEFORE a long drag survives the drag intact — a drag longer than MAX_HISTORY's own 60-entry cap does not evict prior history when coalesced to one commit", () => {
  // Perform 5 small, real, separate edits first — 5 real commits, 5 real undo entries.
  for (let i = 0; i < 5; i++) {
    useEditorStore.getState().updateSubtitleText("a", `first edit ${i}`);
  }
  const pastAfterFiveEdits = useEditorStore.getState().past.length;
  assert.ok(pastAfterFiveEdits >= 5);

  // Now simulate a single very long drag gesture (200 pointermove ticks — over 3x MAX_HISTORY)
  // on a DIFFERENT caption, coalesced to one commit on release.
  let finalStart = 10;
  let finalEnd = 12;
  for (let i = 1; i <= 200; i++) {
    const subtitles = useEditorStore.getState().project!.subtitles;
    const resolution = resolveTimingUpdate(subtitles, "c", 10, 12 + i * 0.005);
    if (resolution.ok) {
      finalStart = resolution.clampedStart;
      finalEnd = resolution.clampedEnd;
    }
  }
  useEditorStore.getState().updateSubtitleTiming("c", finalStart, finalEnd);

  // Exactly one NEW entry was added on top of the five real edits — none of the drag's 200 ticks
  // themselves consumed any undo-history capacity, so the five real edits are all still present.
  assert.equal(useEditorStore.getState().past.length, pastAfterFiveEdits + 1);

  // Undo the drag, then undo all five prior edits — every one of them must still be there.
  useEditorStore.getState().undo();
  for (let i = 0; i < 5; i++) {
    useEditorStore.getState().undo();
  }
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "first", "the ORIGINAL text (before any of the 5 edits) must still be reachable — none of it was evicted by the drag");
});

// ============================== "cancel"/no-movement behavior ==============================

test("a gesture that never resolves a valid position (immediate cancel, or every candidate rejected) commits nothing", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const subtitles = useEditorStore.getState().project!.subtitles;
  // Every candidate here is rejected (shrinking caption 'a' below its word's own span).
  let lastOk: { start: number; end: number } | null = null;
  for (let i = 0; i < 10; i++) {
    const resolution = resolveTimingUpdate(subtitles, "a", 0, 0.5);
    if (resolution.ok) lastOk = { start: resolution.clampedStart, end: resolution.clampedEnd };
  }
  // Mirrors timeline.tsx's own `if (captionDragPreview)` guard: with no accepted resolution, there
  // is nothing to commit on pointer-up.
  assert.equal(lastOk, null);
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no commit was made — nothing was ever accepted");
});

test("pointer-cancel behaves the same as pointer-up: the last accepted preview is committed once (matches the existing word-handle-drag convention)", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const subtitles = useEditorStore.getState().project!.subtitles;
  const resolution = resolveTimingUpdate(subtitles, "b", 3, 5.5);
  assert.ok(resolution.ok);
  // "Cancel" commits the same way "up" does — one call, one commit.
  useEditorStore.getState().updateSubtitleTiming("b", resolution.ok ? resolution.clampedStart : 3, resolution.ok ? resolution.clampedEnd : 5);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1);
});

// ============================== redo remains correct ==============================

test("redo after a coalesced drag commit restores the exact final dragged position", () => {
  const subtitles = useEditorStore.getState().project!.subtitles;
  const resolution = resolveTimingUpdate(subtitles, "b", 3, 6);
  assert.ok(resolution.ok);
  const finalEnd = resolution.ok ? resolution.clampedEnd : 6;
  useEditorStore.getState().updateSubtitleTiming("b", 3, finalEnd);
  assert.ok(Math.abs(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.end - finalEnd) < 1e-9);

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.end, 5, "undo restores the pre-drag end");

  useEditorStore.getState().redo();
  assert.ok(Math.abs(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.end - finalEnd) < 1e-9, "redo restores the exact final dragged position");
});
