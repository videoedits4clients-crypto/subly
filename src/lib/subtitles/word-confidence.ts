/**
 * Task 108762 (P18.1) — a pure, read-only classification of a word's own transcription
 * confidence, for the editor's review UI only. No React, no store: never mutates anything, never
 * writes back to the stored `Word.confidence` value, never fabricates one for a word that has
 * none.
 *
 * `Word.confidence` (types/subtitle.ts) is faster-whisper's own per-word token probability —
 * `round(w.probability, 3)` in python/whisper_worker.py — a real, model-measured value in [0,1]
 * for a word that came from actual transcription. It is `undefined` for any word this app ever
 * creates itself (a P16 insertWord result, a P15 split/merge result — see lib/subtitles/word-edit.ts's
 * own "never fabricate confidence" policy) and for any historical/imported caption that predates
 * word-level confidence being recorded at all. `undefined` therefore means "no measurement exists,"
 * never "zero" or "known to be bad" — this module's own `classifyWordConfidence` keeps that a
 * distinct, separate status (`"unknown"`) from a genuinely low measured value (`"low"`), and the
 * UI consuming this (captions-panel.tsx/word-timing-popover.tsx) must never render "unknown" with
 * the same visual treatment as "low."
 */

export type WordConfidenceStatus = "unknown" | "low" | "normal";

/**
 * Below this, faster-whisper's own top candidate for the word was less likely than not (a raw
 * probability under 50%) — a plain, defensible "the model itself was substantially unsure about
 * this word" cutoff, not a claim that the word is actually wrong. Deliberately conservative: a
 * perfectly correct transcription of a mumbled/noisy/accented word can easily still score above
 * this, and a word below it is not automatically an error — this is a hint to look closer, never
 * an automatic quality-report issue (see this task's own explicit "do not claim that a low
 * confidence score proves a transcription error" requirement).
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * `undefined` -> `"unknown"` (no measurement exists — never treated as low).
 * `< LOW_CONFIDENCE_THRESHOLD` -> `"low"`.
 * everything else (including exactly `LOW_CONFIDENCE_THRESHOLD`) -> `"normal"`.
 */
export function classifyWordConfidence(confidence: number | undefined): WordConfidenceStatus {
  if (confidence === undefined) return "unknown";
  return confidence < LOW_CONFIDENCE_THRESHOLD ? "low" : "normal";
}

/** A short, user-facing label for the popover's confidence line — e.g. "94%" or "Unknown". Never
 * claims precision beyond what's meaningful for a quick visual scan (whole percent, not the
 * stored value's own 3-decimal precision). */
export function formatWordConfidence(confidence: number | undefined): string {
  if (confidence === undefined) return "Unknown";
  return `${Math.round(confidence * 100)}%`;
}
