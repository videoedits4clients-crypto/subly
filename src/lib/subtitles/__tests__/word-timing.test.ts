/**
 * Regression tests for word-level timing helpers (Task 92618, P7.2 — src/lib/subtitles/word-timing.ts).
 * Pure functions only — no store, no React.
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-timing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenizeCaptionText,
  hasWordTiming,
  isWordTimingStale,
  sumWordTokens,
  evenlyDistributeWords,
  getRenderableWordSegments,
  clampWordTiming,
  clampWordsToCaptionBounds,
  validateWordsWithinCaptionBounds,
  findChronologicalWordNeighbors,
  MIN_WORD_DURATION_SEC,
  WORD_NUDGE_STEP_SEC,
} from "../word-timing.ts";
import { generateHinglishForSubtitle, generateGujaratiScriptForSubtitle, applyOutputModeToWords } from "../output-mode.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

function word(text: string, start: number, end: number, extra: Partial<Word> = {}): Word {
  return { text, start, end, ...extra };
}

// --- tokenizeCaptionText -----------------------------------------------------------------

test("1. tokenizeCaptionText splits on whitespace/newlines and drops empty tokens", () => {
  assert.deepEqual(tokenizeCaptionText("Hello   world\nagain"), ["Hello", "world", "again"]);
  assert.deepEqual(tokenizeCaptionText("  "), []);
  assert.deepEqual(tokenizeCaptionText(""), []);
});

// --- hasWordTiming / isWordTimingStale ----------------------------------------------------

test("2. hasWordTiming is false for an empty or missing words array (no word-level timing, not an error)", () => {
  assert.equal(hasWordTiming({ words: [] }), false);
  assert.equal(hasWordTiming({ words: undefined as unknown as Word[] }), false);
});

test("3. hasWordTiming is true whenever words has at least one entry", () => {
  assert.equal(hasWordTiming({ words: [word("hi", 0, 1)] }), true);
});

test("4. isWordTimingStale is false when there is no word timing at all (distinct from stale)", () => {
  assert.equal(isWordTimingStale({ text: "hello world", words: [] }), false);
});

test("5. isWordTimingStale is false when word count matches the current text's token count", () => {
  const words = [word("hello", 0, 0.5), word("world", 0.5, 1)];
  assert.equal(isWordTimingStale({ text: "hello world", words }), false);
});

test("6. isWordTimingStale is true when a text edit changed the word count", () => {
  const words = [word("hello", 0, 0.5), word("world", 0.5, 1)];
  assert.equal(isWordTimingStale({ text: "hello there world", words }), true);
  assert.equal(isWordTimingStale({ text: "hello", words }), true);
});

// Task 102741 (P15): a merged word's OWN text can contain a space ("hello world" as ONE Word
// object — see lib/subtitles/word-edit.ts mergeWords) — isWordTimingStale must count each word's
// own internal tokens, not just `words.length`, so a caption immediately after a deliberate merge
// reads as fresh, never falsely stale (see isWordTimingStale's own doc comment for the full
// reasoning).

test("6b. isWordTimingStale is false for a caption containing a merged (multi-token) word whose total tokens still match the text", () => {
  const words = [word("this is", 1, 1.6), word("subly", 1.6, 2)]; // "this is" merged from two original words
  assert.equal(isWordTimingStale({ text: "this is subly", words }), false);
});

test("6c. isWordTimingStale is still true for a multi-token-word caption whose text was edited AFTER the merge", () => {
  const words = [word("this is", 1, 1.6), word("subly", 1.6, 2)];
  assert.equal(isWordTimingStale({ text: "this is subly now", words }), true);
});

test("6d. isWordTimingStale is unaffected by multi-token words for ordinary single-token word data (backward-compatible — every pre-P15 case still behaves identically)", () => {
  const words = [word("hello", 0, 0.5), word("world", 0.5, 1)];
  assert.equal(isWordTimingStale({ text: "hello world", words }), false);
  assert.equal(isWordTimingStale({ text: "hello there world", words }), true);
});

// --- sumWordTokens / isWordTimingStale + removed words (Task 107284, P17.3) ---------------
//
// Root cause reproduced and fixed by this task: EVERY function that builds a caption-level
// displayed text — `segmentWords` (lib/subtitles/segment.ts, the REAL pipeline used at
// transcription time and after filler-word removal) for the authoritative `Subtitle.text`, and
// `generate*/regenerateHinglishForSubtitle`/`generate*/regenerateGujaratiScriptForSubtitle`
// (output-mode.ts) for the derived `hinglishText`/`gujaratiScriptText` — already excludes
// `removed: true` words when joining. `isWordTimingStale` used to sum EVERY word's own token
// count regardless of `removed`, so a caption with a removed word read as permanently stale in
// EVERY display mode (Original included) the moment its text was built by the real pipeline —
// not merely a Hinglish/Gujarati-Script-only issue, contrary to what P17.2's own hand-authored
// fixture happened to show. `sumWordTokens` (word-timing.ts) is the one shared counting
// convention both `isWordTimingStale` and `getDerivedWordTextSyncStatus` (output-mode.ts) now use.

/** Builds a subtitle the way the REAL pipeline does (segment.ts's segmentWords): the
 * caption-level `text` only ever joins NON-removed words — a removed word stays in `words[]`
 * (for history) but never contributed to the caption's own displayed text in the first place. */
function realPipelineSubtitle(words: Word[]): Subtitle {
  const text = words
    .filter((w) => !w.removed)
    .map((w) => w.text)
    .join(" ");
  return { id: "s", index: 0, start: words[0]?.start ?? 0, end: words[words.length - 1]?.end ?? 1, text, words } as Subtitle;
}

test("A. Original mode + a removed word → correctly NOT stale (real-pipeline-style text already excludes the removed word)", () => {
  const words = [word("नमस्ते", 0, 0.5), word("दुनिया", 0.5, 1, { removed: true }), word("आज", 1, 1.5)];
  const sub = realPipelineSubtitle(words);
  assert.equal(isWordTimingStale(sub), false);
});

test("B. Hinglish mode + a removed word → no false stale result", () => {
  const words = [word("नमस्ते", 0, 0.5), word("दुनिया", 0.5, 1, { removed: true }), word("आज", 1, 1.5)];
  const sub = generateHinglishForSubtitle(realPipelineSubtitle(words));
  const displayWords = applyOutputModeToWords(sub.words, "hinglish");
  assert.equal(isWordTimingStale({ text: sub.hinglishText!, words: displayWords }), false);
});

test("C. Gujarati Script mode + a removed word → no false stale result", () => {
  const words = [word("नमस्ते", 0, 0.5), word("दुनिया", 0.5, 1, { removed: true }), word("आज", 1, 1.5)];
  const sub = generateGujaratiScriptForSubtitle(realPipelineSubtitle(words));
  const displayWords = applyOutputModeToWords(sub.words, "gujarati-script");
  assert.equal(isWordTimingStale({ text: sub.gujaratiScriptText!, words: displayWords }), false);
});

test("D. Genuine timing mismatch WITH a removed word present → still detected as stale", () => {
  const words = [word("नमस्ते", 0, 0.5), word("दुनिया", 0.5, 1, { removed: true }), word("आज", 1, 1.5)];
  const sub = realPipelineSubtitle(words);
  assert.equal(isWordTimingStale({ text: sub.text + " extra", words: sub.words }), true);
});

test("E. Genuine timing mismatch WITHOUT any removed word → still detected as stale (pre-existing behavior, unaffected)", () => {
  const words = [word("hello", 0, 0.5), word("world", 0.5, 1)];
  assert.equal(isWordTimingStale({ text: "hello there world", words }), true);
});

test("F. Multiple removed words → correctly not stale", () => {
  const words = [
    word("a", 0, 0.3, { removed: true }),
    word("b", 0.3, 0.6),
    word("c", 0.6, 0.9, { removed: true }),
    word("d", 0.9, 1.2),
    word("e", 1.2, 1.5, { removed: true }),
  ];
  const sub = realPipelineSubtitle(words);
  assert.equal(sub.text, "b d");
  assert.equal(isWordTimingStale(sub), false);
});

test("G. Removed FIRST word → correctly not stale", () => {
  const words = [word("a", 0, 0.3, { removed: true }), word("b", 0.3, 0.6), word("c", 0.6, 0.9)];
  const sub = realPipelineSubtitle(words);
  assert.equal(sub.text, "b c");
  assert.equal(isWordTimingStale(sub), false);
});

test("H. Removed MIDDLE word → correctly not stale", () => {
  const words = [word("a", 0, 0.3), word("b", 0.3, 0.6, { removed: true }), word("c", 0.6, 0.9)];
  const sub = realPipelineSubtitle(words);
  assert.equal(sub.text, "a c");
  assert.equal(isWordTimingStale(sub), false);
});

test("I. Removed LAST word → correctly not stale", () => {
  const words = [word("a", 0, 0.3), word("b", 0.3, 0.6), word("c", 0.6, 0.9, { removed: true })];
  const sub = realPipelineSubtitle(words);
  assert.equal(sub.text, "a b");
  assert.equal(isWordTimingStale(sub), false);
});

test("J. ALL words removed → explicitly defined and tested: empty text is fresh, any leftover non-empty text is still correctly flagged stale (never silently 'fresh' for a genuinely malformed case)", () => {
  const words = [word("a", 0, 0.3, { removed: true }), word("b", 0.3, 0.6, { removed: true })];
  const sub = realPipelineSubtitle(words);
  assert.equal(sub.text, "");
  assert.equal(isWordTimingStale(sub), false, "zero non-removed tokens vs. zero-token empty text is consistent, not stale");
  assert.equal(isWordTimingStale({ text: "leftover text", words }), true, "a non-empty text with zero non-removed words is a genuine mismatch, must stay stale");
});

test("K. Multi-token merged word (P15) + a removed word → correct token counting (the two concerns compose without interfering)", () => {
  const words = [word("hello there", 0, 0.6), word("filler", 0.6, 0.9, { removed: true }), word("world", 0.9, 1.2)];
  const sub = realPipelineSubtitle(words);
  assert.equal(sub.text, "hello there world");
  assert.equal(isWordTimingStale(sub), false);
  assert.equal(isWordTimingStale({ text: "hello there world now", words }), true, "still detects a genuine post-merge mismatch");
});

test("sumWordTokens excludes removed words and sums each remaining word's own token count", () => {
  const words = [word("hello there", 0, 0.6), word("filler", 0.6, 0.9, { removed: true }), word("world", 0.9, 1.2)];
  assert.equal(sumWordTokens(words, "text"), 3); // "hello there" (2) + "world" (1), "filler" excluded
});

test("sumWordTokens works for the hinglishText/gujaratiScriptText fields too (shared with getDerivedWordTextSyncStatus)", () => {
  const words: Word[] = [
    { text: "a", start: 0, end: 1, hinglishText: "namaste duniya" },
    { text: "b", start: 1, end: 2, hinglishText: "filler", removed: true },
    { text: "c", start: 2, end: 3, hinglishText: "aaj" },
  ];
  assert.equal(sumWordTokens(words, "hinglishText"), 3); // "namaste duniya" (2) + "aaj" (1)
});

// --- evenlyDistributeWords ----------------------------------------------------------------

test("7. evenlyDistributeWords produces the correct count, monotonic, non-overlapping, caption-bounded intervals", () => {
  const words = evenlyDistributeWords(["a", "b", "c", "d"], 10, 12);
  assert.equal(words.length, 4);
  assert.equal(words[0].start, 10);
  assert.equal(words[words.length - 1].end, 12);
  for (let i = 1; i < words.length; i++) {
    assert.ok(words[i].start >= words[i - 1].end - 1e-9, "words must be monotonic/non-overlapping");
  }
  for (const w of words) {
    assert.ok(w.start >= 10 - 1e-9 && w.end <= 12 + 1e-9, "every word must stay within the caption bounds");
  }
});

test("8. evenlyDistributeWords on an empty token list returns an empty array", () => {
  assert.deepEqual(evenlyDistributeWords([], 0, 5), []);
});

test("9. evenlyDistributeWords floors the usable duration at 0.1s even for a near-zero-width caption", () => {
  const words = evenlyDistributeWords(["only"], 5, 5.001);
  assert.equal(words[0].start, 5);
  assert.ok(words[0].end - words[0].start >= 0.1 - 1e-9);
});

// --- getRenderableWordSegments -------------------------------------------------------------

test("10. getRenderableWordSegments returns all words with valid, finite, non-inverted timestamps", () => {
  const subtitle = { words: [word("a", 0, 0.5), word("b", 0.5, 1)] };
  const segments = getRenderableWordSegments(subtitle);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((s) => s.index), [0, 1]);
});

test("11. getRenderableWordSegments skips a word with end <= start (inverted/zero-width) without crashing", () => {
  const subtitle = { words: [word("a", 0, 0.5), word("bad", 1, 1), word("c", 1.2, 1.5)] };
  const segments = getRenderableWordSegments(subtitle);
  assert.deepEqual(segments.map((s) => s.index), [0, 2]);
});

test("12. getRenderableWordSegments skips NaN/non-finite timestamps without crashing", () => {
  const subtitle = { words: [word("ok", 0, 0.5), { text: "bad", start: NaN, end: 1 } as Word, { text: "bad2", start: 1, end: Infinity } as Word] };
  const segments = getRenderableWordSegments(subtitle);
  assert.deepEqual(segments.map((s) => s.index), [0]);
});

test("13. getRenderableWordSegments skips a word missing start/end entirely without crashing", () => {
  const subtitle = { words: [word("ok", 0, 0.5), { text: "missing" } as Word] };
  const segments = getRenderableWordSegments(subtitle);
  assert.deepEqual(segments.map((s) => s.index), [0]);
});

test("14. getRenderableWordSegments handles a null/undefined words array safely (legacy data)", () => {
  assert.deepEqual(getRenderableWordSegments({ words: null as unknown as Word[] }), []);
  assert.deepEqual(getRenderableWordSegments({ words: undefined as unknown as Word[] }), []);
});

test("15. getRenderableWordSegments tolerates duplicate words (same text/timestamps) without crashing — both are kept, not deduped", () => {
  const subtitle = { words: [word("hi", 0, 0.5), word("hi", 0, 0.5)] };
  const segments = getRenderableWordSegments(subtitle);
  assert.equal(segments.length, 2);
});

// --- clampWordTiming -----------------------------------------------------------------------

function makeCaption(words: Word[], start = 0, end = 3): Pick<Subtitle, "start" | "end" | "words"> {
  return { start, end, words };
}

test("16. valid word timing update within all bounds is accepted unchanged", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const sub = makeCaption(words);
  const result = clampWordTiming(sub, 1, 1.2, 1.8);
  assert.deepEqual(result, { start: 1.2, end: 1.8 });
});

test("17. start cannot cross the previous word's end", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const sub = makeCaption(words);
  const result = clampWordTiming(sub, 1, 0.5, 1.8); // trying to move B's start before A's end (1)
  assert.equal(result!.start, 1, "start must clamp to the previous word's end");
});

test("18. end cannot cross the next word's start", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const sub = makeCaption(words);
  const result = clampWordTiming(sub, 1, 1.2, 2.5); // trying to move B's end past C's start (2)
  assert.equal(result!.end, 2, "end must clamp to the next word's start");
});

test("19. start cannot precede the caption's own start (first word, no previous word)", () => {
  const words = [word("A", 0, 1), word("B", 1, 2)];
  const sub = makeCaption(words, 0, 3);
  const result = clampWordTiming(sub, 0, -5, 0.8);
  assert.equal(result!.start, 0, "start must clamp to the caption's own start");
});

test("20. end cannot exceed the caption's own end (last word, no next word)", () => {
  const words = [word("A", 0, 1), word("B", 1, 2)];
  const sub = makeCaption(words, 0, 3);
  const result = clampWordTiming(sub, 1, 1.2, 10);
  assert.equal(result!.end, 3, "end must clamp to the caption's own end");
});

test("21. end cannot become <= start — a minimum duration is always enforced", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const sub = makeCaption(words);
  const result = clampWordTiming(sub, 1, 1.5, 1.5); // requesting a zero-width word
  assert.ok(result!.end - result!.start >= MIN_WORD_DURATION_SEC - 1e-9);
});

test("22. neighboring words remain non-overlapping after a clamp (start+end both requested out of range)", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const sub = makeCaption(words);
  const result = clampWordTiming(sub, 1, -1, 5); // way outside on both sides
  assert.ok(result!.start >= 1 - 1e-9, "must not cross A's end");
  assert.ok(result!.end <= 2 + 1e-9, "must not cross C's start");
});

test("23. clampWordTiming returns null for an out-of-range word index (no crash)", () => {
  const words = [word("A", 0, 1)];
  const sub = makeCaption(words);
  assert.equal(clampWordTiming(sub, 5, 0, 1), null);
  assert.equal(clampWordTiming(sub, -1, 0, 1), null);
});

test("24. clampWordTiming only ever touches the one requested word's bounds — the returned range never depends on unrelated words beyond immediate neighbors", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3), word("D", 3, 4)];
  const sub = makeCaption(words, 0, 4);
  const result = clampWordTiming(sub, 2, 2.1, 2.9); // C, bounded only by B.end (2) and D.start (3)
  assert.deepEqual(result, { start: 2.1, end: 2.9 });
});

// --- Performance (Task 92618, P7.2 §G): word-level detail must be scoped to ONE caption's own
// words, never a function of total project size. This project has already been proven to scale
// to 5,400 captions (see visible-range.test.ts) — these helpers must stay indifferent to that. ---

test("25. getRenderableWordSegments / isWordTimingStale / clampWordTiming cost depends only on ONE caption's own word count — proven at a 5,400-caption project scale", () => {
  // Simulates the scale this project is already tested at (see this repo's own P7.1 report):
  // 5,400 captions, each carrying real word-level data — but every one of these three functions
  // takes a SINGLE subtitle-shaped object as its argument (see their own type signatures), so
  // they structurally cannot scan the other 5,399 captions. This is a regression guard: if a
  // future edit accidentally widened one of these to accept (and iterate) the whole project,
  // this timing assertion would catch the resulting slowdown.
  const bigProject = Array.from({ length: 5400 }, (_, i) => ({
    text: `word${i}a word${i}b word${i}c`,
    words: [
      { text: `word${i}a`, start: i * 3, end: i * 3 + 1 },
      { text: `word${i}b`, start: i * 3 + 1, end: i * 3 + 2 },
      { text: `word${i}c`, start: i * 3 + 2, end: i * 3 + 3 },
    ],
    start: i * 3,
    end: i * 3 + 3,
  }));
  const selected = bigProject[2700]; // an arbitrary caption in the middle of the large project

  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    getRenderableWordSegments(selected);
    isWordTimingStale(selected);
    clampWordTiming(selected, 1, selected.words[1].start, selected.words[1].end);
  }
  const elapsedMs = performance.now() - start;
  assert.ok(elapsedMs < 200, `1000 iterations over a single caption's words should be near-instant regardless of the other 5,399 captions in the project (took ${elapsedMs.toFixed(1)}ms)`);

  // Functional correctness at this scale, not just speed: the selected caption's own segments
  // are still exactly right, untouched by anything about the surrounding project.
  const segments = getRenderableWordSegments(selected);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].word.text, "word2700a");
});

