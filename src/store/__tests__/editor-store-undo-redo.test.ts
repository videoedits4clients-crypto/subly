/**
 * Regression tests for the editor store's undo/redo semantics (src/store/editor-store.ts) —
 * exercises the REAL store (a real Zustand instance, not a mock), verifying exactly what STEP 6
 * of the P1 Editor State Persistence task asks for: edit → undo → resulting state; edit → undo
 * → redo → resulting state; for subtitle text, timing, style, caption add/delete, and project
 * composition. Also verifies `dirty` — the flag hooks/use-autosave.ts watches to decide whether
 * a persistence request is needed — is set correctly by every undoable mutation, by undo, and
 * by redo, and that the past/future stacks themselves stay editor-session-only (reset on load,
 * as intended — see the P1 task's explicit "do not assume undo state itself needs to be
 * persisted across restarts").
 *
 * Run with: node --test src/store/__tests__/editor-store-undo-redo.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES, resolveStyle, resolveAnimation } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality, isQualityReportStale } from "../../lib/subtitles/quality-analyzer.ts";
import { applyQualityFix, applyAllSafeFixes } from "../../lib/subtitles/quality-fixes.ts";
import { BUILT_IN_PRESETS } from "../../lib/presets.ts";
import { isWordTimingStale } from "../../lib/subtitles/word-timing.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "s1", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
    { id: "s2", index: 1, start: 1, end: 2, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
  ];
  return {
    id: "p1",
    name: "Fixture project",
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

test("1. subtitle text: edit → undo restores the exact previous text, marking dirty", () => {
  useEditorStore.getState().updateSubtitleText("s1", "Hello world");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello world");

  useEditorStore.setState({ dirty: false }); // simulate autosave having already persisted the edit
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello");
  assert.equal(useEditorStore.getState().dirty, true, "undo must mark dirty so the reverted state gets persisted");
});

test("2. subtitle text: edit → undo → redo restores the exact edited text", () => {
  useEditorStore.getState().updateSubtitleText("s1", "Hello world");
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello");

  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello world");
  assert.equal(useEditorStore.getState().dirty, true, "redo must mark dirty so the restored state gets persisted");
});

test("3. subtitle timing: edit → undo → redo round-trips exactly", () => {
  // s2 starts at 1, so the end here (0.9) stays clear of it — this test is about the
  // undo/redo round-trip, not the overlap clamp (see test 3b for that). Task 115894 (P18.8): s1's
  // default word (Hello) exactly fills [0,1], so a raw (0.2, 0.9) request — a resize, both edges
  // move independently — would now be rejected (Hello's start=0 would fall outside the new [0.2,
  // 0.9] bounds). This test's own purpose is the undo/redo round-trip, not word-bounds behavior
  // (test 54/55 cover that), so it loads a local fixture whose word has margin from both edges.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0.3, end: 0.7 }] },
        { id: "s2", index: 1, start: 1, end: 2, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  const ok1 = useEditorStore.getState().updateSubtitleTiming("s1", 0.2, 0.9);
  assert.equal(ok1, "ok");
  assert.deepEqual(
    [useEditorStore.getState().project!.subtitles[0].start, useEditorStore.getState().project!.subtitles[0].end],
    [0.2, 0.9],
  );

  useEditorStore.getState().undo();
  const afterUndo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(afterUndo.start, 0);
  assert.equal(afterUndo.end, 1);

  useEditorStore.getState().redo();
  const afterRedo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(afterRedo.start, 0.2);
  assert.equal(afterRedo.end, 0.9);
});

test("3b. subtitle timing: updateSubtitleTiming clamps against the next caption instead of allowing overlap", () => {
  // s1 is [0,1], s2 is [1,2] — asking for s1 to end at 1.5 would overlap s2, so it must clamp to
  // s2's start. Task 115894 (P18.8): same word-margin reasoning as test 3 above — the default
  // full-span Hello word would make the resulting resize (a genuine resize, since the neighbor
  // clamp caps the requested end at 1, changing duration) reject on word-out-of-bounds, which
  // isn't what this test is about (test 26b covers that rejection case).
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0.3, end: 0.7 }] },
        { id: "s2", index: 1, start: 1, end: 2, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  const ok = useEditorStore.getState().updateSubtitleTiming("s1", 0.2, 1.5);
  assert.equal(ok, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.start, 0.2);
  assert.equal(s1.end, 1, "end must clamp to the next caption's start, never overlap it");
});

test("3c. subtitle timing: updateSubtitleTiming clamps against the previous caption and never overlaps or invalidates duration", () => {
  // s2 is [1,2], s1 is [0,1] — asking for s2 to start at -0.5 would overlap s1, so it must clamp to s1's end.
  useEditorStore.getState().updateSubtitleTiming("s2", -0.5, 2);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2.start, 1, "start must clamp to the previous caption's end, never overlap it");
  assert.equal(s2.end, 2);
  assert.ok(s2.end - s2.start > 0, "duration must stay positive");
});

test("3d. subtitle timing: nudgeSubtitleTiming preserves duration and stops at a neighbor instead of squeezing it", () => {
  // Nudging s1 ([0,1]) forward by 5s would run its end straight through s2's start (1) —
  // nudge must stop right at the boundary and keep s1's own 1s duration intact, not shrink it.
  useEditorStore.getState().nudgeSubtitleTiming("s1", 5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.end, 1, "must stop exactly at the neighbor's start");
  assert.equal(s1.start, 0, "must not have moved at all, since moving would have squeezed duration");
  assert.equal(s1.end - s1.start, 1, "duration must be preserved exactly, never squeezed");
});

test("3e. subtitle timing: nudgeSubtitleTiming with room to move shifts both start and end by the same delta", () => {
  useEditorStore.getState().nudgeSubtitleTiming("s2", 0.3);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2.start, 1.3);
  assert.equal(s2.end, 2.3);
});

test("3f. subtitle timing: nudgeSubtitleTiming is undoable", () => {
  useEditorStore.getState().nudgeSubtitleTiming("s2", 0.3);
  useEditorStore.getState().undo();
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2.start, 1);
  assert.equal(s2.end, 2);
});

test("4. global style: edit → undo → redo round-trips exactly", () => {
  useEditorStore.getState().setGlobalStyle({ fontFamily: "Poppins", color: "#123456" });
  assert.equal(useEditorStore.getState().project!.globalStyle.fontFamily, "Poppins");

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.globalStyle.fontFamily, DEFAULT_SUBTITLE_STYLE.fontFamily);

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.globalStyle.fontFamily, "Poppins");
  assert.equal(useEditorStore.getState().project!.globalStyle.color, "#123456");
});

test("5. caption deletion: delete → undo restores the deleted caption (same id, same content); redo removes it again", () => {
  useEditorStore.getState().deleteSubtitle("s1");
  assert.equal(useEditorStore.getState().project!.subtitles.length, 1);
  assert.equal(useEditorStore.getState().project!.subtitles[0].id, "s2");

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 2);
  assert.deepEqual(
    useEditorStore.getState().project!.subtitles.map((s) => s.id),
    ["s1", "s2"],
  );
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello");

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 1);
  assert.equal(useEditorStore.getState().project!.subtitles[0].id, "s2");
});

test("6. caption addition (duplicate): add → undo removes it; redo brings it back", () => {
  // Task 95640 (P9): the default fixture's s1[0,1]/s2[1,2] are zero-gap-adjacent — duplicating s1
  // there is now correctly REJECTED (no room before s2) by the new collision-safe placement, so
  // this test (about add/undo/redo mechanics, not collision behavior) loads a fixture with room
  // to spare instead. The collision-rejection behavior itself has its own dedicated tests below.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "s2", index: 1, start: 5, end: 6, text: "World", words: [{ text: "World", start: 5, end: 6 }] },
      ],
    }),
  );
  const result = useEditorStore.getState().duplicateSubtitle("s1");
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);
  const newId = useEditorStore.getState().project!.subtitles[1].id;
  assert.notEqual(newId, "s1");
  assert.notEqual(newId, "s2");

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 2);
  assert.deepEqual(
    useEditorStore.getState().project!.subtitles.map((s) => s.id),
    ["s1", "s2"],
  );

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);
  assert.equal(useEditorStore.getState().project!.subtitles[1].id, newId);
});

test("6b. mergeWithNext: preserves the first caption's style/animation override (previously silently dropped), concatenates text and words, and undo/redo round-trip", () => {
  const override = { ...DEFAULT_SUBTITLE_STYLE, color: "#FF00FF" };
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }], style: override, animation: { entrance: "bounce" } },
        { id: "s2", index: 1, start: 1, end: 2, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );

  useEditorStore.getState().mergeWithNext("s1");
  const merged = useEditorStore.getState().project!.subtitles;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "s1", "merged caption keeps the first caption's id (A absorbs B)");
  assert.equal(merged[0].start, 0);
  assert.equal(merged[0].end, 2);
  assert.equal(merged[0].text, "Hello World");
  assert.deepEqual(
    merged[0].words.map((w) => w.text),
    ["Hello", "World"],
  );
  assert.deepEqual(merged[0].style, override, "style override must survive the merge, not be silently dropped");
  assert.equal(merged[0].animation?.entrance, "bounce", "animation override must survive the merge, not be silently dropped");

  useEditorStore.getState().undo();
  const afterUndo = useEditorStore.getState().project!.subtitles;
  assert.equal(afterUndo.length, 2);
  assert.deepEqual(afterUndo.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(afterUndo[0].style, override);

  useEditorStore.getState().redo();
  const afterRedo = useEditorStore.getState().project!.subtitles;
  assert.equal(afterRedo.length, 1);
  assert.deepEqual(afterRedo[0].style, override);
  assert.equal(afterRedo[0].animation?.entrance, "bounce");
});

test("7. project composition/settings: edit → undo → redo round-trips exactly", () => {
  useEditorStore.getState().setComposition({ videoVisible: false, backgroundColor: "#ABCDEF" });
  assert.equal(useEditorStore.getState().project!.composition.videoVisible, false);

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.composition.videoVisible, true);
  assert.equal(useEditorStore.getState().project!.composition.backgroundColor, DEFAULT_COMPOSITION.backgroundColor);

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.composition.videoVisible, false);
  assert.equal(useEditorStore.getState().project!.composition.backgroundColor, "#ABCDEF");
});

test("8. a new edit after undo clears the redo stack (standard undo/redo semantics, not a regression)", () => {
  useEditorStore.getState().updateSubtitleText("s1", "Hello world");
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().future.length, 1);

  useEditorStore.getState().updateSubtitleText("s1", "A completely different edit");
  assert.equal(useEditorStore.getState().future.length, 0, "starting a new edit after undo must discard the old redo branch");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "A completely different edit");
});

test("9. undo/redo stacks are editor-session-only — load() resets both to empty, even mid-session", () => {
  useEditorStore.getState().updateSubtitleText("s1", "Hello world");
  useEditorStore.getState().undo();
  assert.ok(useEditorStore.getState().past.length === 0 || useEditorStore.getState().future.length > 0);

  useEditorStore.getState().load(fixtureProject());
  assert.deepEqual(useEditorStore.getState().past, []);
  assert.deepEqual(useEditorStore.getState().future, []);
});

test("10. undo with an empty history is a safe no-op", () => {
  const before = useEditorStore.getState().project;
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project, before);
  assert.equal(useEditorStore.getState().dirty, false);
});

test("11. redo with an empty future is a safe no-op", () => {
  const before = useEditorStore.getState().project;
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project, before);
  assert.equal(useEditorStore.getState().dirty, false);
});

test("12. multiple sequential mutations undo one step at a time, in reverse order", () => {
  useEditorStore.getState().updateSubtitleText("s1", "First edit");
  useEditorStore.getState().updateSubtitleText("s1", "Second edit");
  useEditorStore.getState().updateSubtitleText("s1", "Third edit");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Third edit");

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Second edit");
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "First edit");
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello");

  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Third edit");
});

test("13. every commit-based mutation marks dirty (so autosave picks it up)", () => {
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().setTimingRules({ maxWordsPerCaption: 6 });
  assert.equal(useEditorStore.getState().dirty, true);
});

test("14. load() of a freshly-fetched project (simulating a reload) reflects whatever the server returned, discarding in-memory-only edits that never reached the server", () => {
  useEditorStore.getState().updateSubtitleText("s1", "This edit never got saved");
  // Simulate a reload: the server's own copy (never received the above edit) is loaded fresh.
  useEditorStore.getState().load(fixtureProject());
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello");
});

// ---------------------------------------------------------------------------------------
// P2 Subtitle Quality Control & Safe Auto-Fix — integration with the real store's
// commit()/undo/redo/dirty machinery via the existing replaceAllSubtitles action (the quality
// analyzer/fix engine themselves are pure lib functions, tested directly in
// src/lib/subtitles/__tests__/quality-analyzer.test.ts and quality-fixes.test.ts — these tests
// verify the STORE INTEGRATION: that routing a fix through replaceAllSubtitles gets the exact
// same undo/redo/dirty guarantees as every other mutation, with no bypass of that architecture).
// ---------------------------------------------------------------------------------------

test("15. a single quality fix applied via replaceAllSubtitles is one undo step that restores the exact prior state", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  const { project } = useEditorStore.getState();
  const before = project!.subtitles;
  const report = analyzeSubtitleQuality(before, project!.timingRules);
  const overlapIssue = report.issues.find((i) => i.type === "OVERLAP")!;
  assert.ok(overlapIssue, "fixture must actually have an overlap for this test to mean anything");

  const fixed = applyQualityFix(before, overlapIssue, project!.timingRules)!;
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().replaceAllSubtitles(fixed);

  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.end, 1);
  assert.equal(useEditorStore.getState().dirty, true);
  assert.equal(useEditorStore.getState().past.length, 1, "exactly one undo step for one fix");

  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);

  useEditorStore.getState().redo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, fixed);
});

test("16. 'fix all safe issues' across many problems is exactly ONE undo step, not one per issue", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
        { id: "c", index: 2, start: 5, end: 6, text: "", words: [] },
      ],
    }),
  );
  const { project } = useEditorStore.getState();
  const before = project!.subtitles;
  const result = applyAllSafeFixes(before, project!.timingRules);
  assert.ok(result.fixedCount > 1, "fixture must have more than one fixable issue for this test to mean anything");

  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().replaceAllSubtitles(result.subtitles);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "one commit for the whole batch, regardless of how many issues it fixed");

  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);

  useEditorStore.getState().redo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, result.subtitles);
});

test("17. quality fixes preserve caption-level style/animation and word-level style overrides through the real store", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "a",
          index: 0,
          start: 0,
          end: 1,
          text: "one two three four five six",
          words: [
            { text: "one", start: 0, end: 0.15 },
            { text: "two", start: 0.15, end: 0.3, style: { color: "#00FFAA" } },
            { text: "three", start: 0.3, end: 0.45 },
            { text: "four", start: 0.45, end: 0.6 },
            { text: "five", start: 0.6, end: 0.75 },
            { text: "six", start: 0.75, end: 0.9 },
          ],
          style: { color: "#FF00AA" },
          animation: { entrance: "bounce" },
        },
      ],
      timingRules: { ...DEFAULT_TIMING_RULES, maxWordsPerCaption: 4 },
    }),
  );
  const { project } = useEditorStore.getState();
  const fixed = applyAllSafeFixes(project!.subtitles, project!.timingRules).subtitles;
  useEditorStore.getState().replaceAllSubtitles(fixed);

  const stored = useEditorStore.getState().project!.subtitles;
  assert.ok(stored.length > 1, "the too-many-words caption should have been split");
  for (const s of stored) {
    assert.deepEqual(s.style, { color: "#FF00AA" });
    assert.deepEqual(s.animation, { entrance: "bounce" });
  }
  const styledWord = stored.flatMap((s) => s.words).find((w) => w.text === "two");
  assert.deepEqual(styledWord?.style, { color: "#00FFAA" });
});

// ---------------------------------------------------------------------------------------
// P2 Subtitle Review & Publish Readiness — runQualityAnalysis store integration and staleness.
// ---------------------------------------------------------------------------------------

test("18. runQualityAnalysis stores a report against the current project and is not itself an undo step", () => {
  useEditorStore.getState().load(fixtureProject());
  assert.equal(useEditorStore.getState().qualityReport, null);
  const pastBefore = useEditorStore.getState().past.length;

  useEditorStore.getState().runQualityAnalysis();

  const { qualityReport, qualityReportSubtitles, project, past, dirty } = useEditorStore.getState();
  assert.ok(qualityReport);
  assert.equal(qualityReportSubtitles, project!.subtitles);
  assert.equal(past.length, pastBefore, "analysis must not create an undo step");
  assert.equal(dirty, false, "analysis alone must not mark the project dirty");
});

test("19. the quality report becomes stale (by reference) after any commit, and fresh again after re-analysis", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().runQualityAnalysis();
  const { qualityReportSubtitles: analyzedAt } = useEditorStore.getState();

  useEditorStore.getState().updateSubtitleText("s1", "Hello world");
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, analyzedAt), true);

  useEditorStore.getState().runQualityAnalysis();
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles), false);
});

test("20. undo/redo also change the subtitles reference, so a report analyzed before an undo is correctly stale after it", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().updateSubtitleText("s1", "Hello world");
  useEditorStore.getState().runQualityAnalysis();
  const analyzedAt = useEditorStore.getState().qualityReportSubtitles;

  useEditorStore.getState().undo();
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, analyzedAt), true);
});

test("21. load() (switching/reopening a project) clears any previous quality report", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().runQualityAnalysis();
  assert.ok(useEditorStore.getState().qualityReport);

  useEditorStore.getState().load(fixtureProject());
  assert.equal(useEditorStore.getState().qualityReport, null);
  assert.equal(useEditorStore.getState().qualityReportSubtitles, null);
});

test("22. a fix applied via replaceAllSubtitles, followed by re-analysis, reflects the fixed state (not stale)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  useEditorStore.getState().runQualityAnalysis();
  const before = useEditorStore.getState().qualityReport!;
  const overlapIssue = before.issues.find((i) => i.type === "OVERLAP")!;
  assert.ok(overlapIssue);

  const { project } = useEditorStore.getState();
  const fixed = applyQualityFix(project!.subtitles, overlapIssue, project!.timingRules)!;
  useEditorStore.getState().replaceAllSubtitles(fixed);
  useEditorStore.getState().runQualityAnalysis();

  const after = useEditorStore.getState().qualityReport!;
  assert.equal(after.issues.find((i) => i.type === "OVERLAP"), undefined);
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles), false);
});

test("23. duplicateSubtitle shifts every word's start/end by the same amount the caption itself moved, so words stay inside the duplicate's own bounds", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "s1",
          index: 0,
          start: 0,
          end: 2,
          text: "Hello there",
          words: [
            { text: "Hello", start: 0.1, end: 0.9 },
            { text: "there", start: 1.0, end: 1.9 },
          ],
          style: { color: "#ABCDEF" },
          animation: { entrance: "bounce" },
        },
      ],
    }),
  );

  useEditorStore.getState().duplicateSubtitle("s1");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 2);
  const dup = subs[1];

  assert.equal(dup.start, 2, "duplicate starts where the original ended");
  assert.equal(dup.end, 4, "duplicate preserves the original's 2s duration");
  assert.deepEqual(
    dup.words.map((w) => [w.start, w.end]),
    [
      [2.1, 2.9],
      [3.0, 3.9],
    ],
    "every word must shift forward by exactly the caption's own shift (2s), landing inside [2,4)",
  );
  for (const w of dup.words) {
    assert.ok(w.start >= dup.start && w.end <= dup.end, `word "${w.text}" must fall within the duplicate's own bounds`);
  }
  assert.deepEqual(dup.style, { color: "#ABCDEF" }, "caption-level style override survives duplicate");
  assert.deepEqual(dup.animation, { entrance: "bounce" }, "caption-level animation override survives duplicate");

  // Original is untouched.
  assert.deepEqual(
    subs[0].words.map((w) => [w.start, w.end]),
    [
      [0.1, 0.9],
      [1.0, 1.9],
    ],
  );

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 1);
});

test("24. nudgeSubtitleTiming (a pure whole-block shift) shifts word timestamps by the same delta", () => {
  useEditorStore.getState().nudgeSubtitleTiming("s2", 0.3);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2.start, 1.3);
  assert.equal(s2.end, 2.3);
  assert.deepEqual(
    s2.words.map((w) => [w.start, w.end]),
    [[1.3, 2.3]],
    "the word must move with the caption, not stay behind at its old [1,2] timestamps",
  );

  useEditorStore.getState().undo();
  const restored = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.deepEqual(
    restored.words.map((w) => [w.start, w.end]),
    [[1, 2]],
    "undo must restore the word's original timestamps exactly, not just the caption's",
  );
});

test("25. updateSubtitleTiming as a RESIZE (duration changes) leaves word timestamps untouched", () => {
  // s2 is the LAST caption (no next-neighbor clamp), so extending its end from 2 to 2.5 is a
  // clean resize — start stays put, duration grows — with no overlap clamping involved.
  useEditorStore.getState().updateSubtitleTiming("s2", 1, 2.5);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2.start, 1);
  assert.equal(s2.end, 2.5);
  assert.deepEqual(
    s2.words.map((w) => [w.start, w.end]),
    [[1, 2]],
    "extending a caption's boundary must not fabricate new word-level timing data",
  );
});

test("26. updateSubtitleTiming as a whole-block MOVE shifts words by the actually-applied (clamped) delta, not the raw requested one", () => {
  // s2 is the LAST caption ([1,2], no next-neighbor to clamp against), so a same-duration move
  // to [1.4, 2.4] applies in full, uncapped — the case this test isolates.
  useEditorStore.getState().updateSubtitleTiming("s2", 1.4, 2.4);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2.start, 1.4);
  assert.equal(s2.end, 2.4);
  assert.deepEqual(s2.words.map((w) => [w.start, w.end]), [[1.4, 2.4]], "word shifts by the same 0.4s the caption moved");
});

test("26b. updateSubtitleTiming clamped asymmetrically (start moves, end can't) becomes a squeeze, not a pure shift — a word that would fall outside the shrunk bounds rejects the whole resize atomically", () => {
  // s1 is [0,1], s2 is [1,2] — requesting s1 move to [0.6,1.6] can apply the new start in full
  // (0.6, still >= prevEnd of 0) but must clamp the new end down to s2's start (1), so the
  // caption is actually SQUEEZED to [0.6,1] (duration 0.4, not the original 1) rather than
  // shifted. Since duration changed, this is treated as a resize, not a pure shift — but s1's
  // only word was originally [0,1], which would fall outside the new [0.6,1] bounds on its start
  // side (0 < 0.6). Task 93471 (P7.3) used to REPOSITION the word's start forward to 0.6 via
  // clampWordsToCaptionBounds; Task 115894 (P18.8) replaced that: P18.6 made non-monotonic word
  // order a permanent supported state, so silently moving a word's real timing just because the
  // caption's OWN bounds changed underneath it is no longer safe in general — the whole resize is
  // now REJECTED atomically instead (zero mutation, zero commit), matching this task's own
  // "reject rather than silently repair" precedent (see mergeSubtitles, Task 114761/P18.7).
  const before = useEditorStore.getState().project!;
  const s1Before = before.subtitles.find((s) => s.id === "s1")!;
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0.6, 1.6);
  assert.equal(result, "word-out-of-bounds");
  const s1After = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1After, s1Before, "rejected resize: the caption object must keep its exact prior reference");
  assert.deepEqual(s1After.words.map((w) => [w.start, w.end]), [[0, 1]], "the word's real timing must be completely untouched");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no history entry for a rejected resize");
});

test("27. applyPreset deep-clones style/animation — mutating the project's globalStyle after applying a built-in preset never touches BUILT_IN_PRESETS itself", () => {
  const preset = BUILT_IN_PRESETS.find((p) => p.id === "tiktok")!;
  const originalColor = preset.style.color;

  useEditorStore.getState().applyPreset(preset.style, preset.animation);
  assert.notEqual(
    useEditorStore.getState().project!.globalStyle,
    preset.style,
    "globalStyle must be an independent copy, never the literal BUILT_IN_PRESETS object reference",
  );

  useEditorStore.getState().setGlobalStyle({ color: "#000001" });
  assert.equal(useEditorStore.getState().project!.globalStyle.color, "#000001");
  assert.equal(preset.style.color, originalColor, "the shared built-in preset definition must be completely unaffected");
});

test("28. 'Reset to global style/animation' (setSubtitleStyleOverride/setSubtitleAnimationOverride with null) clears a caption's override so it falls back to inheriting from global, and is undoable", () => {
  useEditorStore.getState().setSubtitleStyleOverride("s1", { color: "#FF00FF" });
  useEditorStore.getState().setSubtitleAnimationOverride("s1", { entrance: "bounce" });
  let s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(resolveStyle(useEditorStore.getState().project!, s1).color, "#FF00FF");
  assert.equal(resolveAnimation(useEditorStore.getState().project!, s1).entrance, "bounce");

  useEditorStore.getState().setSubtitleStyleOverride("s1", null);
  useEditorStore.getState().setSubtitleAnimationOverride("s1", null);
  s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.style, undefined, "style override must be fully cleared, not merged with an empty patch");
  assert.equal(s1.animation, undefined, "animation override must be fully cleared");
  assert.equal(resolveStyle(useEditorStore.getState().project!, s1).color, DEFAULT_SUBTITLE_STYLE.color, "falls back to the global style");
  assert.equal(resolveAnimation(useEditorStore.getState().project!, s1).entrance, DEFAULT_ANIMATION.entrance, "falls back to the global animation");

  // Undo the animation reset, then the style reset — each is its own commit/undo step.
  useEditorStore.getState().undo();
  s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.animation, { entrance: "bounce" }, "undo restores the animation override");

  useEditorStore.getState().undo();
  s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.style, { color: "#FF00FF" }, "undo restores the style override");
});

// --- Task 87426 (P6 Style Creator): "Reset changes" ------------------------------------------

test("29. resetToLastApplied is a no-op before any preset has been applied this session", () => {
  assert.equal(useEditorStore.getState().lastAppliedStyleSnapshot, null);
  const before = useEditorStore.getState().project!.globalStyle;
  useEditorStore.getState().resetToLastApplied();
  assert.equal(useEditorStore.getState().project!.globalStyle, before, "nothing to reset to, so nothing changes");
});

test("30. 'Reset changes' reverts globalStyle/animation to exactly what was applied, discarding tweaks made since — distinct from 'Reset to default'", () => {
  const preset = BUILT_IN_PRESETS.find((p) => p.id === "marker")!;
  useEditorStore.getState().applyPreset(preset.style, preset.animation);
  assert.deepEqual(useEditorStore.getState().lastAppliedStyleSnapshot, { style: preset.style, animation: preset.animation });

  // Simulate the user tweaking sliders after applying the preset.
  useEditorStore.getState().setGlobalStyle({ color: "#00FF00", fontSize: 999 });
  useEditorStore.getState().setGlobalAnimation({ entrance: "bounce" });
  assert.equal(useEditorStore.getState().project!.globalStyle.color, "#00FF00");

  useEditorStore.getState().resetToLastApplied();
  assert.deepEqual(useEditorStore.getState().project!.globalStyle, preset.style, "reverted to exactly the applied preset's style");
  assert.deepEqual(useEditorStore.getState().project!.animation, preset.animation, "reverted to exactly the applied preset's animation");
});

test("31. resetToLastApplied goes through commit() like any other edit — it is itself a normal, undoable action, not a special code path", () => {
  const preset = BUILT_IN_PRESETS.find((p) => p.id === "classic")!;
  useEditorStore.getState().applyPreset(preset.style, preset.animation);
  useEditorStore.getState().setGlobalStyle({ color: "#123123" });
  const tweaked = useEditorStore.getState().project!.globalStyle;

  useEditorStore.getState().resetToLastApplied();
  assert.deepEqual(useEditorStore.getState().project!.globalStyle, preset.style);

  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.globalStyle, tweaked, "undo after Reset changes restores the pre-reset (tweaked) style");
});

test("32. re-applying a preset after tweaking, then applying a DIFFERENT preset, updates the reset target to the new preset — resetToLastApplied always targets the MOST RECENTLY applied style", () => {
  const first = BUILT_IN_PRESETS.find((p) => p.id === "classic")!;
  const second = BUILT_IN_PRESETS.find((p) => p.id === "marker")!;
  useEditorStore.getState().applyPreset(first.style, first.animation);
  useEditorStore.getState().setGlobalStyle({ color: "#AAAAAA" });
  useEditorStore.getState().applyPreset(second.style, second.animation);
  useEditorStore.getState().setGlobalStyle({ color: "#BBBBBB" });

  useEditorStore.getState().resetToLastApplied();
  assert.deepEqual(useEditorStore.getState().project!.globalStyle, second.style, "resets to the SECOND (most recent) preset, not the first");
});

test("33. load() (opening a different project) clears lastAppliedStyleSnapshot, same as it already clears lastAppliedCustomPresetId", () => {
  const preset = BUILT_IN_PRESETS.find((p) => p.id === "marker")!;
  useEditorStore.getState().applyPreset(preset.style, preset.animation);
  assert.notEqual(useEditorStore.getState().lastAppliedStyleSnapshot, null);

  useEditorStore.getState().load(fixtureProject({ id: "p2", name: "A different project" }));
  assert.equal(useEditorStore.getState().lastAppliedStyleSnapshot, null);
});

// ---------------------------------------------------------------------------------------
// P7.2 (Task 92618) — word-level timing, safe text-edit handling, quality issue navigation.
// ---------------------------------------------------------------------------------------

function multiWordFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      {
        id: "s1",
        index: 0,
        start: 0,
        end: 3,
        text: "one two three",
        words: [
          { text: "one", start: 0, end: 1 },
          { text: "two", start: 1, end: 2 },
          { text: "three", start: 2, end: 3 },
        ],
      },
      { id: "s2", index: 1, start: 3, end: 4, text: "World", words: [{ text: "World", start: 3, end: 4 }] },
    ],
  });
}

test("34. updateWordTiming applies a valid within-bounds change, and undo/redo round-trips it exactly", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateWordTiming("s1", 1, 1.2, 1.8);
  assert.deepEqual([useEditorStore.getState().project!.subtitles[0].words[1].start, useEditorStore.getState().project!.subtitles[0].words[1].end], [1.2, 1.8]);

  useEditorStore.getState().undo();
  assert.deepEqual([useEditorStore.getState().project!.subtitles[0].words[1].start, useEditorStore.getState().project!.subtitles[0].words[1].end], [1, 2]);

  useEditorStore.getState().redo();
  assert.deepEqual([useEditorStore.getState().project!.subtitles[0].words[1].start, useEditorStore.getState().project!.subtitles[0].words[1].end], [1.2, 1.8]);
});

test("35. updateWordTiming clamps against the previous/next word and the caption's own bounds — never creates overlap or escapes the caption", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateWordTiming("s1", 1, -5, 10); // word "two" — try to blow past everything
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words[1].start, 1, "must clamp to the previous word's end");
  assert.equal(s1.words[1].end, 2, "must clamp to the next word's start");
});

test("36. updateWordTiming on the FIRST word cannot precede the caption's own start", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateWordTiming("s1", 0, -5, 0.5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words[0].start, 0);
});

test("37. updateWordTiming on the LAST word cannot exceed the caption's own end", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 2.5, 20);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words[2].end, 3);
});

test("38. updateWordTiming leaves the parent caption's own start/end completely unchanged", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateWordTiming("s1", 1, 1.2, 1.8);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.start, 0);
  assert.equal(s1.end, 3);
});

test("39. updateWordTiming on one caption never touches an unrelated caption's own words or timing", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateWordTiming("s1", 1, 1.2, 1.8);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2.start, 3);
  assert.equal(s2.end, 4);
  assert.deepEqual([s2.words[0].start, s2.words[0].end], [3, 4]);
});

test("40. updateSubtitleText with the SAME word count preserves each word's own timestamp exactly", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateSubtitleText("s1", "uno two three");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words[0].text, "uno");
  assert.deepEqual([s1.words[0].start, s1.words[0].end], [0, 1], "timing must be untouched when word count matches");
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [1, 2]);
  assert.deepEqual([s1.words[2].start, s1.words[2].end], [2, 3]);
});

test("41. updateSubtitleText with a CHANGED word count never silently destroys the real per-word timestamps — words stay exactly as they were", () => {
  useEditorStore.getState().load(multiWordFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  useEditorStore.getState().updateSubtitleText("s1", "one two three four five");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.words, before, "real word timestamps must be preserved verbatim, not synthetically redistributed");
  assert.equal(s1.text, "one two three four five");
});

test("42. a word-count-changing text edit marks the caption's word timing as stale (derived), which isWordTimingStale detects", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateSubtitleText("s1", "one two three four");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(isWordTimingStale(s1), true);
});

test("43. rebuildWordTiming produces monotonic, non-overlapping words that stay within the (unchanged) parent caption bounds, and clears the stale state", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateSubtitleText("s1", "one two three four five six");
  useEditorStore.getState().rebuildWordTiming("s1");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words.length, 6);
  assert.equal(s1.start, 0, "parent caption start must be unchanged by rebuild");
  assert.equal(s1.end, 3, "parent caption end must be unchanged by rebuild");
  assert.equal(s1.words[0].start, 0);
  assert.equal(s1.words[s1.words.length - 1].end, 3);
  for (let i = 1; i < s1.words.length; i++) {
    assert.ok(s1.words[i].start >= s1.words[i - 1].end - 1e-9);
  }
  assert.equal(isWordTimingStale(s1), false, "rebuild must resolve the stale state");
});

test("44. undo after rebuildWordTiming restores BOTH the pre-rebuild text-edit result and its (stale) word timing in one step", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().updateSubtitleText("s1", "one two three four");
  const staleWords = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  useEditorStore.getState().rebuildWordTiming("s1");

  useEditorStore.getState().undo();
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.words, staleWords, "undo must restore the pre-rebuild (stale) word array exactly");
  assert.equal(s1.text, "one two three four", "undo of rebuild must not also revert the text edit — that's a separate, earlier undo step");
});

test("45. undo of the text edit itself restores both the original text AND the original (non-stale) word timing", () => {
  useEditorStore.getState().load(multiWordFixture());
  const originalWords = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  useEditorStore.getState().updateSubtitleText("s1", "one two three four");

  useEditorStore.getState().undo();
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.text, "one two three");
  assert.deepEqual(s1.words, originalWords);
});

test("46. selecting a word, then changing the selected caption, clears the word selection", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().selectSubtitle("s1");
  useEditorStore.getState().selectWord(1);
  assert.equal(useEditorStore.getState().selectedWordIndex, 1);

  useEditorStore.getState().selectSubtitle("s2");
  assert.equal(useEditorStore.getState().selectedWordIndex, null, "word selection must not survive a change of the selected caption");
});

test("46b. re-selecting the SAME caption does not clear the word selection", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().selectSubtitle("s1");
  useEditorStore.getState().selectWord(2);
  useEditorStore.getState().selectSubtitle("s1");
  assert.equal(useEditorStore.getState().selectedWordIndex, 2);
});

test("47. goToQualityIssue with no report at all is a safe no-op (returns false, no crash)", () => {
  useEditorStore.getState().load(fixtureProject());
  assert.equal(useEditorStore.getState().goToQualityIssue(1), false);
});

test("48. goToQualityIssue with a report that has zero issues is a safe no-op empty state", () => {
  // Text long enough relative to duration to avoid TOO_SLOW, and well above minDuration/CPS
  // floors — matches quality-analyzer.test.ts's own "clean subtitles" fixture convention.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "Hello there", words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }] },
        { id: "b", index: 1, start: 1.2, end: 2.2, text: "General Kenobi", words: [{ text: "General", start: 1.2, end: 1.7 }, { text: "Kenobi", start: 1.7, end: 2.2 }] },
      ],
    }),
  );
  useEditorStore.getState().runQualityAnalysis();
  assert.equal(useEditorStore.getState().qualityReport!.issues.length, 0, "this fixture matches the established 'clean subtitles' convention (quality-analyzer.test.ts) and should have no issues");
  assert.equal(useEditorStore.getState().goToQualityIssue(1), false);
});

test("49. goToQualityIssue(next) selects and seeks to the correct subtitle for the first, then subsequent, issues", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  useEditorStore.getState().runQualityAnalysis();
  const issues = useEditorStore.getState().qualityReport!.issues;
  assert.ok(issues.length >= 1, "overlapping captions a/b should produce at least one issue");

  useEditorStore.getState().goToQualityIssue(1);
  assert.equal(useEditorStore.getState().qualityIssueIndex, 0, "first 'next' press lands on the first issue");
  assert.equal(useEditorStore.getState().selectedSubtitleId, issues[0].captionId);
  assert.equal(useEditorStore.getState().currentTime, useEditorStore.getState().project!.subtitles.find((s) => s.id === issues[0].captionId)!.start);
});

test("50. goToQualityIssue(previous) from the start clamps at the first issue rather than going negative", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().goToQualityIssue(-1);
  assert.equal(useEditorStore.getState().qualityIssueIndex, 0);
});

test("51. goToQualityIssue clamps and stops at the LAST issue rather than wrapping around", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "a",
          index: 0,
          start: -1,
          end: -0.5,
          text: "Bad",
          words: [{ text: "Bad", start: -1, end: -0.5 }],
        },
        { id: "b", index: 1, start: 10, end: 10, text: "AlsoBad", words: [{ text: "AlsoBad", start: 10, end: 10 }] },
      ],
    }),
  );
  useEditorStore.getState().runQualityAnalysis();
  const issueCount = useEditorStore.getState().qualityReport!.issues.length;
  assert.ok(issueCount >= 2, "both malformed captions should each produce at least one issue");

  for (let i = 0; i < issueCount + 3; i++) useEditorStore.getState().goToQualityIssue(1);
  assert.equal(useEditorStore.getState().qualityIssueIndex, issueCount - 1, "must clamp at the last issue, not wrap back to 0");
});

test("52. runQualityAnalysis resets the quality issue cursor, so a fresh report doesn't reuse a stale index", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().goToQualityIssue(1);
  assert.notEqual(useEditorStore.getState().qualityIssueIndex, null);

  useEditorStore.getState().runQualityAnalysis();
  assert.equal(useEditorStore.getState().qualityIssueIndex, null);
});

test("53. load() also clears the quality issue cursor", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().goToQualityIssue(1);
  useEditorStore.getState().load(fixtureProject());
  assert.equal(useEditorStore.getState().qualityIssueIndex, null);
});

// ---------------------------------------------------------------------------------------
// P7.3 (Task 93471) — caption <-> word timing consistency audit fixes: resize-shrink clamp,
// merge-concatenation clamp, delete/selectedWordIndex lifecycle, split/duplicate regression
// coverage.
// ---------------------------------------------------------------------------------------

test("54. updateSubtitleTiming: a RIGHT-edge resize that shrinks past a word's own end rejects the whole resize atomically (Task 115894/P18.8 — was a silent reposition under P7.3)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 3, text: "one two", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 2, end: 3 }] },
      ],
    }),
  );
  const s1Before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 1.5); // would shrink past "two" ([2,3])
  assert.equal(result, "word-out-of-bounds");
  const s1After = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1After, s1Before, "rejected resize: the caption keeps its exact prior object reference");
  assert.equal(s1After.end, 3, "the caption bounds must be completely untouched");
  assert.deepEqual([s1After.words[0].start, s1After.words[0].end], [0, 1]);
  assert.deepEqual([s1After.words[1].start, s1After.words[1].end], [2, 3], "the word's real timing must not be repositioned");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no history entry for a rejected resize");
});

test("55. updateSubtitleTiming: a LEFT-edge resize that shrinks past a word's own start rejects the whole resize atomically (Task 115894/P18.8 — was a silent reposition under P7.3)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 3, text: "one two", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 2, end: 3 }] },
      ],
    }),
  );
  const s1Before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 1.5, 3); // would shrink past "one" ([0,1])
  assert.equal(result, "word-out-of-bounds");
  const s1After = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1After, s1Before, "rejected resize: the caption keeps its exact prior object reference");
  assert.equal(s1After.start, 0, "the caption bounds must be completely untouched");
  assert.deepEqual([s1After.words[0].start, s1After.words[0].end], [0, 1], "the word's real timing must not be repositioned");
  assert.deepEqual([s1After.words[1].start, s1After.words[1].end], [2, 3]);
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no history entry for a rejected resize");
});

test("56. updateSubtitleTiming: a resize that stays within all existing word bounds leaves the words array completely untouched (regression — matches the pre-P7.3 behavior in the common case)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [{ id: "s1", index: 0, start: 0, end: 3, text: "one", words: [{ text: "one", start: 0, end: 1 }] }],
    }),
  );
  const beforeWords = useEditorStore.getState().project!.subtitles[0].words;
  useEditorStore.getState().updateSubtitleTiming("s1", 0, 2); // shrinks 3->2, word [0,1] is still comfortably inside
  const s1 = useEditorStore.getState().project!.subtitles[0];
  assert.equal(s1.words, beforeWords, "words must be the exact same array reference — untouched — when the resize never crosses any word");
});

test("57. mergeWithNext: the common case (non-overlapping, already-adjacent words) preserves every timestamp exactly — the clamp is a no-op", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1, end: 2, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  useEditorStore.getState().mergeWithNext("a");
  const merged = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(merged.words.map((w) => [w.start, w.end]), [[0, 1], [1, 2]], "exact original timestamps must be preserved when there is nothing to fix");
});

test("58. mergeWithNext: Task 114761 (P18.7) — an overlap between the two captions' own words (pre-existing drift) is REJECTED, not silently repaired", () => {
  // Pre-P18.7, this scenario was silently "fixed" by clampWordsToCaptionBounds, which walked the
  // concatenated word array in order and repositioned "World" forward to close the overlap — a
  // position-order-dependent repair that Task 113528 (P18.6)'s non-monotonic word order made
  // fundamentally unsafe (see merge-subtitles.ts's own top-of-file doc comment: that same clamp,
  // fed a non-monotonic array, would drag a correctly-ordered-by-time word's REAL timing forward
  // to "fix" an overlap that was never actually there). P18.7 replaces silent repair with
  // rejection across the board, including this pre-existing-drift case — the two captions
  // genuinely overlap (a.end=1.2 > b.start=1), and merging them now fails loudly instead of
  // quietly reshaping data.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1.2, text: "Hello", words: [{ text: "Hello", start: 0, end: 1.2 }] },
        { id: "b", index: 1, start: 1, end: 2, text: "World", words: [{ text: "World", start: 1, end: 2 }] },
      ],
    }),
  );
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().mergeWithNext("a");
  assert.equal(result, "overlap");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no commit — the two original captions are untouched");
  assert.ok(useEditorStore.getState().project!.subtitles.find((s) => s.id === "a"));
  assert.ok(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b"));
});

test("59. deleteSubtitle clears selectedWordIndex when the DELETED caption was the selected one (no orphaned word index survives its parent's deletion)", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().selectSubtitle("s1");
  useEditorStore.getState().selectWord(1);
  useEditorStore.getState().deleteSubtitle("s1");
  assert.equal(useEditorStore.getState().selectedSubtitleId, null);
  assert.equal(useEditorStore.getState().selectedWordIndex, null, "selectedWordIndex must not survive its parent caption's deletion");
});

test("60. deleteSubtitle does NOT clear selectedWordIndex when an UNRELATED (non-selected) caption is deleted", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().selectSubtitle("s1");
  useEditorStore.getState().selectWord(1);
  useEditorStore.getState().deleteSubtitle("s2"); // s2 is NOT the selected caption
  assert.equal(useEditorStore.getState().selectedSubtitleId, "s1", "the selected caption itself must be unaffected");
  assert.equal(useEditorStore.getState().selectedWordIndex, 1, "an unrelated deletion must not clear the current word selection");
});

test("61. deleteSubtitle: undo restores the deleted caption's exact word array, and redo removes it again", () => {
  useEditorStore.getState().load(multiWordFixture());
  const originalWords = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  useEditorStore.getState().deleteSubtitle("s1");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1"), undefined);

  useEditorStore.getState().undo();
  const restored = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(restored.words, originalWords, "undo must restore the exact original word array");

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1"), undefined, "redo must remove it again");
});

test("62. splitSubtitleAtTime: word timestamps are preserved exactly across the split, no word ends up outside its new caption, and timing stays monotonic", () => {
  useEditorStore.getState().load(multiWordFixture()); // s1 = [0,3] with words "one"[0,1] "two"[1,2] "three"[2,3]
  assert.equal(useEditorStore.getState().splitSubtitleAtTime("s1", 1), "ok"); // split before "two"
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 3, "the original 2-caption fixture becomes 3 after the split");
  const left = subs.find((s) => s.text.includes("one"))!;
  const right = subs.find((s) => s.text.includes("two"))!;

  assert.deepEqual(left.words.map((w) => [w.start, w.end]), [[0, 1]], "left half keeps its own word's exact original timestamp");
  assert.deepEqual(right.words.map((w) => [w.start, w.end]), [[1, 2], [2, 3]], "right half keeps its own words' exact original timestamps");
  for (const w of left.words) assert.ok(w.start >= left.start - 1e-9 && w.end <= left.end + 1e-9, "no word outside the left half's own bounds");
  for (const w of right.words) assert.ok(w.start >= right.start - 1e-9 && w.end <= right.end + 1e-9, "no word outside the right half's own bounds");
  assert.ok(left.end <= right.start + 1e-9, "the two halves must not overlap");
});

test("63. splitSubtitleAtTime: undo restores the exact original (unsplit) caption, and redo re-splits it", () => {
  useEditorStore.getState().load(multiWordFixture());
  const originalWords = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  assert.equal(useEditorStore.getState().splitSubtitleAtTime("s1", 1), "ok");
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);

  useEditorStore.getState().undo();
  const restored = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(restored.words, originalWords);
  assert.equal(useEditorStore.getState().project!.subtitles.length, 2);

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);
});

test("64. duplicateSubtitle: explicit bounds check — no word in the duplicate ever falls outside the duplicate's own [start, end]", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 2, text: "Hello there", words: [{ text: "Hello", start: 0.1, end: 0.9 }, { text: "there", start: 1.0, end: 1.9 }] },
      ],
    }),
  );
  useEditorStore.getState().duplicateSubtitle("s1");
  const dup = useEditorStore.getState().project!.subtitles[1];
  for (const w of dup.words) {
    assert.ok(w.start >= dup.start - 1e-9 && w.end <= dup.end + 1e-9, "every duplicated word must stay inside the duplicate's own bounds");
  }
});

test("65. duplicateSubtitle: undo/redo round-trips the duplicate's exact word timing", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().duplicateSubtitle("s1");
  const dupWords = useEditorStore.getState().project!.subtitles[1].words;

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 2, "duplicate removed by undo");

  useEditorStore.getState().redo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles[1].words, dupWords, "redo restores the exact same duplicated word timing");
});

// ---------------------------------------------------------------------------------------------
// Task 94820 (P8) — Multi-caption selection & batch editing. Five non-overlapping captions with
// deliberate 0.5s GAPS between them (unlike multiWordFixture's back-to-back captions) so batch
// timing-nudge tests can distinguish "clamped against a real neighbor" from "clamped against an
// adjacent caption with zero slack" — each caption's one word matches its own [start,end] exactly.
// ---------------------------------------------------------------------------------------------
function multiCaptionFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      { id: "s1", index: 0, start: 0, end: 1, text: "one", words: [{ text: "one", start: 0, end: 1 }] },
      { id: "s2", index: 1, start: 1.5, end: 2.5, text: "two", words: [{ text: "two", start: 1.5, end: 2.5 }] },
      { id: "s3", index: 2, start: 3, end: 4, text: "three", words: [{ text: "three", start: 3, end: 4 }] },
      { id: "s4", index: 3, start: 4.5, end: 5.5, text: "four", words: [{ text: "four", start: 4.5, end: 5.5 }] },
      { id: "s5", index: 4, start: 6, end: 7, text: "five", words: [{ text: "five", start: 6, end: 7 }] },
    ],
  });
}

/** Task 95640 (P9): compares a caption's own content (start/end/text/words/style/animation)
 * while ignoring `index`, which naturally renumbers whenever a caption is inserted earlier in
 * the array — used by duplicate-collision tests that assert an untouched caption's own DATA
 * never changed, without being thrown off by its array position shifting. */
