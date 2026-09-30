/**
 * Task 102741 (P15) — pure helpers for word-level SPLIT/MERGE/DELETE. No React, no store; consumed
 * by editor-store.ts (the actual commit-routed mutations) and directly unit-tested. Deliberately
 * does not duplicate any existing timing-validation logic: the MINIMUM-duration floor these
 * functions enforce is the same `MIN_WORD_DURATION_SEC` word-timing.ts already defines, and every
 * caller still runs the resulting words through the SAME `breakIntoLines` reflow
 * splitSubtitleAt/mergeWithNext already use to keep a caption's own `.text` in sync with its
 * `words` array (so `isWordTimingStale` — a pure word-count-vs-token-count comparison — stays
 * correctly non-stale after any of these operations, never a special case).
 *
 * METADATA POLICY (documented once here, applies to split/merge/insert AND to the direct
 * same-token-count text-replacement remap below — Task 108762, P18.1 extended this policy to
 * cover that fourth case; see each function's own doc comment for the specific reasoning):
 *   - `confidence` is NEVER copied, duplicated, or averaged onto a word whose own text is a new
 *     derived token (a split half, a merged whole, or — as of P18.1 — a word whose text was
 *     directly replaced by different text at the same position) — every value this module could
 *     assign would be a number nobody actually measured for that specific new span, which is
 *     exactly what "never fabricate a confidence value" forbids. Left `undefined`.
 *   - `style` (a per-word visual override, not a measurement) IS safe to carry forward — see each
 *     function for the exact rule. This is also why a same-position text replacement (P18.1)
 *     preserves `style` unconditionally: it was never a claim about the word's CONTENT to begin
 *     with, only about how whatever occupies this timing slot should look.
 *   - `hinglishText`/`gujaratiScriptText` are always cleared (`undefined`) on a SPLIT word — a
 *     split decides a brand-new token boundary that has no correspondence in the derived text, so
 *     there is no safe value to carry forward (this is not a new rule invented for P15, it's the
 *     EXACT existing convention `remapWordsToText`, editor-store.ts, already applies to every
 *     other text-changing mutation in this codebase). A MERGED word is different (Task 106284,
 *     P17.1): merging never invents a boundary, it only joins two ALREADY-COMPLETE spans, so
 *     `mergeWords` preserves `hinglishText`/`gujaratiScriptText` by the same join-by-space rule as
 *     `.text` itself — but only when BOTH source words already have a real value for that field;
 *     see `mergeWords`'s own doc comment.
 *   - `removed` (soft-delete history) is propagated conservatively — see each function. A direct
 *     text replacement (P18.1) is no exception: `removed` is left exactly as it was, since a text
 *     edit is not a "restore this filler word" action, and this codebase has no such affordance.
 */
import type { Word } from "../../types/subtitle.ts";
import { MIN_WORD_DURATION_SEC, findChronologicalWordNeighbors } from "./word-timing.ts";
import { segmentGraphemes } from "./grapheme.ts";

export interface WordSplitResult {
  left: Word;
  right: Word;
}

/**
 * Splits ONE word into two, given the two resulting text tokens (already decided by the caller —
 * this module never guesses where to split; see this file's own top-level doc comment). Timing is
 * divided PROPORTIONALLY by each token's own character length relative to the original word's
 * total duration — e.g. splitting "hello" (10.00→10.50, a 0.5s span) into "hel"/"lo" (3 and 2
 * characters) yields "hel" 10.00→10.30 and "lo" 10.30→10.50 (3:2 length ratio -> 0.3s:0.2s), never
 * an even half-and-half split and never a guessed phonetic boundary.
 *
 * Returns `null` (do nothing) when the split is invalid:
 *   - either resulting text is empty after trimming
 *   - the proportional split would leave either resulting word below MIN_WORD_DURATION_SEC (only
 *     possible for an already very short original word, or a very lopsided length ratio)
 * The caller is expected to surface this as a clear, non-destructive "can't split this" message —
 * this function itself never mutates anything, it only decides feasibility and the resulting shape.
 */