// Task 107284 (P17.3) — the `sumWordTokens`/removed-word fix adds a `.filter()` before the
// existing `.reduce()`, still a single linear pass over ONE caption's own words (O(words in the
// caption), never O(total project captions × words)) — proven at each of the required tiers, not
// just the single 5,400 case above, and specifically exercising a caption WITH a removed word
// (the new code path this task adds).
for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: isWordTimingStale with a removed word stays O(1) (proportional to ONE caption's own words only) at ${captionCount} total captions`, () => {
    const bigProject = Array.from({ length: captionCount }, (_, i) => ({
      text: `word${i}a word${i}c`, // excludes the removed middle word, matching the real segmentWords convention
      words: [
        { text: `word${i}a`, start: i * 3, end: i * 3 + 1 },
        { text: `word${i}b`, start: i * 3 + 1, end: i * 3 + 2, removed: true },
        { text: `word${i}c`, start: i * 3 + 2, end: i * 3 + 3 },
      ],
      start: i * 3,
      end: i * 3 + 3,
    }));
    const selected = bigProject[Math.floor(captionCount / 2)];

    const start = performance.now();
    for (let i = 0; i < 1000; i++) isWordTimingStale(selected);
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 200, `1000 iterations should be near-instant regardless of the other ${captionCount - 1} captions (took ${elapsedMs.toFixed(1)}ms)`);
    assert.equal(isWordTimingStale(selected), false, "still correctly non-stale at this scale");
  });
}

