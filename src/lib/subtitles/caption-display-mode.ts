/**
 * Task 105631 (P17) — the explicit, single-source-of-truth contract for what is and isn't safe
 * to do in each caption display mode (`CaptionOutputMode` — see types/subtitle.ts). Pure, no
 * React, no store: a plain capability table plus a couple of small accessor functions, consumed
 * by captions-panel.tsx and word-timing-popover.tsx so the UI's own gating logic reads from ONE
 * place instead of scattered `isHinglish`/`isGujaratiScript` booleans.
 *
 * WHY THIS EXISTS (the P16.1 finding this task closes): captions-panel.tsx used to hide word
 * chips entirely outside "original" mode, with no stated reason beyond "out of scope." This
 * module is the result of actually auditing whether word-level operations are safe in a derived
 * mode, per operation, using two concrete pieces of evidence already present in the shipped app
 * BEFORE this task touched anything:
 *
 *  1. `lib/subtitles/hinglish.ts`/`gujarati-script.ts` are both PURE, PER-WORD, 1:1 transforms —
 *     transliteration/script-remapping never changes word COUNT or word ORDER, and every derived
 *     word shares its ORIGINAL word's own `start`/`end`. So `words[i].hinglishText`/
 *     `words[i].gujaratiScriptText` always describes the SAME time span as `words[i].text` — the
 *     mapping is exact, not approximate, for any word that already has one generated.
 *  2. `components/editor/timeline.tsx`'s own `TimelineWordHandles` ALREADY selects, displays, and
 *     retimes (drag-to-adjust start/end) the SELECTED caption's words in every mode — completely
 *     unconditionally, no `isHinglish`/`isGujaratiScript` gate at all — and has shipped that way
 *     since Task 92618/102741 (P7.2/P15). It works because `updateWordTiming` (editor-store.ts)
 *     looks up the REAL subtitle by id and only ever writes `.start`/`.end` on `words[wordIndex]`
 *     — it never reads or writes `.text` at all, so which script is currently DISPLAYED is
 *     irrelevant to whether that mutation is safe. This is proof by existing, shipped behavior,
 *     not a new argument: word SELECTION and word TIMING ADJUSTMENT are already known-safe in
 *     every mode, today, on the timeline — this module (and captions-panel.tsx) brings the
 *     captions-panel's own popover UI up to that SAME, already-proven bar.
 *
 * Task 106284 (P17.1) revisited two of these four operations, per-operation, the same way this
 * module originally decided word chips/timing:
 *   - Split and Insert both require CREATING new `Word.text` content (a token boundary, or a
 *     brand-new word's text) with no deterministic, non-fabricated way to derive it from ROMANIZED
 *     Hinglish or Gujarati-script input — these stay Original-only, permanently (see each field's
 *     own doc comment below).
 *   - Delete never creates text at all (only removes a whole word and lets a neighbor's timing
 *     absorb the gap — `deleteWordConservative`), and operates by INDEX, which the 1:1 derived
 *     mapping (point 1 above) makes exactly as safe as the timeline's own already-proven
 *     selection/timing behavior. Now available in every mode.
 *   - Merge never invents a boundary either (it only joins two ALREADY-COMPLETE words), and as of
 *     P17.1 `mergeWords` (lib/subtitles/word-edit.ts) preserves `hinglishText`/`gujaratiScriptText`
 *     by the same join rule as `.text` whenever BOTH source words already have a real value for
 *     that field — never fabricating one when either is missing. Now available in every mode.
 * See this module's own `CaptionDisplayModeCapabilities` fields below for the precise,
 * per-operation breakdown, `research/p17_caption_display_modes_report.md` for the original audit,
 * and `research/p17_1_derived_word_state_report.md` for this revision's own reasoning.
 */
import type { CaptionOutputMode } from "../../types/subtitle.ts";

