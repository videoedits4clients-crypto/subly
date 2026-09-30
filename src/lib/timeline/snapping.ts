/**
 * Pure snap-target math for dragging/resizing a caption block on the timeline (Task 91342,
 * P7.1). Kept as its own small module in the same `lib/timeline/` family as `time-scale.ts`
 * (the time↔pixel mapping this module builds on) and `list-virtualization.ts` — no new
 * coordinate system, no new timeline data model, just one more focused pure-function file
 * timeline.tsx composes.
 *
 * This module NEVER decides whether a resulting (start, end) is valid — it only nudges the
 * continuous drag position toward a nearby target when close enough. The caller (timeline.tsx)
 * always passes the snapped result through the EXISTING `updateSubtitleTiming` overlap-clamp
 * in editor-store.ts afterward — that clamp remains the sole authority on what timing is
 * actually allowed, exactly per the task's required flow:
 *   USER DRAG → NORMAL TIME CALCULATION → OPTIONAL SNAP → EXISTING CLAMP → commit()
 * Snapping can therefore never itself "create" an overlap or an invalid duration: at worst, a
 * snap target that would be invalid is simply clamped back to something valid by the existing
 * store logic, exactly as an un-snapped drag already would be.
 */

/** A caption's own edges are never snap targets for itself — only genuinely external targets
 * (the two ADJACENT captions and the playhead) are considered, so `prevEnd`/`nextStart` here
 * must already be the neighbor's boundary, not the dragged caption's own. `null` means that
 * particular target doesn't exist (e.g. no previous caption) or isn't applicable for this edge. */
export interface SnapTargets {
  prevEnd: number | null;
  nextStart: number | null;
  playhead: number | null;
}

export type DragEdge = "start" | "end" | "move";

export interface SnapResult {
  start: number;
  end: number;
  /** Which edge (if any) actually snapped this update — drives the visual snap-guide indicator.
   * `null` means the result is the original, un-snapped continuous drag position. */
  snappedEdge: "start" | "end" | null;
  /** The exact time value snapping landed on, when `snappedEdge` is non-null — this is what the
   * visual guide line should be drawn at (always equal to the snapped edge's own new value, but
   * named separately so the caller doesn't have to re-derive "which of start/end changed"). */
  snapTime: number | null;
}

/** Finds the closest candidate to `value` that's within `thresholdSec`, or null if none qualify.
 * A plain linear scan over at most 3 candidates (prevEnd/nextStart/playhead) — not a scan over
 * captions, so this stays O(1) regardless of project size. */
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
 * Computes the (possibly snapped) start/end for one drag update.
 *
 * - `edge: "start"` (left-edge resize) — only `start` can move; valid snap targets are the
 *   previous caption's end and the playhead (snapping a start edge to the NEXT caption's start
 *   would just collapse the caption, so `nextStart` is never offered here).
 * - `edge: "end"` (right-edge resize) — only `end` can move; valid targets are the next
 *   caption's start and the playhead (symmetric reasoning: `prevEnd` is never offered here).
 * - `edge: "move"` (whole-block drag) — both edges are drag candidates, but duration must be
 *   preserved, so exactly one snap (whichever qualifying target is CLOSEST) is chosen and its
 *   delta is applied to both start and end together — see the task's own "snap the caption's
 *   relevant start/end boundary pair while preserving caption duration where possible."
 */
export function computeSnappedTiming(edge: DragEdge, start: number, end: number, targets: SnapTargets, thresholdSec: number): SnapResult {
  if (edge === "start") {
    const snapped = nearestWithinThreshold(start, [targets.prevEnd, targets.playhead], thresholdSec);
    if (snapped === null) return { start, end, snappedEdge: null, snapTime: null };
    return { start: snapped, end, snappedEdge: "start", snapTime: snapped };
  }

  if (edge === "end") {
    const snapped = nearestWithinThreshold(end, [targets.nextStart, targets.playhead], thresholdSec);
    if (snapped === null) return { start, end, snappedEdge: null, snapTime: null };
    return { start, end: snapped, snappedEdge: "end", snapTime: snapped };
  }

  // "move": evaluate both edges' best candidate independently, then apply only the CLOSER one
  // (smaller absolute delta) to both start and end, so duration is preserved exactly.
  const startTarget = nearestWithinThreshold(start, [targets.prevEnd, targets.playhead], thresholdSec);
  const endTarget = nearestWithinThreshold(end, [targets.nextStart, targets.playhead], thresholdSec);
  const startDelta = startTarget === null ? null : startTarget - start;
  const endDelta = endTarget === null ? null : endTarget - end;

  if (startDelta === null && endDelta === null) return { start, end, snappedEdge: null, snapTime: null };

  const useStart = endDelta === null || (startDelta !== null && Math.abs(startDelta) <= Math.abs(endDelta));
  const delta = useStart ? startDelta! : endDelta!;
  return {
    start: start + delta,
    end: end + delta,
    snappedEdge: useStart ? "start" : "end",
    snapTime: useStart ? start + delta : end + delta,
  };
}