// --- clampWordsToCaptionBounds (Task 93471, P7.3) -----------------------------------------

test("26. clampWordsToCaptionBounds is a no-op (returns the SAME array reference) when every word is already valid", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  const result = clampWordsToCaptionBounds(words, 0, 3);
  assert.equal(result, words, "must return the exact same reference, not a copy, when nothing needs to change");
});

test("27. clampWordsToCaptionBounds repositions a word whose start is before the caption's own start", () => {
  const words = [word("A", -1, 1), word("B", 1, 2)];
  const result = clampWordsToCaptionBounds(words, 0, 2);
  assert.equal(result[0].start, 0, "must clamp up to the caption's own start");
  assert.equal(result[0].end, 1, "end was already valid, must be untouched");
  assert.deepEqual([result[1].start, result[1].end], [1, 2], "an unaffected later word must be untouched");
});

test("28. clampWordsToCaptionBounds repositions a word whose end is after the caption's own end (the RESIZE-shrink scenario)", () => {
  const words = [word("A", 0, 1), word("B", 1, 3)];
  const result = clampWordsToCaptionBounds(words, 0, 2); // caption shrunk to end at 2, B used to run to 3
  assert.deepEqual([result[0].start, result[0].end], [0, 1], "unaffected earlier word must be untouched");
  assert.equal(result[1].end, 2, "must clamp down to the caption's own new end");
  assert.ok(result[1].start < result[1].end, "must remain a valid, non-inverted interval");
});

