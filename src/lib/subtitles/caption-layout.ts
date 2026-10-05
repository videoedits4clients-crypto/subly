import type { SubtitleStyle, Word } from "../../types/subtitle.ts";
import { applyWordTextCase } from "../../types/subtitle.ts";
import { cssContentMetrics, textAdvance, type FontMetricsData } from "../fonts/font-metrics.ts";
import { detectScript, SCRIPT_FALLBACK_FONTS, scriptFallbackWeight } from "./script-detect.ts";
import { groupWordsIntoLines } from "./word-lines.ts";

/**
 * The caption's visible GEOMETRY as the editor preview lays it out — one pure model shared by the
 * preview (which renders exactly these line breaks) and the ASS export (which places exactly these
 * lines), so the two can never wrap or space text differently.
 *
 * Why not just let each renderer do its own layout: they don't agree. The preview wraps at the box
 * width and spaces lines by `lineHeight × em`; libass never wraps (WrapStyle 2), spaces lines by the
 * font's whole Windows cell (1.2–1.8 em) and ignores `lineHeight`. Rather than approximate the
 * browser, the export now emits one event per line at positions computed here, from the font's own
 * metrics — see font-metrics.ts for the em/cell relationship.
 *
 * The model reproduces the browser's CSS box layout (all validated against the real editor DOM):
 *   - a word is an inline-block run whose width is its summed advances at its own em; every word but
 *     the last of a line carries a trailing space in the same run;
 *   - a line box is the tallest strut/run above and below the baseline, where a run of em E and
 *     line-height L has half-leading (L·E − (A+D)·E)/2 around its hhea/typo content area;
 *   - the caption block = the lines + the style's padding, anchored at (x%, y%) by align / vAlign
 *     exactly as styleToContainerCss positions the container.
 * All numbers are px in the canvas the layout is computed for (preview canvas or export PlayRes).
 */

export interface LayoutWord {
  /** Index among the caption's visible (non-removed) words. */
  index: number;
  /** Text as displayed (text case already applied). */
  text: string;
  fontFamily: string;
  fontWeight: number;
  /** Run em as a multiple of the caption's base em (a manual word font size). */
  emScale: number;
  /** Letter spacing of this run in px. */
  letterSpacingPx: number;
}

export type MetricsProvider = (family: string, weight: number) => FontMetricsData | undefined;

export interface LayoutStyle {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  align: "left" | "center" | "right";
  vAlign: "top" | "center" | "bottom";
  x: number;
  y: number;
  boxWidthPercent: number;
  backgroundPaddingX: number;
  backgroundPaddingY: number;
}

export interface PlacedWord {
  index: number;
  /** Visible extent of the word's glyphs (excludes its trailing space). */
  left: number;
  right: number;
  emPx: number;
  /** Descent below the baseline of this run's own em (winDescent-based, what libass uses). */
  assDescentPx: number;
  /** Right edge of the word's inline box, trailing space included (what the preview's highlight chip wraps). */
  boxRight: number;
  /** Distance from the run's own line box top to its baseline, and that box's height (lineHeight × em). */
  runAbove: number;
  runHeight: number;
}

export interface LayoutLine {
  words: PlacedWord[];
  width: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  baseline: number;
  /** x of the alignment anchor for this line (centre / left edge / right edge of the text). */
  anchorX: number;
}

export interface CaptionLayout {
  lines: LayoutLine[];
  block: { left: number; top: number; width: number; height: number };
  scale: number;
  padX: number;
  padY: number;
  /** px width available to text inside the box (wrap limit). */
  availableWidth: number;
}

/** Explicit lines of a caption as LayoutWords — the same line grouping the preview and export use. */
export function buildLayoutLines(text: string, visibleWords: Word[], style: LayoutStyle & { textCase: SubtitleStyle["textCase"] }, scale: number): LayoutWord[][] {
  return groupWordsIntoLines(text, visibleWords).map((line) =>
    line.map(({ word, index }) => {
      const script = detectScript(word.text);
      const fallback = script !== "latin";
      const weight = word.style?.fontWeight ?? (fallback ? scriptFallbackWeight(style.fontFamily, style.fontWeight) : style.fontWeight);
      return {
        index,
        text: applyWordTextCase(word.text, style.textCase, index),
        fontFamily: fallback ? SCRIPT_FALLBACK_FONTS[script].name : style.fontFamily,
        fontWeight: weight,
        emScale: word.style?.fontSize ? word.style.fontSize / style.fontSize : 1,
        letterSpacingPx: (word.style?.letterSpacing ?? style.letterSpacing) * scale,
      };
    }),
  );
}

/** Every (family, weight) a set of layout words needs measured, plus the strut's own face. */
export function layoutFontsNeeded(lines: LayoutWord[][], style: Pick<LayoutStyle, "fontFamily" | "fontWeight">): { family: string; weight: number }[] {
  const seen = new Map<string, { family: string; weight: number }>();
  const add = (family: string, weight: number) => seen.set(`${family}|${weight}`, { family, weight });
  add(style.fontFamily, style.fontWeight);
  for (const line of lines) for (const w of line) add(w.fontFamily, w.fontWeight);
  return [...seen.values()];
}

interface Run {
  word: LayoutWord;
  metrics: FontMetricsData;
  emPx: number;
  /** advance incl. the trailing space, and without it */
  withSpace: number;
  bare: number;
}