export function splitWordText(word: Word, leftText: string, rightText: string): WordSplitResult | null {
  const left = leftText.trim();
  const right = rightText.trim();
  if (!left || !right) return null;

  const totalLen = left.length + right.length;
  const duration = word.end - word.start;
  if (!(duration > 0) || totalLen === 0) return null;

  const leftDuration = duration * (left.length / totalLen);
  const splitPoint = word.start + leftDuration;
  const rightDuration = word.end - splitPoint;
  if (leftDuration < MIN_WORD_DURATION_SEC || rightDuration < MIN_WORD_DURATION_SEC) return null;

  return {
    // Confidence is never fabricated for a new derived token — see this file's own metadata
    // policy doc comment. `style` (a visual override, not a measurement) IS safe to duplicate
    // onto both halves: it's the same user-chosen override applying to a smaller span of the
    // same original word, not an invented value. `removed` propagates unchanged — a split of an
    // already-soft-deleted word produces two still-soft-deleted words, matching its own meaning
    // ("kept for history").
    left: { text: left, start: word.start, end: splitPoint, style: word.style, removed: word.removed },
    right: { text: right, start: splitPoint, end: word.end, style: word.style, removed: word.removed },
  };
}

/**
 * A simple, deterministic DEFAULT two-token suggestion for the split UI to pre-fill (the user can
 * always edit it before confirming — see this file's own top-level doc comment: "the exact split
 * mechanism should be conservative," never a guessed phonetic boundary). Task 103884 (P16): splits
 * at the word's GRAPHEME-CLUSTER midpoint (see lib/subtitles/grapheme.ts), not a raw character
 * count — the P15 version of this function sliced by UTF-16 code unit, which could sever a
 * combining mark from its base character (Devanagari "नमस्ते" -> "नमस"/"्ते", splitting the vowel
 * sign "े" away from the "त" it belongs to). Biases the extra cluster to the LEFT half for an odd
 * count (`"abc"` -> `"ab"`/`"c"`) — the same arbitrary-but-deterministic tie-break as before,
 * unchanged; for plain ASCII/Latin text with no combining marks, every grapheme cluster is exactly
 * one character, so this produces byte-for-byte identical output to the P15 version (confirmed by
 * this module's own tests — grapheme-awareness only ever changes behavior for text that actually
 * has combining marks or multi-code-point clusters to protect). Returns `null` for a word with
 * fewer than 2 grapheme clusters (nothing to split at all).
 */
export function defaultWordSplit(text: string): { left: string; right: string } | null {
  const trimmed = text.trim();
  const graphemes = segmentGraphemes(trimmed);
  if (graphemes.length < 2) return null;
  const mid = Math.ceil(graphemes.length / 2);
  return { left: graphemes.slice(0, mid).join(""), right: graphemes.slice(mid).join("") };
}

/**
 * Merges `word` with the word immediately after it in the caption's own TEXT (`nextWord`) into ONE
 * word: text is the two originals joined by a single space (in that textual order, unconditionally
 * — this half is intentionally array/textual-order, matching this task's own spec example: "hello"
 * + "world" -> "hello world"). Timing spans `[min(word.start, nextWord.start),
 * max(word.end, nextWord.end)]` — Task 118943 (P18.10): NOT unconditionally `word.start`/
 * `nextWord.end`, because `word`/`nextWord` are textually (array) adjacent, which P18.6 (Task
 * 113528) explicitly no longer guarantees is also chronologically adjacent; a reordered `nextWord`
 * could be chronologically EARLIER than `word`, and the old unconditional `start/end` would then
 * silently produce an INVERTED interval (`end < start`). min/max instead always produces the true
 * bounding span of both real timestamps, identical to the old formula whenever `word` genuinely IS
 * chronologically before `nextWord` (the overwhelmingly common, unreordered case — zero behavior
 * change there). This does not by itself guarantee the merged span avoids a THIRD word that sits
 * chronologically between `word` and `nextWord` — see `mergeWordWithNext` (editor-store.ts), the
 * sole caller, which validates that separately before committing (mirrors `mergeSubtitles`'s own
 * "concatenate, then validate rather than silently repair" precedent, Task 114761/P18.7).
 *
 * Confidence is dropped (`undefined`) — see this file's own metadata policy doc comment: the two
 * original words may carry two genuinely different measured confidence values, and averaging or
 * picking either one would fabricate a number nobody actually measured for the new, larger span.
 * `style` takes the FIRST word's override (a simple, deterministic, documented tie-break — no
 * "smart" merging of two possibly-conflicting per-word style objects). `removed` is true if
 * EITHER original word was soft-deleted (conservative: a merge should never silently un-delete
 * content the filler-removal feature had already marked for removal).
 *
 * Task 106284 (P17.1) — `hinglishText`/`gujaratiScriptText` are preserved with the SAME
 * join-by-space rule as `.text`, but ONLY when BOTH `word` and `nextWord` already have a real,
 * measured value for that field: `merged.hinglishText = word.hinglishText + " " + nextWord.
 * hinglishText`. This is not fabrication — it's the identical "join two existing real values"
 * operation `.text` itself already gets, just applied to a field that happens to hold derived
 * text instead of original text. When EITHER side is missing a value (the far more common case in
 * "original" mode, where derived text is usually never generated at all), that field is left
 * `undefined` on the result — exactly the old, pre-P17.1 behavior — so the caller's existing
 * "clear the caption-level cache, let ensureHinglishCoverage/ensureGujaratiScriptCoverage
 * regenerate whatever's still missing" pattern (editor-store.ts) picks it up with no changes
 * needed there. Applied independently per field: a caption that only has Hinglish generated (not
 * Gujarati Script) can still preserve `hinglishText` while `gujaratiScriptText` stays undefined.
 */
