import type { Subtitle, TimingRules, Word } from "@/types/subtitle";
import { breakIntoLines } from "./linebreak.ts";

/**
 * Task 114761 (P18.7) — "Merge With Next": merges two ADJACENT captions (`a` immediately
 * followed by `b` in the sorted subtitles array) into one, `a` absorbing `b`.
 *
 * CRITICAL FIX over the pre-P18.7 implementation: the old `mergeWithNext` (editor-store.ts) ran
 * the merged word array (`[...a.words, ...b.words]`) through `clampWordsToCaptionBounds`
 * (word-timing.ts), which walks an array IN ORDER, clamping each word's `start` against a
 * running `prevEnd` carried forward from the PREVIOUS array element. That walk implicitly
 * assumes array order IS chronological order. Task 113528 (P18.6) made that assumption false —
 * `a.words`/`b.words` can each already be non-monotonic (deliberately reordered, timestamps
 * unchanged). Concatenating two such arrays and running the old clamp would, for any word whose
 * own timestamp is EARLIER than an array-preceding word's `end`, silently drag that word's
 * `start`/`end` forward to sit after it — corrupting/relocating a P18.6-reordered word's REAL
 * timing, exactly the "'fix' P18.6 by sorting words chronologically" this task explicitly
 * forbids. Confirmed by direct trace-through before writing this fix, not assumed.
 *
 * NEW behavior: simple concatenation, `[...a.words, ...b.words]`, preserving each side's own
 * existing array/textual order (never re-sorted, never re-timed) — this is PROVABLY safe with NO
 * repositioning needed, because the invariants every other mutation in this codebase already
 * maintains guarantee it: `a`/`b` are adjacent captions in a sorted, mutually non-overlapping
 * array (so `a.end <= b.start`), every one of `a`'s words already satisfies `w.end <= a.end`
 * regardless of array order (P18.6 reorder only ever moves array position, never timing), and
 * every one of `b`'s words already satisfies `w.start >= b.start` the same way — so no word of
 * `a` can ever overlap any word of `b`, and the concatenation is automatically within
 * `[a.start, b.end]`. Rather than blindly trust that proof at runtime, this module still
 * VALIDATES it (defense in depth, matching this codebase's established "provably safe by
 * construction, checked anyway" pattern from lib/subtitles/ripple-edit.ts) and — per this task's
 * own "prefer rejection over silent destructive correction" — REJECTS the merge if the
 * invariant is somehow violated (e.g. pre-existing corrupt data), rather than silently
 * repositioning anything the way the old clamp-based code did.
 */

export type MergeSubtitlesRejectionReason = "out-of-bounds" | "overlap";

export interface MergeSubtitlesSuccess {
  ok: true;
  subtitle: Subtitle;
}
export interface MergeSubtitlesFailure {
  ok: false;
  reason: MergeSubtitlesRejectionReason;
}
export type MergeSubtitlesResult = MergeSubtitlesSuccess | MergeSubtitlesFailure;

const EPSILON_SEC = 0.001; // matches duplicate-timing.ts's own OVERLAP_EPSILON_SEC / quality-analyzer.ts's overlap slack

/**
 * Merges `a` and `b` (in that order — `a` must be the earlier caption) into one Subtitle. `a`
 * absorbs `b`: the result keeps `a`'s own id/index/style/animation (matching the pre-existing
 * "A absorbs B, not a brand-new caption" convention), spans `[a.start, b.end]`, and its words are
 * `a.words` followed by `b.words` in their EXISTING relative order — never re-sorted
 * chronologically, never redistributed. Rejects (no partial result) if that concatenation would
 * actually be invalid — a word outside `[a.start, b.end]`, or any two words overlapping — rather
 * than silently repositioning anything.
 */
export function mergeSubtitles(a: Subtitle, b: Subtitle, rules: TimingRules): MergeSubtitlesResult {
  const words: Word[] = [...a.words, ...b.words];

  for (const w of words) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) continue; // malformed — skip, matches getRenderableWordSegments's "skip, don't fabricate" convention
    if (w.start < a.start - EPSILON_SEC || w.end > b.end + EPSILON_SEC) {
      return { ok: false, reason: "out-of-bounds" };
    }
  }
  const finite = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  // Sorted purely for the O(n log n) pairwise-overlap check below — a local, discarded copy,
  // never returned or stored; the actual merged `words` array below keeps its original,
  // unsorted (possibly non-monotonic) order.
  const sortedForCheck = finite.slice().sort((x, y) => x.start - y.start);
  for (let i = 1; i < sortedForCheck.length; i++) {
    if (sortedForCheck[i].start < sortedForCheck[i - 1].end - EPSILON_SEC) {
      return { ok: false, reason: "overlap" };
    }
  }

  const merged: Subtitle = {
    id: a.id,
    index: a.index,
    start: a.start,
    end: b.end,
    text: breakIntoLines(words.map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n"),
    words,
    style: a.style,
    animation: a.animation,
  };
  return { ok: true, subtitle: merged };
}
