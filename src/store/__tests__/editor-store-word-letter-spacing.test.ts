/**
 * Task 131508 (P19.8) — store-level tests for word-level letter-spacing overrides.
 *
 * `setWordStyleOverride` itself is untouched by this task (it was already fully generic over
 * every `SubtitleStyle` key — see editor-store-word-edit.test.ts's own P18.3 performance suite),
 * so this file focuses on what IS new: the letterSpacing property specifically travelling with
 * the Word OBJECT (never array position) through reorder/split/merge/insertion/caption
 * split/merge/ripple-delete/display-mode switches, the "reset only this property" contract, and
 * undo/redo. Uses the established non-monotonic BRAVO[2,3] DELTA[5,6] CHARLIE[3.5,4.5] fixture
 * (see research/p18_6_word_reorder_report.md and every subsequent word-identity task through
 * P19.7) to prove array-position bugs can't hide.
 *
 * Run with: node --test src/store/__tests__/editor-store-word-letter-spacing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { mergeWordStyleOverride } from "../../lib/subtitles/word-style-capabilities.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 1,
      text: "hello world",
      words: [
        { text: "hello", start: 0, end: 0.5 },
        { text: "world", start: 0.5, end: 1 },
      ],
    },
    // The established non-monotonic fixture: array order (BRAVO, DELTA, CHARLIE) differs from
    // chronological order (BRAVO, CHARLIE, DELTA) — DELTA sits second in the array but plays LAST.
    {
      id: "b",
      index: 1,
      start: 2,
      end: 6,
      text: "BRAVO DELTA CHARLIE",
      words: [
        { text: "BRAVO", start: 2, end: 3 },
        { text: "DELTA", start: 5, end: 6 },
        { text: "CHARLIE", start: 3.5, end: 4.5 },
      ],
    },
  ];
  return {
    id: "p1",
    name: "Fixture project",
    status: "READY",
    language: "hi",
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

function charlieIndex(): number {
  return useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words.findIndex((w) => w.text === "CHARLIE");
}

// ============================== apply / undo / redo ==============================

test("setWordStyleOverride({letterSpacing}): applies in exactly one commit", () => {
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().setWordStyleOverride("b", charlieIndex(), { letterSpacing: 8 });
  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1, "one commit for one apply");
  assert.equal(after.project!.subtitles.find((s) => s.id === "b")!.words[charlieIndex()].style?.letterSpacing, 8);
});

test("apply -> undo removes the override; redo restores it", () => {
  const idx = charlieIndex();
  useEditorStore.getState().setWordStyleOverride("b", idx, { letterSpacing: 8 });
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx].style?.letterSpacing, undefined, "undo removes it");

  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx].style?.letterSpacing, 8, "redo restores it");
});

// mergeWordStyleOverride (the same helper style-panel.tsx's Reset button calls) is, by
// established P18.3 design (see word-style-capabilities.test.ts), not required to DELETE the
// key it un-sets when siblings remain — it only collapses to a full `null` once every property
// is undefined (see that file's own "leaves a real (non-null) patch" test, which asserts the
// exact same explicit `{ ..., fontWeight: undefined }` shape this test sees for letterSpacing).
// An explicit `letterSpacing: undefined` key is functionally identical to an absent one
// everywhere it's read (resolveEffectiveWordStyleValue/isWordStylePropertyOverridden/
// wordDynamicStyle/wordStyleTag all check `!== undefined`), and JSON.stringify — the actual
// serialization step on the real persistence path — drops `undefined`-valued keys entirely, so
// "leaves {color, fontWeight} exactly intact" is verified here via that same real round-trip.
test("reset removes ONLY letterSpacing — verified both live (via the same !==undefined checks every reader uses) and through the real JSON persistence round-trip", () => {
  const idx = charlieIndex();
  useEditorStore.getState().setWordStyleOverride("b", idx, { color: "#ff0000", fontWeight: 700, letterSpacing: 6 });
  let word = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx];
  assert.deepEqual(word.style, { color: "#ff0000", fontWeight: 700, letterSpacing: 6 });

  useEditorStore.getState().setWordStyleOverride("b", idx, mergeWordStyleOverride(word.style, { letterSpacing: undefined }));
  word = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx];
  assert.equal(word.style?.color, "#ff0000", "color untouched");
  assert.equal(word.style?.fontWeight, 700, "fontWeight untouched");
  assert.equal(word.style?.letterSpacing, undefined, "letterSpacing gone");
  assert.deepEqual(JSON.parse(JSON.stringify(word.style)), { color: "#ff0000", fontWeight: 700 }, "the real persistence round-trip (JSON.stringify drops undefined-valued keys) leaves exactly {color, fontWeight}");
});

test("compound: apply color + letterSpacing -> reset letterSpacing only -> undo -> color remains untouched", () => {
  const idx = charlieIndex();
  useEditorStore.getState().setWordStyleOverride("b", idx, { color: "#00ff00", letterSpacing: 4 });
  const current = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx].style;
  useEditorStore.getState().setWordStyleOverride("b", idx, mergeWordStyleOverride(current, { letterSpacing: undefined }));
  const afterReset = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx].style;
  assert.equal(afterReset?.color, "#00ff00");
  assert.equal(afterReset?.letterSpacing, undefined);

  useEditorStore.getState().undo(); // undoes the reset, restoring letterSpacing
  const restored = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx];
  assert.deepEqual(restored.style, { color: "#00ff00", letterSpacing: 4 }, "color must remain untouched across the reset+undo");
});

test("a zero letterSpacing override survives round-trip (0 is not treated as unset)", () => {
  const idx = charlieIndex();
  useEditorStore.getState().setWordStyleOverride("b", idx, { letterSpacing: 0 });
  assert.equal(useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words[idx].style?.letterSpacing, 0);
});

// ============================== word identity: reorder / split / merge / insertion ==============================

test("word reorder: letterSpacing travels WITH the CHARLIE word object, not with its old array index", () => {
  useEditorStore.getState().setWordStyleOverride("b", charlieIndex(), { letterSpacing: 9 });
  // Move CHARLIE (index 2) one step left, to index 1.
  const result = useEditorStore.getState().reorderWord("b", charlieIndex(), 1);
  assert.equal(result, "ok");
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(sub.words[1].text, "CHARLIE");
  assert.equal(sub.words[1].style?.letterSpacing, 9, "the override followed CHARLIE to its new position");
  assert.equal(sub.words[2].style?.letterSpacing, undefined, "DELTA (now at index 2) must not have inherited CHARLIE's old override");
});

test("word split: both halves inherit the split word's letterSpacing override (existing P19.7 split convention)", () => {
  const idx = charlieIndex();
  useEditorStore.getState().setWordStyleOverride("b", idx, { letterSpacing: 7 });
  const ok = useEditorStore.getState().splitWord("b", idx, "CHAR", "LIE");
  assert.equal(ok, true);
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(sub.words[idx].text, "CHAR");
  assert.equal(sub.words[idx + 1].text, "LIE");
  assert.equal(sub.words[idx].style?.letterSpacing, 7, "left half keeps the override");
  assert.equal(sub.words[idx + 1].style?.letterSpacing, 7, "right half keeps the override");
});

test("word merge: the merged word keeps the FIRST word's letterSpacing (existing merge convention), not the second's", () => {
  const idx = charlieIndex();
  useEditorStore.getState().setWordStyleOverride("b", idx, { letterSpacing: 7 }); // CHARLIE
  useEditorStore.getState().splitWord("b", idx, "CHAR", "LIE");
  // Give the SECOND half (LIE) a different override to prove the merge doesn't just take "any" style.
  useEditorStore.getState().setWordStyleOverride("b", idx + 1, { letterSpacing: 11 });
  const ok = useEditorStore.getState().mergeWordWithNext("b", idx);
  assert.equal(ok, true);
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(sub.words[idx].text, "CHAR LIE");
  assert.equal(sub.words[idx].style?.letterSpacing, 7, "merge keeps the FIRST word's style, per the established convention");
});

test("word insertion: the new word inherits the ANCHOR word's letterSpacing override, per word-edit.ts's existing documented style-propagation convention (same as color/fontSize)", () => {
  const idx = charlieIndex();
  useEditorStore.getState().setWordStyleOverride("b", idx, { letterSpacing: 5 });
  const ok = useEditorStore.getState().insertWord("b", idx, "after", "ECHO");
  assert.equal(ok, true);
  const sub = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  const echo = sub.words.find((w) => w.text === "ECHO")!;
  const charlie = sub.words.find((w) => w.text === "CHARLIE")!;
  assert.equal(charlie.style?.letterSpacing, 5, "CHARLIE keeps its own override");
  assert.equal(echo.style?.letterSpacing, 5, "resolveWordInsertion documents propagating the anchor's style onto the new word — not a P19.8 regression, the established convention");
});

// ============================== caption split / merge / ripple delete ==============================

test("caption split: each half's words keep their own letterSpacing override intact", () => {
  useEditorStore.getState().setWordStyleOverride("b", charlieIndex(), { letterSpacing: 3 }); // CHARLIE ends at 4.5
  const result = useEditorStore.getState().splitSubtitleAtTime("b", 4.5);
  assert.equal(result, "ok");
  const subs = useEditorStore.getState().project!.subtitles;
  const charlie = subs.flatMap((s) => s.words).find((w) => w.text === "CHARLIE")!;
  assert.equal(charlie.style?.letterSpacing, 3, "CHARLIE's override survives being placed on whichever side of the caption split it lands on");
});

test("caption merge: both captions' word-level letterSpacing overrides survive into the merged caption", () => {
  useEditorStore.getState().setWordStyleOverride("a", 1, { letterSpacing: 2 }); // "world"
  useEditorStore.getState().setWordStyleOverride("b", charlieIndex(), { letterSpacing: 3 }); // "CHARLIE"
  const result = useEditorStore.getState().mergeWithNext("a");
  assert.equal(result, "ok");
  const merged = useEditorStore.getState().project!.subtitles[0];
  assert.equal(merged.words.find((w) => w.text === "world")!.style?.letterSpacing, 2);
  assert.equal(merged.words.find((w) => w.text === "CHARLIE")!.style?.letterSpacing, 3);
});

test("ripple delete of an earlier caption shifts CHARLIE's timing but leaves its letterSpacing override untouched", () => {
  useEditorStore.getState().setWordStyleOverride("b", charlieIndex(), { letterSpacing: 6 });
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words.find((w) => w.text === "CHARLIE")!;
  const result = useEditorStore.getState().rippleDeleteSubtitles(["a"]);
  assert.equal(result, "ok");
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words.find((w) => w.text === "CHARLIE")!;
  assert.equal(after.style?.letterSpacing, 6, "style untouched by ripple delete");
  assert.notEqual(after.start, before.start, "timing DID shift (ripple delete's whole point)");
});

// ============================== display modes ==============================

test("switching Hinglish/Gujarati Script display mode never touches word.style.letterSpacing", () => {
  useEditorStore.getState().setWordStyleOverride("b", charlieIndex(), { letterSpacing: 6 });
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  useEditorStore.getState().setCaptionOutputMode("original");
  const charlie = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!.words.find((w) => w.text === "CHARLIE")!;
  assert.equal(charlie.style?.letterSpacing, 6, "mode switches only change which text field is displayed, never Word.style");
});

// ============================== performance ==============================

function buildLargeProject(count: number): ProjectData {
  const subtitles: Subtitle[] = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    index: i,
    start: i,
    end: i + 0.9,
    text: "alpha beta",
    words: [
      { text: "alpha", start: i, end: i + 0.4 },
      { text: "beta", start: i + 0.4, end: i + 0.9 },
    ],
  }));
  return fixtureProject({ subtitles });
}

for (const captionCount of [30, 300, 1800, 5400]) {
  test(`performance: setWordStyleOverride({letterSpacing}) stays fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeProject(captionCount));
    const targetIndex = Math.floor(captionCount / 2);
    const start = performance.now();
    useEditorStore.getState().setWordStyleOverride(`s${targetIndex}`, 0, { letterSpacing: 8 });
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 150, `took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);
    assert.equal(useEditorStore.getState().project!.subtitles[targetIndex].words[0].style?.letterSpacing, 8);
  });
}
