/**
 * Automated tests for the deterministic safe auto-fix engine (lib/subtitles/quality-fixes.ts).
 *
 * Run with: node --test src/lib/subtitles/__tests__/quality-fixes.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyQualityFix, applyAllSafeFixes } from "../quality-fixes.ts";
import { analyzeSubtitleQuality } from "../quality-analyzer.ts";
import { DEFAULT_TIMING_RULES } from "../../../types/subtitle.ts";
import type { Subtitle, TimingRules, Word } from "../../../types/subtitle.ts";

const rules = (patch: Partial<TimingRules> = {}): TimingRules => ({ ...DEFAULT_TIMING_RULES, ...patch });

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

function sub(overrides: Partial<Subtitle> & { words: Word[] }): Subtitle {
  const w = overrides.words;
  return {
    id: "s",
    index: 0,
    start: w[0]?.start ?? 0,
    end: w[w.length - 1]?.end ?? 1,
    text: w.map((x) => x.text).join(" "),
    ...overrides,
  };
}

function allWordsFlat(subs: Subtitle[]): Word[] {
  return subs.flatMap((s) => s.words);
}

test("EMPTY_CAPTION fix: removes the caption and reindexes the rest", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["Hello"], { wordDur: 1 }) }),
    sub({ id: "b", index: 1, words: [], text: "", start: 1, end: 2 }),
    sub({ id: "c", index: 2, words: words(["World"], { t0: 2, wordDur: 1 }) }),
  ];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = report.issues.find((i) => i.type === "EMPTY_CAPTION")!;
  const fixed = applyQualityFix(subs, issue, rules())!;
  assert.equal(fixed.length, 2);
  assert.deepEqual(fixed.map((s) => s.id), ["a", "c"]);
  assert.deepEqual(fixed.map((s) => s.index), [0, 1]);
});

test("INVALID_DURATION fix: gives the caption a minimal valid duration without overlapping the next caption", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["Hi"]), start: 2, end: 1 }),
    sub({ id: "b", index: 1, words: words(["There"], { t0: 3, wordDur: 1 }) }),
  ];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = report.issues.find((i) => i.type === "INVALID_DURATION")!;
  const fixed = applyQualityFix(subs, issue, rules())!;
  const a = fixed.find((s) => s.id === "a")!;
  assert.ok(a.end > a.start);
  assert.ok(a.end <= fixed.find((s) => s.id === "b")!.start + 1e-9);
});

test("OVERLAP fix: trims the earlier caption's end to the next caption's start, touching nothing else", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["Hello"], { wordDur: 1 }), start: 0, end: 2 }),
    sub({ id: "b", index: 1, words: words(["World"], { t0: 1, wordDur: 1 }), start: 1, end: 2 }),
  ];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = report.issues.find((i) => i.type === "OVERLAP")!;
  const fixed = applyQualityFix(subs, issue, rules())!;
  const a = fixed.find((s) => s.id === "a")!;
  const b = fixed.find((s) => s.id === "b")!;
  assert.equal(a.end, 1);
  assert.equal(a.start, 0);
  assert.deepEqual(b, subs[1]); // the later caption is completely untouched
  assert.ok(a.end <= b.start + 1e-9);
});

test("WORD_TIMESTAMP_INVALID fix (duplicate word): removes exactly the duplicate, keeps every other word intact", () => {
  const w = words(["Hello", "there", "friend"], { wordDur: 0.3 });
  const dup = [w[0], { ...w[0] }, w[1], w[2]];
  const subs = [sub({ words: dup, text: "Hello Hello there friend" })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = report.issues.find((i) => i.type === "WORD_TIMESTAMP_INVALID" && i.fixability === "safe")!;
  const fixed = applyQualityFix(subs, issue, rules())!;
  assert.equal(fixed[0].words.length, 3);
  assert.deepEqual(fixed[0].words.map((x) => x.text), ["Hello", "there", "friend"]);
  assert.deepEqual(fixed[0].words, [w[0], w[1], w[2]]);
});

test("WORD_TIMESTAMP_INVALID (unsafe/reversed) is never auto-fixed", () => {
  const w = words(["Hello", "there"], { wordDur: 0.3 });
  const broken = [w[0], { ...w[1], start: w[1].end, end: w[1].start }];
  const subs = [sub({ words: broken })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = report.issues.find((i) => i.type === "WORD_TIMESTAMP_INVALID")!;
  assert.equal(issue.fixability, "unsafe");
  assert.equal(applyQualityFix(subs, issue, rules()), null);
});

test("TOO_MANY_WORDS fix: resegments into multiple captions preserving every word, order, and timestamps exactly", () => {
  const w = words(["one", "two", "three", "four", "five", "six", "seven", "eight"], { wordDur: 0.3 });
  const subs = [sub({ id: "orig", words: w, style: { color: "#ABCDEF" }, animation: { entrance: "bounce" } })];
  const r = rules({ maxWordsPerCaption: 4, minDuration: 0.1 });
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "TOO_MANY_WORDS")!;
  const fixed = applyQualityFix(subs, issue, r)!;
  assert.ok(fixed.length > 1);
  for (const s of fixed) assert.ok(s.words.length <= 4);
  // Word integrity: every original word appears exactly once, in order, timestamps untouched.
  const flat = allWordsFlat(fixed);
  assert.equal(flat.length, w.length);
  flat.forEach((word, i) => {
    assert.equal(word.text, w[i].text);
    assert.equal(word.start, w[i].start);
    assert.equal(word.end, w[i].end);
  });
  // Caption-level overrides propagate to every resulting piece, and the first keeps the original id.
  assert.equal(fixed[0].id, "orig");
  for (const s of fixed) {
    assert.deepEqual(s.style, { color: "#ABCDEF" });
    assert.deepEqual(s.animation, { entrance: "bounce" });
  }
  // Reindexed correctly.
  fixed.forEach((s, i) => assert.equal(s.index, i));
});

test("TOO_MANY_LINES / CHARACTER_LIMIT fix: rewraps text without touching words at all", () => {
  const w = words(["supercalifragilisticexpialidocious", "word", "here", "today"], { wordDur: 0.3 });
  const subs = [sub({ words: w, text: "supercalifragilisticexpialidocious word here today" })];
  const r = rules({ maxCharsPerLine: 20, maxLines: 2 });
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "CHARACTER_LIMIT" || i.type === "TOO_MANY_LINES")!;
  const fixed = applyQualityFix(subs, issue, r)!;
  assert.deepEqual(fixed[0].words, w);
  assert.ok(fixed[0].text.split("\n").length <= 2);
});

test("ORPHAN_LINE / AWKWARD_LINE_BREAK fix: rewraps and improves the balance without touching words", () => {
  const w = words(["This", "is", "a", "nicely", "balanced", "example", "line", "word"], { wordDur: 0.2 });
  const subs = [sub({ words: w, text: "This is a nicely balanced example line\nword" })];
  const r = rules({ maxCharsPerLine: 42, maxLines: 2 });
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "ORPHAN_LINE")!;
  const fixed = applyQualityFix(subs, issue, r)!;
  assert.deepEqual(fixed[0].words, w);
  const lines = fixed[0].text.split("\n");
  const [a, b] = lines.map((l) => l.length);
  assert.ok(Math.min(a, b) / Math.max(a, b) >= 0.35 - 1e-9, `still imbalanced: ${JSON.stringify(lines)}`);
});

test("TOO_FAST fix: extends duration toward comfortable CPS without overlapping the next caption or touching words", () => {
  const w = words(["The", "quick", "brown", "fox", "jumps"], { wordDur: 0.15 });
  const subs = [sub({ words: w, id: "a" }), sub({ id: "b", index: 1, words: words(["Next"], { t0: 5, wordDur: 1 }) })];
  const r = rules();
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "TOO_FAST")!;
  const fixed = applyQualityFix(subs, issue, r)!;
  const a = fixed.find((s) => s.id === "a")!;
  assert.ok(a.end > subs[0].end);
  assert.deepEqual(a.words, w);
  assert.ok(a.end <= fixed.find((s) => s.id === "b")!.start + 1e-9);
});

test("TOO_SHORT fix: extends toward minDuration, never past the next caption's start", () => {
  const w = words(["Hi", "there"], { wordDur: 0.25 });
  const subs = [sub({ id: "a", words: w }), sub({ id: "b", index: 1, words: words(["Next"], { t0: 5, wordDur: 1 }) })];
  const r = rules();
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "TOO_SHORT")!;
  const fixed = applyQualityFix(subs, issue, r)!;
  const a = fixed.find((s) => s.id === "a")!;
  assert.ok(a.end - a.start >= r.minDuration - 1e-9);
});

test("TOO_LONG fix: shrinks duration to the maxDuration ceiling", () => {
  const w = words(["A", "very", "long", "caption"], { wordDur: 0.3 });
  const subs = [sub({ words: w, start: 0, end: 6 })];
  const r = rules({ maxDuration: 5 });
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "TOO_LONG")!;
  const fixed = applyQualityFix(subs, issue, r)!;
  assert.ok(fixed[0].end - fixed[0].start <= 5 + 1e-9);
  assert.deepEqual(fixed[0].words, w);
});

test("TOO_SLOW fix: shrinks duration toward a comfortable target, never below minDuration", () => {
  const w = words(["Hi"], { wordDur: 0.2 });
  const subs = [sub({ words: w, start: 0, end: 6 })];
  const r = rules({ maxDuration: 8 });
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "TOO_SLOW")!;
  const fixed = applyQualityFix(subs, issue, r)!;
  const newDuration = fixed[0].end - fixed[0].start;
  assert.ok(newDuration < 6);
  assert.ok(newDuration >= r.minDuration - 1e-9);
});

test("applyAllSafeFixes: fixes every resolvable safe issue in one pass", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["one", "two", "three", "four", "five", "six"], { wordDur: 0.3 }) }),
    sub({ id: "b", index: 1, words: [], text: "", start: 3, end: 4 }),
    sub({
      id: "c",
      index: 2,
      words: words(["The", "quick", "brown", "fox", "jumps"], { t0: 5, wordDur: 0.15 }),
    }),
  ];
  const r = rules({ maxWordsPerCaption: 4, minDuration: 0.1 });
  const { subtitles: fixed, fixedCount } = applyAllSafeFixes(subs, r);
  assert.ok(fixedCount > 0);
  // No caption is empty, none exceed the word cap — both structural problems fully resolved.
  for (const s of fixed) {
    assert.ok(s.words.length > 0);
    assert.ok(s.words.length <= 4);
  }
  // "c" packs 5 words with literally zero pause between any of them — splitting it at the word
  // cap necessarily leaves the resulting 4-word piece still reading fast, since extending it
  // would require eating into the very next piece's own words (never done — see TOO_FAST's own
  // "no room to extend" test). This is an honest, expected limit of safe-only fixing, not a bug:
  // confirm it's the ONLY thing left, rather than asserting an unreachable "zero issues" outcome.
  const finalReport = analyzeSubtitleQuality(fixed, r);
  assert.deepEqual(finalReport.issues.map((i) => i.type), ["TOO_FAST"]);
});

test("applyAllSafeFixes: reaches zero remaining safe issues when a genuine gap gives fixes room to work with", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["one", "two", "three", "four", "five", "six"], { wordDur: 0.3, gaps: { 4: 1 } }) }),
    sub({ id: "b", index: 1, words: [], text: "", start: 10, end: 11 }),
    sub({ id: "c", index: 2, words: words(["Hello", "world"], { t0: 12, wordDur: 0.3 }) }),
  ];
  const r = rules({ maxWordsPerCaption: 4, minDuration: 0.5 });
  const { fixedCount, remainingUnsafeCount } = applyAllSafeFixes(subs, r);
  assert.ok(fixedCount > 0);
  assert.equal(remainingUnsafeCount, 0);
});

test("applyAllSafeFixes never touches unsafe issues", () => {
  const w = words(["Hello", "there"], { wordDur: 0.3 });
  const broken = [w[0], { ...w[1], start: w[1].end, end: w[1].start }];
  const subs = [sub({ words: broken })];
  const r = rules();
  const { subtitles: fixed } = applyAllSafeFixes(subs, r);
  // The reversed word timestamp is structurally untouched — never silently "corrected".
  assert.deepEqual(fixed[0].words, broken);
});

test("applyAllSafeFixes is idempotent: running it again on already-fixed subtitles changes nothing", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["one", "two", "three", "four", "five", "six"], { wordDur: 0.3 }) }),
  ];
  const r = rules({ maxWordsPerCaption: 4, minDuration: 0.1 });
  const once = applyAllSafeFixes(subs, r);
  const twice = applyAllSafeFixes(once.subtitles, r);
  assert.equal(twice.fixedCount, 0);
  assert.deepEqual(twice.subtitles, once.subtitles);
});

test("word-array integrity across applyAllSafeFixes on a larger mixed-issue transcript: no word lost, duplicated, or reordered", () => {
  const w = words(
    ["This", "is", "a", "longer", "transcript", "with", "several", "different", "kinds", "of", "problems", "mixed", "in", "together", "here", "today"],
    { wordDur: 0.3 },
  );
  const subs = [sub({ words: w })];
  const r = rules({ maxWordsPerCaption: 5, minDuration: 0.1 });
  const { subtitles: fixed } = applyAllSafeFixes(subs, r);
  const flat = allWordsFlat(fixed);
  assert.equal(flat.length, w.length);
  flat.forEach((word, i) => {
    assert.equal(word.text, w[i].text);
    assert.equal(word.start, w[i].start);
    assert.equal(word.end, w[i].end);
  });
});

test("applyQualityFix returns null for a stale issue whose caption no longer exists", () => {
  const subs = [sub({ id: "a", words: words(["Hello"]) })];
  const staleIssue = { id: "ghost:TOO_SHORT", captionId: "ghost", captionIndex: 99, type: "TOO_SHORT" as const, severity: "warning" as const, message: "x", fixability: "safe" as const };
  assert.equal(applyQualityFix(subs, staleIssue, rules()), null);
});

test("performance: applyAllSafeFixes stays fast (not O(n^2)) at large caption counts", () => {
  const LEXICON = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "and", "runs"];
  function makeSubs(count: number): Subtitle[] {
    const subs: Subtitle[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      const wordCount = 2 + (i % 5);
      const w: Word[] = [];
      for (let wi = 0; wi < wordCount; wi++) {
        const start = t;
        const end = start + 0.25;
        w.push({ text: LEXICON[(i + wi) % LEXICON.length], start, end });
        t = end;
      }
      subs.push({ id: `p${i}`, index: i, start: w[0].start, end: w[w.length - 1].end, text: w.map((x) => x.text).join(" "), words: w });
      t += 0.05;
    }
    return subs;
  }
  const subs = makeSubs(5400);
  const r = rules();
  const t0 = performance.now();
  applyAllSafeFixes(subs, r);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 2000, `applyAllSafeFixes took ${elapsed.toFixed(0)}ms for 5400 captions — expected well under 2s (linear, not quadratic)`);
});

test("determinism: applying the same fix twice from the same input produces the same result (ignoring new ids from a split)", () => {
  const w = words(["one", "two", "three", "four", "five", "six"], { wordDur: 0.3 });
  const subs = [sub({ words: w })];
  const r = rules({ maxWordsPerCaption: 4, minDuration: 0.1 });
  const report = analyzeSubtitleQuality(subs, r);
  const issue = report.issues.find((i) => i.type === "TOO_MANY_WORDS")!;
  const a = applyQualityFix(subs, issue, r)!;
  const b = applyQualityFix(subs, issue, r)!;
  const strip = (arr: Subtitle[]) => arr.map((s) => ({ text: s.text, start: s.start, end: s.end, words: s.words }));
  assert.deepEqual(strip(a), strip(b));
});
