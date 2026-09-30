/**
 * Reading-speed (characters-per-second) calculations — a single, pure source of truth used
 * both by the diagnostic quality validator (lib/subtitles/quality-validator.ts) and by
 * generation-time segmentation (lib/subtitles/segment.ts) to keep generated captions within a
 * comfortable reading speed, instead of only flagging the problem after the fact.
 */

/** Chars/sec above this is generally unreadable — the same threshold the quality validator
 * already used (moved here so there is exactly one definition, not two that could drift). */
export const FAST_READING_CPS = 20;

/** Characters-per-second for a caption's text over its own duration. Newlines (the caption's
 * own line breaks) don't count as reading time, so they're collapsed to a single space first,
 * matching how a viewer actually reads a wrapped caption. Spaces and punctuation DO count —
 * they still take a beat to read/parse, and stripping them would understate real reading load.
 * A non-positive duration has no meaningful rate: returns `Infinity` when there is text to read
 * in zero time (i.e. definitely too fast), or `0` when there's no text at all (nothing to read,
 * regardless of duration). */
export function calculateCPS(text: string, durationSec: number): number {
  const flat = text.replace(/\n/g, " ").trim();
  if (!flat.length) return 0;
  if (durationSec <= 0) return Infinity;
  return flat.length / durationSec;
}

/** The shortest duration `text` can be shown for while staying at or under `maxCps` — i.e. the
 * inverse of calculateCPS, used to decide how long a generated caption should be held on
 * screen. Empty text needs no reading time at all. */
export function minDurationForReadableCPS(text: string, maxCps: number = FAST_READING_CPS): number {
  const flat = text.replace(/\n/g, " ").trim();
  if (!flat.length) return 0;
  return flat.length / maxCps;
}
