import type { CutRange, Subtitle, TimingRules, Word } from "../../types/subtitle.ts";
import { breakIntoLines } from "../subtitles/linebreak.ts";

export type { CutRange };

/**
 * Reusable source-time ↔ edited-time remapping layer.
 *
 * A project's uploaded video never changes. Trimming, filler-word removal,
 * and silence removal are all expressed the same way: a list of `CutRange`s
 * in the ORIGINAL video's timeline ("source time") that should be skipped.
 * The "edited timeline" is what you get after collapsing those gaps —
 * exactly the model the spec calls out ("Video source: 0→60. Edited
 * timeline: 0→12, 14→27, 30→60").
 *
 * Nothing here is video-editor-specific — it's pure arithmetic over
 * (start, end) ranges — so trim, filler-removal, silence-removal, and any
 * future cut-based feature all share one correct, tested implementation
 * instead of each hand-rolling their own timestamp shifting.
 */
/** Sorts, clips to [0, duration], drops empty/invalid ranges, and merges overlapping/adjacent ones. */
/** Combines trim (start/end) and explicit cut ranges into one normalized cut list — trim is just a "cut" of whatever falls outside [trimStart, trimEnd]. Every consumer (preview skip, timeline display, export) should go through this rather than handling trim and cuts separately. */
export function effectiveCuts(
  trimStart: number,
  trimEnd: number | null,
  duration: number,
  cutRanges: CutRange[],
): CutRange[] {
  const all: CutRange[] = [...cutRanges];
  if (trimStart > 0.001) all.push({ id: "trim-start", start: 0, end: trimStart, reason: "trim" });
  const end = trimEnd ?? duration;
  if (end < duration - 0.001) all.push({ id: "trim-end", start: end, end: duration, reason: "trim" });
  return normalizeCuts(all, duration);
}

export function normalizeCuts(cuts: CutRange[], duration: number): CutRange[] {
  const clipped = cuts
    .map((c) => ({ ...c, start: Math.max(0, Math.min(duration, c.start)), end: Math.max(0, Math.min(duration, c.end)) }))
    .filter((c) => c.end - c.start > 0.001)
    .sort((a, b) => a.start - b.start);

  const merged: CutRange[] = [];
  for (const c of clipped) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + 0.001) {
      last.end = Math.max(last.end, c.end);
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}

/** Maps a point in the ORIGINAL video to its position in the gapless edited timeline. A point inside a cut has no edited-time equivalent — it clamps to that cut's start. */
export function sourceToEdited(t: number, cuts: CutRange[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t <= c.start) break;
    if (t >= c.end) removed += c.end - c.start;
    else {
      removed += t - c.start;
      break;
    }
  }
  return Math.max(0, t - removed);
}

/** Inverse of sourceToEdited — where in the original video does this edited-timeline moment come from. */
export function editedToSource(t: number, cuts: CutRange[]): number {
  let acc = 0;
  let result = t;
  for (const c of cuts) {
    const cutLen = c.end - c.start;
    const cutEditedPos = c.start - acc;
    if (t < cutEditedPos) break;
    result += cutLen;
    acc += cutLen;
  }
  return result;
}

export function editedDuration(duration: number, cuts: CutRange[]): number {
  const removed = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
  return Math.max(0, duration - removed);
}

/** The source-time ranges that survive the cuts — what export/playback should actually keep, in order. */
export function keptRanges(duration: number, cuts: CutRange[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start > cursor) ranges.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < duration) ranges.push({ start: cursor, end: duration });
  return ranges;
}

/** True if a source-time point falls inside any cut (used by the live preview to skip playback forward over removed ranges). */
export function isInsideCut(t: number, cuts: CutRange[]): CutRange | null {
  return cuts.find((c) => t >= c.start && t < c.end) ?? null;
}

/** Remaps word timestamps from source time to edited time, dropping words entirely inside a cut (their audio no longer exists). */
export function remapWordsToEdited(words: Word[], cuts: CutRange[]): Word[] {
  const kept: Word[] = [];
  for (const w of words) {
    const fullyRemoved = cuts.some((c) => w.start >= c.start - 0.001 && w.end <= c.end + 0.001);
    if (fullyRemoved) continue;
    const start = sourceToEdited(w.start, cuts);
    const end = sourceToEdited(w.end, cuts);
    if (end - start <= 0.001) continue; // clipped down to nothing by a partial overlap
    kept.push({ ...w, start, end });
  }
  return kept;
}

/**
 * Remaps a full subtitle track from source time to edited time. Subtitles
 * that lose all their words (every word fell inside a cut) are dropped;
 * subtitles that lose *some* words are re-wrapped with the reduced word set
 * so line breaks stay natural instead of leaving orphaned blank lines.
 *
 * Task 118943 (P18.10): the resulting caption's own `start`/`end` are the true MIN/MAX across
 * EVERY remapped word — not `words[0].start`/`words[words.length-1].end` (the pre-P18.10 rule),
 * which silently assumed `words[0]` is chronologically earliest and the last array element is
 * chronologically latest. P18.6 (Task 113528) explicitly no longer guarantees that (an explicitly
 * reordered word's array position need not match its real timestamp order), and this function is
 * on the EXPORT path (lib/export-pipeline.ts, whenever a project has any cut ranges — trim, filler-
 * word removal, silence removal) — the old rule could produce a caption whose own bounds excluded
 * one of its own words entirely.
 */
export function remapSubtitlesToEdited(subtitles: Subtitle[], cuts: CutRange[], rules: TimingRules): Subtitle[] {
  const result: Subtitle[] = [];
  let index = 0;
  for (const s of subtitles) {
    const words = remapWordsToEdited(s.words, cuts);
    if (words.length === 0) continue;
    const text = breakIntoLines(words.map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
    let start = Infinity;
    let end = -Infinity;
    for (const w of words) {
      if (w.start < start) start = w.start;
      if (w.end > end) end = w.end;
    }
    result.push({
      ...s,
      index: index++,
      start,
      end,
      text,
      words,
    });
  }
  return result;
}
