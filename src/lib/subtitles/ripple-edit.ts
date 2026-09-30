import type { Subtitle, Word } from "../../types/subtitle.ts";

/**
 * Task 112347 (P18.5) — SUBTITLE-ONLY ripple editing: shifting later captions' TIMING when a
 * contiguous block is deleted, or when a span of subtitle-timeline time is inserted at a point.
 * Never touches the source video/audio, `project.video`, `trimStart`/`trimEnd`, or `cutRanges` —
 * those are a completely separate, source-time-relative model (see lib/timeline/edit-model.ts)
 * that this module has no reason to read or write. Every `Subtitle.start`/`end` this module
 * consumes and produces is in the SAME source-time coordinate space every other timing mutation
 * in editor-store.ts (updateSubtitleTiming, nudgeSubtitles, ...) already operates in.
 *
 * DELIBERATELY DISTINCT from ordinary delete/duplicate: this codebase already has an established,
 * explicit precedent (see duplicate-timing.ts's own doc comment) that ordinary timing mutations —
 * drag, resize, keyboard nudge, duplicate — only ever clamp against the IMMEDIATE neighbor and
 * never cascade further down the timeline; duplication explicitly REJECTS rather than shifting
 * later captions. Ripple is a new, separate, explicitly-invoked operation whose entire purpose is
 * that cascade — it does not change what plain deleteSubtitle(s)/duplicateSubtitle(s) do.
 *
 * RIPPLE DELETE semantics (a contiguous, array-index-adjacent selection — array-index adjacency
 * is time adjacency here since `subtitles` is always kept sorted by start):
 *   rippleStart = the selection's earliest caption's own start
 *   rippleEnd   = the selection's latest caption's own end
 *   delta       = rippleEnd - rippleStart  (the SELECTED captions' own total occupied span —
 *                 NOT the gap before rippleStart, NOT the gap after rippleEnd; a gap that existed
 *                 between the deleted block and whatever came after it is preserved exactly,
 *                 just relocated earlier by `delta`, matching the task's own worked example:
 *                 deleting caption A (0–2) ahead of a 2–4 gap before caption B (4–6) does NOT
 *                 collapse that gap — B ends up at 2–4, the same 2s gap now starting at t=0)
 *   Every caption entirely before the deleted block: untouched (same object reference).
 *   Every caption after the deleted block: start -= delta, end -= delta, every word shifted by
 *   the same -delta. Duration is invariant by construction (a pure translation), so this can
 *   never violate a minimum-duration rule the way a resize could.
 *   PROVEN overlap-safe by construction: since the project's captions are always mutually
 *   non-overlapping before the operation, the first shifted caption's new start can never end up
 *   before the last untouched caption's end (see this module's own tests for the algebra) — a
 *   defensive overlap re-check still runs anyway (§ validateRippleDeleteResult) as defense in
 *   depth, not because the proof is trusted blindly.
 *
 * RIPPLE INSERT semantics (insert `durationSec` of subtitle-timeline time at `insertAtSec`):
 *   A caption entirely before the insertion point (`end <= insertAtSec`): untouched.
 *   A caption entirely at-or-after the insertion point (`start >= insertAtSec`): shifted forward
 *   by +durationSec (itself and every word).
 *   A caption whose span STRICTLY CROSSES the insertion point (`start < insertAtSec < end`) makes
 *   the operation ambiguous — per this task's own "prefer rejection of ambiguous operations over
 *   silent destructive behavior," this is a hard REJECTION, not a guess (no split, no expand, no
 *   whole-caption shift). The caller must choose a different insertion point (e.g. an existing
 *   caption boundary or a gap) — see resolveRippleInsert's own reason code.
 *   Also proven overlap-safe by construction once the crossing case is rejected (see tests).
 *
 * Neither operation reads or enforces `project.video.duration` — confirmed during Task 112347's
 * own audit that NO existing subtitle-timing mutation (drag, resize, nudge, duplicate) does
 * either; a subtitle's start/end has never been constrained to fit inside the video's own
 * duration anywhere in this codebase, so ripple does not newly invent that constraint. A ripple
 * insert that pushes captions past the video's actual length is therefore possible today, exactly
 * as it already was via ordinary nudging — a pre-existing, unrelated gap, not something this
 * module introduces or is responsible for closing.
 */

