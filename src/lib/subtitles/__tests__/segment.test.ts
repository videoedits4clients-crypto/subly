/**
 * Automated tests for automatic caption segmentation (lib/subtitles/segment.ts).
 *
 * Run with: node --test src/lib/subtitles/__tests__/segment.test.ts
 * (or the "test:segmentation" package.json script)
 *
 * Same zero-dependency pattern as hinglish.test.ts: Node's own built-in test runner,
 * explicit relative `.ts` import extensions (required for Node's native ESM resolver —
 * see tsconfig.json's `allowImportingTsExtensions`, added for this).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { segmentWords } from "../segment.ts";
import { DEFAULT_TIMING_RULES } from "../../../types/subtitle.ts";
import type { TimingRules, Word } from "../../../types/subtitle.ts";
import type { TranscriptSegment } from "../../transcription/types.ts";

/** Builds a run of words starting at `t0`, each lasting `wordDur` seconds, with `gaps`
 * (seconds of silence before each word, index-aligned) layered on top. */
function words(texts: string[], opts: { t0?: number; wordDur?: number; gaps?: Record<number, number> } = {}): Word[] {
  const { t0 = 0, wordDur = 0.3, gaps = {} } = opts;
  let t = t0;
  return texts.map((text, i) => {
    t += gaps[i] ?? 0;
    const start = t;
    const end = start + wordDur;
    t = end;
    return { text, start, end };
  });
}

const rules = (patch: Partial<TimingRules> = {}): TimingRules => ({ ...DEFAULT_TIMING_RULES, ...patch });

test("max word count is a hard ceiling — never exceeded even with long captions and no punctuation", () => {
  const w = words(["one", "two", "three", "four", "five", "six", "seven", "eight"]);
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 4, maxCharsPerLine: 200, maxLines: 1, maxDuration: 999 }));
  for (const s of subs) assert.ok(s.words.length <= 4, `caption "${s.text}" has ${s.words.length} words`);
});

test("natural pause preferred over arbitrary word splitting, within the max", () => {
  // "Kal main raat ko" then a long pause before "100 rupees diye the" — with max=6 the
  // pause should end the caption at 4 words rather than mechanically filling to 6.
  const w = words(["Kal", "main", "raat", "ko", "100", "rupees", "diye", "the"], {
    gaps: { 4: 0.6 }, // long pause before "100"
  });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 6, maxCharsPerLine: 200, maxLines: 1, minDuration: 0.1 }));
  assert.equal(subs[0].words.map((x) => x.text).join(" "), "Kal main raat ko");
  assert.equal(subs[1].words.map((x) => x.text).join(" "), "100 rupees diye the");
});

test("sentence boundary (terminal punctuation) is respected before hitting the word max", () => {
  const w = words(["Hello", "there.", "How", "are", "you", "today"]);
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 6, maxCharsPerLine: 200, maxLines: 1, minDuration: 0.1 }));
  assert.equal(subs[0].words.map((x) => x.text).join(" "), "Hello there.");
  assert.equal(subs[1].words.map((x) => x.text).join(" "), "How are you today");
});

test("explicit transcript-segment boundaries become separate captions", () => {
  const w = words(["First", "paragraph", "here", "Second", "paragraph", "starts"]);
  const segments: TranscriptSegment[] = [
    { start: w[0].start, end: w[2].end, text: "First paragraph here" },
    { start: w[3].start, end: w[5].end, text: "Second paragraph starts" },
  ];
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 10, maxCharsPerLine: 200, maxLines: 1, minDuration: 5 }), segments);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].words.map((x) => x.text).join(" "), "First paragraph here");
  assert.equal(subs[1].words.map((x) => x.text).join(" "), "Second paragraph starts");
});

test("word timestamps are passed through unchanged by segmentation", () => {
  const w = words(["alpha", "beta", "gamma", "delta", "epsilon"]);
  const originalTimestamps = w.map((x) => ({ start: x.start, end: x.end }));
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 2, maxCharsPerLine: 200, maxLines: 1 }));
  const flattened = subs.flatMap((s) => s.words);
  assert.equal(flattened.length, w.length);
  flattened.forEach((word, i) => {
    assert.equal(word.start, originalTimestamps[i].start);
    assert.equal(word.end, originalTimestamps[i].end);
  });
});

