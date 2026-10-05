import type { AnimationConfig, Subtitle, SubtitleStyle } from "../types/subtitle.ts";
import { getPreset, type StyleFamily } from "./presets.ts";

/**
 * Caption templates (P22): a small curated set of COMPLETE caption treatments — a base built-in style plus the
 * motion and emphasis recipe that goes with it — that can be applied to the selected captions, several captions or
 * the whole project in one click and undone in one step.
 *
 * A template adds NO rendering properties. It is a composition of what already exists:
 *
 *   resolveTemplate(t) = { style: { ...preset(t.base).style, ...t.style },   // a SubtitleStyle
 *                          animation: { ...preset(t.base).animation, ...t.animation } } // an AnimationConfig
 *
 * so everything downstream — the live preview, the ASS export, the style/animation panels, autosave, undo — sees
 * ordinary style/animation objects and cannot tell a template from hand-tuned settings. Templates are built-in
 * (code, not data): nothing about them is persisted; the RESULT of applying one lives in the project like any
 * other style change. Custom (user-saved) presets keep their own existing mechanism (lib/custom-presets.ts).
 *
 * The family is the existing 12-family taxonomy (lib/presets.ts STYLE_FAMILIES) — a template's family must equal its
 * base preset's, enforced by tests — so the picker's filter chips are the same vocabulary as the style picker's.
 */

export interface CaptionTemplate {
  id: string;
  name: string;
  description: string;
  /** Why this template exists — what situation it is the right pick for, and how it differs from its neighbours. */
  purpose: string;
  family: StyleFamily;
  tags: string[];
  /** Id of the built-in preset supplying the typography, position and container. */
  base: string;
  /** Overrides on the base style — only the emphasis configuration the template needs (word highlight on/off, colour, scale). */
  style?: Partial<SubtitleStyle>;
  /** The template's complete motion recipe: entrance, exit, word treatment and duration. */
  animation: AnimationConfig;
}