export function mergeWords(word: Word, nextWord: Word): Word {
  return {
    text: `${word.text} ${nextWord.text}`,
    start: Math.min(word.start, nextWord.start),
    end: Math.max(word.end, nextWord.end),
    style: word.style,
    removed: word.removed || nextWord.removed || undefined,
    hinglishText: word.hinglishText !== undefined && nextWord.hinglishText !== undefined ? `${word.hinglishText} ${nextWord.hinglishText}` : undefined,
    gujaratiScriptText:
      word.gujaratiScriptText !== undefined && nextWord.gujaratiScriptText !== undefined
        ? `${word.gujaratiScriptText} ${nextWord.gujaratiScriptText}`
        : undefined,
  };
}

/** True if `[candidate.start, candidate.end)` genuinely overlaps ANY of `words` at an index NOT in
 * `excludeIndices` — Task 118943 (P18.10): the check `mergeWordWithNext` (editor-store.ts) uses to
 * reject a merge whose resulting span would silently swallow a third word's real timing (possible
 * once `word`/`nextWord` are merged via min/max — see `mergeWords`'s own doc comment — because they
 * are only guaranteed textually adjacent, not chronologically adjacent). Malformed entries
 * (non-finite start/end) are skipped, matching this module's/word-timing.ts's own "skip, never
 * fabricate" convention. */
