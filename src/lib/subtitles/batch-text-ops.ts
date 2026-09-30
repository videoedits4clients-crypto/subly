/**
 * Task 97025 (P10) — pure, store-free helpers for BATCH text operations (find & replace, and
 * deterministic case transforms) scoped to a set of selected caption ids. No React, no store —
 * consumed by editor-store.ts (the actual mutations) and search-replace-dialog.tsx/
 * captions-panel.tsx (the live preview, computed WITHOUT touching the store — see this module's
 * own "preview before apply" contract below).
 *
 * Word-timing safety (P7.2 invariant, reused unchanged here): this module only ever computes
 * NEW TEXT per caption — it never touches `words` itself. The actual word-array decision (keep
 * the real timestamps untouched when the token count matches, or leave them as-is — now
 * "stale" — when it doesn't) is `editor-store.ts`'s existing `remapWordsToText`, called exactly
 * the same way `applyTextMap`/`findReplace`/`updateSubtitleText` already call it. This module
 * only tells the caller WHICH captions would go stale (`staleIds`), by comparing the SAME
 * `tokenizeCaptionText` token count `isWordTimingStale` itself uses — it never invents a second
 * staleness definition.
 *
 * "Preview before apply" contract: `computeBatchFindReplace`/`computeBatchTextTransform` are
 * pure functions of their inputs — calling them never mutates anything and is safe to call on
 * every keystroke while a dialog is open (see search-replace-dialog.tsx). The store's own
 * `applyBatchFindReplace`/`applyBatchTextTransform` actions call the SAME functions again,
 * synchronously, at the moment the user clicks Apply — since nothing can mutate `project.subtitles`
 * between a preview render and the Apply click in this single-threaded UI, recomputing is exactly
 * as safe as passing the previewed result through, without needing to plumb a computed map through
 * the store's action signature.
 */
import type { Subtitle } from "../../types/subtitle.ts";
import { tokenizeCaptionText } from "./word-timing.ts";

export function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface FindReplaceOptions {
  /** OFF (default) — "hello"/"Hello"/"HELLO" all match. ON — only exact casing matches. */
  matchCase: boolean;
  /** OFF (default) — "cat" matches inside "concatenate". ON — "cat" matches only as a standalone
   * word, using Unicode General Category L (letter), N (number), and M (mark) as "word-forming"
   * and everything else (whitespace, punctuation, symbols) as a boundary. Category M matters for
   * scripts like Devanagari/Hindi: a vowel sign (matra, e.g. "ा" U+093E) or virama is its OWN
   * Unicode code point classified as a MARK, not a Letter, but is orthographically part of the
   * same word it attaches to — without treating marks as word-forming too, "राम" (Ram) would
   * incorrectly appear to end at a word boundary in the middle of "रामायण" (Ramayana), since the
   * very next character there is the mark "ा", not a Letter (confirmed by a failing test during
   * this task's own implementation — see this module's test file). This is a real, testable,
   * honest definition of "whole word" that works consistently for English, Hindi/Devanagari, and
   * mixed-script text — it is NOT full linguistic word-segmentation (no claim is made about,
   * e.g., correctly segmenting unspaced Devanagari compounds — this app's own text is always
   * whitespace-tokenized already, see tokenizeCaptionText, so this matches that same convention). */
  wholeWord: boolean;
}

/** Builds the actual matching regex for one find operation, or `null` for an empty search (a
 * deliberate no-op, matching the existing global findReplace's own `if (!search) return 0`
 * guard). A FRESH RegExp per call (never reused/shared across captions) — the same "no shared
 * global-regex lastIndex state" discipline the existing findReplace already uses by constructing
 * its own regex inside its per-caption map callback. */
export function buildFindRegex(search: string, options: FindReplaceOptions): RegExp | null {
  if (!search) return null;
  const escaped = escapeRegexLiteral(search);
  const pattern = options.wholeWord ? `(?<![\\p{L}\\p{N}\\p{M}])(?:${escaped})(?![\\p{L}\\p{N}\\p{M}])` : escaped;
  const flags = "gu" + (options.matchCase ? "" : "i");
  return new RegExp(pattern, flags);
}

/** `String.prototype.replace`'s replacement-string argument treats `$&`, `` $` ``, `$'`, `$$`,
 * and `$1`-`$9` as special substitution patterns — completely unrelated to what a batch
 * find-and-replace user would expect when they type a literal `$` into the "Replace" field (see
 * this task's own "replace only the matched text... preserve all unrelated text exactly"
 * requirement). Escaping every literal `$` as `$$` here guarantees the replacement text is
 * ALWAYS inserted exactly as typed, regardless of its contents — a small, deliberate correctness
 * improvement over the pre-existing global findReplace (which passes `replace` through
 * unescaped), kept scoped to this new batch path only so the existing action's behavior is
 * never altered. */
function escapeReplacementLiteral(replace: string): string {
  return replace.replace(/\$/g, "$$$$");
}

