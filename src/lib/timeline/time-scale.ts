/**
 * The ONE time↔pixel mapping used by the timeline — playhead position, click-to-seek, drag
 * handles, and the waveform (components/editor/timeline.tsx, components/editor/waveform.tsx)
 * all go through these two functions instead of each re-deriving `time * pxPerSec` inline.
 * Kept intentionally trivial (no clamping, no rounding) — callers that need bounds already
 * clamp against their own domain (e.g. a caption's own start/end, or [0, duration]), and baking
 * a "one true" clamping rule in here would just be wrong for at least one of them.
 *
 * The point of factoring this out isn't the arithmetic (it's one line) — it's that the
 * waveform's "click here" and the timeline's own scrub/seek must use the exact same formula, or
 * they'd disagree by construction about where a given pixel is in time. See
 * lib/timeline/__tests__/time-scale.test.ts.
 */

export function timeToPixels(time: number, pxPerSec: number): number {
  return time * pxPerSec;
}

export function pixelsToTime(pixels: number, pxPerSec: number): number {
  return pixels / pxPerSec;
}
