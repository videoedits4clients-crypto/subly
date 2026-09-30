/**
 * Automated tests for the deterministic subtitle quality analyzer (lib/subtitles/quality-analyzer.ts).
 *
 * Run with: node --test src/lib/subtitles/__tests__/quality-analyzer.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSubtitleQuality, deriveQualityState, isQualityReportStale } from "../quality-analyzer.ts";
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

function findIssue(report: ReturnType<typeof analyzeSubtitleQuality>, type: string, captionId = "s") {
  return report.issues.find((i) => i.type === type && i.captionId === captionId);
}

test("1. clean subtitles: no issues at all", () => {
  const subs: Subtitle[] = [
    sub({ id: "a", index: 0, words: words(["Hello", "there"], { wordDur: 0.5 }) }),
    sub({ id: "b", index: 1, words: words(["General", "Kenobi"], { t0: 1.2, wordDur: 0.5 }) }),
  ];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.deepEqual(report.issues, []);
  assert.equal(report.captionsWithIssues, 0);
  assert.equal(report.safeFixCount, 0);
});

test("2. too-fast caption is flagged with measured CPS and threshold", () => {
  const w = words(["The", "quick", "brown", "fox", "jumps"], { wordDur: 0.15 });
  const subs = [sub({ words: w })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "TOO_FAST");
  assert.ok(issue);
  assert.equal(issue!.severity, "warning");
  assert.equal(issue!.fixability, "safe");
  assert.ok(issue!.value! > issue!.threshold!);
});

test("3. too-slow caption (way more time than the content needs) is flagged as info, not a hard error", () => {
  const w = words(["Hi"], { wordDur: 0.2 });
  const subs = [sub({ words: w, start: 0, end: 6 })]; // way beyond what "Hi" needs at any CPS
  const report = analyzeSubtitleQuality(subs, rules({ maxDuration: 8 }));
  const issue = findIssue(report, "TOO_SLOW");
  assert.ok(issue);
  assert.equal(issue!.severity, "info");
});

test("4. too-short caption (below configured minDuration but above the hard floor) is a warning", () => {
  const w = words(["Hi", "there"], { wordDur: 0.25 });
  const subs = [sub({ words: w })]; // ~0.5s, below default minDuration 0.8 but above hard floor 0.4
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "TOO_SHORT");
  assert.ok(issue);
  assert.equal(issue!.severity, "warning");
});

test("4b. too-short caption below the hard floor is an error", () => {
  const w = words(["Hi"], { wordDur: 0.1 });
  const subs = [sub({ words: w, start: 0, end: 0.1 })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "TOO_SHORT");
  assert.equal(issue!.severity, "error");
});

test("5. too-long caption exceeding configured maxDuration is a warning", () => {
  const w = words(["A", "very", "long", "caption", "held", "on", "screen"], { wordDur: 0.3 });
  const subs = [sub({ words: w, start: 0, end: 6 })];
  const report = analyzeSubtitleQuality(subs, rules({ maxDuration: 5 }));
  const issue = findIssue(report, "TOO_LONG");
  assert.ok(issue);
  assert.equal(issue!.severity, "warning");
});

test("6. overlapping captions are flagged as an error on the earlier caption", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["Hello"], { wordDur: 1 }), start: 0, end: 2 }),
    sub({ id: "b", index: 1, words: words(["World"], { t0: 1, wordDur: 1 }), start: 1, end: 2 }),
  ];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "OVERLAP", "a");
  assert.ok(issue);
  assert.equal(issue!.severity, "error");
  assert.equal(issue!.fixability, "safe");
});

test("7. invalid duration (end <= start) is an error and short-circuits other checks on that caption", () => {
  const subs = [sub({ words: words(["Hi"]), start: 2, end: 1 })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "INVALID_DURATION");
  assert.ok(issue);
  assert.equal(issue!.severity, "error");
  // No other issue types should be reported for a caption whose time range is invalid.
  assert.equal(report.issues.filter((i) => i.captionId === "s").length, 1);
});

test("8. max-word violation is flagged with the exact word count and threshold", () => {
  const w = words(["one", "two", "three", "four", "five", "six"], { wordDur: 0.3 });
  const subs = [sub({ words: w })];
  const report = analyzeSubtitleQuality(subs, rules({ maxWordsPerCaption: 4 }));
  const issue = findIssue(report, "TOO_MANY_WORDS");
  assert.ok(issue);
  assert.equal(issue!.value, 6);
  assert.equal(issue!.threshold, 4);
});

test("9. max-character violation (a single long line) is flagged", () => {
  const w = words(["supercalifragilisticexpialidocious", "word"], { wordDur: 0.3 });
  const subs = [sub({ words: w, text: "supercalifragilisticexpialidocious word" })];
  const report = analyzeSubtitleQuality(subs, rules({ maxCharsPerLine: 20, maxLines: 1 }));
  const issue = findIssue(report, "CHARACTER_LIMIT");
  assert.ok(issue);
});

test("10. poor two-line break (one line a lone word next to a much longer line) is flagged as ORPHAN_LINE", () => {
  const w = words(["This", "is", "a", "nicely", "balanced", "example", "line", "word"], { wordDur: 0.2 });
  const subs = [sub({ words: w, text: "This is a nicely balanced example line\nword" })];
  const report = analyzeSubtitleQuality(subs, rules({ maxCharsPerLine: 42, maxLines: 2 }));
  const issue = findIssue(report, "ORPHAN_LINE");
  assert.ok(issue);
});

test("11. valid, well-balanced two-line break raises no line-break issue", () => {
  const w = words(["This", "is", "a", "nicely", "balanced", "two", "line", "caption", "example", "here"], { wordDur: 0.2 });
  const subs = [sub({ words: w, text: "This is a nicely balanced\ntwo line caption example here" })];
  const report = analyzeSubtitleQuality(subs, rules({ maxCharsPerLine: 42, maxLines: 2 }));
  assert.equal(findIssue(report, "AWKWARD_LINE_BREAK"), undefined);
  assert.equal(findIssue(report, "ORPHAN_LINE"), undefined);
  assert.equal(findIssue(report, "CHARACTER_LIMIT"), undefined);
});

test("12. missing word timestamps on a non-empty caption is EMPTY_CAPTION (no usable words)", () => {
  const subs = [sub({ words: [], text: "Hello there" })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "EMPTY_CAPTION");
  assert.ok(issue);
  assert.equal(issue!.fixability, "safe");
});

test("13. duplicated word (identical text AND identical timestamps) is a safe WORD_TIMESTAMP_INVALID", () => {
  const w = words(["Hello", "there"], { wordDur: 0.3 });
  const dup = [w[0], { ...w[0] }, w[1]];
  const subs = [sub({ words: dup, text: "Hello Hello there" })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "WORD_TIMESTAMP_INVALID");
  assert.ok(issue);
  assert.equal(issue!.fixability, "safe");
  // Task 99261 (P12): review navigation needs the exact word index — the duplicate itself
  // (index 1), not the original it duplicates (index 0).
  assert.equal(issue!.wordIndex, 1);
});

test("14. reversed word timestamp (end before start) is an unsafe WORD_TIMESTAMP_INVALID", () => {
  const w = words(["Hello", "there"], { wordDur: 0.3 });
  const broken = [w[0], { ...w[1], start: w[1].end, end: w[1].start }];
  const subs = [sub({ words: broken })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "WORD_TIMESTAMP_INVALID");
  assert.ok(issue);
  assert.equal(issue!.fixability, "unsafe");
  // Task 99261 (P12): the malformed word's own index (1), for review-navigation word selection.
  assert.equal(issue!.wordIndex, 1);
});

test("P12: a caption-level issue (e.g. TOO_FAST) never carries a wordIndex — never a fabricated word target", () => {
  const w = words(["The", "quick", "brown", "fox", "jumps"], { wordDur: 0.15 });
  const subs = [sub({ words: w })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "TOO_FAST");
  assert.ok(issue);
  assert.equal(issue!.wordIndex, undefined);
});

test("15. a caption with a word-level style override raises no issue by itself, and the override isn't reported as a problem", () => {
  const w = words(["Hello", "there"], { wordDur: 0.4 });
  w[0] = { ...w[0], style: { color: "#FF00AA" } };
  const subs = [sub({ words: w })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.deepEqual(report.issues, []);
});

test("16. a caption with caption-level style/animation raises no issue by itself", () => {
  const w = words(["Hello", "there"], { wordDur: 0.4 });
  const subs = [sub({ words: w, style: { color: "#00FF00" }, animation: { entrance: "bounce" } })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.deepEqual(report.issues, []);
});

test("19. Hindi text with a danda is analyzed the same as any other text (no false positives from non-Latin script)", () => {
  const w = words(["नमस्ते", "आप", "कैसे", "हैं।"], { wordDur: 0.4 });
  const subs = [sub({ words: w })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.equal(findIssue(report, "TOO_MANY_WORDS"), undefined);
  assert.equal(findIssue(report, "CHARACTER_LIMIT"), undefined);
});

test("20. Hinglish-derived caption/word fields don't interfere with analysis (analysis reads `text`/`words`, not the derived fields)", () => {
  const w = words(["नमस्ते", "दोस्तों"], { wordDur: 0.5 });
  w[0] = { ...w[0], hinglishText: "Namaste" };
  const subs = [sub({ words: w, hinglishText: "Namaste doston" })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.deepEqual(report.issues, []);
});

test("21. legacy Gujarati-Script caption/word fields don't interfere with analysis", () => {
  const w = words(["નમસ્તે", "મિત્રો"], { wordDur: 0.5 });
  w[0] = { ...w[0], gujaratiScriptText: "નમસ્તે" };
  const subs = [sub({ words: w, gujaratiScriptText: "નમસ્તે મિત્રો" })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.deepEqual(report.issues, []);
});

test("report aggregates: counts by type/severity and safeFixCount are consistent with the issues array", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["one", "two", "three", "four", "five", "six"], { wordDur: 0.3 }) }),
    sub({ id: "b", index: 1, words: [], text: "", start: 3, end: 4 }),
  ];
  const report = analyzeSubtitleQuality(subs, rules({ maxWordsPerCaption: 4 }));
  const totalFromTypes = Object.values(report.issueCountsByType).reduce((a, b) => a + (b ?? 0), 0);
  assert.equal(totalFromTypes, report.issues.length);
  const totalFromSeverity = report.issueCountsBySeverity.error + report.issueCountsBySeverity.warning + report.issueCountsBySeverity.info;
  assert.equal(totalFromSeverity, report.issues.length);
  assert.equal(report.safeFixCount, report.issues.filter((i) => i.fixability === "safe").length);
  assert.equal(report.captionsWithIssues, 2);
});

test("issue ids are stable and unique per caption+type", () => {
  const subs = [sub({ id: "xyz", words: words(["one", "two", "three", "four", "five"], { wordDur: 0.3 }) })];
  const report = analyzeSubtitleQuality(subs, rules({ maxWordsPerCaption: 4 }));
  const issue = findIssue(report, "TOO_MANY_WORDS", "xyz");
  assert.equal(issue!.id, "xyz:TOO_MANY_WORDS");
});

// ---------------------------------------------------------------------------------------
// P2 Subtitle Review & Publish Readiness — issue-message quality, derived state, staleness.
// ---------------------------------------------------------------------------------------

test("OVERLAP message shows both captions' actual time ranges, not just the overlap amount", () => {
  const subs = [
    sub({ id: "a", index: 0, words: words(["Hello"], { wordDur: 1 }), start: 0, end: 2 }),
    sub({ id: "b", index: 1, words: words(["World"], { t0: 1, wordDur: 1 }), start: 1, end: 2 }),
  ];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "OVERLAP", "a")!;
  assert.match(issue.message, /00:00\.00/);
  assert.match(issue.message, /00:02\.00/);
  assert.match(issue.message, /00:01\.00/);
});

test("WORD_TIMESTAMP_INVALID (unsafe) message identifies the specific word and its timestamp", () => {
  const w = words(["Hello", "there"], { wordDur: 0.3 });
  const broken = [w[0], { ...w[1], start: w[1].end, end: w[1].start }];
  const subs = [sub({ words: broken })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "WORD_TIMESTAMP_INVALID")!;
  assert.match(issue.message, /"there"/);
});

test("WORD_TIMESTAMP_INVALID (safe duplicate) message identifies the duplicated word", () => {
  const w = words(["Hello", "there"], { wordDur: 0.3 });
  const dup = [w[0], { ...w[0] }, w[1]];
  const subs = [sub({ words: dup, text: "Hello Hello there" })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "WORD_TIMESTAMP_INVALID")!;
  assert.match(issue.message, /"Hello"/);
});

test("deriveQualityState: NOT_ANALYZED when there is no report yet", () => {
  assert.equal(deriveQualityState(null), "NOT_ANALYZED");
});

test("deriveQualityState: CLEAN when analysis found zero issues", () => {
  const subs = [sub({ words: words(["Hello", "there"], { wordDur: 0.5 }) })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.equal(deriveQualityState(report), "CLEAN");
});

test("deriveQualityState: ISSUES_FOUND when at least one remaining issue is still safely fixable", () => {
  const subs = [sub({ words: words(["one", "two", "three", "four", "five", "six"], { wordDur: 0.3 }) })];
  const report = analyzeSubtitleQuality(subs, rules({ maxWordsPerCaption: 4 }));
  assert.equal(deriveQualityState(report), "ISSUES_FOUND");
});

test("deriveQualityState: MANUAL_REVIEW_REQUIRED when remaining issues are all unsafe", () => {
  const w = words(["Hello", "there"], { wordDur: 0.5 }); // 1.0s total — clear of minDuration
  const broken = [w[0], { ...w[1], start: w[1].end, end: w[1].start }];
  // Explicit start/end (rather than the sub() helper's default of "last word's own end") since
  // the last word's own end is deliberately broken/reversed in this fixture.
  const subs = [sub({ words: broken, start: 0, end: 1 })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.equal(deriveQualityState(report), "MANUAL_REVIEW_REQUIRED");
});

test("isQualityReportStale: false when nothing has been analyzed yet", () => {
  const subs = [sub({ words: words(["Hello"]) })];
  assert.equal(isQualityReportStale(subs, null), false);
});

test("isQualityReportStale: false when the current array is exactly what was analyzed", () => {
  const subs = [sub({ words: words(["Hello"]) })];
  assert.equal(isQualityReportStale(subs, subs), false);
});

test("isQualityReportStale: true once the subtitles array reference has changed (any commit/undo/redo)", () => {
  const subs = [sub({ words: words(["Hello"]) })];
  const laterSubs = [...subs];
  assert.equal(isQualityReportStale(laterSubs, subs), true);
});

// ============================== Task 98134 (P11): new content-QA issue types ==============================

test("P11: WHITESPACE_ISSUE fires for a caption whose text has messy whitespace", () => {
  const w = words(["Hello", "world"], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "  Hello   world  " })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "WHITESPACE_ISSUE");
  assert.ok(issue);
  assert.equal(issue!.severity, "warning");
  assert.equal(issue!.fixability, "unsafe");
});

test("P11: WHITESPACE_ISSUE does not fire for already-clean whitespace", () => {
  const w = words(["Hello", "world"], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "Hello world" })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.equal(findIssue(report, "WHITESPACE_ISSUE"), undefined);
});

test("P11: REPEATED_PUNCTUATION fires for repeated marks like !!/????/......", () => {
  const w = words(["Wow"], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "Wow!!" })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "REPEATED_PUNCTUATION");
  assert.ok(issue);
  assert.equal(issue!.severity, "warning");
});

test("P11: REPEATED_PUNCTUATION does not fire for intentional ?!/!?  or a real ellipsis", () => {
  const w1 = words(["Really"], { wordDur: 0.5 });
  const subs1 = [sub({ words: w1, text: "Really?!" })];
  assert.equal(findIssue(analyzeSubtitleQuality(subs1, rules()), "REPEATED_PUNCTUATION"), undefined);

  const w2 = words(["Wait"], { wordDur: 0.5 });
  const subs2 = [sub({ words: w2, text: "Wait..." })];
  assert.equal(findIssue(analyzeSubtitleQuality(subs2, rules()), "REPEATED_PUNCTUATION"), undefined);
});

test("P11: SUSPICIOUS_SHORT_TEXT (warning) fires for a lone single letter", () => {
  const w = words(["a"], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "a" })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "SUSPICIOUS_SHORT_TEXT");
  assert.ok(issue);
  assert.equal(issue!.severity, "warning");
});

test("P11: SUSPICIOUS_SHORT_TEXT (info) fires for a common short interjection, not an error", () => {
  const w = words(["OK"], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "OK" })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "SUSPICIOUS_SHORT_TEXT");
  assert.ok(issue);
  assert.equal(issue!.severity, "info");
});

test("P11: SUSPICIOUS_SHORT_TEXT (warning) fires for punctuation-only content", () => {
  const w = words(["..."], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "..." })];
  const report = analyzeSubtitleQuality(subs, rules());
  const issue = findIssue(report, "SUSPICIOUS_SHORT_TEXT");
  assert.ok(issue);
  assert.equal(issue!.severity, "warning");
});

test("P11: SUSPICIOUS_SHORT_TEXT does not fire for ordinary multi-word or longer captions", () => {
  const w = words(["Hello", "there"], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "Hello there" })];
  const report = analyzeSubtitleQuality(subs, rules());
  assert.equal(findIssue(report, "SUSPICIOUS_SHORT_TEXT"), undefined);
});

test("P11: none of the 3 new issue types are ever fixable=safe (never auto-fixed by quality analysis)", () => {
  const w = words(["a"], { wordDur: 0.5 });
  const subs = [sub({ words: w, text: "  a!!  " })];
  const report = analyzeSubtitleQuality(subs, rules());
  const newTypeIssues = report.issues.filter((i) =>
    ["WHITESPACE_ISSUE", "REPEATED_PUNCTUATION", "SUSPICIOUS_SHORT_TEXT"].includes(i.type),
  );
  assert.ok(newTypeIssues.length > 0);
  assert.ok(newTypeIssues.every((i) => i.fixability === "unsafe"));
});