test("29. clampWordsToCaptionBounds fixes an overlap between two originally-overlapping words (the MERGE-concatenation scenario), preserving monotonic order", () => {
  // Simulates mergeWithNext concatenating a's words (ending at 1.2, due to drift) with b's words
  // (starting at 1.0) — a genuine overlap that a plain [...a.words, ...b.words] would carry
  // straight through untouched.
  const words = [word("A", 0, 1.2), word("B", 1.0, 2)];
  const result = clampWordsToCaptionBounds(words, 0, 2);
  assert.ok(result[1].start >= result[0].end, "B's start must not be before A's (possibly-clamped) end");
  assert.ok(result[0].end > result[0].start && result[1].end > result[1].start, "both words must remain valid, non-inverted intervals");
});

test("30. clampWordsToCaptionBounds preserves every non-timing field (text, style, confidence) untouched", () => {
  const words = [word("A", -5, 1, { confidence: 0.9, style: { color: "#fff" } })];
  const result = clampWordsToCaptionBounds(words, 0, 2);
  assert.equal(result[0].text, "A");
  assert.equal(result[0].confidence, 0.9);
  assert.deepEqual(result[0].style, { color: "#fff" });
  assert.equal(result[0].start, 0, "still repositions the actual violation");
});

test("31. clampWordsToCaptionBounds tolerates a malformed entry (passes it through unchanged rather than crashing or fabricating timing)", () => {
  const malformed = { text: "bad", start: NaN, end: 2 } as Word;
  const words = [word("A", 0, 1), malformed, word("C", 2, 3)];
  const result = clampWordsToCaptionBounds(words, 0, 3);
  assert.equal(result[1], malformed, "the malformed entry itself must be passed through completely untouched");
  assert.deepEqual([result[0].start, result[0].end], [0, 1]);
  assert.deepEqual([result[2].start, result[2].end], [2, 3]);
});