export function overlapsOtherWord(candidate: { start: number; end: number }, words: readonly Word[], excludeIndices: ReadonlySet<number>): boolean {
  for (let i = 0; i < words.length; i++) {
    if (excludeIndices.has(i)) continue;
    const w = words[i];
    if (typeof w.start !== "number" || typeof w.end !== "number" || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    if (candidate.start < w.end && candidate.end > w.start) return true;
  }
  return false;
}

/**
 * Removes `words[index]`, collapsing the gap it leaves by extending its REAL CHRONOLOGICAL
 * neighbor's own end/start to cover the deleted word's former end/start — Task 118943 (P18.10):
 * NOT the array-adjacent `words[index-1]`/`words[index+1]` (the pre-P18.10 rule), because P18.6
 * (Task 113528) explicitly no longer guarantees array adjacency is also chronological adjacency; a
 * reordered array-adjacent word could sit far away in real time, and extending IT instead would
 * either invert its own interval or silently swallow a third word sitting between it and the
 * deleted word. The chronological predecessor/successor is found the same way
 * `findChronologicalWordNeighbors` (word-timing.ts) does — by real timestamp, never by array
 * position — but this function additionally needs to know WHICH index to extend (not just the
 * timestamp), so it tracks the winning index directly rather than reusing that function's
 * value-only return shape.
 *
 * This remains unconditionally safe: extending the TRUE chronological predecessor (the word with
 * the latest `end` among those already ending at-or-before the deleted word's own start) forward
 * only as far as the deleted word's own end can never reach past the deleted word's real
 * chronological successor — if some other word's `start` were less than the deleted word's `end`,
 * that word would already have overlapped the deleted word BEFORE this deletion (pre-existing,
 * unrelated corrupt data, not something this operation could ever introduce). Symmetric reasoning
 * for pulling the chronological successor's start back when there is no predecessor. When NEITHER
 * a chronological predecessor nor successor exists (the deleted word was the caption's only word,
 * or every other word is malformed), the word is simply removed with nothing extended — still a
 * safe, always-valid result, just without the gap-absorbing convenience.
 *
 * When `words` has only the one word being deleted, the result is an empty array — the caption
 * becomes text-less/word-less, the exact same state P14's caption-text CUT already produces and
 * that the existing EMPTY_CAPTION quality check already detects (see quality-analyzer.ts); this
 * is not a new state this codebase has to learn to handle.
 *
 * Returns `null` only for a structurally invalid request (out-of-range index), matching
 * clampWordTiming's own "null means the caller asked for something that doesn't exist" convention.
 */
export function deleteWordConservative(words: Word[], index: number): Word[] | null {
  if (!Array.isArray(words) || index < 0 || index >= words.length) return null;
  if (words.length === 1) return [];
  const target = words[index];

  let prevIndex = -1;
  let prevEnd = -Infinity;
  let nextIndex = -1;
  let nextStart = Infinity;
  for (let i = 0; i < words.length; i++) {
    if (i === index) continue;
    const w = words[i];
    if (typeof w.start !== "number" || typeof w.end !== "number" || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    if (w.end <= target.start && w.end > prevEnd) {
      prevEnd = w.end;
      prevIndex = i;
    }
    if (w.start >= target.end && w.start < nextStart) {
      nextStart = w.start;
      nextIndex = i;
    }
  }

  const result = words.filter((_, i) => i !== index);
  const reindex = (i: number) => (i < index ? i : i - 1); // account for the removed element shifting later indices down by one
  if (prevIndex !== -1) {
    const ri = reindex(prevIndex);
    result[ri] = { ...result[ri], end: target.end };
  } else if (nextIndex !== -1) {
    const ri = reindex(nextIndex);
    result[ri] = { ...result[ri], start: target.start };
  }
  return result;
}

/**
 * Task 103884 (P16) — validates and normalizes user-entered text for a single NEW word: must be
 * exactly one logical token — trimmed, non-empty, and containing no internal whitespace (a
 * multi-word phrase like "very good" is rejected outright rather than silently split into two
 * words — see this file's own module doc comment for why: never guess a split/token boundary the
 * caller didn't explicitly provide). Unicode letters/punctuation are fully allowed; this is not an
 * ASCII-only check.
 */
export function normalizeInsertedWordText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/\s/u.test(trimmed)) return null;
  return trimmed;
}

export interface InsertionGap {
  start: number;
  end: number;
}

/**
 * Computes the exact [start,end) gap available for inserting a word on `side` of
 * `words[anchorIndex]` — pure gap geometry only, does not judge sufficiency (see
 * resolveWordInsertion for the MIN_WORD_DURATION_SEC check) — exposed separately so the UI can show
 * the exact proposed span before the user even types anything. Falls back to the caption's own
 * boundary when the anchor word has no REAL CHRONOLOGICAL neighbor on that side (Task 118943,
 * P18.10 — not the array-adjacent `words[anchorIndex-1]`/`words[anchorIndex+1]` the pre-P18.10
 * version used, which silently assumed array adjacency was also chronological adjacency; P18.6
 * (Task 113528) no longer guarantees that, and the old array-adjacent gap could claim a span that
 * actually overlapped a THIRD word's real timing — e.g. inserting "before" a reordered word using
 * its array-previous neighbor's end could produce a gap that swallows a word chronologically
 * between the two). Reuses `findChronologicalWordNeighbors` (word-timing.ts, Task 117206/P18.9) —
 * the same "closest real word by actual timestamp, never by array position" scan already
 * established and tested there — never invents a gap, never shifts the caption's own start/end.
 */
export function computeInsertionGap(
  words: Word[],
  anchorIndex: number,
  side: "before" | "after",
  captionStart: number,
  captionEnd: number,
): InsertionGap | null {
  if (!Array.isArray(words) || anchorIndex < 0 || anchorIndex >= words.length) return null;
  const anchor = words[anchorIndex];
  const { prevEnd, nextStart } = findChronologicalWordNeighbors(words, anchorIndex);
  if (side === "before") {
    return { start: prevEnd ?? captionStart, end: anchor.start };
  }
  return { start: anchor.end, end: nextStart ?? captionEnd };
}