export interface BatchTextOpResult {
  /** New text per AFFECTED caption id only — a caption with zero matches (find & replace) or
   * whose transform output is identical to its current text is never included, so callers can
   * both count "how many captions changed" from `.size` and skip re-writing anything unchanged. */
  textById: Map<string, string>;
  /** Total individual match count across every selected caption (find & replace only; always 0
   * for transforms, which don't have a notion of "a match"). */
  totalMatches: number;
  /** IDs (a subset of `textById`'s keys) whose word-timing would become stale — i.e. the new
   * text's token count no longer matches the caption's existing `words.length` — computed via
   * the exact same derivation `isWordTimingStale` uses, never a second definition. A caption
   * with no word-level timing at all (`words.length === 0`) is never "stale" (see
   * word-timing.ts's own hasWordTiming/isWordTimingStale doc comments — no timing to invalidate). */
  staleIds: Set<string>;
}

/** Exported (Task 98134, P11) so lib/subtitles/text-cleanup.ts's own batch preview/apply can
 * decide staleness the exact same way — never a second staleness definition. */
export function staleAfterTextChange(original: Pick<Subtitle, "words">, newText: string): boolean {
  if (!Array.isArray(original.words) || original.words.length === 0) return false;
  return original.words.length !== tokenizeCaptionText(newText).length;
}

/**
 * Computes what a batch find & replace would do across `subtitles`, restricted to
 * `selectedIds` — every other caption is guaranteed untouched (never even visited for anything
 * other than the `selectedIds.has()` check, so this is a single O(n) pass regardless of
 * selection size or shape — see this task's own "avoid O(n²)" requirement). Selection ORDER
 * never affects the result: iteration follows `subtitles`' own array order, and each caption's
 * outcome depends only on its own text, never on any other caption's.
 */
export function computeBatchFindReplace(
  subtitles: Pick<Subtitle, "id" | "text" | "words">[],
  selectedIds: ReadonlySet<string>,
  search: string,
  replace: string,
  options: FindReplaceOptions,
): BatchTextOpResult {
  const textById = new Map<string, string>();
  const staleIds = new Set<string>();
  let totalMatches = 0;
  if (selectedIds.size === 0) return { textById, totalMatches, staleIds };
  const regex = buildFindRegex(search, options);
  if (!regex) return { textById, totalMatches, staleIds };
  const safeReplace = escapeReplacementLiteral(replace);
  for (const s of subtitles) {
    if (!selectedIds.has(s.id)) continue;
    const matches = s.text.match(regex);
    if (!matches || matches.length === 0) continue;
    totalMatches += matches.length;
    const newText = s.text.replace(regex, safeReplace);
    if (newText === s.text) continue;
    textById.set(s.id, newText);
    if (staleAfterTextChange(s, newText)) staleIds.add(s.id);
  }
  return { textById, totalMatches, staleIds };
}

export type TextTransformKind = "uppercase" | "lowercase" | "titlecase";

/** Applies one deterministic case transform to a single caption's text, preserving every
 * whitespace/newline character exactly (transforming only the non-whitespace "word" runs in
 * place via regex, never splitting/rejoining the string) — see this task's own "do not silently
 * change... line breaks" requirement. Uses `toLocaleUpperCase`/`toLocaleLowerCase` (not the
 * locale-insensitive `toUpperCase`/`toLowerCase`) for correct behavior on scripts with
 * locale-sensitive casing rules (e.g. Turkish dotless i) — for scripts with NO case distinction
 * at all (Devanagari/Hindi, most CJK, etc.) these are harmless no-ops on those characters, which
 * is the honest, correct behavior: "Title Case" on Hindi text is expected to look unchanged, not
 * a bug (this app makes no claim of a case system existing where the script has none). */
export function applyTextTransform(text: string, kind: TextTransformKind): string {
  switch (kind) {
    case "uppercase":
      return text.toLocaleUpperCase();
    case "lowercase":
      return text.toLocaleLowerCase();
    case "titlecase":
      return text.replace(/\S+/gu, (word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase());
  }
}

/** Batch analogue of applyTextTransform, restricted to `selectedIds` — same single O(n)-pass,
 * selection-order-independent, "every other caption guaranteed untouched" shape as
 * computeBatchFindReplace. `totalMatches` is always 0 (transforms have no match count). */
export function computeBatchTextTransform(
  subtitles: Pick<Subtitle, "id" | "text" | "words">[],
  selectedIds: ReadonlySet<string>,
  kind: TextTransformKind,
): BatchTextOpResult {
  const textById = new Map<string, string>();
  const staleIds = new Set<string>();
  if (selectedIds.size === 0) return { textById, totalMatches: 0, staleIds };
  for (const s of subtitles) {
    if (!selectedIds.has(s.id)) continue;
    const newText = applyTextTransform(s.text, kind);
    if (newText === s.text) continue;
    textById.set(s.id, newText);
    if (staleAfterTextChange(s, newText)) staleIds.add(s.id);
  }
  return { textById, totalMatches: 0, staleIds };
}