test("32. clampWordsToCaptionBounds on an empty array returns the same empty array reference", () => {
  const words: Word[] = [];
  assert.equal(clampWordsToCaptionBounds(words, 0, 1), words);
});

test("33. WORD_NUDGE_STEP_SEC is the same constant the word-timing popover's own nudge buttons use (0.05s) — a sanity check that the two never silently drift apart", () => {
  assert.equal(WORD_NUDGE_STEP_SEC, 0.05);
});

// --- validateWordsWithinCaptionBounds (Task 115894, P18.8) -------------------------------

test("34. validateWordsWithinCaptionBounds: every word already inside the caption bounds -> ok", () => {
  const words = [word("one", 0.2, 0.8), word("two", 0.8, 1.5)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 2), { ok: true });
});

test("35. validateWordsWithinCaptionBounds: a word starting exactly at captionStart is NOT a violation (half-open [start,end) touching the boundary is valid)", () => {
  const words = [word("one", 0, 1)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 2), { ok: true });
});

test("36. validateWordsWithinCaptionBounds: a word ending exactly at captionEnd is NOT a violation", () => {
  const words = [word("one", 1, 2)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 2), { ok: true });
});

test("37. validateWordsWithinCaptionBounds: a word starting before captionStart is a violation, identifies the offending index", () => {
  const words = [word("one", 0.5, 1.5), word("two", -0.1, 0.4)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 2), { ok: false, wordIndex: 1 });
});

