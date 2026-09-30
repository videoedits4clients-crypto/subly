import type { SubtitleStyle } from "../../types/subtitle.ts";

/**
 * Task 110184 (P18.3) — classifies every `SubtitleStyle` property for word-level
 * (`Word.style`) support, per the audit in research/p18_3_word_style_parity_report.md §4-5:
 *
 * - "supported": wired end-to-end — editor mutation (setWordStyleOverride), live preview
 *   (subtitle-overlay.tsx's wordDynamicStyle), AND ASS export (ass.ts's wordStyleTag).
 * - "editor-only": wired in the editor mutation path and live preview, but NOT
 *   representable in ASS/libass export (documented, pre-existing gap — not new).
 * - "unsafe": exposing this as a per-word override would be semantically ambiguous,
 *   redundant with an existing mechanism, or only partially supported in a way that
 *   would silently diverge between preview and export.
 * - "unsupported": conceptually could be wired, but isn't today, and doing so would
 *   require new preview/export plumbing beyond this task's bounded scope.
 * - "export-supported": reserved for a property wired in export but not preview; no
 *   current property falls in this bucket.
 */
export type WordStyleCapability = "supported" | "editor-only" | "unsafe" | "unsupported" | "export-supported";

export interface WordStyleCapabilityInfo {
  capability: WordStyleCapability;
  reason: string;
}

const WORD_STYLE_CAPABILITIES: Partial<Record<keyof SubtitleStyle, WordStyleCapabilityInfo>> = {
  color: {
    capability: "supported",
    reason: "Editor: setWordStyleOverride. Preview: wordDynamicStyle reads word.style.color. Export: wordStyleTag emits \\c.",
  },
  fontSize: {
    capability: "supported",
    reason: "Editor: setWordStyleOverride. Preview: wordDynamicStyle sets fontSize in px. Export: wordStyleTag emits a relative \\fscx\\fscy scale against the caption's base fontSize.",
  },
  fontWeight: {
    capability: "supported",
    reason:
      "Editor: setWordStyleOverride (P18.3 adds the Bold UI control). Preview: wordDynamicStyle sets CSS font-weight directly. Export: wordStyleTag emits \\b1/\\b0 at the 700 threshold — coarser than preview's continuous weight, but this binary reduction is the SAME approximation the property already used before P18.3, not a new gap.",
  },
  backgroundColor: {
    capability: "editor-only",
    reason: "Editor + preview via wordDynamicStyle. Export: wordStyleTag explicitly documents 'ASS has no per-run background box' — full fidelity in the live preview only, a pre-existing documented gap.",
  },
  backgroundOpacity: {
    capability: "editor-only",
    reason: "Only meaningful coupled with backgroundColor (style-panel.tsx always sets both together); same ASS per-run background box limitation.",
  },
  opacity: {
    capability: "unsafe",
    reason:
      "Export (ass.ts wordStyleTag) only applies word-level opacity as a modifier INSIDE the wordStyle.color branch — opacity alone (no color override) does nothing on export. Preview (wordDynamicStyle) doesn't read word.style.opacity at all. Exposing this alone would silently diverge between preview (no effect) and export (no effect unless color is also overridden) — not extended.",
  },
  highlightColor: {
    capability: "unsafe",
    reason:
      "Caption-level highlightColor parameterizes the AUTOMATIC active-word-highlight mechanism (activeWordCss/wordOverride), which already yields to a word's manual color override via {...active, ...manual} precedence. A per-word highlightColor would be a second, redundant color knob for the same visual outcome as word.style.color — ambiguous, not a genuine per-word appearance property.",
  },
  wordHighlight: {
    capability: "unsafe",
    reason: "A boolean mode switch for the whole caption's karaoke-highlighting mechanism, not a per-word appearance value — 'highlighting on for word 3, off for the rest' isn't a coherent state.",
  },
  activeWordScale: {
    capability: "unsafe",
    reason: "Parameterizes the automatic active-word highlight mechanism (how much the CURRENTLY PLAYING word scales up), not a static per-word property — redundant with/ambiguous against a manual per-word fontSize override.",
  },
  lineHeight: {
    capability: "unsafe",
    reason: "Line height governs vertical spacing between wrapped lines of the whole caption block — semantically meaningless for a single word within a line.",
  },
  boxWidthPercent: {
    capability: "unsafe",
    reason: "Governs the max width of the whole caption box's layout — not a per-word appearance property.",
  },
  x: {
    capability: "unsafe",
    reason: "Caption box position on screen. A per-word override would mean word-level positioning/dragging, which is explicitly out of scope for P18.3 (no word dragging).",
  },
  y: {
    capability: "unsafe",
    reason: "Same as x — caption box position, not a per-word property; word dragging is explicitly out of scope.",
  },
  align: {
    capability: "unsafe",
    reason: "Caption box text alignment — not meaningful for a single word.",
  },
  vAlign: {
    capability: "unsafe",
    reason: "Caption box vertical alignment — not meaningful for a single word.",
  },
  backgroundRadius: {
    capability: "unsupported",
    reason: "The existing word-level background override already hardcodes its own padding/radius in preview (subtitle-overlay.tsx) independent of the caption's backgroundRadius/PaddingX/PaddingY, and — like backgroundColor — has no ASS per-run box representation at all, so a separate per-word control would have no export path and no current editor demand.",
  },
  backgroundPaddingX: { capability: "unsupported", reason: "Same reasoning as backgroundRadius." },
  backgroundPaddingY: { capability: "unsupported", reason: "Same reasoning as backgroundRadius." },
  fontFamily: {
    capability: "unsupported",
    reason:
      "Preview's resolveFontFamilyCss is always called with the CAPTION-level style.fontFamily, and layers its own automatic per-word script-based fallback (Devanagari/Gujarati) on top of it — a manual per-word override would need new plumbing through resolveFontFamilyCss AND the export font-manifest collection (collectRequiredFonts in ass.ts) to bundle the extra font file. Conceptually possible, but beyond this task's bounded scope.",
  },
  fontSource: { capability: "unsupported", reason: "Tightly coupled to fontFamily (which bundled/system font file to load) — same scope reasoning." },
  letterSpacing: {
    capability: "supported",
    reason:
      "Task 131508 (P19.8): Editor: setWordStyleOverride (style-panel.tsx's Word overrides section, same min=-2/max=12 range as the caption-level control). Preview: wordDynamicStyle sets CSS letterSpacing in px on the word's own span. Export: wordStyleTag emits an absolute \\fsp<value> tag, scaled by the same playResY/REFERENCE_HEIGHT factor as the caption-level Style-line Spacing field, reset by the existing {\\r} after each word's run. Verified end-to-end including a real exported MP4 frame.",
  },
  textCase: {
    capability: "unsupported",
    reason: "Caption-level textCase is applied via CSS text-transform (preview) and by transforming the literal text characters before building the ASS Dialogue line (export) — the latter operates on the whole line's text string, not a per-word substring. A per-word override would need new substring-level text-transform plumbing in the export path. Does not mutate Original text either way, but out of bounded scope.",
  },
  outlineEnabled: {
    capability: "unsupported",
    reason:
      "ASS supports per-run outline overrides (\\3c/\\bord), so this is technically representable in export. But preview's outline is an 8-direction CSS text-shadow trick applied at the caption CONTAINER level (styleToTextCss), not per inline word span — a per-word outline override would need new preview architecture. Out of bounded scope.",
  },
  outlineColor: { capability: "unsupported", reason: "Same reasoning as outlineEnabled." },
  outlineWidth: { capability: "unsupported", reason: "Same reasoning as outlineEnabled." },
  shadowEnabled: {
    capability: "unsupported",
    reason: "Same category as outline — caption-container-level CSS text-shadow in preview, ASS \\shad/\\4c tags exist for export but preview has no per-word path. Out of bounded scope.",
  },
  shadowColor: { capability: "unsupported", reason: "Same reasoning as shadowEnabled." },
  shadowBlur: { capability: "unsupported", reason: "Same reasoning as shadowEnabled." },
  shadowOffsetX: { capability: "unsupported", reason: "Same reasoning as shadowEnabled." },
  shadowOffsetY: { capability: "unsupported", reason: "Same reasoning as shadowEnabled." },
  shadowOpacity: { capability: "unsupported", reason: "Same reasoning as shadowEnabled." },
};

