/**
 * P20.2 — style-family audit. The built-in library used to have 45 presets, 41 of them at one default position and 25 of them "white
 * caps + black outline + fade" at the same position. This suite keeps it from drifting back:
 *
 *  - every family has two flagship (`representative`) styles and each keeps its family's CONTRACT
 *    (the recognisable visual system: type scale, container, position, motion language);
 *  - any two flagships differ in at least 4 of 14 perceptual dimensions, and no two visible presets
 *    differ in fewer than 3 (lib/preset-audit.ts — colours/sizes are bucketed, so "58px vs 60px" or
 *    "#FFF vs #FAF7F2" never counts as a difference);
 *  - migration safety: all 45 pre-P20.2 ids still resolve, merged presets stay resolvable (hidden,
 *    `replacedBy` a visible preset), presets that were KEEP-ed are byte-identical (hash fixtures
 *    taken from the P20.1-era definitions), and the six presets the public website's style showcase
 *    reads keep every field it renders;
 *  - every visible preset renders: ASS generation for a multiline, active-word, mixed-word-style,
 *    custom-position caption with no NaN geometry.
 *
 * Run with: node --test src/lib/__tests__/style-family-audit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BUILT_IN_PRESETS, PICKER_PRESETS, STYLE_FAMILIES, FAMILY_INFO, getPreset, presetsByFamily, pickerPresetsByFamily } from "../presets.ts";
import { AUDIT_DIMENSIONS, colorBucket, differingDimensions, findSimilarPairs, presetSignature } from "../preset-audit.ts";
import { buildAssDocument, isGlowStyle } from "../subtitles/ass.ts";
import type { Subtitle } from "../../types/subtitle.ts";

const REPS = PICKER_PRESETS.filter((p) => p.representative);

// ───────────────────────── structure ─────────────────────────

test("12 families, each with exactly two flagship styles and at least two visible presets", () => {
  assert.equal(STYLE_FAMILIES.length, 12);
  assert.equal(REPS.length, 24);
  for (const family of STYLE_FAMILIES) {
    assert.ok(FAMILY_INFO[family].label && FAMILY_INFO[family].tagline, `${family} needs a label and tagline`);
    assert.equal(REPS.filter((p) => p.family === family).length, 2, `${family} must have exactly 2 representative styles`);
    assert.ok(pickerPresetsByFamily(family).length >= 2, `${family} needs at least 2 visible presets`);
    assert.ok(pickerPresetsByFamily(family).slice(0, 2).every((p) => p.representative), `${family}: the picker must list the flagships first`);
  }
});

test("no representative is hidden, and preset ids are unique", () => {
  for (const p of REPS) assert.ok(!p.replacedBy, `${p.id} is a representative and cannot be folded into another preset`);
  const ids = BUILT_IN_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("wordHighlight and the word animation agree: a preset with highlighting off has word 'none'", () => {
  for (const p of BUILT_IN_PRESETS) {
    if (!p.style.wordHighlight) assert.equal(p.animation.word, "none", `${p.id}: highlighting is off but word animation is "${p.animation.word}"`);
    else assert.notEqual(p.animation.word, "none", `${p.id}: highlighting is on but there is no word animation`);
  }
});

// ───────────────────────── differentiation ─────────────────────────

test("any two flagship styles differ in at least 4 of the 14 audit dimensions", () => {
  assert.equal(AUDIT_DIMENSIONS.length, 14);
  const pairs = findSimilarPairs(REPS, 4);
  assert.deepEqual(
    pairs.map((p) => `${p.a} ~ ${p.b} (${p.distance}; shared: ${p.shared.join(", ")})`),
    [],
    "these flagships are too alike — change position/container/motion, not just font or colour",
  );
});

test("no two visible presets are suspiciously similar (fewer than 3 differing dimensions)", () => {
  const pairs = findSimilarPairs(PICKER_PRESETS, 3);
  assert.deepEqual(
    pairs.map((p) => `${p.a} ~ ${p.b} (${p.distance}; shared: ${p.shared.join(", ")})`),
    [],
  );
});

test("the audit really measures what it claims: bucketing, and font/colour-only changes are 'similar'", () => {
  const base = getPreset("classic")!;
  const sigA = presetSignature(base);
  // 58px → 59px, #FFFFFF → #FAFAFA: still the same bucket, zero differences
  const nearly = presetSignature({ style: { ...base.style, fontSize: 59, color: "#FAFAFA" }, animation: base.animation });
  assert.deepEqual(differingDimensions(sigA, nearly), []);
  // a different font and colour alone: only 2 dimensions → would be flagged as similar
  const fontColor = presetSignature({ style: { ...base.style, fontFamily: "Poppins", color: "#FF0000" }, animation: base.animation });
  assert.deepEqual(differingDimensions(sigA, fontColor).sort(), ["color", "font"]);
  assert.equal(colorBucket("#FFFFFF"), "white");
  assert.equal(colorBucket("#000000"), "black");
  assert.notEqual(colorBucket("#FF0000"), colorBucket("#00FF00"));
  assert.equal(colorBucket("#FF0000"), colorBucket("#F43F3F"), "two reds share a hue bucket");
});

test("the library no longer collapses onto one composition: variety in position, container and motion", () => {
  const sigs = PICKER_PRESETS.map(presetSignature);
  const distinct = (d: (typeof AUDIT_DIMENSIONS)[number]) => new Set(sigs.map((s) => s[d])).size;
  assert.ok(distinct("position") >= 9, `only ${distinct("position")} distinct positions (was 2 before P20.2)`);
  assert.ok(distinct("entrance") >= 7, "was 5 before P20.2");
  assert.ok(distinct("exit") >= 4, "exit animations were unused (all 45 'none') before P20.2");
  assert.ok(distinct("background") >= 6, "was 4 before P20.2");
  assert.ok(distinct("font") >= 22, "was 18 before P20.2");
  const atDefaultSpot = PICKER_PRESETS.filter((p) => p.style.y === 82 && p.style.align === "center" && p.style.vAlign === "bottom").length;
  assert.ok(atDefaultSpot <= PICKER_PRESETS.length * 0.5, `${atDefaultSpot} presets still sit at the default spot`);
});

// ───────────────────────── family contracts (flagships) ─────────────────────────

const rep = (id: string) => {
  const p = getPreset(id);
  assert.ok(p && p.representative, `${id} must be a representative`);
  return p;
};
const FAMILY_CONTRACTS: Record<(typeof STYLE_FAMILIES)[number], (p: ReturnType<typeof rep>) => string | null> = {
  minimal: (p) => (p.style.fontSize <= 46 && !p.style.outlineEnabled && p.style.backgroundOpacity === 0 ? null : "must be small (≤46px), outline-free and container-free"),
  "bold-creator": (p) =>
    p.style.fontSize >= 76 && p.style.outlineWidth >= 8 && p.style.wordHighlight && ["scale", "bounce"].includes(p.animation.word) && ["pop", "bounce"].includes(p.animation.entrance)
      ? null
      : "must be huge (≥76px), heavily outlined, with a scale/bounce word hit and a pop/bounce entrance",
  karaoke: (p) =>
    p.style.wordHighlight && p.animation.word !== "none" && ["none", "fade"].includes(p.animation.entrance) && p.animation.exit === "none"
      ? null
      : "must keep a steady (no pop/slide) readable line with strong active-word emphasis",
  editorial: (p) =>
    ["Playfair Display", "DM Serif Display"].includes(p.style.fontFamily) && !p.style.outlineEnabled && p.style.backgroundOpacity === 0 && (p.style.align !== "center" || p.style.x !== 50)
      ? null
      : "must be an outline-free serif that is placed deliberately (not centred at the default x)",
  cinematic: (p) =>
    p.style.y >= 86 && p.style.fontSize <= 52 && !p.style.outlineEnabled && p.animation.durationSec >= 0.4 ? null : "must sit low (y ≥ 86), small, outline-free, with a slow (≥0.4s) entrance",
  neon: (p) => (isGlowStyle(p.style) && colorBucket(p.style.shadowColor) !== "black" && p.animation.exit !== "none" ? null : "must have a coloured glow and an exit"),
  sticker: (p) => (p.style.backgroundOpacity >= 0.9 && p.style.backgroundRadius >= 20 && !p.style.outlineEnabled ? null : "must be a solid rounded chip with no text outline"),
  comic: (p) =>
    p.style.outlineWidth >= 7 && ["Bangers", "Baloo 2", "Fredoka"].includes(p.style.fontFamily) && ["pop", "bounce"].includes(p.animation.entrance)
      ? null
      : "must use rounded/comic lettering, a thick outline and a pop/bounce entrance",
  podcast: (p) => (p.style.backgroundOpacity > 0 && p.style.y >= 86 && p.style.fontSize <= 50 ? null : "must be a readable boxed lower third (box, y ≥ 86, ≤50px)"),
  documentary: (p) =>
    p.style.backgroundOpacity >= 0.85 && p.style.backgroundRadius <= 4 && p.style.y >= 90 && p.style.fontSize <= 44 && p.style.textCase === "uppercase"
      ? null
      : "must be a solid square-cornered lower-third bar with small caps",
  meme: (p) =>
    p.style.fontSize >= 90 && p.style.outlineWidth >= 12 && !p.style.wordHighlight && (p.style.y <= 10 || p.style.y >= 94) ? null : "must be enormous (≥90px), ≥12px outline, pinned to a frame edge",
  handwritten: (p) => (["Caveat", "Kalam", "Permanent Marker"].includes(p.style.fontFamily) && p.style.textCase !== "uppercase" ? null : "must use a handwritten font in natural case"),
};

for (const family of STYLE_FAMILIES) {
  test(`family contract — ${family}: both flagships express the family's visual system`, () => {
    const reps = REPS.filter((p) => p.family === family);
    assert.equal(reps.length, 2);
    for (const p of reps) assert.equal(FAMILY_CONTRACTS[family](p), null, `${p.id}: ${FAMILY_CONTRACTS[family](p)}`);
  });
}

// ───────────────────────── migration safety ─────────────────────────

const PRE_P20_2_IDS = [
  "bold", "tiktok", "reels", "mrbeast", "creator-bold", "punch", "gaming", "power-words", "jump-pop", "bounce", "word-burst", "karaoke", "highlight",
  "color-sweep", "active-highlight", "marker", "word-focus", "pulse-highlight", "classic", "minimal", "youtube", "podcast", "news", "clean", "elegant",
  "clean-white", "modern", "mono", "editorial", "cinematic", "luxury", "soft-shadow", "cinematic-glow", "comic", "sticker", "candy-pop", "cartoon", "neon",
  "outline", "shadow-pop", "gradient-glow", "retro", "vhs", "typewriter", "arcade",
];

test("all 45 pre-P20.2 preset ids still resolve", () => {
  assert.equal(PRE_P20_2_IDS.length, 45);
  for (const id of PRE_P20_2_IDS) assert.ok(getPreset(id), `preset id "${id}" disappeared — saved references would break`);
});

test("merged presets stay resolvable but hidden, each pointing at a visible survivor", () => {
  const hidden = BUILT_IN_PRESETS.filter((p) => p.replacedBy);
  assert.deepEqual(hidden.map((p) => `${p.id}→${p.replacedBy}`).sort(), [
    "active-highlight→highlight",
    "clean-white→classic",
    "clean→classic",
    "creator-bold→bold",
    "power-words→bold",
    "typewriter→mono",
  ]);
  for (const p of hidden) {
    const target = getPreset(p.replacedBy!);
    assert.ok(target && !target.replacedBy, `${p.id}'s replacement ${p.replacedBy} must exist and be visible`);
    assert.ok(!PICKER_PRESETS.includes(p));
    assert.equal(target.family, p.family === "bold-creator" || p.family === "minimal" || p.family === "karaoke" ? target.family : p.family);
  }
  assert.equal(PICKER_PRESETS.length, BUILT_IN_PRESETS.length - hidden.length);
});

// sha256 (first 16 hex) of JSON.stringify({style, animation}) of each KEEP-ed / merged preset, taken
// from the P20.1-era definitions: these presets must stay byte-identical.
const UNCHANGED_HASHES: Record<string, string> = {
  reels: "164e4d838d29b8e8",
  mrbeast: "262a8926ff3f4137",
  bounce: "0ccad6d4b5e1e937",
  highlight: "2e16b7627beb68c6",
  "word-focus": "e97d0e7013ada8d1",
  classic: "c2fcfe659db48129",
  youtube: "d3773bd85b4e6a77",
  news: "4a6bff29c460008b",
  mono: "fc094346a1bfc0ea",
  cinematic: "901e3e5496be5ae5",
  "cinematic-glow": "5616ce02fa411281",
  sticker: "30b82be54d267c32",
  "candy-pop": "143669c7d50b2a35",
  cartoon: "f346c934ffe0cbca",
  outline: "7ff90672b714fb73",
  "shadow-pop": "df9071ae977371b8",
  "gradient-glow": "b7aaacb0518c98f2",
  retro: "5f7c4e5965070482",
  vhs: "24df20473129a800",
  arcade: "f036f407a1105e1a",
  "power-words": "a23847d7050d2d53",
  "creator-bold": "f4c39f40c330a510",
  "active-highlight": "aa3e2473b1c42d2a",
  clean: "71139b615abd0410",
  "clean-white": "3d13d275a587fb76",
  typewriter: "3bdf8f3fe4bbf685",
};

test("KEEP-ed and merged presets are byte-identical to their P20.1-era definitions", () => {
  for (const [id, hash] of Object.entries(UNCHANGED_HASHES)) {
    const p = getPreset(id)!;
    const actual = createHash("sha256").update(JSON.stringify({ style: p.style, animation: p.animation })).digest("hex").slice(0, 16);
    assert.equal(actual, hash, `${id} was modified — KEEP/merged presets must not change (REFINE ones are listed in docs/STYLE-FAMILIES.md)`);
  }
});

test("the six presets the public website's style showcase renders keep every field it reads", () => {
  // src/components/landing/style-showcase.tsx shows name, description, font, weight, colour, case,
  // outline and highlight colour of exactly these ids. The website is deployed from this repo, so
  // refining them must not change what it displays.
  const expected: Record<string, [string, string, string, number, string, string, boolean, string, string]> = {
    tiktok: ["TikTok", "The viral look: bold caps, cyan highlight pop.", "Poppins", 800, "#FFFFFF", "uppercase", true, "#000000", "#22D3EE"],
    mrbeast: ["MrBeast-style", "Huge yellow bouncy caps with a thick black outline.", "Anton", 400, "#FFFFFF", "uppercase", true, "#000000", "#FFD400"],
    news: ["News", "Broadcast-style lower third bar.", "Oswald", 500, "#FFFFFF", "uppercase", false, "#000000", "#7C3AED"],
    elegant: ["Elegant", "Light weight, generous spacing, sentence case.", "DM Sans", 500, "#FFFFFF", "sentence", true, "#000000", "#7C3AED"],
    karaoke: ["Karaoke", "Word-by-word color sweep, sing-along style.", "Montserrat", 800, "#E5E7EB", "uppercase", true, "#000000", "#22D3EE"],
    gaming: ["Gaming", "Neon highlight with aggressive scale-pop.", "Archivo", 900, "#E5E7EB", "uppercase", true, "#111827", "#A3E635"],
  };
  for (const [id, e] of Object.entries(expected)) {
    const p = getPreset(id)!;
    assert.deepEqual(
      [p.name, p.description, p.style.fontFamily, p.style.fontWeight, p.style.color, p.style.textCase, p.style.outlineEnabled, p.style.outlineColor, p.style.highlightColor],
      e,
      `${id} changed something the public website renders`,
    );
  }
});

test("every preset is still a complete SubtitleStyle (existing saved/custom styles keep loading)", () => {
  const defaultKeys = Object.keys(getPreset("classic")!.style).sort();
  for (const p of BUILT_IN_PRESETS) assert.deepEqual(Object.keys(p.style).sort(), defaultKeys, `${p.id} has a missing/extra style field`);
});

// ───────────────────────── rendering ─────────────────────────

const SAMPLE: Subtitle[] = [
  {
    id: "a",
    index: 0,
    start: 0,
    end: 3,
    text: "Short and mixed\nstyled words here",
    words: [
      { text: "Short", start: 0, end: 0.5 },
      { text: "and", start: 0.5, end: 0.9 },
      { text: "mixed", start: 0.9, end: 1.5, style: { fontSize: 120, color: "#FF3030" } },
      { text: "styled", start: 1.5, end: 2.0 },
      { text: "words", start: 2.0, end: 2.5 },
      { text: "here", start: 2.5, end: 3.0 },
    ],
  },
  {
    id: "b",
    index: 1,
    start: 3.2,
    end: 4.4,
    text: "Custom position",
    words: [
      { text: "Custom", start: 3.2, end: 3.8 },
      { text: "position", start: 3.8, end: 4.4 },
    ],
    style: { x: 30, y: 40 },
  },
];

test("every visible preset renders: ASS for a multiline, active-word, mixed-style, custom-position caption has no NaN and one text event per interval", () => {
  for (const p of PICKER_PRESETS) {
    const doc = buildAssDocument({ subtitles: SAMPLE, globalStyle: p.style, globalAnimation: p.animation, playResX: 1080, playResY: 1920 });
    assert.ok(!/NaN|undefined|Infinity/.test(doc), `${p.id}: bad number in the ASS document`);
    const texts = doc.split("\n").filter((l) => l.startsWith("Dialogue: 1,"));
    assert.ok(texts.length >= 8, `${p.id}: expected a text event per word interval`);
    assert.ok(texts.some((l) => l.includes("\\N")), `${p.id}: the caption's line break must survive`);
    const styles = doc.split("\n").filter((l) => l.startsWith("Style: "));
    assert.ok(styles.length >= 2, `${p.id}: the custom-position caption needs its own style line`);
    // the second caption's own anchor
    assert.ok(texts.some((l) => l.includes(`(${Math.round(0.3 * 1080)},${Math.round(0.4 * 1920)})`) || /\\move\(/.test(l)), `${p.id}: custom position missing`);
  }
});

test("glow presets are exactly the intended ones", () => {
  const glow = PICKER_PRESETS.filter((p) => isGlowStyle(p.style)).map((p) => p.id).sort();
  assert.deepEqual(glow, ["cinematic", "cinematic-glow", "gradient-glow", "neon", "neon-tube", "soft-shadow"]);
});

test("every family is represented in the real rendering path by at least one preset per distinct container type", () => {
  const boxed = REPS.filter((p) => p.style.backgroundOpacity > 0).map((p) => p.family);
  assert.deepEqual([...new Set(boxed)].sort(), ["documentary", "podcast", "sticker"]);
  assert.ok(presetsByFamily("sticker").length >= 3);
});

// ───────────────────────── preview font rendering ─────────────────────────

test("preview font-family values quote the family name (an unquoted 'Baloo 2' invalidated the whole declaration → Inter)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const previewStyle = readFileSync(path.join(root, "lib", "subtitles", "preview-style.ts"), "utf-8");
  const picker = readFileSync(path.join(root, "components", "editor", "font-picker.tsx"), "utf-8");
  assert.match(previewStyle, /export function quoteFontFamily/);
  assert.match(previewStyle, /const q = quoteFontFamily\(fontFamily\)/);
  assert.ok(!/\$\{fontFamily\}\), \$\{fontFamily\}/.test(previewStyle), "no raw, unquoted family interpolation may remain");
  assert.match(picker, /quoteFontFamily\(name\)/);
  // which preset fonts are actually affected: a word that is not a valid CSS identifier ("2" in Baloo 2)
  const needsQuotes = [...new Set(BUILT_IN_PRESETS.map((p) => p.style.fontFamily))].filter((f) => !f.split(" ").every((w) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(w)));
  assert.deepEqual(needsQuotes, ["Baloo 2"]);
});
