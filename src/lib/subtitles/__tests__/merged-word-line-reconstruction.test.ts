/**
 * Task 137421 (P19.12) — fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md
 * §6 (B2): `mergeWords` (word-edit.ts) can produce one Word OBJECT whose own `.text` contains a
 * space (e.g. "hello world"), but `joinWithOriginalLineBreaks` (ass.ts) used to count how many
 * ARRAY ENTRIES belonged to each stored line by re-tokenizing the ORIGINAL text's own per-line
 * text with `.split(/\s+/)` — correct only when every word object is exactly one token. A merged
 * word silently miscounted, borrowing entries from the next line:
 *
 *   words:        [{text:"hello world"}, {text:"foo"}, {text:"bar"}]
 *   original text: "hello world\nfoo bar"
 *   BEFORE this fix: "hello world foo\nbar"   (wrong — "foo" stolen onto line 1)
 *   AFTER this fix:  "hello world\nfoo bar"   (correct — unchanged)
 *
 * The fix makes `joinWithOriginalLineBreaks` walk word objects one at a time, accumulating each
 * one's own token width (from a new `sourceTexts` parameter — the word's own RAW `.text`), until
 * a line's own token target is met or exceeded. A merged word is never split across two lines.
 *
 * Run with: node --test src/lib/subtitles/__tests__/merged-word-line-reconstruction.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { joinWithOriginalLineBreaks, buildAssDocument } from "../ass.ts";
import { applyOutputMode } from "../output-mode.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../../types/subtitle.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

// ============================== joinWithOriginalLineBreaks directly ==============================

test("[MANDATORY REGRESSION] the exact task-specified worked example: one merged multi-token word on line 1, two ordinary words on line 2", () => {
  const originalText = "hello world\nfoo bar";
  const renderedWords = ["hello world", "foo", "bar"]; // one entry per WORD OBJECT
  const sourceTexts = ["hello world", "foo", "bar"]; // same texts here (no case/tag transform)
  const result = joinWithOriginalLineBreaks(originalText, renderedWords, sourceTexts, "\n");
  assert.equal(result, "hello world\nfoo bar");
  assert.notEqual(result, "hello world foo\nbar", "must not reproduce the old bug's exact wrong output");
});

test("merged word followed by normal words on the SAME line: still correct", () => {
  // "hi there" (merged) + "you" all on one stored line.
  const result = joinWithOriginalLineBreaks("hi there you", ["hi there", "you"], ["hi there", "you"]);
  assert.equal(result, "hi there you");
});

test("a merged word spanning what would otherwise be a line boundary is kept atomic (never split mid-word)", () => {
  // Original line-break decision put "hi" and "there" on SEPARATE stored lines — but they've
  // since been merged into ONE word object. The merged object cannot be split, so it lands
  // entirely on the line where its OWN consumption began (its first token's line).
  const originalText = "hi\nthere you"; // line0 target=1 token, line1 target=2 tokens
  const renderedWords = ["hi there", "you"]; // "hi there" is now ONE merged word object
  const sourceTexts = ["hi there", "you"];
  const result = joinWithOriginalLineBreaks(originalText, renderedWords, sourceTexts);
  // Line0's target (1 token) is met/exceeded by consuming the merged word's first entry (which
  // contributes 2 tokens at once, since it can't be split) — so the WHOLE merged word object goes
  // on line0, and "you" (the only remaining word object) goes on line1. Never a broken/empty line,
  // never a silently dropped word.
  assert.equal(result, "hi there\nyou");
});

test("multiple lines, each containing its own merged word: no cross-line contamination", () => {
  const originalText = "aa bb\ncc dd";
  const renderedWords = ["aa bb", "cc dd"]; // TWO separate merged words, one per line
  const sourceTexts = ["aa bb", "cc dd"];
  const result = joinWithOriginalLineBreaks(originalText, renderedWords, sourceTexts);
  assert.equal(result, "aa bb\ncc dd");
});

test("ordinary one-token words (no merge at all) are completely unaffected — byte-for-byte the same as before this fix", () => {
  const originalText = "First short line\nSecond longer line here";
  const words = ["First", "short", "line", "Second", "longer", "line", "here"];
  const result = joinWithOriginalLineBreaks(originalText, words, words);
  assert.equal(result, originalText);
});

test("explicit original line breaks with a removed word already excluded upstream still reconstruct correctly", () => {
  // Simulates the caller having already filtered out removed words before calling this function
  // (as every real call site does) — a merged word combined with that filtering.
  const originalText = "so is good";
  const renderedWords = ["so", "is good"]; // "is" and "good" merged into one word object
  const sourceTexts = ["so", "is good"];
  const result = joinWithOriginalLineBreaks(originalText, renderedWords, sourceTexts);
  assert.equal(result, "so is good");
});

// ============================== ASS export line reconstruction ==============================

test("[MANDATORY REGRESSION] ASS export: a merged multi-token word in a two-line caption reconstructs \\N breaks correctly", () => {
  const words: Word[] = [
    { text: "hello world", start: 0, end: 0.8 }, // merged word object
    { text: "foo", start: 0.8, end: 1.2 },
    { text: "bar", start: 1.2, end: 1.6 },
  ];
  const subs: Subtitle[] = [{ id: "1", index: 0, start: 0, end: 1.6, text: "hello world\nfoo bar", words }];
  const doc = buildAssDocument({
    subtitles: subs,
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    globalAnimation: DEFAULT_ANIMATION,
    playResX: 1080,
    playResY: 1920,
  });
  const textLine = doc.split("\n").find((l) => l.startsWith("Dialogue: 1,"))!;
  // The active-word highlight animation wraps the first interval's active word ("HELLO WORLD") in
  // its own override tags — strip all {...} tag groups before checking word/line placement, so
  // this test only pins the thing it's actually about: where \N lands relative to the words.
  const plain = textLine.replace(/\{[^}]*\}/g, "");
  assert.ok(plain.includes("HELLO WORLD\\NFOO BAR"), `expected "HELLO WORLD\\NFOO BAR" (uppercase — DEFAULT_SUBTITLE_STYLE.textCase) once override tags are stripped, in: ${plain}`);
  assert.ok(!plain.includes("HELLO WORLD FOO\\NBAR"), "must not reproduce the old bug's exact wrong \\N placement");
});

// ============================== derived-mode (Hinglish/Gujarati) line reconstruction ==============================

test("derived-mode (applyOutputMode) reconstruction is unaffected by a merged word when the project is in Original mode (pass-through, no change)", () => {
  const words: Word[] = [
    { text: "hello world", start: 0, end: 0.8 },
    { text: "foo", start: 0.8, end: 1.2 },
    { text: "bar", start: 1.2, end: 1.6 },
  ];
  const subs: Subtitle[] = [{ id: "1", index: 0, start: 0, end: 1.6, text: "hello world\nfoo bar", words }];
  const result = applyOutputMode(subs, "original");
  assert.equal(result, subs, "original mode is a pure passthrough — untouched by this fix");
});

test("derived-mode reconstruction: a merged word with per-word hinglishText already set reconstructs the derived line correctly", () => {
  const words: Word[] = [
    { text: "hello world", hinglishText: "namaste duniya", start: 0, end: 0.8 },
    { text: "foo", hinglishText: "bar", start: 0.8, end: 1.2 },
    { text: "bar", hinglishText: "baz", start: 1.2, end: 1.6 },
  ];
  const subs: Subtitle[] = [{ id: "1", index: 0, start: 0, end: 1.6, text: "hello world\nfoo bar", words }];
  const result = applyOutputMode(subs, "hinglish");
  assert.equal(result[0].text, "namaste duniya\nbar baz");
});