function stripIndex(s: Subtitle): Omit<Subtitle, "index"> {
  const clone = { ...s } as Partial<Subtitle>;
  delete clone.index;
  return clone as Omit<Subtitle, "index">;
}

test("66. toggleSubtitleSelection: Ctrl-click adds then removes a caption from the selection", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().toggleSubtitleSelection("s2");
  assert.deepEqual([...useEditorStore.getState().selectedSubtitleIds], ["s2"]);
  assert.equal(useEditorStore.getState().selectedSubtitleId, "s2", "the toggled caption becomes focused");

  useEditorStore.getState().toggleSubtitleSelection("s2");
  assert.equal(useEditorStore.getState().selectedSubtitleIds.size, 0, "toggling the last selected id off empties the selection");
  assert.equal(useEditorStore.getState().selectedSubtitleId, null, "focus clears once the selection is empty");
  assert.equal(useEditorStore.getState().selectionAnchorId, null);
});

test("67. toggleSubtitleSelection: Ctrl-clicking several captions builds an independent multi-selection", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().toggleSubtitleSelection("s1");
  useEditorStore.getState().toggleSubtitleSelection("s3");
  useEditorStore.getState().toggleSubtitleSelection("s5");
  assert.deepEqual(new Set(useEditorStore.getState().selectedSubtitleIds), new Set(["s1", "s3", "s5"]));
  assert.equal(useEditorStore.getState().selectedSubtitleId, "s5", "the LAST toggled caption is focused");

  useEditorStore.getState().toggleSubtitleSelection("s3");
  assert.deepEqual(new Set(useEditorStore.getState().selectedSubtitleIds), new Set(["s1", "s5"]), "removing one leaves the rest untouched");
});

