/**
 * Task 102741 (P15) — pure snap-target math for dragging a SELECTED word's own start/end handle on
 * the timeline. Deliberately the word-level sibling of `snapping.ts` (caption-level drag/resize
 * snapping) — same shape, same "propose a nudged value, never decide validity" contract, reusing
 * that module's own documented philosophy rather than inventing a second one:
 *
 *   USER DRAG -> RAW TIME FROM POINTER DELTA -> OPTIONAL SNAP (this module) -> EXISTING
 *   clampWordTiming (the sole authority on what's actually valid) -> commit once on release
 *
 * This module NEVER decides whether a resulting (start, end) is valid — the caller always runs
 * the snapped proposal through `clampWordTiming` (word-timing.ts) afterward, so a snap target that
 * would be invalid (e.g. snapping the start handle to the caption's own start when that's closer
 * than MIN_WORD_DURATION_SEC to the word's own end) is simply clamped back to something valid,
 * exactly as an un-snapped drag already would be. Snapping can therefore never itself create an
 * overlap or a sub-minimum-duration word.
 */

/** A word's own edges are never snap targets for itself. `null` means that particular target
 * doesn't exist for this word (no previous/next word — bounded by the caption's own edge
 * instead) or isn't applicable to the edge being dragged. */
export interface WordSnapTargets {
  captionStart: number;
  captionEnd: number;
  /** The previous word's own end, or `null` when this is the caption's first word. */
  prevWordEnd: number | null;
  /** The next word's own start, or `null` when this is the caption's last word. */
  nextWordStart: number | null;
  /** The current playhead position, or `null` while nothing meaningful to snap to (kept as an
   * explicit input, same as snapping.ts's own SnapTargets, rather than always-on, so a caller
   * that wants to omit playhead-snapping can do so without a special case). */
  playhead: number | null;
}

export type WordDragEdge = "start" | "end";

export interface WordSnapResult {
  value: number;
  /** Whether `value` above is the original, un-snapped continuous drag position (`false`) or a
   * snap target (`true`) — drives the visual snap-guide indicator, same role as snapping.ts's own
   * `snappedEdge`. */
  snapped: boolean;
}

/** Same linear "closest candidate within threshold" scan snapping.ts's own nearestWithinThreshold
 * uses — kept as a local copy rather than a shared import specifically because the two modules'
 * candidate shapes differ (word-level always has at most 3 candidates: one boundary + playhead)
 * and this file's own doc comment already establishes it mirrors, rather than reuses, that
 * module's pattern (importing a "caption-shaped" helper into a word-only module would be the
 * wrong direction of coupling). */
function nearestWithinThreshold(value: number, candidates: (number | null)[], thresholdSec: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (c === null) continue;
    const dist = Math.abs(value - c);
    if (dist <= thresholdSec && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Computes the (possibly snapped) value for one drag update of a single word edge.
 *   - `edge: "start"` — valid targets are the caption's own start, the previous word's end
 *     (whichever is closer — for the first word these coincide), and the playhead. The next
 *     word's start is never offered as a target for the START handle (that's the END handle's own
 *     territory below).
 *   - `edge: "end"` — valid targets are the caption's own end, the next word's start, and the
 *     playhead. The previous word's end is never offered here, symmetric reasoning.
 */
export function computeWordSnappedTiming(edge: WordDragEdge, value: number, targets: WordSnapTargets, thresholdSec: number): WordSnapResult {
  const candidates = edge === "start" ? [targets.captionStart, targets.prevWordEnd, targets.playhead] : [targets.captionEnd, targets.nextWordStart, targets.playhead];
  const snapped = nearestWithinThreshold(value, candidates, thresholdSec);
  if (snapped === null) return { value, snapped: false };
  return { value: snapped, snapped: true };
}