export interface CaptionDisplayModeCapabilities {
  /** Which `Subtitle`/`Word` field this mode actually displays. */
  textSource: "text" | "hinglishText" | "gujaratiScriptText";
  /** True only for "original" — the one mode whose text source IS the authoritative transcript
   * (see types/subtitle.ts Word.text's own doc comment: "the untouched original transcript"). */
  isAuthoritative: boolean;
  /** Whether the caption-level textarea can be edited at all while in this mode. True for every
   * mode — a derived mode's own text (hinglishText/gujaratiScriptText) is independently
   * user-editable (see Word.hinglishText's doc comment) — but see `textEditWritesAuthoritativeText`
   * for WHICH field an edit actually lands in. */
  captionTextEditable: boolean;
  /** True only for "original": editing the caption-level textarea in THIS mode writes the
   * authoritative `text`/`words[].text` fields. False for "hinglish"/"gujarati-script": editing
   * the textarea in those modes writes ONLY `hinglishText`/`gujaratiScriptText` (see
   * editor-store.ts's updateSubtitleHinglishText/updateSubtitleGujaratiScriptText) — the
   * authoritative `text` field is never touched, exactly matching this task's own explicit
   * "derived representations must NOT silently overwrite or corrupt the authoritative Original
   * text" safety principle. Already correctly routed by the pre-existing UI before this task; this
   * field documents that fact, it doesn't change it. */
  textEditWritesAuthoritativeText: boolean;
  /** Whether word chips can be shown/selected in this mode. True in every mode as of P17 — see
   * this module's own top-of-file doc comment for why this is provably safe (the per-word derived
   * text is a stable, 1:1, same-timestamp view; the timeline's own word handles already prove
   * selection/timing-drag is safe in any mode). */
  wordChipsVisible: boolean;
  /** Whether a word's own start/end can be adjusted (nudge buttons, numeric input, or the
   * timeline's own drag handles) in this mode. True in every mode — `updateWordTiming` never reads
   * or writes any text field, only `.start`/`.end` on the real, underlying word by index (see this
   * module's own top-of-file doc comment, point 2). */
  wordTimingEditable: boolean;
  /** Whether the word-timing popover's Split control is available. Original-only — see this
   * module's own top-of-file doc comment for why splitting derived text has no safe mapping back
   * onto the authoritative original word. */
  wordSplitAllowed: boolean;
  /** Whether the word-timing popover's Merge control is available. Task 106284 (P17.1): available
   * in EVERY mode — a merge never invents a token boundary, it only joins two already-complete
   * words, and `mergeWords` (lib/subtitles/word-edit.ts) now preserves `hinglishText`/
   * `gujaratiScriptText` by the same join-by-space rule as `.text` whenever BOTH source words
   * already have a real value for that field (never fabricating one when either is missing — see
   * that function's own doc comment). The underlying store action always operates on the real,
   * authoritative `words[].text` regardless of which mode is displayed, exactly like Delete below. */
  wordMergeAllowed: boolean;
  /** Whether the word-timing popover's Delete control is available. Task 106284 (P17.1): available
   * in EVERY mode — deletion never fabricates text (it only removes a whole word and lets a
   * neighbor's timing absorb the gap — see `deleteWordConservative`) and operates purely by INDEX,
   * which the derived transforms' proven 1:1 word-count/order mapping (see this module's own
   * top-of-file doc comment, point 1) makes exactly as safe as the timeline's own already-shipped
   * selection/timing behavior. Deleting a word shown in a derived mode deletes the SAME real word
   * the Original transcript has at that position — the popover surfaces a short clarification of
   * that (see `word-timing-popover.tsx`), not a confirmation dialog. */
  wordDeleteAllowed: boolean;
  /** Whether the word-timing popover's Insert Before/After controls are available. Original-only —
   * inserting a word requires SOME text for its `Word.text` field, and there is no non-fabricated
   * source for that text in a derived mode (typing a new Hinglish/Gujarati-script word gives no
   * way to derive real Devanagari original text for it). See this module's own top-of-file doc
   * comment. */
  wordInsertAllowed: boolean;
  /** Task 113528 (P18.6): whether a word can be moved to a different position within the
   * caption (Move Left/Move Right). Available in EVERY mode, same reasoning as Merge/Delete
   * above: reorder fabricates no new `Word.text` (it moves complete, already-existing word
   * objects — text, timing, confidence, style, removed, derived fields all travel together) and
   * operates purely by INDEX, which the derived transforms' proven 1:1 word-count/order mapping
   * (this module's own top-of-file doc comment, point 1) makes exactly as safe as Merge/Delete's
   * own already-established "operates on the real underlying word regardless of what's
   * displayed" behavior.
   *
   * One thing reorder must still guard against that Merge/Delete don't: the EXISTING P17.1
   * staleness check (`getDerivedWordTextSyncStatus`, output-mode.ts) is purely WORD-COUNT-based
   * (`wordTokenCount === captionTokenCount`) — Delete/Merge/Split/Insert all change the count, so
   * that check reliably catches them. Reorder changes ORDER but never COUNT, the one case that
   * check was never designed to detect: a caption-level `hinglishText`/`gujaratiScriptText`
   * string generated from the OLD word order would otherwise keep reading as "fresh" after a
   * reorder even though it no longer matches the new order. Rather than extend that shared check
   * (a bigger, riskier change this task's scope explicitly discourages — "do not change
   * P17/P17.1/P17.2 semantics unless Phase 0 proves this task requires it"), the store action
   * (editor-store.ts's `reorderWord`) unconditionally clears the caption-level `hinglishText`/
   * `gujaratiScriptText` on every reorder — the EXACT same defensive step split/merge/insert
   * already take whenever they rebuild `.text` after a word-array structural change (confirmed:
   * `mergeWithNext`'s own merged-caption object literal never carries those two fields forward
   * either). That closes the gap directly, with no new staleness-detection logic anywhere and no
   * change to how Merge/Delete/Split/Insert already work — a caption's cleared derived text
   * simply falls back to "pending-generation," which the existing P17.1 architecture already
   * treats as a quiet state that resolves itself the next time that mode is actually viewed. See
   * research/p18_6_word_reorder_report.md §10 for the full reasoning. */
  wordReorderAllowed: boolean;
}

