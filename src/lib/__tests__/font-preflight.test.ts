/**
 * Regression tests for the export font preflight (src/lib/fonts/font-preflight.ts,
 * font-preflight-message.ts) — pure/injectable functions, no real filesystem, no real
 * network, no real Windows font scan. `preflightRequiredFonts` is exercised against a
 * controlled, fake font environment (a fake `SystemFontFamily[]` list and a fake bundled-font
 * resolver) rather than a real installation, per the P1 task's explicit instruction never to
 * touch/rely on real system fonts in tests.
 *
 * Run with: node --test src/lib/__tests__/font-preflight.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  preflightRequiredFonts,
  type RequiredFont,
  type FontResolvers,
} from "../fonts/font-preflight.ts";
import { buildMissingFontMessage, isFontUnavailableMessage, FontResolutionError, type MissingFont } from "../fonts/font-preflight-message.ts";
import { resolveSystemFontFile, type SystemFontFamily } from "../fonts/system-fonts.ts";
import { collectRequiredFonts } from "../subtitles/ass.ts";
import { DEFAULT_SUBTITLE_STYLE } from "../../types/subtitle.ts";
import type { Subtitle, SubtitleStyle } from "../../types/subtitle.ts";

// A small, entirely fake "Windows installation" — never the real one.
const FAKE_SYSTEM_FONTS: SystemFontFamily[] = [
  {
    name: "Segoe UI",
    faces: [
      { weight: 400, italic: false, filePath: "C:/fake/segoeui.ttf" },
      { weight: 700, italic: false, filePath: "C:/fake/segoeuib.ttf" },
      { weight: 400, italic: true, filePath: "C:/fake/segoeuii.ttf" },
      { weight: 700, italic: true, filePath: "C:/fake/segoeuiz.ttf" },
    ],
  },
  {
    name: "Comic Sans MS",
    faces: [{ weight: 400, italic: false, filePath: "C:/fake/comic.ttf" }],
  },
];

/** Fake bundled-font resolver — "Inter" and "Poppins" are "available" (as if already cached
 * or downloadable), anything else is not. Never touches the network. */
function fakeResolveBundledFont(family: string): Promise<string | null> {
  const available = new Set(["Inter", "Poppins"]);
  return Promise.resolve(available.has(family) ? `/fake/cache/${family}.ttf` : null);
}

const RESOLVERS: FontResolvers = {
  resolveSystemFontFile,
  resolveBundledFont: fakeResolveBundledFont,
};

function font(overrides: Partial<RequiredFont> & Pick<RequiredFont, "family" | "source">): RequiredFont {
  return { weight: 400, ...overrides };
}

test("1. available bundled font passes", async () => {
  const result = await preflightRequiredFonts([font({ family: "Inter", source: "bundled" })], [], RESOLVERS);
  assert.deepEqual(result, { ok: true, missing: [] });
});

test("2. available system font passes", async () => {
  const result = await preflightRequiredFonts([font({ family: "Segoe UI", source: "system" })], FAKE_SYSTEM_FONTS, RESOLVERS);
  assert.deepEqual(result, { ok: true, missing: [] });
});

test("3. missing bundled font fails clearly", async () => {
  const result = await preflightRequiredFonts([font({ family: "Acumin Pro", source: "bundled" })], [], RESOLVERS);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ family: "Acumin Pro", weight: 400, source: "bundled" }]);
});

test("4. missing system font fails clearly", async () => {
  const result = await preflightRequiredFonts([font({ family: "Some Custom Font", source: "system" })], FAKE_SYSTEM_FONTS, RESOLVERS);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ family: "Some Custom Font", weight: 400, source: "system" }]);
});

test("5. multiple missing fonts are collected, not just the first", async () => {
  const required = [
    font({ family: "Acumin Pro", source: "bundled" }),
    font({ family: "Some Custom Font", source: "system" }),
    font({ family: "Inter", source: "bundled" }), // available — must not appear in `missing`
  ];
  const result = await preflightRequiredFonts(required, FAKE_SYSTEM_FONTS, RESOLVERS);
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 2);
  assert.deepEqual(
    result.missing.map((f) => f.family),
    ["Acumin Pro", "Some Custom Font"],
  );
});

test("6. requested family remains distinct from fallback family: an unresolvable family is reported missing, never silently swapped for a different installed family", () => {
  // "Some Custom Font" isn't installed at all — resolveSystemFontFile must return null, not
  // e.g. the first available family ("Segoe UI") as an unannounced substitute.
  const resolved = resolveSystemFontFile(FAKE_SYSTEM_FONTS, "Some Custom Font", 400);
  assert.equal(resolved, null);
});

test("7. regular (400) font resolution picks the exact-weight file", () => {
  const resolved = resolveSystemFontFile(FAKE_SYSTEM_FONTS, "Segoe UI", 400);
  assert.equal(resolved, "C:/fake/segoeui.ttf");
});

test("8. bold (700) resolution picks the exact-weight file where available", () => {
  const resolved = resolveSystemFontFile(FAKE_SYSTEM_FONTS, "Segoe UI", 700);
  assert.equal(resolved, "C:/fake/segoeuib.ttf");
});

