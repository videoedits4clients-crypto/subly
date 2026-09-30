import type { EntranceAnimation } from "../../types/subtitle.ts";

/**
 * Shared between the live browser preview (components/editor/subtitle-overlay.tsx) and the
 * burned MP4 export (lib/subtitles/ass.ts) — the ONE place this cap is defined, so the two
 * renderers can never drift out of sync on it.
 *
 * "typewriter"/"word-pop"/"char-pop" have no true progressive-reveal implementation in either
 * renderer — a real per-character/word reveal isn't representable in ASS without splitting a
 * caption into many per-character Dialogue events (and the live preview has no equivalent
 * either), so both approximate all three the same way: a quick fade, capped at this duration
 * regardless of how long the user actually configured the entrance animation to be.
 */
export const APPROXIMATED_FADE_ENTRANCES = new Set<EntranceAnimation>(["typewriter", "word-pop", "char-pop"]);
export const APPROXIMATED_FADE_CAP_SEC = 0.15;

/** The entrance duration actually used for the fade for a given entrance type — capped for the
 * three approximated types above, the full configured duration for everything else. Used by
 * both renderers so a longer configured duration never makes the preview fade slower than what
 * the export actually burns in (or vice versa). */
export function effectiveEntranceDurationSec(entrance: EntranceAnimation, durationSec: number): number {
  return APPROXIMATED_FADE_ENTRANCES.has(entrance) ? Math.min(durationSec, APPROXIMATED_FADE_CAP_SEC) : durationSec;
}
