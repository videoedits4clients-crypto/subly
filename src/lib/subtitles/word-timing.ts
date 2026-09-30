/**
 * Pure helpers for word-level timing (Task 92618, P7.2). No React, no store — consumed by
 * editor-store.ts (mutations), captions-panel.tsx/timeline.tsx (rendering), and their own tests.
 *
 * Word-level timing lives entirely in the EXISTING `Subtitle.words: Word[]` field (see
 * types/subtitle.ts) — this module adds no new persisted field and no schema change. Whether a
 * caption's word timing "needs review" after a text edit is a DERIVED fact (word count vs. the
 * current text's token count), not a stored flag: a caption whose text was edited to a different
 * word count keeps its old `words` array completely untouched (see editor-store.ts's
 * remapWordsToText), so the mismatch itself is what `isWordTimingStale` detects. This is
 * deliberately the smallest possible fix for the P7 audit's "silent synthetic redistribution"
 * finding — see the P7.2 report for the full reasoning.
 */
import type { Subtitle, Word } from "../../types/subtitle.ts";

/** Same tokenization convention already used by editor-store.ts's remap functions — whitespace/
 * newline-separated, empty tokens dropped. Exported so the store and this module never drift on
 * what counts as "a word" for the purposes of comparing text against word count. */
export function tokenizeCaptionText(text: string): string[] {
  return text.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
}

/** True when a caption has SOME word-level timing at all (`words.length > 0`) — distinct from
 * "stale" (see isWordTimingStale below). A caption can have zero words for entirely legitimate
 * reasons (no transcription word data, a manually created caption, legacy/imported data) — that
 * is simply "no word-level timing," not an error state. */
export function hasWordTiming(subtitle: Pick<Subtitle, "words">): boolean {
  return Array.isArray(subtitle.words) && subtitle.words.length > 0;
}

/** Sums the token count of `words[].[field]` (falling back to an empty string for a word that
 * has none), EXCLUDING `removed` (soft-deleted, see Word.removed's own doc comment) words —
 * Task 107284 (P17.3)'s shared counting convention, extracted so `isWordTimingStale` below and
 * `getDerivedWordTextSyncStatus` (lib/subtitles/output-mode.ts) can never drift onto two
 * different definitions of "how many words does this caption's own displayed text represent."
 *
 * Excluding removed words here is what makes the two sides of the comparison actually comparable:
 * EVERY function that builds a caption-level displayed text — `segmentWords` for the authoritative
 * `Subtitle.text` (lib/subtitles/segment.ts, used at transcription time and after filler-word
 * removal), and `generateHinglishForSubtitle`/`regenerateHinglishForSubtitle`/
 * `generateGujaratiScriptForSubtitle`/`regenerateGujaratiScriptForSubtitle` for the derived
 * `hinglishText`/`gujaratiScriptText` fields (lib/subtitles/output-mode.ts) — already filters
 * `!w.removed` before joining. A removed word stays in `words[]` for history (never deleted) and
 * keeps its own real timestamp, but was never part of what got rendered into the text on the
 * other side of the comparison, so counting its tokens here would compare two numbers that were
 * never meant to agree in the first place. */
export function sumWordTokens(words: readonly Pick<Word, "removed" | "text" | "hinglishText" | "gujaratiScriptText">[], field: "text" | "hinglishText" | "gujaratiScriptText"): number {
  return words.reduce((sum, w) => (w.removed ? sum : sum + tokenizeCaptionText(w[field] ?? "").length), 0);
}

/** True when a caption HAS word-level timing whose total token count no longer matches its
 * current text — i.e. a text edit changed the number of words since those timestamps were last
 * valid. Purely derived (word tokens vs. text tokens), so legacy projects and untouched captions
 * (where the two always agree) are never flagged, and nothing needs to be migrated or backfilled.
 * See this module's own doc comment for why this replaces a stored "stale" flag entirely.
 *
 * Compares the SUM of each non-removed word's own token count (`sumWordTokens`, not merely
 * `words.length` — before Task 102741 (P15), every `Word.text` was always guaranteed to be a
 * single token (`remapWordsToText`/segmentation never produced anything else), so the two were
 * always identical and this is a fully backward-compatible generalization, not a behavior change
 * for any pre-P15 data (see this module's own test file for the explicit proof: every existing
 * case, which only ever used single-token words, produces the exact same result either way). P15
 * introduced the first (and so far only) way to produce a MULTI-token `Word.text` — merging two
 * words concatenates them with a space into one Word object (see lib/subtitles/word-edit.ts
 * mergeWords, matching this task's own explicit "hello + world -> one Word, text: 'hello world'"
 * example) — and a caption immediately after a deliberate merge must read as fresh, not stale: the
 * words array and the caption's own text were derived from each other in the SAME operation, so
 * nothing about them has actually drifted out of sync. Counting each word's own internal tokens
 * is what correctly implements "word sequence corresponds to caption tokenization" (P15's own
 * Phase 9 invariant) for that case, without changing the answer for any single-token word, which
 * is still the overwhelming majority of all word data in this app (split still produces two
 * single-token halves by construction whenever the user doesn't type a space into either half).
 *
 * Task 107284 (P17.3) fix: EXCLUDES removed (soft-deleted) words from the sum via `sumWordTokens`
 * — a caption whose text was built by `segmentWords` (the real filler-word-removal pipeline, which
 * already excludes removed words when joining) previously read as permanently stale in EVERY
 * display mode (Original included) the moment it had any removed word, since the old sum counted
 * every word regardless of `removed`. See this module's own test file and the P17.3 report for the
 * exact reproduction. */
