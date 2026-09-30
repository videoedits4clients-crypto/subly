/**
 * Store-level tests for word-level SPLIT/MERGE/DELETE (Task 102741, P15) — exercises the REAL
 * editor store, verifying: one commit (one undo step) per operation, redo, the `dirty` flag
 * autosave watches, quality-report staleness, selected-word-state adjustment, and that these
 * operations correctly interact with caption `.text` (kept in sync via the same `breakIntoLines`
 * reflow splitSubtitleAt/mergeWithNext already use) so `isWordTimingStale` reads them as fresh,
 * not stale, immediately afterward.
 *
 * Run with: node --test src/store/__tests__/editor-store-word-edit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality } from "../../lib/subtitles/quality-analyzer.ts";
import { isWordTimingStale } from "../../lib/subtitles/word-timing.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 1,
      text: "hello world",
      words: [
        { text: "hello", start: 0, end: 0.5, confidence: 0.9 },
        { text: "world", start: 0.5, end: 1, confidence: 0.8 },
      ],
    },
    {
      id: "b",
      index: 1,
      start: 1,
      end: 2,
      text: "this is subly",
      words: [
        { text: "this", start: 1, end: 1.3 },
        { text: "is", start: 1.3, end: 1.6 },
        { text: "subly", start: 1.6, end: 2 },
      ],
    },
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

// ============================== splitWord ==============================

test("splitWord: divides the word, keeps caption text/words in sync (not stale), one commit", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.splitWord("a", 0, "hel", "lo");
  assert.equal(ok, true);

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1, "one commit");
  const a = after.project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["hel", "lo", "world"]);
  assert.equal(a.text, "hel lo world");
  assert.equal(isWordTimingStale(a), false, "words.length must match the caption's own new token count");
  assert.equal(a.words[0].start, 0);
  assert.ok(Math.abs(a.words[0].end - 0.3) < 1e-9);
  assert.ok(Math.abs(a.words[1].start - 0.3) < 1e-9);
  assert.equal(a.words[1].end, 0.5);
  assert.equal(a.words[2].start, 0.5, "the untouched neighbor word must be completely unaffected");
});

test("splitWord: rejects (no commit) an infeasible split", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.splitWord("a", 0, "", "hello");
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore, "an infeasible split must make no commit at all");
});

test("splitWord: sets dirty (autosave watches this)", () => {
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().splitWord("a", 0, "hel", "lo");
  assert.equal(useEditorStore.getState().dirty, true);
});

test("splitWord: undo restores the exact original word and text, redo re-applies the split", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words;
  store.splitWord("a", 0, "hel", "lo");
  useEditorStore.getState().undo();
  const afterUndo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(afterUndo.words, originalWords);
  assert.equal(afterUndo.text, "hello world");

  useEditorStore.getState().redo();
  const afterRedo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(afterRedo.words.map((w) => w.text), ["hel", "lo", "world"]);
});

test("splitWord: leaves the quality report exactly as-is but marks it stale via the existing derivation", () => {
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const reportBefore = useEditorStore.getState().qualityReport;
  store.splitWord("a", 0, "hel", "lo");
  const after = useEditorStore.getState();
  assert.equal(after.qualityReport, reportBefore, "no silent re-analysis");
  assert.notEqual(after.project!.subtitles, after.qualityReportSubtitles, "subtitles reference changed -> stale via isQualityReportStale");
});

test("splitWord: keeps the selection on the LEFT half (same index the original word occupied)", () => {
  const store = useEditorStore.getState();
  store.selectSubtitle("a");
  store.selectWord(0);
  store.splitWord("a", 0, "hel", "lo");
  assert.equal(useEditorStore.getState().selectedWordIndex, 0);
});

// ============================== mergeWordWithNext ==============================

test("mergeWordWithNext: joins the two words, keeps caption text in sync, one commit", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.mergeWordWithNext("b", 0); // "this" + "is"
  assert.equal(ok, true);

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1);
  const b = after.project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.words.map((w) => w.text), ["this is", "subly"]);
  assert.equal(b.text, "this is subly");
  assert.equal(isWordTimingStale(b), false);
  assert.equal(b.words[0].start, 1);
  assert.equal(b.words[0].end, 1.6, "spans the full original range of both merged words");
});

test("mergeWordWithNext: rejects (no commit, returns false) when there is no next word", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.mergeWordWithNext("b", 2); // "subly" — the last word
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("mergeWordWithNext: Task 118943 (P18.10) — rejects (no commit) a merge that would silently swallow a third, chronologically-between word after a P18.6 reorder", () => {
  // Array order: BRAVO[2,3], DELTA[5,6], CHARLIE[3.5,4.5] — the exact P18.6 reorder reproduction.
  // Merging BRAVO (index 0) with its array-next DELTA (index 1) would span [2,6], entirely
  // swallowing CHARLIE's real [3.5,4.5], which remains a separate word in the array.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "s1",
          index: 0,
          start: 1.75,
          end: 6.0,
          text: "bravo delta charlie",
          words: [{ text: "BRAVO", start: 2, end: 3 }, { text: "DELTA", start: 5, end: 6 }, { text: "CHARLIE", start: 3.5, end: 4.5 }],
        },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().mergeWordWithNext("s1", 0);
  assert.equal(ok, false);
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(after, before, "rejected merge: the caption keeps its exact prior object reference");
  assert.deepEqual(after.words.map((w) => w.text), ["BRAVO", "DELTA", "CHARLIE"], "no word touched or reordered");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no history entry for a rejected merge");
});

test("mergeWordWithNext: Task 118943 (P18.10) — a merge between two words with NOTHING chronologically between them still succeeds after a reorder", () => {
  // Array order: BRAVO[2,3], DELTA[5,6], CHARLIE[3.5,4.5]. Merging DELTA (index 1) with its
  // array-next CHARLIE (index 2) spans [3.5,6] — nothing else occupies that range, so this must
  // succeed even though DELTA/CHARLIE are only textually, not chronologically, adjacent.
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "s1",
          index: 0,
          start: 1.75,
          end: 6.0,
          text: "bravo delta charlie",
          words: [{ text: "BRAVO", start: 2, end: 3 }, { text: "DELTA", start: 5, end: 6 }, { text: "CHARLIE", start: 3.5, end: 4.5 }],
        },
      ],
    }),
  );
  const ok = useEditorStore.getState().mergeWordWithNext("s1", 1);
  assert.equal(ok, true);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.words.map((w) => w.text), ["BRAVO", "DELTA CHARLIE"]);
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [3.5, 6], "spans the true min/max of both real timestamps");
});

test("mergeWordWithNext: never fabricates confidence on the merged word", () => {
  const store = useEditorStore.getState();
  store.mergeWordWithNext("a", 0); // "hello" (0.9) + "world" (0.8)
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, undefined);
});

test("mergeWordWithNext: undo restores the exact two original words, redo re-merges", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[1].words;
  store.mergeWordWithNext("b", 0);
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words, originalWords);
  useEditorStore.getState().redo();
  assert.deepEqual(
    useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words.map((w) => w.text),
    ["this is", "subly"],
  );
});

test("mergeWordWithNext: keeps the selection at the merged word's own index", () => {
  const store = useEditorStore.getState();
  store.selectSubtitle("b");
  store.selectWord(0);
  store.mergeWordWithNext("b", 0);
  assert.equal(useEditorStore.getState().selectedWordIndex, 0);
});

// ============================== deleteWord ==============================

test("deleteWord: removes the word, collapses the gap, keeps caption text in sync, one commit", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  store.deleteWord("b", 1); // "is"
  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1);
  const b = after.project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.words.map((w) => w.text), ["this", "subly"]);
  assert.equal(b.text, "this subly");
  assert.equal(isWordTimingStale(b), false);
  assert.equal(b.words[0].end, 1.6, "the previous word must absorb the deleted word's own end");
});

test("deleteWord: deleting a caption's ONLY word empties it — the existing EMPTY_CAPTION check flags it, not deleted", () => {
  const store = useEditorStore.getState();
  // Trim caption 'a' down to one word first via a merge, then delete the remaining word.
  store.mergeWordWithNext("a", 0);
  store.deleteWord("a", 0);
  const after = useEditorStore.getState();
  const a = after.project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "");
  assert.deepEqual(a.words, []);
  assert.equal(after.project!.subtitles.length, 2, "the caption itself must still exist");
  const report = analyzeSubtitleQuality(after.project!.subtitles, after.project!.timingRules);
  const issue = report.issues.find((i) => i.captionId === "a");
  assert.ok(issue);
  assert.equal(issue!.type, "EMPTY_CAPTION");
});

test("deleteWord: undo restores the exact original words, redo re-deletes", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[1].words;
  store.deleteWord("b", 1);
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words, originalWords);
  useEditorStore.getState().redo();
  assert.deepEqual(
    useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words.map((w) => w.text),
    ["this", "subly"],
  );
});

test("deleteWord: clamps the selected word index into range after a deletion at the end", () => {
  const store = useEditorStore.getState();
  store.selectSubtitle("b");
  store.selectWord(2); // "subly", the last word
  store.deleteWord("b", 2);
  assert.equal(useEditorStore.getState().selectedWordIndex, 1, "clamped to the new last valid index");
});

test("deleteWord: clears the selected word index when the caption ends up with zero words", () => {
  const store = useEditorStore.getState();
  store.mergeWordWithNext("a", 0);
  store.selectSubtitle("a");
  store.selectWord(0);
  store.deleteWord("a", 0);
  assert.equal(useEditorStore.getState().selectedWordIndex, null);
});

test("deleteWord: no-op (no commit) for an out-of-range index", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  store.deleteWord("a", 99);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

// ============================== insertWord (Task 103884, P16) ==============================
// A fixture distinct from the split/merge/delete one above: those words touch edge-to-edge (no
// gap between them, and the first/last word sits exactly on the caption boundary), which is
// realistic for split/merge/delete but leaves NO room to insert anything — every insertion needs
// an actual gap to claim. This fixture gives each caption real gaps: before its first word, after
// its last word, and between two of its interior words (and, separately, one pair of touching
// words to exercise the "no gap -> reject" path).

function fixtureProjectForInsertion(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 2,
      text: "hello world",
      // gap before "hello": 0 -> 0.5 (0.5s); "hello"/"world" touch (0.5s→1s, 1s→1.5s, no gap);
      // gap after "world": 1.5 -> 2 (0.5s).
      words: [
        { text: "hello", start: 0.5, end: 1 },
        { text: "world", start: 1, end: 1.5 },
      ],
    },
    {
      id: "b",
      index: 1,
      start: 2,
      end: 4,
      text: "this is subly",
      // gap between "is" and "subly": 2.6 -> 2.8 (0.2s, comfortably above MIN_WORD_DURATION_SEC).
      words: [
        { text: "this", start: 2, end: 2.3 },
        { text: "is", start: 2.3, end: 2.6 },
        { text: "subly", start: 2.8, end: 3.1 },
      ],
    },
  ];
  return {
    id: "p1",
    name: "Fixture project (insertion)",
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

test("insertWord: 'before' the first word claims the gap to the caption's own start, one commit", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.insertWord("a", 0, "before", "well");
  assert.equal(ok, true);

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1, "one commit");
  const a = after.project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["well", "hello", "world"]);
  assert.equal(a.words[0].start, 0);
  assert.equal(a.words[0].end, 0.5);
  assert.equal(a.text, "well hello world", "caption .text regenerated via the SAME breakIntoLines reflow split/merge/delete already use");
  assert.equal(isWordTimingStale(a), false, "words.length must match the new token count immediately");
});

test("insertWord: 'after' the last word claims the gap to the caption's own end", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const ok = store.insertWord("a", 1, "after", "again");
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["hello", "world", "again"]);
  assert.equal(a.words[2].start, 1.5);
  assert.equal(a.words[2].end, 2);
  assert.equal(a.text, "hello world again");
});

test("insertWord: inserts into a real gap between two interior words, claiming the whole gap", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const ok = store.insertWord("b", 1, "after", "not"); // between "is" (end 2.6) and "subly" (start 2.8)
  assert.equal(ok, true);
  const b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.words.map((w) => w.text), ["this", "is", "not", "subly"]);
  assert.equal(b.words[2].start, 2.6);
  assert.equal(b.words[2].end, 2.8);
  assert.equal(b.text, "this is not subly");
});

test("insertWord: rejects (no commit) when the adjacent words touch with no gap", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.insertWord("a", 0, "after", "x"); // "hello" and "world" touch — zero gap
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore, "an infeasible insertion must make no commit at all");
});

test("insertWord: rejects multi-token text (no commit)", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.insertWord("a", 0, "before", "very good");
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("insertWord: rejects whitespace-only text (no commit)", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const ok = store.insertWord("a", 0, "before", "   ");
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("insertWord: sets dirty (autosave watches this)", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().insertWord("a", 0, "before", "well");
  assert.equal(useEditorStore.getState().dirty, true);
});

test("insertWord: undo restores the exact original words, redo re-inserts", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words;
  store.insertWord("a", 0, "before", "well");
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.words, originalWords);
  useEditorStore.getState().redo();
  assert.deepEqual(
    useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.words.map((w) => w.text),
    ["well", "hello", "world"],
  );
});

test("insertWord: marks the quality report stale via the existing derivation, no silent re-analysis", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const reportBefore = useEditorStore.getState().qualityReport;
  store.insertWord("a", 0, "before", "well");
  const after = useEditorStore.getState();
  assert.equal(after.qualityReport, reportBefore, "no silent re-analysis");
  assert.notEqual(after.project!.subtitles, after.qualityReportSubtitles, "subtitles reference changed -> stale via isQualityReportStale");
});

test("insertWord: selection — inserting BEFORE the selected word moves selection to the new word's own index", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.selectSubtitle("a");
  store.selectWord(0); // "hello"
  store.insertWord("a", 0, "before", "well");
  assert.equal(useEditorStore.getState().selectedWordIndex, 0, "the newly inserted word, per this task's own Phase 6 rule");
});

test("insertWord: selection — inserting AFTER the selected word moves selection to selectedWordIndex + 1", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.selectSubtitle("a");
  store.selectWord(1); // "world"
  store.insertWord("a", 1, "after", "again");
  assert.equal(useEditorStore.getState().selectedWordIndex, 2, "selectedWordIndex + 1, per this task's own Phase 6 rule");
});

test("insertWord metadata policy: confidence/hinglishText/gujaratiScriptText undefined, removed explicitly false", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.insertWord("a", 0, "before", "well");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, undefined);
  assert.equal(a.words[0].hinglishText, undefined);
  assert.equal(a.words[0].gujaratiScriptText, undefined);
  assert.equal(a.words[0].removed, false);
});

test("insertWord: never creates overlap across the whole caption after insertion", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.insertWord("b", 1, "after", "not");
  const b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  for (let i = 1; i < b.words.length; i++) {
    assert.ok(b.words[i].start >= b.words[i - 1].end - 1e-9, `no overlap at index ${i}`);
  }
});

// ---- Phase 11: delete/insert/split/merge interaction, all still one undo step each ----

test("insertWord -> deleteWord: each is its own undo step, final state consistent", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  store.insertWord("a", 0, "before", "well");
  store.deleteWord("a", 0); // deletes "well" again
  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 2, "two separate commits, not merged into one");
  const a = after.project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["hello", "world"]);
  assert.equal(isWordTimingStale(a), false);
});

test("insertWord -> splitWord: inserted word can itself be split immediately afterward", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.insertWord("a", 0, "before", "wellwell");
  const ok = store.splitWord("a", 0, "well", "well");
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["well", "well", "hello", "world"]);
  assert.equal(isWordTimingStale(a), false);
});

test("insertWord -> mergeWordWithNext: inserted word can be merged with its neighbor", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.insertWord("a", 0, "before", "well");
  const ok = store.mergeWordWithNext("a", 0); // "well" + "hello"
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["well hello", "world"]);
  assert.equal(isWordTimingStale(a), false);
});

test("insertWord -> undo -> redo leaves selectedWordIndex and word timing fully consistent", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  store.selectSubtitle("a");
  store.selectWord(0);
  store.insertWord("a", 0, "before", "well");
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["well", "hello", "world"]);
  assert.equal(isWordTimingStale(a), false);
  for (let i = 1; i < a.words.length; i++) {
    assert.ok(a.words[i].start >= a.words[i - 1].end - 1e-9, `no overlap at index ${i} after undo/redo`);
  }
});

test("splitWord -> insertWord: a freshly split word's own new neighbor gap can immediately host an insertion", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  // Split "hello" (0.5-1) into "hel"/"lo" proportionally — leaves no gap between hel/lo, but the
  // gap before the caption's own first word (0 -> 0.5) is still there for a "before" insertion.
  store.splitWord("a", 0, "hel", "lo");
  const ok = store.insertWord("a", 0, "before", "well");
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["well", "hel", "lo", "world"]);
});

test("deleteWord -> insertWord: an unrelated gap survives a deletion elsewhere in the caption, and post-deletion indices resolve correctly", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const store = useEditorStore.getState();
  // Delete "is" from caption b: conservative deletion fully absorbs its span into "this" (this:
  // 2 -> 2.6, exactly "is"'s own former end — deleteWordConservative never leaves a leftover gap
  // of its own), which leaves the SEPARATE, pre-existing 2.6->2.8 gap in front of "subly" exactly
  // as it was. "subly" is now at index 1 (shifted down by the deletion) — insertion must resolve
  // against its NEW index, not its old one.
  store.deleteWord("b", 1);
  const ok = store.insertWord("b", 1, "before", "not"); // "subly" is now index 1
  assert.equal(ok, true);
  const b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.words.map((w) => w.text), ["this", "not", "subly"]);
  assert.equal(b.words[1].start, 2.6);
  assert.equal(b.words[1].end, 2.8);
});

// ============================== performance (Task 102741, P15 §12) ==============================
// A single-caption word operation still walks the whole `subtitles` array once (the SAME
// `snap.subtitles.map()` shape every existing per-caption mutation in this file already uses —
// updateWordTiming, updateSubtitleText, etc. — not a new cost P15 introduces), so this proves that
// existing, already-accepted cost stays fast at real project scale, at the sizes this task's own
// spec calls out (30/300/1,800/3,600/5,400 captions).

function buildLargeProject(captionCount: number): ProjectData {
  const subtitles: Subtitle[] = [];
  for (let i = 0; i < captionCount; i++) {
    const start = i * 2;
    subtitles.push({
      id: `s${i}`,
      index: i,
      start,
      end: start + 2,
      text: "hello world again",
      words: [
        { text: "hello", start, end: start + 0.6 },
        { text: "world", start: start + 0.6, end: start + 1.2 },
        { text: "again", start: start + 1.2, end: start + 2 },
      ],
    });
  }
  return {
    id: "big",
    name: "Large fixture",
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

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: split/merge/delete on a single caption stay fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeProject(captionCount));
    const targetId = `s${Math.floor(captionCount / 2)}`; // an arbitrary caption in the middle

    const start = performance.now();
    const splitOk = useEditorStore.getState().splitWord(targetId, 0, "hel", "lo");
    useEditorStore.getState().mergeWordWithNext(targetId, 0);
    useEditorStore.getState().deleteWord(targetId, 0);
    const elapsedMs = performance.now() - start;

    assert.equal(splitOk, true);
    assert.ok(elapsedMs < 300, `split+merge+delete on one caption took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 300ms`);
    assert.equal(useEditorStore.getState().project!.subtitles.length, captionCount, "no caption was added or removed by these word-level operations");
  });
}

// ============================== performance: insertWord (Task 103884, P16 §13) ==============================
// buildLargeProject's own words touch edge-to-edge with no gap (realistic for the split/merge/
// delete performance test above, which needs no gap), so this variant gives the target caption an
// actual insertable gap without changing the OTHER captionCount-1 captions' shape at all — same
// O(n) `snap.subtitles.map()` cost per commit, just with one caption able to accept an insertion.

function buildLargeProjectWithGap(captionCount: number, gapCaptionIndex: number): ProjectData {
  const project = buildLargeProject(captionCount);
  const target = project.subtitles[gapCaptionIndex];
  target.words = [
    { text: "hello", start: target.start + 0.2, end: target.start + 0.6 },
    { text: "world", start: target.start + 1.2, end: target.start + 1.6 },
  ];
  return project;
}

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: insertWord on a single caption stays fast at ${captionCount} total captions`, () => {
    const targetIndex = Math.floor(captionCount / 2);
    useEditorStore.getState().load(buildLargeProjectWithGap(captionCount, targetIndex));
    const targetId = `s${targetIndex}`;

    const start = performance.now();
    const ok = useEditorStore.getState().insertWord(targetId, 0, "after", "there"); // 0.6 -> 1.2 gap
    const elapsedMs = performance.now() - start;

    assert.equal(ok, true);
    assert.ok(elapsedMs < 150, `insertWord on one caption took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);
    assert.equal(useEditorStore.getState().project!.subtitles.length, captionCount, "no caption was added or removed by this word-level operation");
  });
}

// ============================== performance: updateSubtitleText's per-word metadata remap (Task 108762, P18.1) ==============================
// remapWordMetadataForTextReplacement adds one extra string-equality comparison per word of the
// EDITED caption only (still the same single `snap.subtitles.map()` pass over the whole project
// every text mutation already made before this task) — proves the P18.1 fix introduces no new
// per-project cost, only a trivial constant addition to the one caption actually being edited.

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: updateSubtitleText (with the new per-word metadata remap) stays fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeProject(captionCount));
    const targetId = `s${Math.floor(captionCount / 2)}`;

    const start = performance.now();
    // 3 tokens -> 3 tokens: exercises the metadata-remap path (one word genuinely changes, two don't).
    useEditorStore.getState().updateSubtitleText(targetId, "hi world again");
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 150, `updateSubtitleText took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);
    const target = useEditorStore.getState().project!.subtitles.find((s) => s.id === targetId)!;
    assert.equal(target.words[0].text, "hi");
    assert.equal(target.words[1].text, "world");
    assert.equal(target.words[2].text, "again");
  });
}

// ============================== functional variety (Task 103884, P16 §13) ==============================

test("insertWord: works on a caption with only ONE existing word (insert both before and after it)", () => {
  useEditorStore.getState().load(
    fixtureProjectForInsertion({
      subtitles: [{ id: "a", index: 0, start: 0, end: 1, text: "hello", words: [{ text: "hello", start: 0.3, end: 0.7 }] }],
    }),
  );
  const before = useEditorStore.getState().insertWord("a", 0, "before", "well");
  assert.equal(before, true);
  let a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["well", "hello"]);

  const after = useEditorStore.getState().insertWord("a", 1, "after", "there");
  assert.equal(after, true);
  a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["well", "hello", "there"]);
});

test("insertWord: Hindi/Devanagari word text is preserved exactly, including combining marks", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const ok = useEditorStore.getState().insertWord("a", 0, "before", "नमस्ते");
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "नमस्ते");
  assert.equal(a.text, "नमस्ते hello world");
});

test("insertWord: Gujarati-script word text is preserved exactly", () => {
  useEditorStore.getState().load(fixtureProjectForInsertion());
  const ok = useEditorStore.getState().insertWord("a", 0, "before", "નમસ્તે");
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "નમસ્તે");
});

test("insertWord: a caption whose word timing was ALREADY stale before insertion is no worse afterward (insertion doesn't fix or compound pre-existing staleness of untouched captions)", () => {
  useEditorStore.getState().load(
    fixtureProjectForInsertion({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "hello world", words: [{ text: "hello", start: 0.5, end: 1 }, { text: "world", start: 1, end: 1.5 }] },
        // caption "b" has 3 text tokens but only 2 words (missing "is" entirely) — deliberately
        // stale, untouched by this insertion.
        { id: "b", index: 1, start: 2, end: 4, text: "this is subly", words: [{ text: "this", start: 2, end: 2.6 }, { text: "subly", start: 2.8, end: 3.1 }] },
      ],
    }),
  );
  useEditorStore.getState().insertWord("a", 0, "before", "well");
  const b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(isWordTimingStale(b), true, "caption b's own pre-existing staleness must be completely unaffected by an insertion in a different caption");
});

// ============================== Task 108762 (P18.1) — word metadata integrity on direct text edits ==============================
// Store-level regression matrix for the exact P18 preflight-audit finding: a same-token-count
// updateSubtitleText edit used to carry OLD confidence onto completely DIFFERENT replacement text.
// fixtureProject()'s caption "a" is literally "hello world" with confidence 0.9/0.8 — the same
// worked example from the task's own source finding.

test("4. token-count INCREASE: words array stays completely untouched (pre-existing behavior, unaffected by the P18.1 fix) — confidence stays exactly where it was", () => {
  useEditorStore.getState().load(fixtureProject());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.words;
  useEditorStore.getState().updateSubtitleText("a", "hello there world");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words, before, "word count changed -> words[] left completely untouched, per the existing P7.2 rule");
  assert.equal(a.words[0].confidence, 0.9, "unaffected by this task — the count-mismatch branch never reaches remapWordMetadataForTextReplacement");
});

test("5. token-count DECREASE: words array stays completely untouched, same as an increase", () => {
  useEditorStore.getState().load(fixtureProject());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!.words;
  useEditorStore.getState().updateSubtitleText("a", "hello");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words, before);
  assert.equal(a.words[0].confidence, 0.9);
});

test("updateSubtitleText: same token count, ONE word's text actually changed -> only that word loses confidence, the other keeps its own", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().updateSubtitleText("a", "hi world");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "hi");
  assert.equal(a.words[0].confidence, undefined, "'hello'->'hi' is different text — confidence must not survive");
  assert.equal(a.words[1].text, "world");
  assert.equal(a.words[1].confidence, 0.8, "'world'->'world' is unchanged — confidence must survive");
  assert.equal(a.words[0].start, 0, "timing untouched regardless of confidence outcome");
  assert.equal(a.words[1].end, 1);
});

test("updateSubtitleText: same token count, text IDENTICAL to what it already was -> a genuine no-op for every word, confidence fully intact", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().updateSubtitleText("a", "hello world");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, 0.9);
  assert.equal(a.words[1].confidence, 0.8);
});

test("13/14/15. split/merge/delete are UNAFFECTED by the P18.1 fix — each keeps its own pre-existing, already-correct confidence policy", () => {
  useEditorStore.getState().load(fixtureProject());
  // split: confidence never fabricated for either new half (pre-existing word-edit.ts policy).
  useEditorStore.getState().splitWord("a", 0, "he", "llo");
  let a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, undefined);
  assert.equal(a.words[1].confidence, undefined);
  useEditorStore.getState().undo();

  // merge: confidence dropped (pre-existing policy — two possibly-different measured values, never averaged/picked).
  useEditorStore.getState().mergeWordWithNext("a", 0);
  a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, undefined);
  useEditorStore.getState().undo();

  // delete: the SURVIVING word's confidence is completely untouched.
  useEditorStore.getState().deleteWord("a", 1);
  a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words.length, 1);
  assert.equal(a.words[0].confidence, 0.9, "deleteWordConservative never touches a survivor's own fields");
  useEditorStore.getState().undo();
});

test("16. insert is UNAFFECTED by the P18.1 fix — never fabricates confidence for the new word, and an unrelated existing word's confidence is untouched", () => {
  // fixtureProject()'s caption "a" has zero timing gaps anywhere (words are perfectly
  // contiguous, 0-0.5 / 0.5-1, flush with the caption's own 0-1 bounds) — no room to insert
  // anywhere in it. Reuses fixtureProjectForInsertion's own gapped caption instead, with
  // confidence added to its words so this check can verify the SAME "unrelated confidence
  // untouched" property this task cares about, in a caption where insertWord can actually succeed.
  const base = fixtureProjectForInsertion();
  const withConfidence: ProjectData = {
    ...base,
    subtitles: base.subtitles.map((s) => (s.id === "a" ? { ...s, words: s.words.map((w) => ({ ...w, confidence: 0.9 })) } : s)),
  };
  useEditorStore.getState().load(withConfidence);
  const ok = useEditorStore.getState().insertWord("a", 0, "before", "well");
  assert.equal(ok, true, "this fixture's caption \"a\" has a real 0.5s gap before its first word");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "well");
  assert.equal(a.words[0].confidence, undefined, "never fabricated for the new word");
  assert.equal(a.words[1].confidence, 0.9, "the pre-existing 'hello' word's own confidence is untouched by an unrelated insertion");
});

test("17/18. undo/redo restore the exact confidence outcome of a direct text-replacement edit", () => {
  useEditorStore.getState().load(fixtureProject());
  useEditorStore.getState().updateSubtitleText("a", "hi world");
  let a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, undefined);
  assert.equal(a.words[1].confidence, 0.8);

  useEditorStore.getState().undo();
  a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "hello");
  assert.equal(a.words[0].confidence, 0.9, "undo restores the exact pre-edit confidence, not just the text");

  useEditorStore.getState().redo();
  a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "hi");
  assert.equal(a.words[0].confidence, undefined, "redo re-applies the exact same cleared confidence, not a freshly recomputed one");
});

// ============================== performance: setWordStyleOverride (Task 110184, P18.3) ==============================
// setWordStyleOverride itself was NOT modified by P18.3 — only new UI plumbing was added to call
// it (WordTimingPopover's Bold toggle) — but this is the first task to actually exercise it at
// scale, and Phase I explicitly requires proving it stays O(1) relative to unrelated captions
// (same `snap.subtitles.map()` pass every other word-mutation action already makes) and that
// P18.2's memoization guarantee — an untouched caption keeps the EXACT SAME object reference
// across a commit — holds for this action too, not just the ones P18.2 itself touched.

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: setWordStyleOverride on a single word stays fast at ${captionCount} total captions, and leaves every OTHER caption's object reference unchanged`, () => {
    useEditorStore.getState().load(buildLargeProject(captionCount));
    const targetIndex = Math.floor(captionCount / 2);
    const targetId = `s${targetIndex}`;
    const before = useEditorStore.getState().project!.subtitles;

    const start = performance.now();
    useEditorStore.getState().setWordStyleOverride(targetId, 0, { fontWeight: 700 });
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 150, `setWordStyleOverride took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);

    const after = useEditorStore.getState().project!.subtitles;
    assert.equal(after.length, captionCount, "no caption was added or removed");
    assert.equal(after[targetIndex].words[0].style?.fontWeight, 700, "the targeted word's override was actually applied");
    // The P18.2 memoization contract this whole task must not undo: CaptionRow's React.memo
    // boundary (and TimelineCaptionBlock's) relies on an untouched caption's Subtitle object
    // being the SAME reference after a commit, not just deep-equal — a fresh object for every
    // caption would defeat the shallow prop comparison and re-render the whole visible list.
    for (let i = 0; i < captionCount; i++) {
      if (i === targetIndex) continue;
      assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference — only the targeted caption should be a new object`);
    }
  });
}