test("68. selectSubtitleRange: Shift-click selects the contiguous TIME-ORDER range between the anchor and the target, inclusive", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().selectSubtitle("s2"); // sets the anchor to s2
  useEditorStore.getState().selectSubtitleRange("s4");
  assert.deepEqual(new Set(useEditorStore.getState().selectedSubtitleIds), new Set(["s2", "s3", "s4"]));
  assert.equal(useEditorStore.getState().selectedSubtitleId, "s4", "the shift-clicked caption becomes focused");
});

test("68b. selectSubtitleRange: a range shift-clicked BACKWARD (target before anchor) still selects correctly", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().selectSubtitle("s4");
  useEditorStore.getState().selectSubtitleRange("s2");
  assert.deepEqual(new Set(useEditorStore.getState().selectedSubtitleIds), new Set(["s2", "s3", "s4"]));
});

test("69. selectSubtitleRange: repeated Shift-clicks re-range from the SAME fixed anchor, not the previous Shift-click target", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().selectSubtitle("s2"); // anchor = s2
  useEditorStore.getState().selectSubtitleRange("s4"); // range s2..s4
  useEditorStore.getState().selectSubtitleRange("s3"); // shrink back to s2..s3, still anchored at s2 (not s4)
  assert.deepEqual(new Set(useEditorStore.getState().selectedSubtitleIds), new Set(["s2", "s3"]));
  assert.equal(useEditorStore.getState().selectionAnchorId, "s2");
});

