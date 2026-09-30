/**
 * Pure tests for src/lib/timeline/edit-model.ts — the source-time <-> edited-time remapping layer
 * used by the export pipeline (lib/export-pipeline.ts) whenever a project has any cut ranges (trim,
 * filler-word removal, silence removal). No existing test file covered this module before Task
 * 118943 (P18.10)'s audit.
 *
 * Run with: node --test src/lib/timeline/__tests__/edit-model.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveCuts, normalizeCuts, sourceToEdited, editedToSource, editedDuration, keptRanges, isInsideCut, remapWordsToEdited, remapSubtitlesToEdited } from "../edit-model.ts";
import { DEFAULT_TIMING_RULES } from "../../../types/subtitle.ts";
import type { Subtitle } from "../../../types/subtitle.ts";

test("sourceToEdited/editedToSource: round-trip a point outside any cut", () => {
  const cuts = [{ id: "c1", start: 5, end: 10, reason: "manual" as const }];
  assert.equal(sourceToEdited(2, cuts), 2);
  assert.equal(sourceToEdited(15, cuts), 10);
  assert.equal(editedToSource(10, cuts), 15);
});

test("editedDuration: subtracts every cut's own duration", () => {
  const cuts = [{ id: "c1", start: 0, end: 2, reason: "manual" as const }, { id: "c2", start: 8, end: 9, reason: "manual" as const }];
  assert.equal(editedDuration(10, cuts), 7);
});

test("keptRanges: the surviving source-time ranges, in order", () => {
  const cuts = [{ id: "c1", start: 2, end: 4, reason: "manual" as const }];
  assert.deepEqual(keptRanges(10, cuts), [{ start: 0, end: 2 }, { start: 4, end: 10 }]);
});

test("isInsideCut: true inside, null outside", () => {
  const cuts = [{ id: "c1", start: 2, end: 4, reason: "manual" as const }];
  assert.equal(isInsideCut(3, cuts), cuts[0]);
  assert.equal(isInsideCut(5, cuts), null);
});

test("remapWordsToEdited: drops a word fully inside a cut, shifts the rest", () => {
  const words = [{ text: "a", start: 0, end: 1 }, { text: "cut", start: 2, end: 3 }, { text: "b", start: 4, end: 5 }];
  const cuts = [{ id: "c1", start: 2, end: 3, reason: "manual" as const }];
  const result = remapWordsToEdited(words, cuts);
  assert.deepEqual(result.map((w) => w.text), ["a", "b"]);
  assert.deepEqual([result[1].start, result[1].end], [3, 4]);
});

// ============================== Task 118943 (P18.10) — non-monotonic Word[] order ==============================

test("[MANDATORY REGRESSION] remapSubtitlesToEdited: a non-monotonic caption's resulting start/end must cover ALL of its own words, not just words[0]/words[last]", () => {
  const subtitles: Subtitle[] = [
    {
      id: "s1",
      index: 0,
      start: 1.75,
      end: 6.0,
      text: "bravo delta charlie",
      // Array order BRAVO, DELTA, CHARLIE — the exact P18.6 reorder reproduction. DELTA (array
      // index 1) is chronologically LATEST; CHARLIE (array index 2, array-LAST) is chronologically
      // EARLIER than DELTA.
      words: [
        { text: "BRAVO", start: 2.0, end: 3.0 },
        { text: "DELTA", start: 5.0, end: 6.0 },
        { text: "CHARLIE", start: 3.5, end: 4.5 },
      ],
    },
  ];
  // A cut range far away from this caption — remapWordsToEdited leaves every one of these words'
  // own timing completely unaffected, isolating the start/end derivation bug specifically.
  const cuts = [{ id: "c1", start: 20, end: 25, reason: "manual" as const }];
  const result = remapSubtitlesToEdited(subtitles, cuts, DEFAULT_TIMING_RULES);
  assert.equal(result.length, 1);
  const s = result[0];
  for (const w of s.words) {
    assert.ok(w.start >= s.start - 1e-6 && w.end <= s.end + 1e-6, `word "${w.text}" [${w.start},${w.end}] must fall within the resulting caption's bounds [${s.start},${s.end}]`);
  }
  assert.equal(s.start, 2, "must be the true minimum across every word, not just words[0]");
  assert.equal(s.end, 6, "must be the true maximum across every word, not just words[last]");
});

test("remapSubtitlesToEdited: a monotonic caption is unaffected — same behavior as before this task", () => {
  const subtitles: Subtitle[] = [
    { id: "s1", index: 0, start: 0, end: 2, text: "one two", words: [{ text: "one", start: 0, end: 1 }, { text: "two", start: 1, end: 2 }] },
  ];
  const result = remapSubtitlesToEdited(subtitles, [], DEFAULT_TIMING_RULES);
  assert.deepEqual([result[0].start, result[0].end], [0, 2]);
});

test("effectiveCuts/normalizeCuts: sanity check the module's own base cut-normalization still works (unaffected by this task)", () => {
  const cuts = effectiveCuts(1, 9, 10, []);
  assert.deepEqual(normalizeCuts(cuts, 10), [{ id: "trim-start", start: 0, end: 1, reason: "trim" }, { id: "trim-end", start: 9, end: 10, reason: "trim" }]);
});