export interface RippleDeleteSuccess {
  ok: true;
  subtitles: Subtitle[];
  /** The exact amount every caption after the deleted block moved earlier by — surfaced so the
   * UI can show "removed 2.40s" without recomputing it. */
  deltaSec: number;
}
export type RippleDeleteRejectionReason = "empty-selection" | "non-contiguous-selection" | "invalid-result";
export interface RippleDeleteFailure {
  ok: false;
  reason: RippleDeleteRejectionReason;
}
export type RippleDeleteResolution = RippleDeleteSuccess | RippleDeleteFailure;

export interface RippleInsertSuccess {
  ok: true;
  subtitles: Subtitle[];
  /** How many captions actually shifted — 0 is a legitimate, valid outcome (inserting past every
   * existing caption), distinguishing "nothing needed to change" from a rejection. */
  affectedCount: number;
}
export type RippleInsertRejectionReason = "invalid-duration" | "invalid-insertion-point" | "crosses-caption";
export interface RippleInsertFailure {
  ok: false;
  reason: RippleInsertRejectionReason;
  /** Only set for "crosses-caption" — the caption whose span straddles the insertion point, so
   * the caller can name it in the rejection message. */
  crossingSubtitleId?: string;
}
export type RippleInsertResolution = RippleInsertSuccess | RippleInsertFailure;

/** Shifts every word's own start/end by `deltaSec`, leaving every other field — text, confidence,
 * style, removed, hinglishText, gujaratiScriptText — completely untouched. Identity-preserving
 * when `deltaSec` is exactly 0 (returns the same array reference), matching the established
 * pattern of clampWordsToCaptionBounds (word-timing.ts) and the pure-shift branch of
 * updateSubtitleTiming (editor-store.ts). */
export function shiftWordsByDelta(words: Word[], deltaSec: number): Word[] {
  if (deltaSec === 0) return words;
  return words.map((w) => ({ ...w, start: w.start + deltaSec, end: w.end + deltaSec }));
}

/** Shifts one caption's own start/end and every one of its words by `deltaSec`. Every other
 * field — id, index, text, style, animation, hinglishText, gujaratiScriptText — is carried
 * forward untouched (never rebuilt, never regenerated): a ripple shift is a pure timing
 * translation, not a content-changing edit, so it must never call remapWordsToText or otherwise
 * touch anything derived from `text`. Identity-preserving when `deltaSec` is exactly 0. */
export function shiftSubtitleByDelta(subtitle: Subtitle, deltaSec: number): Subtitle {
  if (deltaSec === 0) return subtitle;
  return { ...subtitle, start: subtitle.start + deltaSec, end: subtitle.end + deltaSec, words: shiftWordsByDelta(subtitle.words, deltaSec) };
}

/** True when every id in `selectedIds` maps to a run of ARRAY-INDEX-ADJACENT captions in
 * `subtitles` (which is always kept sorted by start, so index-adjacency is time-adjacency) —
 * the same contiguity rule duplicateSubtitles (editor-store.ts) already established for its own
 * "a contiguous batch has one unambiguous placement" restriction. False for an empty selection
 * (there is no meaningful "contiguous empty range"). Exported separately from
 * resolveRippleDelete so the UI can pre-emptively disable a Ripple Delete control for a
 * non-contiguous selection, before the user even attempts the operation. */
export function isContiguousSelection(subtitles: readonly Subtitle[], selectedIds: ReadonlySet<string>): boolean {
  if (selectedIds.size === 0) return false;
  let firstIndex = -1;
  let lastIndex = -1;
  let count = 0;
  for (let i = 0; i < subtitles.length; i++) {
    if (!selectedIds.has(subtitles[i].id)) continue;
    if (firstIndex === -1) firstIndex = i;
    lastIndex = i;
    count++;
  }
  if (count === 0) return false;
  return lastIndex - firstIndex + 1 === count;
}

/**
 * Task 125843 (P19.5) — the defense-in-depth check `resolveRippleDelete` promises in this file's
 * own top-of-file doc comment (which referenced this function by name before it actually existed
 * — found during this task's own Phase-0 audit and fixed here, not just in the comment). The
 * shift-by-delta math is proven overlap-safe by construction for a valid, already-non-overlapping
 * input (see that same doc comment for the algebra), but this task's own explicit "do not
 * silently trust a proof — reject atomically if the result would ever be invalid" instruction
 * means that proof gets a cheap runtime check anyway, exactly like every other structural
 * mutation in this codebase (split/merge/resize all validate before committing, never repair
 * after). Checks, on the CANDIDATE result array (already in its final, post-delete order):
 * every caption has a strictly positive duration, no caption starts before 0, and no two
 * consecutive captions overlap. Never mutates its input; returns a plain boolean.
 */