test("70. selectSubtitle (a plain, unmodified click) collapses an active multi-selection down to just the clicked caption", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().selectSubtitle("s1");
  useEditorStore.getState().selectSubtitleRange("s4");
  assert.equal(useEditorStore.getState().selectedSubtitleIds.size, 4);

  useEditorStore.getState().selectSubtitle("s3");
  assert.deepEqual([...useEditorStore.getState().selectedSubtitleIds], ["s3"]);
  assert.equal(useEditorStore.getState().selectionAnchorId, "s3");
});

test("71. selectAllSubtitles: selects every caption and keeps the current focus if it's still valid", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().selectSubtitle("s3");
  useEditorStore.getState().selectAllSubtitles();
  assert.deepEqual(new Set(useEditorStore.getState().selectedSubtitleIds), new Set(["s1", "s2", "s3", "s4", "s5"]));
  assert.equal(useEditorStore.getState().selectedSubtitleId, "s3", "the already-focused caption stays focused");
});

test("72. commit() prunes a stale id out of the selection when a DIFFERENT mutation removes that caption (e.g. mergeWithNext absorbing it)", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().selectSubtitle("s1");
  useEditorStore.getState().toggleSubtitleSelection("s2");
  useEditorStore.getState().toggleSubtitleSelection("s3");
  assert.deepEqual(new Set(useEditorStore.getState().selectedSubtitleIds), new Set(["s1", "s2", "s3"]));

  // mergeWithNext("s1") absorbs s2 into s1 — s2's id no longer exists afterward.
  useEditorStore.getState().mergeWithNext("s1");
  assert.deepEqual(
    new Set(useEditorStore.getState().selectedSubtitleIds),
    new Set(["s1", "s3"]),
    "the merged-away id is pruned automatically; every still-valid id survives untouched",
  );

  // Undo brings s2 back into project.subtitles, but selection is ephemeral (never part of a
  // HistorySnapshot) — undo must not silently resurrect it into the selection either, and must
  // not leave anything stale/corrupted.
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.some((s) => s.id === "s2"), true, "s2 exists again after undo");
  assert.deepEqual(
    new Set(useEditorStore.getState().selectedSubtitleIds),
    new Set(["s1", "s3"]),
    "undo does not resurrect the pruned id into the selection — selection stays exactly as it was, referencing only valid ids",
  );
});

test("73. deleteSubtitles: removes every selected caption in ONE commit (one undo step) and clears them from the selection", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().deleteSubtitles(["s2", "s4"]);

  const ids = useEditorStore.getState().project!.subtitles.map((s) => s.id);
  assert.deepEqual(ids, ["s1", "s3", "s5"]);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "batch delete is exactly ONE undo entry, not one per caption");
  assert.equal(useEditorStore.getState().project!.subtitles.every((s, i) => s.index === i), true, "remaining captions are re-indexed");
});

test("74. deleteSubtitles: undo restores every deleted caption's EXACT data (words, timing) in one step, and clears the focused/selected id it deleted", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().selectSubtitle("s2");
  useEditorStore.getState().toggleSubtitleSelection("s4");
  const s2Original = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  const s4Original = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s4")!;

  useEditorStore.getState().deleteSubtitles(["s2", "s4"]);
  assert.equal(useEditorStore.getState().selectedSubtitleIds.size, 0);
  assert.equal(useEditorStore.getState().selectedSubtitleId, null, "the deleted focused caption is cleared");

  useEditorStore.getState().undo();
  const restored = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(restored.find((s) => s.id === "s2"), s2Original);
  assert.deepEqual(restored.find((s) => s.id === "s4"), s4Original);
  assert.equal(restored.length, 5);

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3, "redo re-applies the whole batch delete in one step");
});

test("75. nudgeSubtitles: a CONTIGUOUS selection moves together, preserving each caption's own duration and relative spacing, in ONE commit", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().nudgeSubtitles(["s2", "s3"], 0.3);

  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  const s3 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s3")!;
  assert.deepEqual([s2.start, s2.end], [1.8, 2.8]);
  assert.deepEqual([s3.start, s3.end], [3.3, 4.3]);
  assert.equal(s3.start - s2.end, 3 - 2.5, "the original gap between the two selected captions is preserved exactly");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "batch nudge is exactly ONE undo entry");
});

test("76. nudgeSubtitles: clamps the WHOLE batch's delta against the nearest UNSELECTED neighbor ahead of the selection", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  // s2,s3 selected; s4 (unselected) starts at 4.5, s3 ends at 4 — only 0.5s of room forward.
  useEditorStore.getState().nudgeSubtitles(["s2", "s3"], 10);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  const s3 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s3")!;
  assert.deepEqual([s2.start, s2.end], [2, 3]);
  assert.deepEqual([s3.start, s3.end], [3.5, 4.5], "clamped so s3 stops exactly at s4's own start — never overlaps it");
});

test("77. nudgeSubtitles: clamps the WHOLE batch's delta against the nearest UNSELECTED neighbor behind the selection", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().nudgeSubtitles(["s2", "s3"], -10);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.deepEqual([s2.start, s2.end], [1, 2], "clamped so s2 stops exactly at s1's own end — never overlaps it");
  assert.deepEqual([s1.start, s1.end], [0, 1], "the unselected neighbor itself never moves");
});

test("78. nudgeSubtitles: a NON-CONTIGUOUS selection still moves as ONE rigid unit, clamped by whichever gap is tightest anywhere", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  // s1,s3 selected (s2 sits between them, unselected). Forward room: s1→s2 gap is 0.5s (1→1.5),
  // s3→s4 gap is also 0.5s (4→4.5) — both bind at the same delta here, so this also covers "the
  // tightest constraint anywhere in the selection wins," not just "the outer span's edges."
  useEditorStore.getState().nudgeSubtitles(["s1", "s3"], 10);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  const s3 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s3")!;
  assert.deepEqual([s1.start, s1.end], [0.5, 1.5], "s1 shifted by the SAME clamped delta as s3");
  assert.deepEqual([s3.start, s3.end], [3.5, 4.5]);
  assert.deepEqual([s2.start, s2.end], [1.5, 2.5], "the unselected caption between them never moves");
});

test("79. nudgeSubtitles: shifts every selected caption's word timestamps by the same delta, staying relative to their own caption", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().nudgeSubtitles(["s2", "s3"], 0.3);
  const s2 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.deepEqual([s2.words[0].start, s2.words[0].end], [1.8, 2.8], "the word moved by the exact same delta as its caption");
});

test("80. nudgeSubtitles: a delta that clamps to exactly zero is a true no-op — no commit, no new undo entry", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().nudgeSubtitles(["s1"], -5); // s1 already starts at 0, can't move earlier
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no commit was made");
  assert.deepEqual(
    [useEditorStore.getState().project!.subtitles[0].start, useEditorStore.getState().project!.subtitles[0].end],
    [0, 1],
  );
});

test("81. applyStyleToSubtitles: applies the same patch to every selected caption in ONE commit, leaving others and word-level overrides untouched", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().setWordStyleOverride("s2", 0, { color: "#abcdef" }); // pre-existing word override
  const pastBefore = useEditorStore.getState().past.length;

  useEditorStore.getState().applyStyleToSubtitles(["s1", "s2", "s3"], { fontSize: 88 });

  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "s1")!.style?.fontSize, 88);
  assert.equal(subs.find((s) => s.id === "s2")!.style?.fontSize, 88);
  assert.equal(subs.find((s) => s.id === "s3")!.style?.fontSize, 88);
  assert.equal(subs.find((s) => s.id === "s4")!.style, undefined, "an unselected caption is never touched");
  assert.equal(subs.find((s) => s.id === "s2")!.words[0].style?.color, "#abcdef", "the pre-existing word-level override survives untouched");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "one undo step for the whole batch");
});

test("82. applyStyleToSubtitles: a null patch clears the per-caption override for the entire batch", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().applyStyleToSubtitles(["s1", "s2"], { fontSize: 60 });
  useEditorStore.getState().applyStyleToSubtitles(["s1", "s2"], null);
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "s1")!.style, undefined);
  assert.equal(subs.find((s) => s.id === "s2")!.style, undefined);
});

test("83. applyAnimationToSubtitles: applies the same patch to every selected caption in ONE commit", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().applyAnimationToSubtitles(["s1", "s3", "s5"], { entrance: "bounce" });
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "s1")!.animation?.entrance, "bounce");
  assert.equal(subs.find((s) => s.id === "s3")!.animation?.entrance, "bounce");
  assert.equal(subs.find((s) => s.id === "s5")!.animation?.entrance, "bounce");
  assert.equal(subs.find((s) => s.id === "s2")!.animation, undefined);
});

test("84. duplicateSubtitles: a CONTIGUOUS selection duplicates as one shifted block in ONE commit, preserving relative timing/duration/words", () => {
  // Task 95640 (P9): multiCaptionFixture's own s4[4.5,5.5] sits too close after s3[3,4] to leave
  // room for the whole duplicated s2+s3 block (width 2.5s) — that collision-rejection case has
  // its own dedicated tests below. This test is about the successful-placement mechanics, so it
  // drops s4/s5 (no following caption at all — Case E) rather than reusing the shared fixture.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: multiCaptionFixture().subtitles.filter((s) => s.id === "s1" || s.id === "s2" || s.id === "s3"),
    }),
  );
  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().duplicateSubtitles(["s2", "s3"]);
  assert.equal(ok, "ok");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "one undo step for the whole duplicated block");

  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 5);
  // Original block s2[1.5,2.5]..s3[3,4] spans 2.5s; the copy starts exactly at s3.end (4).
  const copyOfS2 = subs.find((s) => s.text === "two" && s.id !== "s2")!;
  const copyOfS3 = subs.find((s) => s.text === "three" && s.id !== "s3")!;
  assert.deepEqual([copyOfS2.start, copyOfS2.end], [4, 5]);
  assert.deepEqual([copyOfS3.start, copyOfS3.end], [5.5, 6.5]);
  assert.equal(copyOfS3.start - copyOfS2.end, 3 - 2.5, "the internal gap between the two duplicated captions is preserved");
  assert.deepEqual([copyOfS2.words[0].start, copyOfS2.words[0].end], [4, 5], "word timing shifted by the same offset as its caption");
  assert.notEqual(copyOfS2.id, "s2");
});

test("85. duplicateSubtitles: a NON-CONTIGUOUS selection is deferred — returns \"non-contiguous\", makes NO commit at all", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const countBefore = useEditorStore.getState().project!.subtitles.length;
  const ok = useEditorStore.getState().duplicateSubtitles(["s1", "s3"]); // s2 sits between them, unselected
  assert.equal(ok, "non-contiguous");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no undo entry was created for the deferred no-op");
  assert.equal(useEditorStore.getState().project!.subtitles.length, countBefore, "nothing was added");
});

test("86. duplicateSubtitles: undo/redo round-trips the whole duplicated block in one step", () => {
  // Task 95640 (P9): same fixture adjustment as test 84 — s4 sits too close after s3 to leave
  // room for the duplicated block.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: multiCaptionFixture().subtitles.filter((s) => s.id === "s1" || s.id === "s2" || s.id === "s3"),
    }),
  );
  const result = useEditorStore.getState().duplicateSubtitles(["s2", "s3"]);
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().project!.subtitles.length, 5);

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3, "undo removes BOTH duplicated captions in one step");

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 5, "redo re-creates both in one step");
});

test("87. undo/redo across mixed batch-then-single and single-then-batch operations steps back/forward correctly", () => {
  useEditorStore.getState().load(multiCaptionFixture());
  useEditorStore.getState().nudgeSubtitles(["s1"], 0.2); // single-caption batch call, step A
  useEditorStore.getState().deleteSubtitles(["s2", "s3"]); // batch, step B
  useEditorStore.getState().updateSubtitleText("s4", "FOUR"); // ordinary single-caption edit, step C

  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s4")!.text, "FOUR");

  useEditorStore.getState().undo(); // undoes C
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s4")!.text, "four");
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);

  useEditorStore.getState().undo(); // undoes B
  assert.equal(useEditorStore.getState().project!.subtitles.length, 5);

  useEditorStore.getState().undo(); // undoes A
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.start, 0);

  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s4")!.text, "FOUR");
});

