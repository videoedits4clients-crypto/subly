/**
 * Task 103884 (P16) — Unicode grapheme-cluster segmentation. Pure, no React, no store. Exists
 * specifically to fix a P15 limitation: `defaultWordSplit` (word-edit.ts) used to slice a word's
 * text by raw character (UTF-16 code unit) count, which can split a base character apart from a
 * combining mark that's supposed to stay attached to it — e.g. Devanagari "नमस्ते" sliced at its
 * character midpoint (3/3) produces "नमस"/"्ते", severing "स" from the "े" vowel sign that
 * belongs to "त", not to "स". A grapheme CLUSTER is what a reader actually perceives as "one
 * character" (a base code point plus any combining marks/modifiers attached to it) — this module's
 * only job is to never propose a split boundary that falls inside one.
 *
 * `Intl.Segmenter` (ECMA-402, `granularity: "grapheme"`) is the correct, spec-defined way to do
 * this and is natively available in both the Node runtime this project's tests run under and the
 * Electron/Chromium runtime the packaged app ships (V8 has shipped it since Chrome 87 / Node 16 —
 * confirmed present in this project's actual dev/build Node version during this task's own audit),
 * so no new dependency was added for this. A small, deliberately non-exhaustive fallback covers
 * the case where it's somehow unavailable (see graphemeFallback below) — not a "large dependency,"
 * per this task's own instruction, just enough to keep combining marks attached to their base
 * character, which is the one failure mode this task exists to fix.
 */

/** True when `Intl.Segmenter` is present in this runtime — checked once per call (not cached at
 * module load) so a test can stub/delete it if it ever needs to exercise the fallback path
 * directly, without needing to reload the module. */
function hasIntlSegmenter(): boolean {
  return typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function";
}

/** Combining marks (Unicode General Category Mn/Mc/Me — nonspacing, spacing-combining, and
 * enclosing marks) are never their own grapheme cluster; they always attach to whatever base
 * code point precedes them. This is the one rule this fallback enforces — it does NOT attempt
 * full Unicode Grapheme Cluster Boundary Algorithm compliance (no ZWJ-emoji-sequence joining, no
 * regional-indicator-pair flag joining, no virama-based conjunct joining beyond "the combining
 * mark attaches"), which is exactly why `Intl.Segmenter` is used whenever it's available rather
 * than always relying on this. `Array.from` (not a plain index loop) so code points OUTSIDE the
 * Basic Multilingual Plane (astral-plane emoji, etc.) are still handled as one unit each, never
 * split across a UTF-16 surrogate pair. */
function graphemeFallback(text: string): string[] {
  const codePoints = Array.from(text);
  const combiningMark = /^\p{M}$/u;
  const result: string[] = [];
  for (const cp of codePoints) {
    if (combiningMark.test(cp) && result.length > 0) {
      result[result.length - 1] += cp;
    } else {
      result.push(cp);
    }
  }
  return result;
}

/**
 * Splits `text` into an array of grapheme clusters — deterministic, pure, no side effects. Uses
 * `Intl.Segmenter` when available (the overwhelming common case — see this module's own doc
 * comment), falling back to `graphemeFallback` otherwise. For plain ASCII/Latin text without
 * combining marks, every grapheme cluster is exactly one character, so callers that only ever saw
 * simple English text before this module existed see byte-for-byte identical behavior.
 */
export function segmentGraphemes(text: string): string[] {
  if (text.length === 0) return [];
  if (hasIntlSegmenter()) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return graphemeFallback(text);
}