test("38. validateWordsWithinCaptionBounds: a word ending after captionEnd is a violation", () => {
  const words = [word("one", 0, 1), word("two", 1, 2.5)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 2), { ok: false, wordIndex: 1 });
});

test("39. validateWordsWithinCaptionBounds: NON-MONOTONIC array order (a word later in the array is chronologically EARLIER) — validates each word independently, never assumes array order is chronological", () => {
  // BRAVO (index 0) is chronologically LATER than ALFA (index 1) — the exact P18.6-reordered
  // shape this function must never assume away. Both individually fit inside [0, 3.5].
  const words = [word("BRAVO", 2.0, 3.0), word("ALFA", 0.5, 1.5)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 3.5), { ok: true });
  // Now ALFA alone is pushed out of bounds (ends after captionEnd) — must still be caught
  // correctly by its own real index (1), regardless of BRAVO sitting "before" it in the array.
  const words2 = [word("BRAVO", 2.0, 3.0), word("ALFA", 0.5, 4.0)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words2, 0, 3.5), { ok: false, wordIndex: 1 });
});

test("40. validateWordsWithinCaptionBounds: multiple non-monotonic words, only the truly-invalid one is reported", () => {
  const words = [word("CHARLIE", 3.0, 3.5), word("ALFA", 0.0, 1.0), word("BRAVO", 1.0, 2.0), word("DELTA", 3.6, 4.2)];
  // DELTA (index 3) ends after the proposed captionEnd (4.0) — everything else fits.
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 4.0), { ok: false, wordIndex: 3 });
});

