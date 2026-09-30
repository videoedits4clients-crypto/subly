import type { AnimationConfig, SubtitleStyle } from "../types/subtitle.ts";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE } from "../types/subtitle.ts";

/**
 * Built-in caption style library (P5 — Caption Style Library Expansion).
 *
 * `category` is a lightweight, data-driven field on each preset — not a second styling system.
 * Previously the editor's PresetsPanel grouped presets into sections using a hand-maintained
 * `{ label, ids: [...] }` array kept separate from BUILT_IN_PRESETS itself; every new preset had
 * to be remembered in two places, and a forgotten entry would silently vanish from the UI while
 * still being fully functional (applicable, exportable) — exactly the kind of drift that gets
 * worse as a library grows past a dozen entries. Putting `category` directly on the preset
 * definition makes the grouping authoritative and impossible to forget, and is what makes "every
 * built-in preset has a valid category" a meaningful, checkable invariant (see
 * __tests__/preset-library.test.ts) rather than a UI-only convention.
 */
export const PRESET_CATEGORIES = ["Creator", "Dynamic", "Highlight", "Clean", "Cinematic", "Fun", "Effects", "Retro"] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

export interface SubtitlePresetDef {
  id: string;
  name: string;
  description: string;
  category: PresetCategory;
  style: SubtitleStyle;
  animation: AnimationConfig;
}

function s(overrides: Partial<SubtitleStyle>): SubtitleStyle {
  return { ...DEFAULT_SUBTITLE_STYLE, ...overrides };
}
function a(overrides: Partial<AnimationConfig>): AnimationConfig {
  return { ...DEFAULT_ANIMATION, ...overrides };
}

