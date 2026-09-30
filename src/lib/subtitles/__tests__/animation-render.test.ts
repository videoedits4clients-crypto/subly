/**
 * Regression test for the live-preview/export animation parity fix: "typewriter"/"word-pop"/
 * "char-pop" entrances used to fade over the user's FULL configured duration in the live
 * preview (components/editor/subtitle-overlay.tsx) while the ASS export (lib/subtitles/ass.ts)
 * capped the same fade at a fixed 150ms — so a longer configured duration made these three
 * entrances visibly fade slower in the editor than what actually got burned into the exported
 * video. Both renderers now import the same effectiveEntranceDurationSec/APPROXIMATED_FADE_CAP_SEC
 * from lib/subtitles/animation-render.ts, so this one test covers both.
 *
 * Run with: node --test src/lib/subtitles/__tests__/animation-render.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveEntranceDurationSec, APPROXIMATED_FADE_CAP_SEC, APPROXIMATED_FADE_ENTRANCES } from "../animation-render.ts";
import type { EntranceAnimation } from "../../../types/subtitle.ts";

test("typewriter/word-pop/char-pop are capped at APPROXIMATED_FADE_CAP_SEC even when the configured duration is much longer", () => {
  for (const entrance of ["typewriter", "word-pop", "char-pop"] as EntranceAnimation[]) {
    assert.equal(effectiveEntranceDurationSec(entrance, 1), APPROXIMATED_FADE_CAP_SEC);
    assert.equal(effectiveEntranceDurationSec(entrance, 0.5), APPROXIMATED_FADE_CAP_SEC);
  }
});

test("typewriter/word-pop/char-pop are NOT capped when the configured duration is already shorter than the cap", () => {
  for (const entrance of ["typewriter", "word-pop", "char-pop"] as EntranceAnimation[]) {
    assert.equal(effectiveEntranceDurationSec(entrance, 0.05), 0.05);
  }
});

test("every other entrance type uses the full configured duration, uncapped", () => {
  const untouched: EntranceAnimation[] = ["none", "fade", "pop", "slide-up", "slide-down", "slide-left", "slide-right", "bounce"];
  for (const entrance of untouched) {
    assert.equal(effectiveEntranceDurationSec(entrance, 1), 1, `${entrance} must not be capped`);
  }
});

test("APPROXIMATED_FADE_ENTRANCES contains exactly the three types with no true progressive-reveal implementation", () => {
  assert.deepEqual([...APPROXIMATED_FADE_ENTRANCES].sort(), ["char-pop", "typewriter", "word-pop"]);
});
