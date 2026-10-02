import type { SubtitlePresetDef } from "./presets.ts";

/**
 * Differentiation audit for the built-in style library (P20.2). Each preset is reduced to the 14
 * visual DIMENSIONS a viewer actually perceives, quantised into buckets so that "58px vs 60px" or
 * "#FFFFFF vs #FAF7F2" count as the same thing. Two presets' distance is how many dimensions
 * differ. Used by __tests__/style-family-audit.test.ts to make it hard to accidentally add ten
 * presets that are effectively the same one, and available to any future tooling.
 */
export const AUDIT_DIMENSIONS = [
  "font",
  "weight",
  "size",
  "case",
  "color",
  "outline",
  "shadow",
  "background",
  "position",
  "spacing",
  "entrance",
  "exit",
  "word",
  "highlight",
] as const;
export type AuditDimension = (typeof AUDIT_DIMENSIONS)[number];
export type PresetSignature = Record<AuditDimension, string>;

/** Coarse colour bucket: neutral (white / light grey / dark) or one of 12 hue sectors. */
export function colorBucket(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "unknown";
  const [r, g, b] = [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.22) return l > 0.78 ? "white" : l > 0.35 ? "grey" : "black";
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  return `hue${Math.floor(h / 30)}${l < 0.3 ? "-dark" : ""}`;
}

const weightBucket = (w: number) => (w <= 500 ? "light" : w <= 700 ? "bold" : "black");
const sizeBucket = (px: number) => (px < 46 ? "s" : px < 60 ? "m" : px < 74 ? "l" : "xl");
const spacingBucket = (ls: number) => (ls < 1.25 ? "normal" : ls < 3.5 ? "wide" : "xwide");
const yBucket = (y: number) => (y < 30 ? "top" : y < 65 ? "mid" : y < 86 ? "low" : "bottom");

export function presetSignature(p: Pick<SubtitlePresetDef, "style" | "animation">): PresetSignature {
  const { style: st, animation: an } = p;
  const outline = st.outlineEnabled ? `${st.outlineWidth < 4 ? "thin" : st.outlineWidth < 8 ? "mid" : "thick"}-${colorBucket(st.outlineColor)}` : "none";
  const shadow = !st.shadowEnabled
    ? "none"
    : st.shadowBlur === 0
      ? `hard-${colorBucket(st.shadowColor)}`
      : st.shadowBlur >= 18 && Math.abs(st.shadowOffsetX) + Math.abs(st.shadowOffsetY) <= 4
        ? `glow-${colorBucket(st.shadowColor)}`
        : "soft";
  const background =
    st.backgroundOpacity > 0
      ? `${st.backgroundRadius >= 40 ? "pill" : st.backgroundRadius >= 10 ? "round" : "square"}-${colorBucket(st.backgroundColor)}-${st.backgroundOpacity >= 0.8 ? "solid" : "tint"}`
      : "none";
  // typewriter / word-pop / char-pop are the same capped fade in both renderers (animation-render.ts)
  const fadeLike = new Set(["fade", "typewriter", "word-pop", "char-pop"]);
  const entrance = fadeLike.has(an.entrance) ? "fade" : an.entrance;
  const exit = an.exit === "slide" ? "slide-up" : an.exit;
  const word = st.wordHighlight ? an.word : "off";
  return {
    font: st.fontFamily,
    weight: weightBucket(st.fontWeight),
    size: sizeBucket(st.fontSize),
    case: st.textCase === "none" ? "sentence" : st.textCase,
    color: colorBucket(st.color),
    outline,
    shadow,
    background,
    position: `${st.align}-${st.vAlign}-${yBucket(st.y)}`,
    spacing: spacingBucket(st.letterSpacing),
    entrance,
    exit,
    word,
    highlight: word === "off" || word === "none" ? "n/a" : colorBucket(st.highlightColor),
  };
}

/** The dimensions on which two presets differ. */
export function differingDimensions(a: PresetSignature, b: PresetSignature): AuditDimension[] {
  return AUDIT_DIMENSIONS.filter((d) => a[d] !== b[d]);
}

export interface SimilarPair {
  a: string;
  b: string;
  distance: number;
  shared: AuditDimension[];
}

/** Every pair of presets that differ in fewer than `minDistance` dimensions, most similar first. */
export function findSimilarPairs(presets: Pick<SubtitlePresetDef, "id" | "style" | "animation">[], minDistance: number): SimilarPair[] {
  const sigs = presets.map((p) => ({ id: p.id, sig: presetSignature(p) }));
  const out: SimilarPair[] = [];
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      const diff = differingDimensions(sigs[i].sig, sigs[j].sig);
      if (diff.length < minDistance) {
        out.push({ a: sigs[i].id, b: sigs[j].id, distance: diff.length, shared: AUDIT_DIMENSIONS.filter((d) => !diff.includes(d)) });
      }
    }
  }
  return out.sort((x, y) => x.distance - y.distance);
}
