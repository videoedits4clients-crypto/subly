/**
 * Regression tests for Gujarati Script mode's gating against the V1 language policy (see
 * lib/language-policy.ts and lib/subtitles/output-mode.ts's projectSupportsGujaratiScript).
 *
 * Gujarati transcription is DEFERRED — no new project can reach language "gu" once the
 * transcription picker and backend validation both enforce lib/language-policy.ts (see
 * language-policy.test.ts). This file verifies the OTHER half of that story: a project that
 * already has language "gu" (existing/legacy data, explicitly preserved, not deleted) still
 * gets fully correct Gujarati Script behavior, a non-Gujarati project never sees it, and mode
 * switching (Original / Hinglish / Gujarati Script) all still work — the underlying conversion
 * algorithm (gujarati-script.ts) is untouched by this change; only its exposure is policy-aware.
 *
 * Run with: node --test src/lib/subtitles/__tests__/output-mode-policy.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  projectSupportsGujaratiScript,
  projectHasDevanagari,
  generateGujaratiScriptForSubtitle,
  generateHinglishForSubtitle,
  applyOutputMode,
  applyOutputModeToWords,
  getDerivedWordTextSyncStatus,
  isDerivedWordTextStale,
  regenerateHinglishForSubtitle,
  regenerateGujaratiScriptForSubtitle,
} from "../output-mode.ts";
import { isWordTimingStale } from "../word-timing.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

function word(text: string, start: number, end: number): Word {
  return { text, start, end };
}

function subtitle(text: string, words: Word[]): Subtitle {
  return { id: "s1", index: 0, start: words[0].start, end: words[words.length - 1].end, text, words };
}

test("a Gujarati-language project (language: 'gu') supports Gujarati Script mode — existing/legacy data keeps working", () => {
  assert.equal(projectSupportsGujaratiScript({ language: "gu" }), true);
});

test("non-Gujarati languages never support Gujarati Script mode, including Hindi (which supports Hinglish instead)", () => {
  for (const lang of ["en", "hi", "mr", "bn", "ta", "auto"]) {
    assert.equal(projectSupportsGujaratiScript({ language: lang }), false, `"${lang}" must not support Gujarati Script`);
  }
});

test("switching a project's language away from Gujarati (e.g. via translation) makes Gujarati Script unavailable going forward", () => {
  const guProject = { language: "gu" };
  assert.equal(projectSupportsGujaratiScript(guProject), true);
  const translated = { ...guProject, language: "en" };
  assert.equal(projectSupportsGujaratiScript(translated), false);
});

test("Original mode: applyOutputMode is a no-op, returning the same subtitle text/words", () => {
  const sub = subtitle("કલ મેં", [word("કલ", 0, 1), word("મેં", 1, 2)]);
  const [result] = applyOutputMode([sub], "original");
  assert.equal(result.text, sub.text);
});

test("Gujarati Script mode: applyOutputMode reads gujaratiScriptText once generated, leaving the original transcript untouched", () => {
  const sub = generateGujaratiScriptForSubtitle(subtitle("કલ મેં", [word("કલ", 0, 1), word("મેં", 1, 2)]));
  assert.ok(sub.gujaratiScriptText, "generateGujaratiScriptForSubtitle must produce gujaratiScriptText");
  const [result] = applyOutputMode([sub], "gujarati-script");
  assert.equal(result.text, sub.gujaratiScriptText);
  // The original transcript is never mutated by generation or by the read-time projection.
  assert.equal(sub.words[0].text, "કલ");
  assert.equal(sub.words[1].text, "મેં");
});

test("Hinglish mode: applyOutputMode reads hinglishText once generated, independent of Gujarati Script generation on the same caption", () => {
  const base = subtitle("नमस्ते", [word("नमस्ते", 0, 1)]);
  const withHinglish = generateHinglishForSubtitle(base);
  const withBoth = generateGujaratiScriptForSubtitle(withHinglish);
  assert.ok(withBoth.hinglishText);
  assert.ok(withBoth.gujaratiScriptText);
  const [hinglishView] = applyOutputMode([withBoth], "hinglish");
  const [gujaratiView] = applyOutputMode([withBoth], "gujarati-script");
  assert.equal(hinglishView.text, withBoth.hinglishText);
  assert.equal(gujaratiView.text, withBoth.gujaratiScriptText);
  assert.notEqual(hinglishView.text, gujaratiView.text);
});

test("projectHasDevanagari correctly identifies Devanagari-scripted captions regardless of the project's language field — Hinglish availability is content-based, not language-code-based, unlike Gujarati Script", () => {
  assert.equal(projectHasDevanagari([{ text: "नमस्ते दुनिया" }]), true);
  assert.equal(projectHasDevanagari([{ text: "hello world" }]), false);
});

// ============================== applyOutputModeToWords (Task 105631, P17) ==============================
// The per-word half of applyOutputMode, extracted so captions-panel.tsx's word chips can use it
// directly without also rebuilding the caption's own whole-caption .text (see this function's own
// doc comment in output-mode.ts for why that distinction matters for the textarea specifically).

test("applyOutputModeToWords: Original mode is a no-op, returning the SAME words array reference", () => {
  const words = [word("नमस्ते", 0, 1)];
  assert.equal(applyOutputModeToWords(words, "original"), words);
});

test("applyOutputModeToWords: Hinglish mode swaps each word's .text for its own hinglishText, never mutating the input", () => {
  const w = { ...word("नमस्ते", 0, 1), hinglishText: "namaste" };
  const [result] = applyOutputModeToWords([w], "hinglish");
  assert.equal(result.text, "namaste");
  assert.equal(w.text, "नमस्ते", "the original word object itself must be untouched");
});

test("applyOutputModeToWords: Gujarati Script mode swaps each word's .text for its own gujaratiScriptText", () => {
  const w = { ...word("કલ", 0, 1), gujaratiScriptText: "કલ" };
  const [result] = applyOutputModeToWords([w], "gujarati-script");
  assert.equal(result.text, "કલ");
});

test("applyOutputModeToWords: falls back to the original .text for a word with no derived text yet (e.g. an English word in an otherwise-Hindi caption)", () => {
  const w = word("hello", 0, 1); // no hinglishText generated for this one
  const [result] = applyOutputModeToWords([w], "hinglish");
  assert.equal(result.text, "hello");
});

test("applyOutputModeToWords: preserves word count, order, and every other field (start/end/confidence/removed/style) exactly — only .text changes", () => {
  const words = [
    { ...word("नमस्ते", 0, 1), hinglishText: "namaste", confidence: 0.9, removed: false },
    { ...word("दुनिया", 1, 2), hinglishText: "duniya", confidence: 0.8 },
  ];
  const result = applyOutputModeToWords(words, "hinglish");
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((w) => [w.start, w.end, w.confidence, w.removed]),
    words.map((w) => [w.start, w.end, w.confidence, w.removed]),
  );
  assert.deepEqual(result.map((w) => w.text), ["namaste", "duniya"]);
});

test("applyOutputMode itself now produces the identical per-word result as applyOutputModeToWords (pure extraction, no behavior change)", () => {
  const sub = generateHinglishForSubtitle(subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]));
  const [viaApplyOutputMode] = applyOutputMode([sub], "hinglish");
  const viaWordsOnly = applyOutputModeToWords(sub.words, "hinglish");
  assert.deepEqual(
    viaApplyOutputMode.words.map((w) => w.text),
    viaWordsOnly.map((w) => w.text),
  );
});

// ============================== getDerivedWordTextSyncStatus / isDerivedWordTextStale (Task 106284, P17.1) ==============================
// Distinct from isWordTimingStale (word-timing.ts), which compares words[].text against the
// AUTHORITATIVE sub.text — these compare words[].{derived field} against the caption's own CACHED
// derived text instead. Never conflated into one flag (see this module's own doc comment).

test("getDerivedWordTextSyncStatus: 'pending-generation' when the caption has no cached derived text for the mode at all", () => {
  const sub = subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]); // hinglishText never generated
  assert.equal(getDerivedWordTextSyncStatus(sub, "hinglish"), "pending-generation");
});

test("getDerivedWordTextSyncStatus: 'synchronized' when the per-word derived text's own token count matches the caption-level cached text", () => {
  const sub = generateHinglishForSubtitle(subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]));
  assert.equal(getDerivedWordTextSyncStatus(sub, "hinglish"), "synchronized");
});

test("getDerivedWordTextSyncStatus: 'word-count-mismatch' — the exact P17 residue: a word-count-changing derived-text edit leaves words untouched while the caption-level field reflects the new count", () => {
  const generated = generateHinglishForSubtitle(subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]));
  // Simulates editor-store.ts's own remapHinglishWordsToText fix: words stay exactly as they were
  // (2 words, 2 tokens), but the caption's own cached hinglishText now has 3 tokens.
  const edited = { ...generated, hinglishText: "namaste bilkul duniya" };
  assert.equal(getDerivedWordTextSyncStatus(edited, "hinglish"), "word-count-mismatch");
});

test("getDerivedWordTextSyncStatus: a multi-token Word.text (e.g. a merged word, Task 106284) is counted by ITS OWN token count, not just 1 per word — matching isWordTimingStale's own established convention", () => {
  const sub = {
    ...subtitle("hello world", [word("hello", 0, 0.5), word("world", 0.5, 1)]),
    hinglishText: "namaste duniya",
  };
  sub.words = [{ text: "hello world", start: 0, end: 1, hinglishText: "namaste duniya" }]; // one merged word, 2-token hinglishText
  assert.equal(getDerivedWordTextSyncStatus(sub, "hinglish"), "synchronized");
});

test("getDerivedWordTextSyncStatus is INDEPENDENT of getDerivedWordTextSyncStatus for the other mode — Hinglish can be synchronized while Gujarati Script is still pending, or vice versa", () => {
  const sub = generateHinglishForSubtitle(subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]));
  assert.equal(getDerivedWordTextSyncStatus(sub, "hinglish"), "synchronized");
  assert.equal(getDerivedWordTextSyncStatus(sub, "gujarati-script"), "pending-generation");
});

test("isDerivedWordTextStale: true ONLY for word-count-mismatch — 'pending-generation' does NOT count as stale (it resolves itself automatically)", () => {
  const neverGenerated = subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]);
  assert.equal(isDerivedWordTextStale(neverGenerated, "hinglish"), false);

  const synchronized = generateHinglishForSubtitle(neverGenerated);
  assert.equal(isDerivedWordTextStale(synchronized, "hinglish"), false);

  const mismatched = { ...synchronized, hinglishText: "namaste bilkul duniya" };
  assert.equal(isDerivedWordTextStale(mismatched, "hinglish"), true);
});

// ============================== regenerateHinglishForSubtitle / regenerateGujaratiScriptForSubtitle (Task 106284, P17.1) ==============================
// The one safe way to resolve a "word-count-mismatch": recompute EVERY word's own derived text
// fresh from the AUTHORITATIVE words[].text — never from the stale/mismatched derived text itself.

test("regenerateHinglishForSubtitle: resolves a word-count-mismatch back to 'synchronized', reading only from the authoritative words[].text", () => {
  const generated = generateHinglishForSubtitle(subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]));
  const mismatched = { ...generated, hinglishText: "some stale unrelated text with five tokens" };
  assert.equal(getDerivedWordTextSyncStatus(mismatched, "hinglish"), "word-count-mismatch");
  const fixed = regenerateHinglishForSubtitle(mismatched);
  assert.equal(getDerivedWordTextSyncStatus(fixed, "hinglish"), "synchronized");
  assert.equal(fixed.hinglishText, "Namaste duniya", "regenerated fresh from words[].text, NOT from the stale 'some stale unrelated text...' value");
});

test("regenerateGujaratiScriptForSubtitle: same fix, for Gujarati Script", () => {
  const generated = generateGujaratiScriptForSubtitle(subtitle("કલ મેં", [word("કલ", 0, 1), word("મેં", 1, 2)]));
  const mismatched = { ...generated, gujaratiScriptText: "totally wrong stale text here" };
  const fixed = regenerateGujaratiScriptForSubtitle(mismatched);
  assert.equal(getDerivedWordTextSyncStatus(fixed, "gujarati-script"), "synchronized");
  assert.equal(fixed.gujaratiScriptText, "કલ મેં");
});

test("regenerateHinglishForSubtitle: preserves every word's own start/end/confidence/style/removed and the AUTHORITATIVE .text exactly — only hinglishText changes", () => {
  const sub = subtitle("नमस्ते दुनिया", [
    { text: "नमस्ते", start: 0, end: 1, confidence: 0.9, style: { color: "red" }, hinglishText: "STALE" },
    { text: "दुनिया", start: 1, end: 2, removed: true, hinglishText: "STALE2" },
  ]);
  const fixed = regenerateHinglishForSubtitle(sub);
  assert.deepEqual(
    fixed.words.map((w) => [w.text, w.start, w.end, w.confidence, w.style, w.removed]),
    sub.words.map((w) => [w.text, w.start, w.end, w.confidence, w.style, w.removed]),
  );
  assert.notEqual(fixed.words[0].hinglishText, "STALE");
  assert.notEqual(fixed.words[1].hinglishText, "STALE2");
});

test("regenerateHinglishForSubtitle: overwrites EVERY word's hinglishText, not just gaps (unlike generateHinglishForSubtitle, which only fills undefined ones)", () => {
  const sub = subtitle("नमस्ते दुनिया", [
    { text: "नमस्ते", start: 0, end: 1, hinglishText: "totally-wrong-value" },
    { text: "दुनिया", start: 1, end: 2 }, // this one genuinely has no value yet
  ]);
  const fixed = regenerateHinglishForSubtitle(sub);
  assert.equal(fixed.words[0].hinglishText, "Namaste", "overwritten even though it already had a (wrong) value");
  assert.equal(fixed.words[1].hinglishText, "duniya");
});

test("regenerateHinglishForSubtitle is deterministic — the same input always produces the same output", () => {
  const sub = subtitle("नमस्ते दुनिया", [word("नमस्ते", 0, 1), word("दुनिया", 1, 2)]);
  assert.deepEqual(regenerateHinglishForSubtitle(sub), regenerateHinglishForSubtitle(sub));
});

test("regenerateHinglishForSubtitle: safe to call on an already-synchronized caption — not a rejection, just a no-op-equivalent full regeneration", () => {
  const generated = generateHinglishForSubtitle(subtitle("नमस्ते", [word("नमस्ते", 0, 1)]));
  const regenerated = regenerateHinglishForSubtitle(generated);
  assert.equal(regenerated.hinglishText, generated.hinglishText);
});

// ============================== Task 106731 (P17.2) fix: removed words must not count toward the sync-status token sum ==============================
// getDerivedWordTextSyncStatus used to sum EVERY word's own token count, including `removed`
// (soft-deleted) ones — but generateHinglishForSubtitle/regenerateHinglishForSubtitle (and their
// Gujarati Script siblings) both EXCLUDE removed words when building the caption-level joined
// text. That mismatch made a caption with any removed word read as "word-count-mismatch" forever,
// even immediately after a correct regeneration — caught by this task's own store-level undo/redo
// matrix test, fixed here at the root: the sum now excludes removed words too, matching how the
// caption-level text is actually assembled.

test("getDerivedWordTextSyncStatus: a caption with a REMOVED word reads as 'synchronized' immediately after regenerateHinglishForSubtitle — removed words must not inflate the per-word sum", () => {
  const sub = subtitle("नमस्ते दुनिया आज", [
    word("नमस्ते", 0, 1),
    word("दुनिया", 1, 2),
    { ...word("आज", 2, 3), removed: true },
  ]);
  const fixed = regenerateHinglishForSubtitle(sub);
  assert.equal(getDerivedWordTextSyncStatus(fixed, "hinglish"), "synchronized");
  assert.equal(isDerivedWordTextStale(fixed, "hinglish"), false);
});

test("getDerivedWordTextSyncStatus: the same fix applies to Gujarati Script", () => {
  const sub = subtitle("કલ મેં આજ", [word("કલ", 0, 1), word("મેં", 1, 2), { ...word("આજ", 2, 3), removed: true }]);
  const fixed = regenerateGujaratiScriptForSubtitle(sub);
  assert.equal(getDerivedWordTextSyncStatus(fixed, "gujarati-script"), "synchronized");
});

test("getDerivedWordTextSyncStatus: a GENUINE word-count-mismatch is still detected correctly even when a removed word is also present", () => {
  const sub = subtitle("नमस्ते दुनिया आज", [
    word("नमस्ते", 0, 1),
    word("दुनिया", 1, 2),
    { ...word("आज", 2, 3), removed: true },
  ]);
  const fixed = regenerateHinglishForSubtitle(sub);
  // Now simulate a word-count-changing derived-text edit on top of the correctly-regenerated state.
  const mismatched = { ...fixed, hinglishText: "some totally different five token value here" };
  assert.equal(getDerivedWordTextSyncStatus(mismatched, "hinglish"), "word-count-mismatch");
});

// ============================== Task 107284 (P17.3): isWordTimingStale + getDerivedWordTextSyncStatus after regeneration, with a removed word present ==============================
// M. Regeneration after removed words must still produce output that reads as fully synchronized
// from BOTH staleness mechanisms at once — isWordTimingStale (word-timing.ts, the ORIGINAL-text
// check, fixed by this task) and getDerivedWordTextSyncStatus (the DERIVED-text check, fixed by
// P17.2) are deliberately separate, but a correctly-regenerated caption with a removed word must
// read as fresh under BOTH, in every display mode — proving the two fixes compose correctly
// rather than only being individually correct in isolation.

test("M. after regenerateHinglishForSubtitle, a caption with a removed word reads as fully synchronized: isWordTimingStale is false in Original AND Hinglish mode, and getDerivedWordTextSyncStatus is 'synchronized'", () => {
  // `text` mirrors the REAL pipeline (segment.ts's segmentWords), which excludes removed words —
  // NOT "नमस्ते दुनिया आज" (that would already carry the exact P17.3 bug into the fixture itself).
  const sub = subtitle("नमस्ते आज", [
    word("नमस्ते", 0, 1),
    { ...word("दुनिया", 1, 2), removed: true },
    word("आज", 2, 3),
  ]);
  const fixed = regenerateHinglishForSubtitle(sub);

  // Original mode: authoritative text/words, unaffected by the Hinglish regeneration.
  assert.equal(isWordTimingStale({ text: fixed.text, words: fixed.words }), false);

  // Hinglish mode: the derived caption-level text vs. the derived per-word breakdown.
  const hinglishWords = applyOutputModeToWords(fixed.words, "hinglish");
  assert.equal(isWordTimingStale({ text: fixed.hinglishText!, words: hinglishWords }), false);
  assert.equal(getDerivedWordTextSyncStatus(fixed, "hinglish"), "synchronized");
});

test("M. same composition check for Gujarati Script", () => {
  const sub = subtitle("કલ આજ", [word("કલ", 0, 1), { ...word("મેં", 1, 2), removed: true }, word("આજ", 2, 3)]);
  const fixed = regenerateGujaratiScriptForSubtitle(sub);

  assert.equal(isWordTimingStale({ text: fixed.text, words: fixed.words }), false);
  const gujaratiWords = applyOutputModeToWords(fixed.words, "gujarati-script");
  assert.equal(isWordTimingStale({ text: fixed.gujaratiScriptText!, words: gujaratiWords }), false);
  assert.equal(getDerivedWordTextSyncStatus(fixed, "gujarati-script"), "synchronized");
});