test("smartSegmentation off: still respects max words, but ignores punctuation/pause early breaks", () => {
  const w = words(["Hello", "there.", "How", "are"], { gaps: { 2: 0.6 } });
  const subs = segmentWords(
    w,
    rules({ maxWordsPerCaption: 4, maxCharsPerLine: 200, maxLines: 1, minDuration: 0.1, smartSegmentation: false }),
  );
  // No early break at "there." or at the pause before "How" — one caption of all 4 words
  // (the hard max), not split at the sentence end or the pause.
  assert.equal(subs.length, 1);
  assert.equal(subs[0].words.length, 4);
});

test("merge-back pass never produces a caption over maxWordsPerCaption", () => {
  // A lone trailing word after a long pause would normally get folded into the previous
  // caption — but not if doing so would exceed the word cap.
  const w = words(["a", "b", "c", "d"], { gaps: { 3: 0.6 } });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 3, maxCharsPerLine: 200, maxLines: 1, minDuration: 5, maxDuration: 999 }));
  for (const s of subs) assert.ok(s.words.length <= 3);
});

// ---------------------------------------------------------------------------------------
// P2 Intelligent Subtitle Segmentation & Readability — new tests for this phase's changes.
// ---------------------------------------------------------------------------------------

test("readability: a too-fast caption's end is extended toward a comfortable CPS, without touching word timestamps", () => {
  // 5 short words spoken in 0.75s ("The quick brown fox jumps" = 26 chars) is ~35 CPS raw —
  // well above the FAST_READING_CPS=20 threshold. Segmentation should hold it on screen
  // longer than the last word's own end, without altering the words themselves.
  const w = words(["The", "quick", "brown", "fox", "jumps"], { wordDur: 0.15 });
  const originalWordEnds = w.map((x) => x.end);
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 5, minDuration: 0.1, maxCharsPerLine: 200, maxLines: 1, maxDuration: 5 }));
  assert.equal(subs.length, 1);
  const sub = subs[0];
  const rawEnd = w[w.length - 1].end;
  assert.ok(sub.end > rawEnd, `subtitle end (${sub.end}) should extend past the last word's own end (${rawEnd})`);
  const cps = sub.text.length / (sub.end - sub.start);
  assert.ok(cps <= 20 + 1e-9, `extended CPS (${cps}) should be at/under the readable threshold`);
  // Word timestamps themselves are completely untouched by the extension.
  sub.words.forEach((word, i) => assert.equal(word.end, originalWordEnds[i]));
});

test("readability: duration extension never overlaps the next caption's start", () => {
  // A fast trailing caption immediately followed by another one with barely any gap —
  // extension must stop exactly at the next caption's start, never overlap it.
  const w = words(["Go", "now."], { wordDur: 0.1, gaps: { 1: 0 } });
  const w2 = words(["Then", "stop."], { t0: 0.25, wordDur: 0.1 });
  const all = [...w, ...w2];
  const subs = segmentWords(all, rules({ maxWordsPerCaption: 2, minDuration: 2, maxDuration: 5, maxCharsPerLine: 200, maxLines: 1 }));
  assert.equal(subs.length, 2);
  assert.ok(subs[0].end <= subs[1].start + 1e-9, `extended end (${subs[0].end}) must not exceed the next caption's start (${subs[1].start})`);
});

test("readability: duration extension never exceeds the caption's own maxDuration ceiling", () => {
  const w = words(["Hi"], { wordDur: 0.1 });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 4, minDuration: 0.1, maxDuration: 3, maxCharsPerLine: 200, maxLines: 1 }));
  assert.ok(subs[0].end - subs[0].start <= 3 + 1e-9);
});

test("readability: a caption already comfortable to read is left completely unchanged", () => {
  const w = words(["Hello", "there"], { wordDur: 1 }); // 2s for 11 chars — very comfortable
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 2, minDuration: 0.1, maxCharsPerLine: 200, maxLines: 1 }));
  assert.equal(subs[0].end, w[w.length - 1].end);
});

test("Hindi: a Devanagari danda (।) is recognized as a sentence boundary, same as a Latin period", () => {
  const w = words(["नमस्ते", "आप", "कैसे", "हैं।", "मैं", "ठीक", "हूँ"], { wordDur: 0.4 });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 10, minDuration: 0.1, maxCharsPerLine: 200, maxLines: 1 }));
  assert.equal(subs.length, 2, "should break at the danda instead of running the whole sentence together");
  assert.equal(subs[0].words.map((x) => x.text).join(" "), "नमस्ते आप कैसे हैं।");
  assert.equal(subs[1].words.map((x) => x.text).join(" "), "मैं ठीक हूँ");
});

