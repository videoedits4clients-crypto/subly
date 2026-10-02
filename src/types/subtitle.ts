// Core domain types shared across UI, preview rendering, and export rendering.
// These are plain, serializable objects — no React, no DOM, no ffmpeg types —
// so the same definitions work in the browser, in a Node API route, and (later)
// in an Electron/React Native context.

// Relative + extensioned (not the "@/..." alias used elsewhere in this file's own consumers)
// on purpose: several existing tests import this file directly by relative path under Node's
// native TS runner, which — unlike webpack — does not resolve "@/..." bare specifiers. A
// relative, extensioned import here works under both.
import { TRANSCRIPTION_LANGUAGE_POLICY_OPTIONS } from "../lib/language-policy.ts";

export interface Word {
  text: string;
  start: number; // seconds
  end: number; // seconds
  confidence?: number; // 0..1, when the transcription provider supplies it
  removed?: boolean; // soft-deleted by filler-word removal, kept for history
  /** Per-word style override — merged on top of the caption's own resolved style (global <- per-caption <- per-word), so a single word can have its own color/size/background independent of the active-word highlight animation. */
  style?: Partial<SubtitleStyle>;
  /** Romanized ("Hinglish") rendering of `text` for this one word, aligned 1:1 so its
   * start/end timestamps (and therefore word highlighting/animation) keep working
   * unchanged when the caption output mode is "hinglish" — see lib/subtitles/hinglish.ts
   * and lib/subtitles/output-mode.ts. Lazily generated the first time Hinglish mode is
   * turned on for a project; undefined for words that are original Latin/English text
   * (nothing to transliterate) or not yet generated. Independently user-editable —
   * editing it never touches `text`, which stays the untouched original transcript. */
  hinglishText?: string;
  /** Native Gujarati-script (U+0A80-0AFF) rendering of `text` for this one word, aligned
   * 1:1 so its start/end timestamps (and word highlighting/animation) keep working
   * unchanged when the caption output mode is "gujarati-script" — see
   * lib/subtitles/gujarati-script.ts and lib/subtitles/output-mode.ts. Lazily generated
   * the first time Gujarati Script mode is turned on for a project; undefined for words
   * with no Devanagari to convert, or not yet generated. This is a pure SCRIPT
   * conversion (Devanagari -> Gujarati Unicode block), never a linguistic correction,
   * translation, or spelling change — whatever Whisper produced is preserved verbatim,
   * just in Gujarati glyphs. Independently user-editable — editing it never touches
   * `text`, which stays the untouched original transcript. */
  gujaratiScriptText?: string;
}

export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;
export type TextCase = "none" | "uppercase" | "lowercase" | "sentence";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "center" | "bottom";

export interface SubtitleStyle {
  fontFamily: string;
  /** Which font source `fontFamily` came from — "system" means a font installed on this
   * Windows machine (see lib/fonts/system-fonts.ts), not one of the bundled Google Fonts.
   * Undefined (on projects saved before this existed) is treated as "bundled". Needed
   * because a system font and a bundled font can share the same family name (e.g. a
   * user-installed "Roboto"), so the family name alone can't tell export/rendering which
   * one was actually picked. */
  fontSource?: "bundled" | "system";
  fontSize: number; // in "video-relative" units: px at a reference height of 1920
  fontWeight: FontWeight;
  letterSpacing: number; // px at reference height
  lineHeight: number; // multiplier, e.g. 1.2
  textCase: TextCase;

  color: string; // hex/rgba
  highlightColor: string; // active-word color for karaoke highlighting
  opacity: number; // 0..1

  backgroundColor: string;
  backgroundOpacity: number; // 0..1
  backgroundRadius: number; // px at reference height
  backgroundPaddingX: number;
  backgroundPaddingY: number;
  boxWidthPercent: number; // max width of the caption box, % of frame width

  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;

  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowOpacity: number;

