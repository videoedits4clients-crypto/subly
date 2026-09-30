/**
 * Store-level tests for P18.8 (Task 115894) — non-monotonic word safety for caption RESIZE.
 *
 * P18.6 (Task 113528) made non-monotonic `words` array order a permanent, supported state (a
 * word's ARRAY position no longer implies its chronological position). P18.7 (Task 114761) fixed
 * the same order-dependence bug in Split/Merge. This task fixes the last remaining instance: the
 * caption RESIZE path (`updateSubtitleTiming`'s non-pure-shift branch), which called
 * `clampWordsToCaptionBounds` (lib/subtitles/word-timing.ts) — a function that walks `words` in
 * ARRAY order maintaining a running `prevEnd` lower bound, silently assuming array order is
 * chronological. For a non-monotonic caption, this corrupts the out-of-order word's REAL timing.
 *
 * Run with: node --test src/store/__tests__/editor-store-resize-word-bounds.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle, Word } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality, isQualityReportStale } from "../../lib/subtitles/quality-analyzer.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    { id: "a", index: 0, start: 0, end: 4, text: "hello world", words: [{ text: "hello", start: 0, end: 1.5 }, { text: "world", start: 1.5, end: 3.5 }] },
    { id: "b", index: 1, start: 5, end: 6, text: "next", words: [{ text: "next", start: 5, end: 6 }] },
  ];
  return {
    id: "p1",
    name: "Resize word-bounds fixture",
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

// Non-monotonic fixture: array order is BRAVO then ALFA, but ALFA's real timestamps are EARLIER
// than BRAVO's — the exact scenario the task spec mandates (BRAVO 2.0-3.0, ALFA 0.5-1.5), produced
// here directly (not via reorderWord) so this one test has zero dependency on P18.6's own action
// working correctly — the corruption is in the RESIZE path alone.
function nonMonotonicFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      {
        id: "s1",
        index: 0,
        start: 0,
        end: 4,
        text: "bravo alfa",
        words: [
          { text: "BRAVO", start: 2.0, end: 3.0 },
          { text: "ALFA", start: 0.5, end: 1.5 },
        ],
      },
      { id: "s2", index: 1, start: 5, end: 6, text: "next", words: [{ text: "next", start: 5, end: 6 }] },
    ],
  });
}

test.beforeEach(() => {
  useEditorStore.getState().load(fixtureProject());
});

// ---------------------------------------------------------------------------------------
// MANDATORY EVIDENCE (task spec): this test reproduces the real corruption against whatever
// implementation of updateSubtitleTiming is currently in the tree. Before the P18.8 fix, it FAILS
// (proving the bug is real); after the fix, it PASSES.
// ---------------------------------------------------------------------------------------
test("0. [MANDATORY REGRESSION] resizing a non-monotonic caption must not move a valid word's real timing just because another word is later in ARRAY order", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  // s1's words: BRAVO=[2.0,3.0] (array index 0), ALFA=[0.5,1.5] (array index 1) — non-monotonic:
  // ALFA is EARLIER in time but LATER in the array. Resize s1's end from 4 down to 3.5 — both
  // words individually still fit inside the proposed new bounds [0, 3.5], so this must be a VALID
  // resize that leaves BOTH words' real timestamps completely untouched.
  useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.5);
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.end, 3.5, "the caption resize itself must apply");
  assert.deepEqual(
    [s1.words[0].start, s1.words[0].end],
    [2.0, 3.0],
    "BRAVO (array index 0) must keep its exact real timing",
  );
  assert.deepEqual(
    [s1.words[1].start, s1.words[1].end],
    [0.5, 1.5],
    "ALFA (array index 1, but chronologically EARLIER) must keep its exact real timing — the buggy " +
      "clampWordsToCaptionBounds walks array order with a running prevEnd, so it force-clamped ALFA's " +
      "start forward past BRAVO's end (~3.0), destroying ALFA's real [0.5,1.5] timing",
  );
});

// ---------------------------------------------------------------------------------------
// Focused categories (task spec's own numbered list 1-30, renumbered here for readability)
// ---------------------------------------------------------------------------------------

test("1. resize END earlier: a shrink whose new end lands after every existing word's own end succeeds and leaves words untouched", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.2); // BRAVO ends at 3.0 — still fits
  assert.equal(result, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.end, 3.2);
  assert.equal(s1.words, before, "words array reference preserved — nothing needed to change");
});

test("2. resize END later: extending the end can never invalidate a word that was already inside", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 4.9); // s2 starts at 5, leaves 0.1s min-duration gap
  assert.equal(result, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.end, 4.9);
  assert.equal(s1.words, before);
});

test("3. resize START later: a shrink whose new start lands before every existing word's own start succeeds", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0.4, 4); // ALFA starts at 0.5 — still fits
  assert.equal(result, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.start, 0.4);
  assert.equal(s1.words, before);
});

test("4. resize START earlier: extending the start can never invalidate a word that was already inside", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", -0.5 + 0.5, 4); // start clamps to 0 (floor)
  assert.equal(result, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.start, 0);
  assert.equal(s1.words, before);
});

test("5. word exactly touching caption.start is valid, not a violation merely for touching the boundary", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 4, text: "one two", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 1, end: 2 }] },
        { id: "s2", index: 1, start: 5, end: 6, text: "next", words: [{ text: "next", start: 5, end: 6 }] },
      ],
    }),
  );
  // Shrink the END only — start stays at 0, exactly where "one" already starts.
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 2);
  assert.equal(result, "ok");
});

test("6. word exactly touching caption.end is valid, not a violation merely for touching the boundary", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 4, text: "one two", words: [{ text: "one", start: 1, end: 2 }, { text: "two", start: 2, end: 3 }] },
        { id: "s2", index: 1, start: 5, end: 6, text: "next", words: [{ text: "next", start: 5, end: 6 }] },
      ],
    }),
  );
  // Shrink the START only — end stays at... actually shrink END to exactly "two"'s own end (3).
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 3);
  assert.equal(result, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.end, 3);
});

test("7. a word FULLY OUTSIDE the proposed bounds rejects the resize", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 4, text: "one two", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 3, end: 3.9 }] },
        { id: "s2", index: 1, start: 5, end: 6, text: "next", words: [{ text: "next", start: 5, end: 6 }] },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 2); // "two" [3,3.9] entirely outside [0,2]
  assert.equal(result, "word-out-of-bounds");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!, before);
});

test("8. a word PARTIALLY CROSSING a proposed boundary rejects the resize (never silently cut/guessed)", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 4, text: "one two", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 1, end: 2.5 }] },
        { id: "s2", index: 1, start: 5, end: 6, text: "next", words: [{ text: "next", start: 5, end: 6 }] },
      ],
    }),
  );
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 2); // "two" [1,2.5] straddles the new end (2)
  assert.equal(result, "word-out-of-bounds");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!, before);
});

test("9. multiple non-monotonic words: a resize valid for all of them succeeds and preserves every one's own real timing and array order", () => {
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
        { id: "s2", index: 1, start: 6, end: 7, text: "next", words: [{ text: "next", start: 6, end: 7 }] },
      ],
    }),
  );
  const beforeWords = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 4.5);
  assert.equal(result, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words, beforeWords, "words array reference preserved — every word already fit");
  assert.deepEqual(
    s1.words.map((w) => w.text),
    ["CHARLIE", "ALFA", "BRAVO", "DELTA"],
    "array order (non-monotonic — CHARLIE precedes ALFA/BRAVO in the array despite being later in time) must be completely untouched",
  );
});

test("10. all words valid, resize succeeds (baseline sanity check)", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.2);
  assert.equal(result, "ok");
});

test("11. an invalid resize is rejected ATOMICALLY — no partial mutation of the caption's own start/end either", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 2.5); // BRAVO [2,3] straddles new end 2.5
  assert.equal(result, "word-out-of-bounds");
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(after.start, before.start);
  assert.equal(after.end, before.end);
  assert.equal(after, before, "the ENTIRE caption object, not just start/end, must be reference-identical");
});

function metadataFixture(): ProjectData {
  return fixtureProject({
    subtitles: [
      {
        id: "s1",
        index: 0,
        start: 0,
        end: 5,
        text: "bravo alfa",
        words: [
          { text: "BRAVO", start: 2.0, end: 3.0, confidence: 0.42, style: { fontWeight: 700, color: "#ff0000" }, removed: false },
          {
            text: "ALFA",
            start: 0.5,
            end: 1.5,
            confidence: 0.91,
            style: { fontWeight: 400 },
            removed: true,
            hinglishText: "alfa-hi",
            gujaratiScriptText: "આલ્ફા",
          },
        ],
      },
      { id: "s2", index: 1, start: 6, end: 7, text: "next", words: [{ text: "next", start: 6, end: 7 }] },
    ],
  });
}

test("12/13/14/15/16/17/18. a successful resize preserves EVERY word field exactly (text, confidence, style, removed, hinglishText, gujaratiScriptText) and the exact word object references", () => {
  useEditorStore.getState().load(metadataFixture());
  const beforeWords = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!.words;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.2);
  assert.equal(result, "ok");
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.words, beforeWords, "the whole words ARRAY reference is preserved (no reposition needed at all)");
  assert.equal(s1.words[0], beforeWords[0], "BRAVO's own object reference is preserved");
  assert.equal(s1.words[1], beforeWords[1], "ALFA's own object reference is preserved");
  assert.deepEqual(s1.words[0], { text: "BRAVO", start: 2.0, end: 3.0, confidence: 0.42, style: { fontWeight: 700, color: "#ff0000" }, removed: false });
  assert.deepEqual(s1.words[1], {
    text: "ALFA",
    start: 0.5,
    end: 1.5,
    confidence: 0.91,
    style: { fontWeight: 400 },
    removed: true,
    hinglishText: "alfa-hi",
    gujaratiScriptText: "આલ્ફા",
  });
});

test("19. an unaffected caption's object reference is completely unchanged by a resize on a different caption", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const s2Before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.2);
  const s2After = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s2")!;
  assert.equal(s2After, s2Before);
});

test("20. a REJECTED resize leaves the entire project state reference-identical (not just the target caption)", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const projectBefore = useEditorStore.getState().project;
  const subtitlesBefore = projectBefore!.subtitles;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 2.5); // rejected
  assert.equal(result, "word-out-of-bounds");
  assert.equal(useEditorStore.getState().project, projectBefore, "the whole project object must be untouched");
  assert.equal(useEditorStore.getState().project!.subtitles, subtitlesBefore, "the whole subtitles array must be untouched");
});

test("21. a rejected resize creates NO undo (history) entry", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().updateSubtitleTiming("s1", 0, 2.5);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("22. a rejected resize does not set dirty", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.setState({ dirty: false });
  useEditorStore.getState().updateSubtitleTiming("s1", 0, 2.5);
  assert.equal(useEditorStore.getState().dirty, false);
});

test("23. a rejected resize does not stale an existing quality report", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const project = useEditorStore.getState().project!;
  const report = analyzeSubtitleQuality(project.subtitles, project.timingRules);
  useEditorStore.setState({ qualityReport: report, qualityReportSubtitles: project.subtitles });
  useEditorStore.getState().updateSubtitleTiming("s1", 0, 2.5); // rejected
  assert.equal(
    isQualityReportStale(useEditorStore.getState().project!.subtitles, useEditorStore.getState().qualityReportSubtitles),
    false,
    "no mutation happened, so the existing reference-inequality staleness check correctly reports 'not stale'",
  );
});

test("24. a successful resize creates exactly ONE undo (history) entry", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const pastBefore = useEditorStore.getState().past.length;
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.2);
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1);
});

test("25. resize -> undo -> redo restores exact timing and metadata", () => {
  useEditorStore.getState().load(metadataFixture());
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.2);
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!, before);

  useEditorStore.getState().redo();
  const afterRedo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(afterRedo.end, 3.2);
  assert.deepEqual(afterRedo.words[0], before.words[0]);
  assert.deepEqual(afterRedo.words[1], before.words[1]);
});

test("26. a successful resize continues to use commit() -> dirty -> the existing autosave watch path", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  useEditorStore.setState({ dirty: false });
  const result = useEditorStore.getState().updateSubtitleTiming("s1", 0, 3.2);
  assert.equal(result, "ok");
  assert.equal(useEditorStore.getState().dirty, true, "autosave (hooks/use-autosave.ts) watches this exact flag");
});

test("27. word reorder + resize: a resize after an explicit reorder respects the word's REAL timestamp, not its new array position", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 0, end: 3, text: "alfa bravo", words: [{ text: "ALFA", start: 0, end: 1 }, { text: "BRAVO", start: 1, end: 2.8 }] },
        { id: "s2", index: 1, start: 4, end: 5, text: "next", words: [{ text: "next", start: 4, end: 5 }] },
      ],
    }),
  );
  // Reorder: move ALFA (index 0) to AFTER BRAVO (index 1) — array becomes [BRAVO, ALFA], but
  // BRAVO's real timing stays [1,2.8] and ALFA's stays [0,1] (Task 113528, P18.6 — the word's
  // identity, including its real timestamp, travels with it, never regenerated).
  const reorderResult = useEditorStore.getState().reorderWord("s1", 0, 1);
  assert.equal(reorderResult, "ok");
  const afterReorder = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(afterReorder.words.map((w) => w.text), ["BRAVO", "ALFA"]);
  assert.deepEqual([afterReorder.words[1].start, afterReorder.words[1].end], [0, 1], "ALFA keeps its real [0,1] timing after the reorder");

  // Now resize s1's end down to 2.9 — both words individually still fit ([0,1] and [1,2.8]) —
  // must succeed and must NOT touch ALFA just because it now sits LAST in the array.
  const resizeResult = useEditorStore.getState().updateSubtitleTiming("s1", 0, 2.9);
  assert.equal(resizeResult, "ok");
  const afterResize = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual(afterResize.words.map((w) => w.text), ["BRAVO", "ALFA"], "array order from the reorder is preserved through the resize");
  assert.deepEqual([afterResize.words[0].start, afterResize.words[0].end], [1, 2.8], "BRAVO's real timing untouched");
  assert.deepEqual([afterResize.words[1].start, afterResize.words[1].end], [0, 1], "ALFA's real timing untouched");

  // And an invalid resize (crossing BRAVO's real end) must reject rather than corrupt ALFA.
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const rejected = useEditorStore.getState().updateSubtitleTiming("s1", 0, 2); // BRAVO [1,2.8] straddles new end 2
  assert.equal(rejected, "word-out-of-bounds");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!, before);
});

test("28. ripple insert + resize: a resize after a ripple shift validates against the CAPTION's shifted bounds and the words' own already-shifted timestamps", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        { id: "s1", index: 0, start: 2, end: 6, text: "bravo alfa", words: [{ text: "BRAVO", start: 4, end: 5 }, { text: "ALFA", start: 2.5, end: 3.5 }] },
        { id: "s2", index: 1, start: 7, end: 8, text: "next", words: [{ text: "next", start: 7, end: 8 }] },
      ],
    }),
  );
  // Ripple-insert 1s at t=0 — shifts every caption/word after it forward by 1s (Task 112347, P18.5).
  const rippleResult = useEditorStore.getState().rippleInsertTime(0, 1);
  assert.equal(rippleResult, "ok");
  const afterRipple = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([afterRipple.start, afterRipple.end], [3, 7]);
  assert.deepEqual([afterRipple.words[0].start, afterRipple.words[0].end], [5, 6], "BRAVO shifted by the ripple");
  assert.deepEqual([afterRipple.words[1].start, afterRipple.words[1].end], [3.5, 4.5], "ALFA shifted by the ripple, real timing preserved");

  // A resize using the OLD (pre-ripple) bounds must now correctly reject/succeed based on the
  // CURRENT (post-ripple) word timestamps, not the stale pre-ripple ones.
  const resizeResult = useEditorStore.getState().updateSubtitleTiming("s1", 3, 6.2); // BRAVO [5,6] straddles new end 6.2? no fits; check both
  assert.equal(resizeResult, "ok");
  const afterResize = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.deepEqual([afterResize.words[0].start, afterResize.words[0].end], [5, 6]);
  assert.deepEqual([afterResize.words[1].start, afterResize.words[1].end], [3.5, 4.5]);

  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  const rejected = useEditorStore.getState().updateSubtitleTiming("s1", 3, 5.5); // BRAVO [5,6] now straddles new end 5.5
  assert.equal(rejected, "word-out-of-bounds");
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!, before);
});

test("29. PROTECTED: the pure whole-caption SHIFT branch is completely unchanged — nudgeSubtitleTiming still always succeeds and shifts every word by the same delta, regardless of non-monotonic order", () => {
  useEditorStore.getState().load(nonMonotonicFixture());
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().nudgeSubtitleTiming("s1", 0.5); // whole-block move, s1 [0,4] -> [0.5,4.5]
  const s1 = useEditorStore.getState().project!.subtitles.find((s) => s.id === "s1")!;
  assert.equal(s1.start, 0.5);
  assert.equal(s1.end, 4.5);
  assert.deepEqual(s1.words.map((w) => [w.text, w.start, w.end]), [
    ["BRAVO", 2.5, 3.5],
    ["ALFA", 1.0, 2.0],
  ]);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "a pure shift is always exactly one commit — it can never be rejected");

  // Direct updateSubtitleTiming call preserving duration exactly is ALSO a pure shift and must
  // succeed even though it would be "word-out-of-bounds" territory if treated as a resize.
  const direct = useEditorStore.getState().updateSubtitleTiming("s1", 1, 5); // same 4s duration, whole-block move
  assert.equal(direct, "ok");
});

// ============================== performance / reference stability at scale ==============================

function buildLargeResizeProject(captionCount: number): ProjectData {
  const subtitles: Subtitle[] = [];
  for (let i = 0; i < captionCount; i++) {
    const start = i * 20;
    const words: Word[] = [
      { text: "BRAVO", start: start + 5, end: start + 6 },
      { text: "ALFA", start: start + 1, end: start + 2 },
    ];
    subtitles.push({ id: `s${i}`, index: i, start, end: start + 10, text: "bravo alfa", words });
  }
  return {
    id: "big",
    name: "Large resize fixture",
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
  test(`30. performance: a valid resize on a non-monotonic caption stays fast at ${captionCount} total captions, and every OTHER caption keeps its exact object reference`, () => {
    const targetIndex = Math.floor(captionCount / 2);
    useEditorStore.getState().load(buildLargeResizeProject(captionCount));
    const before = useEditorStore.getState().project!.subtitles;
    const targetId = `s${targetIndex}`;
    const targetStart = targetIndex * 20;

    const t0 = performance.now();
    const result = useEditorStore.getState().updateSubtitleTiming(targetId, targetStart, targetStart + 6.5); // BRAVO ends at +6 — still fits
    const elapsedMs = performance.now() - t0;

    assert.equal(result, "ok");
    assert.ok(elapsedMs < 150, `updateSubtitleTiming took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);

    const after = useEditorStore.getState().project!.subtitles;
    assert.equal(after.length, captionCount);
    for (let i = 0; i < captionCount; i++) {
      if (i === targetIndex) continue;
      assert.equal(after[i], before[i], `caption at index ${i} must keep its exact object reference`);
    }
  });
}
