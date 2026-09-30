/**
 * Task 134276 (P19.10) — ASS auto-wrap / active-chip line-layout parity.
 *
 * P19.9 documented a real, reproduced-via-real-libass edge case: `wordsByLine`'s (and therefore
 * `computeActiveWordChip`'s) line model is built entirely from `sub.text`'s own stored "\n"
 * positions, but the exported ASS document left `WrapStyle` unset — which libass defaults to 0
 * ("smart auto-wrap"). Left unset, a sufficiently wide already-single-line Dialogue Text event
 * (e.g. one containing a large word-level fontSize/letterSpacing override) got independently
 * RE-WRAPPED a second time by libass at burn time, onto a line the app's own geometry model had
 * no idea existed — so the active-word chip (computed for the ORIGINAL single-line assumption)
 * landed on the wrong visual line.
 *
 * The fix: `WrapStyle: 2` in the ASS `[Script Info]` header ("no smart wrapping — a line only
 * breaks at an explicit \N"). This makes libass defer entirely to this app's own already-decided
 * line breaks, so the two can never again disagree — by construction, not by trying to predict
 * libass's own wrapping algorithm (which this task deliberately does NOT attempt to model).
 *
 * This suite is deterministic-only (buildAssDocument output); the actual real-libass
 * reproduction (proving the bug existed, and proving WrapStyle 2 actually fixes it against a
 * real ffmpeg/libass render, not just a code-reading assumption) lives in
 * research/p19_10_ass_autowrap_chip_parity_report.md's own Phase-0 section — see that report for
 * the two real exported frames (before/after) this suite's own tests are pinning at the
 * ASS-document level.
 *
 * Run with: node --test src/lib/subtitles/__tests__/ass-autowrap-chip-parity.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAssDocument } from "../ass.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../../types/subtitle.ts";
import type { Subtitle, AnimationConfig } from "../../../types/subtitle.ts";

const BG_ANIM: AnimationConfig = { ...DEFAULT_ANIMATION, word: "bg-highlight" };

function build(subtitles: Subtitle[], styleOverride = {}, anim: AnimationConfig = BG_ANIM) {
  return buildAssDocument({
    subtitles,
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, ...styleOverride },
    globalAnimation: anim,
    playResX: 1080,
    playResY: 1920,
  });
}

function headerLines(doc: string): string[] {
  return doc.split("\n[V4+ Styles]")[0].split("\n");
}

/** Groups chip Y positions into "same visual line" clusters — words on the SAME stored line can
 * still have slightly different Y (P19.9: a bigger active word is vertically re-centered around
 * its OWN glyphHeight within the shared line band), but that variance stays well under HALF of
 * one lineHeightPx (DEFAULT_SUBTITLE_STYLE: fontSize 64 * lineHeight 1.15 = 73.6px at scale 1 —
 * every test fixture here uses playResY === REFERENCE_HEIGHT, i.e. scale === 1), while two
 * DIFFERENT stored lines are always a full lineHeightPx apart. 40px sits safely between the two
 * for every fontSize override value these tests use (<=120px, well under the ~160px that would
 * start to make the two ranges ambiguous). */
const SAME_LINE_THRESHOLD_PX = 40;
function lineGroupCount(ys: number[]): number {
  const sorted = [...ys].sort((a, b) => a - b);
  let groups = sorted.length ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > SAME_LINE_THRESHOLD_PX) groups++;
  }
  return groups;
}

// --- 1. WrapStyle is now always present and set to 2 ------------------------------------------

test("1. every ASS document declares WrapStyle: 2 in [Script Info] (deterministic, no libass-default reliance)", () => {
  const doc = build([{ id: "1", index: 0, start: 0, end: 1, text: "Hello world", words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "world", start: 0.5, end: 1 }] }]);
  assert.ok(headerLines(doc).includes("WrapStyle: 2"));
});

// --- 2. existing normal single-line caption -> unchanged everything except the new header line -