test("41. validateWordsWithinCaptionBounds: float noise within the epsilon tolerance at a boundary is not a violation", () => {
  const words = [word("one", -0.0005, 1), word("two", 1, 2.0004)];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 2), { ok: true });
});

test("42. validateWordsWithinCaptionBounds: malformed entries (non-finite start/end) are skipped, never fabricated or flagged", () => {
  const words = [word("one", 0.5, 1.5), { text: "bad", start: NaN, end: NaN } as Word];
  assert.deepEqual(validateWordsWithinCaptionBounds(words, 0, 2), { ok: true });
});

test("43. validateWordsWithinCaptionBounds: empty array -> ok (nothing to violate)", () => {
  assert.deepEqual(validateWordsWithinCaptionBounds([], 0, 2), { ok: true });
});

test("44. validateWordsWithinCaptionBounds: never mutates its input array or any word object", () => {
  const words = [word("one", -1, 5)];
  const snapshot = JSON.parse(JSON.stringify(words));
  validateWordsWithinCaptionBounds(words, 0, 2);
  assert.deepEqual(words, snapshot);
});

// --- findChronologicalWordNeighbors / clampWordTiming (Task 117206, P18.9) ---------------

test("45. findChronologicalWordNeighbors: monotonic array — matches array-adjacent (baseline, unaffected case)", () => {
  const words = [word("A", 0, 1), word("B", 1, 2), word("C", 2, 3)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 1), { prevEnd: 1, nextStart: 2 });
});

test("46. findChronologicalWordNeighbors: the exact P18.6 reproduction — BRAVO/DELTA/CHARLIE array order, CHARLIE's real neighbors are BRAVO and DELTA", () => {
  const words = [word("BRAVO", 2.0, 3.0), word("DELTA", 5.0, 6.0), word("CHARLIE", 3.5, 4.5)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 2), { prevEnd: 3.0, nextStart: 5.0 });
});

test("47. findChronologicalWordNeighbors: target has a chronologically EARLIER word LATER in the array", () => {
  const words = [word("X", 5, 6), word("Y", 0, 1)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: 1, nextStart: null });
});

test("48. findChronologicalWordNeighbors: target has a chronologically LATER word EARLIER in the array", () => {
  const words = [word("Y", 0, 1), word("X", 5, 6)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: null, nextStart: 5 });
});

test("49. findChronologicalWordNeighbors: chronologically FIRST word at a non-zero array index has no previous neighbor", () => {
  const words = [word("B", 3, 4), word("A", 0, 1)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 1), { prevEnd: null, nextStart: 3 });
});

test("50. findChronologicalWordNeighbors: chronologically LAST word at a non-last array index has no next neighbor", () => {
  const words = [word("LAST", 5, 6), word("FIRST", 0, 1)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: 1, nextStart: null });
});

test("51. findChronologicalWordNeighbors: gaps between words don't confuse neighbor-finding — the gap itself is not a factor, just the closest real word on each side", () => {
  const words = [word("A", 0, 1), word("B", 4, 5)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: null, nextStart: 4 });
  assert.deepEqual(findChronologicalWordNeighbors(words, 1), { prevEnd: 1, nextStart: null });
});

test("52. findChronologicalWordNeighbors: words touching exactly at a boundary count as valid neighbors on that side", () => {
  const words = [word("A", 1, 2), word("B", 2, 3)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: null, nextStart: 2 });
  assert.deepEqual(findChronologicalWordNeighbors(words, 1), { prevEnd: 2, nextStart: null });
});

