/**
 * Task 98134 (P11) — pure, store-free helpers for the batch TEXT CLEANUP workflow (whitespace
 * cleanup, conservative sentence case, punctuation normalization, and blank-caption detection),
 * scoped to a set of selected caption ids. No React, no store — mirrors
 * lib/subtitles/batch-text-ops.ts's own P10 shape exactly (this module's compute function is
 * "preview before apply": pure, safe to call on every keystroke while a dialog is open) and
 * reuses that module's `applyTextTransform`/`staleAfterTextChange` rather than duplicating them
 * (P10's UPPERCASE/lowercase/Title Case transforms are still the SAME single implementation,
 * just one more entry in this module's own `caseTransform` union).
 *
 * Word-timing safety: exactly the same contract as batch-text-ops.ts — this module only ever
 * computes NEW TEXT (or a delete decision) per caption; it never touches `words` itself. The
 * store's `applyTextCleanup` action still calls the existing `remapWordsToText` for every
 * text-changing caption, so token-count-preserving edits keep their real timestamps and
 * token-count-changing edits go stale via the SAME existing derivation
 * (`isWordTimingStale`/`staleAfterTextChange`) — never a second mechanism.
 */
import type { Subtitle } from "../../types/subtitle.ts";
import { tokenizeCaptionText } from "./word-timing.ts";
import { applyTextTransform, staleAfterTextChange } from "./batch-text-ops.ts";

// ---------------------------------------------------------------------------------------------
// 1. TEXT CLEANUP (whitespace + repeated punctuation)
// ---------------------------------------------------------------------------------------------

/** A. Trims only the very start/end of the whole caption — never touches whitespace that sits
 * between two lines (that's normalizeLineBreakWhitespace's job) or between two words on the same
 * line (normalizeSpaces' job), so combining all three cleanup toggles never double-processes the
 * same whitespace in a surprising order-dependent way. */
export function trimCaptionWhitespace(text: string): string {
  return text.trim();
}

/** B. Collapses runs of horizontal whitespace (space/tab) down to a single space — deliberately
 * excludes `\n`/`\r` from the character class, so this NEVER merges two intentional lines into
 * one (see this module's own "do not blindly destroy intentional line breaks" requirement). */
export function normalizeSpaces(text: string): string {
  return text.replace(/[ \t]+/gu, " ");
}

/** C. Strips horizontal whitespace immediately touching a line break on either side, without
 * touching the break itself (so `\n` stays `\n`, `\r\n` stays `\r\n`) and without collapsing
 * multiple consecutive breaks (an intentional blank line between two caption lines survives). */
export function normalizeLineBreakWhitespace(text: string): string {
  return text.replace(/[ \t]+(\r?\n)/gu, "$1").replace(/(\r?\n)[ \t]+/gu, "$1");
}

/** D. Collapses a run of 2+ of the SAME punctuation mark to its canonical single form — "!!" → "!",
 * "????" → "?", and any run of 2+ dots → the conventional 3-dot ellipsis "..." (so "Wait......"
 * becomes "Wait...", and an already-correct "..." is left visually unchanged). Deliberately does
 * NOT touch a run of DIFFERENT marks (no backreference match for "?!"/"!?" — see the module doc
 * comment) and never touches quote/apostrophe characters at all, since neither is in the pattern
 * — both are exactly the "intentional punctuation" this task's spec says must survive untouched. */
export function normalizeRepeatedPunctuation(text: string): string {
  return text.replace(/([!?])\1+/gu, "$1").replace(/\.{2,}/gu, "...");
}

// ---------------------------------------------------------------------------------------------
// 2. SENTENCE CASE
// ---------------------------------------------------------------------------------------------

/** A conservative, script-agnostic guess at "this token is a URL or email, don't touch its
 * casing" — used by both sentenceCase (don't capitalize a URL/email that happens to start a
 * sentence) and shouldEnsureTrailingPunctuation (don't append a period after one). Strips a
 * leading opening quote/paren and a trailing closing quote/paren/terminal-punctuation run before
 * testing, so "(example.com)" or "example.com." are still recognized. Not a full URL grammar —
 * a deliberately small, conservative surface (scheme prefix, `www.`, an `@` with a TLD-shaped
 * tail, or a bare `label.label...tld` domain shape) matching this task's own "if a reliable
 * conservative transformation cannot be made, leave that token unchanged" instruction: false
 * negatives (missing an unusual URL) just mean normal sentence-case treatment applies, which is
 * still safe; this never produces a false POSITIVE that skips a token that wasn't actually a URL. */
