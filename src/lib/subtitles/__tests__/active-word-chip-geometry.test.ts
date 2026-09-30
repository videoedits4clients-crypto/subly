/**
 * Task 132941 (P19.9) — active-word background-chip geometry now uses the ACTIVE word's own
 * EFFECTIVE fontSize/letterSpacing (a word-level override if one exists, else the caption's own
 * value — resolveEffectiveWordStyleValue, the same helper the rest of the word-style system
 * already uses) rather than always the caption's base values. Root cause: computeActiveWordChip
 * (lib/subtitles/ass.ts) previously measured every word in the line — including the active one —
 * with a single caption-level (fontSizePx, letterSpacingPx) pair, so a word-level fontSize/
 * letterSpacing override (P18.3/P19.8) was invisible to the chip's own width/height math even
 * though it IS rendered (via wordStyleTag's \fscx\fscy/\fsp) in the real text event right next to
 * it. This is export-only: the live preview's own "bg-highlight" chip (activeWordCss in
 * preview-style.ts) is plain CSS backgroundColor on the word's own span, so it already inherits
 * whatever size/spacing that span renders at via the normal box model — nothing to fix there.
 *
 * This suite is data-driven and deliberately does NOT re-test the general chip-existence/
 * positioning machinery already covered by bg-highlight-export.test.ts.
 *
 * Run with: node --test src/lib/subtitles/__tests__/active-word-chip-geometry.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAssDocument } from "../ass.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../../types/subtitle.ts";
import type { Subtitle, AnimationConfig } from "../../../types/subtitle.ts";

const BG_ANIM: AnimationConfig = { ...DEFAULT_ANIMATION, word: "bg-highlight" };

function build(subtitles: Subtitle[], styleOverride = {}) {
  return buildAssDocument({
    subtitles,
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, ...styleOverride },
    globalAnimation: BG_ANIM,
    playResX: 1080,
    playResY: 1920,
  });
}

function chipGeometries(doc: string): { width: number; height: number; left: number; top: number }[] {
  const lines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  return lines.map((line) => {
    const pos = /\\pos\((-?\d+),(-?\d+)\)/.exec(line)!;
    const path = /\\p1\}(m .+?)\{\\p0\}/.exec(line)![1];
    // The drawing path's own first "l W 0" segment (or the no-radius "l W 0" fallback) gives the
    // rectangle's width; height is read from the last coordinate pair before the path closes.
    const nums = path.match(/-?\d+/g)!.map(Number);
    const width = Math.max(...nums.filter((_, i) => i % 2 === 0)); // every x-coordinate
    const height = Math.max(...nums.filter((_, i) => i % 2 === 1)); // every y-coordinate
    return { width, height, left: Number(pos[1]), top: Number(pos[2]) };
  });
}

// "AAA BBB CCC" — three identical-length, distinctly-named words so a word-index mixup would be
// obvious. The MIDDLE word ("BBB") gets the override in most tests, so both a preceding and a
// following word (both plain "AAA"/"CCC"-shaped, never literally identical text — see test 8 for
// the truly-identical-text case) are available to prove isolation.
function fixture(middleWordStyle?: { fontSize?: number; letterSpacing?: number }): Subtitle[] {
  return [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1.2,
      text: "AAA BBB CCC",
      words: [
        { text: "AAA", start: 0, end: 0.4 },
        { text: "BBB", start: 0.4, end: 0.8, ...(middleWordStyle ? { style: middleWordStyle } : {}) },
        { text: "CCC", start: 0.8, end: 1.2 },
      ],
    },
  ];
}

function chipFor(doc: string, wordOrdinal: 0 | 1 | 2) {
  return chipGeometries(doc)[wordOrdinal];
}

// --- 1. no override: caption fontSize + letterSpacing are used, unchanged from before --------

test("1. no word override: the active word's chip uses the caption's own fontSize/letterSpacing (baseline, unchanged)", () => {
  const withoutOverride = build(fixture());
  const explicitlyMatchingCaption = build(fixture({})); // an empty style object — still "no override" for either property
  assert.deepEqual(chipFor(withoutOverride, 1), chipFor(explicitlyMatchingCaption, 1));
});

// --- 2. word fontSize override changes width (and height) ------------------------------------

test("2. a word-level fontSize override changes the active word's chip width (and height) vs. the caption baseline", () => {
  const base = chipFor(build(fixture()), 1);
  const bigger = chipFor(build(fixture({ fontSize: 128 })), 1); // caption default is 64
  assert.ok(bigger.width > base.width, "a 2x fontSize override must widen the chip");
  assert.ok(bigger.height > base.height, "a 2x fontSize override must also make the chip taller");
});

// --- 3. word letterSpacing override changes width only (not height) --------------------------

test("3. a word-level letterSpacing override widens the active word's chip without changing its height", () => {
  const base = chipFor(build(fixture()), 1);
  const wider = chipFor(build(fixture({ letterSpacing: 12 })), 1); // caption default is 0
  assert.ok(wider.width > base.width, "extra letter spacing must widen the chip");
  assert.equal(wider.height, base.height, "letterSpacing alone must not affect chip height");
});

// --- 4. both overrides together -----------------------------------------------------------

test("4. fontSize + letterSpacing overrides together produce a wider AND taller chip than either alone", () => {
  const base = chipFor(build(fixture()), 1);
  const fontOnly = chipFor(build(fixture({ fontSize: 128 })), 1);
  const both = chipFor(build(fixture({ fontSize: 128, letterSpacing: 12 })), 1);
  assert.ok(both.width > fontOnly.width, "combined override must be wider than fontSize alone");
  assert.ok(both.height > base.height, "fontSize still drives height even with letterSpacing also set");
});

// --- 5. explicit letterSpacing = 0 is a real override, not "unset" ----------------------------

test("5. an explicit letterSpacing:0 override is honored exactly (not treated as unset, not falling back to a non-zero caption value)", () => {
  const captionWithSpacing = { letterSpacing: 6 };
  const inheritedWide = chipFor(build(fixture(), captionWithSpacing), 1);
  const explicitZero = chipFor(build(fixture({ letterSpacing: 0 }), captionWithSpacing), 1);
  assert.ok(explicitZero.width < inheritedWide.width, "an explicit 0 override must be narrower than inheriting the caption's non-zero 6px spacing");
});

// --- 6. negative letterSpacing is honored (within the existing UI's allowed -2..12 range) ----

test("6. a negative letterSpacing override narrows the chip below the caption's own (zero) baseline", () => {
  const base = chipFor(build(fixture()), 1);
  const negative = chipFor(build(fixture({ letterSpacing: -2 })), 1);
  assert.ok(negative.width < base.width, "a negative override must narrow the chip vs. the zero-spacing caption baseline");
});

// --- 7. reset / inheritance: removing the override returns to caption values ------------------

test("7. removing the word override (style: undefined) returns the chip to the caption-level baseline exactly", () => {
  const overridden = fixture({ fontSize: 100, letterSpacing: 8 });
  const reset: Subtitle[] = [{ ...overridden[0], words: overridden[0].words.map((w) => ({ ...w, style: undefined })) }];
  assert.deepEqual(chipFor(build(reset), 1), chipFor(build(fixture()), 1));
});

// --- 8. identical text in neighboring words: only the active word's own style applies --------

test("8. three words with IDENTICAL text: only the active (middle) word's own override affects its chip; neighbors keep the caption baseline", () => {
  const subs: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1.2,
      text: "SAME SAME SAME",
      words: [
        { text: "SAME", start: 0, end: 0.4 },
        { text: "SAME", start: 0.4, end: 0.8, style: { fontSize: 128, letterSpacing: 12 } },
        { text: "SAME", start: 0.8, end: 1.2 },
      ],
    },
  ];
  const doc = build(subs);
  const chips = chipGeometries(doc);
  assert.equal(chips.length, 3);
  const baselineOnly = chipGeometries(build([{ ...subs[0], words: subs[0].words.map((w) => ({ ...w, style: undefined })) }]));
  assert.ok(chips[1].width > baselineOnly[1].width, "the overridden (middle) SAME must have a wider chip");
  assert.deepEqual(chips[0], baselineOnly[0], "the first SAME (not active in this interval, no override) must be identical to the no-override baseline");
  assert.deepEqual(chips[2], baselineOnly[2], "the last SAME (not active in this interval, no override) must be identical to the no-override baseline");
});

// --- 9. non-monotonic word array: active word is selected by identity, not array/chrono order -

test("9. non-monotonic word array: the reordered word's own style follows IT, selected by object identity not array position", () => {
  // BRAVO[2,3] DELTA[5,6] CHARLIE[3.5,4.5] — the established P18.6+ non-monotonic fixture.
  // CHARLIE sits at array index 2 but plays chronologically BEFORE DELTA (array index 1).
  const subs: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 2,
      end: 6,
      text: "BRAVO DELTA CHARLIE",
      words: [
        { text: "BRAVO", start: 2, end: 3 },
        { text: "DELTA", start: 5, end: 6 },
        { text: "CHARLIE", start: 3.5, end: 4.5, style: { fontSize: 128 } },
      ],
    },
  ];
  const doc = build(subs);
  // Find the chip whose Dialogue Start corresponds to CHARLIE's own [3.5, 4.5) interval.
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  const charlieChipLine = chipLines.find((l) => l.includes("0:00:03.50"));
  assert.ok(charlieChipLine, "expected a chip whose interval starts at CHARLIE's own 3.5s, regardless of its array position");
  const baselineDoc = build([{ ...subs[0], words: subs[0].words.map((w) => ({ ...w, style: undefined })) }]);
  const baselineChipLine = baselineDoc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}")).find((l) => l.includes("0:00:03.50"))!;
  const widthOf = (line: string) => {
    const path = /\\p1\}(m .+?)\{\\p0\}/.exec(line)![1];
    return Math.max(...path.match(/-?\d+/g)!.map(Number).filter((_, i) => i % 2 === 0));
  };
  assert.ok(widthOf(charlieChipLine!) > widthOf(baselineChipLine), "CHARLIE's own override must widen ITS chip, found by identity/interval — not by array position");
});

// --- 10. existing caption-level letterSpacing behavior is unchanged for a non-active word ----

test("10. caption-level letterSpacing still affects every word's chip the same way it always did, for a caption with no word overrides at all", () => {
  const noSpacing = chipGeometries(build(fixture(), { letterSpacing: 0 }));
  const withSpacing = chipGeometries(build(fixture(), { letterSpacing: 6 }));
  for (let i = 0; i < 3; i++) {
    assert.ok(withSpacing[i].width > noSpacing[i].width, `word ${i}'s chip must still widen with the caption's own letterSpacing, override or not`);
  }
});

// --- extra: fontWeight is NOT accounted for by the estimator (documented, intentionally out of scope) ---

test("11. a word-level fontWeight override alone does not change the chip's geometry (the estimator has no weight axis — see report §5/§13)", () => {
  const base = chipFor(build(fixture()), 1);
  const bold = chipFor(build(fixture({ fontSize: undefined }) /* no-op */), 1);
  void bold;
  const withWeight = fixture();
  withWeight[0].words[1].style = { fontWeight: 900 };
  const withWeightChip = chipFor(build(withWeight), 1);
  assert.deepEqual(withWeightChip, base, "fontWeight has no effect on the estimator today — documented limitation, not silently 'fixed' by this task");
});

// --- performance: computeActiveWordChip's per-active-word cost must stay O(1), independent of
// how many OTHER captions exist in the project — i.e. buildAssDocument's total time must scale
// with caption COUNT, not blow up super-linearly, since resolveEffectiveWordStyleValue adds only
// two constant-time property lookups per active-word chip, no new per-caption or per-project scan.

function manyCaptionsWithBgHighlight(count: number): Subtitle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    index: i,
    start: i,
    end: i + 0.9,
    text: "ALPHA BETA",
    words: [
      { text: "ALPHA", start: i, end: i + 0.4 },
      { text: "BETA", start: i + 0.4, end: i + 0.9, style: { fontSize: 100, letterSpacing: 6 } },
    ],
  }));
}

for (const captionCount of [30, 300, 1800, 5400]) {
  test(`performance: buildAssDocument with per-word-overridden bg-highlight chips stays fast at ${captionCount} captions`, () => {
    const subs = manyCaptionsWithBgHighlight(captionCount);
    const start = performance.now();
    const doc = build(subs);
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 2000, `buildAssDocument took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 2000ms`);
    assert.equal((doc.match(/\\p1\}/g) ?? []).length, captionCount * 2, "one chip per active-word interval (2 words per caption)");
  });
}
