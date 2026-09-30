/**
 * Store-level tests for `resegmentAll` (Task 118943, P18.10 audit) — this action had ZERO existing
 * test coverage. It rebuilds the ENTIRE project's caption structure from scratch
 * (`snap.subtitles.flatMap((s) => s.words)` fed into `segmentWords`, which walks its input
 * SEQUENTIALLY grouping consecutive words into captions). P18.6 (Task 113528) made non-monotonic
 * `words` array order a permanent, supported state (an explicit word reorder), so a flattened,
 * still-array-order copy is not guaranteed chronological — `segmentWords` then produces a caption
 * whose bounds don't cover one of its own words.
 *
 * Run with: node --test src/store/__tests__/editor-store-resegment.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    id: "p1",
    name: "Resegment fixture",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles: [],
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

test("[MANDATORY REGRESSION] resegmentAll: a non-monotonic caption (P18.6 word reorder) must not produce a resulting caption whose bounds exclude one of its own words", () => {
  const subtitles: Subtitle[] = [
    {
      id: "s1",
      index: 0,
      start: 1.75,
      end: 6.0,
      text: "bravo delta charlie",
      // Array order BRAVO, DELTA, CHARLIE — the exact P18.6 reorder reproduction: DELTA (array
      // index 1) is chronologically LATEST; CHARLIE (array index 2, last) is chronologically
      // BEFORE DELTA.
      words: [
        { text: "BRAVO", start: 2.0, end: 3.0 },
        { text: "DELTA", start: 5.0, end: 6.0 },
        { text: "CHARLIE", start: 3.5, end: 4.5 },
      ],
    },
  ];
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  useEditorStore.getState().resegmentAll();
  const result = useEditorStore.getState().project!.subtitles;
  for (const s of result) {
    for (const w of s.words) {
      assert.ok(
        w.start >= s.start - 1e-6 && w.end <= s.end + 1e-6,
        `word "${w.text}" [${w.start},${w.end}] must fall within its own resulting caption's bounds [${s.start},${s.end}]`,
      );
    }
  }
});

test("resegmentAll: a monotonic (already-chronological) project is unaffected — same behavior as before this task", () => {
  const subtitles: Subtitle[] = [
    { id: "s1", index: 0, start: 0, end: 2, text: "one two", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 1, end: 2 }] },
    { id: "s2", index: 1, start: 2, end: 4, text: "three four", words: [{ text: "three", start: 2, end: 3 }, { text: "four", start: 3, end: 4 }] },
  ];
  useEditorStore.getState().load(fixtureProject({ subtitles }));
  useEditorStore.getState().resegmentAll();
  const result = useEditorStore.getState().project!.subtitles;
  const words = result.flatMap((s) => s.words.map((w) => w.text));
  assert.deepEqual(words, ["one", "two", "three", "four"], "every word survives, in its own real chronological order");
});

test("resegmentAll: empty project is a safe no-op", () => {
  useEditorStore.getState().resegmentAll();
  assert.deepEqual(useEditorStore.getState().project!.subtitles, []);
});