export interface ResolvedTemplate {
  style: SubtitleStyle;
  animation: AnimationConfig;
}

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  // ───────────── Creator ─────────────
  {
    id: "creator-punch",
    name: "Creator Punch",
    description: "Giant Anton caps low in the frame, yellow springy bounce on the spoken word.",
    purpose: "The loud, high-energy short-form look. Lower-third placement and a bouncing entrance; the one to pick for hype and commentary.",
    family: "bold-creator",
    tags: ["shorts", "reels", "tiktok", "high-energy", "outlined"],
    base: "mrbeast",
    animation: { entrance: "bounce", exit: "none", word: "bounce", durationSec: 0.25 },
  },
  {
    id: "creator-bold",
    name: "Creator Bold",
    description: "Heavy caps in the middle of the frame; each word scales up as it is spoken.",
    purpose: "Hook lines and statements that should own the screen. Centre-frame rather than lower-third, with a pop-in and a scale emphasis.",
    family: "bold-creator",
    tags: ["hook", "statement", "centre-frame", "outlined"],
    base: "bold",
    animation: { entrance: "pop", exit: "none", word: "scale", durationSec: 0.2 },
  },
  // ───────────── Karaoke ─────────────
  {
    id: "karaoke-focus",
    name: "Karaoke Focus",
    description: "Dimmed grey caps; the word being spoken lights up white.",
    purpose: "Readable long captions where the viewer's eye should follow along without anything moving. Colour-only emphasis, a soft fade between captions.",
    family: "karaoke",
    tags: ["follow-along", "lyrics", "calm", "colour-only"],
    base: "word-focus",
    animation: { entrance: "fade", exit: "none", word: "color", durationSec: 0.2 },
  },
  {
    id: "karaoke-pop",
    name: "Karaoke Pop",
    description: "White caps with a coloured chip that jumps from word to word.",
    purpose: "Sing-along and tutorial captions where the active word needs a strong, boxed marker. The chip (not colour or scale) is its signature.",
    family: "karaoke",
    tags: ["sing-along", "chip", "tutorial", "high-contrast"],
    base: "highlight",
    animation: { entrance: "pop", exit: "none", word: "bg-highlight", durationSec: 0.15 },
  },
  // ───────────── Podcast ─────────────
  {
    id: "podcast-clean",
    name: "Podcast Clean",
    description: "Sentence-case text on a dark left-aligned lower-third panel.",
    purpose: "Long-form talking-head video: highly readable, left-aligned like a broadcast lower third, sliding up and fading out so it never distracts.",
    family: "podcast",
    tags: ["interview", "talking-head", "lower-third", "readable"],
    base: "podcast",
    animation: { entrance: "slide-up", exit: "fade", word: "color", durationSec: 0.3 },
  },
  {
    id: "podcast-highlight",
    name: "Podcast Highlight",
    description: "Uppercase captions on a full-width dark bar with a purple chip on the active word.",
    purpose: "Clips lifted from podcasts for social: centred and bar-backed like a video caption, with the spoken word boxed so it reads at phone size.",
    family: "podcast",
    tags: ["clip", "audiogram", "bar", "chip"],
    base: "youtube",
    style: { wordHighlight: true, highlightColor: "#7C3AED" },
    animation: { entrance: "fade", exit: "fade", word: "bg-highlight", durationSec: 0.2 },
  },
  // ───────────── Cinematic ─────────────
  {
    id: "cinematic-title",
    name: "Cinematic Title",
    description: "Wide-tracked uppercase sans with a soft glow, rising into place.",
    purpose: "Trailers, teasers and title cards: spaced capitals that rise slowly (0.6 s) and fade out. A statement, not a transcript.",
    family: "cinematic",
    tags: ["trailer", "title", "film", "slow"],
    base: "film-title",
    animation: { entrance: "slide-up", exit: "fade", word: "none", durationSec: 0.6 },
  },
  {
    id: "cinematic-minimal",
    name: "Cinematic Minimal",
    description: "Sentence-case serif subtitles that fade in and out, low in the frame.",
    purpose: "Film-style dialogue subtitles: understated serif type with a quiet fade, for footage that should stay in front.",
    family: "cinematic",
    tags: ["film", "dialogue", "serif", "subtle"],
    base: "cinematic",
    animation: { entrance: "fade", exit: "fade", word: "none", durationSec: 0.4 },
  },
  // ───────────── Social (Sticker family) ─────────────
  {
    id: "social-pop",
    name: "Social Pop",
    description: "Dark playful type on a solid yellow chip that pops in.",
    purpose: "Friendly, lifestyle and explainer posts: a solid sticker behind the text keeps it legible on any footage. No word emphasis — the chip is the style.",
    family: "sticker",
    tags: ["lifestyle", "sticker", "legible", "playful"],
    base: "sticker",
    animation: { entrance: "pop", exit: "none", word: "none", durationSec: 0.2 },
  },
  {
    id: "social-bounce",
    name: "Social Bounce",
    description: "Pink rounded type with a thick outline; words scale with a bounce.",
    purpose: "Playful, youthful content without a box: outlined candy colours and a bouncing entrance plus a scale on the spoken word.",
    family: "sticker",
    tags: ["playful", "outlined", "youth", "bounce"],
    base: "candy-pop",
    animation: { entrance: "bounce", exit: "none", word: "scale", durationSec: 0.25 },
  },
  // ───────────── Editorial / News ─────────────
  {
    id: "editorial-serif",
    name: "Editorial Serif",
    description: "Sentence-case Playfair, left-aligned low in the frame.",
    purpose: "Essays, interviews and brand films: serif type placed like a magazine caption, fading gently in and out.",
    family: "editorial",
    tags: ["serif", "magazine", "brand", "left-aligned"],
    base: "editorial",
    animation: { entrance: "fade", exit: "fade", word: "none", durationSec: 0.5 },
  },
  {
    id: "news-bar",
    name: "News Bar",
    description: "White uppercase Oswald on a solid red bar that slides in from the right.",
    purpose: "News, updates and announcements: a broadcast-style solid bar across the lower frame that reads as 'information'.",
    family: "documentary",
    tags: ["news", "broadcast", "bar", "announcement"],
    base: "news",
    animation: { entrance: "slide-left", exit: "none", word: "none", durationSec: 0.2 },
  },
  // ───────────── Meme ─────────────
  {
    id: "meme-impact",
    name: "Meme Impact",
    description: "Enormous white Anton at the very top of the frame with a heavy black outline.",
    purpose: "Classic top-text memes and reaction clips: the biggest type in the library, hard-edged, popping in instantly.",
    family: "meme",
    tags: ["meme", "reaction", "top-text", "outlined"],
    base: "meme-impact",
    animation: { entrance: "pop", exit: "none", word: "none", durationSec: 0.12 },
  },
  // ───────────── Comic ─────────────
  {
    id: "comic-burst",
    name: "Comic Burst",
    description: "Bangers comic lettering high in the frame; each word bursts bigger as it is spoken.",
    purpose: "Cartoon-style comedy and kids' content: comic-book lettering placed high in the frame with a springy word-by-word burst — the playful alternative to the meme caption.",
    family: "comic",
    tags: ["comic", "comedy", "kids", "word-by-word"],
    base: "comic",
    animation: { entrance: "word-pop", exit: "none", word: "scale", durationSec: 0.12 },
  },
  // ───────────── Handwritten / Minimal ─────────────
  {
    id: "handwritten-marker",
    name: "Handwritten Marker",
    description: "Kalam marker lettering at the top-left, sliding in with a bouncing pink word.",
    purpose: "Notes, doodle-style explainers and personal vlogs: organic, off-centre lettering that feels drawn rather than typeset.",
    family: "handwritten",
    tags: ["vlog", "notes", "organic", "top-left"],
    base: "handwritten-marker",
    animation: { entrance: "slide-right", exit: "fade", word: "bounce", durationSec: 0.4 },
  },
  {
    id: "minimal-clean",
    name: "Minimal Clean",
    description: "Small DM Sans sentence-case captions with a soft shadow, just appearing.",
    purpose: "When the footage is the star: the quietest template — small, still, no emphasis, no motion beyond appearing.",
    family: "minimal",
    tags: ["quiet", "footage-first", "subtle", "no-motion"],
    base: "minimal",
    animation: { entrance: "none", exit: "none", word: "none", durationSec: 0.2 },
  },
];

