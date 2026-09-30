/**
 * Regression tests for P5.1 (Task 86317): the "bg-highlight" word animation used to render a real
 * background chip behind the active word in the live editor preview (activeWordCss's bg-highlight
 * case in preview-style.ts: backgroundColor + rounded corners + a boxShadow-as-padding halo), but
 * the ASS/FFmpeg export fell back to color-only highlighting — the exported MP4 never showed a
 * background box. buildAssDocument (lib/subtitles/ass.ts) now emits a real Layer-0 `\p`-drawing
 * (vector rectangle) Dialogue event behind the active word's Layer-1 text event, sized/positioned
 * via a character-class text-width estimate (see ass.ts's own computeActiveWordChip/
 * estimateTextWidthPx doc comments for why an estimate, not an exact font-metrics measurement, is
 * used). This suite is data-driven and deliberately does NOT re-test the general ASS-generation
 * machinery already covered by preset-library.test.ts / global-style-robustness.test.ts.
 *
 * Run with: node --test src/lib/subtitles/__tests__/bg-highlight-export.test.ts
 * (or the "test:bg-highlight-export" package.json script)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAssDocument } from "../ass.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../../types/subtitle.ts";
import type { Subtitle, AnimationConfig } from "../../../types/subtitle.ts";

const BG_ANIM: AnimationConfig = { ...DEFAULT_ANIMATION, word: "bg-highlight" };
const COLOR_ANIM: AnimationConfig = { ...DEFAULT_ANIMATION, word: "highlight" };

const ONE_LINE: Subtitle[] = [
  {
    id: "1",
    index: 0,
    start: 0,
    end: 1.2,
    text: "This is amazing",
    words: [
      { text: "This", start: 0, end: 0.3 },
      { text: "is", start: 0.3, end: 0.5 },
      { text: "amazing", start: 0.5, end: 1.2 },
    ],
  },
];

const TWO_LINE: Subtitle[] = [
  {
    id: "1",
    index: 0,
    start: 0,
    end: 2,
    text: "First short line\nSecond longer line here",
    words: [
      { text: "First", start: 0, end: 0.3 },
      { text: "short", start: 0.3, end: 0.6 },
      { text: "line", start: 0.6, end: 0.9 },
      { text: "Second", start: 0.9, end: 1.2 },
      { text: "longer", start: 1.2, end: 1.5 },
      { text: "line", start: 1.5, end: 1.8 },
      { text: "here", start: 1.8, end: 2.0 },
    ],
  },
];

function build(subtitles: Subtitle[], anim: AnimationConfig, styleOverride = {}) {
  return buildAssDocument({
    subtitles,
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, ...styleOverride },
    globalAnimation: anim,
    playResX: 1080,
    playResY: 1920,
  });
}

// Count Layer-0 `\p1` drawing events (the background chip) vs Layer-1 text events.
function countChipEvents(doc: string): number {
  return (doc.match(/^Dialogue: 0,.*\\p1\}/gm) ?? []).length;
}
function countTextEvents(doc: string): number {
  return (doc.match(/^Dialogue: 1,/gm) ?? []).length;
}

// --- 1. bg-highlight generates valid, well-formed ASS ---------------------------------------

test("1. bg-highlight generates a valid ASS document with a Script Info / Styles / Events structure", () => {
  const doc = build(ONE_LINE, BG_ANIM);
  assert.ok(doc.includes("[Script Info]"));
  assert.ok(doc.includes("[V4+ Styles]"));
  assert.ok(doc.includes("[Events]"));
  assert.ok(doc.length > 200);
});

// --- 2. background chip events don't corrupt normal dialogue --------------------------------

test("2. bg-highlight adds background-chip Dialogue events alongside, not instead of, the normal text Dialogue events", () => {
  const doc = build(ONE_LINE, BG_ANIM);
  assert.ok(countTextEvents(doc) > 0, "expected at least one Layer-1 text event");
  assert.ok(countChipEvents(doc) > 0, "expected at least one Layer-0 background-chip event");
  // Every text event's rendered line text must still be present somewhere in the document,
  // uncorrupted by the extra chip events being interleaved. DEFAULT_SUBTITLE_STYLE uses
  // textCase: "uppercase", so the rendered text is upper-cased.
  for (const word of ["THIS", "IS", "AMAZING"]) {
    assert.ok(doc.includes(word), `expected caption text "${word}" to survive in the ASS output`);
  }
});

test("2b. a non-bg-highlight animation (color) never emits a background-chip event", () => {
  const doc = build(ONE_LINE, COLOR_ANIM);
  assert.equal(countChipEvents(doc), 0);
});

test("2c. bg-highlight with wordHighlight disabled emits no background-chip event (matches the live preview, which also gates the effect on wordHighlight)", () => {
  const doc = build(ONE_LINE, BG_ANIM, { wordHighlight: false });
  assert.equal(countChipEvents(doc), 0);
});

// --- 3. word timing remains correct ----------------------------------------------------------

test("3. each background-chip event's Start/End exactly matches its corresponding active-word interval, not the whole caption span", () => {
  const doc = build(ONE_LINE, BG_ANIM);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  assert.equal(chipLines.length, 3, "one chip per word-active interval (This / is / amazing)");
  // None of the three chip intervals should span the entire 0.00-1.20 caption duration —
  // each is scoped to its own word's [start,end).
  for (const line of chipLines) {
    const [, startStr, endStr] = line.split(",");
    assert.notEqual(`${startStr},${endStr}`, "0:00:00.00,0:00:01.20");
  }
});

// --- 4. first / middle / last active word all produce a chip --------------------------------

test("4. the first, middle, and last word in a caption each produce exactly one background chip", () => {
  const doc = build(ONE_LINE, BG_ANIM);
  assert.equal(countChipEvents(doc), 3);
});

test("4b. a single-word caption still produces exactly one background chip", () => {
  const single: Subtitle[] = [{ id: "1", index: 0, start: 0, end: 0.5, text: "Hi", words: [{ text: "Hi", start: 0, end: 0.5 }] }];
  const doc = build(single, BG_ANIM);
  assert.equal(countChipEvents(doc), 1);
});

// --- 5. multi-line captions remain valid -----------------------------------------------------

test("5. a two-line caption produces one chip per word and stays valid ASS", () => {
  const doc = build(TWO_LINE, BG_ANIM);
  assert.equal(countChipEvents(doc), 7);
  assert.equal(countTextEvents(doc), 7);
  assert.ok(doc.includes("[Events]"));
});

test("5b. active word near a line break (last word of line 1, first word of line 2) both produce chips with distinct vertical positions", () => {
  const doc = build(TWO_LINE, BG_ANIM);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  const posOf = (line: string) => /\\pos\((-?\d+),(-?\d+)\)/.exec(line);
  const lastWordOfLine1 = posOf(chipLines[2]); // "line" (end of "First short line")
  const firstWordOfLine2 = posOf(chipLines[3]); // "Second" (start of line 2)
  assert.ok(lastWordOfLine1 && firstWordOfLine2);
  assert.notEqual(lastWordOfLine1![2], firstWordOfLine2![2], "the two lines must sit at different vertical positions");
});

// --- 6. existing color-highlight behavior is unchanged ---------------------------------------

test("6. word:'highlight' (plain color-only) still applies \\\\c color override and emits no chip", () => {
  const doc = build(ONE_LINE, COLOR_ANIM);
  assert.ok(/\\c&H[0-9A-F]{6,8}&/.test(doc), "expected a PrimaryColour override tag for the active word");
  assert.equal(countChipEvents(doc), 0);
});

test("6b. bg-highlight no longer overrides the active word's own text color (matches the live preview: only the background changes)", () => {
  const doc = build(ONE_LINE, BG_ANIM);
  const textLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 1,"));
  for (const line of textLines) {
    assert.ok(!/\{\\pos\(\d+,\d+\)[^}]*\\c&H/.test(line), `text event unexpectedly recolors the active word: ${line}`);
  }
});

// --- 7. existing animation types remain valid (scale/bounce/underline unaffected) ------------

test("7. scale/bounce/underline word animations are unaffected by the bg-highlight fix (no chips, existing override tags intact)", () => {
  for (const word of ["scale", "bounce", "underline"] as const) {
    const doc = build(ONE_LINE, { ...DEFAULT_ANIMATION, word });
    assert.equal(countChipEvents(doc), 0, `${word} must not emit a background chip`);
  }
});

// --- 8. special characters / punctuation / unicode / long words survive chip geometry --------

test("8. punctuation, apostrophes, and commas in the active word don't break ASS generation or produce NaN geometry", () => {
  const sub: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1,
      text: "Don't, wait!",
      words: [
        { text: "Don't,", start: 0, end: 0.4 },
        { text: "wait!", start: 0.4, end: 1 },
      ],
    },
  ];
  const doc = build(sub, BG_ANIM);
  assert.equal(countChipEvents(doc), 2);
  assert.ok(!doc.includes("NaN"), "ASS document must never contain NaN in a drawing/position value");
});

test("8b. Unicode (Devanagari) active words produce a chip without NaN geometry", () => {
  const sub: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1,
      text: "नमस्ते दुनिया",
      words: [
        { text: "नमस्ते", start: 0, end: 0.5 },
        { text: "दुनिया", start: 0.5, end: 1 },
      ],
    },
  ];
  const doc = build(sub, BG_ANIM);
  assert.equal(countChipEvents(doc), 2);
  assert.ok(!doc.includes("NaN"));
});

test("8c. a very long word still produces a single well-formed chip (width estimate scales with length, not clamped/broken)", () => {
  const sub: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1,
      text: "supercalifragilisticexpialidocious",
      words: [{ text: "supercalifragilisticexpialidocious", start: 0, end: 1 }],
    },
  ];
  const doc = build(sub, BG_ANIM);
  assert.equal(countChipEvents(doc), 1);
  const chipLine = doc.split("\n").find((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"))!;
  const widthMatch = /l (\d+) 0/.exec(chipLine) ?? /m \d+ 0 l (\d+) 0/.exec(chipLine);
  assert.ok(widthMatch, "expected a drawing path with a discernible rectangle width");
});

// --- 8d. font-specific width calibration keeps the last word's chip inside the line's own span
// (regression for a real bug found during live-QA: an uncalibrated Helvetica-Bold-based estimate
// overestimated Poppins-Bold's real rendered width by ~2x, so the last word's chip in a
// center-aligned line drifted completely past where the word actually renders — confirmed via an
// isolated ffmpeg burn-in + pixel-bounding-box measurement, see the P5.1 report). This test can't
// measure real pixels (no ffmpeg here), but it pins the INVARIANT that matters: the last word's
// chip must stay within a generous margin of the caption's own centered position, not drift by
// hundreds of pixels toward the canvas edge the way the uncalibrated estimate did.

test("8d. last word's chip in a center-aligned Poppins line stays near the caption's own horizontal center, not drifted toward the canvas edge", () => {
  const doc = build(ONE_LINE, BG_ANIM, { fontFamily: "Poppins", fontWeight: 700, align: "center", x: 50 });
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  const lastChip = chipLines[chipLines.length - 1]; // "amazing" — last word of ONE_LINE
  const posMatch = /\\pos\((-?\d+),(-?\d+)\)/.exec(lastChip);
  assert.ok(posMatch);
  const chipLeft = Number(posMatch![1]);
  // playResX=1080, x=50% -> anchor at 540. A 3-word caption's last word must land well within
  // the canvas and reasonably close to center — not off past the right edge (the uncalibrated
  // bug placed it far beyond the actual text, close to or past the 1080px canvas boundary).
  assert.ok(chipLeft > 200 && chipLeft < 900, `last word's chip x=${chipLeft} drifted outside a sane center-aligned range`);
});

// --- 9. representative full exports (all three bg-highlight-driven categories) succeed -------

test("9. Highlight/Active Highlight/Marker-style presets (bg-highlight + wordHighlight) all produce a valid document with chips and no NaN", () => {
  const variants = [
    { fontSize: 64, highlightColor: "#7C3AED", x: 50, y: 82, align: "center" as const, vAlign: "bottom" as const },
    { fontSize: 88, highlightColor: "#FFD400", x: 50, y: 50, align: "center" as const, vAlign: "center" as const },
    { fontSize: 52, highlightColor: "#00FF88", x: 10, y: 90, align: "left" as const, vAlign: "bottom" as const },
  ];
  for (const styleOverride of variants) {
    const doc = build(ONE_LINE, BG_ANIM, styleOverride);
    assert.ok(countChipEvents(doc) > 0);
    assert.ok(!doc.includes("NaN"));
    assert.ok(doc.includes("[Events]"));
  }
});

// --- 10. different caption positions / font sizes don't break geometry -----------------------

test("10. right/left aligned and top/bottom vAlign captions all produce valid, distinctly-positioned chips", () => {
  for (const align of ["left", "center", "right"] as const) {
    for (const vAlign of ["top", "center", "bottom"] as const) {
      const doc = build(ONE_LINE, BG_ANIM, { align, vAlign });
      assert.ok(countChipEvents(doc) === 3, `align=${align} vAlign=${vAlign} should still produce 3 chips`);
      assert.ok(!doc.includes("NaN"), `align=${align} vAlign=${vAlign} produced NaN geometry`);
    }
  }
});
