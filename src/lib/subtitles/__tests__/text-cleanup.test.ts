import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trimCaptionWhitespace,
  normalizeSpaces,
  normalizeLineBreakWhitespace,
  normalizeRepeatedPunctuation,
  sentenceCase,
  shouldEnsureTrailingPunctuation,
  ensureTrailingPunctuation,
  removeTrailingPunctuation,
  classifyCaptionContent,
  isBlankCaption,
  applyCleanupToText,
  computeTextCleanupPreview,
  hasAnyCleanupOperationSelected,
  EMPTY_CLEANUP_SELECTION,
  type CleanupSelection,
} from "../text-cleanup.ts";
import type { Subtitle } from "../../../types/subtitle.ts";

function sub(id: string, text: string, words: { text: string; start: number; end: number }[] = []): Pick<Subtitle, "id" | "text" | "words"> {
  return { id, text, words: words as Subtitle["words"] };
}

// ============================== TEXT CLEANUP ==============================

test("trim whitespace: leading/trailing spaces removed", () => {
  assert.equal(trimCaptionWhitespace("  Hello world  "), "Hello world");
});

test("normalize spaces: repeated inline spaces collapse to one", () => {
  assert.equal(normalizeSpaces("Hello    world"), "Hello world");
});

test("normalize spaces: never touches a newline", () => {
  assert.equal(normalizeSpaces("Hello\nworld"), "Hello\nworld");
});

test("normalize whitespace around line breaks: strips space before and after \\n", () => {
  assert.equal(normalizeLineBreakWhitespace("Hello   \n   world"), "Hello\nworld");
});

test("normalize whitespace around line breaks: preserves an intentional blank line", () => {
  assert.equal(normalizeLineBreakWhitespace("Hello\n\nworld"), "Hello\n\nworld");
});

test("repeated punctuation: !! collapses to !", () => {
  assert.equal(normalizeRepeatedPunctuation("Hello!!"), "Hello!");
});

test("repeated punctuation: ???? collapses to ?", () => {
  assert.equal(normalizeRepeatedPunctuation("Really????"), "Really?");
});

test("repeated punctuation: 6 dots collapse to a 3-dot ellipsis", () => {
  assert.equal(normalizeRepeatedPunctuation("Wait......"), "Wait...");
});

test("repeated punctuation: a real 3-dot ellipsis is left visually unchanged", () => {
  assert.equal(normalizeRepeatedPunctuation("Wait..."), "Wait...");
});

test("repeated punctuation: intentional ?! and !? are preserved (no same-char run)", () => {
  assert.equal(normalizeRepeatedPunctuation("Really?!"), "Really?!");
  assert.equal(normalizeRepeatedPunctuation("Wait!?"), "Wait!?");
});

test("repeated punctuation: quote characters are never touched", () => {
  assert.equal(normalizeRepeatedPunctuation('He said "hi"'), 'He said "hi"');
});

// ============================== CAPITALIZATION (sentence case) ==============================

test("sentence case: worked example from the spec", () => {
  assert.equal(sentenceCase("hello world. this is SUBLY."), "Hello world. This is SUBLY.");
});

test("sentence case: multiple sentences each get capitalized", () => {
  assert.equal(sentenceCase("first one. second one! third one?"), "First one. Second one! Third one?");
});

test("sentence case: each existing line break starts a new sentence", () => {
  assert.equal(sentenceCase("hello there\nhow are you"), "Hello there\nHow are you");
});

test("sentence case: acronym mid-sentence is preserved exactly", () => {
  assert.equal(sentenceCase("welcome to NASA today"), "Welcome to NASA today");
});

test("sentence case: Hindi/Devanagari text is left completely unchanged (no case distinction)", () => {
  const hindi = "नमस्ते दुनिया। यह ठीक है।";
  assert.equal(sentenceCase(hindi), hindi);
});

test("sentence case: mixed English/Hindi capitalizes only the English sentence-initial letter", () => {
  assert.equal(sentenceCase("hello नमस्ते. फिर मिलेंगे"), "Hello नमस्ते. फिर मिलेंगे");
});

test("sentence case: a URL at a sentence start is left unchanged", () => {
  assert.equal(sentenceCase("example.com is a great site."), "example.com is a great site.");
});

test("sentence case: an email at a sentence start is left unchanged", () => {
  assert.equal(sentenceCase("contact@example.com is the address"), "contact@example.com is the address");
});

test("sentence case: idempotent on already-correct text", () => {
  const text = "Hello world. This is fine.";
  assert.equal(sentenceCase(text), text);
});

// ============================== PUNCTUATION (trailing) ==============================

test("ensure trailing punctuation: adds a period to a plain complete sentence", () => {
  assert.equal(ensureTrailingPunctuation("Hello world"), "Hello world.");
});

test("ensure trailing punctuation: does not touch a caption already ending in ?", () => {
  assert.equal(shouldEnsureTrailingPunctuation("Are you coming?"), false);
  assert.equal(ensureTrailingPunctuation("Are you coming?"), "Are you coming?");
});