  // percentage-based position — resolution independent
  x: number; // 0..100, center of the box
  y: number; // 0..100, center of the box
  align: HAlign;
  vAlign: VAlign;

  wordHighlight: boolean; // karaoke-style active-word highlighting
  activeWordScale: number; // e.g. 1.12
}

export type EntranceAnimation =
  | "none"
  | "fade"
  | "pop"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "bounce"
  | "typewriter"
  | "word-pop"
  | "char-pop";

/** "slide" is the legacy value (saved projects reference it) and means slide-up, which is what the
 * export always tried to render; the four directional values are what the editor now offers. */
export type ExitAnimation = "none" | "fade" | "slide" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "pop";

export type WordAnimation =
  | "none"
  | "highlight"
  | "scale"
  | "bounce"
  | "color"
  | "underline"
  | "bg-highlight";

export interface AnimationConfig {
  entrance: EntranceAnimation;
  exit: ExitAnimation;
  word: WordAnimation;
  durationSec: number; // entrance/exit duration
}

export interface Subtitle {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  words: Word[];
  style?: Partial<SubtitleStyle>; // merged over project.globalStyle
  animation?: Partial<AnimationConfig>; // merged over project.animation
  /** Whole-caption Romanized ("Hinglish") rendering of `text` — same relationship to
   * `words[].hinglishText` as `text` has to `words[].text`. See Word.hinglishText and
   * lib/subtitles/output-mode.ts. `text` itself is NEVER overwritten by Hinglish mode:
   * this is purely a derived, reversible, independently-editable alternate view. */
  hinglishText?: string;
  /** Whole-caption native Gujarati-script rendering of `text` — same relationship to
   * `words[].gujaratiScriptText` as `text` has to `words[].text`. See
   * Word.gujaratiScriptText and lib/subtitles/output-mode.ts. `text` itself is NEVER
   * overwritten: this is purely a derived, reversible, independently-editable alternate
   * view — a script conversion only, never a translation or correction. */
  gujaratiScriptText?: string;
}

export interface TimingRules {
  minDuration: number; // seconds
  maxDuration: number; // seconds
  maxCharsPerLine: number;
  maxLines: number; // also "lines per caption" in the pre-transcription settings — a display/line-wrap preference, NOT the number of captions (see lib/subtitles/segment.ts)
  /** Hard upper bound on words in one caption — segmentation may break earlier (natural
   * pause/sentence/clause boundary, or the char/duration caps above) but never later.
   * See lib/subtitles/segment.ts. */
  maxWordsPerCaption: number;
  /** ON (default): prefer natural speech/sentence/clause boundaries and pauses when
   * deciding where to break, within maxWordsPerCaption. OFF: break as soon as
   * maxWordsPerCaption (or the char/duration caps) is reached, ignoring punctuation/pause
   * signals — still never exceeds maxWordsPerCaption. See lib/subtitles/segment.ts. */
  smartSegmentation: boolean;
}

export const DEFAULT_TIMING_RULES: TimingRules = {
  minDuration: 0.8,
  maxDuration: 5,
  maxCharsPerLine: 42,
  maxLines: 2,
  maxWordsPerCaption: 4,
  smartSegmentation: true,
};

/** Fills in defaults for any TimingRules field missing from a JSON-parsed value — needed
 * because a project saved before maxWordsPerCaption/smartSegmentation existed has neither
 * key in its stored JSON, and a plain `JSON.parse` (see lib/db-json.ts fromJson) does NOT
 * merge with a fallback, only substitutes it when the whole value is absent. Use this
 * wherever a project's stored timingRules JSON is turned back into a TimingRules object
 * (see lib/project-mapper.ts, lib/pipeline.ts). */
export function resolveTimingRules(parsed: Partial<TimingRules> | null | undefined): TimingRules {
  return { ...DEFAULT_TIMING_RULES, ...parsed };
}

/** Selector options for "Maximum words per caption" (pre-transcription settings + Settings tab). "Custom" is any other positive integer the user types in. */
export const MAX_WORDS_PER_CAPTION_OPTIONS = [2, 3, 4, 5, 6, 7, 8] as const;