/** Classifies one `SubtitleStyle` property for word-level override support. A property
 * absent from the internal map (i.e. every property not listed above) is "unsupported"
 * by default — this module doesn't need an entry for every possible key to be correct. */
export function getWordStyleCapability(property: keyof SubtitleStyle): WordStyleCapability {
  return WORD_STYLE_CAPABILITIES[property]?.capability ?? "unsupported";
}

export function getWordStyleCapabilityReason(property: keyof SubtitleStyle): string | undefined {
  return WORD_STYLE_CAPABILITIES[property]?.reason;
}

/** Properties actually exposed to the word-level style UI (WordTimingPopover / style-panel's
 * Word overrides section) — the "supported" and "editor-only" sets, i.e. everything that's
 * real end-to-end or at least editor+preview-consistent. "unsafe" and "unsupported"
 * properties are never offered as word overrides. */
export function isWordStyleUiEligible(property: keyof SubtitleStyle): boolean {
  const capability = getWordStyleCapability(property);
  return capability === "supported" || capability === "editor-only";
}

/** Resolves one property's EFFECTIVE value for a word: the word's own override if it has
 * one, else the caption's (already-fully-resolved) style. Mirrors the {...active, ...manual}
 * / {...w.style, ...patch} precedent used elsewhere — word override always wins. */
export function resolveEffectiveWordStyleValue<K extends keyof SubtitleStyle>(
  captionStyle: SubtitleStyle,
  wordStyle: Partial<SubtitleStyle> | undefined,
  property: K,
): SubtitleStyle[K] {
  const override = wordStyle?.[property];
  return override !== undefined ? override : captionStyle[property];
}

/** True if the word has an explicit override for this specific property (as opposed to
 * inheriting the caption's value). Distinct from "the word has ANY override" — a word can
 * override color while still inheriting fontWeight. */
export function isWordStylePropertyOverridden(wordStyle: Partial<SubtitleStyle> | undefined, property: keyof SubtitleStyle): boolean {
  return wordStyle?.[property] !== undefined;
}

/** Merges a single-property patch onto a word's existing style override, the same way
 * setWordStyleOverride's own `{...w.style, ...patch}` merge does — except that if the
 * result would leave every property undefined (e.g. un-setting the one property that was
 * ever overridden, via `{ fontWeight: undefined }`), it collapses to `null` instead of a
 * stray, effectively-empty-but-truthy style object. That distinction matters because
 * style-panel.tsx's word-chip selector uses a plain `word.style &&` truthiness check to
 * show the "has an override" underline — an object like `{ fontWeight: undefined }` would
 * pass that check despite overriding nothing, so callers that might unset the LAST
 * remaining override property (e.g. a Bold toggle) should route the result through this
 * helper before calling setWordStyleOverride, rather than merging by hand. */
export function mergeWordStyleOverride(existing: Partial<SubtitleStyle> | undefined, patch: Partial<SubtitleStyle>): Partial<SubtitleStyle> | null {
  const merged = { ...existing, ...patch };
  const hasAnyValue = Object.values(merged).some((v) => v !== undefined);
  return hasAnyValue ? merged : null;
}