test("53. findChronologicalWordNeighbors: multiple non-monotonic words — picks the CLOSEST real neighbor on each side, not just any qualifying one", () => {
  // Array order: CHARLIE, ALFA, BRAVO, DELTA — real times: ALFA[0,1] BRAVO[1,2] CHARLIE[3,3.5] DELTA[3.6,4.2]
  const words = [word("CHARLIE", 3.0, 3.5), word("ALFA", 0.0, 1.0), word("BRAVO", 1.0, 2.0), word("DELTA", 3.6, 4.2)];
  // CHARLIE (index 0): closest real predecessor is BRAVO (end=2), not ALFA (end=1); closest successor is DELTA (start=3.6).
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: 2.0, nextStart: 3.6 });
});

test("54. findChronologicalWordNeighbors: a candidate that OVERLAPS the target (corrupt data) qualifies as neither a previous nor a next neighbor", () => {
  const words = [word("A", 1, 3), word("B", 2, 4)]; // genuinely overlapping
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: null, nextStart: null });
  assert.deepEqual(findChronologicalWordNeighbors(words, 1), { prevEnd: null, nextStart: null });
});

test("55. findChronologicalWordNeighbors: a REMOVED word still counts as a blocking neighbor (pre-existing clampWordTiming behavior — never special-cased removed, unchanged)", () => {
  const words = [word("A", 0, 1, { removed: true }), word("B", 2, 3)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 1), { prevEnd: 1, nextStart: null });
});

test("56. findChronologicalWordNeighbors: malformed candidates (non-finite start/end) are skipped, never treated as a neighbor", () => {
  const words = [word("A", 0, 1), { text: "bad", start: NaN, end: NaN } as Word, word("C", 5, 6)];
  assert.deepEqual(findChronologicalWordNeighbors(words, 0), { prevEnd: null, nextStart: 5 });
});

test("57. findChronologicalWordNeighbors: a malformed TARGET returns {null, null} rather than crashing or fabricating", () => {
  const words = [word("A", 0, 1), { text: "bad", start: NaN, end: NaN } as Word];
  assert.deepEqual(findChronologicalWordNeighbors(words, 1), { prevEnd: null, nextStart: null });
});

test("58. findChronologicalWordNeighbors: a lone word (no other words at all) has no neighbors on either side", () => {
  assert.deepEqual(findChronologicalWordNeighbors([word("only", 0, 1)], 0), { prevEnd: null, nextStart: null });
});

test("59. findChronologicalWordNeighbors: never mutates or reorders its input array", () => {
  const words = [word("B", 2, 3), word("A", 0, 1)];
  const snapshot = JSON.parse(JSON.stringify(words));
  findChronologicalWordNeighbors(words, 0);
  assert.deepEqual(words, snapshot);
  assert.deepEqual(words.map((w) => w.text), ["B", "A"], "array order itself must never change");
});

test("60. clampWordTiming: the exact P18.6/P18.9 reproduction now clamps CHARLIE against its real neighbors (3.0-5.0), not DELTA's array position (6.0-6.0)", () => {
  const subtitle = { start: 1.75, end: 6.0, words: [word("BRAVO", 2.0, 3.0), word("DELTA", 5.0, 6.0), word("CHARLIE", 3.5, 4.5)] };
  const result = clampWordTiming(subtitle, 2, 3.6, 4.5);
  assert.deepEqual(result, { start: 3.6, end: 4.5 });
});

test("61. clampWordTiming: rejects (returns null) when the real chronological neighbors leave no room for even a minimum-duration word", () => {
  // TARGET's own CURRENT position (a pre-existing zero-width/degenerate entry — corrupt data, the
  // scenario this guard exists for) sits exactly where A ends and B starts, so both qualify as
  // neighbors with zero room between them, regardless of what's being requested.
  const subtitle = { start: 0, end: 3, words: [word("A", 0, 1.5), word("TARGET", 1.5, 1.5), word("B", 1.5, 3)] };
  const result = clampWordTiming(subtitle, 1, 1.4, 1.6);
  assert.equal(result, null);
});

test("62. clampWordTiming: still returns null for an out-of-range wordIndex (pre-existing contract, unchanged)", () => {
  const subtitle = { start: 0, end: 2, words: [word("A", 0, 1)] };
  assert.equal(clampWordTiming(subtitle, 5, 0, 1), null);
  assert.equal(clampWordTiming(subtitle, -1, 0, 1), null);
});

test("63. clampWordTiming: a lone word in a caption is still bounded by the caption's own start/end, exactly as before", () => {
  const subtitle = { start: 0, end: 2, words: [word("only", 0.5, 1)] };
  const result = clampWordTiming(subtitle, 0, -5, 10);
  assert.deepEqual(result, { start: 0, end: 2 });
});