/** Named quick-picks for the pre-transcription settings modal (spec section 6) — each is
 * just a shorthand for a TimingRules patch; picking one is equivalent to setting the same
 * fields by hand, and the underlying Advanced controls remain fully editable afterward. */
export const SEGMENTATION_PRESETS: {
  id: string;
  label: string;
  description: string;
  patch: Pick<TimingRules, "maxWordsPerCaption" | "maxLines" | "smartSegmentation">;
}[] = [
  { id: "social", label: "Social", description: "4 words, 2 lines, smart segmentation", patch: { maxWordsPerCaption: 4, maxLines: 2, smartSegmentation: true } },
  { id: "short", label: "Short", description: "2–3 words, 1 line", patch: { maxWordsPerCaption: 3, maxLines: 1, smartSegmentation: true } },
  { id: "balanced", label: "Balanced", description: "4 words, 2 lines", patch: { maxWordsPerCaption: 4, maxLines: 2, smartSegmentation: true } },
  { id: "long", label: "Long", description: "6–8 words, 2 lines", patch: { maxWordsPerCaption: 7, maxLines: 2, smartSegmentation: true } },
];

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Inter",
  fontSize: 64,
  fontWeight: 800,
  letterSpacing: 0,
  lineHeight: 1.15,
  textCase: "uppercase",

  color: "#FFFFFF",
  highlightColor: "#7C3AED",
  opacity: 1,

  backgroundColor: "#000000",
  backgroundOpacity: 0,
  backgroundRadius: 12,
  backgroundPaddingX: 20,
  backgroundPaddingY: 10,
  boxWidthPercent: 82,

  outlineEnabled: true,
  outlineColor: "#000000",
  outlineWidth: 6,

  shadowEnabled: true,
  shadowColor: "#000000",
  shadowBlur: 12,
  shadowOffsetX: 0,
  shadowOffsetY: 2,
  shadowOpacity: 0.5,

  x: 50,
  y: 82,
  align: "center",
  vAlign: "bottom",

  wordHighlight: true,
  activeWordScale: 1.12,
};

/** Fills in defaults for any SubtitleStyle field missing from a JSON-parsed (or otherwise
 * externally supplied) value — the same "merge with the canonical defaults" pattern
 * resolveTimingRules/resolveComposition already use above, for the identical reason: a plain
 * `fromJson` (lib/db-json.ts) does NOT merge with a fallback, only substitutes it when the
 * whole value is absent, so a stored/submitted globalStyle that's valid JSON but missing a
 * field (e.g. a malformed PATCH that replaced the whole object with a partial one) would
 * otherwise reach export with e.g. `color` genuinely `undefined` — confirmed to crash
 * lib/subtitles/ass.ts's assColorWithAlpha() (`hex.trim()` on undefined). A complete
 * SubtitleStyle passed in here is returned effectively unchanged, since every one of its keys
 * already overrides the corresponding default. */
export function resolveGlobalStyle(parsed: Partial<SubtitleStyle> | null | undefined): SubtitleStyle {
  return { ...DEFAULT_SUBTITLE_STYLE, ...parsed };
}

export const DEFAULT_ANIMATION: AnimationConfig = {
  entrance: "fade",
  exit: "none",
  word: "highlight",
  durationSec: 0.2,
};

export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5";

export const ASPECT_RATIO_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
};

/**
 * The composition canvas: the project's actual output dimensions, independent of both the
 * source video's native size and the legacy `aspectRatio` field (which no longer drives
 * rendering anywhere — see lib/ffmpeg/index.ts computeExportDimensions). Both the live
 * preview and MP4 export composite (in z-order, back to front) a solid background, an
 * optional video layer, and captions at these exact dimensions; the video, when shown, is
 * fit (never cropped/stretched) inside them — `object-contain` in video-canvas.tsx, and the
 * same `scale...decrease` + `pad` filter pair in lib/ffmpeg/index.ts's video-on export path,
 * so the two always show the same composition.
 */