export function validateRippleDeleteResult(subtitles: readonly Subtitle[]): boolean {
  for (let i = 0; i < subtitles.length; i++) {
    const s = subtitles[i];
    if (!(s.start >= 0) || !(s.end > s.start)) return false;
    if (i > 0 && subtitles[i - 1].end > s.start) return false;
  }
  return true;
}

/** The pure ripple-delete transformation (see this module's own top-of-file doc comment for the
 * exact math). Returns a REJECTION (no partial mutation, caller must not commit anything) for an
 * empty or non-contiguous selection — never guesses a placement for a non-contiguous span. */
export function resolveRippleDelete(subtitles: readonly Subtitle[], selectedIds: ReadonlySet<string>): RippleDeleteResolution {
  if (selectedIds.size === 0) return { ok: false, reason: "empty-selection" };

  let firstIndex = -1;
  let lastIndex = -1;
  let count = 0;
  for (let i = 0; i < subtitles.length; i++) {
    if (!selectedIds.has(subtitles[i].id)) continue;
    if (firstIndex === -1) firstIndex = i;
    lastIndex = i;
    count++;
  }
  if (count === 0) return { ok: false, reason: "empty-selection" };
  if (lastIndex - firstIndex + 1 !== count) return { ok: false, reason: "non-contiguous-selection" };

  const rippleStart = subtitles[firstIndex].start;
  const rippleEnd = subtitles[lastIndex].end;
  const deltaSec = rippleEnd - rippleStart;

  const result: Subtitle[] = [];
  let newIndex = 0;
  for (let i = 0; i < subtitles.length; i++) {
    if (i >= firstIndex && i <= lastIndex) continue; // deleted
    const s = subtitles[i];
    if (i < firstIndex) {
      // Entirely before the deleted block — untouched, exact same object reference, same index
      // (nothing earlier in the array was removed, so its position never changes).
      result.push(s);
    } else {
      // After the deleted block — always shifted, always a genuinely new object (both the timing
      // AND the index change), same reindexing deleteSubtitle(s) already does.
      const shifted = shiftSubtitleByDelta(s, -deltaSec);
      // Defensive floor (see top-of-file doc comment: mathematically unreachable for a valid,
      // already-non-overlapping selection, but cheap and matches this codebase's existing
      // Math.max(0, ...) convention in updateSubtitleTiming).
      result.push({
        ...shifted,
        index: newIndex,
        start: Math.max(0, shifted.start),
        end: Math.max(0, shifted.end),
      });
    }
    newIndex++;
  }

  // Defense in depth (see validateRippleDeleteResult's own doc comment) — mathematically
  // unreachable for a valid, already-non-overlapping selection, but an atomic rejection here
  // (no partial mutation, exactly like the empty/non-contiguous rejections above) is cheap
  // insurance against ever silently committing a corrupted timeline if that proof's own
  // precondition (the input already being non-overlapping) is ever violated by a future bug
  // upstream of this function.
  if (!validateRippleDeleteResult(result)) return { ok: false, reason: "invalid-result" };

  return { ok: true, subtitles: result, deltaSec };
}

/** The pure ripple-insert transformation (see this module's own top-of-file doc comment for the
 * exact math). Rejects a non-positive/non-finite duration, a negative/non-finite insertion point,
 * or an insertion point that falls STRICTLY inside an existing caption's span — never guesses. */
export function resolveRippleInsert(subtitles: readonly Subtitle[], insertAtSec: number, durationSec: number): RippleInsertResolution {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return { ok: false, reason: "invalid-duration" };
  if (!Number.isFinite(insertAtSec) || insertAtSec < 0) return { ok: false, reason: "invalid-insertion-point" };

  for (const s of subtitles) {
    if (s.start < insertAtSec && s.end > insertAtSec) {
      return { ok: false, reason: "crosses-caption", crossingSubtitleId: s.id };
    }
  }

  let affectedCount = 0;
  const result = subtitles.map((s) => {
    if (s.start >= insertAtSec) {
      affectedCount++;
      return shiftSubtitleByDelta(s, durationSec);
    }
    return s; // entirely before the insertion point — untouched, exact same object reference
  });

  return { ok: true, subtitles: result, affectedCount };
}