export interface WordInsertResult {
  word: Word;
  index: number; // splice index into the ORIGINAL words array
}

/**
 * Computes the new word (text + deterministic timing) and its target splice index for inserting
 * relative to `words[anchorIndex]`. The new word claims the ENTIRE available gap — never
 * fabricated, never partial/proportional, never borrowed from an unrelated word (see this task's
 * own worked example: previous 0.00-1.00, selected 1.20-2.00, "Insert Before" -> new word claims
 * the whole 1.00-1.20 gap).
 *
 * Returns `null` (reject, no mutation) when:
 *   - `rawText` fails `normalizeInsertedWordText` (empty, whitespace-only, or multiple tokens)
 *   - the available gap is smaller than `MIN_WORD_DURATION_SEC` (a gap exactly equal to the
 *     minimum IS accepted — same boundary convention `clampWordTiming` already uses elsewhere)
 *
 * Metadata policy for the new word (Task 103884 Phase 10 — differs from split/merge's `removed:
 * undefined` policy):
 *   - `confidence: undefined`, `hinglishText: undefined`, `gujaratiScriptText: undefined` — never
 *     fabricated, this word was never actually transcribed/derived by anything
 *   - `removed: false` explicitly (not `undefined`) — this is a genuinely new, present word, not a
 *     soft-deletion-history placeholder
 *   - `style` propagates from the ANCHOR word — mirrors `splitWordText`'s own precedent of carrying
 *     a word's style forward onto derived words, so the newly inserted word visually matches its
 *     immediate neighbor rather than silently reverting to an unstyled default
 */
export function resolveWordInsertion(
  words: Word[],
  anchorIndex: number,
  side: "before" | "after",
  rawText: string,
  captionStart: number,
  captionEnd: number,
): WordInsertResult | null {
  if (!Array.isArray(words) || anchorIndex < 0 || anchorIndex >= words.length) return null;
  const text = normalizeInsertedWordText(rawText);
  if (!text) return null;
  const gap = computeInsertionGap(words, anchorIndex, side, captionStart, captionEnd);
  if (!gap) return null;
  if (gap.end - gap.start < MIN_WORD_DURATION_SEC) return null;
  const index = side === "before" ? anchorIndex : anchorIndex + 1;
  return {
    word: {
      text,
      start: gap.start,
      end: gap.end,
      style: words[anchorIndex].style,
      removed: false,
    },
    index,
  };
}

/**
 * Task 108762 (P18.1) — the metadata-preservation half of a direct, same-token-count text
 * replacement at ONE word's position (see editor-store.ts's `remapWordsToText`, the only caller —
 * that function still owns the separate "does the token count even match" decision; this is only
 * ever invoked once that's already true).
 *
 * Fixes a genuine mutation-metadata-integrity gap found by the P18 preflight audit (Task 108041,
 * §7): before this fix, replacing "hello world" with "hi earth" (same token count) left the
 * ORIGINAL words' `confidence` attached to the completely different new text — silently
 * presenting Whisper's measured probability for "hello" as if it described "hi", a word Whisper
 * never actually transcribed or scored.
 *
 * The rule:
 *   - If the token TEXT at this position is unchanged (case A — a no-op for this specific word,
 *     even if OTHER words in the same caption changed), the word is returned completely
 *     untouched — confidence/style/removed all stay exactly as they were, because nothing about
 *     this word actually changed.
 *   - If the token text at this position DID change (case B), `confidence` is cleared
 *     (`undefined`) — the same "never fabricate a confidence value for text nobody actually
 *     measured" principle `splitWordText`/`mergeWords`/`resolveWordInsertion` already apply above,
 *     now extended to this fourth mutation path (see this file's own top-of-file METADATA POLICY
 *     comment). `style` and `removed` are deliberately left untouched even in this case — see that
 *     same policy comment for why (style is positional/visual, never content-derived; removed
 *     propagates conservatively, and a text edit is not a "restore this filler word" action).
 *   - `start`/`end` (timing) are never touched here at all — timing safety/staleness is entirely
 *     `remapWordsToText`'s own existing, unchanged concern (it only calls this once it has already
 *     decided the token count matches; a mismatched count never reaches this function at all).
 */
export function remapWordMetadataForTextReplacement(oldWord: Word, newText: string): Word {
  if (oldWord.text === newText) return oldWord;
  return { ...oldWord, text: newText, confidence: undefined };
}
