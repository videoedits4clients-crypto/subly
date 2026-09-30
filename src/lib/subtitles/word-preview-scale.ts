/**
 * Task 137421 (P19.12) — scales a word-level manual style override's numeric value (fontSize,
 * letterSpacing) from its stored REFERENCE_HEIGHT=1920-authored value into real CSS px for a
 * given preview canvas height — the exact same `refHeightPx / 1920` factor preview-style.ts's
 * styleToTextCss already applies to the caption-level fontSize/letterSpacing. Kept in its own
 * zero-import file (rather than inline in preview-style.ts, which uses the "@/..." alias and
 * extensionless relative imports that only Next.js's own bundler resolves) so it can be imported
 * directly by this project's node-native test runner — see research/p19_11_release_candidate_gap_audit.md
 * §6 P1-2: word.style.fontSize/letterSpacing used to skip this scaling entirely (subtitle-overlay.tsx's
 * wordDynamicStyle rendered the raw reference-height number directly as CSS px), so a word override
 * equal to the caption's own fontSize rendered ~3x too large at a typical ~640px-tall preview canvas.
 */
export function scaleWordStyleValue(value: number, refHeightPx: number): number {
  return value * (refHeightPx / 1920);
}