function looksLikeUrlOrEmail(token: string): boolean {
  const stripped = token.replace(/^[("'“‘]+/u, "").replace(/[)"'”’.,;:!?]+$/u, "");
  if (!stripped) return false;
  if (/^(https?:\/\/|www\.)/iu.test(stripped)) return true;
  if (stripped.includes("@") && /\.[a-z]{2,}$/iu.test(stripped)) return true;
  if (/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/iu.test(stripped)) return true;
  return false;
}

/**
 * Conservative, deterministic "Sentence case": capitalizes only the FIRST cased letter of each
 * detected sentence — the start of the text, the start of each existing line (an explicit signal
 * this task's spec calls out), and the first non-whitespace character after `.`/`!`/`?` followed
 * by whitespace. Nothing else in the sentence is ever touched — no forced lowercasing — so a
 * mid-sentence acronym like "SUBLY" survives completely untouched (that's what makes this safe:
 * a real "sentence case" transform that also lowercased the rest would destroy exactly the
 * acronyms/proper-noun casing this task's spec says to preserve).
 *
 * `toLocaleUpperCase` on a single code point is a correct no-op for scripts with no case
 * distinction (Devanagari, most CJK, ...), so this is automatically safe on Hindi and mixed
 * English/Hindi text — there is no separate "skip non-Latin scripts" branch because none is
 * needed (confirmed by this module's own test file with real Devanagari text).
 */
export function sentenceCase(text: string): string {
  const chars = Array.from(text);
  let out = "";
  let atStart = true;
  let pendingTerminal = false;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === "\n") {
      out += ch;
      atStart = true;
      pendingTerminal = false;
      i++;
      continue;
    }
    if (atStart) {
      if (/\s/u.test(ch)) {
        out += ch;
        i++;
        continue;
      }
      if (/\p{L}/u.test(ch)) {
        let j = i;
        while (j < chars.length && !/\s/u.test(chars[j])) j++;
        const token = chars.slice(i, j).join("");
        out += looksLikeUrlOrEmail(token) ? token : ch.toLocaleUpperCase() + chars.slice(i + 1, j).join("");
        i = j;
      } else {
        out += ch;
        i++;
      }
      atStart = false;
      pendingTerminal = false;
      continue;
    }
    if (pendingTerminal) {
      if (/\s/u.test(ch)) {
        out += ch;
        atStart = true;
        i++;
        continue;
      }
      pendingTerminal = false;
    }
    if (ch === "." || ch === "!" || ch === "?") pendingTerminal = true;
    out += ch;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3. PUNCTUATION (trailing)
// ---------------------------------------------------------------------------------------------

/** Terminal marks that already "count" as trailing punctuation — a caption ending in any of
 * these is left alone by "Ensure trailing punctuation" (it already has an ending), matching this
 * task's explicit "do not add ... to captions already ending in ?/!/ellipsis/comma/colon/
 * semicolon" list. The ellipsis character "…" is included alongside the ASCII "..." case (the
 * latter ends in ".", already in this set). */
const TRAILING_TERMINATOR = /[.!?…,:;]/u;

/** True only when `text` looks like a genuine, complete sentence lacking an ending mark — see
 * this module's own doc comment on `ensureTrailingPunctuation` for the exact, deliberately
 * conservative rule set and its known limitation (syntactic sentence-fragment detection, e.g. a
 * bare heading like "Chapter 5", is NOT attempted — see the P11 report's "known limitations"). */
export function shouldEnsureTrailingPunctuation(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  if (TRAILING_TERMINATOR.test(trimmed[trimmed.length - 1])) return false;
  if (!/\p{L}/u.test(trimmed)) return false; // no letters anywhere — a numeric/symbol-only fragment
  const lastToken = trimmed.split(/\s+/u).pop() ?? "";
  if (looksLikeUrlOrEmail(lastToken)) return false;
  return true;
}

/** Appends "." only when `shouldEnsureTrailingPunctuation` agrees — preserves any trailing
 * whitespace exactly (the period is inserted right after the trimmed content, before it). */
export function ensureTrailingPunctuation(text: string): string {
  if (!shouldEnsureTrailingPunctuation(text)) return text;
  const trimmedLen = text.trimEnd().length;
  return text.slice(0, trimmedLen) + "." + text.slice(trimmedLen);
}

/** Removes only a trailing run of terminal punctuation (`.,!?;:…`) — never touches internal
 * punctuation, and preserves whatever trailing whitespace already followed it. */
export function removeTrailingPunctuation(text: string): string {
  return text.replace(/[.,!?;:…]+(\s*)$/u, "$1");
}

// ---------------------------------------------------------------------------------------------
// 4. EMPTY / NEAR-EMPTY CAPTION CLASSIFICATION
// ---------------------------------------------------------------------------------------------

export type CaptionContentClass =
  | "empty"
  | "whitespace-only"
  | "punctuation-only"
  | "suspicious-short"
  | "short-intentional"
  | "normal";

/**
 * Deterministic, script-agnostic classification used by both the batch cleanup engine (delete
 * candidates) and quality-analyzer.ts's SUSPICIOUS_SHORT_TEXT check (see that file — never a
 * second definition). Deliberately conservative per this task's own "do NOT automatically
 * classify every one-character caption as invalid" instruction:
 *  - "empty" / "whitespace-only": ERROR-tier at the quality layer (folds into the EXISTING
 *    EMPTY_CAPTION issue type — see quality-analyzer.ts, never duplicated here) and the only two
 *    classes the batch cleanup's "Remove blank captions" toggle ever deletes.
 *  - "punctuation-only": has content but zero letters (e.g. "...", "!!"). WARNING-tier.
 *  - "suspicious-short": exactly one whitespace-separated token AND exactly one letter in it
 *    (e.g. a lone "a", "I", "क") — WARNING-tier, surfaced for human review, never auto-deleted.
 *  - "short-intentional": exactly one token with 2-3 letters (e.g. "Hi", "OK", "No", "यह") —
 *    INFO-tier only, since this is exactly the shape of a common, legitimate short interjection.
 *  - "normal": everything else — not flagged by SUSPICIOUS_SHORT_TEXT at all.
 * Known limitation (documented in the P11 report): this is a coarse LENGTH heuristic, not a
 * dictionary of real short words in every language — a genuinely meaningful single-letter
 * utterance in some script will still surface as "suspicious-short" (a WARNING a human can
 * dismiss), and a meaningless 3-letter typo will read as "short-intentional" (INFO). Neither
 * misclassification ever deletes or blocks anything — both are advisory only.
 */
export function classifyCaptionContent(text: string): CaptionContentClass {
  if (text.length === 0) return "empty";
  const trimmed = text.trim();
  if (trimmed.length === 0) return "whitespace-only";
  const letterCount = (trimmed.match(/\p{L}/gu) ?? []).length;
  if (letterCount === 0) return "punctuation-only";
  const wordCount = tokenizeCaptionText(text).length;
  if (wordCount === 1 && letterCount === 1) return "suspicious-short";
  if (wordCount === 1 && letterCount <= 3) return "short-intentional";
  return "normal";
}

/** Convenience predicate for the batch cleanup engine's delete-candidate check — the only two
 * classes "Remove blank captions" ever targets (see classifyCaptionContent's own doc comment). */
export function isBlankCaption(text: string): boolean {
  const cls = classifyCaptionContent(text);
  return cls === "empty" || cls === "whitespace-only";
}

// ---------------------------------------------------------------------------------------------
// 5-9. COMBINED CLEANUP PIPELINE + BATCH PREVIEW/APPLY
// ---------------------------------------------------------------------------------------------

export type CaseTransformChoice = "none" | "sentence" | "uppercase" | "lowercase" | "titlecase";
export type TrailingPunctuationChoice = "none" | "ensure" | "remove";

export interface CleanupSelection {
  trimWhitespace: boolean;
  normalizeSpaces: boolean;
  normalizeLineBreakWhitespace: boolean;
  normalizeRepeatedPunctuation: boolean;
  /** The 4 capitalization options are mutually exclusive by construction (applying, say,
   * UPPERCASE and Sentence case to the same text at once is not a coherent, deterministic
   * operation) — a single choice, not 4 independent booleans, deliberately deviating from a
   * literal reading of the task's own checkbox mockup (see the P11 report's "architecture
   * decisions" for why). */
  caseTransform: CaseTransformChoice;
  /** Same reasoning as caseTransform: "ensure" and "remove" trailing punctuation are opposites
   * and can never both apply to the same Apply. */
  trailingPunctuation: TrailingPunctuationChoice;
  removeBlankCaptions: boolean;
}

export const EMPTY_CLEANUP_SELECTION: CleanupSelection = {
  trimWhitespace: false,
  normalizeSpaces: false,
  normalizeLineBreakWhitespace: false,
  normalizeRepeatedPunctuation: false,
  caseTransform: "none",
  trailingPunctuation: "none",
  removeBlankCaptions: false,
};

export function hasAnyCleanupOperationSelected(sel: CleanupSelection): boolean {
  return (
    sel.trimWhitespace ||
    sel.normalizeSpaces ||
    sel.normalizeLineBreakWhitespace ||
    sel.normalizeRepeatedPunctuation ||
    sel.caseTransform !== "none" ||
    sel.trailingPunctuation !== "none" ||
    sel.removeBlankCaptions
  );
}

/** Applies every TEXT-changing toggle in `sel` to one caption's text, in a fixed, documented
 * order (line-break whitespace → inline spaces → outer trim → repeated punctuation → case →
 * trailing punctuation) chosen so each step sees the previous step's already-cleaned input
 * (e.g. trailing-punctuation detection runs on already-trimmed, already-space-normalized text,
 * so it isn't confused by stray whitespace at the very end). `removeBlankCaptions` is NOT
 * applied here — it's a delete decision made by the caller from the ORIGINAL text, before this
 * function is even called (see computeTextCleanupPreview). */
export function applyCleanupToText(text: string, sel: CleanupSelection): string {
  let out = text;
  if (sel.normalizeLineBreakWhitespace) out = normalizeLineBreakWhitespace(out);
  if (sel.normalizeSpaces) out = normalizeSpaces(out);
  if (sel.trimWhitespace) out = trimCaptionWhitespace(out);
  if (sel.normalizeRepeatedPunctuation) out = normalizeRepeatedPunctuation(out);
  if (sel.caseTransform === "sentence") out = sentenceCase(out);
  else if (sel.caseTransform === "uppercase") out = applyTextTransform(out, "uppercase");
  else if (sel.caseTransform === "lowercase") out = applyTextTransform(out, "lowercase");
  else if (sel.caseTransform === "titlecase") out = applyTextTransform(out, "titlecase");
  if (sel.trailingPunctuation === "ensure") out = ensureTrailingPunctuation(out);
  else if (sel.trailingPunctuation === "remove") out = removeTrailingPunctuation(out);
  return out;
}

export interface CleanupPreviewItem {
  id: string;
  before: string;
  /** Equal to `before` when `willDelete` is true (nothing to show as "after" for a deletion). */
  after: string;
  willDelete: boolean;
  becomesStale: boolean;
}

export interface CleanupPreviewResult {
  /** Every id in the selection, regardless of whether anything is checked yet — lets the UI
   * always show "N captions selected" even before any operation toggle is on. */
  totalSelected: number;
  /** Only AFFECTED captions (a real text change, or a delete) — mirrors
   * batch-text-ops.ts's BatchTextOpResult.textById convention of "only what actually changes". */
  items: CleanupPreviewItem[];
  changedCount: number;
  deleteCount: number;
  unchangedCount: number;
  staleCount: number;
  hasAnyOperationSelected: boolean;
}

/**
 * Computes what a batch cleanup Apply would do, restricted to `selectedIds` — pure, single O(n)
 * pass, never mutates anything (see this module's own "preview before apply" doc comment). A
 * caption is a DELETE candidate only when `removeBlankCaptions` is on AND its ORIGINAL text
 * (never a post-cleanup result) is empty/whitespace-only — deliberately not "becomes blank after
 * other toggles run", so nothing is ever deleted as an unrequested side effect of an unrelated
 * toggle (a caption that only becomes blank as a side effect of another selected operation shows
 * up instead as an ordinary TEXT CHANGE to a now-blank string, which the existing quality
 * analyzer will flag as EMPTY_CAPTION on the next check — visible, not silently discarded).
 */
export function computeTextCleanupPreview(
  subtitles: Pick<Subtitle, "id" | "text" | "words">[],
  selectedIds: ReadonlySet<string>,
  selection: CleanupSelection,
): CleanupPreviewResult {
  const items: CleanupPreviewItem[] = [];
  let changedCount = 0;
  let deleteCount = 0;
  let staleCount = 0;
  let totalSelected = 0;
  const anyOp = hasAnyCleanupOperationSelected(selection);

  for (const s of subtitles) {
    if (!selectedIds.has(s.id)) continue;
    totalSelected++;
    if (!anyOp) continue;

    if (selection.removeBlankCaptions && isBlankCaption(s.text)) {
      items.push({ id: s.id, before: s.text, after: s.text, willDelete: true, becomesStale: false });
      deleteCount++;
      continue;
    }

    const after = applyCleanupToText(s.text, selection);
    if (after === s.text) continue;
    const becomesStale = staleAfterTextChange(s, after);
    items.push({ id: s.id, before: s.text, after, willDelete: false, becomesStale });
    changedCount++;
    if (becomesStale) staleCount++;
  }

  return {
    totalSelected,
    items,
    changedCount,
    deleteCount,
    unchangedCount: totalSelected - changedCount - deleteCount,
    staleCount,
    hasAnyOperationSelected: anyOp,
  };
}