test("2. a normal single-line caption (no overrides) produces byte-for-byte identical Dialogue/Style output; only the header gains WrapStyle", () => {
  const subs: Subtitle[] = [{ id: "1", index: 0, start: 0, end: 1.2, text: "This is amazing", words: [{ text: "This", start: 0, end: 0.3 }, { text: "is", start: 0.3, end: 0.5 }, { text: "amazing", start: 0.5, end: 1.2 }] }];
  const doc = build(subs);
  const withoutWrapStyle = doc.replace("WrapStyle: 2\n", "");
  // Every Dialogue/Style line is untouched — only the header changed.
  const dialogueAndStyleLines = (d: string) => d.split("\n").filter((l) => l.startsWith("Dialogue:") || l.startsWith("Style:"));
  assert.deepEqual(dialogueAndStyleLines(doc), dialogueAndStyleLines(withoutWrapStyle));
});

// --- 3. existing normal multi-line caption (explicit stored \n) -> unchanged, both lines intact -

test("3. a normal multi-line caption (explicit stored newline) still renders as two distinct lines with distinct chip Y positions", () => {
  const subs: Subtitle[] = [
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
  const doc = build(subs);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  assert.equal(chipLines.length, 7);
  const yOf = (line: string) => /\\pos\((-?\d+),(-?\d+)\)/.exec(line)![2];
  const line1Y = yOf(chipLines[0]); // "First"
  const line2Y = yOf(chipLines[3]); // "Second"
  assert.notEqual(line1Y, line2Y, "the two EXPLICIT stored lines must still occupy distinct vertical slots");
  const textLine = doc.split("\n").find((l) => l.startsWith("Dialogue: 1,"))!;
  assert.ok(textLine.includes("\\N"), "the explicit line break must still be honored as \\N (WrapStyle 2 only disables AUTOMATIC re-wrapping, never explicit breaks)");
});

// --- 4. word-level fontSize override that stays within the box -> unchanged single-line, no drift

test("4. a word-level fontSize override that stays comfortably within the box renders as one line, chip on that one line", () => {
  const subs: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1.2,
      text: "WORD A WORD",
      words: [
        { text: "WORD", start: 0, end: 0.4 },
        { text: "A", start: 0.4, end: 0.8, style: { fontSize: 90 } },
        { text: "WORD", start: 0.8, end: 1.2 },
      ],
    },
  ];
  const doc = build(subs);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  const ys = chipLines.map((l) => Number(/\\pos\((-?\d+),(-?\d+)\)/.exec(l)![2]));
  assert.equal(lineGroupCount(ys), 1, "a caption with only ONE stored line must keep every word's chip on the same Y — a safe-sized override must not itself trigger any wrap");
});

// --- 5. Phase-0 reproduction case: large fontSize+letterSpacing override that WOULD have --------
// forced a libass auto-wrap -> now stays a single line (chip and text always agree)

test("5. the exact Phase-0 reproduction fixture (large fontSize+letterSpacing override) keeps every chip on the SAME single computed line", () => {
  const words = [
    { text: "WORD", start: 0, end: 0.4 },
    { text: "A", start: 0.4, end: 0.8 },
    { text: "WORD", start: 0.8, end: 1.2 },
    { text: "SPACEDOUT", start: 1.2, end: 1.6, style: { fontSize: 90, letterSpacing: 8 } },
    { text: "WORD", start: 1.6, end: 2.0 },
    { text: "C", start: 2.0, end: 2.4 },
  ];
  const subs: Subtitle[] = [{ id: "1", index: 0, start: 0, end: 2.4, text: words.map((w) => w.text).join(" "), words }];
  const doc = build(subs);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  assert.equal(chipLines.length, 6);
  const ys = chipLines.map((l) => Number(/\\pos\((-?\d+),(-?\d+)\)/.exec(l)![2]));
  assert.equal(lineGroupCount(ys), 1, "with WrapStyle 2, this app's own single-line model is authoritative — every word (including the oversized one) stays on the one computed line, matching what libass will actually render");
});