/**
 * Lays the caption out. `canvas` is the pixel canvas the numbers are for (preview canvas size or the
 * export's PlayRes); every style length is authored against REFERENCE_HEIGHT (1920), hence `scale`.
 * Returns null if a needed font's metrics are unavailable (callers fall back to the legacy path).
 */
export function layoutCaption(
  explicitLines: LayoutWord[][],
  style: LayoutStyle,
  canvas: { width: number; height: number },
  metrics: MetricsProvider,
): CaptionLayout | null {
  const scale = canvas.height / 1920;
  const baseEm = style.fontSize * scale;
  const padX = style.backgroundPaddingX * scale;
  const padY = style.backgroundPaddingY * scale;
  const containerWidth = (style.boxWidthPercent / 100) * canvas.width;
  const availableWidth = Math.max(0, containerWidth - 2 * padX);

  const strutMetrics = metrics(style.fontFamily, style.fontWeight);
  if (!strutMetrics) return null;
  // a fallback / odd-weight face whose metrics couldn't be loaded is measured with the caption's own
  const metricsOrStrut = (family: string, weight: number): FontMetricsData => metrics(family, weight) ?? strutMetrics;
  const strut = cssContentMetrics(strutMetrics);
  const strutAbove = (style.lineHeight * baseEm - (strut.ascent + strut.descent) * baseEm) / 2 + strut.ascent * baseEm;
  const strutBelow = style.lineHeight * baseEm - strutAbove;

  // measure every word once
  const measured: Run[][] = [];
  for (const line of explicitLines) {
    const runs: Run[] = [];
    for (let i = 0; i < line.length; i++) {
      const word = line[i];
      const m = metricsOrStrut(word.fontFamily, word.fontWeight);
      const emPx = baseEm * word.emScale;
      const bare = textAdvance(m, word.text, emPx, word.letterSpacingPx);
      const withSpace = textAdvance(m, `${word.text} `, emPx, word.letterSpacingPx);
      runs.push({ word, metrics: m, emPx, withSpace, bare });
    }
    measured.push(runs);
  }

  // greedy wrap of each explicit line at the available width (the browser wraps between words only)
  const visual: Run[][] = [];
  for (const runs of measured) {
    let current: Run[] = [];
    let used = 0;
    runs.forEach((run, i) => {
      const isLastOfExplicit = i === runs.length - 1;
      const w = isLastOfExplicit ? run.bare : run.withSpace;
      if (current.length > 0 && used + w > availableWidth + 0.01) {
        visual.push(current);
        current = [];
        used = 0;
      }
      current.push(run);
      used += w;
    });
    visual.push(current);
  }

  // line boxes
  const sizedLines = visual.map((runs) => {
    let above = strutAbove;
    let below = strutBelow;
    for (const r of runs) {
      const c = cssContentMetrics(r.metrics);
      const runAbove = (style.lineHeight * r.emPx - (c.ascent + c.descent) * r.emPx) / 2 + c.ascent * r.emPx;
      above = Math.max(above, runAbove);
      below = Math.max(below, style.lineHeight * r.emPx - runAbove);
    }
    // visible text: every word but the line's last carries its trailing space
    const widths = runs.map((r, i) => (i === runs.length - 1 ? r.bare : r.withSpace));
    return { runs, above, below, height: above + below, width: widths.reduce((a, b) => a + b, 0), widths };
  });

  const textWidth = sizedLines.reduce((m, l) => Math.max(m, l.width), 0);
  const blockWidth = textWidth + 2 * padX;
  const blockHeight = sizedLines.reduce((s, l) => s + l.height, 0) + 2 * padY;
  const anchorX = (style.x / 100) * canvas.width;
  const anchorY = (style.y / 100) * canvas.height;
  const blockLeft = style.align === "left" ? anchorX : style.align === "right" ? anchorX - blockWidth : anchorX - blockWidth / 2;
  const blockTop = style.vAlign === "top" ? anchorY : style.vAlign === "bottom" ? anchorY - blockHeight : anchorY - blockHeight / 2;

  const lines: LayoutLine[] = [];
  let cursorY = blockTop + padY;
  for (const l of sizedLines) {
    const lineAnchorX = style.align === "left" ? blockLeft + padX : style.align === "right" ? blockLeft + blockWidth - padX : blockLeft + blockWidth / 2;
    const left = style.align === "left" ? lineAnchorX : style.align === "right" ? lineAnchorX - l.width : lineAnchorX - l.width / 2;
    let x = left;
    const words: PlacedWord[] = l.runs.map((r, i) => {
      const c = cssContentMetrics(r.metrics);
      const runHeight = style.lineHeight * r.emPx;
      const placed: PlacedWord = {
        index: r.word.index,
        left: x,
        right: x + r.bare,
        emPx: r.emPx,
        assDescentPx: (r.metrics.winDescent / r.metrics.unitsPerEm) * r.emPx,
        boxRight: x + (i === l.runs.length - 1 ? r.bare : r.withSpace),
        runAbove: (runHeight - (c.ascent + c.descent) * r.emPx) / 2 + c.ascent * r.emPx,
        runHeight,
      };
      x += l.widths[i];
      return placed;
    });
    lines.push({
      words,
      width: l.width,
      left,
      right: left + l.width,
      top: cursorY,
      bottom: cursorY + l.height,
      height: l.height,
      baseline: cursorY + l.above,
      anchorX: lineAnchorX,
    });
    cursorY += l.height;
  }

  return { lines, block: { left: blockLeft, top: blockTop, width: blockWidth, height: blockHeight }, scale, padX, padY, availableWidth };
}
