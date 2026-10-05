import type {
  AnimationConfig,
  Subtitle,
  SubtitleStyle,
  Word,
} from "../../types/subtitle.ts";
import { applyWordTextCase } from "../../types/subtitle.ts";
import { detectScript, SCRIPT_FALLBACK_FONTS, scriptFallbackWeight } from "./script-detect.ts";
import { entranceAssParts, type AssMotionParts, type BaseAlphas } from "./entrance-animation.ts";
import { animationWindows, exitAssParts, hasExit } from "./exit-animation.ts";
import { hasEntrance } from "./entrance-animation.ts";
import { groupWordsIntoLines } from "./word-lines.ts";
import { assCellRatio } from "../fonts/font-metrics.ts";
import { buildLayoutLines, layoutCaption, type CaptionLayout, type MetricsProvider } from "./caption-layout.ts";
import { resolveEffectiveWordStyleValue } from "./word-style-capabilities.ts";

/**
 * Converts our style/animation model into an ASS (Advanced SubStation Alpha)
 * subtitle file that ffmpeg/libass can burn directly into the video via the
 * `subtitles=` filter. This is the ONE place style objects get translated for
 * final export — the live browser preview reads the same SubtitleStyle /
 * AnimationConfig objects via `styleToTextCss` (src/lib/subtitles/preview-style.ts),
 * so there is a single source of truth for every numeric value (color, size,
 * position %, timing). Only the *syntax* differs between the two consumers.
 *
 * Per-subtitle style overrides (a caption with its own font/color/background,
 * distinct from the project's global style) get their OWN [V4+ Styles] entry
 * — one per distinct resolved style, deduplicated — rather than a single
 * global "Default" style. An earlier version of this file baked only
 * `globalStyle` into the ASS Style line, silently dropping every per-caption
 * override in the burned export even though the live preview honored it.
 *
 * Known fidelity gaps vs. the browser preview (libass/ASS format limits, not
 * missing effort): true blurred drop shadows and true progressive character-reveal
 * (typewriter/char-pop) are approximated with the closest ASS primitive available
 * (documented inline). Word-level color/scale highlighting, karaoke sync, fades,
 * slides and pops are rendered at full fidelity because they map onto real ASS
 * override tags. The active-word BACKGROUND CHIP ("bg-highlight") — a real
 * rectangle drawn behind the active word, not just a color change — is ALSO
 * rendered at real fidelity as of P5.1 (Task 86317), via an extra `\p`-drawing
 * Dialogue event per active-word interval (see computeActiveWordChip below); its
 * one honest approximation is that the chip's WIDTH is estimated from a
 * character-class heuristic rather than measured with a real font-metrics engine
 * (ASS script generation has no way to query libass's actual glyph widths ahead
 * of render time, and adding a font-rendering dependency — e.g. `canvas` — was
 * explicitly out of scope) — see estimateTextWidthPx's own doc comment.
 */

// Reference height our SubtitleStyle numeric fields (fontSize, letterSpacing,
// outlineWidth, etc.) are authored against — see types/subtitle.ts.
const REFERENCE_HEIGHT = 1920;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function assColorWithAlpha(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const rgb = m ? m[1] : "ffffff";
  const r = rgb.slice(0, 2);
  const g = rgb.slice(2, 4);
  const b = rgb.slice(4, 6);
  const alphaByte = Math.round((1 - clamp01(opacity)) * 255);
  return `&H${alphaByte.toString(16).padStart(2, "0")}${b}${g}${r}`.toUpperCase() + "&";
}

function assAlignment(align: SubtitleStyle["align"], vAlign: SubtitleStyle["vAlign"]): number {
  const col = align === "left" ? 1 : align === "right" ? 3 : 2;
  const row = vAlign === "top" ? 6 : vAlign === "center" ? 3 : 0;
  return row + col;
}

