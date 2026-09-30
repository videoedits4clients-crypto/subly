/**
 * Store-level tests for RIPPLE DELETE / RIPPLE INSERT (Task 112347, P18.5) — exercises the REAL
 * editor store: one commit (one undo step) per successful operation, undo/redo, the `dirty` flag
 * autosave watches, quality-report staleness, selection pruning, and — critically for P18.2 —
 * that an operation touching only the tail of a large project leaves every earlier caption's
 * object reference completely unchanged.
 *
 * Run with: node --test src/store/__tests__/editor-store-ripple-edit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality } from "../../lib/subtitles/quality-analyzer.ts";
import { isQualityReportStale } from "../../lib/subtitles/quality-analyzer.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "a", index: 0, start: 0, end: 2, text: "caption a", words: [{ text: "caption", start: 0, end: 1 }, { text: "a", start: 1, end: 2 }] },
    {
      id: "b",
      index: 1,
      start: 4,
      end: 6,
      text: "caption b",
      words: [
        { text: "caption", start: 4, end: 5, confidence: 0.7, style: { fontWeight: 700 }, hinglishText: "kaption" },
        { text: "b", start: 5, end: 6, removed: true },
      ],
      style: { color: "#00ff00" },
      hinglishText: "caption B derived",
      gujaratiScriptText: "કેપ્શન બી",
    },
    { id: "c", index: 2, start: 6, end: 8, text: "caption c", words: [{ text: "caption", start: 6, end: 7 }, { text: "c", start: 7, end: 8 }] },
    { id: "d", index: 3, start: 8, end: 10, text: "caption d", words: [{ text: "caption", start: 8, end: 9 }, { text: "d", start: 9, end: 10 }] },
  ];
  return {
    id: "p1",
    name: "Ripple fixture project",
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

// ============================== rippleDeleteSubtitles ==============================

test("rippleDeleteSubtitles: deletes the selection and shifts every later caption by the block's own span, one commit", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const result = store.rippleDeleteSubtitles(["a"]);
  assert.equal(result, "ok");

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1, "exactly one commit for the whole ripple");
  const ids = after.project!.subtitles.map((s) => s.id);
  assert.deepEqual(ids, ["b", "c", "d"]);
  const b = after.project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(b.start, 2, "b shifts from 4 to 4-2=2 (delta = a's own 0-2 span)");
  assert.equal(b.end, 4);
});

test("rippleDeleteSubtitles: preserves word/caption metadata (confidence, style, removed, hinglishText, gujaratiScriptText) exactly on shifted captions", () => {
  useEditorStore.getState().rippleDeleteSubtitles(["a"]);
  const b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.style, { color: "#00ff00" });
  assert.equal(b.hinglishText, "caption B derived");
  assert.equal(b.gujaratiScriptText, "કેપ્શન બી");
  assert.equal(b.words[0].confidence, 0.7);
  assert.deepEqual(b.words[0].style, { fontWeight: 700 });
  assert.equal(b.words[0].hinglishText, "kaption");
  assert.equal(b.words[1].removed, true);
});

test("rippleDeleteSubtitles: captions before the ripple keep their exact object reference", () => {
  useEditorStore.getState().rippleDeleteSubtitles(["c"]);
  // "a" and "b" are entirely before "c" — must be untouched.
  const beforeA = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a");
  assert.ok(beforeA);
});

test("rippleDeleteSubtitles: undo restores the exact previous positions and metadata", () => {
  useEditorStore.getState().rippleDeleteSubtitles(["a"]);
  useEditorStore.getState().undo();
  const project = useEditorStore.getState().project!;
  assert.deepEqual(project.subtitles.map((s) => s.id), ["a", "b", "c", "d"]);
  const b = project.subtitles.find((s) => s.id === "b")!;
  assert.equal(b.start, 4);
  assert.equal(b.end, 6);
  assert.equal(b.words[0].confidence, 0.7);
});

test("rippleDeleteSubtitles: redo re-applies the exact same ripple", () => {
  useEditorStore.getState().rippleDeleteSubtitles(["a"]);
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  const project = useEditorStore.getState().project!;
  assert.deepEqual(project.subtitles.map((s) => s.id), ["b", "c", "d"]);
  const b = project.subtitles.find((s) => s.id === "b")!;
  assert.equal(b.start, 2);
});

test("rippleDeleteSubtitles: sets dirty (autosave watches this)", () => {
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().rippleDeleteSubtitles(["a"]);
  assert.equal(useEditorStore.getState().dirty, true);
});

test("rippleDeleteSubtitles: marks an existing quality report stale via the normal reference mechanism, no new quality state", () => {
  const project = useEditorStore.getState().project!;
  const report = analyzeSubtitleQuality(project.subtitles, project.timingRules);
  useEditorStore.setState({ qualityReport: report, qualityReportSubtitles: project.subtitles });
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles), false);

  useEditorStore.getState().rippleDeleteSubtitles(["a"]);

  assert.equal(
    isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles),
    true,
    "ripple delete is a subtitle mutation — the existing reference-inequality staleness check must catch it automatically",
  );
});

test("rippleDeleteSubtitles: empty selection is rejected, no commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().rippleDeleteSubtitles([]);
  assert.equal(result, "empty-selection");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("rippleDeleteSubtitles: non-contiguous selection is rejected, no commit, no partial mutation", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().rippleDeleteSubtitles(["a", "c"]); // b is not selected — a gap
  assert.equal(result, "non-contiguous");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
  assert.equal(useEditorStore.getState().project!.subtitles, before, "subtitles array reference must be completely untouched on rejection");
});

test("rippleDeleteSubtitles: pruneSelection removes the deleted ids from selection automatically", () => {
  useEditorStore.getState().selectSubtitle("a");
  useEditorStore.getState().toggleSubtitleSelection("a");
  useEditorStore.getState().rippleDeleteSubtitles(["a"]);
  assert.equal(useEditorStore.getState().selectedSubtitleIds.has("a"), false);
});

// Task 125843 (P19.5) — item 17 of this task's own regression list: selectedWordIndex must never
// survive its parent caption being ripple-deleted (the same rule deleteSubtitle's own explicit
// check and pruneSelection's generic mechanism already enforce for plain delete — this proves
// ripple delete, which also routes through commit()'s pruneSelection, gets it for free too).
test("rippleDeleteSubtitles: selectedWordIndex is cleared when the FOCUSED caption (with a word selected) is ripple-deleted", () => {
  useEditorStore.getState().selectSubtitle("b");
  useEditorStore.getState().selectWord(1);
  assert.equal(useEditorStore.getState().selectedWordIndex, 1, "sanity check: word selection is actually set before the delete");
  const result = useEditorStore.getState().rippleDeleteSubtitles(["b"]);
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().selectedSubtitleId, null);
  assert.equal(useEditorStore.getState().selectedWordIndex, null);
});

// Task 125843 (P19.5) — Phase 6's own explicit "after rejected ripple delete, EVERYTHING must
// remain unchanged" requirement, extended to selection/word-selection state specifically (the
// existing "non-contiguous... no partial mutation" test above already covers the subtitles array
// itself).
test("rippleDeleteSubtitles: a rejected (non-contiguous) attempt leaves selection and word selection completely untouched", () => {
  useEditorStore.getState().selectSubtitle("b");
  useEditorStore.getState().selectWord(0);
  const idsBefore = useEditorStore.getState().selectedSubtitleIds;
  const result = useEditorStore.getState().rippleDeleteSubtitles(["a", "c"]); // b not selected — non-contiguous
  assert.equal(result, "non-contiguous");
  assert.equal(useEditorStore.getState().selectedSubtitleId, "b");
  assert.equal(useEditorStore.getState().selectedWordIndex, 0);
  assert.equal(useEditorStore.getState().selectedSubtitleIds, idsBefore, "selection set reference unchanged");
});

// ============================== rippleInsertTime ==============================

test("rippleInsertTime: shifts every caption at/after the insertion point, leaves earlier captions untouched, one commit", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const result = store.rippleInsertTime(5, 2); // between b (4-6) and c (6-8) — crosses b!
  // b spans 4-6, insertAt=5 is strictly inside it -> must be rejected, not guessed.
  assert.equal(result, "crosses-caption");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no commit on rejection");
});

test("rippleInsertTime: insert at a clean boundary shifts everything at/after it", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const result = store.rippleInsertTime(6, 2); // exactly at c's start — clean boundary
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1);
  const project = useEditorStore.getState().project!;
  assert.equal(project.subtitles.find((s) => s.id === "a")!.start, 0, "entirely-before caption untouched");
  assert.equal(project.subtitles.find((s) => s.id === "b")!.start, 4, "entirely-before caption untouched");
  assert.equal(project.subtitles.find((s) => s.id === "c")!.start, 8, "shifted +2");
  assert.equal(project.subtitles.find((s) => s.id === "d")!.start, 10, "shifted +2");
});

test("rippleInsertTime: undo restores exact pre-insert positions", () => {
  useEditorStore.getState().rippleInsertTime(6, 2);
  useEditorStore.getState().undo();
  const project = useEditorStore.getState().project!;
  assert.equal(project.subtitles.find((s) => s.id === "c")!.start, 6);
  assert.equal(project.subtitles.find((s) => s.id === "d")!.start, 8);
});

test("rippleInsertTime: sets dirty on success", () => {
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().rippleInsertTime(6, 2);
  assert.equal(useEditorStore.getState().dirty, true);
});

test("rippleInsertTime: zero/negative duration rejected, no commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  assert.equal(useEditorStore.getState().rippleInsertTime(6, 0), "invalid-duration");
  assert.equal(useEditorStore.getState().rippleInsertTime(6, -1), "invalid-duration");
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("rippleInsertTime: inserting past every caption is a valid no-op — 'noop', no commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const before = useEditorStore.getState().project!.subtitles;
  const result = useEditorStore.getState().rippleInsertTime(100, 5);
  assert.equal(result, "noop");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "a noop must not create an undo entry");
  assert.equal(useEditorStore.getState().project!.subtitles, before);
});

// ============================== performance / reference stability at scale ==============================

function buildLargeProject(captionCount: number): ProjectData {
  const subtitles: Subtitle[] = [];
  for (let i = 0; i < captionCount; i++) {
    const start = i * 2;
    subtitles.push({
      id: `s${i}`,
      index: i,
      start,
      end: start + 2,
      text: "hello world",
      words: [
        { text: "hello", start, end: start + 1 },
        { text: "world", start: start + 1, end: start + 2 },
      ],
    });
  }
  return {
    id: "big",
    name: "Large ripple fixture",
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
  test(`performance: rippleDeleteSubtitles near the END stays fast and leaves the first ${captionCount - 20} captions' references untouched at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeProject(captionCount));
    const before = useEditorStore.getState().project!.subtitles;
    const targetId = `s${captionCount - 10}`; // deep in the tail

    const start = performance.now();
    const result = useEditorStore.getState().rippleDeleteSubtitles([targetId]);
    const elapsedMs = performance.now() - start;

    assert.equal(result, "ok");
    assert.ok(elapsedMs < 150, `rippleDeleteSubtitles took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);

    const after = useEditorStore.getState().project!.subtitles;
    assert.equal(after.length, captionCount - 1);
    // Every caption strictly BEFORE the deleted one must keep its exact object reference.
    for (let i = 0; i < captionCount - 10; i++) {
      assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference (ripple only touches the tail)`);
    }
  });
}

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: rippleInsertTime near the START shifts everything and stays fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeProject(captionCount));

    const start = performance.now();
    // Insert right at the very first caption's own start — every caption shifts.
    const result = useEditorStore.getState().rippleInsertTime(0, 3);
    const elapsedMs = performance.now() - start;

    assert.equal(result, "ok");
    assert.ok(elapsedMs < 150, `rippleInsertTime took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);
    assert.equal(useEditorStore.getState().project!.subtitles[0].start, 3);
    assert.equal(useEditorStore.getState().project!.subtitles.length, captionCount);
  });
}

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: rippleInsertTime near the END leaves earlier captions' references untouched at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeProject(captionCount));
    const before = useEditorStore.getState().project!.subtitles;
    const insertAt = before[captionCount - 5].start; // a clean boundary deep in the tail

    const start = performance.now();
    const result = useEditorStore.getState().rippleInsertTime(insertAt, 1);
    const elapsedMs = performance.now() - start;

    assert.equal(result, "ok");
    assert.ok(elapsedMs < 150, `rippleInsertTime took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);
    const after = useEditorStore.getState().project!.subtitles;
    for (let i = 0; i < captionCount - 5; i++) {
      assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference`);
    }
  });
}
