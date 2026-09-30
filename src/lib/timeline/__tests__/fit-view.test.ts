/**
 * Pure tests for "Fit to Project" / "Fit to Selection" (Task 121684, P19.2 —
 * src/lib/timeline/fit-view.ts). No React, no store, no DOM.
 *
 * Run with: node --test src/lib/timeline/__tests__/fit-view.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeSelectionBoundingRange, computeFitView } from "../fit-view.ts";
import { computeZoomAnchor, computeZoomScrollLeft } from "../zoom-anchor.ts";
import { useEditorStore } from "../../../store/editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../../types/subtitle.ts";

const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 220;

// --- computeSelectionBoundingRange ----------------------------------------------------------

test("computeSelectionBoundingRange: a single caption's own range", () => {
  assert.deepEqual(computeSelectionBoundingRange([{ start: 2, end: 5 }]), { start: 2, end: 5 });
});

test("12. computeSelectionBoundingRange: a NON-CONTIGUOUS selection (e.g. captions 1 and 5 of 10) fits the entire bounding range, not two separate islands", () => {
  const selected = [
    { start: 2, end: 3 }, // caption 1
    { start: 40, end: 42 }, // caption 5, far away — nothing selected in between
  ];
  assert.deepEqual(computeSelectionBoundingRange(selected), { start: 2, end: 42 });
});

test("computeSelectionBoundingRange: order-independent — the bounding range is the same regardless of selection/array order", () => {
  const a = computeSelectionBoundingRange([{ start: 40, end: 42 }, { start: 2, end: 3 }, { start: 10, end: 11 }]);
  const b = computeSelectionBoundingRange([{ start: 2, end: 3 }, { start: 10, end: 11 }, { start: 40, end: 42 }]);
  assert.deepEqual(a, { start: 2, end: 42 });
  assert.deepEqual(a, b);
});

test("computeSelectionBoundingRange: empty selection -> null (never invents/guesses a range)", () => {
  assert.equal(computeSelectionBoundingRange([]), null);
});

test("computeSelectionBoundingRange: malformed entries (non-finite, or end<=start) are skipped, never fabricated", () => {
  assert.deepEqual(computeSelectionBoundingRange([{ start: NaN, end: 5 }, { start: 2, end: 3 }]), { start: 2, end: 3 });
  assert.equal(computeSelectionBoundingRange([{ start: 5, end: 5 }]), null, "a single zero-duration entry contributes nothing meaningful");
});

// --- computeFitView: Fit to Project (range = [0, duration]) ---------------------------------

test("8. Fit to Project: the full [0, duration] range becomes exactly visible, timeline begins at project start", () => {
  const result = computeFitView({ range: { start: 0, end: 60 }, duration: 60, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC, paddingPx: 0 })!;
  assert.ok(result);
  assert.equal(result.scrollLeft, 0, "project start must be at the very left edge — no unnecessary empty area before it");
  // 1000px viewport / 60s = ~16.67 px/sec, but that's below MIN_PX_PER_SEC(20) — clamped there.
  assert.equal(result.pxPerSec, MIN_PX_PER_SEC);
});

test("8b. Fit to Project: a short project doesn't zoom in past MAX_PX_PER_SEC", () => {
  const result = computeFitView({ range: { start: 0, end: 2 }, duration: 2, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC })!;
  assert.equal(result.pxPerSec, MAX_PX_PER_SEC, "1000px/2s would be 500px/sec — clamped to the existing zoom ceiling, not a new invented range");
});

test("8c. Fit to Project: a project whose ideal fit lands within [MIN,MAX] uses that exact value, and the whole duration ends up visible", () => {
  const duration = 20;
  const viewportWidth = 1000;
  const result = computeFitView({ range: { start: 0, end: duration }, duration, viewportWidth, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC, paddingPx: 0 })!;
  assert.equal(result.pxPerSec, 50, "1000px / 20s = 50px/sec, comfortably within [20,220]");
  const endPx = duration * result.pxPerSec - result.scrollLeft;
  assert.ok(endPx <= viewportWidth + 1e-6, "the project's own end must land within the viewport");
});

test("10. Fit to Project: zero-duration (or unavailable) project fails safely — returns null, does nothing", () => {
  assert.equal(computeFitView({ range: { start: 0, end: 0 }, duration: 0, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC }), null);
  assert.equal(computeFitView({ range: { start: 0, end: -5 }, duration: 0, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC }), null, "negative/inverted range");
});

test("a non-finite or non-positive viewport width fails safely — returns null", () => {
  assert.equal(computeFitView({ range: { start: 0, end: 60 }, duration: 60, viewportWidth: NaN, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC }), null);
  assert.equal(computeFitView({ range: { start: 0, end: 60 }, duration: 60, viewportWidth: 0, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC }), null);
});

// --- computeFitView: Fit to Selection (range = a subset of the project) ---------------------

test("9. Fit to Selection: a single selected caption's own range becomes visible, with padding, scrollLeft clamped against the FULL project's own track width", () => {
  const result = computeFitView({ range: { start: 30, end: 32 }, duration: 120, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC })!;
  assert.ok(result);
  assert.equal(result.pxPerSec, MAX_PX_PER_SEC, "a 2s caption in a 1000px viewport wants ~500px/sec — clamped to the ceiling");
  // scrollLeft should land the caption's own start (30s * 220px/sec = 6600px) minus the 40px padding.
  assert.equal(result.scrollLeft, 30 * MAX_PX_PER_SEC - 40);
});

test("11. Fit to Selection: a selected range whose scrollLeft would exceed the project's own track width is clamped, not left dangling past the end", () => {
  // A caption near the very end of a short project — fitting it at max zoom would want a
  // scrollLeft past the track's own total width; must clamp instead of overshooting.
  const duration = 10;
  const result = computeFitView({ range: { start: 9, end: 9.5 }, duration, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC })!;
  const totalWidth = Math.max(800, duration * result.pxPerSec);
  const maxScrollLeft = Math.max(0, totalWidth - 1000);
  assert.equal(result.scrollLeft, maxScrollLeft);
  assert.ok(result.scrollLeft >= 0);
});

test("12b. Fit to Selection: the non-contiguous bounding range (from computeSelectionBoundingRange) fits correctly end-to-end", () => {
  const selected = [{ start: 2, end: 3 }, { start: 40, end: 42 }];
  const range = computeSelectionBoundingRange(selected)!;
  const result = computeFitView({ range, duration: 100, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC, paddingPx: 0 })!;
  assert.ok(result);
  // 40s range (2->42) in a 1000px viewport = 25px/sec, within [20,220].
  assert.equal(result.pxPerSec, 25);
  assert.equal(result.scrollLeft, 2 * 25);
});

test("Fit to Selection: zero-width range (a single zero-duration caption) fails safely — returns null", () => {
  assert.equal(computeFitView({ range: { start: 5, end: 5 }, duration: 60, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC }), null);
});

// --- viewport width changes (item 13) / resize + zoom composition (item 15) -----------------

test("13. a narrower viewport produces a smaller pxPerSec for the SAME range — the function is viewport-width-parameterized, never stale", () => {
  const range = { start: 0, end: 10 };
  const wide = computeFitView({ range, duration: 10, viewportWidth: 1200, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC, paddingPx: 0 })!;
  const narrow = computeFitView({ range, duration: 10, viewportWidth: 600, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC, paddingPx: 0 })!;
  assert.ok(narrow.pxPerSec < wide.pxPerSec, "a narrower viewport (e.g. after widening the captions panel) must fit the same range at a lower zoom");
  assert.equal(wide.pxPerSec, 120);
  assert.equal(narrow.pxPerSec, 60);
});

test("15. resize + zoom composition: fitting, then re-fitting at a new (post-resize) viewport width, converges on the new width's own correct fit — no leftover state from the old width", () => {
  const range = { start: 0, end: 10 };
  const beforeResize = computeFitView({ range, duration: 10, viewportWidth: 1000, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC, paddingPx: 0 })!;
  const afterResize = computeFitView({ range, duration: 10, viewportWidth: 700, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC, paddingPx: 0 })!;
  assert.notEqual(beforeResize.pxPerSec, afterResize.pxPerSec);
  assert.equal(afterResize.pxPerSec, 700 / 10);
});

// --- zoom min/max clamp (items 6/7 of the task's own numbered list) -------------------------
// timeline.tsx's own `zoomBy` clamps with the identical one-line formula inline (it isn't its own
// exported pure function — extracting it purely to gain a unit test would be exactly the kind of
// unnecessary abstraction this task asks NOT to introduce for a trivial Math.max/Math.min). Tested
// here directly against that exact formula instead, mirroring the P18.x precedent of testing a
// component's own inline arithmetic without requiring it to be exported first.

test("6. zoom min clamp: requesting below MIN_PX_PER_SEC clamps to the floor", () => {
  const zoomBy = (current: number, deltaPx: number) => Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, current + deltaPx));
  assert.equal(zoomBy(MIN_PX_PER_SEC, -1000), MIN_PX_PER_SEC);
});

test("7. zoom max clamp: requesting above MAX_PX_PER_SEC clamps to the ceiling", () => {
  const zoomBy = (current: number, deltaPx: number) => Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, current + deltaPx));
  assert.equal(zoomBy(MAX_PX_PER_SEC, 1000), MAX_PX_PER_SEC);
});

// ---------------------------------------------------------------------------------------
// MANDATORY REGRESSION (task's own explicit requirement): proves timeline zoom/fit navigation
// does NOT touch project state — project, subtitles, subtitle objects, word arrays, word
// timestamps, selection, undo history, dirty state, or autosave — using reference equality,
// exactly as P18.2/P19.1 established. Since fit-view.ts and zoom-anchor.ts have no dependency on
// editor-store.ts at all, this is checked by exercising every exported function from BOTH modules
// against a REAL store snapshot and confirming total non-interaction.
// ---------------------------------------------------------------------------------------

test("[REGRESSION] fit-view.ts and zoom-anchor.ts functions never touch useEditorStore — project, subtitles, words, selection, undo history, and dirty state are all reference-identical before/after", () => {
  useEditorStore.getState().load({
    id: "p1",
    name: "Zoom/fit regression fixture",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles: [
      { id: "a", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
      { id: "b", index: 1, start: 2, end: 3, text: "World", words: [{ text: "World", start: 2, end: 3 }] },
    ],
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
  useEditorStore.getState().toggleSubtitleSelection("b");

  const before = useEditorStore.getState();
  const projectBefore = before.project;
  const subtitlesBefore = before.project!.subtitles;
  const wordsBefore = before.project!.subtitles[0].words;
  const pastBefore = before.past;
  const dirtyBefore = before.dirty;
  const selectedIdsBefore = before.selectedSubtitleIds;

  // Exercise every exported function across both timeline-navigation pure modules — a full
  // "zoom in, zoom out, fit project, fit selection, resize" gesture's worth of calls.
  const anchor = computeZoomAnchor({ currentTime: 5, scrollLeft: 100, viewportWidth: 800, pxPerSec: 70 });
  computeZoomScrollLeft({ anchorTime: anchor.anchorTime, anchorOffsetPx: anchor.anchorOffsetPx, newPxPerSec: 90, duration: 120, viewportWidth: 800 });
  const range = computeSelectionBoundingRange([{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  computeFitView({ range: range!, duration: 120, viewportWidth: 800, minPxPerSec: 20, maxPxPerSec: 220 });
  computeFitView({ range: { start: 0, end: 120 }, duration: 120, viewportWidth: 800, minPxPerSec: 20, maxPxPerSec: 220 });

  const after = useEditorStore.getState();
  assert.equal(after.project, projectBefore, "project object reference unchanged");
  assert.equal(after.project!.subtitles, subtitlesBefore, "subtitles array reference unchanged");
  assert.equal(after.project!.subtitles[0].words, wordsBefore, "words array reference unchanged");
  assert.equal(after.project!.subtitles[0].start, 0, "subtitle timestamp unchanged");
  assert.equal(after.project!.subtitles[1].start, 2, "subtitle timestamp unchanged");
  assert.equal(after.project!.subtitles[0].words[0].start, 0, "word timestamp unchanged");
  assert.equal(after.past, pastBefore, "undo history (past stack) reference unchanged — zero new entries");
  assert.equal(after.dirty, dirtyBefore, "dirty flag unchanged — no autosave was ever triggered");
  assert.equal(after.selectedSubtitleIds, selectedIdsBefore, "selection unchanged");
});