export function isWordTimingStale(subtitle: Pick<Subtitle, "text" | "words">): boolean {
  if (!hasWordTiming(subtitle)) return false;
  const wordTokenCount = sumWordTokens(subtitle.words, "text");
  return wordTokenCount !== tokenizeCaptionText(subtitle.text).length;
}

/** Evenly redistributes `tokens` across `[start, end]`, producing monotonic, non-overlapping,
 * caption-bounded word intervals — the exact math previously applied AUTOMATICALLY on every
 * word-count-changing text edit (see editor-store.ts's old remapWordsToText). Used ONLY by an
 * explicit, user-triggered rebuild now (editor-store.ts rebuildWordTiming), never silently. */
export function evenlyDistributeWords(tokens: string[], start: number, end: number): Word[] {
  if (tokens.length === 0) return [];
  const dur = Math.max(0.1, end - start);
  const per = dur / tokens.length;
  return tokens.map((text, i) => ({ text, start: start + i * per, end: start + (i + 1) * per }));
}

export interface RenderableWordSegment {
  /** Index into the subtitle's REAL `words` array — malformed entries are skipped when
   * building this list, so this is NOT the same as the position in the returned array. */
  index: number;
  word: Word;
}

/** Filters `subtitle.words` down to entries safe to render as timeline ticks / word chips:
 * finite, non-inverted (end > start) timestamps. Malformed entries (missing/NaN start or end,
 * end <= start — null word timestamps, invalid ordering, corrupted legacy data) are silently
 * skipped rather than displayed with fabricated positions, per the P7.2 "never fabricate false
 * timing data, never crash" requirement. Does not require entries to lie inside the caption's own
 * [start, end] — a small amount of drift is normal (see quality-analyzer.ts's own
 * WORD_BOUNDARY_SLACK) and still worth showing; only structurally broken entries are dropped. */
export function getRenderableWordSegments(subtitle: Pick<Subtitle, "words">): RenderableWordSegment[] {
  if (!Array.isArray(subtitle.words)) return [];
  const result: RenderableWordSegment[] = [];
  for (let i = 0; i < subtitle.words.length; i++) {
    const word = subtitle.words[i];
    if (!word || typeof word.start !== "number" || typeof word.end !== "number") continue;
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) continue;
    if (word.end <= word.start) continue;
    result.push({ index: i, word });
  }
  return result;
}

/** The floor on a single word's own duration — smaller than editor-store.ts's
 * MIN_CAPTION_DURATION_SEC (0.1s) since a word is naturally a much shorter unit than a whole
 * caption; large enough to never collapse to a literal zero-width interval under normal use. */
export const MIN_WORD_DURATION_SEC = 0.02;

/**
 * Finds the target word's actual CHRONOLOGICAL neighbors — the closest OTHER word (by real
 * timestamp, never by array position) that ends at or before the target's own start, and the
 * closest OTHER word that starts at or after the target's own end. Task 117206 (P18.9): this is
 * what `clampWordTiming` (and the "Bounded by" display / word-drag snap preview that feed it the
 * same values) must use instead of `words[wordIndex-1]`/`words[wordIndex+1]` — array-ADJACENT
 * neighbors, which silently assumed array order is chronological. P18.6 (Task 113528) broke that
 * assumption on purpose (explicit word reorder can put a chronologically-earlier word LATER in
 * the array). A plain O(n) scan; NEVER mutates, reorders, or sorts `words` — the persistent array
 * stays in whatever order the user left it.
 *
 * Malformed candidates (non-finite start/end) are skipped, same "skip, never fabricate"
 * convention as getRenderableWordSegments/validateWordsWithinCaptionBounds. `removed` words are
 * NOT skipped — the pre-existing array-adjacent version never special-cased them either, so a
 * removed word still counts as a blocking neighbor for this purpose, unchanged behavior.
 *
 * Returns null for a side with no qualifying neighbor (the target is the chronologically
 * first/last real word) — the same "null means bounded by the caption edge instead" contract
 * every caller of this already expects (see clampWordTiming below, and the popover's own
 * prevWordEnd/nextWordStart props).
 */
