/**
 * Pure tests for the display-mode capability contract (Task 105631/106284, P17/P17.1 —
 * src/lib/subtitles/caption-display-mode.ts). No store, no React.
 *
 * Run with: node --test src/lib/subtitles/__tests__/caption-display-mode.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTION_DISPLAY_MODE_CAPABILITIES,
  getCaptionDisplayModeCapabilities,
  isWordTextMutationAllowed,
  isWordStructuralCreationAllowed,
  wordStructuralCreationUnavailableReason,
  derivedWordEditAffectsOriginalNotice,
} from "../caption-display-mode.ts";
import type { CaptionOutputMode } from "../../../types/subtitle.ts";

const MODES: CaptionOutputMode[] = ["original", "hinglish", "gujarati-script"];

// ============================== textSource / authority ==============================

test("each mode's own textSource matches the field it actually displays", () => {
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES.original.textSource, "text");
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES.hinglish.textSource, "hinglishText");
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES["gujarati-script"].textSource, "gujaratiScriptText");
});

test("only Original mode is authoritative — Hinglish and Gujarati Script are both derived", () => {
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES.original.isAuthoritative, true);
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES.hinglish.isAuthoritative, false);
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES["gujarati-script"].isAuthoritative, false);
});

test("only editing the caption text in Original mode writes the authoritative text field — derived-mode text edits never touch it", () => {
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES.original.textEditWritesAuthoritativeText, true);
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES.hinglish.textEditWritesAuthoritativeText, false);
  assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES["gujarati-script"].textEditWritesAuthoritativeText, false);
  // Every mode's caption-level textarea is still editable — just routed to a different field.
  for (const mode of MODES) assert.equal(CAPTION_DISPLAY_MODE_CAPABILITIES[mode].captionTextEditable, true);
});

// ============================== word chips / timing (safe in every mode) ==============================

test("word chips are visible and word timing is editable in EVERY mode — proven safe by the timeline's own existing, unconditional word-handle behavior", () => {
  for (const mode of MODES) {
    const c = getCaptionDisplayModeCapabilities(mode);
    assert.equal(c.wordChipsVisible, true, `${mode}: word chips must be visible`);
    assert.equal(c.wordTimingEditable, true, `${mode}: word timing must be editable`);
  }
});

// ============================== word text mutation (Task 106284, P17.1: no longer symmetric) ==============================

test("split/merge/delete/insert are all available in Original mode", () => {
  const c = CAPTION_DISPLAY_MODE_CAPABILITIES.original;
  assert.equal(c.wordSplitAllowed, true);
  assert.equal(c.wordMergeAllowed, true);
  assert.equal(c.wordDeleteAllowed, true);
  assert.equal(c.wordInsertAllowed, true);
});

test("Merge and Delete are available in Hinglish and Gujarati Script mode (Task 106284, P17.1) — proven safe: Delete never creates text, and Merge now preserves derived fields symmetrically", () => {
  for (const mode of ["hinglish", "gujarati-script"] as const) {
    const c = CAPTION_DISPLAY_MODE_CAPABILITIES[mode];
    assert.equal(c.wordMergeAllowed, true, `${mode}: merge must be available`);
    assert.equal(c.wordDeleteAllowed, true, `${mode}: delete must be available`);
  }
});

test("Split and Insert remain UNAVAILABLE in Hinglish and Gujarati Script mode — no capability was set true just to look symmetrical", () => {
  for (const mode of ["hinglish", "gujarati-script"] as const) {
    const c = CAPTION_DISPLAY_MODE_CAPABILITIES[mode];
    assert.equal(c.wordSplitAllowed, false, `${mode}: split must stay disabled`);
    assert.equal(c.wordInsertAllowed, false, `${mode}: insert must stay disabled`);
  }
});

// ============================== isWordTextMutationAllowed / isWordStructuralCreationAllowed ==============================

test("isWordTextMutationAllowed: true in every mode as of P17.1 (Merge/Delete are always available somewhere)", () => {
  assert.equal(isWordTextMutationAllowed("original"), true);
  assert.equal(isWordTextMutationAllowed("hinglish"), true);
  assert.equal(isWordTextMutationAllowed("gujarati-script"), true);
});

test("isWordStructuralCreationAllowed (Split AND Insert): true only for Original", () => {
  assert.equal(isWordStructuralCreationAllowed("original"), true);
  assert.equal(isWordStructuralCreationAllowed("hinglish"), false);
  assert.equal(isWordStructuralCreationAllowed("gujarati-script"), false);
});

test("wordStructuralCreationUnavailableReason: null for Original, a non-empty string for derived modes", () => {
  assert.equal(wordStructuralCreationUnavailableReason("original"), null);
  assert.ok(wordStructuralCreationUnavailableReason("hinglish"));
  assert.ok(wordStructuralCreationUnavailableReason("gujarati-script"));
});

test("wordStructuralCreationUnavailableReason: the SAME message for both derived modes (one explanation, not two)", () => {
  assert.equal(wordStructuralCreationUnavailableReason("hinglish"), wordStructuralCreationUnavailableReason("gujarati-script"));
});

test("derivedWordEditAffectsOriginalNotice: null for Original (redundant there), a non-empty string for both derived modes (Merge/Delete/Reorder are available there)", () => {
  assert.equal(derivedWordEditAffectsOriginalNotice("original"), null);
  assert.ok(derivedWordEditAffectsOriginalNotice("hinglish"));
  assert.ok(derivedWordEditAffectsOriginalNotice("gujarati-script"));
});

// ============================== word reorder (Task 113528, P18.6) ==============================

test("wordReorderAllowed: true in EVERY mode — reorder fabricates no new text and operates purely by index, same reasoning as Merge/Delete", () => {
  assert.equal(getCaptionDisplayModeCapabilities("original").wordReorderAllowed, true);
  assert.equal(getCaptionDisplayModeCapabilities("hinglish").wordReorderAllowed, true);
  assert.equal(getCaptionDisplayModeCapabilities("gujarati-script").wordReorderAllowed, true);
});

// ============================== table completeness ==============================

test("the capability table has an entry for exactly the three CaptionOutputMode values", () => {
  assert.deepEqual(Object.keys(CAPTION_DISPLAY_MODE_CAPABILITIES).sort(), [...MODES].sort());
});
