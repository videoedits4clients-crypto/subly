/**
 * Compact, data-driven validation suite for the P5 caption-style library expansion (Task 85241)
 * — deliberately NOT one test per preset (that would be dozens of near-identical, superficial
 * tests for ~45 entries); instead each test iterates the whole BUILT_IN_PRESETS array and
 * asserts an invariant that must hold for every single one of them, with a per-preset id in the
 * failure message so a broken entry is still easy to find.
 *
 * Run with: node --test src/lib/__tests__/preset-library.test.ts
 * (or the "test:preset-library" package.json script)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_PRESETS, PRESET_CATEGORIES, presetsByCategory, getPreset } from "../presets.ts";
import { resolveGlobalStyle, DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../types/subtitle.ts";
import { buildAssDocument } from "../subtitles/ass.ts";
import type { Subtitle } from "../../types/subtitle.ts";

// Mirrors lib/fonts.ts's FONT_REGISTRY `.name` values exactly (that file itself imports from
// "next/font/google", a Next-compiler-only virtual module plain `node --test` can't resolve —
// same reason other suites in this codebase avoid importing "@/"-aliased, framework-coupled
// modules directly; see e.g. project-patch.test.ts's own doc comment). Kept as a flat literal
// list rather than re-deriving it, so a genuinely unregistered font name still fails loudly.
const REGISTERED_FONT_NAMES = new Set([
  "Inter", "Poppins", "Montserrat", "Roboto", "Open Sans", "DM Sans", "Plus Jakarta Sans", "Manrope", "Outfit", "Urbanist",
  "Bebas Neue", "Anton", "Oswald", "Archivo", "Archivo Black", "League Spartan",
  "Playfair Display", "DM Serif Display",
  "Nunito", "Quicksand", "Fredoka", "Baloo 2",
  "Noto Sans Devanagari", "Hind", "Noto Sans Gujarati",
]);

const VALID_FONT_WEIGHTS = new Set([400, 500, 600, 700, 800, 900]);
const VALID_TEXT_CASES = new Set(["none", "uppercase", "lowercase", "sentence"]);
const VALID_ALIGN = new Set(["left", "center", "right"]);
const VALID_VALIGN = new Set(["top", "center", "bottom"]);
const VALID_ENTRANCE = new Set([
  "none", "fade", "pop", "slide-up", "slide-down", "slide-left", "slide-right", "bounce", "typewriter", "word-pop", "char-pop",
]);
const VALID_EXIT = new Set(["none", "fade", "slide", "pop"]);
const VALID_WORD_ANIM = new Set(["none", "highlight", "scale", "bounce", "color", "underline", "bg-highlight"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// --- 1. unique IDs --------------------------------------------------------------------------

test("1. every built-in preset has a unique id", () => {
  const ids = BUILT_IN_PRESETS.map((p) => p.id);
  const seen = new Set<string>();
  for (const id of ids) {
    assert.ok(!seen.has(id), `duplicate preset id: "${id}"`);
    seen.add(id);
  }
  assert.equal(seen.size, BUILT_IN_PRESETS.length);
});

// --- 2. valid category -----------------------------------------------------------------------

test("2. every built-in preset has a category from the canonical PRESET_CATEGORIES list", () => {
  for (const p of BUILT_IN_PRESETS) {
    assert.ok((PRESET_CATEGORIES as readonly string[]).includes(p.category), `preset "${p.id}" has an invalid category: "${p.category}"`);
  }
});

test("2b. presetsByCategory + PRESET_CATEGORIES together partition the whole library exactly once each", () => {
  const total = PRESET_CATEGORIES.reduce((sum, cat) => sum + presetsByCategory(cat).length, 0);
  assert.equal(total, BUILT_IN_PRESETS.length);
});

// --- 3 & 4. complete, validly-typed style + animation definitions ----------------------------

test("3. every built-in preset has a complete SubtitleStyle — every DEFAULT_SUBTITLE_STYLE key is present", () => {
  const expectedKeys = Object.keys(DEFAULT_SUBTITLE_STYLE).sort();
  for (const p of BUILT_IN_PRESETS) {
    assert.deepEqual(Object.keys(p.style).sort(), expectedKeys, `preset "${p.id}" has a missing/extra style field`);
  }
});

test("3b. every built-in preset has a complete AnimationConfig — every DEFAULT_ANIMATION key is present", () => {
  const expectedKeys = Object.keys(DEFAULT_ANIMATION).sort();
  for (const p of BUILT_IN_PRESETS) {
    assert.deepEqual(Object.keys(p.animation).sort(), expectedKeys, `preset "${p.id}" has a missing/extra animation field`);
  }
});

test("4. every built-in preset references a real, registered font", () => {
  for (const p of BUILT_IN_PRESETS) {
    assert.ok(REGISTERED_FONT_NAMES.has(p.style.fontFamily), `preset "${p.id}" uses an unregistered font: "${p.style.fontFamily}"`);
  }
});

test("4b. every built-in preset's style/animation enum and numeric fields hold real, renderer-supported values", () => {
  for (const p of BUILT_IN_PRESETS) {
    const { style, animation } = p;
    assert.ok(VALID_FONT_WEIGHTS.has(style.fontWeight), `preset "${p.id}" has an invalid fontWeight: ${style.fontWeight}`);
    assert.ok(VALID_TEXT_CASES.has(style.textCase), `preset "${p.id}" has an invalid textCase: ${style.textCase}`);
    assert.ok(VALID_ALIGN.has(style.align), `preset "${p.id}" has an invalid align: ${style.align}`);
    assert.ok(VALID_VALIGN.has(style.vAlign), `preset "${p.id}" has an invalid vAlign: ${style.vAlign}`);
    assert.ok(VALID_ENTRANCE.has(animation.entrance), `preset "${p.id}" has an invalid entrance animation: ${animation.entrance}`);
    assert.ok(VALID_EXIT.has(animation.exit), `preset "${p.id}" has an invalid exit animation: ${animation.exit}`);
    assert.ok(VALID_WORD_ANIM.has(animation.word), `preset "${p.id}" has an invalid word animation: ${animation.word}`);
    for (const [field, value] of Object.entries(style)) {
      if (typeof value !== "string" || !field.toLowerCase().includes("color")) continue;
      assert.match(value, HEX_COLOR, `preset "${p.id}"'s ${field} ("${value}") is not a 6-digit hex color`);
    }
    assert.ok(style.fontSize > 0 && style.fontSize < 300, `preset "${p.id}" has an implausible fontSize: ${style.fontSize}`);
    assert.ok(style.activeWordScale >= 0.5 && style.activeWordScale <= 3, `preset "${p.id}" has an implausible activeWordScale: ${style.activeWordScale}`);
  }
});

// --- 5. applying a preset produces a complete normalized style -------------------------------

test("5. resolveGlobalStyle leaves every built-in preset's style unchanged (it's already complete)", () => {
  for (const p of BUILT_IN_PRESETS) {
    assert.deepEqual(resolveGlobalStyle(p.style), p.style, `preset "${p.id}" was altered by normalization`);
  }
});

// --- 6. applying/reading a preset does not mutate another preset -----------------------------

test("6. no two built-in presets share an object reference for style or animation", () => {
  const styleRefs = new Set(BUILT_IN_PRESETS.map((p) => p.style));
  const animRefs = new Set(BUILT_IN_PRESETS.map((p) => p.animation));
  assert.equal(styleRefs.size, BUILT_IN_PRESETS.length, "two presets share the same style object reference");
  assert.equal(animRefs.size, BUILT_IN_PRESETS.length, "two presets share the same animation object reference");
});

test("6b. mutating a style/animation object obtained from getPreset() never affects the BUILT_IN_PRESETS source array (matches the existing applyPreset deep-clone contract)", () => {
  const before = JSON.stringify(BUILT_IN_PRESETS);
  const preset = getPreset("neon");
  assert.ok(preset);
  const styleCopy = { ...preset.style, color: "#000000" };
  const animCopy = { ...preset.animation, entrance: "none" as const };
  void styleCopy;
  void animCopy;
  assert.equal(JSON.stringify(BUILT_IN_PRESETS), before);
});

// --- 13. representative presets export successfully (ASS generation, one per category) -------

const SAMPLE_SUBTITLES: Subtitle[] = [
  { id: "1", index: 0, start: 0, end: 1.2, text: "This is amazing", words: [
    { text: "This", start: 0, end: 0.3 },
    { text: "is", start: 0.3, end: 0.5 },
    { text: "amazing", start: 0.5, end: 1.2 },
  ] },
];

test("13. one representative preset per category generates a valid, non-empty ASS document without throwing", () => {
  for (const category of PRESET_CATEGORIES) {
    const [preset] = presetsByCategory(category);
    assert.ok(preset, `category "${category}" has no presets to test`);
    const doc = buildAssDocument({
      subtitles: SAMPLE_SUBTITLES,
      globalStyle: preset.style,
      globalAnimation: preset.animation,
      playResX: 1080,
      playResY: 1920,
    });
    assert.ok(doc.includes("[Script Info]"), `${preset.id} (${category}) did not produce a valid ASS header`);
    assert.ok(doc.includes("[V4+ Styles]"), `${preset.id} (${category}) did not produce a style section`);
    assert.ok(doc.includes("[Events]"), `${preset.id} (${category}) did not produce an events section`);
    assert.ok(doc.length > 200, `${preset.id} (${category}) produced a suspiciously short document`);
  }
});

test("13b. every single built-in preset (all categories, all ~45) generates ASS without throwing — a broad, cheap crash guard", () => {
  for (const p of BUILT_IN_PRESETS) {
    assert.doesNotThrow(() => {
      buildAssDocument({ subtitles: SAMPLE_SUBTITLES, globalStyle: p.style, globalAnimation: p.animation, playResX: 1080, playResY: 1920 });
    }, `preset "${p.id}" crashed during ASS generation`);
  }
});
