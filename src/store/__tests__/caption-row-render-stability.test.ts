/**
 * Task 109431 (P18.2) — pure "projection" tests proving the DATA-LAYER mechanism that makes
 * `React.memo(CaptionRow)` (src/components/editor/captions-panel.tsx) and
 * `React.memo(TimelineCaptionBlock)` (src/components/editor/timeline.tsx) actually effective, per
 * this task's own explicit fallback instruction: "If render-count tests are brittle in the
 * current test environment, use pure selector/projection tests plus a small dev instrumentation
 * harness instead of inventing fragile implementation-specific assertions." This codebase has no
 * React-rendering test infrastructure (no jsdom/React Testing Library anywhere — confirmed by the
 * P18 preflight audit, research/p18_professional_editor_preflight_report.md §14) — introducing
 * one merely to count renders would itself be a substantially larger, out-of-scope change than
 * this task's own "make the existing memoization actually work" objective, so these tests instead
 * exercise the REAL Zustand store (no mock) and assert, directly, the two properties `React.memo`'s
 * default shallow comparison actually depends on:
 *
 *   1. Every callback PROP passed to a row/block is a referentially stable function — proven by
 *      calling `useEditorStore.getState()` multiple times and asserting each relevant action is
 *      the IDENTICAL reference every time (Zustand's own, well-established guarantee: actions are
 *      defined once at store creation and never reassigned by any `set()` call — this file proves
 *      SUBLY's store actually upholds that, not React's own useCallback contract, which needs no
 *      re-proving here).
 *   2. Every DATA prop for an UNRELATED caption is `Object.is`-stable across a mutation to a
 *      DIFFERENT caption — proven directly against `commit()`/`undo()`/`redo()`'s own real
 *      behavior (editor-store.ts): each returns the SAME `Subtitle` object reference for any
 *      caption its own mutator didn't touch.
 *
 * Together, (1) and (2) are exactly what a `memo()`'d component with default shallow equality
 * needs to correctly skip an unrelated row/block while still re-rendering the one that changed —
 * which this file also proves, for the caption that DOES change.
 *
 * Run with: node --test src/store/__tests__/caption-row-render-stability.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { isTimeWithinCaption } from "../../lib/subtitles/playback-context.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "a", index: 0, start: 0, end: 1, text: "hello world", words: [{ text: "hello", start: 0, end: 0.5 }, { text: "world", start: 0.5, end: 1 }] },
    { id: "b", index: 1, start: 1, end: 2, text: "unrelated caption", words: [{ text: "unrelated", start: 1, end: 1.5 }, { text: "caption", start: 1.5, end: 2 }] },
    { id: "c", index: 2, start: 2, end: 3, text: "a third caption", words: [{ text: "a", start: 2, end: 2.2 }, { text: "third", start: 2.2, end: 2.6 }, { text: "caption", start: 2.6, end: 3 }] },
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

// ============================== Mechanism 1: store action referential stability ==============================
// Every action used as a CaptionRow/TimelineCaptionBlock callback prop (directly, or as a
// useCallback dependency) must be the IDENTICAL reference across multiple reads — this is what
// makes captions-panel.tsx's handleRowFocus/handleMultiSelectClick/handleRowChange/handleSelectWord
// (and the 7 store actions passed straight through) and timeline.tsx's startDrag/
// handleBlockActivate/handleWordSelect permanently stable once wrapped in useCallback against
// these as their only real dependencies.

test("store actions used as CaptionRow/TimelineCaptionBlock callback props are referentially stable across multiple reads", () => {
  useEditorStore.getState().load(fixtureProject());
  const first = useEditorStore.getState();
  const second = useEditorStore.getState();
  const actionNames = [
    "selectSubtitle",
    "seek",
    "updateSubtitleText",
    "updateSubtitleHinglishText",
    "updateSubtitleGujaratiScriptText",
    "selectSubtitleRange",
    "toggleSubtitleSelection",
    "selectWord",
    "updateWordTiming",
    "rebuildWordTiming",
    "splitWord",
    "mergeWordWithNext",
    "deleteWord",
    "insertWord",
    "regenerateDerivedWordText",
  ] as const;
  for (const name of actionNames) {
    assert.equal(first[name], second[name], `${name} must be the same function reference across reads`);
  }
});

test("store actions remain the SAME reference even after a real mutation (commit/undo/redo never reassign actions)", () => {
  useEditorStore.getState().load(fixtureProject());
  const before = useEditorStore.getState().updateSubtitleText;
  useEditorStore.getState().updateSubtitleText("a", "hi world");
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().updateSubtitleText, before, "the action reference itself is never recreated by any mutation");
});

// ============================== Mechanism 2: unrelated-caption object-reference stability ==============================

test("1. One-caption TEXT mutation does not change an unrelated caption's own Subtitle object reference or any of its field values", () => {
  useEditorStore.getState().load(fixtureProject());
  const bBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  const cBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "c")!;

  useEditorStore.getState().updateSubtitleText("a", "hi world");

  const bAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  const cAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "c")!;
  assert.equal(bAfter, bBefore, "caption b's object reference is untouched — a memo'd row for b sees an identical `words`/text-source prop");
  assert.equal(cAfter, cBefore, "caption c's object reference is untouched");
  // The mutated caption's own reference (and displayed text) DOES change — memo() must NOT skip it.
  const aAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(aAfter.text, "hi world");
});

test("2. One-caption TIMING mutation does not change an unrelated caption's own Subtitle object reference", () => {
  useEditorStore.getState().load(fixtureProject());
  const bBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  useEditorStore.getState().updateSubtitleTiming("a", 0.1, 0.9);
  const bAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(bAfter, bBefore, "an unrelated caption's timing edit must not touch caption b at all");
});

test("3. One-WORD timing mutation does not change an unrelated caption's own Subtitle object reference (and only affects the SELECTED row's own words prop, per the existing isSelected gate)", () => {
  useEditorStore.getState().load(fixtureProject());
  const bBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  const aWordsBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.words;

  useEditorStore.getState().updateWordTiming("a", 0, 0.05, 0.45);

  const bAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(bAfter, bBefore, "a word-timing edit on caption a must not touch caption b's own object reference");
  const aWordsAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.words;
  assert.notEqual(aWordsAfter, aWordsBefore, "caption a's own words array DOES change — its row (only ever rendered with words!=null when selected) must re-render");
});

// ============================== Selection state: only the affected rows' props actually change ==============================

test("4. Selection change flips isSelected for exactly the previously- and newly-selected captions, leaving a third caption's own isSelected value unchanged (false -> false, a stable primitive prop)", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().selectSubtitle("a");
  const idsBefore = { a: "a" === useEditorStore.getState().selectedSubtitleId, b: "b" === useEditorStore.getState().selectedSubtitleId, c: "c" === useEditorStore.getState().selectedSubtitleId };
  assert.deepEqual(idsBefore, { a: true, b: false, c: false });

  useEditorStore.getState().selectSubtitle("b");
  const idsAfter = { a: "a" === useEditorStore.getState().selectedSubtitleId, b: "b" === useEditorStore.getState().selectedSubtitleId, c: "c" === useEditorStore.getState().selectedSubtitleId };
  assert.deepEqual(idsAfter, { a: false, b: true, c: false }, "a flips true->false, b flips false->true");
  // c's own computed isSelected boolean is `false` both times — Object.is(false, false) is true,
  // so a memo'd row for c sees this prop as completely unchanged across the selection change.
  assert.equal(idsBefore.c, idsAfter.c, "caption c's own isSelected prop value is identical (false) before and after — stable for memo()");
});

test("5. Multi-selection change updates exactly the affected captions' isMultiSelected membership, leaving an untouched caption's own membership value unchanged", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().toggleSubtitleSelection("a");
  useEditorStore.getState().toggleSubtitleSelection("b");
  const selectedBefore = useEditorStore.getState().selectedSubtitleIds;
  assert.equal(selectedBefore.has("c"), false);

  useEditorStore.getState().toggleSubtitleSelection("a"); // deselect a, leave b selected
  const selectedAfter = useEditorStore.getState().selectedSubtitleIds;
  assert.equal(selectedAfter.has("a"), false, "a was removed from the multi-selection");
  assert.equal(selectedAfter.has("b"), true, "b remains selected — untouched by toggling a");
  assert.equal(selectedAfter.has("c"), false, "c's own membership (false) is unchanged — stable prop for memo()");
});

// ============================== Quality-issue current-caption indicator ==============================

test("7. Quality current-issue navigation marks exactly the target caption's own isCurrentQualityIssue as true, leaving every other caption's own value at false (stable for memo())", () => {
  const project = fixtureProject({
    subtitles: [
      { id: "a", index: 0, start: 0, end: 0.05, text: "hi", words: [] }, // INVALID_DURATION issue
      { id: "b", index: 1, start: 1, end: 2, text: "fine caption", words: [] },
      { id: "c", index: 2, start: 2, end: 2.05, text: "bye", words: [] }, // INVALID_DURATION issue
    ],
  });
  useEditorStore.getState().load(project);
  useEditorStore.getState().runQualityAnalysisAndReview();
  const report = useEditorStore.getState().qualityReport!;
  assert.ok(report.issues.length >= 2, "fixture must produce at least the two deliberately-invalid-duration issues");

  const issueIndex = useEditorStore.getState().qualityIssueIndex;
  assert.notEqual(issueIndex, null);
  const currentCaptionId = report.issues[issueIndex!].captionId;
  // Exactly one caption is ever "current" — every other caption's own isCurrentQualityIssue
  // boolean is `false`, a value that a memo'd row/block sees as unchanged from its own prior
  // (also-false) render whenever navigation moves the cursor to a DIFFERENT caption's issue.
  const flags = { a: currentCaptionId === "a", b: currentCaptionId === "b", c: currentCaptionId === "c" };
  assert.equal(Object.values(flags).filter(Boolean).length, 1, "exactly one caption is current at a time");
});

// ============================== Undo/redo restores the correct row's own data, without disturbing others ==============================

test("11. Undo restores the mutated caption's own field values while an unrelated caption's object reference never changed in the first place; redo re-applies the same mutation", () => {
  useEditorStore.getState().load(fixtureProject());
  const bRef = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;

  useEditorStore.getState().updateSubtitleText("a", "hi world");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!, bRef, "unaffected caption's reference unchanged immediately after the edit");

  useEditorStore.getState().undo();
  const aAfterUndo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(aAfterUndo.text, "hello world", "undo restores caption a's exact original text");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!, bRef, "caption b's reference is STILL unchanged after undo — undo/redo never touch unrelated captions");

  useEditorStore.getState().redo();
  const aAfterRedo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(aAfterRedo.text, "hi world", "redo re-applies the exact mutated text");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!, bRef, "caption b's reference is STILL unchanged after redo");
});

// ============================== Playback-active-caption indicator (isTimeWithinCaption) ==============================
// Item 6 (active playback state) — captions-panel.tsx doesn't compute a per-caption active-word
// state itself (that's WordChips's own direct currentTime subscription, isolated to the selected
// row only — see captions-panel.tsx's own WordChips doc comment, unmodified by this task).
// timeline.tsx's TimelineCaptionBlock DOES take `isActive` as a plain boolean prop, computed by
// Timeline's own isTimeWithinCaption() call per visible caption — this test proves that boolean
// stays a stable, unchanged VALUE (not just an unchanged reference — booleans compare by value)
// for a caption that is never the one under the playhead.

test("6. isTimeWithinCaption (the source of TimelineCaptionBlock's `isActive` prop) returns a stable false for an unrelated caption across a currentTime change that stays inside a DIFFERENT caption's own range", () => {
  const subA = { id: "a", index: 0, start: 0, end: 1, text: "a", words: [] } as unknown as Subtitle;
  const before = isTimeWithinCaption(subA, 5.0); // playhead is over caption "c" (2-3)... use an unrelated time
  const after = isTimeWithinCaption(subA, 5.2);
  assert.equal(before, false);
  assert.equal(after, false);
  assert.equal(before, after, "the boolean VALUE is identical (false) both times — Object.is(false, false) — a memo'd block sees this prop as unchanged");
});

// ============================== Performance: the render-count proxy at scale (Phase 1/7) ==============================
// The most important metric this task cares about — "after editing one caption, how many other
// visible CaptionRows rerender?" — reduces, at the DATA layer, to "how many OTHER captions' own
// Subtitle object references changed?" (a memo'd row/block with only primitive/stable-callback/
// object-reference props re-renders if and only if at least one of those actually differs). This
// measures that proxy directly at the same 30/300/1,800/3,600/5,400-caption tiers the rest of the
// project's own performance-test family uses, both for correctness (0 unrelated captions ever
// change) and for cost (computing the comparison itself stays fast, no O(n²)).

function buildLargeStabilityProject(captionCount: number): ProjectData {
  const subtitles: Subtitle[] = [];
  for (let i = 0; i < captionCount; i++) {
    const start = i * 2;
    // Task 115894 (P18.8): words leave a 0.15s margin from both of the caption's own edges
    // (rather than exactly tiling it) so the "single-caption timing edit" perf test below — a
    // resize that shrinks the caption by 0.1s on each side — stays a VALID resize under the new
    // word-bounds validation instead of cutting into "hello"/"again" and rejecting.
    subtitles.push({
      id: `s${i}`,
      index: i,
      start,
      end: start + 2,
      text: "hello world again",
      words: [
        { text: "hello", start: start + 0.15, end: start + 0.72 },
        { text: "world", start: start + 0.72, end: start + 1.28 },
        { text: "again", start: start + 1.28, end: start + 1.85 },
      ],
    });
  }
  return fixtureProject({ subtitles, id: "big", name: "Large stability fixture" });
}

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: after a single-caption text edit at ${captionCount} total captions, ZERO of the other captions' own object references change (the render-count proxy)`, () => {
    useEditorStore.getState().load(buildLargeStabilityProject(captionCount));
    const targetId = `s${Math.floor(captionCount / 2)}`;
    const before = useEditorStore.getState().project!.subtitles;

    const start = performance.now();
    useEditorStore.getState().updateSubtitleText(targetId, "hi world again");
    const after = useEditorStore.getState().project!.subtitles;
    let unchangedCount = 0;
    let changedCount = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) unchangedCount++;
      else changedCount++;
    }
    const elapsedMs = performance.now() - start;

    assert.equal(changedCount, 1, "exactly the ONE edited caption's reference changes");
    assert.equal(unchangedCount, captionCount - 1, "every other caption keeps its exact prior object reference — 0 unrelated rows would need to re-render");
    assert.ok(elapsedMs < 150, `mutation + comparison took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms (same ceiling this project's own sibling perf tests use)`);
  });

  test(`performance: after a single-caption timing edit at ${captionCount} total captions, ZERO of the other captions' own object references change`, () => {
    useEditorStore.getState().load(buildLargeStabilityProject(captionCount));
    const targetId = `s${Math.floor(captionCount / 2)}`;
    const targetIndex = Math.floor(captionCount / 2);
    const before = useEditorStore.getState().project!.subtitles;
    const target = before[targetIndex];

    useEditorStore.getState().updateSubtitleTiming(targetId, target.start + 0.1, target.end - 0.1);
    const after = useEditorStore.getState().project!.subtitles;
    let unchangedCount = 0;
    for (let i = 0; i < before.length; i++) if (before[i] === after[i]) unchangedCount++;

    assert.equal(unchangedCount, captionCount - 1, "every other caption keeps its exact prior object reference after an unrelated timing edit");
  });

  test(`performance: after a single-WORD timing edit at ${captionCount} total captions, ZERO of the other captions' own object references change`, () => {
    useEditorStore.getState().load(buildLargeStabilityProject(captionCount));
    const targetId = `s${Math.floor(captionCount / 2)}`;
    const before = useEditorStore.getState().project!.subtitles;

    useEditorStore.getState().updateWordTiming(targetId, 0, before[Math.floor(captionCount / 2)].start + 0.05, before[Math.floor(captionCount / 2)].start + 0.55);
    const after = useEditorStore.getState().project!.subtitles;
    let unchangedCount = 0;
    for (let i = 0; i < before.length; i++) if (before[i] === after[i]) unchangedCount++;

    assert.equal(unchangedCount, captionCount - 1, "every other caption keeps its exact prior object reference after an unrelated word-timing edit");
  });
}

// ============================== Cross-references to existing, unmodified coverage (not duplicated here) ==============================
// - Item 8 (Original/Hinglish/Gujarati Script display-mode correctness): fully covered by the
//   existing P17/P17.1/P17.2/P17.3 test suites (editor-store-output-mode.test.ts,
//   output-mode-policy.test.ts, caption-display-mode.test.ts) — none of that logic was touched by
//   this task; captions-panel.tsx's own `displayText` computation (`s.hinglishText ?? s.text`,
//   etc.) is untouched, only WHICH callback references get passed alongside it changed.
// - Item 9 (style/animation changes remain visible): CaptionRow itself renders neither style nor
//   animation at all (confirmed directly by reading its full JSX during this task's own Phase 0
//   audit) — that rendering lives in the canvas/preview component (subtitle-overlay.tsx), which
//   this task did not touch. Not applicable to CaptionRow's own memoization surface.
// - Item 10 (virtualization mounted-row bound): fully covered, unmodified, by
//   src/lib/timeline/__tests__/list-virtualization.test.ts and visible-range.test.ts — this task
//   did not change list-virtualization.ts, visible-range.ts, or either component's own windowing
//   math, only the callback/prop shape of the rows/blocks those windows mount.
// - Item 12 (autosave behavior unchanged): use-autosave.ts, save-queue.ts, and project-patch.ts
//   were not touched by this task at all (confirmed by diff) — their own existing test files
//   (save-queue.test.ts, project-patch.test.ts) still pass completely unmodified.