test("Hindi: a Devanagari double danda (॥) is also recognized as a sentence boundary", () => {
  const w = words(["श्लोक", "समाप्त॥", "अगला", "भाग"], { wordDur: 0.4 });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 10, minDuration: 0.1, maxCharsPerLine: 200, maxLines: 1 }));
  assert.equal(subs.length, 2);
  assert.equal(subs[0].words.map((x) => x.text).join(" "), "श्लोक समाप्त॥");
});

test("orphan-word prevention: a single-word FIRST caption forced by an explicit boundary stays its own caption but is held to a readable duration, not silently merged away", () => {
  // A real gap (1s) between "Well," and "I" so there's actual room to extend "Well,"'s
  // duration without overlapping the next caption.
  const w = words(["Well,", "I", "think", "we", "should", "go"], { wordDur: 0.4, gaps: { 1: 1.0 } });
  const segments = [
    { start: w[0].start, end: w[0].end, text: "Well," },
    { start: w[1].start, end: w[w.length - 1].end, text: "I think we should go" },
  ];
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 6, minDuration: 0.8, maxDuration: 999, maxCharsPerLine: 200, maxLines: 1 }), segments);
  // The explicit transcript boundary is respected (not merged away, same as any other
  // explicit boundary) — but the orphaned single word is still held long enough to read
  // comfortably instead of flashing by at its own (very short) word duration.
  assert.equal(subs.length, 2);
  assert.equal(subs[0].words.map((x) => x.text).join(" "), "Well,");
  assert.ok(subs[0].end - subs[0].start >= 0.8 - 1e-9, "orphaned first word should still be held to a readable minimum duration");
  assert.ok(subs[0].end <= subs[1].start + 1e-9, "the readability extension must not overlap the next caption");
});

test("orphan-word prevention: does NOT merge across a genuine explicit provider boundary when the first segment already meets minDuration", () => {
  // The first segment here is short (1.2s, still >= a small minDuration) but ended at a real
  // explicit transcript-segment boundary — that boundary must be respected, not silently
  // merged away just because a later segment is available to absorb it into.
  const w = words(["First", "part", "done"], { wordDur: 0.4 });
  const w2 = words(["Second", "part"], { t0: w[w.length - 1].end, wordDur: 0.4 });
  const all = [...w, ...w2];
  const segments = [
    { start: w[0].start, end: w[w.length - 1].end, text: "First part done" },
    { start: w2[0].start, end: w2[w2.length - 1].end, text: "Second part" },
  ];
  const subs = segmentWords(all, rules({ maxWordsPerCaption: 10, minDuration: 1, maxDuration: 999, maxCharsPerLine: 200, maxLines: 1 }), segments);
  assert.equal(subs.length, 2, "an explicit boundary on a non-orphan first segment must stay respected");
});

test("language compatibility: Hinglish/Gujarati-Script derived per-word fields survive segmentation unmodified (legacy projects, output-mode switching)", () => {
  const w = words(["नमस्ते", "आप", "कैसे", "हैं"], { wordDur: 0.4 });
  w[0] = { ...w[0], hinglishText: "Namaste" };
  w[2] = { ...w[2], gujaratiScriptText: "કૈસે" };
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 10, minDuration: 0.1, maxCharsPerLine: 200, maxLines: 1 }));
  const flat = subs.flatMap((s) => s.words);
  assert.equal(flat.find((x) => x.text === "नमस्ते")?.hinglishText, "Namaste");
  assert.equal(flat.find((x) => x.text === "कैसे")?.gujaratiScriptText, "કૈસે");
});

test("word-array integrity: every word appears exactly once, in original order, across a longer synthetic transcript", () => {
  const texts = [
    "This", "is", "a", "longer", "synthetic", "transcript", "with", "several", "sentences.",
    "It", "has", "commas,", "semicolons;", "and", "colons:", "too.",
    "There", "is", "also", "a", "long", "pause", "before", "this", "next", "part",
    "and", "then", "it", "keeps", "going", "for", "quite", "a", "while", "longer",
    "until", "it", "finally", "ends.",
  ];
  const w = words(texts, { wordDur: 0.25, gaps: { 20: 0.7 } });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 5 }));
  const flattened = subs.flatMap((s) => s.words);
  assert.equal(flattened.length, w.length, "no word lost or duplicated");
  flattened.forEach((word, i) => {
    assert.equal(word.text, w[i].text, `word ${i} out of order or altered`);
    assert.equal(word.start, w[i].start);
    assert.equal(word.end, w[i].end);
  });
});