/**
 * The one capability table this whole task produces. Deliberately NOT symmetrical across modes —
 * see each field's own doc comment above for exactly why a given cell is `true` or `false`; no
 * capability here was set to `true` merely to make the table look complete (Task 105631's own
 * explicit "do not invent capabilities just to make the table look symmetrical" instruction).
 */
export const CAPTION_DISPLAY_MODE_CAPABILITIES: Record<CaptionOutputMode, CaptionDisplayModeCapabilities> = {
  original: {
    textSource: "text",
    isAuthoritative: true,
    captionTextEditable: true,
    textEditWritesAuthoritativeText: true,
    wordChipsVisible: true,
    wordTimingEditable: true,
    wordSplitAllowed: true,
    wordMergeAllowed: true,
    wordDeleteAllowed: true,
    wordInsertAllowed: true,
    wordReorderAllowed: true,
  },
  hinglish: {
    textSource: "hinglishText",
    isAuthoritative: false,
    captionTextEditable: true,
    textEditWritesAuthoritativeText: false,
    wordChipsVisible: true,
    wordTimingEditable: true,
    wordSplitAllowed: false,
    wordMergeAllowed: true,
    wordDeleteAllowed: true,
    wordInsertAllowed: false,
    wordReorderAllowed: true,
  },
  "gujarati-script": {
    textSource: "gujaratiScriptText",
    isAuthoritative: false,
    captionTextEditable: true,
    textEditWritesAuthoritativeText: false,
    wordChipsVisible: true,
    wordTimingEditable: true,
    wordSplitAllowed: false,
    wordMergeAllowed: true,
    wordDeleteAllowed: true,
    wordInsertAllowed: false,
    wordReorderAllowed: true,
  },
};

/** Looks up one mode's own capability row. A thin, named accessor rather than inlining
 * `CAPTION_DISPLAY_MODE_CAPABILITIES[mode]` everywhere, so every call site reads as "ask the
 * contract" rather than "index into a table." */
export function getCaptionDisplayModeCapabilities(mode: CaptionOutputMode): CaptionDisplayModeCapabilities {
  return CAPTION_DISPLAY_MODE_CAPABILITIES[mode];
}

/** True when ANY word-text-mutating operation (split/merge/delete/insert) is available in `mode`
 * — i.e. whether the word-timing popover's own text-mutation controls have anything to show at
 * all. As of Task 106284 (P17.1) this is `true` for every existing mode (Merge/Delete are now
 * available everywhere; only Split/Insert remain Original-only — see
 * `isWordStructuralCreationAllowed` for that specific pair). Kept as its own function rather than
 * inlined so a hypothetical future mode with NOTHING available still degrades correctly wherever
 * this is checked. */
export function isWordTextMutationAllowed(mode: CaptionOutputMode): boolean {
  const c = getCaptionDisplayModeCapabilities(mode);
  return c.wordSplitAllowed || c.wordMergeAllowed || c.wordDeleteAllowed || c.wordInsertAllowed;
}

/** True when Split AND Insert are BOTH available in `mode` — i.e. whether the word-timing
 * popover's Split/Insert controls have anything to show. Task 106284 (P17.1): `true` only for
 * "original" — Split/Insert both require CREATING new `Word.text` content with no safe,
 * non-fabricated derivation from Hinglish/Gujarati-script input (see this module's own
 * top-of-file doc comment). Deliberately separate from `isWordTextMutationAllowed` now that
 * Merge/Delete and Split/Insert are no longer identical across modes. */
export function isWordStructuralCreationAllowed(mode: CaptionOutputMode): boolean {
  const c = getCaptionDisplayModeCapabilities(mode);
  return c.wordSplitAllowed && c.wordInsertAllowed;
}

/** A short, user-facing reason Split/Insert specifically are unavailable in `mode` — shown even
 * though Merge/Delete may still be visible right next to it (Task 106284, P17.1). Returns `null`
 * for "original" (nothing to explain — everything is available). */
export function wordStructuralCreationUnavailableReason(mode: CaptionOutputMode): string | null {
  if (isWordStructuralCreationAllowed(mode)) return null;
  return "Split and insert are available in Original mode.";
}

/** A short, user-facing reminder that Merge/Delete — even though available while viewing a
 * derived mode (Task 106284, P17.1) — still act on the corresponding AUTHORITATIVE Original word,
 * not a copy scoped to what's currently displayed. Returns `null` for "original" (redundant there
 * — everything shown already IS the original) and for any mode where Merge/Delete aren't even
 * available in the first place. */
export function derivedWordEditAffectsOriginalNotice(mode: CaptionOutputMode): string | null {
  const c = getCaptionDisplayModeCapabilities(mode);
  if (c.isAuthoritative || !(c.wordMergeAllowed || c.wordDeleteAllowed || c.wordReorderAllowed)) return null;
  return "Merge, delete, and reorder affect the Original transcript's own word, not just what's displayed here.";
}