export function findChronologicalWordNeighbors(words: readonly Word[], wordIndex: number): { prevEnd: number | null; nextStart: number | null } {
  const target = words[wordIndex];
  if (!target || typeof target.start !== "number" || typeof target.end !== "number" || !Number.isFinite(target.start) || !Number.isFinite(target.end)) {
    return { prevEnd: null, nextStart: null };
  }
  let prevEnd: number | null = null;
  let nextStart: number | null = null;
  for (let i = 0; i < words.length; i++) {
    if (i === wordIndex) continue;
    const w = words[i];
    if (typeof w.start !== "number" || typeof w.end !== "number" || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    if (w.end <= target.start && (prevEnd === null || w.end > prevEnd)) prevEnd = w.end;
    if (w.start >= target.end && (nextStart === null || w.start < nextStart)) nextStart = w.start;
  }
  return { prevEnd, nextStart };
}

/**
 * Computes the clamped (start, end) for adjusting one word's timing — mirrors
 * editor-store.ts's updateSubtitleTiming clamp shape (same "clamp against the immediate neighbor,
 * floor duration at a minimum" pattern), scoped to a single caption's own words:
 *   1. Never before the caption's own start, never after its own end.
 *   2. Never crosses its actual chronological neighbors' timing (no overlap) — Task 117206
 *      (P18.9): neighbors are found by `findChronologicalWordNeighbors` above (real timestamp
 *      order), never by array adjacency.
 *   3. Never collapses below MIN_WORD_DURATION_SEC.
 * Returns null when `wordIndex` is out of range, OR (P18.9) when the word's real chronological
 * neighbors leave no room for even a minimum-duration word (e.g. genuinely overlapping/corrupt
 * neighbor data) — rather than silently producing an inverted or degenerate interval. This is the
 * existing return contract (`{start,end} | null`, `null` already meant "can't do this" for an
 * out-of-range index), just extended to a second, pre-existing failure mode that the old
 * array-adjacent version could silently mis-produce instead of rejecting.
 */
export function clampWordTiming(
  subtitle: Pick<Subtitle, "start" | "end" | "words">,
  wordIndex: number,
  requestedStart: number,
  requestedEnd: number,
): { start: number; end: number } | null {
  const words = subtitle.words;
  if (!Array.isArray(words) || wordIndex < 0 || wordIndex >= words.length) return null;
  const { prevEnd: chronPrevEnd, nextStart: chronNextStart } = findChronologicalWordNeighbors(words, wordIndex);
  const prevEnd = chronPrevEnd ?? subtitle.start;
  const nextStart = chronNextStart ?? subtitle.end;
  const lowerBound = Math.max(subtitle.start, prevEnd);
  const upperBound = Math.min(subtitle.end, nextStart);
  if (upperBound - lowerBound < MIN_WORD_DURATION_SEC) return null;
  const clampedStart = Math.max(lowerBound, Math.min(requestedStart, upperBound - MIN_WORD_DURATION_SEC));
  const clampedEnd = Math.min(upperBound, Math.max(requestedEnd, clampedStart + MIN_WORD_DURATION_SEC));
  return { start: clampedStart, end: clampedEnd };
}

/** The word-level keyboard/popover nudge step (Task 93471, P7.3) — reuses the exact value
 * word-timing-popover.tsx's own +/- nudge buttons already used (P7.2), so the keyboard shortcut
 * and the popover buttons always move a word by the same amount. Exported from here (the
 * canonical word-timing module) rather than duplicated in both consumers, so the two can never
 * drift apart. */
export const WORD_NUDGE_STEP_SEC = 0.05;

/**
 * Clamps every word in `words` to stay within `[captionStart, captionEnd]`, monotonic and
 * non-overlapping, walking left-to-right and treating each word's own (possibly-already-clamped)
 * end as the floor for the next one's start — the same "clamp against the immediate neighbor"
 * shape `clampWordTiming` already uses for a single word, applied once across the whole array
 * (Task 93471, P7.3 — see the P7.3 report's "caption <-> word timing consistency audit" for why
 * this is needed: a caption RESIZE that shrinks past a word's own end, or a MERGE that
 * concatenates two captions' words, previously left those words unclamped/potentially
 * overlapping until quality-analyzer flagged them as a manual-review-only issue).
 *
 * Deliberately a no-op (returns the exact same array reference) when every word is already
 * within bounds and already non-overlapping — the overwhelmingly common case — so this never
 * touches already-valid data or creates unnecessary undo/render churn. Only ever adjusts
 * `start`/`end`; every other field (`text`, `style`, `confidence`, `hinglishText`, ...) is
 * preserved untouched, so this can never destroy real data, only reposition it to stay valid.
 * Malformed entries (non-finite start/end) are passed through unchanged rather than crashing —
 * matches getRenderableWordSegments's own "skip, don't fabricate" convention.
 */
export function clampWordsToCaptionBounds(words: Word[], captionStart: number, captionEnd: number): Word[] {
  if (!Array.isArray(words) || words.length === 0) return words;
  let changed = false;
  let prevEnd = captionStart;
  const result: Word[] = words.map((w) => {
    if (typeof w.start !== "number" || typeof w.end !== "number" || !Number.isFinite(w.start) || !Number.isFinite(w.end)) {
      return w;
    }
    const lowerBound = Math.max(prevEnd, captionStart);
    const clampedStart = Math.max(lowerBound, Math.min(w.start, captionEnd - MIN_WORD_DURATION_SEC));
    const clampedEnd = Math.min(captionEnd, Math.max(w.end, clampedStart + MIN_WORD_DURATION_SEC));
    prevEnd = clampedEnd;
    if (clampedStart === w.start && clampedEnd === w.end) return w;
    changed = true;
    return { ...w, start: clampedStart, end: clampedEnd };
  });
  return changed ? result : words;
}

/** Float noise tolerance for boundary checks below — matches lib/subtitles/merge-subtitles.ts's
 * own EPSILON_SEC, so a word landing exactly on a caption edge (the common case: the first/last
 * word of a caption almost always touches that caption's own start/end) is never rejected merely
 * for accumulated floating-point drift from upstream clamp arithmetic. */
const BOUNDS_EPSILON_SEC = 0.001;

export interface WordBoundsViolation {
  ok: false;
  /** Index into the SAME `words` array that was passed in — identifies the offending word. */
  wordIndex: number;
}

/**
 * Checks whether every word in `words` already fits inside `[captionStart, captionEnd]` — used by
 * editor-store.ts's updateSubtitleTiming (Task 115894, P18.8) to decide whether a caption RESIZE
 * is safe to apply, REPLACING clampWordsToCaptionBounds for that one call site (which is left
 * otherwise untouched above — this task adds a function, it does not modify or remove an existing
 * one, since clampWordsToCaptionBounds's own existing tests document its current behavior as a
 * pure module in its own right).
 *
 * Deliberately the opposite shape from clampWordsToCaptionBounds: that function REPAIRS an invalid
 * array by walking it in ARRAY order and treating each word's own (possibly-already-repositioned)
 * end as a running lower bound for the next — which silently assumes array order is chronological.
 * P18.6 (Task 113528) made non-monotonic array order — a word appearing later in the array than
 * another word it chronologically precedes — a permanent, supported state (explicit word reorder),
 * so that assumption is no longer safe. This function instead validates each word ENTIRELY
 * INDEPENDENTLY of every other word and of its own position in the array — no running bound, no
 * dependency on neighbors, no sorting — so a caption's array order can be anything at all and this
 * still produces the same per-word verdict. Never mutates `words`.
 *
 * Uses the existing half-open [start, end) convention already established by clampWordTiming and
 * quality-analyzer.ts's own overlap check: a word starting exactly at `captionStart`, or ending
 * exactly at `captionEnd`, is fully inside — not a violation merely for touching a boundary.
 *
 * Malformed entries (non-finite start/end) are skipped — same "never fabricate, never crash"
 * convention as getRenderableWordSegments — since there is no real timestamp to validate.
 */
export function validateWordsWithinCaptionBounds(
  words: readonly Word[],
  captionStart: number,
  captionEnd: number,
): { ok: true } | WordBoundsViolation {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (typeof w.start !== "number" || typeof w.end !== "number" || !Number.isFinite(w.start) || !Number.isFinite(w.end)) {
      continue;
    }
    if (w.start < captionStart - BOUNDS_EPSILON_SEC || w.end > captionEnd + BOUNDS_EPSILON_SEC) {
      return { ok: false, wordIndex: i };
    }
  }
  return { ok: true };
}
