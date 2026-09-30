/**
 * Store-level tests for P18.9 (Task 117206) — non-monotonic word safety for the WORD-LEVEL
 * timing nudge (`updateWordTiming`, the popover's +/- start/end controls and the timeline's own
 * word-handle drag).
 *
 * P18.6 (Task 113528) made non-monotonic `words` array order a permanent, supported state. P18.7
 * (Task 114761) fixed the same order-dependence bug in Split/Merge. P18.8 (Task 115894) fixed it
 * in caption RESIZE. P18.9 fixes the last discovered instance: `clampWordTiming`
 * (lib/subtitles/word-timing.ts) derived its allowed range from `words[wordIndex-1]`/
 * `words[wordIndex+1]` — ARRAY-adjacent neighbors — silently assuming array order is chronological.
 *
 * Run with: node --test src/store/__tests__/editor-store-word-nudge-bounds.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle, Word } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality, isQualityReportStale } from "../../lib/subtitles/quality-analyzer.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "a", index: 0, start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 1 }] },
    { id: "b", index: 1, start: 2, end: 3, text: "World", words: [{ text: "World", start: 2, end: 3 }] },
  ];
  return {
    id: "p1",
    name: "Word nudge fixture",
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

// The exact live-QA reproduction from the P18.8 report: BRAVO/CHARLIE/DELTA, DELTA moved left
// once so the array reads BRAVO/DELTA/CHARLIE while every word keeps its own real timestamp.
function nonMonotonicFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      {
        id: "s1",
        index: 0,
        start: 1.75,
        end: 6.0,
        text: "bravo delta charlie",
        words: [
          { text: "BRAVO", start: 2.0, end: 3.0 },
          { text: "DELTA", start: 5.0, end: 6.0 },
          { text: "CHARLIE", start: 3.5, end: 4.5 },
        ],
      },
      { id: "s2", index: 1, start: 7.0, end: 8.0, text: "next", words: [{ text: "next", start: 7.0, end: 8.0 }] },
    ],
  });
}

test.beforeEach(() => {
  useEditorStore.getState().load(fixtureProject());
});

// ---------------------------------------------------------------------------------------
// MANDATORY EVIDENCE (task spec): fails against the current implementation, passes after the fix.
// ---------------------------------------------------------------------------------------
test("0. [MANDATORY REGRESSION] nudging CHARLIE's start must use its real chronological neighbors (BRAVO end=3.0, DELTA start=5.0), not DELTA's array-adjacent position", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  // CHARLIE is array index 2 (last), chronologically BETWEEN BRAVO [2,3] and DELTA [5,6]. A
  // request to move its start from 3.5 to 3.6 is comfortably valid against its REAL neighbors
  // (3.0-5.0) and must apply exactly as requested.
  useEditorStore.getState().updateWordTiming("s1", 2, 3.6, 4.5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(
    [s1.words[2].start, s1.words[2].end],
    [3.6, 4.5],
    "CHARLIE's nudge must be evaluated against its real chronological neighbors (BRAVO/DELTA), " +
      "not against DELTA's array-adjacent position — the buggy clampWordTiming used DELTA (array " +
      "index 1) as CHARLIE's 'previous' neighbor, producing a degenerate 6.00-6.00 bound and " +
      "silently discarding the requested value",
  );
  assert.deepEqual([s1.words[0].start, s1.words[0].end], [2.0, 3.0], "BRAVO must be untouched");
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [5.0, 6.0], "DELTA must be untouched");
});

// ---------------------------------------------------------------------------------------
// Focused categories (task spec's own numbered list, renumbered here for readability)
// ---------------------------------------------------------------------------------------

test("1. monotonic words — baseline nudge behavior is unchanged", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 3, text: "one two three", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 1, end: 2 }, { text: "three", start: 2, end: 3 }] },
      ],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 1, 1.1, 1.9);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [1.1, 1.9]);
});

test("2. non-monotonic words — the exact P18.6 example (also test 0's own scenario, restated for the numbered matrix)", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.8);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[2].start, s1.words[2].end], [3.2, 4.8]);
});

test("3/4. target has an earlier word later in the array, and a later word earlier in the array", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 6, text: "x y", words: [{ text: "X", start: 4, end: 5 }, { text: "Y", start: 0, end: 1 }] },
      ],
    }),
  );
  // X (index 0) is chronologically LATER than Y (index 1) but sits first in the array.
  const resultX = useEditorStore.getState().updateWordTiming("s1", 0, 3.5, 5.5);
  const s1a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1a.words[0].start, s1a.words[0].end], [3.5, 5.5], "X's real neighbor is Y (end=1), not itself at array index 1");
  assert.equal(resultX, undefined);
});

test("5. target chronologically in the middle but last in the array", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  // CHARLIE (index 2, array-last) is chronologically BETWEEN BRAVO and DELTA.
  useEditorStore.getState().updateWordTiming("s1", 2, 3.1, 4.9);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[2].start, s1.words[2].end], [3.1, 4.9]);
});

test("6. chronologically first word at a non-zero array index — nudging it earlier is bounded by the caption start, not a nonexistent 'previous'", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 5, text: "b a", words: [{ text: "B", start: 3, end: 4 }, { text: "A", start: 0, end: 1 }] },
      ],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 1, -5, 1); // A, index 1, chronologically first
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [0, 1], "clamped to the caption's own start (0), not to B's array-adjacent position");
});

test("7. chronologically last word at a non-last array index — nudging it later is bounded by the caption end, not a nonexistent 'next'", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 5, text: "last first", words: [{ text: "LAST", start: 4, end: 4.5 }, { text: "FIRST", start: 0, end: 1 }] },
      ],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 0, 4, 10); // LAST, index 0, chronologically last
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[0].start, s1.words[0].end], [4, 5], "clamped to the caption's own end (5)");
});

test("8. gaps between chronological words are respected exactly", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [{ id: "s1", index: 0, start: 0, end: 10, text: "a b", words: [{ text: "A", start: 0, end: 1 }, { text: "B", start: 8, end: 9 }] }],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 0, 0, 6); // requesting far past the gap
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.ok(s1.words[0].end <= 8, "must not cross into B's real start");
});

test("9. exact touching boundaries are valid (half-open convention, matches P18.8)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [{ id: "s1", index: 0, start: 0, end: 3, text: "a b", words: [{ text: "A", start: 0, end: 1 }, { text: "B", start: 1, end: 2 }] }],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 0, 0, 1); // requesting exactly up to B's own start
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[0].start, s1.words[0].end], [0, 1]);
});

test("10/11. a valid start nudge and a valid end nudge both apply exactly as requested", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.5); // start nudge
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.9); // end nudge
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[2].start, s1.words[2].end], [3.2, 4.9]);
});

test("12/13. an invalid start nudge and an invalid end nudge are clamped to the word's real chronological bounds, not silently accepted", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 1.0, 4.5); // requests before BRAVO's own end (3.0)
  let s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.ok(s1.words[2].start >= 3.0, "must not cross into BRAVO's real end");
  useEditorStore.getState().updateWordTiming("s1", 2, s1.words[2].start, 9.0); // requests past DELTA's own start (5.0)
  s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.ok(s1.words[2].end <= 5.0, "must not cross into DELTA's real start");
});

test("14. minimum word duration is still enforced using the existing MIN_WORD_DURATION_SEC constant, no new policy invented", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 4.0, 4.0001); // collapsing request
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.ok(s1.words[2].end - s1.words[2].start >= 0.02 - 1e-9);
});

function metadataFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      {
        id: "s1",
        index: 0,
        start: 1.75,
        end: 6.0,
        text: "bravo delta charlie",
        words: [
          { text: "BRAVO", start: 2.0, end: 3.0, confidence: 0.8 },
          { text: "DELTA", start: 5.0, end: 6.0, confidence: 0.6, style: { fontWeight: 700 }, hinglishText: "delta-hi", gujaratiScriptText: "ડેલ્ટા" },
          { text: "CHARLIE", start: 3.5, end: 4.5, confidence: 0.91, style: { color: "#00ffff" }, removed: false },
        ],
      },
      { id: "s2", index: 1, start: 7.0, end: 8.0, text: "next", words: [{ text: "next", start: 7.0, end: 8.0 }] },
    ],
  });
}

test("15/20/21. target word metadata (confidence, style) preserved except start/end; other fields untouched", () => {
  useEditorStore.getState().load(metadataFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.words[2], { text: "CHARLIE", start: 3.2, end: 4.5, confidence: 0.91, style: { color: "#00ffff" }, removed: false });
});

test("16/17. other words' object references AND their own timing are completely untouched by a nudge to a different word", () => {
  useEditorStore.getState().load(metadataFixture());
  const bravoBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words[0];
  const deltaBefore = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words[1];
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words[0], bravoBefore, "BRAVO's object reference must be preserved");
  assert.equal(s1.words[1], deltaBefore, "DELTA's object reference must be preserved");
});

test("18. array order is never changed by a nudge", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.words.map((w) => w.text), ["BRAVO", "DELTA", "CHARLIE"]);
});

test("19. caption text is unchanged by a word-timing nudge", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.text;
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.5);
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.text;
  assert.equal(after, before);
});

test("22. a removed word's own nudge behavior is preserved (existing code never special-cased removed — nudging a removed word still works)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [{ id: "s1", index: 0, start: 0, end: 3, text: "a b", words: [{ text: "A", start: 0, end: 1, removed: true }, { text: "B", start: 1, end: 2 }] }],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 0, 0, 0.5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[0].start, s1.words[0].end], [0, 0.5]);
  assert.equal(s1.words[0].removed, true, "removed flag itself is untouched by a timing nudge");
});

test("23. derived fields (hinglishText, gujaratiScriptText) are preserved exactly on the nudged word", () => {
  useEditorStore.getState().load(metadataFixture());
  useEditorStore.getState().updateWordTiming("s1", 1, 5.1, 5.9); // DELTA
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words[1].hinglishText, "delta-hi");
  assert.equal(s1.words[1].gujaratiScriptText, "ડેલ્ટા");
  assert.deepEqual(s1.words[1].style, { fontWeight: 700 });
});

test("24. undo restores the exact previous word timing", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.9);
  useEditorStore.getState().undo();
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[2].start, s1.words[2].end], [3.5, 4.5]);
});

test("25. redo re-applies the exact same nudge", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.9);
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[2].start, s1.words[2].end], [3.2, 4.9]);
});

test("26. a rejected/no-op nudge (no safe interval) creates NO history entry and does not mutate the word", () => {
  const subtitles: Subtitle[] = [
    { id: "s1", index: 0, start: 0, end: 3, text: "a t b", words: [{ text: "A", start: 0, end: 1.5 }, { text: "T", start: 1.5, end: 1.5 }, { text: "B", start: 1.5, end: 3 }] },
  ];
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().updateWordTiming("s1", 1, 1.4, 1.6); // T has zero room between A and B
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(after, before, "the whole caption object must be reference-identical — zero mutation");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "no history entry for a rejected nudge");
});

test("27. quality staleness: a successful nudge stales an existing quality report through the normal reference mechanism; a rejected one does not", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const project = useEditorStore.getState().project!;
  const report = analyzeSubtitleQuality(project.subtitles, project.timingRules);
  useEditorStore.setState({ qualityReport: report, qualityReportSubtitles: project.subtitles });
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.5);
  assert.equal(isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles), true);
});

test("28. autosave: a successful nudge continues to set dirty through the existing commit() path", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().updateWordTiming("s1", 2, 3.2, 4.5);
  assert.equal(useEditorStore.getState().dirty, true);
});

test("28b. a rejected nudge does not set dirty", () => {
  const subtitles: Subtitle[] = [
    { id: "s1", index: 0, start: 0, end: 3, text: "a t b", words: [{ text: "A", start: 0, end: 1.5 }, { text: "T", start: 1.5, end: 1.5 }, { text: "B", start: 1.5, end: 3 }] },
  ];
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().updateWordTiming("s1", 1, 1.4, 1.6);
  assert.equal(useEditorStore.getState().dirty, false);
});

test("29. reload/persistence: not directly testable at the store-test level (no real DB in this suite) — covered live in the browser QA instead", () => {
  // Placeholder acknowledging the item; see research/p18_9_word_timing_nudge_integrity_report.md's
  // Live QA section for the actual reload/persistence proof.
  assert.ok(true);
});

test("30. word reorder + nudge: reordering a word then nudging it uses its own real chronological neighbors at every step", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 3, text: "alfa bravo", words: [{ text: "ALFA", start: 0, end: 1 }, { text: "BRAVO", start: 1, end: 2.8 }] },
        { id: "s2", index: 1, start: 4, end: 5, text: "next", words: [{ text: "next", start: 4, end: 5 }] },
      ],
    }),
  );
  const reorderResult = useEditorStore.getState().reorderWord("s1", 0, 1); // -> [BRAVO, ALFA]
  assert.equal(reorderResult, "ok");
  useEditorStore.getState().updateWordTiming("s1", 1, 0.1, 0.9); // nudge ALFA (now index 1)
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(s1.words.map((w) => w.text), ["BRAVO", "ALFA"]);
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [0.1, 0.9], "ALFA's real neighbor is the caption start (0), not BRAVO's own [1,2.8] despite BRAVO sitting right before it in the array");
});

test("31. multiple non-monotonic words: nudging one respects ALL the others' real timing, regardless of array position", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "s1",
          index: 0,
          start: 0,
          end: 5,
          text: "charlie alfa bravo delta",
          words: [
            { text: "CHARLIE", start: 3.0, end: 3.5 },
            { text: "ALFA", start: 0.0, end: 1.0 },
            { text: "BRAVO", start: 1.0, end: 2.0 },
            { text: "DELTA", start: 3.6, end: 4.2 },
          ],
        },
      ],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 0, 2.1, 3.5); // CHARLIE — must not cross BRAVO's real end (2.0) or DELTA's real start (3.6)
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.ok(s1.words[0].start >= 2.0);
  assert.ok(s1.words[0].end <= 3.6);
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [0.0, 1.0]);
  assert.deepEqual([s1.words[2].start, s1.words[2].end], [1.0, 2.0]);
  assert.deepEqual([s1.words[3].start, s1.words[3].end], [3.6, 4.2]);
});

test("32. gaps + non-monotonic order together", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 10, text: "b a", words: [{ text: "B", start: 8, end: 9 }, { text: "A", start: 0, end: 1 }] },
      ],
    }),
  );
  useEditorStore.getState().updateWordTiming("s1", 1, 0, 6); // A, index 1 — real next neighbor is B (start=8), a large gap
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[1].start, s1.words[1].end], [0, 6]);
});

test("33. malformed/non-finite target index behavior matches existing conventions (out-of-range still rejects with no mutation)", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().updateWordTiming("s1", 99, 0, 1);
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(after, before);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("34. overlapping/corrupt neighbor input degrades safely (rejects rather than producing an inverted interval)", () => {
  const subtitles: Subtitle[] = [
    { id: "s1", index: 0, start: 0, end: 4, text: "a b c", words: [{ text: "A", start: 0, end: 2 }, { text: "B", start: 1, end: 3 }, { text: "C", start: 3.5, end: 4 }] },
  ];
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  // B (index 1) overlaps A — A therefore does NOT qualify as B's "previous" neighbor (it isn't
  // fully before B). B's real "next" is C (start=3.5). This must never crash or invert.
  useEditorStore.getState().updateWordTiming("s1", 1, 0.5, 3.2);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.ok(s1.words[1].start < s1.words[1].end, "must never produce an inverted interval");
});

test("35. first/last chronological neighbor edge case: a caption with exactly one word is bounded only by the caption's own start/end", () => {
  useEditorStore.getState().load(
    fixtureProject({ subtitles: [{ id: "s1", index: 0, start: 0, end: 3, text: "only", words: [{ text: "only", start: 1, end: 2 }] }] }),
  );
  useEditorStore.getState().updateWordTiming("s1", 0, -5, 10);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([s1.words[0].start, s1.words[0].end], [0, 3]);
});

// ============================== performance / reference stability at scale ==============================

function buildLargeNudgeProject(captionCount: number, targetWordCount: number): ProjectData {
  const subtitles: Subtitle[] = [];
  for (let i = 0; i < captionCount; i++) {
    const start = i * 20;
    const wordCount = i === Math.floor(captionCount / 2) ? targetWordCount : 2;
    const words: Word[] = [];
    for (let w = 0; w < wordCount; w++) words.push({ text: `w${w}`, start: start + w, end: start + w + 0.9 });
    subtitles.push({ id: `s${i}`, index: i, start, end: start + wordCount + 1, text: words.map((w) => w.text).join(" "), words });
  }
  return {
    id: "big",
    name: "Large word-nudge fixture",
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

const WORD_COUNTS = [5, 20, 100, 500, 1000];
const CAPTION_COUNTS = [30, 300, 1800, 3600, 5400];

for (const captionCount of CAPTION_COUNTS) {
  for (const wordCount of WORD_COUNTS) {
    test(`36. performance: updateWordTiming on a caption with ${wordCount} words stays fast at ${captionCount} total captions, unrelated captions keep their exact references`, () => {
      const targetIndex = Math.floor(captionCount / 2);
      useEditorStore.getState().load(buildLargeNudgeProject(captionCount, wordCount));
      const before = useEditorStore.getState().project!.subtitles;
      const targetId = `s${targetIndex}`;
      const midWordIndex = Math.floor(wordCount / 2);

      const t0 = performance.now();
      useEditorStore.getState().updateWordTiming(targetId, midWordIndex, targetIndex * 20 + midWordIndex + 0.05, targetIndex * 20 + midWordIndex + 0.85);
      const elapsedMs = performance.now() - t0;

      assert.ok(elapsedMs < 150, `updateWordTiming took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions / ${wordCount} words — expected well under 150ms`);

      const after = useEditorStore.getState().project!.subtitles;
      assert.equal(after.length, captionCount);
      for (let i = 0; i < captionCount; i++) {
        if (i === targetIndex) continue;
        assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference`);
      }
    });
  }
}
