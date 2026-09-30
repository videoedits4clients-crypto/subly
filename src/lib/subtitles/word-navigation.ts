/**
 * Task 102741 (P15) — pure word-navigation resolution: "the user pressed Left/Right with a word
 * selected, what should the new (caption, word) selection be?" No React, no store — consumed by
 * hooks/use-keyboard-shortcuts.ts (the actual selection update, plus seeking/scroll-into-view side
 * effects) and directly unit-tested. Mirrors the existing `selectCaptionByOffset` in that same
 * file (caption-level Up/Down navigation) in spirit: a small, pure "what's next" resolver, with the
 * DOM/store side effects kept entirely in the caller.
 */
import type { Subtitle } from "../../types/subtitle.ts";

export interface WordNavigationTarget {
  captionId: string;
  /** Index into the TARGET caption's own `words` array. */
  wordIndex: number;
}

/**
 * Resolves Left (`delta: -1`) / Right (`delta: 1`) word navigation from the currently selected
 * caption + word:
 *   - Moving within the current caption's own `words` (still `[0, words.length - 1]`) just moves
 *     the word index — same caption.
 *   - Crossing the first/last word moves to the adjacent caption's LAST/FIRST word respectively
 *     (this task's own spec §2.1) — but only when that adjacent caption actually HAS at least one
 *     word; a neighbor with no word-level timing is skipped entirely rather than landing the
 *     selection somewhere it can't actually represent (never silently selects a nonexistent word).
 *   - At the very first word of the first caption (or the very last word of the last caption) with
 *     nowhere further to go, returns `null` — a no-op, matching every other bounded navigation
 *     action in this codebase (e.g. selectCaptionByOffset's own `Math.max(0, Math.min(...))` clamp
 *     never wraps past either end).
 *
 * `subtitles` must already be in TIMELINE order (the store's own standing invariant — see
 * editor-store.ts's `.sort()` after any timing mutation), so "adjacent caption" here means
 * "adjacent in array order," exactly matching every other caption-adjacency notion in this
 * codebase (duplicate-timing.ts's `next`, timeline.tsx's `prevEnd`/`nextStart`, etc.).
 */
export function resolveWordNavigation(
  subtitles: Pick<Subtitle, "id" | "words">[],
  currentCaptionId: string,
  currentWordIndex: number,
  delta: 1 | -1,
): WordNavigationTarget | null {
  const captionIdx = subtitles.findIndex((s) => s.id === currentCaptionId);
  if (captionIdx === -1) return null;
  const caption = subtitles[captionIdx];
  if (!Array.isArray(caption.words) || currentWordIndex < 0 || currentWordIndex >= caption.words.length) return null;

  const nextWordIndex = currentWordIndex + delta;
  if (nextWordIndex >= 0 && nextWordIndex < caption.words.length) {
    return { captionId: currentCaptionId, wordIndex: nextWordIndex };
  }

  // Crossed a caption boundary — walk toward the next/previous caption that actually has words,
  // skipping over any that don't (never lands on a caption with no word-level timing at all).
  let i = captionIdx + delta;
  while (i >= 0 && i < subtitles.length) {
    const candidate = subtitles[i];
    if (Array.isArray(candidate.words) && candidate.words.length > 0) {
      return { captionId: candidate.id, wordIndex: delta === 1 ? 0 : candidate.words.length - 1 };
    }
    i += delta;
  }
  return null;
}