test("88. performance: batch selection/nudge/style/delete stay fast on a 5,400-caption project (single-pass, not O(n²))", () => {
  // Same synthetic-dataset convention as word-timing.test.ts's own 5,400-caption regression guard
  // and visible-range.test.ts's own 5,400-caption test — a plain Array.from building minimal
  // caption-shaped objects, no shared fixture helper (none exists in this codebase — see this
  // task's own pre-implementation audit).
  const subtitles: Subtitle[] = Array.from({ length: 5400 }, (_, i) => ({
    id: `big${i}`,
    index: i,
    start: i * 0.6,
    end: i * 0.6 + 0.5,
    text: `word${i}`,
    words: [{ text: `word${i}`, start: i * 0.6, end: i * 0.6 + 0.5 }],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));

  const t0 = performance.now();
  useEditorStore.getState().selectAllSubtitles();
  const t1 = performance.now();
  assert.equal(useEditorStore.getState().selectedSubtitleIds.size, 5400);
  assert.ok(t1 - t0 < 300, `selectAllSubtitles over 5,400 captions took ${t1 - t0}ms — expected a single fast pass`);

  const everyOtherId = subtitles.filter((_, i) => i % 2 === 0).map((s) => s.id); // 2,700 ids, deliberately non-contiguous
  const t2 = performance.now();
  useEditorStore.getState().nudgeSubtitles(everyOtherId, 0.05);
  const t3 = performance.now();
  assert.ok(t3 - t2 < 300, `nudgeSubtitles over 2,700 non-contiguous selected captions took ${t3 - t2}ms — must stay a single O(n) pass`);

  const t4 = performance.now();
  useEditorStore.getState().applyStyleToSubtitles(everyOtherId, { fontSize: 70 });
  const t5 = performance.now();
  assert.ok(t5 - t4 < 300, `applyStyleToSubtitles over 2,700 captions took ${t5 - t4}ms`);

  const t6 = performance.now();
  useEditorStore.getState().deleteSubtitles(everyOtherId);
  const t7 = performance.now();
  assert.equal(useEditorStore.getState().project!.subtitles.length, 2700);
  assert.ok(t7 - t6 < 300, `deleteSubtitles over 2,700 captions took ${t7 - t6}ms`);
});

// ---------------------------------------------------------------------------------------------
// Task 95640 (P9) — Duplicate Collision Safety & Timeline Hardening. P8 discovered that
// duplicateSubtitle/duplicateSubtitles could place a copy directly on top of an already-existing
// following caption. The fix (lib/subtitles/duplicate-timing.ts's resolveDuplicateShift, unit
// tested on its own in duplicate-timing.test.ts) is exercised here at the full store level:
// placement, rejection, undo/redo, and style/animation/word-timing preservation for both the
// single- and batch-caption paths.
// ---------------------------------------------------------------------------------------------

test("89. duplicateSubtitle Case A (normal spacing): plenty of room after the original places the copy at full width", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "A", words: [{ text: "A", start: 0, end: 2 }] },
        { id: "b", index: 1, start: 10, end: 12, text: "B", words: [{ text: "B", start: 10, end: 12 }] },
      ],
    }),
  );
  const result = useEditorStore.getState().duplicateSubtitle("a");
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 3);
  assert.deepEqual([subs[1].start, subs[1].end], [2, 4], "duplicate placed flush after the original, well clear of B");
});

test("90. duplicateSubtitle Case B (zero gap): the following caption starts exactly where the original ends — rejected, no data change", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "A", words: [{ text: "A", start: 0, end: 2 }] },
        { id: "b", index: 1, start: 2, end: 4, text: "B", words: [{ text: "B", start: 2, end: 4 }] },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().duplicateSubtitle("a");
  assert.equal(result, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before, "not one field changed");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no undo entry was created for the rejected attempt");
});

test("91. duplicateSubtitle Case C (tight gap): the following caption leaves less room than the required width — rejected", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "A", words: [{ text: "A", start: 0, end: 2 }] },
        { id: "b", index: 1, start: 2.1, end: 4, text: "B", words: [{ text: "B", start: 2.1, end: 4 }] },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().duplicateSubtitle("a");
  assert.equal(result, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
});

test("92. duplicateSubtitle Case D (partial/pre-existing overlap): the 'next' caption already overlaps the original — rejected, not crashed", () => {
  // Pathological pre-existing data (should not occur under the editor's own invariants, but must
  // be handled defensively rather than compounding the corruption — see duplicate-timing.ts's own
  // doc comment).
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "A", words: [{ text: "A", start: 0, end: 2 }] },
        { id: "b", index: 1, start: 1, end: 3, text: "B", words: [{ text: "B", start: 1, end: 3 }] },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().duplicateSubtitle("a");
  assert.equal(result, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
});

test("93. duplicateSubtitle Case E (no following caption): the last (or only) caption in the project always has room", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [{ id: "a", index: 0, start: 0, end: 2, text: "A", words: [{ text: "A", start: 0, end: 2 }] }],
    }),
  );
  const result = useEditorStore.getState().duplicateSubtitle("a");
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().project!.subtitles.length, 2);
});

test("94. duplicateSubtitle near the BEGINNING of the project inserts immediately after itself, before the rest", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 5, end: 6, text: "B", words: [{ text: "B", start: 5, end: 6 }] },
        { id: "c", index: 2, start: 10, end: 11, text: "C", words: [{ text: "C", start: 10, end: 11 }] },
      ],
    }),
  );
  const result = useEditorStore.getState().duplicateSubtitle("a");
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(subs.map((s) => s.text), ["A", "A", "B", "C"]);
  assert.deepEqual([subs[1].start, subs[1].end], [1, 2]);
});

test("95. duplicateSubtitle near the END of the project (the last of several captions) behaves the same as Case E", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 2, end: 3, text: "B", words: [{ text: "B", start: 2, end: 3 }] },
        { id: "c", index: 2, start: 4, end: 5, text: "C", words: [{ text: "C", start: 4, end: 5 }] },
      ],
    }),
  );
  const result = useEditorStore.getState().duplicateSubtitle("c");
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(subs.map((s) => s.text), ["A", "B", "C", "C"]);
  assert.deepEqual([subs[3].start, subs[3].end], [5, 6]);
});

test("96. IMPORTANT EDGE CASE — A,B,C,D with multiple later captions: duplicating a MIDDLE one with room succeeds without ever touching (or colliding with) captions farther down the timeline", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 2, end: 3, text: "B", words: [{ text: "B", start: 2, end: 3 }] },
        { id: "c", index: 2, start: 10, end: 11, text: "C", words: [{ text: "C", start: 10, end: 11 }] },
        { id: "d", index: 3, start: 12, end: 13, text: "D", words: [{ text: "D", start: 12, end: 13 }] },
      ],
    }),
  );
  // stripIndex() ignores `index`, which naturally renumbers after any insertion earlier in the
  // array — the actual guarantee under test is that C/D's own start/end/text/words never change,
  // not that their position in the array stays numerically the same.
  const cBefore = stripIndex(useEditorStore.getState().project!.subtitles.find((s) => s.id === "c")!);
  const dBefore = stripIndex(useEditorStore.getState().project!.subtitles.find((s) => s.id === "d")!);
  const result = useEditorStore.getState().duplicateSubtitle("b"); // plenty of room before C (2->3, C starts at 10)
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(subs.map((s) => s.text), ["A", "B", "B", "C", "D"]);
  assert.deepEqual(stripIndex(subs.find((s) => s.id === "c")!), cBefore, "C is completely untouched");
  assert.deepEqual(stripIndex(subs.find((s) => s.id === "d")!), dBefore, "D is completely untouched — no collision introduced farther down the timeline");
});

test("96b. IMPORTANT EDGE CASE — A,B,C,D: duplicating a MIDDLE one WITHOUT room is rejected cleanly, never reaching through to collide with C or D", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 2, end: 4, text: "B", words: [{ text: "B", start: 2, end: 4 }] }, // 2s duration
        { id: "c", index: 2, start: 4.1, end: 5, text: "C", words: [{ text: "C", start: 4.1, end: 5 }] }, // only 0.1s room after B
        { id: "d", index: 3, start: 6, end: 7, text: "D", words: [{ text: "D", start: 6, end: 7 }] },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().duplicateSubtitle("b");
  assert.equal(result, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before, "the whole project is byte-for-byte unchanged, including C and D far down the timeline");
});

test("97. duplicateSubtitle never mutates the ORIGINAL caption's own word timestamps", () => {
  useEditorStore.getState().load(multiWordFixture());
  const originalWords = useEditorStore.getState().project!.subtitles[0].words;
  useEditorStore.getState().duplicateSubtitle("s1");
  assert.deepEqual(useEditorStore.getState().project!.subtitles[0].words, originalWords, "the original caption's own words are byte-for-byte unchanged");
});

test("98. duplicateSubtitle shifts EVERY duplicated word by the same amount as its caption, preserving relative word timing", () => {
  // multiWordFixture's own s2 starts at exactly 3 (zero gap after s1) — give it room instead,
  // since this test is about word-shift math, not collision rejection (see tests 89-96b for that).
  const fixture = multiWordFixture();
  fixture.subtitles = fixture.subtitles.map((s) => (s.id === "s2" ? { ...s, start: 10, end: 11, words: [{ text: "World", start: 10, end: 11 }] } : s));
  useEditorStore.getState().load(fixture);
  const result = useEditorStore.getState().duplicateSubtitle("s1");
  assert.equal(result, "ok");
  const dup = useEditorStore.getState().project!.subtitles[1];
  assert.deepEqual(
    dup.words.map((w) => [w.start, w.end]),
    [
      [3, 4],
      [4, 5],
      [5, 6],
    ],
    "each word shifted by exactly the caption's own 3s shift, preserving its own 1s duration and order",
  );
});

test("99. duplicateSubtitle preserves the original's caption-level STYLE override on the copy", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }], style: { color: "#123456" } },
      ],
    }),
  );
  useEditorStore.getState().duplicateSubtitle("a");
  assert.deepEqual(useEditorStore.getState().project!.subtitles[1].style, { color: "#123456" });
});

test("100. duplicateSubtitle preserves the original's ANIMATION override on the copy", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }], animation: { entrance: "pop" } },
      ],
    }),
  );
  useEditorStore.getState().duplicateSubtitle("a");
  assert.deepEqual(useEditorStore.getState().project!.subtitles[1].animation, { entrance: "pop" });
});

test("101. duplicateSubtitle: undo removes exactly the duplicate, restoring the original array exactly", () => {
  useEditorStore.getState().load(multiWordFixture());
  const before = useEditorStore.getState().project!.subtitles;
  useEditorStore.getState().duplicateSubtitle("s1");
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
});

test("102. duplicateSubtitle: redo re-creates the exact same duplicate", () => {
  useEditorStore.getState().load(multiWordFixture());
  useEditorStore.getState().duplicateSubtitle("s1");
  const afterDuplicate = useEditorStore.getState().project!.subtitles;
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, afterDuplicate);
});

test("103. duplicateSubtitles Case B (zero-gap trailing caption): rejected, no commit at all", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1.5, end: 2.5, text: "B", words: [{ text: "B", start: 1.5, end: 2.5 }] },
        { id: "c", index: 2, start: 2.5, end: 3.5, text: "C", words: [{ text: "C", start: 2.5, end: 3.5 }] }, // zero gap after B
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().duplicateSubtitles(["a", "b"]);
  assert.equal(result, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("104. duplicateSubtitles Case C (tight-gap trailing caption): the block's own width doesn't fit in the small remaining gap — rejected", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1.5, end: 2.5, text: "B", words: [{ text: "B", start: 1.5, end: 2.5 }] }, // block a+b spans [0,2.5], width 2.5
        { id: "c", index: 2, start: 2.6, end: 3.5, text: "C", words: [{ text: "C", start: 2.6, end: 3.5 }] }, // only 0.1s room
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().duplicateSubtitles(["a", "b"]);
  assert.equal(result, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
});

test("105. duplicateSubtitles Case D (partial/pre-existing overlap on the trailing side): rejected, not crashed", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1.5, end: 2.5, text: "B", words: [{ text: "B", start: 1.5, end: 2.5 }] },
        { id: "c", index: 2, start: 2, end: 3, text: "C", words: [{ text: "C", start: 2, end: 3 }] }, // already overlaps B
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().duplicateSubtitles(["a", "b"]);
  assert.equal(result, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
});

test("106. duplicateSubtitles preserves each duplicated caption's own STYLE and ANIMATION override independently", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }], style: { color: "#111111" } },
        { id: "b", index: 1, start: 1.5, end: 2.5, text: "B", words: [{ text: "B", start: 1.5, end: 2.5 }], animation: { entrance: "slide-up" } },
      ],
    }),
  );
  const result = useEditorStore.getState().duplicateSubtitles(["a", "b"]);
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  const copyOfA = subs.find((s) => s.text === "A" && s.id !== "a")!;
  const copyOfB = subs.find((s) => s.text === "B" && s.id !== "b")!;
  assert.deepEqual(copyOfA.style, { color: "#111111" });
  assert.deepEqual(copyOfB.animation, { entrance: "slide-up" });
});

test("107. IMPORTANT EDGE CASE (batch) — A,B,C,D,E: duplicating a contiguous middle block with room never touches captions farther down; without room, it is rejected with NOTHING changed anywhere, including far captions", () => {
  const fixture = () =>
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1.5, end: 2.5, text: "B", words: [{ text: "B", start: 1.5, end: 2.5 }] },
        { id: "c", index: 2, start: 3, end: 4, text: "C", words: [{ text: "C", start: 3, end: 4 }] },
        { id: "d", index: 3, start: 20, end: 21, text: "D", words: [{ text: "D", start: 20, end: 21 }] },
        { id: "e", index: 4, start: 22, end: 23, text: "E", words: [{ text: "E", start: 22, end: 23 }] },
      ],
    });

  // With plenty of room (D starts at 20, block B+C spans [1.5,4]) the batch succeeds and D/E are
  // untouched. stripIndex() ignores `index`, which naturally renumbers once two captions are
  // inserted earlier in the array — the guarantee under test is that D/E's own start/end/text/
  // words never change, not that their array position stays numerically the same.
  useEditorStore.getState().load(fixture());
  const dBefore = stripIndex(useEditorStore.getState().project!.subtitles.find((s) => s.id === "d")!);
  const eBefore = stripIndex(useEditorStore.getState().project!.subtitles.find((s) => s.id === "e")!);
  const okResult = useEditorStore.getState().duplicateSubtitles(["b", "c"]);
  assert.equal(okResult, "ok");
  const subsAfterOk = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(stripIndex(subsAfterOk.find((s) => s.id === "d")!), dBefore);
  assert.deepEqual(stripIndex(subsAfterOk.find((s) => s.id === "e")!), eBefore);
  assert.deepEqual(subsAfterOk.map((s) => s.text), ["A", "B", "C", "B", "C", "D", "E"]);

  // With D moved in close (no room for the B+C block, width 2.5s), the whole batch is rejected —
  // and NOTHING changes anywhere in the project, not even far-away E.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "A", words: [{ text: "A", start: 0, end: 1 }] },
        { id: "b", index: 1, start: 1.5, end: 2.5, text: "B", words: [{ text: "B", start: 1.5, end: 2.5 }] },
        { id: "c", index: 2, start: 3, end: 4, text: "C", words: [{ text: "C", start: 3, end: 4 }] },
        { id: "d", index: 3, start: 4.1, end: 5, text: "D", words: [{ text: "D", start: 4.1, end: 5 }] }, // only 0.1s room
        { id: "e", index: 4, start: 22, end: 23, text: "E", words: [{ text: "E", start: 22, end: 23 }] },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles;
  const rejectResult = useEditorStore.getState().duplicateSubtitles(["b", "c"]);
  assert.equal(rejectResult, "no-room");
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before, "the entire project, including E far down the timeline, is byte-for-byte unchanged");
});

test("108. regression: a successful duplicate never introduces an OVERLAP quality issue, matching the editor's own existing overlap invariant", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "A", words: [{ text: "A", start: 0, end: 2 }] },
        { id: "b", index: 1, start: 20, end: 22, text: "B", words: [{ text: "B", start: 20, end: 22 }] },
      ],
    }),
  );
  useEditorStore.getState().duplicateSubtitle("a");
  const report = analyzeSubtitleQuality(useEditorStore.getState().project!.subtitles, useEditorStore.getState().project!.timingRules);
  assert.equal(report.issues.some((i) => i.type === "OVERLAP"), false, "duplication must never itself create an OVERLAP issue");
});

test("109. performance: duplicateSubtitle/duplicateSubtitles collision checks stay fast against a 5,400-caption project (no new O(n²) behavior)", () => {
  const buildSubtitles = (): Subtitle[] =>
    Array.from({ length: 5400 }, (_, i) => ({
      id: `dup${i}`,
      index: i,
      start: i * 2,
      end: i * 2 + 1,
      text: `word${i}`,
      words: [{ text: `word${i}`, start: i * 2, end: i * 2 + 1 }],
    }));

  // A caption in the middle: 1s of its own duration, exactly 1s of room to the next (a boundary-
  // exact fit — see duplicate-timing.test.ts's own "exactly equal" case) — always succeeds.
  useEditorStore.getState().load(fixtureProject({ subtitles: buildSubtitles() }));
  const t0 = performance.now();
  const single = useEditorStore.getState().duplicateSubtitle("dup2700");
  const t1 = performance.now();
  assert.equal(single, "ok");
  assert.ok(t1 - t0 < 100, `duplicateSubtitle on a 5,400-caption project took ${t1 - t0}ms`);

  // Fresh load for the batch case — targets the true LAST 3 captions (no follower at all, so a
  // wider 5s-wide block is guaranteed to fit regardless of this fixture's uniform 1s gaps), kept
  // independent of the single-duplicate mutation above so this stays purely about PERFORMANCE,
  // not re-exercising collision-edge-case logic (already covered by tests 89-96b/103-107 above).
  useEditorStore.getState().load(fixtureProject({ subtitles: buildSubtitles() }));
  const t2 = performance.now();
  const batch = useEditorStore.getState().duplicateSubtitles(["dup5397", "dup5398", "dup5399"]);
  const t3 = performance.now();
  assert.equal(batch, "ok");
  assert.ok(t3 - t2 < 100, `duplicateSubtitles on a 5,400-caption project took ${t3 - t2}ms`);
});

