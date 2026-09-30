/**
 * Task 95640 (P9) — the collision-safety fix for a gap discovered during P8's own QA: both
 * duplicateSubtitle (single caption) and duplicateSubtitles (a contiguous batch) used to place
 * their copy at exactly `original.end` (or `block.end`), shifted forward by the original's/
 * block's own total width, with NO check for whether an already-existing caption sits at or
 * before that position. Confirmed live: duplicating a caption whose next neighbor started with
 * little or no gap silently produced two subtitle rows occupying overlapping time ranges — the
 * exact "OVERLAP" condition quality-analyzer.ts already treats as a structural error, and that
 * updateSubtitleTiming's own neighbor-clamp already prevents for every OTHER timing mutation
 * (drag, resize, keyboard nudge, single or batch). Duplication was the one path that never went
 * through an equivalent check.
 *
 * COLLISION POLICY (chosen after evaluating clamp / shift-trailing-block / reject):
 *   Place the duplicate flush immediately after the original(s) — shifted forward by exactly its
 *   own total width, i.e. no gap introduced — ONLY when that fits entirely before whichever
 *   caption (if any) comes next in sorted order. If it does not fit, REJECT the duplication
 *   entirely: no caption is added, no commit is made, and the caller shows the user a toast
 *   explaining why. Deliberately not "shrink the duplicate's own duration to fit" and not "shift
 *   the trailing caption (and everything after it) further down the timeline":
 *     - Shrinking would silently turn "duplicate this caption" into "create a differently-shaped
 *       caption," which needs a hard floor to define ("just enough" is not well-defined
 *       once part of the batch case's own explicit "preserve duration" requirement rules it out
 *       for a batch — and single/batch duplication must share ONE rule, not two subtly different
 *       ones).
 *     - Shifting every later caption is a much LARGER, more surprising change than duplication
 *       has ever made anywhere else in this codebase (every other timing mutation — drag, resize,
 *       nudge, batch nudge — only ever clamps against the IMMEDIATE neighbor, never cascades
 *       further down the timeline) — it would be the opposite of the smallest safe change.
 *   Rejecting is simple, deterministic, never destroys or silently reshapes data, and is
 *   explicitly the outcome this task's own spec allows ("if the chosen policy rejects the
 *   duplication... show a concise toast explaining why").
 */
import type { Subtitle } from "../../types/subtitle.ts";

/** Float-noise tolerance for the fit check — matches quality-analyzer.ts's own OVERLAP-detection
 * slack (`s.end > next.start + 0.001`), so this module's notion of "fits without overlapping"
 * agrees exactly with the one place in the codebase that already judges captions as overlapping. */
const OVERLAP_EPSILON_SEC = 0.001;

/**
 * The ONE fit-check shared by duplicateSubtitle and duplicateSubtitles (editor-store.ts) — decides
 * whether a caption, or a contiguous block of captions being duplicated as one unit, may be placed
 * immediately after itself, shifted forward by its own total width (`blockEnd - blockStart`, a
 * flush placement with no gap introduced), without overlapping whichever caption comes next in the
 * project's sorted order.
 *
 * Returns the shift to apply (always exactly `blockEnd - blockStart`) when it fits, or `null` when
 * it does not — the caller must not place a duplicate at all in that case (see this module's own
 * top-level doc comment for why reject, not clamp or shift, was chosen).
 *
 * Only the IMMEDIATE next caption needs checking, not every later one: the project's existing
 * subtitles are already mutually non-overlapping (enforced elsewhere — see this module's own doc
 * comment), so every caption after the immediate next one starts even later. If the full-width
 * copy doesn't fit before the immediate next caption, no forward placement could ever avoid that
 * SAME collision, and a duplicate is never placed farther forward than "immediately after the
 * original(s)" — so it can never reach past the immediate neighbor to collide with a caption two
 * or more positions away either (see this module's own tests for the explicit "A B C D, duplicate
 * the middle one, with several later captions" case).
 *
 * `nextCaptionStart` is `null` when there is no following caption at all (duplicating the very
 * last caption or block in the project) — always fits in that case, matching prior behavior
 * exactly. A `nextCaptionStart` that is already at or before `blockEnd` (a pre-existing, already-
 * corrupted overlap — should not normally occur, since the editor's own invariants keep captions
 * non-overlapping, but data can arrive from anywhere) correctly yields a negative/zero available
 * room and is rejected the same as a merely-too-tight gap, rather than crashing or silently
 * compounding the corruption.
 */
export function resolveDuplicateShift(blockStart: number, blockEnd: number, nextCaptionStart: number | null): number | null {
  const width = blockEnd - blockStart;
  const availableRoom = nextCaptionStart === null ? Infinity : nextCaptionStart - blockEnd;
  if (availableRoom + OVERLAP_EPSILON_SEC < width) return null;
  return width;
}

/** Convenience wrapper over resolveDuplicateShift for a single caption, used by
 * duplicateSubtitle — `next` is the immediately-following caption in `subtitles`' own sorted
 * order, or `undefined`/`null` when `original` is the last caption in the project. */
export function resolveSingleDuplicateShift(original: Pick<Subtitle, "start" | "end">, next: Pick<Subtitle, "start"> | null | undefined): number | null {
  return resolveDuplicateShift(original.start, original.end, next ? next.start : null);
}

/** Convenience wrapper over resolveDuplicateShift for a contiguous block of captions, used by
 * duplicateSubtitles — `block` is the full contiguous run being duplicated (already known to be
 * sorted/contiguous by the caller), `next` is the immediately-following caption outside the
 * block, or `undefined`/`null` when the block ends at the last caption in the project. */
export function resolveBlockDuplicateShift(block: Pick<Subtitle, "start" | "end">[], next: Pick<Subtitle, "start"> | null | undefined): number | null {
  if (block.length === 0) return null;
  return resolveDuplicateShift(block[0].start, block[block.length - 1].end, next ? next.start : null);
}
