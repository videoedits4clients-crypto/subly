export type TextScript = "latin" | "devanagari" | "gujarati";

const DEVANAGARI = /[ऀ-ॿ]/;
const GUJARATI = /[઀-૿]/;

/**
 * Detects which script a subtitle's text is written in, so the renderer can
 * substitute a font that actually has the required glyphs. None of our
 * user-selectable fonts (Inter, Poppins, Anton, ...) ship Devanagari or
 * Gujarati glyphs — using them for those scripts would render blank boxes
 * ("tofu"), so both the browser preview and the ASS export fall back to a
 * Noto Sans variant when this returns non-"latin" (see lib/fonts.ts).
 */
export function detectScript(text: string): TextScript {
  if (DEVANAGARI.test(text)) return "devanagari";
  if (GUJARATI.test(text)) return "gujarati";
  return "latin";
}

/**
 * Single source of truth for the fallback font used per non-Latin script, in
 * both the browser preview (preview-style.ts, via the CSS variable) and the
 * ASS export (ass.ts + lib/fonts/server-cache.ts, via the font name — which
 * must exactly match a Google Fonts family name so the cache can fetch it).
 * Plain data, no next/font import here, so both fonts.ts (which loads the
 * actual webfont) and preview-style.ts (which only needs the name) can depend
 * on this without a circular import.
 */
export const SCRIPT_FALLBACK_FONTS: Record<Exclude<TextScript, "latin">, { name: string; variable: `--${string}` }> = {
  devanagari: { name: "Noto Sans Devanagari", variable: "--font-noto-sans-devanagari" },
  gujarati: { name: "Noto Sans Gujarati", variable: "--font-noto-sans-gujarati" },
};
