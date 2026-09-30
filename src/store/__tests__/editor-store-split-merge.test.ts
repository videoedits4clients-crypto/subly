/**
 * Store-level tests for Split/Merge caption hardening (Task 114761, P18.7) — exercises the REAL
 * editor store: one commit (one undo step) per successful operation, undo/redo, the `dirty` flag
 * autosave watches, quality-report staleness, selectedWordIndex safety, non-monotonic (P18.6)
 * word order through the real store, interaction with Ripple Delete/Insert (P18.5), and — for
 * P18.2 — reference stability at scale.
 *
 * Run with: node --test src/store/__tests__/editor-store-split-merge.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality, isQualityReportStale } from "../../lib/subtitles/quality-analyzer.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 2,
      text: "one two",
      words: [
        { text: "one", start: 0, end: 1, confidence: 0.9 },
        { text: "two", start: 1, end: 2, confidence: 0.8, style: { fontWeight: 700 } },
      ],
    },
    { id: "b", index: 1, start: 3, end: 4, text: "three", words: [{ text: "three", start: 3, end: 4, confidence: 0.7 }] },
    { id: "c", index: 2, start: 5, end: 6, text: "four", words: [{ text: "four", start: 5, end: 6 }] },
  ];
  return {
    id: "p1",
    name: "Split/merge fixture",
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

// ============================== splitSubtitleAtTime ==============================

test("splitSubtitleAtTime: splits at the exact word boundary, one commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().splitSubtitleAtTime("a", 1); // between "one" and "two"
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1);
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 4);
  const left = subs.find((s) => s.id === "a")!;
  assert.deepEqual(left.words.map((w) => w.text), ["one"]);
  const right = subs.find((s) => s.text === "two")!;
  assert.deepEqual(right.words.map((w) => w.text), ["two"]);
});

test("splitSubtitleAtTime: preserves confidence and style on both halves", () => {
  useEditorStore.getState().splitSubtitleAtTime("a", 1);
  const subs = useEditorStore.getState().project!.subtitles;
  const left = subs.find((s) => s.id === "a")!;
  const right = subs.find((s) => s.text === "two")!;
  assert.equal(left.words[0].confidence, 0.9);
  assert.equal(right.words[0].confidence, 0.8);
  assert.deepEqual(right.words[0].style, { fontWeight: 700 });
});

test("splitSubtitleAtTime: rejects a word-straddling split, no commit, no toast-worthy partial mutation", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().splitSubtitleAtTime("a", 0.5); // inside "one"
  assert.equal(result, "word-straddles-split");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
  assert.equal(useEditorStore.getState().project!.subtitles.length, 3);
});

test("splitSubtitleAtTime: rejects an unknown subtitle id", () => {
  assert.equal(useEditorStore.getState().splitSubtitleAtTime("ghost", 1), "not-found");
});

test("splitSubtitleAtTime: undo restores the exact original caption, redo re-splits it", () => {
  useEditorStore.getState().splitSubtitleAtTime("a", 1);
  useEditorStore.getState().undo();
  let subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 3);
  assert.deepEqual(subs.find((s) => s.id === "a")!.words.map((w) => w.text), ["one", "two"]);

  useEditorStore.getState().redo();
  subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 4);
});

test("splitSubtitleAtTime: sets dirty on success", () => {
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().splitSubtitleAtTime("a", 1);
  assert.equal(useEditorStore.getState().dirty, true);
});

test("splitSubtitleAtTime: marks an existing quality report stale via the normal reference mechanism", () => {
  const project = useEditorStore.getState().project!;
  const report = analyzeSubtitleQuality(project.subtitles, project.timingRules);
  useEditorStore.setState({ qualityReport: report, qualityReportSubtitles: project.subtitles });
  useEditorStore.getState().splitSubtitleAtTime("a", 1);
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles), true);
});

test("Task 114761 (P18.7): splitSubtitleAtTime keeps the exact object reference of every caption BEFORE the split point (P18.2 memoization)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "z", index: 0, start: 0, end: 1, text: "zero", words: [{ text: "zero", start: 0, end: 1 }] },
        {
          id: "a",
          index: 1,
          start: 2,
          end: 4,
          text: "one two",
          words: [{ text: "one", start: 2, end: 3 }, { text: "two", start: 3, end: 4 }],
        },
      ],
    }),
  );
  const beforeZ = useEditorStore.getState().project!.subtitles.find((s) => s.id === "z")!;
  useEditorStore.getState().splitSubtitleAtTime("a", 3);
  const afterZ = useEditorStore.getState().project!.subtitles.find((s) => s.id === "z")!;
  assert.equal(afterZ, beforeZ, "a caption entirely before the split point keeps its exact reference");
});

test("Task 114761 (P18.7): a caption AFTER the split point correctly gets a new object (its own index legitimately shifts), never silently kept stale", () => {
  useEditorStore.getState().splitSubtitleAtTime("a", 1);
  const c = useEditorStore.getState().project!.subtitles.find((s) => s.id === "c")!;
  assert.equal(c.index, 3, "index correctly shifted from 2 to 3 to make room for the split's new right half");
});

test("Task 114761 (P18.7): a selectedWordIndex that ends up on the RIGHT half is cleared, not left dangling out of bounds on the LEFT half", () => {
  useEditorStore.getState().selectSubtitle("a");
  useEditorStore.getState().selectWord(1); // "two" — will end up on the RIGHT half
  useEditorStore.getState().splitSubtitleAtTime("a", 1);
  assert.equal(useEditorStore.getState().selectedSubtitleId, "a", "the left half keeps the original id and stays focused");
  assert.equal(useEditorStore.getState().selectedWordIndex, null, "the stale word index (now out of bounds for the shrunk left half) must be cleared, not left dangling");
});

test("Task 114761 (P18.7): a selectedWordIndex that stays on the LEFT half remains valid and untouched", () => {
  useEditorStore.getState().selectSubtitle("a");
  useEditorStore.getState().selectWord(0); // "one" — stays on the LEFT half
  useEditorStore.getState().splitSubtitleAtTime("a", 1);
  assert.equal(useEditorStore.getState().selectedWordIndex, 0, "still valid for the left half's own (shorter) word array — must not be cleared unnecessarily");
});

// ============================== mergeWithNext ==============================

test("mergeWithNext: merges with the next caption, preserving each side's own word order, one commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().mergeWithNext("a");
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1);
  const subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 2);
  const merged = subs.find((s) => s.id === "a")!;
  assert.deepEqual(merged.words.map((w) => w.text), ["one", "two", "three"]);
  assert.equal(merged.start, 0);
  assert.equal(merged.end, 4);
});

test("mergeWithNext: preserves the pre-existing gap between the two captions (words concatenated, not redistributed)", () => {
  useEditorStore.getState().mergeWithNext("a"); // a ends at 2, b starts at 3 — 1s gap
  const merged = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(merged.words[1].end, 2, "'two' keeps its own end");
  assert.equal(merged.words[2].start, 3, "'three' keeps its own start — the gap survives");
});

test("mergeWithNext: preserves confidence and style on every merged word", () => {
  useEditorStore.getState().mergeWithNext("a");
  const merged = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(merged.words[0].confidence, 0.9);
  assert.deepEqual(merged.words[1].style, { fontWeight: 700 });
  assert.equal(merged.words[2].confidence, 0.7);
});

test("mergeWithNext: rejects merging the last caption (no next caption), no commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().mergeWithNext("c");
  assert.equal(result, "no-next-caption");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("mergeWithNext: rejects an unknown subtitle id", () => {
  assert.equal(useEditorStore.getState().mergeWithNext("ghost"), "not-found");
});

test("mergeWithNext: undo restores the exact original two captions, redo re-merges", () => {
  useEditorStore.getState().mergeWithNext("a");
  useEditorStore.getState().undo();
  let subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 3);
  assert.deepEqual(subs.find((s) => s.id === "a")!.words.map((w) => w.text), ["one", "two"]);
  assert.deepEqual(subs.find((s) => s.id === "b")!.words.map((w) => w.text), ["three"]);

  useEditorStore.getState().redo();
  subs = useEditorStore.getState().project!.subtitles;
  assert.equal(subs.length, 2);
});

test("mergeWithNext: sets dirty on success", () => {
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().mergeWithNext("a");
  assert.equal(useEditorStore.getState().dirty, true);
});

test("mergeWithNext: marks an existing quality report stale via the normal reference mechanism", () => {
  const project = useEditorStore.getState().project!;
  const report = analyzeSubtitleQuality(project.subtitles, project.timingRules);
  useEditorStore.setState({ qualityReport: report, qualityReportSubtitles: project.subtitles });
  useEditorStore.getState().mergeWithNext("a");
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles), true);
});

test("Task 114761 (P18.7): mergeWithNext keeps the exact object reference of every caption BEFORE the merge point (P18.2 memoization)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "z", index: 0, start: 0, end: 1, text: "zero", words: [{ text: "zero", start: 0, end: 1 }] },
        { id: "a", index: 1, start: 2, end: 3, text: "one", words: [{ text: "one", start: 2, end: 3 }] },
        { id: "b", index: 2, start: 4, end: 5, text: "two", words: [{ text: "two", start: 4, end: 5 }] },
      ],
    }),
  );
  const beforeZ = useEditorStore.getState().project!.subtitles.find((s) => s.id === "z")!;
  useEditorStore.getState().mergeWithNext("a");
  const afterZ = useEditorStore.getState().project!.subtitles.find((s) => s.id === "z")!;
  assert.equal(afterZ, beforeZ, "a caption entirely before the merge point keeps its exact reference");
});

test("Task 114761 (P18.7): a caption AFTER the merge point correctly gets a new object (its own index legitimately shifts down), never silently kept stale", () => {
  useEditorStore.getState().mergeWithNext("a");
  const c = useEditorStore.getState().project!.subtitles.find((s) => s.id === "c")!;
  assert.equal(c.index, 1, "index correctly shifted from 2 to 1 after the merge removed one caption before it");
});

test("mergeWithNext: selectedWordIndex on the surviving (a) caption remains valid — merge only appends, never shrinks", () => {
  useEditorStore.getState().selectSubtitle("a");
  useEditorStore.getState().selectWord(1); // "two"
  useEditorStore.getState().mergeWithNext("a");
  assert.equal(useEditorStore.getState().selectedWordIndex, 1, "still points at 'two', now inside the longer merged array");
});

// ============================== Task 114761: non-monotonic word order (P18.6) through the real store ==============================

test("P18.7: split correctly partitions a NON-MONOTONIC caption by actual timestamp, not array position", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "nm",
          index: 0,
          start: 0.5,
          end: 6,
          text: "BRAVO CHARLIE DELTA ALFA",
          words: [
            { text: "BRAVO", start: 2, end: 3 },
            { text: "CHARLIE", start: 3.5, end: 4.5 },
            { text: "DELTA", start: 5, end: 6 },
            { text: "ALFA", start: 0.5, end: 1.5 },
          ],
        },
      ],
    }),
  );
  const result = useEditorStore.getState().splitSubtitleAtTime("nm", 1.75); // separates ALFA (0.5-1.5) from the rest
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  const left = subs.find((s) => s.id === "nm")!;
  const right = subs.find((s) => s.text.includes("BRAVO"))!;
  assert.deepEqual(left.words.map((w) => w.text), ["ALFA"], "chronologically-earliest word, despite being textually LAST in the array");
  assert.deepEqual(right.words.map((w) => w.text), ["BRAVO", "CHARLIE", "DELTA"], "existing relative order preserved, not re-sorted");
});

test("P18.7: merge preserves non-monotonic order on both sides without re-sorting or corrupting timing", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "x", index: 0, start: 2, end: 4.5, text: "CHARLIE BRAVO", words: [{ text: "CHARLIE", start: 3.5, end: 4.5 }, { text: "BRAVO", start: 2, end: 3 }] },
        { id: "y", index: 1, start: 5, end: 8, text: "ECHO DELTA", words: [{ text: "ECHO", start: 7, end: 8 }, { text: "DELTA", start: 5, end: 6 }] },
      ],
    }),
  );
  const result = useEditorStore.getState().mergeWithNext("x");
  assert.equal(result, "ok");
  const merged = useEditorStore.getState().project!.subtitles.find((s) => s.id === "x")!;
  assert.deepEqual(
    merged.words.map((w) => `${w.text}:${w.start}`),
    ["CHARLIE:3.5", "BRAVO:2", "ECHO:7", "DELTA:5"],
    "each side's own non-monotonic order preserved exactly, no word's timing relocated",
  );
});

// ============================== Task 114761: Ripple interaction (P18.5) ==============================

test("P18.7: split works correctly on a caption that was shifted by Ripple Delete", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "gone", words: [{ text: "gone", start: 0, end: 2 }] },
        { id: "b", index: 1, start: 4, end: 6, text: "one two", words: [{ text: "one", start: 4, end: 5 }, { text: "two", start: 5, end: 6 }] },
      ],
    }),
  );
  assert.equal(useEditorStore.getState().rippleDeleteSubtitles(["a"]), "ok");
  const shifted = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(shifted.start, 2); // shifted from 4 to 4-2=2
  assert.equal(shifted.words[0].start, 2);

  const result = useEditorStore.getState().splitSubtitleAtTime("b", 3); // between the shifted "one" (2-3) and "two" (3-4)
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(subs.find((s) => s.id === "b")!.words.map((w) => w.text), ["one"]);
  assert.deepEqual(subs.find((s) => s.text === "two")!.words.map((w) => w.text), ["two"]);

  useEditorStore.getState().undo(); // undo split
  useEditorStore.getState().undo(); // undo ripple delete
  const restored = useEditorStore.getState().project!.subtitles;
  assert.equal(restored.length, 2);
  assert.equal(restored.find((s) => s.id === "b")!.start, 4, "ripple delete's shift is fully undone too");
});

test("P18.7: merge works correctly on captions shifted by Ripple Insert", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "a", index: 0, start: 0, end: 2, text: "one", words: [{ text: "one", start: 0, end: 2 }] },
        { id: "b", index: 1, start: 2, end: 4, text: "two", words: [{ text: "two", start: 2, end: 4 }] },
      ],
    }),
  );
  assert.equal(useEditorStore.getState().rippleInsertTime(0, 3), "ok"); // shifts both captions +3s
  const subs1 = useEditorStore.getState().project!.subtitles;
  assert.equal(subs1.find((s) => s.id === "a")!.start, 3);
  assert.equal(subs1.find((s) => s.id === "b")!.start, 5);

  const result = useEditorStore.getState().mergeWithNext("a");
  assert.equal(result, "ok");
  const merged = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(merged.start, 3);
  assert.equal(merged.end, 7);
  assert.deepEqual(merged.words.map((w) => w.text), ["one", "two"]);
});

// ============================== performance / reference stability at scale ==============================

function buildLargeProject(captionCount: number, splitTargetWordCount: number, splitTargetIndex: number): ProjectData {
  const subtitles: Subtitle[] = [];
  const spacing = Math.max(20, splitTargetWordCount + 10); // wide enough that even the target's own (possibly 500-word) span never reaches the next caption
  for (let i = 0; i < captionCount; i++) {
    const start = i * spacing;
    const wordCount = i === splitTargetIndex ? splitTargetWordCount : 2;
    const words = [];
    for (let w = 0; w < wordCount; w++) {
      words.push({ text: `w${w}`, start: start + w, end: start + w + 1 });
    }
    subtitles.push({ id: `s${i}`, index: i, start, end: start + wordCount, text: words.map((w) => w.text).join(" "), words });
  }
  return {
    id: "big",
    name: "Large split/merge fixture",
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

const WORD_COUNTS = [1, 5, 20, 100, 500];
const CAPTION_COUNTS = [30, 300, 1800, 3600, 5400];

for (const captionCount of CAPTION_COUNTS) {
  for (const wordCount of WORD_COUNTS) {
    if (wordCount < 2) continue; // a split needs at least 2 words to have a valid interior boundary
    test(`performance: splitSubtitleAtTime on a caption with ${wordCount} words stays fast at ${captionCount} total captions, unrelated captions keep their exact references`, () => {
      const targetIndex = Math.floor(captionCount / 2);
      useEditorStore.getState().load(buildLargeProject(captionCount, wordCount, targetIndex));
      const before = useEditorStore.getState().project!.subtitles;
      const targetId = `s${targetIndex}`;
      const targetStart = before[targetIndex].start;

      const start = performance.now();
      const result = useEditorStore.getState().splitSubtitleAtTime(targetId, targetStart + 1); // between word 0 and word 1
      const elapsedMs = performance.now() - start;

      assert.equal(result, "ok");
      assert.ok(elapsedMs < 150, `splitSubtitleAtTime took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions / ${wordCount} words`);

      const after = useEditorStore.getState().project!.subtitles;
      assert.equal(after.length, captionCount + 1);
      for (let i = 0; i < targetIndex; i++) {
        assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference`);
      }
    });
  }
}

for (const captionCount of CAPTION_COUNTS) {
  for (const wordCount of WORD_COUNTS) {
    test(`performance: mergeWithNext on a caption with ${wordCount} words stays fast at ${captionCount} total captions, unrelated captions keep their exact references`, () => {
      const targetIndex = Math.floor(captionCount / 2);
      useEditorStore.getState().load(buildLargeProject(captionCount, wordCount, targetIndex));
      const before = useEditorStore.getState().project!.subtitles;
      const targetId = `s${targetIndex}`;

      const start = performance.now();
      const result = useEditorStore.getState().mergeWithNext(targetId);
      const elapsedMs = performance.now() - start;

      assert.equal(result, "ok");
      assert.ok(elapsedMs < 150, `mergeWithNext took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions / ${wordCount} words`);

      const after = useEditorStore.getState().project!.subtitles;
      assert.equal(after.length, captionCount - 1);
      for (let i = 0; i < targetIndex; i++) {
        assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference`);
      }
    });
  }
}