test("no unintended overlaps: consecutive generated captions never overlap, even after readability extension", () => {
  const texts = ["Quick", "words", "here.", "Then", "more", "quick", "words", "right", "after."];
  const w = words(texts, { wordDur: 0.12 }); // fast speech, forces CPS extension on several captions
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 3, minDuration: 0.1, maxCharsPerLine: 200, maxLines: 1, maxDuration: 5 }));
  for (let i = 1; i < subs.length; i++) {
    assert.ok(subs[i].start >= subs[i - 1].end - 1e-9, `caption ${i} starts (${subs[i].start}) before caption ${i - 1} ends (${subs[i - 1].end})`);
  }
});

test("determinism: segmenting the same input twice produces identical structure (ignoring generated ids)", () => {
  const w = words(["One", "two", "three,", "four", "five.", "Six", "seven", "eight"], { wordDur: 0.3, gaps: { 5: 0.5 } });
  const a = segmentWords(w, rules({ maxWordsPerCaption: 4 }));
  const b = segmentWords(w, rules({ maxWordsPerCaption: 4 }));
  const strip = (subs: typeof a) => subs.map((s) => ({ text: s.text, start: s.start, end: s.end, words: s.words }));
  assert.deepEqual(strip(a), strip(b));
});

test("style/animation-bearing words pass through segmentation completely unmodified", () => {
  const w = words(["Hello", "there", "friend"], { wordDur: 0.5 });
  w[1] = { ...w[1], style: { color: "#00FFAA" } };
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 5, maxCharsPerLine: 200, maxLines: 1 }));
  const styledWord = subs.flatMap((s) => s.words).find((x) => x.text === "there");
  assert.deepEqual(styledWord?.style, { color: "#00FFAA" });
});

test("two-line balancing: a long sentence crossing the character ceiling avoids a lopsided one-word trailing line", () => {
  const w = words("I really think we should go to the store and buy some milk today".split(" "), { wordDur: 0.3 });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 20, minDuration: 0.1, maxDuration: 999, maxCharsPerLine: 42, maxLines: 2 }));
  for (const s of subs) {
    const lines = s.text.split("\n");
    assert.ok(lines.length <= 2);
    if (lines.length === 2) {
      const [a, b] = lines;
      const longer = Math.max(a.length, b.length);
      const shorter = Math.min(a.length, b.length);
      assert.ok(longer - shorter <= longer * 0.7, `lines too lopsided: "${a}" / "${b}"`);
    }
  }
});

test("extremely long caption: a huge maxWordsPerCaption still respects maxCharsPerLine * maxLines", () => {
  const texts = Array.from({ length: 60 }, (_, i) => `word${i}`);
  const w = words(texts, { wordDur: 0.2 });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 200, minDuration: 0.1, maxDuration: 999, maxCharsPerLine: 42, maxLines: 2 }));
  for (const s of subs) {
    assert.ok(s.text.replace(/\n/g, " ").length <= 42 * 2);
  }
});

test("extremely short caption: a single short word still gets a readable minimum duration when nothing follows to merge with", () => {
  const w = words(["Go"], { wordDur: 0.1 });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 1, minDuration: 0.8, maxDuration: 5, maxCharsPerLine: 200, maxLines: 1 }));
  assert.equal(subs.length, 1);
  assert.ok(subs[0].end - subs[0].start >= 0.8 - 1e-9, "an isolated too-short caption should be held to the configured minimum duration");
});

test("conjunction/preposition word-count boundary: forcing a hard break mid-phrase still preserves every word correctly", () => {
  const w = words(["We", "went", "to", "the", "store", "and", "bought", "milk"], { wordDur: 0.3 });
  const subs = segmentWords(w, rules({ maxWordsPerCaption: 5, minDuration: 0.1, maxCharsPerLine: 200, maxLines: 1 }));
  const flattened = subs.flatMap((s) => s.words).map((x) => x.text);
  assert.deepEqual(flattened, w.map((x) => x.text));
});