export interface CompositionSettings {
  canvasWidth: number;
  canvasHeight: number;
  /** Composition/export setting, NOT deletion — the source video file is never touched.
   * When false, the preview and MP4 export show/render only the background + captions. */
  videoVisible: boolean;
  /** Hex color, e.g. "#000000". Visible behind the video wherever it doesn't cover the
   * canvas, and as the entire canvas when `videoVisible` is false. */
  backgroundColor: string;
}

export const DEFAULT_COMPOSITION: CompositionSettings = {
  canvasWidth: 1080,
  canvasHeight: 1920,
  videoVisible: true,
  backgroundColor: "#000000",
};

/** Fills in defaults for a JSON-parsed (possibly absent/partial) CompositionSettings — a
 * project saved before this feature existed has no `composition` JSON at all. Per spec,
 * such a project's canvas defaults to its SOURCE VIDEO's own dimensions (not a generic
 * fallback), so its existing framing doesn't silently change; a brand-new project with no
 * video yet falls back to the same 1080x1920 default as everything else. */
export function resolveComposition(
  parsed: Partial<CompositionSettings> | null | undefined,
  video?: { width: number; height: number },
): CompositionSettings {
  const hasVideoDims = !!video && video.width > 0 && video.height > 0;
  return {
    canvasWidth: parsed?.canvasWidth ?? (hasVideoDims ? video!.width : DEFAULT_COMPOSITION.canvasWidth),
    canvasHeight: parsed?.canvasHeight ?? (hasVideoDims ? video!.height : DEFAULT_COMPOSITION.canvasHeight),
    videoVisible: parsed?.videoVisible ?? DEFAULT_COMPOSITION.videoVisible,
    backgroundColor: parsed?.backgroundColor ?? DEFAULT_COMPOSITION.backgroundColor,
  };
}

export type SupportedLanguage =
  | "auto"
  | "en"
  | "hi"
  | "gu"
  | "mr"
  | "bn"
  | "ta"
  | "te"
  | "pa"
  | "ur"
  | "es"
  | "fr"
  | "de"
  | "pt"
  | "ar"
  | "ja"
  | "ko";

/** Real (non-"auto") transcription language codes — every one of these is passed straight
 * through to the local faster-whisper worker (see python/whisper_worker.py, which accepts
 * any Whisper-supported ISO-639-1 code, so this list is SUBLY's own curated subset of
 * Whisper's ~99 supported languages, not a technical limit of the model itself). Used for
 * both the post-transcription LanguageSwitcher and (via TRANSCRIPTION_LANGUAGE_OPTIONS
 * below) the pre-transcription settings modal. */
