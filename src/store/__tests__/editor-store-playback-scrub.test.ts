/**
 * Task 124572 (P19.4) — play/pause and scrub state-isolation tests. Timeline click-to-seek and
 * playhead/ruler scrubbing are NOT separate store actions — Phase 0 confirmed both already
 * reduce to "compute a target time, then call the EXISTING `store.seek()`" (never a second
 * playback-time state), so what's tested here is that repeated `seek()`/`setPlaying()` calls —
 * exactly what a scrub gesture or a play/pause click produces — never touch project/subtitle
 * state, selection, undo history, or the dirty flag. See click-to-seek.test.ts for the pure
 * x -> time mapping itself.
 *
 * Run with: node --test src/store/__tests__/editor-store-playback-scrub.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";

function loadFixture() {
  useEditorStore.getState().load({
    id: "p1",
    name: "Playback/scrub fixture",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    video: { url: "blob:fake", originalName: "fake.mp4", duration: 12, width: 1080, height: 1920, fps: 30 },
    subtitles: [
      { id: "alfa", index: 0, start: 0.5, end: 1.75, text: "ALFA", words: [{ text: "ALFA", start: 0.5, end: 1.75 }] },
      {
        id: "nonmono",
        index: 1,
        start: 2,
        end: 6,
        text: "BRAVO DELTA CHARLIE",
        // Task's own worked example: non-monotonic array order.
        words: [
          { text: "BRAVO", start: 2.0, end: 3.0 },
          { text: "DELTA", start: 5.0, end: 6.0 },
          { text: "CHARLIE", start: 3.5, end: 4.5 },
        ],
      },
      { id: "hotel", index: 2, start: 7, end: 10.4, text: "HOTEL", words: [{ text: "HOTEL", start: 7, end: 10.4 }] },
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

test("5. play/pause does not mutate project", () => {
  loadFixture();
  const before = useEditorStore.getState();
  const projectBefore = before.project;
  useEditorStore.getState().setPlaying(true);
  useEditorStore.getState().setPlaying(false);
  assert.equal(useEditorStore.getState().project, projectBefore);
  assert.equal(useEditorStore.getState().isPlaying, false);
});

test("6/7/8. a scrub gesture (many rapid seek() calls) does not mutate project, create undo history, or dirty the project", () => {
  loadFixture();
  const before = useEditorStore.getState();
  const projectBefore = before.project;
  const subtitlesBefore = before.project!.subtitles;
  const pastBefore = before.past;
  const dirtyBefore = before.dirty;

  // 25. repeated scrubbing — simulate a realistic pointermove-driven drag: many seek() calls in
  // quick succession, sweeping across caption/word boundaries.
  for (const t of [0, 0.5, 1.75, 2, 3.5, 4.5, 5, 6, 7, 8.5, 10.4, 12, 6, 0]) {
    useEditorStore.getState().seek(t);
  }

  const after = useEditorStore.getState();
  assert.equal(after.project, projectBefore, "project object reference unchanged");
  assert.equal(after.project!.subtitles, subtitlesBefore, "subtitles array reference unchanged");
  assert.equal(after.past, pastBefore, "undo history (past stack) reference unchanged — zero new entries");
  assert.equal(after.dirty, dirtyBefore, "dirty flag unchanged — no autosave was ever triggered");
  assert.equal(after.currentTime, 0, "the last seek() call wins, exactly like a real drag's last pointermove");
});

test("9/10/11. selection (single, multi, word) remains unchanged through play/pause/seek", () => {
  loadFixture();
  useEditorStore.getState().selectSubtitle("nonmono");
  useEditorStore.getState().selectWord(2); // CHARLIE, array index 2
  const selectedIdBefore = useEditorStore.getState().selectedSubtitleId;
  const selectedWordIndexBefore = useEditorStore.getState().selectedWordIndex;

  useEditorStore.getState().setPlaying(true);
  useEditorStore.getState().seek(3.5);
  useEditorStore.getState().seek(4.5);
  useEditorStore.getState().setPlaying(false);

  assert.equal(useEditorStore.getState().selectedSubtitleId, selectedIdBefore);
  assert.equal(useEditorStore.getState().selectedWordIndex, selectedWordIndexBefore);
});

test("10b. multi-selection remains unchanged through play/pause/seek", () => {
  loadFixture();
  useEditorStore.getState().selectSubtitle("alfa");
  useEditorStore.getState().toggleSubtitleSelection("hotel");
  const selectedIdsBefore = useEditorStore.getState().selectedSubtitleIds;

  useEditorStore.getState().setPlaying(true);
  for (const t of [0, 5, 8, 10.4]) useEditorStore.getState().seek(t);
  useEditorStore.getState().setPlaying(false);

  assert.equal(useEditorStore.getState().selectedSubtitleIds, selectedIdsBefore, "selection set reference unchanged");
  assert.deepEqual([...useEditorStore.getState().selectedSubtitleIds].sort(), ["alfa", "hotel"]);
});

test("12. non-monotonic words remain unchanged (exact timestamps) through scrubbing across every word boundary", () => {
  loadFixture();
  const wordsBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "nonmono")!.words;

  // Scrub across BRAVO/CHARLIE/DELTA's boundaries in both directions — a scrub never touches
  // word timing, and this also proves the earlier caption-boundary/word-boundary values (click-
  // to-seek.test.ts items 19/20) correspond to real, unmutated data here in the store.
  for (const t of [2.0, 3.0, 3.5, 4.5, 5.0, 6.0, 4.5, 3.5, 2.0]) useEditorStore.getState().seek(t);

  const wordsAfter = useEditorStore.getState().project!.subtitles.find((s) => s.id === "nonmono")!.words;
  assert.equal(wordsAfter, wordsBefore, "words array reference unchanged");
  assert.equal(wordsAfter[0].start, 2.0);
  assert.equal(wordsAfter[1].start, 5.0, "DELTA's own timestamp, array index 1");
  assert.equal(wordsAfter[2].start, 3.5, "CHARLIE's own timestamp, array index 2 — never inferred from position");
  assert.equal(wordsAfter[2].end, 4.5);
});

test("[REGRESSION] full playback/scrub sequence never touches project, subtitles, words, selection, undo history, or dirty state", () => {
  loadFixture();
  useEditorStore.getState().selectSubtitle("nonmono");
  useEditorStore.getState().selectWord(2);
  const before = useEditorStore.getState();
  const projectBefore = before.project;
  const subtitlesBefore = before.project!.subtitles;
  const wordsBefore = before.project!.subtitles[1].words;
  const pastBefore = before.past;
  const dirtyBefore = before.dirty;
  const selectedIdBefore = before.selectedSubtitleId;
  const selectedWordIndexBefore = before.selectedWordIndex;

  // A realistic session: play, scrub while "playing", pause, click-to-seek at exact boundaries.
  useEditorStore.getState().setPlaying(true);
  for (const t of [0, 0.5, 1.75, 2, 3.5, 4.5, 5, 6, 7, 10.4, 12]) useEditorStore.getState().seek(t);
  useEditorStore.getState().setPlaying(false);
  useEditorStore.getState().seek(0);

  const after = useEditorStore.getState();
  assert.equal(after.project, projectBefore, "project object reference unchanged");
  assert.equal(after.project!.subtitles, subtitlesBefore, "subtitles array reference unchanged");
  assert.equal(after.project!.subtitles[1].words, wordsBefore, "words array reference unchanged");
  assert.equal(after.past, pastBefore, "undo history (past stack) reference unchanged — zero new entries");
  assert.equal(after.dirty, dirtyBefore, "dirty flag unchanged — no autosave was ever triggered");
  assert.equal(after.selectedSubtitleId, selectedIdBefore, "selection unchanged");
  assert.equal(after.selectedWordIndex, selectedWordIndexBefore, "word selection unchanged");
});