// --- 6. multiple words with different font sizes on the same stored line ----------------------

test("6. multiple words with different fontSize overrides on the same stored line all keep chips on that one line", () => {
  const subs: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1.6,
      text: "SMALL MED BIG END",
      words: [
        { text: "SMALL", start: 0, end: 0.4, style: { fontSize: 50 } },
        { text: "MED", start: 0.4, end: 0.8, style: { fontSize: 70 } },
        { text: "BIG", start: 0.8, end: 1.2, style: { fontSize: 100 } },
        { text: "END", start: 1.2, end: 1.6 },
      ],
    },
  ];
  const doc = build(subs);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  const ys = chipLines.map((l) => Number(/\\pos\((-?\d+),(-?\d+)\)/.exec(l)![2]));
  assert.equal(lineGroupCount(ys), 1);
});

// --- 7. identical words, only one oversized -----------------------------------------------------

test("7. identical-text words with only the middle one oversized: still one line, and only the oversized word's own chip is wider", () => {
  const subs: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1.2,
      text: "SAME SAME SAME",
      words: [
        { text: "SAME", start: 0, end: 0.4 },
        { text: "SAME", start: 0.4, end: 0.8, style: { fontSize: 100, letterSpacing: 10 } },
        { text: "SAME", start: 0.8, end: 1.2 },
      ],
    },
  ];
  const doc = build(subs);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  const ys = chipLines.map((l) => Number(/\\pos\((-?\d+),(-?\d+)\)/.exec(l)![2]));
  assert.equal(lineGroupCount(ys), 1, "all three SAME chips share one line's Y-band");
  const widthOf = (line: string) => {
    const path = /\\p1\}(m .+?)\{\\p0\}/.exec(line)![1];
    return Math.max(...path.match(/-?\d+/g)!.map(Number).filter((_, i) => i % 2 === 0));
  };
  const widths = chipLines.map(widthOf);
  assert.ok(widths[1] > widths[0] && widths[1] > widths[2], "only the middle (oversized) SAME has a wider chip");
});

// --- 8. non-monotonic word array ----------------------------------------------------------------

test("8. non-monotonic word array (BRAVO/DELTA/CHARLIE): CHARLIE's own override stays correctly on its one computed line, found by identity/interval", () => {
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
        { text: "CHARLIE", start: 3.5, end: 4.5, style: { fontSize: 100, letterSpacing: 10 } },
      ],
    },
  ];
  const doc = build(subs);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  assert.equal(chipLines.length, 3);
  const ys = chipLines.map((l) => Number(/\\pos\((-?\d+),(-?\d+)\)/.exec(l)![2]));
  assert.equal(lineGroupCount(ys), 1, "one stored line -> one Y-band regardless of word array order");
  const charlieChip = chipLines.find((l) => l.includes("0:00:03.50"))!;
  assert.ok(charlieChip, "CHARLIE's own chip must be found by its own interval timestamp, not array position");
});

// --- 9. multiple active words across SEPARATE stored lines remain isolated ----------------------

test("9. active words on two different STORED lines remain isolated from each other (their own overrides don't leak across the explicit \\n)", () => {
  const subs: Subtitle[] = [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 2,
      text: "TOP BIG\nBOTTOM WORD",
      words: [
        { text: "TOP", start: 0, end: 0.5 },
        { text: "BIG", start: 0.5, end: 1, style: { fontSize: 100 } },
        { text: "BOTTOM", start: 1, end: 1.5 },
        { text: "WORD", start: 1.5, end: 2 },
      ],
    },
  ];
  const doc = build(subs);
  const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  const ys = chipLines.map((l) => Number(/\\pos\((-?\d+),(-?\d+)\)/.exec(l)![2]));
  assert.equal(lineGroupCount(ys), 2, "two EXPLICIT stored lines must still produce two distinct Y-bands");

  // Isolation check: BOTTOM's own chip geometry (line 2, no override) must be identical whether
  // or not line 1's BIG has an oversized override — compared against a baseline with no override
  // at all, not against BIG's own chip (different word, different letter count, not a valid
  // apples-to-apples width comparison).
  const widthOf = (line: string) => {
    const path = /\\p1\}(m .+?)\{\\p0\}/.exec(line)![1];
    return Math.max(...path.match(/-?\d+/g)!.map(Number).filter((_, i) => i % 2 === 0));
  };
  const baselineDoc = build([{ ...subs[0], words: subs[0].words.map((w) => ({ ...w, style: undefined })) }]);
  const baselineChips = baselineDoc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
  assert.equal(widthOf(chipLines[2]), widthOf(baselineChips[2]), "BOTTOM's chip (line 2) must be identical regardless of BIG's own override on line 1");
});