export const LANGUAGES: { code: Exclude<SupportedLanguage, "auto">; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "gu", label: "Gujarati" },
  { code: "mr", label: "Marathi" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

/** Task 137421 (P19.12) — the single source of truth for which language codes AI translation
 * (lib/ai.ts's translateSubtitles, and both /api/translate route handlers' own zod schemas) will
 * actually accept, isomorphic (usable from both the client-side Translate menu and the
 * server-side route validators) since it lives alongside LANGUAGES/SupportedLanguage rather than
 * in a server-only module. Fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md
 * §6: the Translate menu used to list every entry in LANGUAGES regardless of whether the backend
 * would accept it, so mr/bn/ta/te/pa/ur were selectable but always rejected with a misleading
 * "AI service temporarily unavailable" error. This is NOT an expansion of backend support — it is
 * the exact same 10 codes the two route handlers already validated against (previously
 * hand-duplicated as an identical z.enum literal in each), now named once. */
export const TRANSLATABLE_LANGUAGES = ["en", "hi", "gu", "es", "fr", "de", "pt", "ar", "ja", "ko"] as const satisfies readonly Exclude<SupportedLanguage, "auto">[];

/** Language choices for the PRE-transcription settings modal only — "Auto Detect" (Whisper
 * picks the language itself) plus every language the V1 language policy actually validates
 * for transcription (see lib/language-policy.ts — the ONE authoritative source for this list;
 * do not hand-edit this array independently of that file). Deliberately NOT every code in
 * LANGUAGES above: that catalog also serves the AI-translate target list and post-transcription
 * display labels, which are a different, unrestricted concern (translating already-transcribed
 * text via a cloud model, not local Whisper transcription quality). Never shown
 * post-transcription: once a project is READY, project.language already holds the concrete
 * code Whisper used (see lib/pipeline.ts), so "auto" never appears as a persisted,
 * post-transcription value. */
export const TRANSCRIPTION_LANGUAGE_OPTIONS: { code: SupportedLanguage; label: string }[] =
  TRANSCRIPTION_LANGUAGE_POLICY_OPTIONS as { code: SupportedLanguage; label: string }[];

/** What text a caption actually displays/exports as — see lib/subtitles/output-mode.ts.
 * "hinglish" reads each subtitle/word's `hinglishText` (falling back to the original
 * `text` for anything not yet transliterated, e.g. an English-only caption). "gujarati-script"
 * reads each subtitle/word's `gujaratiScriptText` the same way — only meaningful for a
 * Gujarati (language "gu") project, since that's the only script this converts FROM
 * Devanagari. Switching modes never touches the original transcript — it's purely which
 * field gets read. */
export type CaptionOutputMode = "original" | "hinglish" | "gujarati-script";

export interface ProjectData {
  id: string;
  name: string;
  status: "EMPTY" | "LOADING" | "TRANSCRIBING" | "READY" | "EDITING" | "EXPORTING" | "EXPORTED" | "ERROR";
  language: SupportedLanguage;
  aspectRatio: AspectRatio;
  /** Defaults to "original" — see CaptionOutputMode. */
  captionOutputMode: CaptionOutputMode;
  video?: {
    url: string;
    audioUrl?: string;
    originalName: string;
    duration: number;
    width: number;
    height: number;
    fps: number;
  };
  subtitles: Subtitle[];
  globalStyle: SubtitleStyle;
  animation: AnimationConfig;
  timingRules: TimingRules;
  /** The composition canvas — see CompositionSettings. */
  composition: CompositionSettings;
  errorMessage?: string;
  updatedAt: string;
  /** Non-destructive video editing — see lib/timeline/edit-model.ts. */
  trimStart: number;
  trimEnd: number | null;
  cutRanges: CutRange[];
}

export interface CutRange {
  id: string;
  start: number;
  end: number;
  reason: "trim" | "filler" | "silence" | "manual";
}

/**
 * The text a caption's word is DISPLAYED with: applyTextCase, except that "sentence" case capitalises
 * only the caption's FIRST word. applyTextCase works on one word at a time, so applying it to every
 * word made "sentence" behave as Title Case ("Every Great Story Begins With One Single Word") in the
 * preview, the picker and the export alike. `wordIndex` is the word's position among the caption's
 * visible (non-removed) words.
 */
export function applyWordTextCase(text: string, textCase: TextCase, wordIndex: number): string {
  return textCase === "sentence" && wordIndex > 0 ? text : applyTextCase(text, textCase);
}

export function applyTextCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case "uppercase":
      return text.toLocaleUpperCase();
    case "lowercase":
      return text.toLocaleLowerCase();
    case "sentence":
      return text.charAt(0).toLocaleUpperCase() + text.slice(1);
    default:
      return text;
  }
}

export function resolveStyle(project: Pick<ProjectData, "globalStyle">, sub: Subtitle): SubtitleStyle {
  return { ...project.globalStyle, ...(sub.style ?? {}) };
}

export function resolveAnimation(project: Pick<ProjectData, "animation">, sub: Subtitle): AnimationConfig {
  return { ...project.animation, ...(sub.animation ?? {}) };
}