test("ensure trailing punctuation: does not touch a caption already ending in !", () => {
  assert.equal(ensureTrailingPunctuation("Watch out!"), "Watch out!");
});

test("ensure trailing punctuation: does not touch an ellipsis", () => {
  assert.equal(ensureTrailingPunctuation("Wait..."), "Wait...");
});

test("ensure trailing punctuation: does not touch a caption ending in a comma", () => {
  assert.equal(ensureTrailingPunctuation("Well, then,"), "Well, then,");
});

test("ensure trailing punctuation: does not touch a caption ending in a colon/semicolon", () => {
  assert.equal(ensureTrailingPunctuation("As follows:"), "As follows:");
  assert.equal(ensureTrailingPunctuation("Note this;"), "Note this;");
});

test("ensure trailing punctuation: does not touch a URL", () => {
  assert.equal(ensureTrailingPunctuation("Visit https://example.com/path"), "Visit https://example.com/path");
});

test("ensure trailing punctuation: does not touch a purely numeric fragment", () => {
  assert.equal(ensureTrailingPunctuation("42"), "42");
  assert.equal(ensureTrailingPunctuation("12:30"), "12:30");
});

test("ensure trailing punctuation: preserves trailing whitespace exactly", () => {
  assert.equal(ensureTrailingPunctuation("Hello world  "), "Hello world.  ");
});

test("remove trailing punctuation: strips only the terminal run", () => {
  assert.equal(removeTrailingPunctuation("Hello world."), "Hello world");
});

test("remove trailing punctuation: strips a whole trailing run (e.g. ellipsis)", () => {
  assert.equal(removeTrailingPunctuation("Wait..."), "Wait");
});

test("remove trailing punctuation: never touches internal punctuation", () => {
  assert.equal(removeTrailingPunctuation("Well, hello there."), "Well, hello there");
});

test("remove trailing punctuation: no-op when there is nothing trailing to remove", () => {
  assert.equal(removeTrailingPunctuation("Hello world"), "Hello world");
});

// ============================== EMPTY / NEAR-EMPTY QA ==============================

test("classify: empty string", () => {
  assert.equal(classifyCaptionContent(""), "empty");
});

test("classify: whitespace-only", () => {
  assert.equal(classifyCaptionContent("   \n  "), "whitespace-only");
});

test("classify: punctuation-only", () => {
  assert.equal(classifyCaptionContent("..."), "punctuation-only");
  assert.equal(classifyCaptionContent("!!"), "punctuation-only");
});

test("classify: a single lone letter is suspicious-short, not an error", () => {
  assert.equal(classifyCaptionContent("a"), "suspicious-short");
});

test("classify: a short common interjection is short-intentional (info-level)", () => {
  assert.equal(classifyCaptionContent("OK"), "short-intentional");
  assert.equal(classifyCaptionContent("No"), "short-intentional");
});

test("classify: ordinary text is normal", () => {
  assert.equal(classifyCaptionContent("This is a real caption."), "normal");
});

test("isBlankCaption: true only for empty/whitespace-only, never punctuation-only or short", () => {
  assert.equal(isBlankCaption(""), true);
  assert.equal(isBlankCaption("   "), true);
  assert.equal(isBlankCaption("..."), false);
  assert.equal(isBlankCaption("OK"), false);
});

// ============================== BATCH ==============================

const NO_OPS = EMPTY_CLEANUP_SELECTION;

test("hasAnyCleanupOperationSelected: false for the all-off default", () => {
  assert.equal(hasAnyCleanupOperationSelected(NO_OPS), false);
});

test("hasAnyCleanupOperationSelected: true once any toggle is on", () => {
  assert.equal(hasAnyCleanupOperationSelected({ ...NO_OPS, trimWhitespace: true }), true);
  assert.equal(hasAnyCleanupOperationSelected({ ...NO_OPS, caseTransform: "sentence" }), true);
});

test("applyCleanupToText: combines whitespace + punctuation + case + trailing punctuation in one pass", () => {
  const sel: CleanupSelection = {
    trimWhitespace: true,
    normalizeSpaces: true,
    normalizeLineBreakWhitespace: true,
    normalizeRepeatedPunctuation: true,
    caseTransform: "sentence",
    trailingPunctuation: "ensure",
    removeBlankCaptions: false,
  };
  assert.equal(applyCleanupToText("  hello   world!!  ", sel), "Hello world!");
});

test("computeTextCleanupPreview: selection scoping — only selected captions considered", () => {
  const subs = [sub("a", "  hi  "), sub("b", "  bye  "), sub("c", "untouched")];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), { ...NO_OPS, trimWhitespace: true });
  assert.equal(result.totalSelected, 1);
  assert.equal(result.changedCount, 1);
  assert.equal(result.items[0].id, "a");
  assert.equal(result.items[0].after, "hi");
});