export const BUILT_IN_PRESETS: SubtitlePresetDef[] = [
  // ───────────────────────── Creator ─────────────────────────
  {
    id: "bold",
    name: "Bold",
    description: "Big, heavy, impossible to miss.",
    category: "Creator",
    style: s({ fontFamily: "Archivo", fontWeight: 900, fontSize: 76, outlineWidth: 8, wordHighlight: true, highlightColor: "#FACC15" }),
    animation: a({ entrance: "pop", word: "scale", durationSec: 0.2 }),
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "The viral look: bold caps, cyan highlight pop.",
    category: "Creator",
    style: s({ fontFamily: "Poppins", fontWeight: 800, fontSize: 68, textCase: "uppercase", highlightColor: "#22D3EE", activeWordScale: 1.18 }),
    animation: a({ entrance: "word-pop", word: "scale", durationSec: 0.15 }),
  },
  {
    id: "reels",
    name: "Reels",
    description: "Rounded background chips, Instagram-native feel.",
    category: "Creator",
    style: s({
      fontFamily: "Plus Jakarta Sans",
      fontWeight: 700,
      fontSize: 56,
      backgroundColor: "#000000",
      backgroundOpacity: 0.55,
      backgroundRadius: 20,
      outlineEnabled: false,
      wordHighlight: true,
      highlightColor: "#F472B6",
    }),
    animation: a({ entrance: "slide-up", word: "highlight" }),
  },
  {
    id: "mrbeast",
    name: "MrBeast-style",
    description: "Huge yellow bouncy caps with a thick black outline.",
    category: "Creator",
    style: s({
      fontFamily: "Anton",
      fontWeight: 400,
      fontSize: 84,
      textCase: "uppercase",
      color: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineWidth: 10,
      activeWordScale: 1.25,
      wordHighlight: true,
    }),
    animation: a({ entrance: "bounce", word: "bounce", durationSec: 0.25 }),
  },
  {
    id: "creator-bold",
    name: "Creator Bold",
    description: "A confident, condensed creator base look — the loudest possible plain caption.",
    category: "Creator",
    style: s({ fontFamily: "League Spartan", fontWeight: 900, fontSize: 74, textCase: "uppercase", outlineWidth: 9, wordHighlight: false }),
    animation: a({ entrance: "pop", word: "none", durationSec: 0.2 }),
  },
  {
    id: "punch",
    name: "Punch",
    description: "Every word lands with a hard scale-and-color hit.",
    category: "Creator",
    style: s({
      fontFamily: "Archivo Black",
      fontWeight: 400,
      fontSize: 70,
      textCase: "uppercase",
      outlineWidth: 7,
      wordHighlight: true,
      highlightColor: "#FF6B35",
      activeWordScale: 1.2,
    }),
    animation: a({ entrance: "word-pop", word: "scale", durationSec: 0.15 }),
  },

  // ───────────────────────── Dynamic ─────────────────────────
  {
    id: "gaming",
    name: "Gaming",
    description: "Neon highlight with aggressive scale-pop.",
    category: "Dynamic",
    style: s({
      fontFamily: "Archivo",
      fontWeight: 900,
      fontSize: 70,
      textCase: "uppercase",
      color: "#E5E7EB",
      highlightColor: "#A3E635",
      outlineColor: "#111827",
      outlineWidth: 7,
      activeWordScale: 1.3,
    }),
    animation: a({ entrance: "pop", word: "scale", durationSec: 0.15 }),
  },
  {
    id: "power-words",
    name: "Power Words",
    description: "Emphasized words jump bigger, bolder, and into an accent color.",
    category: "Dynamic",
    style: s({
      fontFamily: "Archivo",
      fontWeight: 900,
      fontSize: 72,
      textCase: "uppercase",
      outlineWidth: 7,
      wordHighlight: true,
      highlightColor: "#FF3366",
      activeWordScale: 1.3,
    }),
    animation: a({ entrance: "pop", word: "scale", durationSec: 0.18 }),
  },
  {
    id: "jump-pop",
    name: "Jump Pop",
    description: "Each word bounces up into place as it's spoken.",
    category: "Dynamic",
    style: s({
      fontFamily: "Poppins",
      fontWeight: 800,
      fontSize: 66,
      outlineWidth: 6,
      wordHighlight: true,
      highlightColor: "#A3E635",
      activeWordScale: 1.22,
    }),
    animation: a({ entrance: "pop", word: "bounce", durationSec: 0.18 }),
  },
  {
    id: "bounce",
    name: "Bounce",
    description: "The whole caption springs onto screen, then a gentle color change per word.",
    category: "Dynamic",
    style: s({ fontFamily: "Fredoka", fontWeight: 600, fontSize: 62, outlineWidth: 5, wordHighlight: true, highlightColor: "#38BDF8" }),
    animation: a({ entrance: "bounce", word: "highlight", durationSec: 0.3 }),
  },
  {
    id: "word-burst",
    name: "Word Burst",
    description: "A dramatic, oversized scale burst on every emphasized word.",
    category: "Dynamic",
    style: s({
      fontFamily: "Anton",
      fontWeight: 400,
      fontSize: 78,
      textCase: "uppercase",
      outlineWidth: 8,
      wordHighlight: true,
      highlightColor: "#FFE600",
      activeWordScale: 1.45,
    }),
    animation: a({ entrance: "word-pop", word: "scale", durationSec: 0.12 }),
  },

  // ───────────────────────── Highlight ─────────────────────────
  {
    id: "karaoke",
    name: "Karaoke",
    description: "Word-by-word color sweep, sing-along style.",
    category: "Highlight",
    style: s({ fontFamily: "Montserrat", fontWeight: 800, fontSize: 60, wordHighlight: true, highlightColor: "#22D3EE", color: "#E5E7EB" }),
    animation: a({ entrance: "fade", word: "highlight", durationSec: 0.1 }),
  },
  {
    id: "highlight",
    name: "Highlight",
    description: "Background box sweeps behind the active word.",
    category: "Highlight",
    // highlightColor was #000000 until Task 87426's P6 audit (following up on the P5.1 QA
    // finding): a black active-word background chip is invisible against SUBLY's default
    // black composition background, so the preset's own signature effect (a "background box
    // sweeps behind the active word," per its description above) never actually showed up for
    // anyone using the default canvas. #FB923C (a vivid orange) reads clearly on both black
    // and light backgrounds and doesn't collide with any other Highlight-category preset's
    // highlightColor (karaoke #22D3EE cyan, color-sweep #2DD4BF teal, active-highlight
    // #7C3AED purple, marker #FFE066 yellow, word-focus #FFFFFF white). This is a preset-
    // DEFINITION change only — the P5.1 ASS/vector background-chip renderer itself
    // (lib/subtitles/ass.ts) is untouched; see research/p6_custom_caption_style_creator_report.md.
    style: s({ fontFamily: "Poppins", fontWeight: 700, fontSize: 60, wordHighlight: true, highlightColor: "#FB923C", color: "#FFFFFF" }),
    animation: a({ entrance: "fade", word: "bg-highlight" }),
  },
  {
    id: "color-sweep",
    name: "Color Sweep",
    description: "A softer, slower karaoke — teal sweeps across each word as it's spoken.",
    category: "Highlight",
    style: s({ fontFamily: "Montserrat", fontWeight: 700, fontSize: 58, color: "#D1D5DB", wordHighlight: true, highlightColor: "#2DD4BF" }),
    animation: a({ entrance: "fade", word: "color", durationSec: 0.12 }),
  },
  {
    id: "active-highlight",
    name: "Active Highlight",
    description: "The current word gets a bold, contrasting background chip.",
    category: "Highlight",
    style: s({ fontFamily: "Poppins", fontWeight: 700, fontSize: 58, wordHighlight: true, highlightColor: "#7C3AED" }),
    animation: a({ entrance: "fade", word: "bg-highlight" }),
  },
  {
    id: "marker",
    name: "Marker",
    description: "A highlighter-yellow box swipes behind the active word, like it was marked up.",
    category: "Highlight",
    style: s({ fontFamily: "DM Sans", fontWeight: 700, fontSize: 56, wordHighlight: true, highlightColor: "#FFE066" }),
    animation: a({ entrance: "fade", word: "bg-highlight" }),
  },
  {
    id: "word-focus",
    name: "Word Focus",
    description: "Base text sits dim and quiet; the active word turns bright white and pulls focus.",
    category: "Highlight",
    style: s({ fontFamily: "Inter", fontWeight: 600, fontSize: 56, outlineWidth: 3, color: "#9CA3AF", wordHighlight: true, highlightColor: "#FFFFFF" }),
    animation: a({ entrance: "fade", word: "color" }),
  },
  {
    id: "pulse-highlight",
    name: "Pulse Highlight",
    description: "A quick, gentle scale-and-color pulse on every active word.",
    category: "Highlight",
    style: s({ fontFamily: "Poppins", fontWeight: 700, fontSize: 60, wordHighlight: true, highlightColor: "#EC4899", activeWordScale: 1.15 }),
    animation: a({ entrance: "pop", word: "scale", durationSec: 0.1 }),
  },

  // ───────────────────────── Clean ─────────────────────────
  {
    id: "classic",
    name: "Classic",
    description: "Timeless white text with a soft outline.",
    category: "Clean",
    style: s({ fontFamily: "Inter", fontWeight: 700, fontSize: 58, textCase: "sentence", outlineWidth: 5, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Clean, small, no background — lets the video breathe.",
    category: "Clean",
    style: s({ fontFamily: "DM Sans", fontWeight: 500, fontSize: 46, textCase: "none", outlineWidth: 2, shadowEnabled: false, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none", durationSec: 0.15 }),
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Wide, readable, landscape-friendly captions.",
    category: "Clean",
    style: s({
      fontFamily: "Roboto",
      fontWeight: 600,
      fontSize: 44,
      y: 90,
      boxWidthPercent: 70,
      backgroundColor: "#000000",
      backgroundOpacity: 0.6,
      outlineEnabled: false,
      wordHighlight: false,
    }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "podcast",
    name: "Podcast",
    description: "Understated, centered, long-form friendly.",
    category: "Clean",
    style: s({ fontFamily: "Nunito", fontWeight: 600, fontSize: 50, y: 75, textCase: "none", wordHighlight: true, highlightColor: "#7C3AED" }),
    animation: a({ entrance: "fade", word: "color" }),
  },
  {
    id: "news",
    name: "News",
    description: "Broadcast-style lower third bar.",
    category: "Clean",
    style: s({
      fontFamily: "Oswald",
      fontWeight: 500,
      fontSize: 42,
      textCase: "uppercase",
      y: 92,
      boxWidthPercent: 90,
      backgroundColor: "#B91C1C",
      backgroundOpacity: 1,
      backgroundRadius: 0,
      outlineEnabled: false,
      color: "#FFFFFF",
      wordHighlight: false,
    }),
    animation: a({ entrance: "slide-left", word: "none" }),
  },
  {
    id: "clean",
    name: "Clean",
    description: "Soft shadow only, no outline, editorial feel.",
    category: "Clean",
    style: s({ fontFamily: "Inter", fontWeight: 600, fontSize: 52, outlineEnabled: false, shadowEnabled: true, shadowBlur: 16, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "elegant",
    name: "Elegant",
    description: "Light weight, generous spacing, sentence case.",
    category: "Clean",
    style: s({ fontFamily: "DM Sans", fontWeight: 500, fontSize: 48, letterSpacing: 1.5, textCase: "sentence", outlineWidth: 3, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none", durationSec: 0.3 }),
  },
  {
    id: "clean-white",
    name: "Clean White",
    description: "Pure white text, a whisper of shadow, nothing else competing for attention.",
    category: "Clean",
    style: s({ fontFamily: "Inter", fontWeight: 500, fontSize: 50, textCase: "sentence", outlineWidth: 2, shadowEnabled: true, shadowBlur: 8, shadowOpacity: 0.35, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "modern",
    name: "Modern",
    description: "Geometric sans, no outline, a subtle accent color on the active word.",
    category: "Clean",
    style: s({
      fontFamily: "DM Sans",
      fontWeight: 600,
      fontSize: 54,
      textCase: "none",
      outlineEnabled: false,
      shadowEnabled: true,
      shadowBlur: 10,
      wordHighlight: true,
      highlightColor: "#7C3AED",
    }),
    animation: a({ entrance: "fade", word: "color" }),
  },
  {
    id: "mono",
    name: "Mono",
    description: "Wide, even letter-spacing for a technical, monospace-inspired feel.",
    category: "Clean",
    style: s({ fontFamily: "Roboto", fontWeight: 500, fontSize: 48, textCase: "none", letterSpacing: 3, outlineWidth: 2, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Refined display serif, generous tracking — a magazine-caption feel.",
    category: "Clean",
    style: s({
      fontFamily: "Playfair Display",
      fontWeight: 600,
      fontSize: 52,
      textCase: "sentence",
      letterSpacing: 1,
      outlineEnabled: false,
      shadowEnabled: true,
      shadowBlur: 14,
      wordHighlight: false,
    }),
    animation: a({ entrance: "fade", word: "none", durationSec: 0.3 }),
  },

  // ───────────────────────── Cinematic ─────────────────────────
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Warm white, letter-spaced, a soft film-subtitle shadow near the bottom.",
    category: "Cinematic",
    style: s({
      fontFamily: "DM Serif Display",
      fontWeight: 400,
      fontSize: 50,
      textCase: "sentence",
      letterSpacing: 2,
      y: 88,
      outlineEnabled: false,
      shadowEnabled: true,
      shadowBlur: 18,
      shadowOffsetY: 3,
      color: "#F5F5F0",
      wordHighlight: false,
    }),
    animation: a({ entrance: "fade", word: "none", durationSec: 0.4 }),
  },
  {
    id: "luxury",
    name: "Luxury",
    description: "Champagne-gold serif with generous tracking — refined and high-end.",
    category: "Cinematic",
    style: s({
      fontFamily: "Playfair Display",
      fontWeight: 700,
      fontSize: 54,
      textCase: "sentence",
      letterSpacing: 2,
      color: "#F5E1A4",
      outlineEnabled: false,
      shadowEnabled: true,
      shadowBlur: 12,
      wordHighlight: false,
    }),
    animation: a({ entrance: "fade", word: "none", durationSec: 0.35 }),
  },
  {
    id: "soft-shadow",
    name: "Soft Shadow",
    description: "No hard outline at all — just a large, soft shadow for gentle depth.",
    category: "Cinematic",
    style: s({ fontFamily: "Inter", fontWeight: 500, fontSize: 52, outlineEnabled: false, shadowEnabled: true, shadowBlur: 24, shadowOpacity: 0.6, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "cinematic-glow",
    name: "Cinematic Glow",
    description: "A cool blue glow behind elegant serif text, brightening on the active word.",
    category: "Cinematic",
    style: s({
      fontFamily: "DM Serif Display",
      fontWeight: 400,
      fontSize: 54,
      textCase: "sentence",
      outlineEnabled: false,
      shadowEnabled: true,
      shadowColor: "#60A5FA",
      shadowBlur: 20,
      shadowOpacity: 0.8,
      wordHighlight: true,
      highlightColor: "#93C5FD",
    }),
    animation: a({ entrance: "fade", word: "color", durationSec: 0.4 }),
  },

  // ───────────────────────── Fun ─────────────────────────
  {
    id: "comic",
    name: "Comic",
    description: "Rounded, chunky, thick black outline — comic-book speech-bubble energy.",
    category: "Fun",
    style: s({
      fontFamily: "Baloo 2",
      fontWeight: 700,
      fontSize: 68,
      textCase: "uppercase",
      outlineColor: "#111827",
      outlineWidth: 9,
      wordHighlight: true,
      highlightColor: "#FDE047",
      activeWordScale: 1.2,
    }),
    animation: a({ entrance: "pop", word: "scale", durationSec: 0.15 }),
  },
  {
    id: "sticker",
    name: "Sticker",
    description: "Dark text on a bright, rounded sticker chip — peel-and-stick energy.",
    category: "Fun",
    style: s({
      fontFamily: "Fredoka",
      fontWeight: 700,
      fontSize: 60,
      textCase: "none",
      color: "#1E293B",
      backgroundColor: "#FDE047",
      backgroundOpacity: 1,
      backgroundRadius: 24,
      backgroundPaddingX: 22,
      backgroundPaddingY: 12,
      outlineEnabled: false,
      wordHighlight: false,
    }),
    animation: a({ entrance: "pop", word: "none", durationSec: 0.2 }),
  },
  {
    id: "candy-pop",
    name: "Candy Pop",
    description: "Bubblegum pink with a baby-blue pop on every active word.",
    category: "Fun",
    style: s({
      fontFamily: "Quicksand",
      fontWeight: 700,
      fontSize: 62,
      textCase: "none",
      color: "#FF6FB5",
      outlineColor: "#FFFFFF",
      outlineWidth: 6,
      wordHighlight: true,
      highlightColor: "#7DD3FC",
      activeWordScale: 1.2,
    }),
    animation: a({ entrance: "bounce", word: "scale", durationSec: 0.25 }),
  },
  {
    id: "cartoon",
    name: "Cartoon",
    description: "Playful green with a bold dark outline and a bouncy active word.",
    category: "Fun",
    style: s({
      fontFamily: "Baloo 2",
      fontWeight: 600,
      fontSize: 64,
      textCase: "none",
      color: "#34D399",
      outlineColor: "#111827",
      outlineWidth: 7,
      wordHighlight: true,
      highlightColor: "#FBBF24",
      activeWordScale: 1.2,
    }),
    animation: a({ entrance: "bounce", word: "bounce", durationSec: 0.25 }),
  },

  // ───────────────────────── Effects ─────────────────────────
  {
    id: "neon",
    name: "Neon",
    description: "Glowing neon-green text with a hot-pink glow on the active word.",
    category: "Effects",
    style: s({
      fontFamily: "Archivo",
      fontWeight: 800,
      fontSize: 62,
      textCase: "uppercase",
      color: "#39FF88",
      outlineEnabled: false,
      shadowEnabled: true,
      shadowColor: "#39FF88",
      shadowBlur: 26,
      shadowOpacity: 0.9,
      wordHighlight: true,
      highlightColor: "#FF3EC9",
    }),
    animation: a({ entrance: "fade", word: "color" }),
  },
  {
    id: "outline",
    name: "Outline",
    description: "A big, vivid outline does all the work — bold graphic emphasis.",
    category: "Effects",
    style: s({ fontFamily: "Archivo", fontWeight: 900, fontSize: 68, textCase: "uppercase", outlineColor: "#22D3EE", outlineWidth: 9, wordHighlight: false }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "shadow-pop",
    name: "Shadow Pop",
    description: "A hard, offset pop-art drop shadow with no blur at all.",
    category: "Effects",
    style: s({
      fontFamily: "Archivo Black",
      fontWeight: 400,
      fontSize: 66,
      textCase: "uppercase",
      outlineEnabled: false,
      shadowEnabled: true,
      shadowColor: "#000000",
      shadowOffsetX: 6,
      shadowOffsetY: 6,
      shadowBlur: 0,
      shadowOpacity: 1,
      wordHighlight: true,
      highlightColor: "#FACC15",
      activeWordScale: 1.15,
    }),
    animation: a({ entrance: "pop", word: "scale", durationSec: 0.15 }),
  },
  {
    id: "gradient-glow",
    name: "Gradient Glow",
    description: "Pink text against a contrasting blue glow — a two-tone gradient feel.",
    category: "Effects",
    style: s({
      fontFamily: "Outfit",
      fontWeight: 700,
      fontSize: 60,
      textCase: "none",
      color: "#F472B6",
      outlineEnabled: false,
      shadowEnabled: true,
      shadowColor: "#38BDF8",
      shadowBlur: 22,
      shadowOpacity: 0.85,
      wordHighlight: true,
      highlightColor: "#FDE047",
    }),
    animation: a({ entrance: "fade", word: "color" }),
  },

  // ───────────────────────── Retro ─────────────────────────
  {
    id: "retro",
    name: "Retro",
    description: "Warm cream text on a burnt-orange chip — 70s poster energy.",
    category: "Retro",
    style: s({
      fontFamily: "Oswald",
      fontWeight: 500,
      fontSize: 58,
      textCase: "uppercase",
      color: "#F5E6D3",
      backgroundColor: "#C2410C",
      backgroundOpacity: 0.85,
      backgroundRadius: 4,
      backgroundPaddingX: 16,
      backgroundPaddingY: 8,
      outlineEnabled: false,
      wordHighlight: false,
    }),
    animation: a({ entrance: "fade", word: "none" }),
  },
  {
    id: "vhs",
    name: "VHS",
    description: "Cyan text with a magenta fringe — a worn videotape look.",
    category: "Retro",
    style: s({
      fontFamily: "Oswald",
      fontWeight: 600,
      fontSize: 56,
      textCase: "uppercase",
      color: "#22D3EE",
      outlineColor: "#F472B6",
      outlineWidth: 4,
      shadowEnabled: true,
      shadowColor: "#F472B6",
      shadowBlur: 10,
      shadowOpacity: 0.6,
      wordHighlight: true,
      highlightColor: "#FDE047",
    }),
    animation: a({ entrance: "fade", word: "color" }),
  },
  {
    // Task 146220 (P19.17): `id` and `entrance: "typewriter"` kept as-is (existing
    // projects/saved styles reference this id; renaming it would be a data-model change, not a
    // copy fix) — only the user-facing `name`/`description` changed. The old description
    // ("classic character-by-character reveal") described behavior that doesn't exist: this
    // entrance is the same capped ~150ms fade as every other approximated entrance (see
    // lib/subtitles/animation-render.ts's APPROXIMATED_FADE_ENTRANCES), not a progressive reveal.
    id: "typewriter",
    name: "Wide Type",
    description: "Even, wide letter spacing with a quick fade-in.",
    category: "Retro",
    style: s({ fontFamily: "Roboto", fontWeight: 500, fontSize: 48, textCase: "none", letterSpacing: 2, outlineWidth: 2, wordHighlight: false }),
    animation: a({ entrance: "typewriter", word: "none", durationSec: 0.4 }),
  },
  {
    id: "arcade",
    name: "Arcade",
    description: "Blocky condensed caps, purple glow, hot-pink active word — 8-bit energy.",
    category: "Retro",
    style: s({
      fontFamily: "League Spartan",
      fontWeight: 800,
      fontSize: 60,
      textCase: "uppercase",
      color: "#39FF14",
      outlineColor: "#7C3AED",
      outlineWidth: 6,
      shadowEnabled: true,
      shadowColor: "#7C3AED",
      shadowBlur: 14,
      shadowOpacity: 0.7,
      wordHighlight: true,
      highlightColor: "#FF3EC9",
      activeWordScale: 1.2,
    }),
    animation: a({ entrance: "pop", word: "scale", durationSec: 0.15 }),
  },
];

export function getPreset(id: string): SubtitlePresetDef | undefined {
  return BUILT_IN_PRESETS.find((p) => p.id === id);
}

export function presetsByCategory(category: PresetCategory): SubtitlePresetDef[] {
  return BUILT_IN_PRESETS.filter((p) => p.category === category);
}
