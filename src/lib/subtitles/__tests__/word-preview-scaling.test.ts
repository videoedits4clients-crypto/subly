/**
 * Task 137421 (P19.12) — fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md
 * §6 P1-2: word-level fontSize/letterSpacing overrides were applied in the live preview
 * (subtitle-overlay.tsx's wordDynamicStyle) using the raw stored REFERENCE_HEIGHT=1920-authored
 * value directly as CSS px, with no scaling — while the caption-level fontSize/letterSpacing
 * (preview-style.ts's styleToTextCss) has always correctly scaled by `refHeightPx / 1920`. At a
 * typical ~640px-tall preview canvas (scale ≈ 0.333), a word override equal to the caption's own
 * fontSize rendered roughly 3x too large in the editor relative to the actual exported MP4.
 *
 * The fix extracts the scaling math into `scaleWordStyleValue` (preview-style.ts) — a pure
 * function subtitle-overlay.tsx's wordDynamicStyle now calls for both fontSize and letterSpacing
 * — so it can be tested directly (this project has no React-rendering test infrastructure, so a
 * .tsx component's own inline logic can't be imported directly by node's test runner).
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-preview-scaling.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { scaleWordStyleValue } from "../word-preview-scale.ts";

const REFERENCE_HEIGHT = 1920;

test("at the reference height itself (1920px), scaling is a no-op", () => {
  assert.equal(scaleWordStyleValue(64, REFERENCE_HEIGHT), 64);
  assert.equal(scaleWordStyleValue(12, REFERENCE_HEIGHT), 12);
});

test("[MANDATORY REGRESSION] the exact P19.11-documented scenario: a word fontSize override equal to the caption's own 64px no longer renders ~3x too large at a 640px-tall preview canvas", () => {
  const wordFontSize = 64; // equal to DEFAULT_SUBTITLE_STYLE.fontSize
  const refHeightPx = 640; // a typical preview canvas height cited in the audit
  const scaledPx = scaleWordStyleValue(wordFontSize, refHeightPx);
  // Before the fix, this word would have rendered at the full, unscaled 64px — nearly 3x the
  // correctly-scaled ~21.3px the caption-level text itself renders at, at this same canvas height.
  const expected = 64 * (640 / 1920); // ≈ 21.33
  assert.ok(Math.abs(scaledPx - expected) < 1e-9);
  assert.ok(scaledPx < wordFontSize / 2, "the scaled value must be meaningfully smaller than the raw stored value at a sub-reference-height canvas");
});

test("fontSize scaling: a word override half the reference height scales proportionally", () => {
  assert.equal(scaleWordStyleValue(100, 960), 50);
});

test("letterSpacing scaling: matches the same scale factor as fontSize (both are reference-height-authored numeric style fields)", () => {
  const refHeightPx = 480;
  const scale = refHeightPx / REFERENCE_HEIGHT;
  assert.equal(scaleWordStyleValue(12, refHeightPx), 12 * scale);
  assert.equal(scaleWordStyleValue(-2, refHeightPx), -2 * scale);
});

test("zero is scaled correctly (0 stays 0, not skipped) — matches the existing !== undefined convention for letterSpacing overrides", () => {
  assert.equal(scaleWordStyleValue(0, 640), 0);
});

test("negative values (a valid letterSpacing override within the -2..12 UI range) scale correctly, preserving sign", () => {
  const scaled = scaleWordStyleValue(-2, 960);
  assert.equal(scaled, -1);
  assert.ok(scaled < 0);
});

test("scaling above the reference height (a canvas taller than 1920px) scales UP, not down", () => {
  const scaled = scaleWordStyleValue(64, 3840);
  assert.equal(scaled, 128);
  assert.ok(scaled > 64);
});