test("computeTextCleanupPreview: non-contiguous selection applies independently per caption", () => {
  const subs = [sub("a", "  x  "), sub("b", "y"), sub("c", "  z  ")];
  const result = computeTextCleanupPreview(subs, new Set(["a", "c"]), { ...NO_OPS, trimWhitespace: true });
  assert.equal(result.changedCount, 2);
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["a", "c"],
  );
});

test("computeTextCleanupPreview: no-op when nothing is toggled on", () => {
  const subs = [sub("a", "  hi  ")];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), NO_OPS);
  assert.equal(result.changedCount, 0);
  assert.equal(result.deleteCount, 0);
  assert.equal(result.hasAnyOperationSelected, false);
});

test("computeTextCleanupPreview: no-op when the toggled operation changes nothing", () => {
  const subs = [sub("a", "already clean")];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), { ...NO_OPS, trimWhitespace: true });
  assert.equal(result.changedCount, 0);
  assert.equal(result.unchangedCount, 1);
});

test("computeTextCleanupPreview: remove blank captions surfaces them as delete candidates, not silently", () => {
  const subs = [sub("a", "  "), sub("b", "real text")];
  const result = computeTextCleanupPreview(subs, new Set(["a", "b"]), { ...NO_OPS, removeBlankCaptions: true });
  assert.equal(result.deleteCount, 1);
  assert.equal(result.items.find((i) => i.id === "a")?.willDelete, true);
  assert.equal(result.items.find((i) => i.id === "b"), undefined);
});

test("computeTextCleanupPreview: never deletes a non-blank caption even if punctuation-only or short", () => {
  const subs = [sub("a", "..."), sub("b", "OK")];
  const result = computeTextCleanupPreview(subs, new Set(["a", "b"]), { ...NO_OPS, removeBlankCaptions: true });
  assert.equal(result.deleteCount, 0);
});

test("computeTextCleanupPreview: selection pruning — an unselected caption is never in items", () => {
  const subs = [sub("a", "  x  "), sub("b", "  y  ")];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), { ...NO_OPS, trimWhitespace: true });
  assert.equal(result.items.some((i) => i.id === "b"), false);
});

// ============================== WORD TIMING SAFETY ==============================

test("word timing: same token count after cleanup never marks stale", () => {
  const subs = [sub("a", "  Hello   world  ", [{ text: "Hello", start: 0, end: 1 }, { text: "world", start: 1, end: 2 }])];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), { ...NO_OPS, trimWhitespace: true, normalizeSpaces: true });
  assert.equal(result.staleCount, 0);
  assert.equal(result.items[0].becomesStale, false);
});

test("word timing: uppercase alone preserves token count and never marks stale", () => {
  const subs = [sub("a", "hello world", [{ text: "hello", start: 0, end: 1 }, { text: "world", start: 1, end: 2 }])];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), { ...NO_OPS, caseTransform: "uppercase" });
  assert.equal(result.items[0].becomesStale, false);
});

test("word timing: removing a whole trailing punctuation TOKEN changes token count and goes stale, never fabricated", () => {
  // "Hello ..." tokenizes to 2 tokens ("Hello", "...") — removing the trailing "..." run leaves
  // just 1 token, a genuine token-count change the caller must NOT silently re-time.
  const subs = [sub("a", "Hello ...", [{ text: "Hello", start: 0, end: 1 }, { text: "...", start: 1, end: 2 }])];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), { ...NO_OPS, trailingPunctuation: "remove" });
  assert.equal(result.items[0].after, "Hello ");
  assert.equal(result.items[0].becomesStale, true);
});

test("word timing: a caption with no existing word timing is never marked stale", () => {
  const subs = [sub("a", "  hi  ", [])];
  const result = computeTextCleanupPreview(subs, new Set(["a"]), { ...NO_OPS, trimWhitespace: true });
  assert.equal(result.items[0].becomesStale, false);
});

// ============================== PERFORMANCE ==============================

test("performance: 5400 captions cleaned in well under a second", () => {
  const subs = Array.from({ length: 5400 }, (_, i) => sub(`s${i}`, `  Hello   world!!  ${i}  `));
  const ids = new Set(subs.map((s) => s.id));
  const start = Date.now();
  const result = computeTextCleanupPreview(subs, ids, {
    ...NO_OPS,
    trimWhitespace: true,
    normalizeSpaces: true,
    normalizeRepeatedPunctuation: true,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.changedCount, 5400);
  assert.ok(elapsed < 2000, `expected under 2000ms, took ${elapsed}ms`);
});

test("performance: 2700 non-contiguous selected captions out of 5400", () => {
  const subs = Array.from({ length: 5400 }, (_, i) => sub(`s${i}`, `  Hello   world  `));
  const ids = new Set(subs.filter((_, i) => i % 2 === 0).map((s) => s.id));
  const result = computeTextCleanupPreview(subs, ids, { ...NO_OPS, trimWhitespace: true });
  assert.equal(result.totalSelected, 2700);
  assert.equal(result.changedCount, 2700);
});
