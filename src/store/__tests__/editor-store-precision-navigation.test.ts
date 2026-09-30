/**
 * Task 123041 (P19.3) — precision-navigation tests: Go to Start/End, exact "Go to time" entry,
 * selected-caption start/end (single and multi-selection bounding range), selected-word
 * start/end, and — mandatory per this task's own spec — a non-monotonic word-order safety proof.
 * Plus the required project-state-isolation regression, following the exact P18.2/P19.1/P19.2
 * reference-equality convention.
 *
 * None of these navigation paths are separate store actions of their own — "Go to X" is always
 * just "compute a target time, then call the EXISTING `store.seek()`" (this task's own explicit
 * "do not create a second independent playback-time state" requirement), so what's tested here is
 * exactly the same computation the UI performs: `parseTimelineTime`/`clampTimelineTime`
 * (lib/timeline/timecode.ts), `computeSelectionBoundingRange` (lib/timeline/fit-view.ts, P19.2,
 * reused unchanged), and — for words — direct property access on the word object itself.
 *
 * Run with: node --test src/store/__tests__/editor-store-precision-navigation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { parseTimelineTime, clampTimelineTime } from "../../lib/timeline/timecode.ts";
import { computeSelectionBoundingRange } from "../../lib/timeline/fit-view.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";

const PROJECT_DURATION = 20;

function loadFixture() {
  useEditorStore.getState().load({
    id: "p1",
    name: "Precision-navigation fixture",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    video: { url: "blob:fake", originalName: "fake.mp4", duration: PROJECT_DURATION, width: 1080, height: 1920, fps: 30 },
    subtitles: [
      {
        id: "cap1",
        index: 0,
        // Task's own worked example: array order (BRAVO, DELTA, CHARLIE) is deliberately
        // non-monotonic relative to chronological order (BRAVO 2-3, CHARLIE 3.5-4.5, DELTA 5-6).
        start: 2,
        end: 6,
        text: "BRAVO DELTA CHARLIE",
        words: [
          { text: "BRAVO", start: 2.0, end: 3.0 },
          { text: "DELTA", start: 5.0, end: 6.0 },
          { text: "CHARLIE", start: 3.5, end: 4.5 },
        ],
      },
      { id: "cap2", index: 1, start: 10, end: 12, text: "TWO", words: [{ text: "TWO", start: 10, end: 12 }] },
      { id: "cap3", index: 2, start: 14, end: 16, text: "THREE", words: [{ text: "THREE", start: 14, end: 16 }] },
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
}

// --- 14/15. Go to start / Go to end ---------------------------------------------------------

test("14. Go to Start seeks to exactly t=0", () => {
  loadFixture();
  useEditorStore.getState().seek(12.34);
  useEditorStore.getState().seek(0);
  assert.equal(useEditorStore.getState().currentTime, 0);
});

test("15. Go to End seeks to exactly the project's own video.duration", () => {
  loadFixture();
  useEditorStore.getState().seek(useEditorStore.getState().project!.video!.duration);
  assert.equal(useEditorStore.getState().currentTime, PROJECT_DURATION);
});

// --- 16/17. Exact "Go to time" entry --------------------------------------------------------

test("16. Go to exact time: valid typed input seeks to the exact parsed/clamped value", () => {
  loadFixture();
  const parsed = parseTimelineTime("00:07.25");
  assert.ok(parsed !== null);
  useEditorStore.getState().seek(clampTimelineTime(parsed!, PROJECT_DURATION));
  assert.equal(useEditorStore.getState().currentTime, 7.25);
});

test("17. Invalid typed time is rejected safely — no seek happens, current time is untouched", () => {
  loadFixture();
  useEditorStore.getState().seek(5);
  const parsed = parseTimelineTime("not a time");
  assert.equal(parsed, null);
  // Mirrors video-canvas.tsx's own commitTimeInput: `if (parsed !== null) seek(...)`.
  if (parsed !== null) useEditorStore.getState().seek(clampTimelineTime(parsed, PROJECT_DURATION));
  assert.equal(useEditorStore.getState().currentTime, 5, "current time must be exactly what it was before the invalid input");
});

test("17b. An out-of-range typed time is clamped into range, not rejected outright", () => {
  loadFixture();
  const parsed = parseTimelineTime("99:00");
  assert.equal(parsed, 5940);
  const clamped = clampTimelineTime(parsed!, PROJECT_DURATION);
  assert.equal(clamped, PROJECT_DURATION);
  useEditorStore.getState().seek(clamped);
  assert.equal(useEditorStore.getState().currentTime, PROJECT_DURATION);
});

// --- 18-21. Selected caption start/end, single and multi-selection --------------------------

test("18/19. Selected (single) caption start/end use the caption's own start/end", () => {
  loadFixture();
  useEditorStore.getState().selectSubtitle("cap2");
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "cap2")!;
  const range = computeSelectionBoundingRange([sub]);
  assert.deepEqual(range, { start: 10, end: 12 });
  useEditorStore.getState().seek(range!.start);
  assert.equal(useEditorStore.getState().currentTime, 10);
  useEditorStore.getState().seek(range!.end);
  assert.equal(useEditorStore.getState().currentTime, 12);
});

test("20/21. Multi-selection start/end use the MINIMUM start and MAXIMUM end across the selection", () => {
  loadFixture();
  useEditorStore.getState().selectSubtitle("cap1");
  useEditorStore.getState().toggleSubtitleSelection("cap3");
  const ids = useEditorStore.getState().selectedSubtitleIds;
  const captions = useEditorStore.getState().project!.subtitles.filter((s) => ids.has(s.id));
  const range = computeSelectionBoundingRange(captions);
  // cap1: 2-6, cap3: 14-16 -> bounding range 2-16 (NOT the two separate islands, and NOT cap2's
  // 10-12 gap in between, matching this task's own "fit/jump the bounding range" rule).
  assert.deepEqual(range, { start: 2, end: 16 });
  useEditorStore.getState().seek(range!.start);
  assert.equal(useEditorStore.getState().currentTime, 2);
  useEditorStore.getState().seek(range!.end);
  assert.equal(useEditorStore.getState().currentTime, 16);
});

// --- 22-24. Selected word start/end, including the mandatory non-monotonic proof ------------

test("22/23. Selected word start/end use the word object's OWN timestamps", () => {
  loadFixture();
  useEditorStore.getState().selectSubtitle("cap1");
  useEditorStore.getState().selectWord(0); // BRAVO, array index 0
  const state = useEditorStore.getState();
  const word = state.project!.subtitles.find((s) => s.id === "cap1")!.words[state.selectedWordIndex!];
  assert.equal(word.text, "BRAVO");
  useEditorStore.getState().seek(word.start);
  assert.equal(useEditorStore.getState().currentTime, 2.0);
  useEditorStore.getState().seek(word.end);
  assert.equal(useEditorStore.getState().currentTime, 3.0);
});

test("24. [MANDATORY] non-monotonic selected word: jumping to CHARLIE (array index 2, chronologically the MIDDLE word) uses ITS OWN 3.5/4.5 — never DELTA's 5.0/6.0 (array-adjacent) or any other neighbor's timing", () => {
  loadFixture();
  useEditorStore.getState().selectSubtitle("cap1");
  useEditorStore.getState().selectWord(2); // CHARLIE is at array index 2, despite being chronologically 2nd
  const state = useEditorStore.getState();
  const caption = state.project!.subtitles.find((s) => s.id === "cap1")!;
  const word = caption.words[state.selectedWordIndex!];
  assert.equal(word.text, "CHARLIE");
  assert.equal(word.start, 3.5, "must be CHARLIE's own start, never inferred from array position");
  assert.equal(word.end, 4.5, "must be CHARLIE's own end, never inferred from array position");

  useEditorStore.getState().seek(word.start);
  assert.equal(useEditorStore.getState().currentTime, 3.5, "Jump to Word Start must land on 3.5, never 5.0 (DELTA's start, the array-adjacent word)");
  useEditorStore.getState().seek(word.end);
  assert.equal(useEditorStore.getState().currentTime, 4.5, "Jump to Word End must land on 4.5, never 6.0 (DELTA's end, the array-adjacent word)");

  // Extra belt-and-suspenders: confirm the array is genuinely non-monotonic (index 1, DELTA,
  // chronologically comes AFTER index 2, CHARLIE) — this test would be meaningless against an
  // accidentally-sorted fixture.
  assert.ok(caption.words[1].start > caption.words[2].start, "fixture must actually be non-monotonic for this test to prove anything");
});

// ---------------------------------------------------------------------------------------
// 31-37. MANDATORY REGRESSION: none of the navigation above mutates project/subtitle state.
// ---------------------------------------------------------------------------------------

test("[REGRESSION] precision navigation never touches project, subtitles, words, selection, undo history, or dirty state", () => {
  loadFixture();
  // Single-caption selection with a word also selected — multi-selecting a SECOND caption would
  // itself clear `selectedWordIndex` (existing, pre-P19.3 store behavior: word selection only
  // makes sense for one focused caption), so this combined sequence deliberately stays within
  // that single-selection state rather than manufacturing a combination the app itself never
  // produces. Multi-selection's own bounding range is already separately proven in tests 20/21.
  useEditorStore.getState().selectSubtitle("cap1");
  useEditorStore.getState().selectWord(2);

  const before = useEditorStore.getState();
  const projectBefore = before.project;
  const subtitlesBefore = before.project!.subtitles;
  const wordsBefore = before.project!.subtitles[0].words;
  const pastBefore = before.past;
  const dirtyBefore = before.dirty;
  const selectedIdsBefore = before.selectedSubtitleIds;
  const selectedWordIndexBefore = before.selectedWordIndex;

  // Exercise every navigation path this task adds: Go to Start, Go to End, exact time entry
  // (valid and invalid), selection bounding range (single + multi), word start/end.
  useEditorStore.getState().seek(0);
  useEditorStore.getState().seek(before.project!.video!.duration);
  const parsed = parseTimelineTime("00:05.00");
  useEditorStore.getState().seek(clampTimelineTime(parsed!, PROJECT_DURATION));
  const invalidParsed = parseTimelineTime("garbage");
  if (invalidParsed !== null) useEditorStore.getState().seek(clampTimelineTime(invalidParsed, PROJECT_DURATION));
  const range = computeSelectionBoundingRange(subtitlesBefore.filter((s) => selectedIdsBefore.has(s.id)));
  useEditorStore.getState().seek(range!.start);
  useEditorStore.getState().seek(range!.end);
  const word = subtitlesBefore[0].words[selectedWordIndexBefore!];
  useEditorStore.getState().seek(word.start);
  useEditorStore.getState().seek(word.end);

  const after = useEditorStore.getState();
  assert.equal(after.project, projectBefore, "project object reference unchanged");
  assert.equal(after.project!.subtitles, subtitlesBefore, "subtitles array reference unchanged");
  assert.equal(after.project!.subtitles[0].words, wordsBefore, "words array reference unchanged");
  assert.equal(after.project!.subtitles[0].words[1].start, 5.0, "DELTA's timestamp unchanged");
  assert.equal(after.project!.subtitles[0].words[2].start, 3.5, "CHARLIE's timestamp unchanged");
  assert.equal(after.project!.subtitles[0].words[2].end, 4.5, "CHARLIE's timestamp unchanged");
  assert.equal(after.past, pastBefore, "undo history (past stack) reference unchanged — zero new entries");
  assert.equal(after.dirty, dirtyBefore, "dirty flag unchanged — no autosave was ever triggered");
  assert.equal(after.selectedSubtitleIds, selectedIdsBefore, "selection unchanged");
  assert.equal(after.selectedWordIndex, selectedWordIndexBefore, "word selection unchanged");
});
