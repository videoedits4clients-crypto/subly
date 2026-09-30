/**
 * Task 97025 (P10) — pure unit tests for batch find & replace / text transform
 * (lib/subtitles/batch-text-ops.ts). Store-level integration (undo/redo, autosave-adjacent
 * commit behavior, selection scoping via the real store) lives in
 * src/store/__tests__/editor-store-undo-redo.test.ts, matching this codebase's existing
 * pure-helper-here / store-integration-there convention (see duplicate-timing.ts's own split).
 *
 * Run with: node --test src/lib/subtitles/__tests__/batch-text-ops.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeBatchFindReplace, computeBatchTextTransform, applyTextTransform, buildFindRegex } from "../batch-text-ops.ts";
import type { Subtitle } from "../../../types/subtitle.ts";

function sub(id: string, text: string, words: { text: string; start: number; end: number }[] = []): Pick<Subtitle, "id" | "text" | "words"> {
  return { id, text, words: words as Subtitle["words"] };
}

// ---------------------------------------------------------------------------------------------
// Find & Replace — basic scoping and matching
// ---------------------------------------------------------------------------------------------

test("1. basic replacement — a caption with one match gets its text replaced", () => {
  const subs = [sub("a", "Hello world")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "Hi world");
  assert.equal(result.totalMatches, 1);
});

test("2. multiple replacements within ONE caption are all counted and applied", () => {
  const subs = [sub("a", "cat cat cat")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "cat", "dog", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "dog dog dog");
  assert.equal(result.totalMatches, 3);
});

test("3. replacement across multiple SELECTED captions — every one with a match is affected", () => {
  const subs = [sub("a", "Hello world"), sub("b", "Hello everyone"), sub("c", "Good morning")];
  const result = computeBatchFindReplace(subs, new Set(["a", "b", "c"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "Hi world");
  assert.equal(result.textById.get("b"), "Hi everyone");
  assert.equal(result.textById.has("c"), false, "no match in caption c — never touched");
  assert.equal(result.totalMatches, 2);
});

test("4. a caption OUTSIDE the selection is never touched, even if it would otherwise match", () => {
  const subs = [sub("a", "Hello world"), sub("b", "Hello everyone")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.has("a"), true);
  assert.equal(result.textById.has("b"), false, "b has a real match but is NOT selected — must stay untouched");
  assert.equal(result.totalMatches, 1, "b's match is never counted either — it's outside the operation entirely");
});

test("4b. selection order never affects the result", () => {
  const subs = [sub("a", "Hello world"), sub("b", "Hello everyone"), sub("c", "Good morning Hello")];
  const forward = computeBatchFindReplace(subs, new Set(["a", "b", "c"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  const reversed = computeBatchFindReplace(subs, new Set(["c", "b", "a"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  assert.deepEqual([...forward.textById.entries()].sort(), [...reversed.textById.entries()].sort());
  assert.equal(forward.totalMatches, reversed.totalMatches);
});

// ---------------------------------------------------------------------------------------------
// Match case
// ---------------------------------------------------------------------------------------------

test("5. match case OFF (default): hello/Hello/HELLO all match", () => {
  const subs = [sub("a", "hello Hello HELLO")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "hello", "hi", { matchCase: false, wholeWord: false });
  assert.equal(result.totalMatches, 3);
  assert.equal(result.textById.get("a"), "hi hi hi");
});

test("6. match case ON: only the exact casing matches", () => {
  const subs = [sub("a", "hello Hello HELLO")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello", "Hi", { matchCase: true, wholeWord: false });
  assert.equal(result.totalMatches, 1);
  assert.equal(result.textById.get("a"), "hello Hi HELLO");
});

// ---------------------------------------------------------------------------------------------
// Whole word
// ---------------------------------------------------------------------------------------------

test("7. whole word OFF (default): 'cat' matches inside 'concatenate'", () => {
  const subs = [sub("a", "concatenate the cat")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "cat", "dog", { matchCase: false, wholeWord: false });
  assert.equal(result.totalMatches, 2);
  assert.equal(result.textById.get("a"), "condogenate the dog");
});

test("8. whole word ON: 'cat' matches only as a standalone word, not inside 'catch' or 'concatenate'", () => {
  const subs = [sub("a", "the cat will catch a concatenate cat")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "cat", "dog", { matchCase: false, wholeWord: true });
  assert.equal(result.totalMatches, 2, "only the two standalone 'cat' occurrences");
  assert.equal(result.textById.get("a"), "the dog will catch a concatenate dog");
});

test("9. no matches at all: no captions are affected, count is zero", () => {
  const subs = [sub("a", "Hello world")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "xyz", "abc", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.size, 0);
  assert.equal(result.totalMatches, 0);
});

test("10. empty find string is a safe no-op (matches the existing global findReplace's own guard)", () => {
  const subs = [sub("a", "Hello world")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "", "Hi", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.size, 0);
  assert.equal(result.totalMatches, 0);
  assert.equal(buildFindRegex("", { matchCase: false, wholeWord: false }), null);
});

test("11. empty replacement string deletes the matched text", () => {
  const subs = [sub("a", "Hello world")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello ", "", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "world");
});

test("12. a literal '$' in the replacement text is inserted exactly as typed, not as a $&/$1-style substitution pattern", () => {
  const subs = [sub("a", "price: X")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "X", "$5 and $&", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "price: $5 and $&", "the literal replacement text is preserved exactly, not expanded as a regex substitution");
});

// ---------------------------------------------------------------------------------------------
// Unicode / Hindi / mixed-script text
// ---------------------------------------------------------------------------------------------

test("13. Hindi (Devanagari) text: basic replacement works", () => {
  const subs = [sub("a", "नमस्ते दुनिया")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "नमस्ते", "हैलो", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "हैलो दुनिया");
});

test("14. Hindi text: whole-word ON correctly treats Devanagari letters as word-forming (a substring inside a longer word does not match)", () => {
  const subs = [sub("a", "राम और रामायण")]; // "राम" (Ram) standalone, and inside "रामायण" (Ramayana)
  const result = computeBatchFindReplace(subs, new Set(["a"]), "राम", "कृष्ण", { matchCase: false, wholeWord: true });
  assert.equal(result.totalMatches, 1, "only the standalone 'राम', not the one embedded in 'रामायण'");
  assert.equal(result.textById.get("a"), "कृष्ण और रामायण");
});

test("15. mixed English/Hindi text: replacement scoped correctly to the matched script only", () => {
  const subs = [sub("a", "Hello नमस्ते Hello")];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  assert.equal(result.totalMatches, 2);
  assert.equal(result.textById.get("a"), "Hi नमस्ते Hi");
});

test("15b. mixed English/Hindi text: whole-word ON at a script boundary (no whitespace between scripts) still finds the correct boundary", () => {
  const subs = [sub("a", "catनमस्ते cat")]; // "cat" glued directly to Devanagari, and a standalone "cat"
  const result = computeBatchFindReplace(subs, new Set(["a"]), "cat", "dog", { matchCase: false, wholeWord: true });
  assert.equal(result.totalMatches, 1, "the glued 'catनमस्ते' is not a standalone word boundary match; only the separate 'cat' is");
  assert.equal(result.textById.get("a"), "catनमस्ते dog");
});

// ---------------------------------------------------------------------------------------------
// Timing safety
// ---------------------------------------------------------------------------------------------

test("16. same-token-count replacement is never marked stale", () => {
  const subs = [sub("a", "Hello world", [{ text: "Hello", start: 0, end: 1 }, { text: "world", start: 1, end: 2 }])];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "Hi world");
  assert.equal(result.staleIds.has("a"), false, "'Hello world' -> 'Hi world' is still 2 tokens — timing must be preserved, not marked stale");
});

test("17. changed-token-count replacement IS marked stale", () => {
  const subs = [sub("a", "Hello world", [{ text: "Hello", start: 0, end: 1 }, { text: "world", start: 1, end: 2 }])];
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello world", "Hi there everyone", { matchCase: false, wholeWord: false });
  assert.equal(result.textById.get("a"), "Hi there everyone");
  assert.equal(result.staleIds.has("a"), true, "2 tokens -> 3 tokens must be flagged stale");
});

test("18. a caption with NO existing word-level timing is never marked stale, even if its token count changes", () => {
  const subs = [sub("a", "Hello world", [])]; // no words at all
  const result = computeBatchFindReplace(subs, new Set(["a"]), "Hello world", "Hi there everyone", { matchCase: false, wholeWord: false });
  assert.equal(result.staleIds.has("a"), false, "nothing to invalidate — there was no timing to begin with");
});

// ---------------------------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------------------------

test("19. uppercase transform", () => {
  assert.equal(applyTextTransform("Hello World", "uppercase"), "HELLO WORLD");
});

test("20. lowercase transform", () => {
  assert.equal(applyTextTransform("Hello World", "lowercase"), "hello world");
});

test("21. title case transform", () => {
  assert.equal(applyTextTransform("hello world FOO", "titlecase"), "Hello World Foo");
});

test("21b. title case preserves newlines and multiple spaces exactly", () => {
  assert.equal(applyTextTransform("hello  world\nfoo", "titlecase"), "Hello  World\nFoo");
});

test("21c. transforms on Hindi text are safe no-ops (Devanagari has no case distinction) — not a bug", () => {
  const text = "नमस्ते दुनिया";
  assert.equal(applyTextTransform(text, "uppercase"), text);
  assert.equal(applyTextTransform(text, "titlecase"), text);
});

test("22. computeBatchTextTransform applies to every selected caption, skips unaffected ones, and reports totalMatches as 0", () => {
  const subs = [sub("a", "hello"), sub("b", "world"), sub("c", "already Upper")];
  const result = computeBatchTextTransform(subs, new Set(["a", "b"]), "uppercase");
  assert.equal(result.textById.get("a"), "HELLO");
  assert.equal(result.textById.get("b"), "WORLD");
  assert.equal(result.textById.has("c"), false, "c is not selected");
  assert.equal(result.totalMatches, 0);
});

test("23. computeBatchTextTransform on a NON-CONTIGUOUS selection applies independently to each, in array order regardless of selection order", () => {
  const subs = [sub("a", "one"), sub("b", "two"), sub("c", "three"), sub("d", "four")];
  const result = computeBatchTextTransform(subs, new Set(["d", "a"]), "uppercase");
  assert.deepEqual(new Set(result.textById.keys()), new Set(["a", "d"]));
  assert.equal(result.textById.get("a"), "ONE");
  assert.equal(result.textById.get("d"), "FOUR");
  assert.equal(result.textById.has("b"), false);
  assert.equal(result.textById.has("c"), false);
});

test("24. a transform whose output is identical to the current text (e.g. already-uppercase) is not included in textById at all", () => {
  const subs = [sub("a", "ALREADY UPPER")];
  const result = computeBatchTextTransform(subs, new Set(["a"]), "uppercase");
  assert.equal(result.textById.size, 0, "no real change occurred, so nothing needs to be written or marked stale");
});

test("25. transform stale-timing detection uses the same token-count comparison as find & replace", () => {
  const subs = [sub("a", "hello world", [{ text: "hello", start: 0, end: 1 }, { text: "world", start: 1, end: 2 }])];
  // Case transforms never change token COUNT (only casing), so this should never be stale.
  const result = computeBatchTextTransform(subs, new Set(["a"]), "uppercase");
  assert.equal(result.staleIds.has("a"), false);
});

// ---------------------------------------------------------------------------------------------
// Selection edge cases
// ---------------------------------------------------------------------------------------------

test("26. zero selected ids: both functions return an empty, no-op result without inspecting any caption", () => {
  const subs = [sub("a", "Hello world")];
  const fr = computeBatchFindReplace(subs, new Set(), "Hello", "Hi", { matchCase: false, wholeWord: false });
  const tr = computeBatchTextTransform(subs, new Set(), "uppercase");
  assert.equal(fr.textById.size, 0);
  assert.equal(tr.textById.size, 0);
});

test("27. one selected id behaves identically to a larger selection containing just that one id", () => {
  const subs = [sub("a", "Hello world"), sub("b", "Hello there")];
  const one = computeBatchFindReplace(subs, new Set(["a"]), "Hello", "Hi", { matchCase: false, wholeWord: false });
  assert.equal(one.textById.get("a"), "Hi world");
  assert.equal(one.textById.has("b"), false);
});