// ---------------------------------------------------------------------------------------------
// Task 97025 (P10) — Batch Text & Content Editing Workflow. Pure matching/transform logic
// (find & replace matching semantics, match-case, whole-word, Unicode/Hindi, transforms) is
// exhaustively covered in lib/subtitles/__tests__/batch-text-ops.test.ts; these tests exercise
// the STORE-level integration — selection scoping via the real P8 selectedSubtitleIds model,
// commit()/undo/redo, word-timing staleness derivation, quality-report staleness, and
// performance — matching this codebase's existing pure-helper-here/store-integration-there split
// (see duplicate-timing.ts's own P9 precedent).
// ---------------------------------------------------------------------------------------------

function textFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      { id: "a", index: 0, start: 0, end: 1, text: "Hello world", words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "world", start: 0.5, end: 1 }] },
      { id: "b", index: 1, start: 1, end: 2, text: "Hello everyone", words: [{ text: "Hello", start: 1, end: 1.5 }, { text: "everyone", start: 1.5, end: 2 }] },
      { id: "c", index: 2, start: 2, end: 3, text: "Good morning", words: [{ text: "Good", start: 2, end: 2.5 }, { text: "morning", start: 2.5, end: 3 }] },
    ],
  });
}

const NO_OPTS = { matchCase: false, wholeWord: false };

test("110. applyBatchFindReplace with ZERO selected ids is a safe no-op — no commit, nothing changes", () => {
  useEditorStore.getState().load(textFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().applyBatchFindReplace([], "Hello", "Hi", NO_OPTS);
  assert.deepEqual(result, { totalMatches: 0, affectedCount: 0, staleCount: 0 });
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("111. applyBatchFindReplace with ONE selected id affects only that caption", () => {
  useEditorStore.getState().load(textFixture());
  const result = useEditorStore.getState().applyBatchFindReplace(["a"], "Hello", "Hi", NO_OPTS);
  assert.deepEqual(result, { totalMatches: 1, affectedCount: 1, staleCount: 0 });
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "a")!.text, "Hi world");
  assert.equal(subs.find((s) => s.id === "b")!.text, "Hello everyone", "b is untouched");
});

test("112. applyBatchFindReplace across MULTIPLE selected captions — matches the P10 spec's own worked example exactly", () => {
  useEditorStore.getState().load(textFixture());
  const result = useEditorStore.getState().applyBatchFindReplace(["a", "b", "c"], "Hello", "Hi", NO_OPTS);
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "a")!.text, "Hi world");
  assert.equal(subs.find((s) => s.id === "b")!.text, "Hi everyone");
  assert.equal(subs.find((s) => s.id === "c")!.text, "Good morning", "caption 3 must remain completely untouched — no match");
  assert.equal(result.affectedCount, 2);
  assert.equal(result.totalMatches, 2);
});

test("113. applyBatchFindReplace on a NON-CONTIGUOUS selection applies independently to each selected caption", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 1, text: "Hello world", words: [] },
        { id: "b", index: 1, start: 1, end: 2, text: "Hello there", words: [] },
        { id: "c", index: 2, start: 2, end: 3, text: "Hello again", words: [] },
      ],
    }),
  );
  const result = useEditorStore.getState().applyBatchFindReplace(["a", "c"], "Hello", "Hi", NO_OPTS); // skips b
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "a")!.text, "Hi world");
  assert.equal(subs.find((s) => s.id === "b")!.text, "Hello there", "b was never selected — untouched");
  assert.equal(subs.find((s) => s.id === "c")!.text, "Hi again");
  assert.equal(result.affectedCount, 2);
});

test("114. a caption outside the selection is byte-for-byte unchanged, including its own untouched word timing", () => {
  useEditorStore.getState().load(textFixture());
  const cBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "c")!;
  useEditorStore.getState().applyBatchFindReplace(["a", "b"], "Hello", "Hi", NO_OPTS);
  const cAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "c")!;
  assert.deepEqual(cAfter, cBefore);
});

test("115. match case OFF (store-level): default option matches regardless of casing", () => {
  useEditorStore.getState().load(fixtureProject({ subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "hello HELLO", words: [] }] }));
  const result = useEditorStore.getState().applyBatchFindReplace(["a"], "hello", "hi", { matchCase: false, wholeWord: false });
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "hi hi");
  assert.equal(result.totalMatches, 2);
});

test("116. match case ON (store-level): only exact casing matches", () => {
  useEditorStore.getState().load(fixtureProject({ subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "hello HELLO", words: [] }] }));
  const result = useEditorStore.getState().applyBatchFindReplace(["a"], "hello", "hi", { matchCase: true, wholeWord: false });
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "hi HELLO");
  assert.equal(result.totalMatches, 1);
});

test("117. whole word OFF (store-level): matches as a substring", () => {
  useEditorStore.getState().load(fixtureProject({ subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "concatenate", words: [] }] }));
  const result = useEditorStore.getState().applyBatchFindReplace(["a"], "cat", "dog", { matchCase: false, wholeWord: false });
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "condogenate");
  assert.equal(result.affectedCount, 1);
});

test("118. whole word ON (store-level): does not match inside a longer word", () => {
  useEditorStore.getState().load(fixtureProject({ subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "concatenate", words: [] }] }));
  const result = useEditorStore.getState().applyBatchFindReplace(["a"], "cat", "dog", { matchCase: false, wholeWord: true });
  assert.equal(result.affectedCount, 0, "no standalone 'cat' in 'concatenate' — nothing changes");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "concatenate");
});

test("119. no matches anywhere in the selection: no commit, zero counts", () => {
  useEditorStore.getState().load(textFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().applyBatchFindReplace(["a", "b", "c"], "xyz", "abc", NO_OPTS);
  assert.deepEqual(result, { totalMatches: 0, affectedCount: 0, staleCount: 0 });
  assert.equal(useEditorStore.getState().past.length, pastBefore, "a no-match batch operation creates NO history entry");
});

test("120. empty find string is a safe no-op at the store level too", () => {
  useEditorStore.getState().load(textFixture());
  const result = useEditorStore.getState().applyBatchFindReplace(["a", "b", "c"], "", "Hi", NO_OPTS);
  assert.deepEqual(result, { totalMatches: 0, affectedCount: 0, staleCount: 0 });
});

test("121. empty replacement deletes the matched text at the store level", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().applyBatchFindReplace(["a"], "Hello ", "", NO_OPTS);
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "world");
});

test("122. Unicode/Hindi text: batch replace works at the store level", () => {
  useEditorStore.getState().load(fixtureProject({ subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "नमस्ते दुनिया", words: [] }] }));
  useEditorStore.getState().applyBatchFindReplace(["a"], "नमस्ते", "हैलो", NO_OPTS);
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "हैलो दुनिया");
});

test("123. mixed English/Hindi text: batch replace only touches the matched language span", () => {
  useEditorStore.getState().load(fixtureProject({ subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "Hello नमस्ते", words: [] }] }));
  useEditorStore.getState().applyBatchFindReplace(["a"], "Hello", "Hi", NO_OPTS);
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hi नमस्ते");
});

test("124. same-token-count replacement preserves the caption's real word TIMESTAMPS exactly (word text itself is remapped, per the existing remapWordsToText behavior)", () => {
  useEditorStore.getState().load(textFixture());
  const originalTimestamps = useEditorStore.getState().project!.subtitles[0].words.map((w) => [w.start, w.end]);
  const result = useEditorStore.getState().applyBatchFindReplace(["a"], "Hello", "Hi", NO_OPTS); // "Hello world" -> "Hi world", still 2 tokens
  assert.equal(result.staleCount, 0);
  const words = useEditorStore.getState().project!.subtitles[0].words;
  assert.deepEqual(words.map((w) => [w.start, w.end]), originalTimestamps, "real timestamps untouched — same word count");
  assert.deepEqual(words.map((w) => w.text), ["Hi", "world"], "each word's own text is remapped onto the new wording, exactly like updateSubtitleText/applyTextMap already do");
});

test("125. changed-token-count replacement marks timing stale WITHOUT fabricating or discarding the real timestamps", () => {
  useEditorStore.getState().load(textFixture());
  const originalWords = useEditorStore.getState().project!.subtitles[0].words;
  const result = useEditorStore.getState().applyBatchFindReplace(["a"], "Hello world", "Hi there everyone", NO_OPTS); // 2 -> 3 tokens
  assert.equal(result.staleCount, 1);
  const after = useEditorStore.getState().project!.subtitles[0];
  assert.deepEqual(after.words, originalWords, "the OLD real timestamps are left completely untouched, not discarded or redistributed");
  assert.equal(after.words.length, 2, "word count no longer matches the new 3-token text — exactly what makes it 'stale'");
  assert.equal(isWordTimingStale(after), true, "isWordTimingStale (the existing P7.2 derivation) correctly detects this — no second stale system was created");
});

test("126. a REJECTED/no-op batch operation never touches the original word timestamps", () => {
  useEditorStore.getState().load(textFixture());
  const before = useEditorStore.getState().project!.subtitles;
  useEditorStore.getState().applyBatchFindReplace(["a", "b", "c"], "xyz", "abc", NO_OPTS); // no matches anywhere
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
});

test("127. stale timing state survives undo/redo and (by construction, since it's derived from persisted text+words) would survive a reload identically", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().applyBatchFindReplace(["a"], "Hello world", "Hi there everyone", NO_OPTS);
  assert.equal(isWordTimingStale(useEditorStore.getState().project!.subtitles[0]), true);

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello world");
  assert.equal(isWordTimingStale(useEditorStore.getState().project!.subtitles[0]), false, "undo restores the original, non-stale state");

  useEditorStore.getState().redo();
  assert.equal(isWordTimingStale(useEditorStore.getState().project!.subtitles[0]), true, "redo restores the exact stale state again");
});

test("128. rebuildWordTiming still works normally on a caption made stale by a batch replace", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().applyBatchFindReplace(["a"], "Hello world", "Hi there everyone", NO_OPTS);
  useEditorStore.getState().rebuildWordTiming("a");
  const after = useEditorStore.getState().project!.subtitles[0];
  assert.equal(isWordTimingStale(after), false, "rebuildWordTiming produces fresh, matching-count timing");
  assert.equal(after.words.length, 3);
});

// --- Transforms ---

test("129. uppercase transform via the store, scoped to selection", () => {
  useEditorStore.getState().load(textFixture());
  const result = useEditorStore.getState().applyBatchTextTransform(["a"], "uppercase");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "HELLO WORLD");
  assert.equal(useEditorStore.getState().project!.subtitles[1].text, "Hello everyone", "b not selected — untouched");
  assert.equal(result.affectedCount, 1);
});

test("130. lowercase transform via the store", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().applyBatchTextTransform(["a"], "lowercase");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "hello world");
});

test("131. title case transform via the store", () => {
  useEditorStore.getState().load(fixtureProject({ subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "hello world", words: [] }] }));
  useEditorStore.getState().applyBatchTextTransform(["a"], "titlecase");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello World");
});

test("132. transform applies to MULTIPLE selected captions in one commit", () => {
  useEditorStore.getState().load(textFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().applyBatchTextTransform(["a", "b"], "uppercase");
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "HELLO WORLD");
  assert.equal(useEditorStore.getState().project!.subtitles[1].text, "HELLO EVERYONE");
  assert.equal(useEditorStore.getState().project!.subtitles[2].text, "Good morning", "c not selected");
  assert.equal(result.affectedCount, 2);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "ONE undo step for both captions");
});

test("133. transform on a NON-CONTIGUOUS selection applies independently to each", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().applyBatchTextTransform(["a", "c"], "uppercase"); // skips b
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "HELLO WORLD");
  assert.equal(useEditorStore.getState().project!.subtitles[1].text, "Hello everyone", "b skipped");
  assert.equal(useEditorStore.getState().project!.subtitles[2].text, "GOOD MORNING");
});

// --- Undo/redo ---

test("134. batch replace across 15 captions is ONE undo step; undo restores every one to its exact previous text/timing", () => {
  const subtitles = Array.from({ length: 15 }, (_, i) => ({
    id: `s${i}`,
    index: i,
    start: i,
    end: i + 1,
    text: `Hello caption ${i}`,
    words: [{ text: "Hello", start: i, end: i + 0.5 }, { text: "caption", start: i + 0.5, end: i + 0.8 }, { text: String(i), start: i + 0.8, end: i + 1 }],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const before = useEditorStore.getState().project!.subtitles;
  const pastBefore = useEditorStore.getState().past.length;
  const ids = subtitles.map((s) => s.id);
  const result = useEditorStore.getState().applyBatchFindReplace(ids, "Hello", "Hi", NO_OPTS);
  assert.equal(result.affectedCount, 15);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "exactly one undo step for all 15 captions");

  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before, "all 15 captions restored to their exact previous text/timing state");
});

test("135. batch transform across 20 captions is ONE undo step; undo restores all 20 exactly", () => {
  const subtitles = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, index: i, start: i, end: i + 1, text: `caption ${i}`, words: [] }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const before = useEditorStore.getState().project!.subtitles;
  const pastBefore = useEditorStore.getState().past.length;
  const ids = subtitles.map((s) => s.id);
  useEditorStore.getState().applyBatchTextTransform(ids, "uppercase");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1);

  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, before);
});

test("136. redo reproduces the EXACT same batch result", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().applyBatchFindReplace(["a", "b"], "Hello", "Hi", NO_OPTS);
  const afterApply = useEditorStore.getState().project!.subtitles;
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, afterApply);
});

test("137. mixed single + batch operations undo/redo in the correct order", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().updateSubtitleText("c", "Good afternoon"); // single edit, step 1
  useEditorStore.getState().applyBatchFindReplace(["a", "b"], "Hello", "Hi", NO_OPTS); // batch, step 2
  useEditorStore.getState().applyBatchTextTransform(["a"], "uppercase"); // batch, step 3

  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "HI WORLD");

  useEditorStore.getState().undo(); // undo step 3
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hi world");
  useEditorStore.getState().undo(); // undo step 2
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "Hello world");
  assert.equal(useEditorStore.getState().project!.subtitles[1].text, "Hello everyone");
  useEditorStore.getState().undo(); // undo step 1
  assert.equal(useEditorStore.getState().project!.subtitles[2].text, "Good morning");

  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].text, "HI WORLD");
  assert.equal(useEditorStore.getState().project!.subtitles[2].text, "Good afternoon");
});

test("138. a cancelled/no-match batch find-and-replace creates NO history entry (redo stack also untouched)", () => {
  useEditorStore.getState().load(textFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const futureBefore = useEditorStore.getState().future.length;
  useEditorStore.getState().applyBatchFindReplace(["a", "b", "c"], "nonexistent", "x", NO_OPTS);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
  assert.equal(useEditorStore.getState().future.length, futureBefore);
});

// --- Quality review integration ---

test("139. the quality report becomes stale after a batch text edit, exactly like any other text mutation", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().runQualityAnalysis();
  const reportSubsBefore = useEditorStore.getState().qualityReportSubtitles;
  useEditorStore.getState().applyBatchFindReplace(["a"], "Hello", "Hi", NO_OPTS);
  assert.equal(
    isQualityReportStale(useEditorStore.getState().project!.subtitles, reportSubsBefore),
    true,
    "batch text edits go through the same commit() as every other mutation, so the existing staleness check picks it up automatically",
  );
});

test("140. quality navigation does not crash after a batch text edit, even when the report references a caption whose text just changed", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().applyBatchFindReplace(["a", "b"], "Hello", "Hi", NO_OPTS);
  // goToQualityIssue must not throw even though the report is now stale — its own existing
  // defensive lookup (project.subtitles.find by captionId) still finds every caption, since batch
  // text edits never delete captions, only change their text/words.
  assert.doesNotThrow(() => useEditorStore.getState().goToQualityIssue(1));
});

