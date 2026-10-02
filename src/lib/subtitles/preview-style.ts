import type { CSSProperties } from "react";
import type { AnimationConfig, SubtitleStyle } from "@/types/subtitle";
import { detectScript, SCRIPT_FALLBACK_FONTS } from "./script-detect";
export { scaleWordStyleValue } from "./word-preview-scale";

/**
 * Maps a SubtitleStyle to CSS for the live browser preview. This is the browser
 * counterpart to `buildAssDocument` in ./ass.ts — both read the exact same
 * SubtitleStyle object, so a slider change is guaranteed to look the same
 * (modulo ASS's more limited effect primitives) in the preview and the export.
 *
 * `refHeightPx` is the CSS pixel height of the video canvas element the
 * subtitle box is rendered inside; style numeric fields are authored against a
 * 1920px-tall reference frame (see types/subtitle.ts) so we scale by
 * refHeightPx / 1920 to stay resolution-independent.
 */
export function styleToContainerCss(style: SubtitleStyle, refHeightPx: number): CSSProperties {
  const scale = refHeightPx / 1920;
  const translateX = style.align === "left" ? "0%" : style.align === "right" ? "-100%" : "-50%";
  const translateY = style.vAlign === "top" ? "0%" : style.vAlign === "bottom" ? "-100%" : "-50%";

  return {
    position: "absolute",
    left: `${style.x}%`,
    top: `${style.y}%`,
    transform: `translate(${translateX}, ${translateY})`,
    width: `${style.boxWidthPercent}%`,
    textAlign: style.align,
    display: "flex",
    flexDirection: "column",
    alignItems: style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center",
    pointerEvents: "none",
    zIndex: 20,
  };
}

/**
 * Resolves the CSS `font-family` for a run of text — the caller's chosen font
 * for Latin scripts, or a Noto Sans fallback for scripts (Devanagari,
 * Gujarati) it has no glyphs for. Call this PER WORD (see subtitle-overlay.tsx)
 * rather than once for a whole caption's text, so a mixed-script line like
 * "Today આપણે AI વિશે વાત કરીશું" gets the right font for each word instead of
 * whichever script a whole-line regex happened to match first.
 */
export function resolveFontFamilyCss(fontFamily: string, text: string): string {
  const script = detectScript(text);
  if (script !== "latin") {
    return `var(${SCRIPT_FALLBACK_FONTS[script].variable}), ${SCRIPT_FALLBACK_FONTS[script].name}, sans-serif`;
  }
  // The fallback MUST live inside the var() call itself (var(--x, fallback)), not as a
  // later item in the comma list — a var() reference to an undefined custom property has
  // no fallback of its own makes the WHOLE font-family value invalid (CSS "invalid at
  // computed-value time"), not just that one alternative, so `var(--undefined), Arial`
  // silently renders using the inherited font instead of falling through to Arial. This
  // matters for any font with no bundled `--font-x` variable — i.e. every Windows system
  // font (see lib/fonts/system-fonts.ts) — which otherwise renders as if untouched.
  // The family name is QUOTED: an unquoted name is only a valid CSS <custom-ident> when each word is
  // an identifier, so `Baloo 2` (a word followed by a number) made the WHOLE declaration invalid —
  // dropped at parse time, so the caption silently rendered in the inherited font (Inter). Confirmed in
  // the real editor for every Baloo 2 style (Comic/Cartoon/Sticker Pill); the export was never affected.
  const q = quoteFontFamily(fontFamily);
  return `var(--font-${slugFont(fontFamily)}, ${q}), ${q}, sans-serif`;
}

/** A CSS-safe quoted font-family name. */
export function quoteFontFamily(name: string): string {
  return `"${name.replace(/["\\]/g, "")}"`;
}

/**
 * `subtitleText` is optional but should always be passed when known — it's
 * only used as a whole-line fallback (e.g. a caption rendered without going
 * through the per-word path); prefer overriding font-family per word.
 */
export function styleToTextCss(style: SubtitleStyle, refHeightPx: number, subtitleText?: string): CSSProperties {
  const scale = refHeightPx / 1920;
  const fontFamilyCss = resolveFontFamilyCss(style.fontFamily, subtitleText ?? "");
  const shadows: string[] = [];
  if (style.outlineEnabled) {
    const w = Math.max(0.5, style.outlineWidth * scale);
    // Approximate a stroke using 8-direction text-shadow (no native -webkit-text-stroke blur/AA issues this way).
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      shadows.push(`${(Math.cos(angle) * w).toFixed(2)}px ${(Math.sin(angle) * w).toFixed(2)}px 0 ${style.outlineColor}`);
    }
  }
  if (style.shadowEnabled) {
    shadows.push(
      `${style.shadowOffsetX * scale}px ${style.shadowOffsetY * scale}px ${style.shadowBlur * scale}px rgba(${hexToRgb(style.shadowColor)},${style.shadowOpacity})`,
    );
  }

  return {
    fontFamily: fontFamilyCss,
    fontSize: `${style.fontSize * scale}px`,
    fontWeight: style.fontWeight,
    letterSpacing: `${style.letterSpacing * scale}px`,
    lineHeight: style.lineHeight,
    textTransform: style.textCase === "none" ? "none" : style.textCase === "sentence" ? "none" : style.textCase,
    color: style.color,
    opacity: style.opacity,
    backgroundColor:
      style.backgroundOpacity > 0 ? hexWithAlpha(style.backgroundColor, style.backgroundOpacity) : "transparent",
    borderRadius: `${style.backgroundRadius * scale}px`,
    padding: `${style.backgroundPaddingY * scale}px ${style.backgroundPaddingX * scale}px`,
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
  };
}

/**
 * CSS for the active/emphasized word under a given word-level AnimationConfig — the single
 * source of truth for "what does an emphasized word actually look like", shared between the
 * live editor overlay (subtitle-overlay.tsx, where it used to be a private, unexported copy of
 * this exact switch) and the preset-picker's own thumbnails (presets-panel.tsx), so a preset
 * card's preview shows the real word-emphasis treatment (color change, scale, background chip,
 * underline) rather than a hand-approximated stand-in. Mirrors wordOverride() in lib/subtitles/
 * ass.ts — same cases, CSS syntax instead of ASS override tags — see that function's own
 * comments for where the two consumers' fidelity intentionally diverges (e.g. "bg-highlight"
 * has no ASS equivalent for a background box, so export falls back to a color change only).
 */
export function activeWordCss(style: SubtitleStyle, animation: AnimationConfig): CSSProperties {
  const base: CSSProperties = { transition: `all ${Math.max(0.05, animation.durationSec * 0.6)}s ease` };
  switch (animation.word) {
    case "highlight":
    case "color":
      return { ...base, color: style.highlightColor };
    case "scale":
      return { ...base, color: style.highlightColor, transform: `scale(${style.activeWordScale})` };
    case "bounce":
      return { ...base, color: style.highlightColor, transform: `scale(${style.activeWordScale})`, transitionTimingFunction: "cubic-bezier(.34,1.56,.64,1)" };
    case "underline":
      return { ...base, color: style.highlightColor, textDecoration: "underline", textUnderlineOffset: "0.15em" };
    case "bg-highlight":
      return {
        ...base,
        color: style.color,
        backgroundColor: style.highlightColor,
        borderRadius: "0.25em",
        boxShadow: `0 0 0 0.15em ${style.highlightColor}`,
      };
    default:
      return {};
  }
}

export function slugFont(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "0,0,0";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

function hexWithAlpha(hex: string, alpha: number): string {
  return `rgba(${hexToRgb(hex)},${alpha})`;
}
