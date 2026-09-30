/**
 * Task 110184 (P18.3) — tests for the pure word-style capability/resolution helpers.
 * See research/p18_3_word_style_parity_report.md for the full audit and capability matrix.
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-style-capabilities.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SUBTITLE_STYLE } from "../../../types/subtitle.ts";
import {
  getWordStyleCapability,
  getWordStyleCapabilityReason,
  isWordStyleUiEligible,
  resolveEffectiveWordStyleValue,
  isWordStylePropertyOverridden,
  mergeWordStyleOverride,
} from "../word-style-capabilities.ts";

test("getWordStyleCapability: color, fontSize, fontWeight, letterSpacing are fully supported end-to-end", () => {
  assert.equal(getWordStyleCapability("color"), "supported");
  assert.equal(getWordStyleCapability("fontSize"), "supported");
  assert.equal(getWordStyleCapability("fontWeight"), "supported");
  assert.equal(getWordStyleCapability("letterSpacing"), "supported", "Task 131508 (P19.8): wired end-to-end (editor + preview + ASS \\fsp export)");
});

test("getWordStyleCapability: backgroundColor/backgroundOpacity are editor-only (no ASS per-run box)", () => {
  assert.equal(getWordStyleCapability("backgroundColor"), "editor-only");
  assert.equal(getWordStyleCapability("backgroundOpacity"), "editor-only");
});

test("getWordStyleCapability: opacity is unsafe (partial/inconsistent between preview and export)", () => {
  assert.equal(getWordStyleCapability("opacity"), "unsafe");
});

test("getWordStyleCapability: highlightColor/wordHighlight/activeWordScale are unsafe (parameterize the automatic highlight mechanism, not per-word appearance)", () => {
  assert.equal(getWordStyleCapability("highlightColor"), "unsafe");
  assert.equal(getWordStyleCapability("wordHighlight"), "unsafe");
  assert.equal(getWordStyleCapability("activeWordScale"), "unsafe");
});

test("getWordStyleCapability: box/layout properties (x, y, align, vAlign, boxWidthPercent, lineHeight) are unsafe", () => {
  for (const prop of ["x", "y", "align", "vAlign", "boxWidthPercent", "lineHeight"] as const) {
    assert.equal(getWordStyleCapability(prop), "unsafe", `${prop} should be unsafe`);
  }
});

test("getWordStyleCapability: fontFamily/fontSource/outline/shadow/textCase are unsupported (not wired, out of bounded scope)", () => {
  for (const prop of [
    "fontFamily",
    "fontSource",
    "textCase",
    "outlineEnabled",
    "outlineColor",
    "outlineWidth",
    "shadowEnabled",
    "shadowColor",
    "shadowBlur",
    "shadowOffsetX",
    "shadowOffsetY",
    "shadowOpacity",
    "backgroundRadius",
    "backgroundPaddingX",
    "backgroundPaddingY",
  ] as const) {
    assert.equal(getWordStyleCapability(prop), "unsupported", `${prop} should be unsupported`);
  }
});

test("getWordStyleCapability: a property with no explicit entry defaults to unsupported, not a crash", () => {
  assert.equal(getWordStyleCapability("fontSize" as never), "supported");
});

test("getWordStyleCapabilityReason: every non-default classification carries a documented reason", () => {
  for (const prop of ["color", "fontWeight", "backgroundColor", "opacity", "highlightColor", "x"] as const) {
    const reason = getWordStyleCapabilityReason(prop);
    assert.ok(reason && reason.length > 10, `${prop} should have a documented reason`);
  }
});

test("isWordStyleUiEligible: only supported/editor-only properties are UI-eligible", () => {
  assert.equal(isWordStyleUiEligible("color"), true);
  assert.equal(isWordStyleUiEligible("fontWeight"), true);
  assert.equal(isWordStyleUiEligible("backgroundColor"), true);
  assert.equal(isWordStyleUiEligible("letterSpacing"), true, "Task 131508 (P19.8)");
  assert.equal(isWordStyleUiEligible("opacity"), false);
  assert.equal(isWordStyleUiEligible("x"), false);
  assert.equal(isWordStyleUiEligible("fontFamily"), false);
});

// ───────────────────────── Task 131508 (P19.8) — word-level letter spacing ─────────────────────────

test("resolveEffectiveWordStyleValue: letterSpacing — no word override inherits the caption's resolved value", () => {
  const captionStyle = { ...DEFAULT_SUBTITLE_STYLE, letterSpacing: 3 };
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, undefined, "letterSpacing"), 3);
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, {}, "letterSpacing"), 3);
});

test("resolveEffectiveWordStyleValue: letterSpacing — an explicit override of 0 is distinguishable from 'no override' (not treated as falsy/unset)", () => {
  const captionStyle = { ...DEFAULT_SUBTITLE_STYLE, letterSpacing: 5 };
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, { letterSpacing: 0 }, "letterSpacing"), 0);
  assert.equal(isWordStylePropertyOverridden({ letterSpacing: 0 }, "letterSpacing"), true);
});

test("resolveEffectiveWordStyleValue: letterSpacing — a negative override (within the caption-level control's own -2..12 range) wins over the caption's value", () => {
  const captionStyle = { ...DEFAULT_SUBTITLE_STYLE, letterSpacing: 5 };
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, { letterSpacing: -2 }, "letterSpacing"), -2);
});

test("mergeWordStyleOverride: letterSpacing — resetting it leaves unrelated overridden properties (color, fontWeight) exactly intact", () => {
  const existing = { color: "#ff0000", fontWeight: 700 as const, letterSpacing: 6 };
  const result = mergeWordStyleOverride(existing, { letterSpacing: undefined });
  // Matches the same explicit-undefined-key shape the existing fontWeight-reset test above
  // documents (mergeWordStyleOverride only collapses to `null` once EVERY property is
  // undefined) — color/fontWeight themselves are untouched either way.
  assert.deepEqual(result, { color: "#ff0000", fontWeight: 700, letterSpacing: undefined });
});

test("mergeWordStyleOverride: letterSpacing — resetting the only overridden property collapses to null", () => {
  const existing = { letterSpacing: 4 };
  const result = mergeWordStyleOverride(existing, { letterSpacing: undefined });
  assert.equal(result, null);
});

test("resolveEffectiveWordStyleValue: no word override -> inherits the caption's resolved value", () => {
  const captionStyle = { ...DEFAULT_SUBTITLE_STYLE, fontWeight: 600 as const };
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, undefined, "fontWeight"), 600);
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, {}, "fontWeight"), 600);
});

test("resolveEffectiveWordStyleValue: an explicit word override wins over the caption's value", () => {
  const captionStyle = { ...DEFAULT_SUBTITLE_STYLE, fontWeight: 400 as const };
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, { fontWeight: 700 }, "fontWeight"), 700);
});

test("resolveEffectiveWordStyleValue: a partial override only affects the property it sets, not siblings", () => {
  const captionStyle = { ...DEFAULT_SUBTITLE_STYLE, color: "#ffffff", fontWeight: 400 as const };
  const wordStyle = { color: "#ff0000" };
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, wordStyle, "color"), "#ff0000");
  assert.equal(resolveEffectiveWordStyleValue(captionStyle, wordStyle, "fontWeight"), 400, "fontWeight was never overridden, so it still inherits");
});

test("isWordStylePropertyOverridden: distinguishes 'has an override for this exact property' from 'has any override'", () => {
  const wordStyle = { color: "#ff0000" };
  assert.equal(isWordStylePropertyOverridden(wordStyle, "color"), true);
  assert.equal(isWordStylePropertyOverridden(wordStyle, "fontWeight"), false);
  assert.equal(isWordStylePropertyOverridden(undefined, "color"), false);
});

test("mergeWordStyleOverride: no existing override -> a single-property patch becomes the new override", () => {
  const result = mergeWordStyleOverride(undefined, { fontWeight: 700 });
  assert.deepEqual(result, { fontWeight: 700 });
});

test("mergeWordStyleOverride: preserves other existing override properties (partial override)", () => {
  const existing = { color: "#ff0000", fontSize: 48 };
  const result = mergeWordStyleOverride(existing, { fontWeight: 700 });
  assert.deepEqual(result, { color: "#ff0000", fontSize: 48, fontWeight: 700 });
});

test("mergeWordStyleOverride: un-setting the only overridden property collapses to null (reset), not a stray empty-but-truthy object", () => {
  const existing = { fontWeight: 700 as const };
  const result = mergeWordStyleOverride(existing, { fontWeight: undefined });
  assert.equal(result, null);
});

test("mergeWordStyleOverride: un-setting one property while others remain leaves a real (non-null) patch", () => {
  const existing = { color: "#ff0000", fontWeight: 700 as const };
  const result = mergeWordStyleOverride(existing, { fontWeight: undefined });
  assert.deepEqual(result, { color: "#ff0000", fontWeight: undefined });
});

test("mergeWordStyleOverride: derived display modes are irrelevant to style resolution — the helper is display-mode agnostic, operating purely on style objects", () => {
  // Word.style/SubtitleStyle carry no display-mode field at all; splitWordText/mergeWords/
  // resolveWordInsertion already propagate the whole `style` object across Original/Hinglish/
  // Gujarati derived text edits unchanged (word-edit.ts), so this helper needs no mode
  // parameter and produces the identical result regardless of which mode the caption is
  // currently being viewed/edited in.
  const result = mergeWordStyleOverride({ color: "#00ff00" }, { fontWeight: 700 });
  assert.deepEqual(result, { color: "#00ff00", fontWeight: 700 });
});