export function getTemplate(id: string): CaptionTemplate | undefined {
  return CAPTION_TEMPLATES.find((t) => t.id === id);
}

/** The families that have at least one template, in the library's own family order — the picker's filter chips. */
export function templateFamilies(order: readonly StyleFamily[]): StyleFamily[] {
  return order.filter((f) => CAPTION_TEMPLATES.some((t) => t.family === f));
}

/** Templates of one family (all of them when `family` is "all"), optionally narrowed by a case-insensitive search over name, tags and description. */
export function filterTemplates(family: StyleFamily | "all", search = ""): CaptionTemplate[] {
  const q = search.trim().toLowerCase();
  return CAPTION_TEMPLATES.filter(
    (t) => (family === "all" || t.family === family) && (!q || `${t.name} ${t.tags.join(" ")} ${t.description}`.toLowerCase().includes(q)),
  );
}

/** The ordinary SubtitleStyle + AnimationConfig a template stands for. Always fresh objects: applying a template copies, never shares. */
export function resolveTemplate(template: CaptionTemplate): ResolvedTemplate {
  const preset = getPreset(template.base);
  if (!preset) throw new Error(`Template "${template.id}" references unknown preset "${template.base}"`);
  return { style: { ...preset.style, ...template.style }, animation: { ...preset.animation, ...template.animation } };
}

// ───────────────────────── applying ─────────────────────────

/** Which captions a template is applied to: every caption (and the project default), or a specific set. */
export type TemplateTarget = { all: true } | { ids: string[] };

/** The slice of the editor's history snapshot a template can touch. */
export interface TemplateSnapshot {
  globalStyle: SubtitleStyle;
  animation: AnimationConfig;
  subtitles: Subtitle[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies a resolved template and returns the new snapshot — or the SAME snapshot object when nothing would
 * change (so re-applying the active template creates no history step).
 *
 *  - `{ ids }`  — each listed caption gets the template's complete style and animation as its own override.
 *  - `{ all }`  — the project defaults become the template and every caption's own style/animation override is
 *                 cleared, so afterwards every caption really looks like the template.
 *
 * Only style and animation are written. Caption text, timing, word timestamps, order and ids, per-word manual
 * styling (`word.style`), and every other project field are untouched (the same objects are returned for them).
 */
export function applyTemplateToSnapshot<T extends TemplateSnapshot>(snap: T, target: TemplateTarget, resolved: ResolvedTemplate): T {
  const style = { ...resolved.style };
  const animation = { ...resolved.animation };
  if ("all" in target) {
    const clean = snap.subtitles.every((s) => s.style === undefined && s.animation === undefined);
    if (clean && same(snap.globalStyle, style) && same(snap.animation, animation)) return snap;
    return {
      ...snap,
      globalStyle: style,
      animation,
      subtitles: snap.subtitles.map((s) => (s.style === undefined && s.animation === undefined ? s : { ...s, style: undefined, animation: undefined })),
    };
  }
  const ids = new Set(target.ids);
  let changed = false;
  const subtitles = snap.subtitles.map((s) => {
    if (!ids.has(s.id)) return s;
    if (same(s.style, style) && same(s.animation, animation)) return s;
    changed = true;
    return { ...s, style: { ...style }, animation: { ...animation } };
  });
  return changed ? { ...snap, subtitles } : snap;
}

/** How many captions a template application would restyle (0 = nothing to do). */
export function countTemplateTargets(subtitles: Pick<Subtitle, "id">[], target: TemplateTarget): number {
  if ("all" in target) return subtitles.length;
  const ids = new Set(target.ids);
  return subtitles.filter((s) => ids.has(s.id)).length;
}

/** True when a caption's effective style/animation already equals the template's (for the picker's "applied" ring). */
export function templateMatches(template: CaptionTemplate, effective: { style: SubtitleStyle; animation: AnimationConfig }): boolean {
  const r = resolveTemplate(template);
  return same(r.style, effective.style) && same(r.animation, effective.animation);
}