test("141. no stale issue ID references a caption that no longer exists after a batch operation (batch text ops never delete captions)", () => {
  useEditorStore.getState().load(textFixture());
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().applyBatchTextTransform(["a", "b", "c"], "uppercase");
  const ids = new Set(useEditorStore.getState().project!.subtitles.map((s) => s.id));
  assert.deepEqual(ids, new Set(["a", "b", "c"]), "every original caption id still exists — batch text ops only ever change text/words, never remove a caption");
});

// --- Performance ---

test("142. performance: batch find & replace across a 5,400-caption project stays fast (single pass)", () => {
  const subtitles: Subtitle[] = Array.from({ length: 5400 }, (_, i) => ({
    id: `bt${i}`,
    index: i,
    start: i,
    end: i + 1,
    text: `Hello caption number ${i}`,
    words: [],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const allIds = subtitles.map((s) => s.id);

  const t0 = performance.now();
  const result = useEditorStore.getState().applyBatchFindReplace(allIds, "Hello", "Hi", NO_OPTS);
  const t1 = performance.now();
  assert.equal(result.affectedCount, 5400);
  assert.ok(t1 - t0 < 300, `applyBatchFindReplace over 5,400 captions took ${t1 - t0}ms`);
});

test("143. performance: batch transform across a 5,400-caption project stays fast (single pass)", () => {
  const subtitles: Subtitle[] = Array.from({ length: 5400 }, (_, i) => ({
    id: `bt2-${i}`,
    index: i,
    start: i,
    end: i + 1,
    text: `caption number ${i}`,
    words: [],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const allIds = subtitles.map((s) => s.id);

  const t0 = performance.now();
  const result = useEditorStore.getState().applyBatchTextTransform(allIds, "uppercase");
  const t1 = performance.now();
  assert.equal(result.affectedCount, 5400);
  assert.ok(t1 - t0 < 300, `applyBatchTextTransform over 5,400 captions took ${t1 - t0}ms`);
});

test("144. performance: a large NON-CONTIGUOUS selection (every other caption of 5,400) stays a single O(n) pass", () => {
  const subtitles: Subtitle[] = Array.from({ length: 5400 }, (_, i) => ({
    id: `bt3-${i}`,
    index: i,
    start: i,
    end: i + 1,
    text: `Hello caption ${i}`,
    words: [],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const everyOtherId = subtitles.filter((_, i) => i % 2 === 0).map((s) => s.id); // 2,700 non-contiguous ids

  const t0 = performance.now();
  const result = useEditorStore.getState().applyBatchFindReplace(everyOtherId, "Hello", "Hi", NO_OPTS);
  const t1 = performance.now();
  assert.equal(result.affectedCount, 2700);
  assert.ok(t1 - t0 < 300, `applyBatchFindReplace over 2,700 non-contiguous captions (of 5,400) took ${t1 - t0}ms`);
});

// ---------------------------------------------------------------------------------------------
// Task 98134 (P11) — Professional Text Cleanup & Content QA. Pure cleanup logic (trim/space/
// line-break whitespace, repeated-punctuation, sentence case, trailing punctuation, blank
// classification) is exhaustively covered in lib/subtitles/__tests__/text-cleanup.test.ts; these
// tests exercise the STORE-level integration — the SAME `applyTextCleanup` shape P10's own
// applyBatchFindReplace/applyBatchTextTransform tests already established: selection scoping via
// the real selectedSubtitleIds model, ONE commit (even when a cleanup both edits AND deletes
// captions), word-timing staleness, quality-report staleness, and performance.
// ---------------------------------------------------------------------------------------------

const NO_CLEANUP = {
  trimWhitespace: false,
  normalizeSpaces: false,
  normalizeLineBreakWhitespace: false,
  normalizeRepeatedPunctuation: false,
  caseTransform: "none" as const,
  trailingPunctuation: "none" as const,
  removeBlankCaptions: false,
};

function cleanupFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      { id: "a", index: 0, start: 0, end: 1, text: "  Hello   world  ", words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "world", start: 0.5, end: 1 }] },
      { id: "b", index: 1, start: 1, end: 2, text: "hello there!!", words: [{ text: "hello", start: 1, end: 1.5 }, { text: "there!!", start: 1.5, end: 2 }] },
      { id: "c", index: 2, start: 2, end: 3, text: "   ", words: [] },
      { id: "d", index: 3, start: 3, end: 4, text: "Already clean.", words: [{ text: "Already", start: 3, end: 3.5 }, { text: "clean.", start: 3.5, end: 4 }] },
    ],
  });
}

test("145. applyTextCleanup with ZERO selected ids is a safe no-op — no commit, nothing changes", () => {
  useEditorStore.getState().load(cleanupFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().applyTextCleanup([], { ...NO_CLEANUP, trimWhitespace: true });
  assert.deepEqual(result, { changedCount: 0, deletedCount: 0, staleCount: 0 });
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("146. applyTextCleanup with no operations selected is a safe no-op — no commit", () => {
  useEditorStore.getState().load(cleanupFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().applyTextCleanup(["a", "b", "c", "d"], NO_CLEANUP);
  assert.deepEqual(result, { changedCount: 0, deletedCount: 0, staleCount: 0 });
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("147. applyTextCleanup with ONE selected id affects only that caption", () => {
  useEditorStore.getState().load(cleanupFixture());
  const result = useEditorStore.getState().applyTextCleanup(["a"], { ...NO_CLEANUP, trimWhitespace: true, normalizeSpaces: true });
  assert.equal(result.changedCount, 1);
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "a")!.text, "Hello world");
  assert.equal(subs.find((s) => s.id === "b")!.text, "hello there!!", "b is untouched");
});

test("148. WORKED EXAMPLE from the spec — a cleanup that changes A, B and D and deletes blank C is exactly ONE undo step", () => {
  useEditorStore.getState().load(cleanupFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().applyTextCleanup(["a", "b", "c", "d"], {
    ...NO_CLEANUP,
    trimWhitespace: true,
    normalizeSpaces: true,
    normalizeRepeatedPunctuation: true,
    caseTransform: "sentence",
    removeBlankCaptions: true,
  });
  assert.equal(result.changedCount, 2, "a and b change (d is already clean and already sentence-cased)");
  assert.equal(result.deletedCount, 1, "blank c is deleted");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "exactly one history entry for the whole batch");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 3);
  assert.equal(subs.find((s) => s.id === "c"), undefined, "blank caption actually removed");
  assert.equal(subs.find((s) => s.id === "a")!.text, "Hello world");
  assert.equal(subs.find((s) => s.id === "b")!.text, "Hello there!");
  assert.equal(subs.find((s) => s.id === "d")!.text, "Already clean.", "d unaffected by this selection of operations");
  assert.deepEqual(subs.map((s) => s.index), [0, 1, 2], "remaining captions reindexed contiguously after the delete");
});

test("149. undo after the worked-example cleanup restores the exact previous state, including caption c", () => {
  useEditorStore.getState().load(cleanupFixture());
  const before = useEditorStore.getState().project!.subtitles;
  useEditorStore.getState().applyTextCleanup(["a", "b", "c", "d"], {
    ...NO_CLEANUP,
    trimWhitespace: true,
    normalizeRepeatedPunctuation: true,
    removeBlankCaptions: true,
  });
  useEditorStore.getState().undo();
  const after = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(after, before);
});

test("150. redo reproduces the exact same cleanup result (both the edits and the delete)", () => {
  useEditorStore.getState().load(cleanupFixture());
  const sel = { ...NO_CLEANUP, trimWhitespace: true, normalizeRepeatedPunctuation: true, removeBlankCaptions: true };
  useEditorStore.getState().applyTextCleanup(["a", "b", "c", "d"], sel);
  const afterApply = useEditorStore.getState().project!.subtitles;
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, afterApply);
});

test("151. cancel/no-op: a selection that changes nothing creates no history entry", () => {
  useEditorStore.getState().load(cleanupFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().applyTextCleanup(["d"], { ...NO_CLEANUP, trimWhitespace: true });
  assert.equal(result.changedCount, 0);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("152. non-contiguous selection applies independently to each selected caption", () => {
  useEditorStore.getState().load(cleanupFixture());
  const result = useEditorStore.getState().applyTextCleanup(["a", "d"], { ...NO_CLEANUP, trimWhitespace: true, normalizeSpaces: true });
  assert.equal(result.changedCount, 1, "only a changes — d is already clean");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.find((s) => s.id === "b")!.text, "hello there!!", "b (not selected) untouched");
});

test("153. selection pruning: deleting a blank caption removes it from selectedSubtitleIds automatically", () => {
  useEditorStore.getState().load(cleanupFixture());
  useEditorStore.getState().selectSubtitleRange("a");
  useEditorStore.getState().toggleSubtitleSelection("c");
  assert.ok(useEditorStore.getState().selectedSubtitleIds.has("c"));
  useEditorStore.getState().applyTextCleanup(["c"], { ...NO_CLEANUP, removeBlankCaptions: true });
  assert.equal(useEditorStore.getState().selectedSubtitleIds.has("c"), false, "commit()'s own pruneSelection already clears deleted ids");
});

test("154. remove blank captions never deletes a non-blank (punctuation-only or short) caption", () => {
  const project = fixtureProject({
    subtitles: [
      { id: "x", index: 0, start: 0, end: 1, text: "...", words: [{ text: "...", start: 0, end: 1 }] },
      { id: "y", index: 1, start: 1, end: 2, text: "   ", words: [] },
    ],
  });
  useEditorStore.getState().load(project);
  const result = useEditorStore.getState().applyTextCleanup(["x", "y"], { ...NO_CLEANUP, removeBlankCaptions: true });
  assert.equal(result.deletedCount, 1);
  const subs = useEditorStore.getState().project!.subtitles;
  assert.ok(subs.find((s) => s.id === "x"), "punctuation-only caption 'x' survives — only truly blank captions are deleted");
});

test("155. word timing: same-token-count cleanup preserves the real word timestamps exactly", () => {
  useEditorStore.getState().load(cleanupFixture());
  useEditorStore.getState().applyTextCleanup(["a"], { ...NO_CLEANUP, trimWhitespace: true, normalizeSpaces: true });
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(isWordTimingStale(sub), false);
  assert.equal(sub.words[0].start, 0);
  assert.equal(sub.words[0].end, 0.5);
  assert.equal(sub.words[1].start, 0.5);
  assert.equal(sub.words[1].end, 1);
});

test("156. word timing: a token-count-changing cleanup marks the caption stale WITHOUT fabricating or discarding timestamps", () => {
  const project = fixtureProject({
    subtitles: [{ id: "e", index: 0, start: 0, end: 1, text: "Hello ...", words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "...", start: 0.5, end: 1 }] }],
  });
  useEditorStore.getState().load(project);
  const originalWords = useEditorStore.getState().project!.subtitles[0].words;
  useEditorStore.getState().applyTextCleanup(["e"], { ...NO_CLEANUP, trailingPunctuation: "remove" });
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "e")!;
  assert.equal(isWordTimingStale(sub), true);
  // The OLD words array is preserved untouched (still 2 entries, same timestamps) — never
  // rebuilt/discarded/redistributed automatically.
  assert.equal(sub.words.length, originalWords.length);
  assert.equal(sub.words[0].start, originalWords[0].start);
  assert.equal(sub.words[1].end, originalWords[1].end);
});

test("157. a REJECTED/no-op cleanup never touches the original word timestamps", () => {
  useEditorStore.getState().load(cleanupFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "d")!.words;
  useEditorStore.getState().applyTextCleanup(["d"], { ...NO_CLEANUP, trimWhitespace: true });
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "d")!.words;
  assert.deepEqual(after, before);
});

test("158. rebuildWordTiming still works normally on a caption made stale by a batch cleanup", () => {
  const project = fixtureProject({
    subtitles: [{ id: "e", index: 0, start: 0, end: 1, text: "Hello ...", words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "...", start: 0.5, end: 1 }] }],
  });
  useEditorStore.getState().load(project);
  useEditorStore.getState().applyTextCleanup(["e"], { ...NO_CLEANUP, trailingPunctuation: "remove" });
  useEditorStore.getState().rebuildWordTiming("e");
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "e")!;
  assert.equal(isWordTimingStale(sub), false);
});

test("159. mixed single + batch cleanup operations undo/redo in the correct order", () => {
  useEditorStore.getState().load(cleanupFixture());
  useEditorStore.getState().updateSubtitleText("d", "changed once");
  useEditorStore.getState().applyTextCleanup(["a", "b"], { ...NO_CLEANUP, trimWhitespace: true, normalizeRepeatedPunctuation: true });
  useEditorStore.getState().updateSubtitleText("d", "changed twice");

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "d")!.text, "changed once");
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.text, "  Hello   world  ", "cleanup undone");
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "d")!.text, "Already clean.");

  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "d")!.text, "changed twice");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.text, "Hello   world", "trim-only cleanup redone exactly (internal spacing untouched — normalizeSpaces wasn't selected)");
});

test("160. the quality report becomes stale after a batch cleanup, exactly like any other text mutation", () => {
  useEditorStore.getState().load(cleanupFixture());
  useEditorStore.getState().runQualityAnalysis();
  const reportSubs = useEditorStore.getState().qualityReportSubtitles!;
  useEditorStore.getState().applyTextCleanup(["a"], { ...NO_CLEANUP, trimWhitespace: true });
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, reportSubs), true);
});

test("161. quality navigation does not crash after a cleanup that deletes a caption", () => {
  useEditorStore.getState().load(cleanupFixture());
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().applyTextCleanup(["c"], { ...NO_CLEANUP, removeBlankCaptions: true });
  assert.doesNotThrow(() => useEditorStore.getState().goToQualityIssue(1));
});

test("162. re-analysis after a batch cleanup that deletes a caption reports no stale EMPTY_CAPTION issue for it", () => {
  useEditorStore.getState().load(cleanupFixture());
  useEditorStore.getState().applyTextCleanup(["c"], { ...NO_CLEANUP, removeBlankCaptions: true });
  useEditorStore.getState().runQualityAnalysis();
  const report = useEditorStore.getState().qualityReport!;
  assert.equal(report.issues.some((i) => i.captionId === "c"), false, "no issue can reference a caption that no longer exists");
});