test("9. this app's SubtitleStyle has no italic property — resolveSystemFontFile's own italic-exclusion never causes a family substitution: requesting a weight for a family whose only face is non-italic still resolves within the same family", () => {
  const resolved = resolveSystemFontFile(FAKE_SYSTEM_FONTS, "Comic Sans MS", 700); // no 700 face at all, only 400 non-italic
  assert.equal(resolved, "C:/fake/comic.ttf"); // nearest weight WITHIN the same family, never a different family
});

test("10. bold-italic is not a selectable caption style in this app (SubtitleStyle has no italic field) — confirmed structurally, not asserted as a resolvable case", () => {
  assert.equal("italic" in DEFAULT_SUBTITLE_STYLE, false);
});

test("11. custom preset system-font metadata resolves correctly — a required font sourced from a custom preset's style is resolved identically to any other system-sourced font", async () => {
  // Custom presets carry a plain SubtitleStyle (fontFamily/fontSource) copied by value — see
  // the P1 Custom Presets phase — so from the preflight's point of view there is nothing
  // "custom" about it: it's just another required font with source "system".
  const presetDerivedFont = font({ family: "Segoe UI", weight: 700, source: "system" });
  const result = await preflightRequiredFonts([presetDerivedFont], FAKE_SYSTEM_FONTS, RESOLVERS);
  assert.deepEqual(result, { ok: true, missing: [] });
});

test("12. missing custom-preset font is detected the same way as any other missing system font", async () => {
  const presetDerivedFont = font({ family: "A Font Someone Uninstalled", source: "system" });
  const result = await preflightRequiredFonts([presetDerivedFont], FAKE_SYSTEM_FONTS, RESOLVERS);
  assert.equal(result.ok, false);
  assert.equal(result.missing[0].family, "A Font Someone Uninstalled");
});

test("13. existing valid export path remains unaffected: a realistic mixed project (bundled global style + a per-caption system-font override + Devanagari fallback) with everything available preflights clean", () => {
  const globalStyle: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Inter", fontSource: "bundled", fontWeight: 800 };
  const subtitles: Pick<Subtitle, "words" | "style">[] = [
    { words: [{ text: "Hello", start: 0, end: 1 }], style: undefined },
    { words: [{ text: "World", start: 1, end: 2 }], style: { fontFamily: "Segoe UI", fontSource: "system", fontWeight: 400 } },
  ];
  const required = collectRequiredFonts(subtitles, globalStyle);
  return preflightRequiredFonts(required, FAKE_SYSTEM_FONTS, {
    resolveSystemFontFile,
    resolveBundledFont: (family) => Promise.resolve(family === "Inter" || family === "Noto Sans Devanagari" ? `/fake/${family}.ttf` : null),
  }).then((result) => {
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
  });
});

test("14. malformed/stale font metadata fails safely: an empty family name, or a weight far outside the normal 400-900 range, never throws — it's just reported missing or resolved to the nearest real face", async () => {
  const emptyFamily = await preflightRequiredFonts([font({ family: "", source: "system" })], FAKE_SYSTEM_FONTS, RESOLVERS);
  assert.equal(emptyFamily.ok, false);

  const oddWeight = resolveSystemFontFile(FAKE_SYSTEM_FONTS, "Segoe UI", 12345); // stale/corrupt weight value
  assert.equal(oddWeight, "C:/fake/segoeuib.ttf"); // nearest real weight (700), not a crash
});

test("15a. no silent fallback is reported as success: every entry in `missing` genuinely failed to resolve, and `ok` is false whenever `missing` is non-empty", async () => {
  const required = [font({ family: "Inter", source: "bundled" }), font({ family: "Ghost Font", source: "bundled" })];
  const result = await preflightRequiredFonts(required, [], RESOLVERS);
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].family, "Ghost Font");
});

test("15b. no silent fallback: FontResolutionError's message matches buildMissingFontMessage exactly, and is correctly identified by isFontUnavailableMessage — while an unrelated export failure message is not", () => {
  const missing: MissingFont[] = [
    { family: "Acumin Pro", weight: 700, source: "system" },
    { family: "Custom Display", weight: 400, source: "bundled" },
  ];
  const err = new FontResolutionError(missing);
  assert.equal(err.message, buildMissingFontMessage(missing));
  assert.equal(isFontUnavailableMessage(err.message), true);
  assert.equal(isFontUnavailableMessage("Something went wrong while exporting your video."), false);
  assert.equal(isFontUnavailableMessage("Export cancelled."), false);
  assert.equal(isFontUnavailableMessage(null), false);
  assert.equal(isFontUnavailableMessage(undefined), false);
});

test("buildMissingFontMessage: single missing font names the exact font and gives a source-specific, jargon-free reason", () => {
  const message = buildMissingFontMessage([{ family: "Acumin Pro", weight: 700, source: "system" }]);
  assert.match(message, /Font unavailable: "Acumin Pro"/);
  assert.match(message, /no longer available on this computer/);
  assert.doesNotMatch(message, /libass|fontconfig|ffmpeg|\.ttf|C:\\|\/fake\//i);
});

test("buildMissingFontMessage: multiple missing fonts are all named, not just the first", () => {
  const message = buildMissingFontMessage([
    { family: "Acumin Pro", weight: 400, source: "system" },
    { family: "Some Custom Font", weight: 400, source: "bundled" },
  ]);
  assert.match(message, /^2 fonts are unavailable:/);
  assert.match(message, /Acumin Pro/);
  assert.match(message, /Some Custom Font/);
});
