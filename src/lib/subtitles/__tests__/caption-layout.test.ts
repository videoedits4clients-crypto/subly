/**
 * P20.4 — the pure caption layout shared by the preview and the ASS export: wrapping, explicit line
 * preservation, line boxes, alignment and custom position, per-word size, scale invariance.
 *
 * Run with: node --test src/lib/subtitles/__tests__/caption-layout.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildLayoutLines, layoutCaption, layoutFontsNeeded, type LayoutStyle, type MetricsProvider } from "../caption-layout.ts";
import { cssContentMetrics, textAdvance } from "../../fonts/font-metrics.ts";
import { DEFAULT_SUBTITLE_STYLE } from "../../../types/subtitle.ts";
import type { Word } from "../../../types/subtitle.ts";
import { syntheticMetrics } from "../../fonts/__tests__/synthetic-font.ts";

const TIGHT = syntheticMetrics({ cell: 1.2, advanceEm: 0.5 });
const LOOSE = syntheticMetrics({ cell: 1.76, advanceEm: 0.6, hheaAscentEm: 1.1, hheaDescentEm: 0.4 });
const provider: MetricsProvider = (family) => (family === "Tight" ? TIGHT : family === "Loose" ? LOOSE : undefined);

const words = (text: string): Word[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ text: t, start: i, end: i + 1 }));

const BASE: LayoutStyle & { textCase: "none" } = {
  fontFamily: "Tight",
  fontWeight: 700,
  fontSize: 80,
  letterSpacing: 0,
  lineHeight: 1.2,
  align: "center",
  vAlign: "bottom",
  x: 50,
  y: 80,
  boxWidthPercent: 90,
  backgroundPaddingX: 0,
  backgroundPaddingY: 0,
  textCase: "none",
};
const CANVAS = { width: 1080, height: 1920 };

function layout(text: string, over: Partial<typeof BASE> = {}, canvas = CANVAS, p: MetricsProvider = provider) {
  const style = { ...BASE, ...over };
  const lines = buildLayoutLines(text, words(text.replace(/\n/g, " ")), { ...DEFAULT_SUBTITLE_STYLE, ...style }, canvas.height / 1920);
  const l = layoutCaption(lines, style, canvas, p);
  assert.ok(l, "layout available");
  return l;
}

test("a single short line is measured with the font's own advances", () => {
  const l = layout("hello world");
  assert.equal(l.lines.length, 1);
  const expected = textAdvance(TIGHT, "hello world", 80);
  assert.ok(Math.abs(l.lines[0].width - expected) < 1e-6, `${l.lines[0].width} vs ${expected}`);
});

test("the same text is wider in a font with wider glyphs — width follows the font, not a constant", () => {
  const tight = layout("hello world", { fontFamily: "Tight" }).lines[0].width;
  const loose = layout("hello world", { fontFamily: "Loose" }).lines[0].width;
  assert.ok(loose > tight * 1.15);
});

test("wrapping happens between words at the box width, in both fonts", () => {
  const text = "one two three four five six seven eight nine ten eleven twelve";
  for (const family of ["Tight", "Loose"]) {
    const l = layout(text, { fontFamily: family });
    assert.ok(l.lines.length > 1, `${family} wraps`);
    for (const line of l.lines) assert.ok(line.width <= l.availableWidth + 0.5, `${family}: line ${line.width} fits ${l.availableWidth}`);
    assert.equal(l.lines.flatMap((x) => x.words).length, 12, "no word lost or duplicated");
  }
});

test("a narrower box wraps into more lines; a wider box into fewer", () => {
  const text = "the quick brown fox jumps over the lazy dog again and again";
  const narrow = layout(text, { boxWidthPercent: 40 }).lines.length;
  const mid = layout(text, { boxWidthPercent: 70 }).lines.length;
  const wide = layout(text, { boxWidthPercent: 100 }).lines.length;
  assert.ok(narrow > mid && mid >= wide);
});

test("padding reduces the wrap width the same way the preview's CSS padding does", () => {
  const a = layout("a", { boxWidthPercent: 50, backgroundPaddingX: 0 });
  const b = layout("a", { boxWidthPercent: 50, backgroundPaddingX: 100 });
  assert.ok(Math.abs(a.availableWidth - b.availableWidth - 200) < 1e-6, "2 × 100px padding at scale 1");
});

test("explicit line breaks are preserved even when the text would fit on one line", () => {
  const l = layout("hi\nthere\nfriend");
  assert.equal(l.lines.length, 3);
  assert.deepEqual(
    l.lines.map((x) => x.words.map((w) => w.index)),
    [[0], [1], [2]],
  );
});

test("an explicit line that is too long still wraps, and the next explicit line stays separate", () => {
  const long = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi";
  const l = layout(`${long}\nend`, { boxWidthPercent: 50 });
  assert.ok(l.lines.length >= 3);
  const last = l.lines[l.lines.length - 1];
  assert.deepEqual(last.words.map((w) => w.index), [16], "'end' is alone on its own line");
});

test("line pitch is lineHeight × em for a uniform caption", () => {
  const l = layout("a\nb\nc", { lineHeight: 1.5 });
  assert.ok(Math.abs(l.lines[1].baseline - l.lines[0].baseline - 1.5 * 80) < 1e-6);
  assert.ok(Math.abs(l.lines[2].baseline - l.lines[1].baseline - 1.5 * 80) < 1e-6);
});

test("the baseline sits inside the line box where CSS half-leading puts it (hhea metrics)", () => {
  const l = layout("a", { lineHeight: 1.2 });
  const c = cssContentMetrics(TIGHT);
  const above = (1.2 * 80 - (c.ascent + c.descent) * 80) / 2 + c.ascent * 80;
  assert.ok(Math.abs(l.lines[0].baseline - l.lines[0].top - above) < 1e-6);
  assert.ok(Math.abs(l.lines[0].height - 1.2 * 80) < 1e-6);
});

test("the block's height follows the caption's own line-height, independent of the font's libass cell", () => {
  const tight = layout("a\nb", { fontFamily: "Tight" }).block.height;
  const loose = layout("a\nb", { fontFamily: "Loose" }).block.height;
  assert.ok(Math.abs(tight - loose) < 1e-6, "2 × 1.2 × 80 for both");
});

test("center / left / right alignment anchor the block and each line at x%", () => {
  const x = (50 / 100) * CANVAS.width;
  const c = layout("hello world and more", { align: "center", boxWidthPercent: 100 });
  assert.ok(Math.abs(c.block.left + c.block.width / 2 - x) < 1e-6);
  const left = layout("hello world and more", { align: "left", x: 10 });
  assert.ok(Math.abs(left.block.left - 0.1 * CANVAS.width) < 1e-6);
  assert.ok(Math.abs(left.lines[0].left - 0.1 * CANVAS.width) < 1e-6);
  const right = layout("hello world and more", { align: "right", x: 90 });
  assert.ok(Math.abs(right.block.left + right.block.width - 0.9 * CANVAS.width) < 1e-6);
  assert.ok(Math.abs(right.lines[0].right - 0.9 * CANVAS.width) < 1e-6);
});

test("in a centred multiline caption every line is centred on the anchor", () => {
  const l = layout("short\na much longer second line");
  const cx = 540;
  for (const line of l.lines) assert.ok(Math.abs((line.left + line.right) / 2 - cx) < 1e-6);
});

test("custom position: vAlign top / center / bottom place the block at y% of the canvas", () => {
  const y = 0.3 * CANVAS.height;
  const top = layout("a\nb", { vAlign: "top", y: 30 }).block;
  assert.ok(Math.abs(top.top - y) < 1e-6);
  const mid = layout("a\nb", { vAlign: "center", y: 30 }).block;
  assert.ok(Math.abs(mid.top + mid.height / 2 - y) < 1e-6);
  const bottom = layout("a\nb", { vAlign: "bottom", y: 30 }).block;
  assert.ok(Math.abs(bottom.top + bottom.height - y) < 1e-6);
});

test("block width = widest line + padding; block height = lines + padding", () => {
  const l = layout("a\nbbbb", { backgroundPaddingX: 30, backgroundPaddingY: 20 });
  const s = CANVAS.height / 1920;
  assert.ok(Math.abs(l.block.width - (l.lines[1].width + 60 * s)) < 1e-6);
  assert.ok(Math.abs(l.block.height - (l.lines[0].height + l.lines[1].height + 40 * s)) < 1e-6);
});

test("a manual per-word font size grows that word's width, its line box and the block", () => {
  const text = "big small";
  const plain = layout(text);
  const style = { ...BASE };
  const ws = words(text);
  ws[0] = { ...ws[0], style: { fontSize: 160 } };
  const lines = buildLayoutLines(text, ws, { ...DEFAULT_SUBTITLE_STYLE, ...style }, 1);
  const grown = layoutCaption(lines, style, CANVAS, provider)!;
  assert.ok(grown.lines[0].width > plain.lines[0].width);
  assert.ok(grown.lines[0].height > plain.lines[0].height);
  assert.equal(grown.lines[0].words[0].emPx, 160);
});

test("letter spacing widens every word, including a per-word override", () => {
  const base = layout("hello world").lines[0].width;
  const spaced = layout("hello world", { letterSpacing: 4 }).lines[0].width;
  assert.ok(Math.abs(spaced - base - 11 * 4) < 1e-6, "11 characters × 4px");
});

test("layout is scale-invariant: the same caption on a half-size canvas has exactly half the geometry", () => {
  const full = layout("one two three four five six seven eight nine ten", {}, { width: 1080, height: 1920 });
  const half = layout("one two three four five six seven eight nine ten", {}, { width: 540, height: 960 });
  assert.equal(full.lines.length, half.lines.length, "same line breaks at every export size");
  assert.ok(Math.abs(full.block.width - 2 * half.block.width) < 1e-6);
  assert.ok(Math.abs(full.block.height - 2 * half.block.height) < 1e-6);
  assert.ok(Math.abs(full.lines[0].baseline - 2 * half.lines[0].baseline) < 1e-6);
});

test("placed words: ordered, inside their line, and the chip's right edge includes the trailing space", () => {
  const l = layout("alpha beta gamma");
  const w = l.lines[0].words;
  for (let i = 1; i < w.length; i++) assert.ok(w[i].left >= w[i - 1].right);
  assert.ok(w[0].boxRight > w[0].right, "non-final word carries its trailing space");
  assert.equal(w[2].boxRight, w[2].right, "the last word has none");
  assert.ok(Math.abs(w[0].assDescentPx - 0.25 * 80) < 1e-6, "descent uses the libass (win) descent");
});

test("a missing font gives null so callers can use the legacy path; a missing fallback face borrows the strut's", () => {
  const style = { ...BASE, fontFamily: "Nope" };
  const lines = buildLayoutLines("a b", words("a b"), { ...DEFAULT_SUBTITLE_STYLE, ...style }, 1);
  assert.equal(layoutCaption(lines, style, CANVAS, provider), null);
  const ok = buildLayoutLines("a b", words("a b"), { ...DEFAULT_SUBTITLE_STYLE, ...BASE }, 1);
  const only: MetricsProvider = (f, w) => (f === "Tight" && w === 700 ? TIGHT : undefined);
  assert.ok(layoutCaption(ok, BASE, CANVAS, only));
});

test("layoutFontsNeeded lists the strut face and every word face once", () => {
  const ws = words("a b");
  ws[1] = { ...ws[1], style: { fontWeight: 400 } };
  const lines = buildLayoutLines("a b", ws, { ...DEFAULT_SUBTITLE_STYLE, ...BASE }, 1);
  assert.deepEqual(
    layoutFontsNeeded(lines, BASE).map((f) => `${f.family}|${f.weight}`).sort(),
    ["Tight|400", "Tight|700"],
  );
});

test("the layout is deterministic and does not mutate its inputs", () => {
  const style = { ...BASE };
  const frozen = JSON.stringify(style);
  const lines = buildLayoutLines("a b c", words("a b c"), { ...DEFAULT_SUBTITLE_STYLE, ...style }, 1);
  const a = layoutCaption(lines, style, CANVAS, provider);
  const b = layoutCaption(lines, style, CANVAS, provider);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(style), frozen);
});
