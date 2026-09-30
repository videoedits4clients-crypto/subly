import type { Subtitle } from "../../types/subtitle.ts";

/**
 * Task 113528 (P18.6) — MOVE WORD FROM INDEX A TO INDEX B within a single caption. This is a
 * pure array-position move of the COMPLETE word object — text, start/end, confidence, style,
 * removed, hinglishText, gujaratiScriptText all travel together as one unit. Never rebuilds a
 * word, never touches a timestamp, never calls remapWordsToText, never sorts words back into
 * timestamp order.
 *
 * SEMANTIC DECISION (Phase 0, see research/p18_6_word_reorder_report.md §4 for the full audit):
 * "WORD OBJECT IDENTITY TRAVELS WITH THE WORD." Confirmed SAFE by two independent pieces of
 * evidence already in the shipped codebase, neither of which assumes `words` is sorted by time:
 *   1. Live preview (`findActiveWordIndex`, lib/subtitles/playback-context.ts) finds the active
 *      word by TIMESTAMP CONTENT (`time >= w.start && time < w.end`), not by array position.
 *   2. ASS export (`buildIntervals` in lib/subtitles/ass.ts) builds its own sorted set of time
 *      breakpoints from every word's own start/end, then independently re-derives which word is
 *      active for EACH resulting interval by the same content check — never by assuming the
 *      `words` array itself is chronologically ordered. The rendered TEXT LINE is built by
 *      iterating `words` in ARRAY order (i.e. reading order), so the caption text reflects the
 *      new order while each word's own highlight still fires at ITS OWN original time.
 * Net result: a caption whose words are reordered (timestamps traveling with them, becoming
 * non-monotonic) renders correctly in both the live preview and the real ASS/libass export, with
 * ZERO changes needed to either. This module only needs to move the array element; nothing else
 * in the rendering pipeline needs to change or even be told the array is no longer time-sorted.
 *
 * This module does NOT touch `Subtitle.text`/`hinglishText`/`gujaratiScriptText` — resyncing the
 * caption-level text after a word move is the caller's job (editor-store.ts's `reorderWord`,
 * mirroring the exact `breakIntoLines(words.map(w=>w.text).join(" "), ...)` rebuild every other
 * word-structural mutation — split/merge/delete/insert — already uses), the same layering every
 * other pure word-edit function (lib/subtitles/word-edit.ts) already follows: the pure function
 * only knows about `words`, the store action owns anything that needs `project.timingRules`.
 */

export type WordReorderRejectionReason = "invalid-index" | "noop";

export interface WordReorderSuccess {
  ok: true;
  /** The subtitle with `words` reordered — every other field (id, index, start, end, text,
   * style, animation, hinglishText, gujaratiScriptText) is carried over from the input
   * UNTOUCHED; the caller decides whether/how to resync `text` and the derived-text fields. */
  subtitle: Subtitle;
}
export interface WordReorderFailure {
  ok: false;
  reason: WordReorderRejectionReason;
  /** The ORIGINAL subtitle, the exact same object reference — so a caller that skips the `ok`
   * check still gets back something safe to render, and so the store action can tell "nothing
   * changed" apart from "something changed" by a simple reference comparison. */
  subtitle: Subtitle;
}
export type WordReorderResult = WordReorderSuccess | WordReorderFailure;

/**
 * Moves the word at `fromIndex` to `toIndex` within `subtitle.words`, using the same semantics
 * as `Array.prototype.splice`-based reordering: after the move, the word that WAS at `fromIndex`
 * sits at `toIndex`, and every word between the two positions shifts by one slot to fill the gap
 * — the same "drag this word to this position" behavior a Move Left/Move Right (or drag) UI
 * naturally implies. Rejects (input `subtitle` returned by reference, never mutated) for:
 *   - a non-integer, negative, or out-of-range index ("invalid-index")
 *   - `fromIndex === toIndex` ("noop" — nothing would change; the caller should not commit)
 * Never rejects for "would create non-monotonic timing" — per this module's own top-of-file doc
 * comment, that is an EXPECTED, SAFE outcome the rendering pipeline already handles correctly,
 * not an error condition.
 */
export function reorderSubtitleWord(subtitle: Subtitle, fromIndex: number, toIndex: number): WordReorderResult {
  const words = subtitle.words;
  const lastIndex = words.length - 1;
  const isValidIndex = (i: number) => Number.isInteger(i) && i >= 0 && i <= lastIndex;
  if (!isValidIndex(fromIndex) || !isValidIndex(toIndex)) {
    return { ok: false, reason: "invalid-index", subtitle };
  }
  if (fromIndex === toIndex) {
    return { ok: false, reason: "noop", subtitle };
  }
  const reordered = words.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return { ok: true, subtitle: { ...subtitle, words: reordered } };
}