test("163. performance: batch text cleanup across a 5,400-caption project stays fast (single pass)", () => {
  const subtitles: Subtitle[] = Array.from({ length: 5400 }, (_, i) => ({
    id: `cl${i}`,
    index: i,
    start: i,
    end: i + 1,
    text: `  Hello   world!!  ${i}  `,
    words: [],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const allIds = subtitles.map((s) => s.id);

  const t0 = performance.now();
  const result = useEditorStore.getState().applyTextCleanup(allIds, {
    ...NO_CLEANUP,
    trimWhitespace: true,
    normalizeSpaces: true,
    normalizeRepeatedPunctuation: true,
  });
  const t1 = performance.now();
  assert.equal(result.changedCount, 5400);
  assert.ok(t1 - t0 < 300, `applyTextCleanup over 5,400 captions took ${t1 - t0}ms`);
});

test("164. performance: a large NON-CONTIGUOUS selection (every other caption of 5,400) stays a single O(n) pass", () => {
  const subtitles: Subtitle[] = Array.from({ length: 5400 }, (_, i) => ({
    id: `cl2-${i}`,
    index: i,
    start: i,
    end: i + 1,
    text: `  Hello world ${i}  `,
    words: [],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const everyOtherId = subtitles.filter((_, i) => i % 2 === 0).map((s) => s.id); // 2,700 non-contiguous ids

  const t0 = performance.now();
  const result = useEditorStore.getState().applyTextCleanup(everyOtherId, { ...NO_CLEANUP, trimWhitespace: true });
  const t1 = performance.now();
  assert.equal(result.changedCount, 2700);
  assert.ok(t1 - t0 < 300, `applyTextCleanup over 2,700 non-contiguous captions (of 5,400) took ${t1 - t0}ms`);
});

// ---------------------------------------------------------------------------------------------
// Task 99261 (P12) — Professional Review Workflow & Issue Navigation. The Phase 0 audit found
// nearly all of the required infrastructure already existed (qualityIssueIndex, goToQualityIssue,
// the stale-report derivation, virtualized scroll-into-view) — these tests cover only the
// genuinely NEW pieces: word-level issue navigation (QualityIssue.wordIndex), the
// `reviewedIssueIds` review-progress set, the new `runQualityAnalysisAndReview` "Analyze Again"
// entry point, and the changed fix-flow contract (a fix no longer silently re-analyzes — it just
// makes the report stale, leaving qualityIssueIndex/reviewedIssueIds untouched).
// ---------------------------------------------------------------------------------------------

function wordIssueFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      {
        id: "a",
        index: 0,
        start: 0,
        end: 2,
        text: "Hello Hello there",
        words: [
          { text: "Hello", start: 0, end: 0.5 },
          { text: "Hello", start: 0, end: 0.5 }, // exact duplicate of the first word (index 1)
          { text: "there", start: 0.5, end: 1 },
        ],
      },
      { id: "b", index: 1, start: 3, end: 4, text: "World", words: [{ text: "World", start: 3, end: 4 }] },
    ],
  });
}

test("165. goToQualityIssue selects the SPECIFIC word for a word-targeted issue (WORD_TIMESTAMP_INVALID)", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  const issue = useEditorStore.getState().qualityReport!.issues.find((i) => i.type === "WORD_TIMESTAMP_INVALID")!;
  assert.equal(issue.wordIndex, 1, "the fixture's duplicate is the SECOND 'Hello', at word index 1");

  // Navigate via repeated Next presses from the start until landing exactly on that issue.
  const idx = useEditorStore.getState().qualityReport!.issues.indexOf(issue);
  for (let i = 0; i <= idx; i++) useEditorStore.getState().goToQualityIssue(1);
  assert.equal(useEditorStore.getState().qualityIssueIndex, idx);
  assert.equal(useEditorStore.getState().selectedSubtitleId, "a");
  assert.equal(useEditorStore.getState().selectedWordIndex, 1);
});

test("166. goToQualityIssue clears word selection (never fabricates one) for a caption-level issue", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  // Manually pre-select some word to prove navigation actively clears it, not just "happens to be null".
  useEditorStore.getState().selectSubtitle("a");
  useEditorStore.getState().selectWord(2);
  assert.equal(useEditorStore.getState().selectedWordIndex, 2);

  const captionLevelIssue = useEditorStore.getState().qualityReport!.issues.find((i) => i.wordIndex === undefined)!;
  const idx = useEditorStore.getState().qualityReport!.issues.indexOf(captionLevelIssue);
  useEditorStore.getState().goToQualityIssue(1); // resets cursor to 0 from null
  for (let i = 1; i <= idx; i++) useEditorStore.getState().goToQualityIssue(1);
  assert.equal(useEditorStore.getState().qualityIssueIndex, idx);
  assert.equal(useEditorStore.getState().selectedWordIndex, null);
});

test("167. reviewedIssueIds starts empty and grows as goToQualityIssue navigates, regardless of entry point", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  assert.equal(useEditorStore.getState().reviewedIssueIds.size, 0);

  useEditorStore.getState().goToQualityIssue(1);
  const firstId = useEditorStore.getState().qualityReport!.issues[0].id;
  assert.ok(useEditorStore.getState().reviewedIssueIds.has(firstId));
  assert.equal(useEditorStore.getState().reviewedIssueIds.size, 1);

  useEditorStore.getState().goToQualityIssue(1);
  assert.equal(useEditorStore.getState().reviewedIssueIds.size, 2, "a second distinct issue adds a second entry");

  useEditorStore.getState().goToQualityIssue(-1);
  assert.equal(useEditorStore.getState().reviewedIssueIds.size, 2, "re-visiting an already-reviewed issue doesn't double-count (it's a Set)");
});

test("168. reviewedIssueIds resets on a fresh runQualityAnalysis (old ids don't inflate a new report's progress)", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().goToQualityIssue(1);
  assert.ok(useEditorStore.getState().reviewedIssueIds.size > 0);

  useEditorStore.getState().runQualityAnalysis();
  assert.equal(useEditorStore.getState().reviewedIssueIds.size, 0);
});

test("169. reviewedIssueIds resets on load() (opening/switching projects), same as qualityIssueIndex", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().goToQualityIssue(1);
  assert.ok(useEditorStore.getState().reviewedIssueIds.size > 0);

  useEditorStore.getState().load(fixtureProject());
  assert.equal(useEditorStore.getState().reviewedIssueIds.size, 0);
});

test("170. runQualityAnalysisAndReview analyzes AND navigates straight to the first issue when issues exist", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysisAndReview();
  assert.ok(useEditorStore.getState().qualityReport, "a report was produced");
  assert.equal(useEditorStore.getState().qualityIssueIndex, 0, "landed on the first issue, not left at null");
  assert.equal(useEditorStore.getState().selectedSubtitleId, useEditorStore.getState().qualityReport!.issues[0].captionId);
  assert.equal(useEditorStore.getState().reviewedIssueIds.size, 1);
});

test("171. runQualityAnalysisAndReview leaves the cursor at null (the clean/empty state) when there are zero issues", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "Hello there", words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }] }],
    }),
  );
  useEditorStore.getState().runQualityAnalysisAndReview();
  assert.equal(useEditorStore.getState().qualityReport!.issues.length, 0);
  assert.equal(useEditorStore.getState().qualityIssueIndex, null);
  assert.equal(useEditorStore.getState().selectedSubtitleId, null, "no navigation happened — nothing to navigate to");
});

test("172. runQualityAnalysis ALONE (not the *AndReview variant) still leaves the cursor at null — the export dialog's own readiness check must never jump editor selection/seek", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  assert.equal(useEditorStore.getState().qualityIssueIndex, null);
  assert.equal(useEditorStore.getState().selectedSubtitleId, null);
});

test("173. FIX FLOW CONTRACT: applying a fix (replaceAllSubtitles) after navigating leaves qualityIssueIndex and reviewedIssueIds completely untouched, and the report becomes stale via the existing derivation — no silent re-analysis", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().goToQualityIssue(1);
  const indexBefore = useEditorStore.getState().qualityIssueIndex;
  const reviewedBefore = new Set(useEditorStore.getState().reviewedIssueIds);
  const reportBefore = useEditorStore.getState().qualityReport;

  // Simulate applying a safe fix the way quality-panel-dialog.tsx's fixOne() now does: mutate via
  // replaceAllSubtitles, but deliberately do NOT call runQualityAnalysis afterward.
  const fixedSubs = useEditorStore.getState().project!.subtitles.map((s) => (s.id === "a" ? { ...s, words: [s.words[0], s.words[2]], text: "Hello there" } : s));
  useEditorStore.getState().replaceAllSubtitles(fixedSubs);

  assert.equal(useEditorStore.getState().qualityIssueIndex, indexBefore, "current issue navigation must remain stable across a fix");
  assert.deepEqual(useEditorStore.getState().reviewedIssueIds, reviewedBefore);
  assert.equal(useEditorStore.getState().qualityReport, reportBefore, "the OLD report object is still what's shown — never silently regenerated");
  assert.equal(
    isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles),
    true,
    "but it IS now correctly detected as stale via the existing mechanism",
  );
});

test("174. undo/redo never touch qualityIssueIndex or reviewedIssueIds (same ephemeral-state category as before)", () => {
  useEditorStore.getState().load(wordIssueFixture());
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().goToQualityIssue(1);
  const indexBefore = useEditorStore.getState().qualityIssueIndex;
  const reviewedBefore = new Set(useEditorStore.getState().reviewedIssueIds);

  useEditorStore.getState().updateSubtitleText("b", "Changed");
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().qualityIssueIndex, indexBefore);
  assert.deepEqual(useEditorStore.getState().reviewedIssueIds, reviewedBefore);

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().qualityIssueIndex, indexBefore);
  assert.deepEqual(useEditorStore.getState().reviewedIssueIds, reviewedBefore);
});

test("175. multiple different-type issues on the SAME caption: word selection correctly clears when moving from a word-level issue to a caption-level issue on that same caption", () => {
  // "a" carries both WORD_TIMESTAMP_INVALID (word-level) and, once trimmed to a single overlap-
  // free caption, no caption-level issue by default — force one alongside it (TOO_MANY_WORDS is
  // easiest to co-occur with a word-level issue on one caption).
  const fixtureWords = [
    { text: "w0", start: 0, end: 0.5 },
    { text: "w0", start: 0, end: 0.5 }, // duplicate -> WORD_TIMESTAMP_INVALID at index 1
    ...Array.from({ length: 18 }, (_, i) => ({ text: `w${i + 2}`, start: 1 + i, end: 1.5 + i })),
  ];
  const project = fixtureProject({
    subtitles: [
      {
        id: "a",
        index: 0,
        start: 0,
        end: 20,
        text: fixtureWords.map((w) => w.text).join(" "), // 20 words > the default maxWordsPerCaption (4) -> TOO_MANY_WORDS
        words: fixtureWords,
      },
    ],
  });
  useEditorStore.getState().load(project);
  useEditorStore.getState().runQualityAnalysis();
  const issues = useEditorStore.getState().qualityReport!.issues.filter((i) => i.captionId === "a");
  const wordLevel = issues.find((i) => i.wordIndex !== undefined);
  const captionLevel = issues.find((i) => i.wordIndex === undefined);
  assert.ok(wordLevel && captionLevel, "fixture must produce both a word-level and a caption-level issue on caption 'a'");

  const wordLevelIdx = useEditorStore.getState().qualityReport!.issues.indexOf(wordLevel!);
  const captionLevelIdx = useEditorStore.getState().qualityReport!.issues.indexOf(captionLevel!);

  useEditorStore.getState().goToQualityIssue(1);
  for (let i = 1; i <= wordLevelIdx; i++) useEditorStore.getState().goToQualityIssue(1);
  assert.equal(useEditorStore.getState().selectedWordIndex, wordLevel!.wordIndex);

  // Now step to the caption-level issue (same caption either way) — word selection must clear.
  const delta = captionLevelIdx > wordLevelIdx ? 1 : -1;
  for (let i = 0; i < Math.abs(captionLevelIdx - wordLevelIdx); i++) useEditorStore.getState().goToQualityIssue(delta as 1 | -1);
  assert.equal(useEditorStore.getState().selectedSubtitleId, "a");
  assert.equal(useEditorStore.getState().selectedWordIndex, null);
});

test("176. performance: navigating through every issue of a 5,400-caption project (many issues) stays fast", () => {
  const subtitles: Subtitle[] = Array.from({ length: 5400 }, (_, i) => ({
    id: `qi${i}`,
    index: i,
    start: i * 2,
    end: i * 2 + 0.2, // deliberately below the hard-minimum duration -> TOO_SHORT on every caption
    text: `caption ${i}`,
    words: [{ text: "caption", start: i * 2, end: i * 2 + 0.1 }, { text: `${i}`, start: i * 2 + 0.1, end: i * 2 + 0.2 }],
  }));
  useEditorStore.getState().load(fixtureProject({ subtitles }));

  const t0 = performance.now();
  useEditorStore.getState().runQualityAnalysisAndReview();
  const issueCount = useEditorStore.getState().qualityReport!.issues.length;
  assert.ok(issueCount >= 5400, "every caption should be flagged TOO_SHORT");
  for (let i = 0; i < 500; i++) useEditorStore.getState().goToQualityIssue(1);
  const t1 = performance.now();
  assert.ok(t1 - t0 < 500, `analysis + 500 issue transitions across 5,400 captions took ${t1 - t0}ms`);
});

// ---------------------------------------------------------------------------------------------
// Task 100742 (P13) — Professional Timeline & Playback Editing Workflow. The Phase 0 audit found
// that click-to-seek, snapping, auto-scroll, zoom-anchor preservation, virtualization, and the
// caption/word timing mutation paths (updateSubtitleTiming, nudgeSubtitleTiming, nudgeSubtitles,
// updateWordTiming) already existed and already worked correctly — these tests cover only the
// genuinely new store surface: `setSubtitleBoundaryToPlayhead` (reusing updateSubtitleTiming for
// the actual mutation, never a second nudge/resize implementation).
// ---------------------------------------------------------------------------------------------

function boundaryFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      { id: "a", index: 0, start: 0, end: 2, text: "First", words: [{ text: "First", start: 0, end: 2 }] },
      // Task 115894 (P18.8): "Middle"/"one" leave a 0.3s margin from both of "b"'s own [3,6]
      // caption bounds (rather than exactly tiling it edge-to-edge) — otherwise EVERY resize
      // that moves either edge inward at all would cross a word and reject under the new
      // word-bounds validation, making it impossible to write a plain "succeeds" test for this
      // action at all. Test 184 below deliberately seeks INTO this margin's word span to cover
      // the rejection case.
      { id: "b", index: 1, start: 3, end: 6, text: "Middle one", words: [{ text: "Middle", start: 3.3, end: 4.5 }, { text: "one", start: 4.5, end: 5.7 }] },
      { id: "c", index: 2, start: 7, end: 9, text: "Last", words: [{ text: "Last", start: 7, end: 9 }] },
    ],
  });
}

test("177. setSubtitleBoundaryToPlayhead(start): moves start to the playhead, preserves end, returns true, commits", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(3.2); // stays in "Middle"'s own margin (word starts at 3.3) — a valid resize
  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "start");
  assert.equal(ok, true);
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(sub.start, 3.2);
  assert.equal(sub.end, 6);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "exactly one new history entry");
});

test("178. setSubtitleBoundaryToPlayhead(end): moves end to the playhead, preserves start", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(5.8); // stays in "one"'s own margin (word ends at 5.7) — a valid resize
  const ok = useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "end");
  assert.equal(ok, true);
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(sub.start, 3);
  assert.equal(sub.end, 5.8);
});

test("179. setSubtitleBoundaryToPlayhead: rejects (no commit, no history entry) when it would overlap the previous caption", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(1.5); // squarely inside the PREVIOUS caption "a" (0-2)
  const pastBefore = useEditorStore.getState().past.length;
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  const ok = useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "start");
  assert.equal(ok, false);
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(after, before, "no partial mutation");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no history entry for a rejected request");
});

test("180. setSubtitleBoundaryToPlayhead: rejects when it would overlap the next caption", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(8); // squarely inside the NEXT caption "c" (7-9)
  const pastBefore = useEditorStore.getState().past.length;
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  const ok = useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "end");
  assert.equal(ok, false);
  assert.deepEqual(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!, before);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("181. setSubtitleBoundaryToPlayhead: rejects when it would violate the minimum caption duration", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(5.99); // 0.01s of caption "b" (3-6) would remain — below MIN_CAPTION_DURATION_SEC
  const ok = useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "start");
  assert.equal(ok, false);
});

test("182. setSubtitleBoundaryToPlayhead: rejects a true no-op (playhead already at the current boundary)", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(3); // "b"'s own current start
  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "start");
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("183. setSubtitleBoundaryToPlayhead: rejects for a nonexistent caption id, no crash", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(4);
  assert.equal(useEditorStore.getState().setSubtitleBoundaryToPlayhead("does-not-exist", "start"), false);
});

test("184. setSubtitleBoundaryToPlayhead: a resize that would cut into an existing word rejects atomically (Task 115894/P18.8 — was a silent P7.3 reposition)", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(4); // "b" is "Middle one": Middle(3.3-4.5) one(4.5-5.7) — new start 4 cuts into "Middle"
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "start");
  assert.equal(ok, false, "word-out-of-bounds must surface as a plain rejection, same as every other reason");
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(after, before, "rejected resize: the caption keeps its exact prior object reference");
  assert.deepEqual([after.words[0].start, after.words[0].end], [3.3, 4.5], "Middle's real timing must be untouched");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no history entry for a rejected resize");
});

test("185. setSubtitleBoundaryToPlayhead: undo restores the exact previous timing (including words), redo re-applies it", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.getState().seek(3.2); // the same valid, uncontested resize as test 177
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  useEditorStore.getState().setSubtitleBoundaryToPlayhead("b", "start");
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!, before);

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.start, 3.2);
});

test("186. setSubtitleBoundaryToPlayhead: rejects a negative playhead cleanly (defensive — seek() itself never produces one, but the resolver is still safe)", () => {
  useEditorStore.getState().load(boundaryFixture());
  useEditorStore.setState({ currentTime: -1 });
  assert.equal(useEditorStore.getState().setSubtitleBoundaryToPlayhead("a", "start"), false);
});