// --- 10. boundary case: a fontSize override right at the edge of triggering a wrap ---------------

test("10. a boundary-sized override (large but not egregious) still resolves to exactly one computed line per stored line, same as a smaller one", () => {
  const makeSubs = (fontSize: number): Subtitle[] => [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1.2,
      text: "WORD A WORD",
      words: [
        { text: "WORD", start: 0, end: 0.4 },
        { text: "A", start: 0.4, end: 0.8, style: { fontSize } },
        { text: "WORD", start: 0.8, end: 1.2 },
      ],
    },
  ];
  for (const fontSize of [80, 100, 120]) {
    const doc = build(makeSubs(fontSize));
    const chipLines = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"));
    const ys = chipLines.map((l) => Number(/\\pos\((-?\d+),(-?\d+)\)/.exec(l)![2]));
    assert.equal(lineGroupCount(ys), 1, `fontSize=${fontSize}: this app's own line model is always authoritative post-fix, regardless of how wide the real render ends up`);
  }
});

// --- 11. regression: ordinary P19.9 fontSize/letterSpacing chip-geometry behavior is unchanged --

test("11. P19.9's own chip-width/height behavior (fontSize widens+heightens, letterSpacing widens only) is completely unaffected by the WrapStyle fix", () => {
  const withOverride = (style: { fontSize?: number; letterSpacing?: number }): Subtitle[] => [
    {
      id: "1",
      index: 0,
      start: 0,
      end: 1.2,
      text: "AAA BBB CCC",
      words: [
        { text: "AAA", start: 0, end: 0.4 },
        { text: "BBB", start: 0.4, end: 0.8, style },
        { text: "CCC", start: 0.8, end: 1.2 },
      ],
    },
  ];
  const geom = (subs: Subtitle[]) => {
    const line = doc(subs).split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.includes("\\p1}"))[1];
    const path = /\\p1\}(m .+?)\{\\p0\}/.exec(line)![1];
    const nums = path.match(/-?\d+/g)!.map(Number);
    return { width: Math.max(...nums.filter((_, i) => i % 2 === 0)), height: Math.max(...nums.filter((_, i) => i % 2 === 1)) };
  };
  function doc(subs: Subtitle[]) {
    return build(subs);
  }
  const base = geom(withOverride({}));
  const biggerFont = geom(withOverride({ fontSize: 128 }));
  const widerSpacing = geom(withOverride({ letterSpacing: 12 }));
  assert.ok(biggerFont.width > base.width && biggerFont.height > base.height);
  assert.ok(widerSpacing.width > base.width && widerSpacing.height === base.height);
});

// --- performance: WrapStyle is a single constant-time header line addition — no new per-caption
// or per-word work at all, so buildAssDocument's own P19.9 performance baseline must be unaffected.

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
  test(`performance: buildAssDocument (with WrapStyle 2 + per-word overrides) stays fast at ${captionCount} captions — matches the P19.9 baseline`, () => {
    const subs = manyCaptionsWithBgHighlight(captionCount);
    const start = performance.now();
    const doc = build(subs);
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 2000, `took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 2000ms (same budget as P19.9)`);
    assert.equal((doc.match(/\\p1\}/g) ?? []).length, captionCount * 2);
  });
}
