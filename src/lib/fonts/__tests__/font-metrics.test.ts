/**
 * P20.4 — font metric extraction and the logical-size → libass-size model.
 *
 * Root cause being guarded: libass reads ASS `Fontsize` as the font's WINDOWS CELL height
 * ((winAscent + winDescent) / unitsPerEm × em), the browser reads CSS `font-size` as the em, so the
 * same number rendered text (winAscent+winDescent)/unitsPerEm times smaller in the export. The model
 * in font-metrics.ts converts em → Fontsize from the font's own tables; nothing is hard-coded per font.
 *
 * Run with: node --test src/lib/fonts/__tests__/font-metrics.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assCellRatio, codePointsOf, cssContentMetrics, emToAssFontSize, parseFontMetrics, textAdvance } from "../font-metrics.ts";
import { buildSyntheticTtf } from "./synthetic-font.ts";

const SPEC = {
  unitsPerEm: 1000,
  hheaAscent: 950,
  hheaDescent: 250,
  typoAscent: 800,
  typoDescent: 200,
  winAscent: 1100,
  winDescent: 660,
  capHeight: 700,
  xHeight: 500,
  advance: 600,
  advances: { i: 250, W: 900, " ": 300 },
};

test("parseFontMetrics reads unitsPerEm, hhea / typo / win metrics, cap height and x-height from the font tables", () => {
  const m = parseFontMetrics(buildSyntheticTtf(SPEC))!;
  assert.ok(m);
  assert.equal(m.unitsPerEm, 1000);
  assert.equal(m.hheaAscent, 950);
  assert.equal(m.hheaDescent, 250);
  assert.equal(m.typoAscent, 800);
  assert.equal(m.typoDescent, 200);
  assert.equal(m.winAscent, 1100);
  assert.equal(m.winDescent, 660);
  assert.equal(m.capHeight, 700);
  assert.equal(m.xHeight, 500);
  assert.equal(m.useTypoMetrics, false);
});

test("parseFontMetrics resolves advances through the cmap, per character", () => {
  const m = parseFontMetrics(buildSyntheticTtf(SPEC))!;
  assert.equal(m.advances["i".codePointAt(0)!], 250);
  assert.equal(m.advances["W".codePointAt(0)!], 900);
  assert.equal(m.advances[" ".codePointAt(0)!], 300);
  assert.equal(m.advances["a".codePointAt(0)!], 600);
  assert.equal(m.advances[0x4e00], undefined, "a code point the font lacks has no entry");
});

test("parseFontMetrics only keeps the requested code points when asked", () => {
  const m = parseFontMetrics(buildSyntheticTtf(SPEC), codePointsOf("Wi"))!;
  assert.deepEqual(Object.keys(m.advances).map(Number).sort(), ["W".codePointAt(0)!, "i".codePointAt(0)!].sort());
});

test("parseFontMetrics flags OS/2 USE_TYPO_METRICS and returns null for garbage", () => {
  assert.equal(parseFontMetrics(buildSyntheticTtf({ ...SPEC, useTypoMetrics: true }))!.useTypoMetrics, true);
  assert.equal(parseFontMetrics(new Uint8Array([1, 2, 3])), null);
  assert.equal(parseFontMetrics(new Uint8Array(200)), null);
});

test("assCellRatio is the Windows cell over the em; emToAssFontSize applies it", () => {
  const m = parseFontMetrics(buildSyntheticTtf(SPEC))!;
  assert.equal(assCellRatio(m), 1.76);
  assert.ok(Math.abs(emToAssFontSize(100, m) - 176) < 1e-9);
});

test("two fonts with different cells get different export sizes for the SAME logical size (no global factor)", () => {
  const tight = parseFontMetrics(buildSyntheticTtf({ ...SPEC, winAscent: 900, winDescent: 300 }))!; // 1.2
  const loose = parseFontMetrics(buildSyntheticTtf(SPEC))!; // 1.76
  assert.ok(Math.abs(emToAssFontSize(80, tight) - 96) < 1e-9);
  assert.ok(Math.abs(emToAssFontSize(80, loose) - 140.8) < 1e-9);
});

test("cssContentMetrics uses hhea, or the typo metrics when the font asks for them", () => {
  const hhea = cssContentMetrics(parseFontMetrics(buildSyntheticTtf(SPEC))!);
  assert.equal(hhea.ascent, 0.95);
  assert.equal(hhea.descent, 0.25);
  const typo = cssContentMetrics(parseFontMetrics(buildSyntheticTtf({ ...SPEC, useTypoMetrics: true }))!);
  assert.equal(typo.ascent, 0.8);
  assert.equal(typo.descent, 0.2);
});

test("textAdvance sums the advances at the em and adds letter spacing after every character", () => {
  const m = parseFontMetrics(buildSyntheticTtf(SPEC))!;
  // "Wi a" = 900 + 250 + 300 + 600 = 2050 units
  assert.ok(Math.abs(textAdvance(m, "Wi a", 100) - 205) < 1e-9);
  assert.ok(Math.abs(textAdvance(m, "Wi a", 100, 3) - (205 + 12)) < 1e-9, "4 characters × 3px");
  assert.equal(textAdvance(m, "", 100, 3), 0);
});

test("unknown characters fall back to the font's default advance", () => {
  const m = parseFontMetrics(buildSyntheticTtf(SPEC))!;
  assert.ok(Math.abs(textAdvance(m, "一", 100) - m.defaultAdvance / 10) < 1e-9);
});

test("codePointsOf deduplicates and handles astral characters", () => {
  assert.deepEqual(codePointsOf("aab").sort(), [97, 98]);
  assert.deepEqual(codePointsOf("\u{1F600}"), [0x1f600]);
});

// ─────────────── real bundled fonts (only where the local font cache has them) ───────────────

const CACHE = path.join(process.cwd(), "data", "fonts-cache");
const REAL: { file: string; cell: number }[] = [
  { file: "poppins-700.ttf", cell: 1.762 },
  { file: "anton-400.ttf", cell: 1.733 },
  { file: "oswald-700.ttf", cell: 1.702 },
  { file: "archivo-800.ttf", cell: 1.51 },
  { file: "inter-800.ttf", cell: 1.43 },
  { file: "montserrat-800.ttf", cell: 1.562 },
  { file: "bebas-neue-400.ttf", cell: 1.3 },
  { file: "dm-sans-700.ttf", cell: 1.322 },
];

test("real fonts: the Windows-cell ratio equals the measured libass preview÷export ratio", (t) => {
  if (!existsSync(CACHE)) return t.skip("no local font cache");
  const have = new Set(readdirSync(CACHE));
  let checked = 0;
  for (const { file, cell } of REAL) {
    if (!have.has(file)) continue;
    const m = parseFontMetrics(new Uint8Array(readFileSync(path.join(CACHE, file))));
    assert.ok(m, file);
    assert.ok(Math.abs(assCellRatio(m) - cell) < 0.005, `${file}: ${assCellRatio(m).toFixed(3)} vs ${cell}`);
    assert.ok(m.advances["A".codePointAt(0)!] > 0, `${file} has advances`);
    checked++;
  }
  if (checked === 0) t.skip("none of the reference fonts are cached");
});

// ───────────────────────────── source guards ─────────────────────────────

test("no per-font multiplier is hard-coded in the metric model or the layout", () => {
  const files = ["src/lib/fonts/font-metrics.ts", "src/lib/subtitles/caption-layout.ts"];
  const names = /Poppins|Anton|Oswald|Archivo|Montserrat|Bebas|Baloo|Playfair|Roboto|Caveat|DM Sans|Inter\b/;
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!names.test(src), `${f} must not special-case any font`);
  }
});