function msTime(sec: number): string {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function escapeAssText(text: string) {
  return text.replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

/** Resolves the font family actually used to render `text` — the caller's chosen font for Latin scripts, or a Noto Sans fallback for scripts (Devanagari, Gujarati) it has no glyphs for. */
export function resolveFontFamily(fontFamily: string, text: string): string {
  const script = detectScript(text);
  return script === "latin" ? fontFamily : SCRIPT_FALLBACK_FONTS[script].name;
}

/**
 * A "glow" is a large, centred, blurred shadow (Neon, Cinematic Glow, Gradient Glow, Soft Shadow,
 * Cinematic): blur ≥ 18px at the 1920-tall reference and at most a few px of offset, on a caption
 * with no background box. ASS has no blurred shadow — the Style line's `Shadow` is a HARD offset
 * copy, so these used to export as a doubled, ghosted second image of the text (confirmed with real
 * frames) instead of the soft halo the preview draws. Glow captions are therefore rendered as TWO
 * layers: a Layer-0 underlay in the shadow colour with libass's `\blur`, under the crisp Layer-1
 * text. Every other shadow keeps the existing hard-offset rendering untouched.
 */
export function isGlowStyle(style: SubtitleStyle): boolean {
  return (
    style.shadowEnabled &&
    style.backgroundOpacity <= 0 &&
    style.shadowBlur >= 18 &&
    Math.abs(style.shadowOffsetX) + Math.abs(style.shadowOffsetY) <= 4
  );
}

/** The underlay Style line for a glow caption: same font/size/spacing/alignment as the text style,
 * but filled in the shadow colour (at the shadow's opacity), with no outline and no shadow. */
function buildGlowStyleLine(name: string, glowName: string, style: SubtitleStyle, effectiveFontFamily: string, scale: number, cellRatio?: number): string {
  const fields = buildStyleLine(name, { ...style, shadowEnabled: false, outlineEnabled: false }, effectiveFontFamily, scale, cellRatio).split(",");
  const glow = assColorWithAlpha(style.shadowColor, style.shadowOpacity);
  fields[0] = `Style: ${glowName}`;
  fields[3] = glow; // PrimaryColour
  fields[4] = glow; // SecondaryColour
  fields[5] = glow; // OutlineColour
  fields[6] = "&HFF000000&"; // BackColour
  fields[16] = "0"; // Outline
  return fields.join(",");
}

/**
 * Builds one [V4+ Styles] line for a resolved SubtitleStyle + effective font, at a given render scale.
 *
 * `cellRatio` switches on the P20.4 geometry mode (see font-metrics.ts): the style's logical size is an
 * EM, and ASS `Fontsize` is the font's Windows cell height, so Fontsize = em × (winAscent + winDescent) /
 * unitsPerEm. In that mode the caption's background is drawn as its own shape (rounded, one rectangle for
 * the whole block) instead of an ASS BorderStyle-3 box, and the text outline is exactly the style's.
 */
function buildStyleLine(name: string, style: SubtitleStyle, effectiveFontFamily: string, scale: number, cellRatio?: number): string {
  const geo = cellRatio !== undefined;
  const fontSize = geo ? Number((style.fontSize * scale * cellRatio).toFixed(2)) : Math.round(style.fontSize * scale);
  const spacing = geo ? Number((style.letterSpacing * scale).toFixed(2)) : Math.round(style.letterSpacing * scale);
  const outlineW = style.outlineEnabled ? Math.max(1, Math.round(style.outlineWidth * scale)) : 0;
  const shadowDist = style.shadowEnabled && !isGlowStyle(style)
    ? Math.max(1, Math.round(((style.shadowBlur + Math.abs(style.shadowOffsetX) + Math.abs(style.shadowOffsetY)) / 3) * scale))
    : 0;

  const primary = assColorWithAlpha(style.color, style.opacity);
  const hasBox = !geo && style.backgroundOpacity > 0;
  // BorderStyle 3 (opaque box): libass draws the BOX in OutlineColour and the box's offset shadow
  // in BackColour. The box colour used to be put in BackColour (and the text outline colour in
  // OutlineColour), so every non-black background rendered as a BLACK box with a thin sliver of
  // the real colour peeking out as a "shadow" — confirmed with real FFmpeg frames of News (red bar),
  // Retro (orange) and Sticker (yellow). The preview draws no box shadow, so BackColour is made fully
  // transparent here.
  const back = hasBox
    ? "&HFF000000&"
    : style.shadowEnabled
      ? assColorWithAlpha(style.shadowColor, style.shadowOpacity)
      : "&HFF000000&";
  const outline = hasBox ? assColorWithAlpha(style.backgroundColor, style.backgroundOpacity) : assColorWithAlpha(style.outlineColor, 1);

  const borderStyle = hasBox ? 3 : 1;
  const outlineValue = hasBox
    ? Math.max(2, Math.round(((style.backgroundPaddingX + style.backgroundPaddingY) / 2) * scale))
    : geo
      ? outlineW // exactly the style's outline — none when it is disabled
      : outlineW || 1;

  const alignment = assAlignment(style.align, style.vAlign);
  const marginV = Math.round((Math.abs(50 - style.y) / 100) * REFERENCE_HEIGHT * scale) + 20;

  return [
    `Style: ${name}`,
    effectiveFontFamily,
    fontSize,
    primary,
    primary,
    outline,
    back,
    style.fontWeight >= 700 ? -1 : 0, // Bold
    0, // Italic
    0, // Underline
    0, // StrikeOut
    100,
    100,
    spacing,
    0,
    borderStyle,
    outlineValue,
    shadowDist,
    alignment,
    40,
    40,
    marginV,
    1,
  ].join(",");
}

function clamp01v(n: number) {
  return Math.max(0.05, Math.min(2, n));
}

function wordOverride(style: SubtitleStyle, anim: AnimationConfig): string {
  const scalePct = Math.round(style.activeWordScale * 100);
  const highlightColor = assColorWithAlpha(style.highlightColor, style.opacity);
  switch (anim.word) {
    case "none":
      return "";
    case "highlight":
    case "color":
      return `\\c${highlightColor}`;
    // "bg-highlight" no longer tints the word's own text color — matching the live preview
    // exactly (activeWordCss's bg-highlight case keeps `color: style.color` unchanged; only the
    // background changes). The actual background chip is a separate Dialogue event emitted
    // alongside this text event — see computeActiveWordChip / buildAssDocument's events loop.
    case "bg-highlight":
      return "";
    case "scale":
      return `\\c${highlightColor}\\fscx${scalePct}\\fscy${scalePct}`;
    case "bounce":
      return `\\c${highlightColor}\\fscx${scalePct}\\fscy${scalePct}`;
    case "underline":
      return `\\c${highlightColor}\\u1`;
    default:
      return "";
  }
}

/** Override tags for a word's own manual style (independent of the active-word highlight animation) — color, a relative font-size scale, and (P19.8) an absolute `\fsp` letter-spacing override. ASS has no per-run background box, so a word-level background override isn't representable here (full fidelity in the live preview only).
 *
 * `\fsp` takes an absolute pixel value at the current PlayRes (unlike `\fscx`/`\fscy`, which are
 * relative percentages) — scaled by the same `scale` factor (playResY / REFERENCE_HEIGHT)
 * buildStyleLine already uses for the caption-level Style-line "Spacing" field, so a word's
 * override lands consistently with the rest of the export regardless of export resolution/quality
 * tier. `{\r}` (already emitted by renderLineText after every word with any override) resets ALL
 * override tags — including `\fsp` — back to the Style line's own defaults before the next word,
 * so a word-level override never bleeds onto a neighboring word. */
function wordStyleTag(baseStyle: SubtitleStyle, wordStyle: Partial<SubtitleStyle> | undefined, scale: number): string {
  if (!wordStyle) return "";
  let tag = "";
  if (wordStyle.color) tag += `\\c${assColorWithAlpha(wordStyle.color, wordStyle.opacity ?? baseStyle.opacity)}`;
  if (wordStyle.fontSize) {
    const pct = Math.round((wordStyle.fontSize / baseStyle.fontSize) * 100);
    tag += `\\fscx${pct}\\fscy${pct}`;
  }
  if (wordStyle.fontWeight !== undefined) tag += wordStyle.fontWeight >= 700 ? "\\b1" : "\\b0";
  if (wordStyle.letterSpacing !== undefined) tag += `\\fsp${Math.round(wordStyle.letterSpacing * scale)}`;
  return tag;
}

// ───────────────────────── Active-word background chip (P5.1, Task 86317) ─────────────────────────
// A real background rectangle drawn BEHIND the active word — matching activeWordCss's
// "bg-highlight" case in preview-style.ts (a CSS backgroundColor + boxShadow-as-padding + rounded
// corners), rather than the previous color-only ASS fallback. Implemented as an extra `\p`-drawing
// (vector shape) Dialogue event, positioned/sized to approximate where the active word's glyphs
// actually sit — the SAME existing ASS/FFmpeg pipeline `subtitles=` filter already renders, not a
// second subtitle renderer.

/** Per-character glyph width ratios (per 1000 em units — the standard AFM/PDF core-font metric
 * convention) ASS script generation can't get real glyph widths for (no font-metrics engine
 * available at generation time — see estimateTextWidthPx). A flat 4-bucket estimate (narrow/
 * wide/uppercase/default) was tried first and rejected: it accumulates enough per-character
 * error over a 4-6 word line that, under center alignment, the drift compounds word-by-word and
 * visibly displaces the chip from the real word by the time it reaches the far side of the line
 * (confirmed by an actual export — see the P5.1 report's live-QA section). This table instead
 * uses PER-LETTER widths from the Helvetica-Bold AFM metrics (public, font-agnostic reference
 * data long used for canvas-less text-width estimation) — biased toward BOLD because this app's
 * default/most-used caption weight is 600-900 (DEFAULT_SUBTITLE_STYLE.fontWeight is 800). Real
 * project fonts (Poppins, Montserrat, etc.) differ letter-by-letter from Helvetica, but a
 * per-letter table tracks their actual proportions (narrow "I"/"l", wide "M"/"W") far more
 * closely than one flat average ever could, which is what actually matters for keeping
 * cumulative drift small across a line. */
const CHAR_WIDTH_PER_1000: Record<string, number> = {
  " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238, "(": 333, ")": 333,
  "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  "{": 389, "|": 280, "}": 389, "~": 584,
};

function charWidthEm(ch: string): number {
  const perMille = CHAR_WIDTH_PER_1000[ch];
  if (perMille !== undefined) return perMille / 1000;
  // Non-Latin scripts (Devanagari, Gujarati, CJK, ...) have no metrics in this Latin-only table
  // — fall back to a representative average glyph width rather than guessing per-script tables.
  return 0.6;
}

/**
 * Per-font-family correction applied on top of CHAR_WIDTH_PER_1000's Helvetica-Bold-derived
 * baseline. That baseline alone was measured (via an isolated ffmpeg burn-in + pixel-bounding-
 * box test — see the P5.1 report's live-QA section) to overestimate real rendered width by a
 * font-specific amount: this app's actual caption fonts run measurably narrower than classic
 * print metrics, and by DIFFERENT amounts per family (Poppins-Bold's real "FOR" measured 0.50x
 * the Helvetica-Bold prediction at two different font sizes; DM Sans-Bold's "BRINGING" measured
 * 0.71x; Montserrat-Bold's "BRINGING" measured 0.66x) — not a uniform rendering-pipeline scale
 * bug (ruled out: if it were, every family would show the same ratio). Families actually
 * measured get their own factor; everything else uses the average of the three as a reasonable
 * default rather than the uncorrected (and now known-too-wide) 1.0 baseline. */
const FONT_WIDTH_CALIBRATION: Record<string, number> = {
  Poppins: 0.5,
  "DM Sans": 0.71,
  Montserrat: 0.66,
};
const DEFAULT_FONT_WIDTH_CALIBRATION = 0.62;

function fontWidthCalibration(fontFamily: string): number {
  return FONT_WIDTH_CALIBRATION[fontFamily] ?? DEFAULT_FONT_WIDTH_CALIBRATION;
}

/**
 * Estimates a run of text's rendered width in pixels at a given (already scale-adjusted)
 * fontSize — ASS script generation has no way to ask libass "how wide will this text actually
 * render", since that depends on the real font file's glyph metrics, which only libass (via
 * FreeType, at burn time) has access to. Adding a font-rendering dependency (e.g. the `canvas`
 * npm package) purely to measure text was explicitly out of scope (Task 86317's own "no
 * external dependencies" requirement) — this character table + font calibration is the smallest
 * reliable substitute, good enough for a short (1-4 word) caption's active-word chip. Verified
 * visually against real exports, not just assumed correct (see the P5.1 report's live-QA
 * section). `letterSpacingPx` is a real, explicit user-set pixel value (not a font-metric
 * estimate), so it is added after calibration rather than scaled by it.
 */
function estimateTextWidthPx(text: string, fontSizePx: number, letterSpacingPx: number, widthCalibration: number): number {
  if (!text) return 0;
  const chars = Array.from(text);
  const glyphWidth = chars.reduce((sum, ch) => sum + charWidthEm(ch) * fontSizePx, 0) * widthCalibration;
  const spacing = Math.max(0, chars.length - 1) * letterSpacingPx;
  return glyphWidth + spacing;
}

/** Groups a subtitle's (non-removed) words by display line, using the exact same word-count-
 * per-line technique joinWithOriginalLineBreaks already uses to preserve manual line breaks —
 * kept as its own small helper since the chip geometry needs each line's actual Word objects
 * (for per-word width estimates), not just the rendered strings that function works with. */
function wordsByLine(sub: Subtitle): Word[][] {
  const words = sub.words.filter((w) => !w.removed);
  return groupWordsIntoLines(sub.text, words).map((line) => line.map((l) => l.word));
}

/** A rounded-rectangle ASS `\p`-drawing path: straight edges + 4 bezier corner arcs — real ASS-
 * native rounded corners (ASS's drawing mode supports cubic beziers), not a plain rectangle
 * faking curvature. `r` is clamped to at most half of either dimension so a very short/narrow
 * word (e.g. "a") can never produce a self-intersecting or negative-radius path. Coordinates are
 * local to the drawing's own (0,0)-origin — the caller positions the shape on screen via
 * `\pos()`, not by offsetting these numbers. */
function roundedRectPath(w: number, h: number, r: number): string {
  const radius = Math.round(Math.max(0, Math.min(r, w / 2, h / 2)));
  const W = Math.round(w);
  const H = Math.round(h);
  if (radius < 1) return `m 0 0 l ${W} 0 ${W} ${H} 0 ${H} 0 0`;
  return (
    `m ${radius} 0 ` +
    `l ${W - radius} 0 ` +
    `b ${W} 0 ${W} 0 ${W} ${radius} ` +
    `l ${W} ${H - radius} ` +
    `b ${W} ${H} ${W} ${H} ${W - radius} ${H} ` +
    `l ${radius} ${H} ` +
    `b 0 ${H} 0 ${H} 0 ${H - radius} ` +
    `l 0 ${radius} ` +
    `b 0 0 0 0 ${radius} 0`
  );
}

interface ActiveWordChipGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Task 132941 (P19.9): the active word's own EFFECTIVE fontSize in PlayRes px (word-level
   * override, else the caption's) — exposed so the caller can size the chip's corner radius
   * consistently with the chip's own actual dimensions, without re-deriving this same
   * resolution/scaling logic a second time at the call site. */
  activeFontSizePx: number;
}

/**
 * Computes the active word's background-chip rectangle in absolute PlayRes pixel space (the
 * same coordinate space `\pos()` already uses elsewhere in this file). Mirrors how the caption's
 * OWN alignment/position already works (buildStyleLine's Alignment field, the events loop's
 * anchorX/anchorY) rather than inventing a separate layout model: lines stack vertically around
 * anchorY by style.vAlign (top/center/bottom), and within the active word's own line, words lay
 * out horizontally around anchorX by style.align (left/center/right) using estimateTextWidthPx
 * for each preceding word. Returns null only if the active word can't be located in any line
 * (should not happen given the caller's own filtering, but never assumed) — the caller skips
 * emitting a chip in that case rather than guessing.
 *
 * Task 132941 (P19.9): the ACTIVE word's own measurement (its width contribution to the line,
 * and the chip's height/halo) uses its EFFECTIVE fontSize/letterSpacing — a word-level override
 * if one exists, else the caption's own value, via the same generic resolveEffectiveWordStyleValue
 * helper the rest of the word-style system already uses (word-style-capabilities.ts) — not a new
 * resolution rule. Every OTHER word in the line still uses the caption-level fontSizePx/
 * letterSpacingPx, exactly as before: this task is scoped to the ACTIVE word's own chip geometry,
 * not a general per-word-aware line-layout engine. The whole line's vertical stacking
 * (lineHeightPx/lineTopY, below) also stays on the caption's own fontSizePx — a styled active
 * word makes its OWN chip bigger/smaller, it doesn't shift where the whole line sits.
 */
function computeActiveWordChip(
  sub: Subtitle,
  style: SubtitleStyle,
  activeWordIndex: number,
  fontSizePx: number,
  anchorX: number,
  anchorY: number,
): ActiveWordChipGeometry | null {
  const lines = wordsByLine(sub);
  const activeWord = sub.words[activeWordIndex];
  if (!activeWord) return null;
  const lineIndex = lines.findIndex((line) => line.includes(activeWord));
  if (lineIndex === -1) return null;
  const line = lines[lineIndex];
  const wordIndexInLine = line.indexOf(activeWord);

  // letterSpacing is authored (like fontSize) against REFERENCE_HEIGHT — scale it the same way
  // fontSizePx already was, rather than re-deriving `scale` here.
  const letterSpacingPx = style.fontSize > 0 ? style.letterSpacing * (fontSizePx / style.fontSize) : 0;
  const widthCalibration = fontWidthCalibration(style.fontFamily);
  const spaceWidthPx = charWidthEm(" ") * fontSizePx * widthCalibration;
  const visibleWords = sub.words.filter((w) => !w.removed);
  const displayText = (w: Word) => applyWordTextCase(w.text, style.textCase, visibleWords.indexOf(w));

  // Effective values for the active word specifically (!== undefined, never a truthy check — an
  // explicit 0 or negative letterSpacing override is valid and must not fall back to the
  // caption's value). Scaled by the exact same fontSizePx/style.fontSize ratio used for
  // letterSpacingPx just above, so no separate `scale` parameter needs to be threaded in.
  const effectiveFontSize = resolveEffectiveWordStyleValue(style, activeWord.style, "fontSize");
  const effectiveLetterSpacing = resolveEffectiveWordStyleValue(style, activeWord.style, "letterSpacing");
  const activeFontSizePx = style.fontSize > 0 ? Math.round(effectiveFontSize * (fontSizePx / style.fontSize)) : fontSizePx;
  const activeLetterSpacingPx = style.fontSize > 0 ? effectiveLetterSpacing * (fontSizePx / style.fontSize) : 0;

  const widths = line.map((w, i) =>
    i === wordIndexInLine
      ? estimateTextWidthPx(displayText(w), activeFontSizePx, activeLetterSpacingPx, widthCalibration)
      : estimateTextWidthPx(displayText(w), fontSizePx, letterSpacingPx, widthCalibration),
  );
  const lineTotalWidth = widths.reduce((a, b) => a + b, 0) + Math.max(0, line.length - 1) * spaceWidthPx;

  const lineStartX =
    style.align === "left" ? anchorX : style.align === "right" ? anchorX - lineTotalWidth : anchorX - lineTotalWidth / 2;
  const wordOffsetX = widths.slice(0, wordIndexInLine).reduce((a, b) => a + b, 0) + wordIndexInLine * spaceWidthPx;
  const wordLeft = lineStartX + wordOffsetX;
  const wordWidth = widths[wordIndexInLine];

  const lineHeightPx = fontSizePx * style.lineHeight;
  const numLines = lines.length || 1;
  const lineTopY =
    style.vAlign === "top"
      ? anchorY + lineIndex * lineHeightPx
      : style.vAlign === "bottom"
        ? anchorY - (numLines - lineIndex) * lineHeightPx
        : anchorY - (numLines * lineHeightPx) / 2 + lineIndex * lineHeightPx;

  // Same 0.15em "halo" padding and glyph-height estimate the live preview's own boxShadow-as-
  // padding trick uses (activeWordCss's bg-highlight case, preview-style.ts) — real parity with
  // a real constant already established there, not a new invented number. Task 132941 (P19.9):
  // sized from the active word's own EFFECTIVE fontSize, not the caption's — the chip's height
  // must grow/shrink with the word it's actually behind, not the caption's base size.
  const padding = 0.15 * activeFontSizePx;
  const glyphHeight = activeFontSizePx * 1.05;

  return {
    left: wordLeft - padding,
    top: lineTopY + (lineHeightPx - glyphHeight) / 2 - padding,
    width: wordWidth + padding * 2,
    height: glyphHeight + padding * 2,
    activeFontSizePx,
  };
}

interface Interval {
  start: number;
  end: number;
  activeWordIndex: number | null;
}

function buildIntervals(sub: Subtitle, extraBreakpoints: number[] = []): Interval[] {
  const words = sub.words.filter((w) => !w.removed);
  const points = new Set<number>([sub.start, sub.end]);
  // Entrance-end / exit-start: an event never straddles them, so one event never has to carry
  // both an entrance move and an exit move (libass can express only one per event).
  for (const b of extraBreakpoints) points.add(clampRange(b, sub.start, sub.end));
  for (const w of words) {
    points.add(clampRange(w.start, sub.start, sub.end));
    points.add(clampRange(w.end, sub.start, sub.end));
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const intervals: Interval[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end - start <= 0.001) continue;
    const mid = (start + end) / 2;
    const activeIdx = words.findIndex((w) => mid >= w.start && mid < w.end);
    intervals.push({ start, end, activeWordIndex: activeIdx === -1 ? null : sub.words.indexOf(words[activeIdx]) });
  }
  return intervals.length ? intervals : [{ start: sub.start, end: sub.end, activeWordIndex: null }];
}

function clampRange(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Renders one subtitle's full text with the active word (if any) wrapped in highlight override tags, and any non-Latin-script word (Devanagari, Gujarati) wrapped in its own `\fn` font override — a caption can freely mix "Today આપણે AI વિશે" and each word still gets glyphs that actually exist. */
function renderLineText(
  sub: Subtitle,
  style: SubtitleStyle,
  anim: AnimationConfig,
  activeWordIndex: number | null,
  scale: number,
  entranceLineTags: (mult: number) => string = () => "",
  wordRampMs = 0,
): string {
  const words = sub.words.filter((w) => !w.removed);
  const rendered = renderWordRuns(sub, style, anim, activeWordIndex, scale, entranceLineTags, wordRampMs);
  // Preserve original line breaks by re-wrapping using the subtitle's stored
  // text line lengths proportionally — simplest robust approach: reuse the
  // already-computed \n positions from sub.text by matching word counts.
  return joinWithOriginalLineBreaks(
    sub.text,
    rendered,
    words.map((w) => w.text),
    "\\N",
  );
}

/**
 * One ASS text run per VISIBLE word (override blocks included), index-aligned with the caption's non-removed
 * words. `fallbackFontSize` (geometry mode) returns the `\fs` a script-fallback word needs so its em matches the
 * caption's — a fallback face has its own Windows cell, so the style's Fontsize would size it wrongly.
 */
function renderWordRuns(
  sub: Subtitle,
  style: SubtitleStyle,
  anim: AnimationConfig,
  activeWordIndex: number | null,
  scale: number,
  entranceLineTags: (mult: number) => string = () => "",
  wordRampMs = 0,
  fallbackFontSize?: (family: string, bold: boolean) => number | undefined,
): string[] {
  const words = sub.words.filter((w) => !w.removed);
  return words.map((w, wordIndex) => {
    const text = applyWordTextCase(w.text, style.textCase, wordIndex);
    const isActive = style.wordHighlight && sub.words.indexOf(w) === activeWordIndex;
    const scalesWhenActive = isActive && (anim.word === "scale" || anim.word === "bounce");
    let activeOv = isActive ? wordOverride(style, anim) : "";
    const manualOv = wordStyleTag(style, w.style, scale);
    // Active-word scale/bounce eases in (bounce overshoots first) instead of snapping, matching
    // the preview's CSS transition on the active word. Skipped when the word has a manual
    // font-size override (which wins over it anyway) or an entrance is still running.
    if (scalesWhenActive && wordRampMs > 0 && !w.style?.fontSize) {
      const target = Math.round(style.activeWordScale * 100);
      const color = `\\c${assColorWithAlpha(style.highlightColor, style.opacity)}`;
      const to = (pct: number) => `\\fscx${pct}\\fscy${pct}`;
      if (anim.word === "bounce") {
        const peak = Math.round(100 + (target - 100) * 1.5);
        const mid = Math.round(wordRampMs * 0.55);
        activeOv = `${color}${to(100)}\\t(0,${mid},${to(peak)})\\t(${mid},${wordRampMs},${to(target)})`;
      } else {
        activeOv = `${color}${to(100)}\\t(0,${wordRampMs},${to(target)})`;
      }
    }
    // A word with its own scale (active-word scale / manual font size) animates the entrance
    // relative to that scale — see EntranceAssParts.lineTags.
    const ownScale = w.style?.fontSize ? w.style.fontSize / style.fontSize : scalesWhenActive ? style.activeWordScale : 1;
    const entranceOv = entranceLineTags(ownScale);
    const wordFont = resolveFontFamily(style.fontFamily, w.text);
    // A script-fallback word (Devanagari/Gujarati) in a heavy single-weight display face is bolded, so it
    // doesn't render hairline next to the Latin capitals (see scriptFallbackWeight).
    const fallbackBold = wordFont !== style.fontFamily && style.fontWeight < 700 && scriptFallbackWeight(style.fontFamily, style.fontWeight) >= 700 ? "\\b1" : "";
    const isFallback = wordFont !== style.fontFamily;
    const fallbackFs = isFallback ? fallbackFontSize?.(wordFont, style.fontWeight >= 700 || fallbackBold !== "") : undefined;
    const fontOv = isFallback ? `\\fn${wordFont}${fallbackBold}${fallbackFs !== undefined ? `\\fs${Number(fallbackFs.toFixed(2))}` : ""}` : "";
    if (activeOv || manualOv || fontOv || (entranceOv && ownScale !== 1)) {
      // Font override goes first so a highlight/manual color still applies on
      // top of it; manual overrides are last so a word's own explicit style
      // wins over the automatic highlight for any property both define. The entrance tags
      // come after those, and `{\r}` re-applies them for the REST of the line — a bare `\r`
      // used to reset the line-level pop/bounce scale after the first overridden word, so only
      // that one word animated.
      return `{${fontOv}${activeOv}${manualOv}${entranceOv}}${escapeAssText(text)}{\\r${entranceLineTags(1)}}`;
    }
    return escapeAssText(text);
  });
}

/**
 * Reassembles a flat per-WORD-OBJECT array (`renderedWords`) back into the line-break structure
 * of `originalText`, joining lines with `lineBreak` (ASS's "\\N" here; plain "\n" for general use
 * — see lib/subtitles/output-mode.ts, which uses the same alignment to rebuild a caption's
 * whole-line Hinglish/Gujarati text from per-word derived tokens).
 *
 * `sourceTexts[i]` is word object `i`'s own RAW (untransformed) `.text` — used ONLY to count how
 * many whitespace-separated TOKENS that one word object represents in `originalText`. This exists
 * because a single word object does not always correspond to exactly one token: `mergeWords`
 * (word-edit.ts) can produce one word object whose own `.text` contains a space (e.g. "hello
 * world"), while `renderedWords` still has exactly one array entry for it. Task 137421 (P19.12)
 * fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md §6 (B2): the previous
 * version counted tokens directly from `originalText`'s own per-line text (`l.split(/\s+/).length`)
 * and sliced `renderedWords` by that count — correct only when every word object is exactly one
 * token, and silently wrong (borrowing entries from the next line) once any word object spans more
 * than one. This version instead walks `renderedWords`/`sourceTexts` ONE WORD OBJECT AT A TIME,
 * accumulating each one's own token width, until a line's own token target is met or exceeded — a
 * merged multi-token word object is therefore always assigned to exactly one line, atomically
 * (never split across two, even if doing so makes that line's token count exceed the original
 * per-line target by the merged word's own extra tokens) — see
 * src/lib/subtitles/__tests__/merged-word-line-reconstruction.test.ts for the exact worked
 * example this fixes.
 */
export function joinWithOriginalLineBreaks(originalText: string, renderedWords: string[], sourceTexts: string[], lineBreak = "\n"): string {
  const lines = originalText.split("\n");
  const tokensPerLine = lines.map((l) => l.split(/\s+/).filter(Boolean).length);
  const out: string[] = [];
  let cursor = 0;
  for (const targetTokens of tokensPerLine) {
    const startCursor = cursor;
    let consumed = 0;
    while (cursor < sourceTexts.length && consumed < targetTokens) {
      consumed += Math.max(1, sourceTexts[cursor].split(/\s+/).filter(Boolean).length);
      cursor++;
    }
    out.push(renderedWords.slice(startCursor, cursor).join(" "));
  }
  if (cursor < renderedWords.length) {
    // Defensive only — should not happen in practice, since originalText's own total token count
    // is always derived from the SAME word texts (see editor-store.ts's caption-text rebuilds).
    // If it ever does (e.g. stale/hand-edited data), append the leftover to the last line rather
    // than silently dropping words.
    out[out.length - 1] = [out[out.length - 1], ...renderedWords.slice(cursor)].filter(Boolean).join(" ");
  }
  return out.join(lineBreak);
}

/** The ASS alpha bytes buildStyleLine encodes for a style's primary / outline / back colours. */
function baseAlphas(style: SubtitleStyle): BaseAlphas {
  const alphaByte = (opacity: number) => Math.round((1 - clamp01(opacity)) * 255);
  const hasBox = style.backgroundOpacity > 0;
  return {
    a1: alphaByte(style.opacity),
    a3: 0,
    a4: hasBox ? alphaByte(style.backgroundOpacity) : style.shadowEnabled ? alphaByte(style.shadowOpacity) : 255,
  };
}

export interface AssBuildOptions {
  subtitles: Subtitle[];
  globalStyle: SubtitleStyle;
  globalAnimation: AnimationConfig;
  /** Output canvas pixel size — the ASS `PlayResX`/`PlayResY` document maps 1:1 onto. The
   * caller derives this from the project's own composition canvas scaled by the chosen
   * export-quality tier (see lib/ffmpeg/index.ts computeExportDimensions and
   * lib/export-pipeline.ts) — the SAME numbers in both the video-on and video-off branches,
   * so captions land identically regardless of which one actually renders. buildAssDocument
   * itself has no opinion on where these numbers come from. */
  playResX: number;
  playResY: number;
  /**
   * Font metrics provider (P20.4). When it can supply a style's font, that style is rendered in GEOMETRY
   * MODE: ASS Fontsize is converted from the logical em with the font's own Windows cell
   * (see lib/fonts/font-metrics.ts), and each caption is emitted as one event PER LINE at the baseline
   * positions of the shared preview layout (lib/subtitles/caption-layout.ts) — same line breaks, same
   * lineHeight, same box — with the background and active-word chip drawn as shapes. Without metrics
   * (tests, tools) the legacy single-event rendering is used unchanged.
   */
  fontMetrics?: MetricsProvider;
}

export function buildAssDocument({ subtitles, globalStyle, globalAnimation, playResX, playResY, fontMetrics }: AssBuildOptions): string {
  const scale = playResY / REFERENCE_HEIGHT;
  const geoStyleNames = new Set<string>();

  // Dedup: many captions typically share the exact same resolved style, so we
  // only ever emit as many [V4+ Styles] lines as there are DISTINCT looks.
  const styleLines: string[] = [];
  const styleNameBySignature = new Map<string, string>();
  const styleNameBySubtitleId = new Map<string, string>();

  for (const sub of subtitles) {
    const resolved = { ...globalStyle, ...(sub.style ?? {}) };
    // The Style line always carries the user's chosen font — a mixed-script
    // caption gets per-word `\fn` overrides in renderLineText instead, so a
    // single caption can freely mix scripts without the whole line being
    // forced onto whichever script's regex happened to match first.
    const baseMetrics = fontMetrics?.(resolved.fontFamily, resolved.fontWeight);
    const cellRatio = baseMetrics ? assCellRatio(baseMetrics) : undefined;
    const signature = JSON.stringify(resolved) + (cellRatio !== undefined ? "|geo" : "");

    let name = styleNameBySignature.get(signature);
    if (!name) {
      name = `S${styleNameBySignature.size}`;
      styleNameBySignature.set(signature, name);
      styleLines.push(buildStyleLine(name, resolved, resolved.fontFamily, scale, cellRatio));
      if (isGlowStyle(resolved)) styleLines.push(buildGlowStyleLine(name, `${name}G`, resolved, resolved.fontFamily, scale, cellRatio));
      if (cellRatio !== undefined) geoStyleNames.add(name);
    }
    styleNameBySubtitleId.set(sub.id, name);
  }
  if (styleLines.length === 0) {
    styleLines.push(buildStyleLine("S0", globalStyle, globalStyle.fontFamily, scale));
  }

  // Task 134276 (P19.10) — WrapStyle 2 ("no smart wrapping — a line only breaks at an explicit
  // \N, never re-wrapped automatically"). Left unset, libass defaults to WrapStyle 0 (smart
  // auto-wrap) and will independently re-wrap an already-\N-delimited line a SECOND time
  // whenever its own real (post-\fscx/\fsp) rendered width exceeds PlayResX-MarginL-MarginR — a
  // split this app has no visibility into, since every line-relative computation here
  // (wordsByLine, computeActiveWordChip's lineHeightPx/lineTopY/numLines) is built entirely from
  // sub.text's own stored "\n" positions. That invisible-to-us extra wrap is exactly what let a
  // large word-level fontSize/letterSpacing override push an active-word chip onto the wrong
  // visual line (reproduced and documented in research/p19_10_ass_autowrap_chip_parity_report.md).
  // WrapStyle 2 makes libass defer entirely to this app's own already-decided line breaks, so the
  // chip's line math and the text's actual rendered line can never again disagree — by
  // construction, not by trying to predict libass's own wrapping algorithm. Accepted trade-off:
  // an extremely wide override can now render past its margins instead of being auto-wrapped
  // into a second line — see that report's own Limitations section.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events: string[] = [];

  for (const sub of subtitles) {
    const style = { ...globalStyle, ...(sub.style ?? {}) };
    const anim = { ...globalAnimation, ...(sub.animation ?? {}) };
    const styleName = styleNameBySubtitleId.get(sub.id) ?? "S0";
    const x = Math.round((style.x / 100) * playResX);
    const y = Math.round((style.y / 100) * playResY);

    if (fontMetrics && geoStyleNames.has(styleName)) {
      const visible = sub.words.filter((w) => !w.removed);
      const layout = layoutCaption(buildLayoutLines(sub.text, visible, style, scale), style, { width: playResX, height: playResY }, fontMetrics);
      if (layout) {
        const windowsGeo = animationWindows(sub.start, sub.end, anim);
        const geoIntervals = buildIntervals(sub, hasEntrance(anim.entrance) && hasExit(anim.exit) ? [windowsGeo.entranceEnd, windowsGeo.exitStart] : []);
        events.push(...buildGeoCaptionEvents({ sub, style, anim, styleName, layout, intervals: geoIntervals, scale, playResY, fontMetrics }));
        continue;
      }
    }

    const windows = animationWindows(sub.start, sub.end, anim);
    // Only a caption with BOTH an entrance and an exit needs the split: an event that straddles
    // just one window is handled by that window's own delay/offset, and leaving word-boundary
    // intervals untouched keeps every other caption's events (and active-word chips) as they were.
    const intervals = buildIntervals(sub, hasEntrance(anim.entrance) && hasExit(anim.exit) ? [windows.entranceEnd, windows.exitStart] : []);
    const textAlphas = baseAlphas(style);
    // The active-word chip is a primary-colour fill only (no border/shadow), at the style opacity.
    const chipAlphas: BaseAlphas = { a1: textAlphas.a1, a3: 255, a4: 255 };
    // Glow captions (see isGlowStyle) also emit a blurred underlay in the shadow colour.
    const glow = isGlowStyle(style);
    const glowAlphas: BaseAlphas = { a1: Math.round((1 - clamp01(style.shadowOpacity)) * 255), a3: 255, a4: 255 };
    const glowBlur = Math.max(1, Math.round(style.shadowBlur * scale * 0.5 * 10) / 10);

    intervals.forEach((interval) => {
      const lineDur = interval.end - interval.start;

      // Entrance and exit are disjoint windows (see animationWindows), so at most one is active on
      // any event. Each continues across EVERY interval it overlaps — see entranceAssParts /
      // exitAssParts — and owns the event's only \pos/\move (libass honours just one of the two).
      const entrance = entranceAssParts(anim, interval.start - sub.start, x, y, playResY, textAlphas);
      const exit = exitAssParts(anim, sub.start, sub.end, interval.start, interval.end, x, y, playResY, textAlphas);
      const motion: AssMotionParts = entrance.active ? entrance : exit;
      const fadeTag = motion.fadeInMs ? `\\fad(${motion.fadeInMs},0)` : "";
      const posBlock = motion.position;
      const fx = fadeTag + motion.lineTags(1);
      // Active-word scale eases in over the same window the preview's CSS transition uses —
      // skipped while an entrance/exit is running on this event (the two would fight over \fscx).
      const wordRampMs = motion.active
        ? 0
        : Math.min(Math.round(lineDur * 1000), Math.round(Math.max(0.05, clamp01v(anim.durationSec) * 0.6) * 1000));

      // Active-word background chip (bg-highlight): a Layer-0 vector-drawing Dialogue event,
      // emitted BEFORE (so it z-orders behind) this interval's Layer-1 text event — see the
      // "Active-word background chip" block above (computeActiveWordChip) for how its geometry
      // is derived. Only emitted when this interval actually has an active word and the word
      // animation is bg-highlight; every other animation/interval is unaffected.
      if (anim.word === "bg-highlight" && style.wordHighlight && interval.activeWordIndex !== null) {
        const fontSizePx = Math.round(style.fontSize * scale);
        const chip = computeActiveWordChip(sub, style, interval.activeWordIndex, fontSizePx, x, y);
        if (chip) {
          const fillColor = assColorWithAlpha(style.highlightColor, style.opacity);
          // Task 132941 (P19.9): corner radius follows the chip's own actual size (the active
          // word's effective fontSize), not the caption's base size.
          const cornerRadius = 0.25 * chip.activeFontSizePx;
          const path = roundedRectPath(chip.width, chip.height, cornerRadius);
          events.push(
            `Dialogue: 0,${msTime(interval.start)},${msTime(interval.end)},${styleName},,0,0,0,,{\\an7${motion.positionAt(chip.left, chip.top)}${motion.fadeInMs ? `\\fad(${motion.fadeInMs},0)` : ""}${motion.alpha(chipAlphas)}\\bord0\\shad0\\1c${fillColor}\\p1}${path}{\\p0}`,
          );
        }
      }

      if (glow) {
        // Same words, same layout (sizes/spacing/line breaks) and the same motion as the text, but
        // one flat colour: the per-word colour overrides are stripped, so the halo never changes
        // hue with the active word (matching the preview's constant text-shadow). The tags that
        // {\r} resets are re-applied through the lineTags closure, blur included.
        const glowTags = (mult: number) => motion.alpha(glowAlphas) + motion.scale(mult) + `\\blur${glowBlur}`;
        const glowText = renderLineText(sub, style, anim, interval.activeWordIndex, scale, glowTags, wordRampMs).replace(/\\c&H[0-9A-Fa-f]{6,8}&/g, "");
        events.push(
          `Dialogue: 0,${msTime(interval.start)},${msTime(interval.end)},${styleName}G,,0,0,0,,{${posBlock}${fadeTag}${glowTags(1)}}${glowText}`,
        );
      }

      const text = renderLineText(sub, style, anim, interval.activeWordIndex, scale, motion.lineTags, wordRampMs);
      events.push(
        `Dialogue: 1,${msTime(interval.start)},${msTime(interval.end)},${styleName},,0,0,0,,{${posBlock}${fx}}${text}`,
      );
    });
  }

  return `${header}\n${events.join("\n")}\n`;
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, "0");

/** The alpha-free `&HBBGGRR&` colour for a `\1c` tag (alpha goes in a separate `\1a`). */
function assRgb(hex: string): string {
  return assColorWithAlpha(hex, 1);
}

/**
 * Geometry-mode events for one caption (P20.4): one Dialogue per LINE of the shared preview layout, per
 * word-boundary interval, anchored by BASELINE (`pos y = baseline + the line's largest descent`, which is how
 * libass's bottom anchor works), plus the background box and the active-word chip drawn as shapes at the
 * layout's coordinates. Everything the legacy path animates (entrance/exit motion, fades, scale, glow
 * underlay, per-word overrides) goes through the same helpers.
 */
function buildGeoCaptionEvents(a: {
  sub: Subtitle;
  style: SubtitleStyle;
  anim: AnimationConfig;
  styleName: string;
  layout: CaptionLayout;
  intervals: Interval[];
  scale: number;
  playResY: number;
  fontMetrics: MetricsProvider;
}): string[] {
  const { sub, style, anim, styleName, layout, intervals, scale, playResY, fontMetrics } = a;
  const events: string[] = [];
  const visible = sub.words.filter((w) => !w.removed);
  const an = style.align === "left" ? 1 : style.align === "right" ? 3 : 2;
  const baseEm = style.fontSize * scale;
  const textAlphas = baseAlphas({ ...style, backgroundOpacity: 0 });
  const glow = isGlowStyle(style);
  const glowAlphas: BaseAlphas = { a1: Math.round((1 - clamp01(style.shadowOpacity)) * 255), a3: 255, a4: 255 };
  const glowBlur = Math.max(1, Math.round(style.shadowBlur * scale * 0.5 * 10) / 10);
  const hasBox = style.backgroundOpacity > 0;
  const boxAlpha = Math.round((1 - clamp01(style.backgroundOpacity)) * 255);
  const fallbackFs = (family: string, bold: boolean) => {
    const m = fontMetrics(family, bold ? 700 : 400);
    return m ? baseEm * assCellRatio(m) : undefined;
  };
  const block = layout.block;
  const boxAnchorX = style.align === "left" ? block.left : style.align === "right" ? block.left + block.width : block.left + block.width / 2;

  for (const interval of intervals) {
    const lineDur = interval.end - interval.start;
    const start = msTime(interval.start);
    const end = msTime(interval.end);
    const entrance = entranceAssParts(anim, interval.start - sub.start, boxAnchorX, block.top + block.height, playResY, textAlphas, 1);
    const exit = exitAssParts(anim, sub.start, sub.end, interval.start, interval.end, boxAnchorX, block.top + block.height, playResY, textAlphas, 1);
    const motion: AssMotionParts = entrance.active ? entrance : exit;
    const fadeTag = motion.fadeInMs ? `\\fad(${motion.fadeInMs},0)` : "";
    const wordRampMs = motion.active
      ? 0
      : Math.min(Math.round(lineDur * 1000), Math.round(Math.max(0.05, clamp01v(anim.durationSec) * 0.6) * 1000));

    const activeAbs = interval.activeWordIndex;
    const visibleActive = activeAbs === null ? -1 : visible.indexOf(sub.words[activeAbs]);
    const activeScales =
      style.wordHighlight && visibleActive >= 0 && (anim.word === "scale" || anim.word === "bounce") && !visible[visibleActive].style?.fontSize;

    // Background box: ONE rounded rectangle for the whole block (the preview paints one), not ASS's per-line box.
    if (hasBox) {
      const radius = style.backgroundRadius * layout.scale;
      events.push(
        `Dialogue: 0,${start},${end},${styleName},,0,0,0,,{\\an${an}${motion.positionAt(boxAnchorX, block.top + block.height)}${fadeTag}\\1c${assRgb(style.backgroundColor)}\\1a&H${hex2(boxAlpha)}&${motion.alpha({ a1: boxAlpha, a3: 255, a4: 255 })}${motion.scale(1)}\\bord0\\shad0\\p1}${roundedRectPath(block.width, block.height, radius)}{\\p0}`,
      );
    }

    // Glow underlay (see isGlowStyle): one blurred flat-colour copy of each line, under the crisp text.
    const glowTags = (mult: number) => motion.alpha(glowAlphas) + motion.scale(mult) + `\\blur${glowBlur}`;
    const glowRuns = glow
      ? renderWordRuns(sub, style, anim, interval.activeWordIndex, scale, glowTags, wordRampMs, fallbackFs).map((r) => r.replace(/\\c&H[0-9A-Fa-f]{6,8}&/g, ""))
      : [];
    const runs = renderWordRuns(sub, style, anim, interval.activeWordIndex, scale, motion.lineTags, wordRampMs, fallbackFs);

    const lineY = (line: CaptionLayout["lines"][number]) => {
      let descent = 0;
      for (const w of line.words) descent = Math.max(descent, w.assDescentPx * (activeScales && w.index === visibleActive ? style.activeWordScale : 1));
      return line.baseline + descent;
    };

    if (glow) {
      for (const line of layout.lines) {
        events.push(
          `Dialogue: 0,${start},${end},${styleName}G,,0,0,0,,{\\an${an}${motion.positionAt(line.anchorX, lineY(line))}${fadeTag}${glowTags(1)}}${line.words.map((w) => glowRuns[w.index]).join(" ")}`,
        );
      }
    }

    // Active-word chip, from the preview's own CSS box: the word's inline box (trailing space included)
    // plus a 0.15em ring, rounded 0.25em.
    if (anim.word === "bg-highlight" && style.wordHighlight && visibleActive >= 0) {
      for (const line of layout.lines) {
        const pw = line.words.find((w) => w.index === visibleActive);
        if (!pw) continue;
        const ring = 0.15 * pw.emPx;
        const left = pw.left - ring;
        const top = line.baseline - pw.runAbove - ring;
        const width = pw.boxRight - pw.left + 2 * ring;
        const height = pw.runHeight + 2 * ring;
        const chipAlpha = textAlphas.a1;
        events.push(
          `Dialogue: 0,${start},${end},${styleName},,0,0,0,,{\\an7${motion.positionAt(left, top)}${fadeTag}\\1c${assRgb(style.highlightColor)}\\1a&H${hex2(chipAlpha)}&${motion.alpha({ a1: chipAlpha, a3: 255, a4: 255 })}\\bord0\\shad0\\p1}${roundedRectPath(width, height, 0.25 * pw.emPx)}{\\p0}`,
        );
      }
    }

    for (const line of layout.lines) {
      events.push(
        `Dialogue: 1,${start},${end},${styleName},,0,0,0,,{\\an${an}${motion.positionAt(line.anchorX, lineY(line))}${fadeTag}${motion.lineTags(1)}}${line.words.map((w) => runs[w.index]).join(" ")}`,
      );
    }
  }
  return events;
}

/** Escapes a filesystem path for use inside an ffmpeg `subtitles=` filter argument on any OS. */
export function escapeAssPathForFfmpeg(absPath: string): string {
  return absPath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/**
 * Every (font family, weight) pair actually needed to render this project —
 * the global style, every per-caption font/weight override, and the script
 * fallback fonts for any caption written in Devanagari/Gujarati. The export
 * pipeline downloads/caches each of these (see lib/fonts/server-font-cache.ts)
 * and points ffmpeg's `subtitles` filter at that cache directory via
 * `fontsdir`, because none of these fonts are actually installed as system
 * fonts on whatever machine runs ffmpeg.
 */
export function collectRequiredFonts(
  subtitles: Pick<Subtitle, "words" | "style">[],
  globalStyle: SubtitleStyle,
): { family: string; weight: number; source: "bundled" | "system" }[] {
  const seen = new Map<string, { family: string; weight: number; source: "bundled" | "system" }>();
  const add = (family: string, weight: number, source: "bundled" | "system" = "bundled") =>
    seen.set(`${family}__${weight}`, { family, weight, source });

  add(globalStyle.fontFamily, globalStyle.fontWeight, globalStyle.fontSource);
  for (const sub of subtitles) {
    const resolved = { ...globalStyle, ...(sub.style ?? {}) };
    add(resolved.fontFamily, resolved.fontWeight, resolved.fontSource);
    // Scanned per-word (not per-whole-caption-text) so a mixed-script line —
    // "Today આપણે AI વિશે વાત કરીશું" — still gets every script's fallback
    // font cached, not just whichever one a whole-line regex matched first.
    for (const w of sub.words) {
      const script = detectScript(w.text);
      if (script !== "latin") {
        add(SCRIPT_FALLBACK_FONTS[script].name, 400);
        add(SCRIPT_FALLBACK_FONTS[script].name, 700);
      }
    }
  }
  return Array.from(seen.values());
}
