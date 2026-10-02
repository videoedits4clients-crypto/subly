/**
 * P20.2 — two export rendering gaps found with real FFmpeg frames while building the style
 * families, both of which would have made the new container/glow styles look wrong in the exported
 * MP4 while looking right in the editor preview:
 *
 *  1. BOX COLOUR. A caption background is an ASS BorderStyle-3 box, which libass draws in
 *     OutlineColour (its shadow in BackColour). The Style line put the box colour in BackColour, so
 *     News (red bar), Retro (orange), Sticker (yellow) … all exported as a BLACK box with a sliver of
 *     the real colour peeking out.
 *  2. GLOW. ASS has no blurred shadow; a "glow" (large, centred, blurred shadow — Neon, Cinematic
 *     Glow …) exported as a hard-offset ghost copy of the text. Glow captions now also emit a
 *     blurred Layer-0 underlay in the shadow colour (isGlowStyle in ass.ts).
 *
 * Run with: node --test src/lib/subtitles/__tests__/style-render-parity.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAssDocument, isGlowStyle } from "../ass.ts";
import { getPreset } from "../../presets.ts";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE } from "../../../types/subtitle.ts";
import type { AnimationConfig, Subtitle, SubtitleStyle } from "../../../types/subtitle.ts";

const WORDS = [
  { text: "Neon", start: 1, end: 1.6 },
  { text: "glow", start: 1.6, end: 2.2 },
  { text: "style", start: 2.2, end: 3 },
];
const SUB: Subtitle = { id: "s", index: 0, start: 1, end: 3, text: "Neon glow style", words: WORDS };

function render(style: Partial<SubtitleStyle>, animation: Partial<AnimationConfig> = {}, subtitles: Subtitle[] = [SUB]): string {
  return buildAssDocument({
    subtitles,
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, ...style },
    globalAnimation: { ...DEFAULT_ANIMATION, entrance: "none", ...animation },
    playResX: 540,
    playResY: 960,
  });
}
const styles = (doc: string) => doc.split("\n").filter((l) => l.startsWith("Style: ")).map((l) => l.slice(7).split(","));
const events = (doc: string, layer: 0 | 1) => doc.split("\n").filter((l) => l.startsWith(`Dialogue: ${layer},`));

// Style fields: 0 Name, 3 Primary, 5 Outline, 6 Back, 15 BorderStyle, 16 Outline, 17 Shadow
const F = { name: 0, primary: 3, outline: 5, back: 6, border: 15, outlineW: 16, shadow: 17 };

// ───────────────────────── box colour ─────────────────────────

test("a background box is drawn in the box colour: OutlineColour carries it, BackColour is transparent", () => {
  const [s] = styles(render({ backgroundColor: "#B91C1C", backgroundOpacity: 1, outlineEnabled: false, textCase: "none" }));
  assert.equal(s[F.border], "3", "BorderStyle 3 = opaque box");
  assert.equal(s[F.outline], "&H001C1CB9&", "box colour #B91C1C as ASS BGR");
  assert.equal(s[F.back], "&HFF000000&", "no stray coloured 'shadow' sliver");
});

test("box opacity is honoured in the box colour's alpha", () => {
  const [s] = styles(render({ backgroundColor: "#000000", backgroundOpacity: 0.6, outlineEnabled: false }));
  assert.equal(s[F.outline], "&H66000000&", "60% opaque = alpha 0x66");
});

test("real presets: News is red, Retro orange, Sticker yellow, Documentary navy — not black", () => {
  const expectBox = (id: string, bgr: string) => {
    const p = getPreset(id)!;
    const [s] = styles(buildAssDocument({ subtitles: [SUB], globalStyle: p.style, globalAnimation: p.animation, playResX: 540, playResY: 960 }));
    assert.ok(s[F.outline].startsWith("&H") && s[F.outline].includes(bgr), `${id}: expected box colour ${bgr}, got ${s[F.outline]}`);
    assert.equal(s[F.back], "&HFF000000&");
  };
  expectBox("news", "1C1CB9");
  expectBox("retro", "0C41C2");
  expectBox("sticker", "47E0FD");
  expectBox("documentary", "2A170F");
  expectBox("sticker-pill", "9948EC");
});

test("captions WITHOUT a box keep their text outline colour and shadow exactly as before", () => {
  const [s] = styles(render({ outlineEnabled: true, outlineColor: "#112233", outlineWidth: 6, shadowEnabled: true, shadowBlur: 12, shadowOpacity: 0.5, shadowColor: "#000000" }));
  assert.equal(s[F.border], "1");
  assert.equal(s[F.outline], "&H00332211&");
  assert.equal(s[F.back], "&H80000000&", "shadow colour with its 50% opacity, unchanged");
  assert.notEqual(s[F.shadow], "0");
});

// ───────────────────────── glow ─────────────────────────

test("isGlowStyle: large centred blurred shadow, no box — and nothing else", () => {
  const base = DEFAULT_SUBTITLE_STYLE;
  assert.equal(isGlowStyle({ ...base, shadowBlur: 26 }), true);
  assert.equal(isGlowStyle({ ...base, shadowBlur: 17 }), false, "below the blur threshold");
  assert.equal(isGlowStyle({ ...base, shadowBlur: 26, shadowOffsetY: 6 }), false, "a clearly offset shadow is a drop shadow, not a glow");
  assert.equal(isGlowStyle({ ...base, shadowBlur: 26, shadowEnabled: false }), false);
  assert.equal(isGlowStyle({ ...base, shadowBlur: 26, backgroundOpacity: 0.5 }), false, "boxed captions never glow");
  assert.equal(isGlowStyle(base), false, "the default style (blur 12) keeps its hard shadow");
});

test("a glow caption emits a blurred underlay style + Layer-0 events under the crisp Layer-1 text", () => {
  const doc = render({ color: "#39FF88", shadowColor: "#39FF88", shadowBlur: 26, shadowOpacity: 0.9, shadowOffsetY: 0, outlineEnabled: false });
  const [main, glow] = styles(doc);
  assert.equal(main[F.name], "S0");
  assert.equal(glow[F.name], "S0G");
  assert.equal(main[F.shadow], "0", "the crisp text no longer carries the hard ghost shadow");
  assert.equal(glow[F.primary], "&H1988FF39&", "underlay filled in the shadow colour at 90% opacity");
  assert.equal(glow[F.outlineW], "0");
  assert.equal(glow[F.back], "&HFF000000&");
  assert.equal(glow[2], main[2], "same font size so the halo sits exactly behind the glyphs");
  assert.equal(events(doc, 0).length, events(doc, 1).length, "one underlay per text event");
  for (const e of events(doc, 0)) {
    assert.ok(e.includes(",S0G,"), "underlay uses the glow style");
    assert.match(e, /\\blur\d+(\.\d+)?/);
  }
  for (const e of events(doc, 1)) assert.ok(e.includes(",S0,") && !/\\blur/.test(e));
});

test("glow blur radius follows the style's blur and the export scale (CSS blur radius ≈ 2σ)", () => {
  const blurOf = (shadowBlur: number, playResY: number) => {
    const doc = buildAssDocument({
      subtitles: [SUB],
      globalStyle: { ...DEFAULT_SUBTITLE_STYLE, shadowBlur, shadowOffsetY: 0 },
      globalAnimation: { ...DEFAULT_ANIMATION, entrance: "none" },
      playResX: playResY / 2,
      playResY,
    });
    return Number(/\\blur(\d+(?:\.\d+)?)/.exec(events(doc, 0)[0])![1]);
  };
  assert.equal(blurOf(26, 960), 6.5);
  assert.equal(blurOf(26, 1920), 13);
  assert.ok(blurOf(40, 960) > blurOf(20, 960));
});

test("the underlay is one flat colour: per-word colour overrides are stripped, sizes and breaks are kept", () => {
  const sub: Subtitle = {
    ...SUB,
    text: "Neon glow\nstyle",
    words: [
      { text: "Neon", start: 1, end: 1.6 },
      { text: "glow", start: 1.6, end: 2.2, style: { color: "#FF0000", fontSize: 128 } },
      { text: "style", start: 2.2, end: 3 },
    ],
  };
  const doc = render({ shadowBlur: 26, shadowOffsetY: 0, wordHighlight: true }, { word: "color" }, [sub]);
  for (const e of events(doc, 0)) {
    assert.ok(!/\\c&H/.test(e), `underlay must not recolour words: ${e}`);
    assert.ok(e.includes("\\N"), "line break kept so the halo stays behind the right line");
  }
  assert.ok(events(doc, 0).some((e) => /\\fscx200\\fscy200/.test(e)), "the enlarged word is enlarged in the underlay too");
  assert.ok(events(doc, 1).some((e) => /\\c&H/.test(e)), "the crisp text keeps its colours");
});

test("the underlay moves and fades with the caption (entrance slide + exit fade)", () => {
  const doc = render({ shadowBlur: 26, shadowOffsetY: 0, shadowOpacity: 0.8 }, { entrance: "slide-up", exit: "fade", durationSec: 0.5 });
  const move = /\\move\((\d+),(\d+),(\d+),(\d+),0,(\d+)\)/;
  const textMove = events(doc, 1).find((e) => move.test(e))!;
  const glowMove = events(doc, 0).find((e) => move.test(e))!;
  assert.deepEqual(move.exec(glowMove)!.slice(1), move.exec(textMove)!.slice(1), "same entrance motion");
  const lastGlow = events(doc, 0).at(-1)!;
  // glow alpha ramps FROM its own 20% transparency (0x33), not from the text's alpha
  assert.match(lastGlow, /\\1a&H33&|\\t\(0,\d+,\\1a&HFF&/);
  assert.ok(/\\t\(\d+,\d+,\\1a&HFF&/.test(lastGlow) || /\\t\(0,500,\\1a&HFF&/.test(lastGlow), "glow fades out with the text");
});

test("non-glow styles are untouched: no underlay style, no Layer-0 events, hard shadow kept", () => {
  const doc = render({});
  assert.equal(styles(doc).length, 1);
  assert.equal(events(doc, 0).length, 0);
  assert.notEqual(styles(doc)[0][F.shadow], "0");
});

test("bg-highlight chips and glow coexist: chips stay Layer 0, are counted once per active interval", () => {
  const doc = render({ shadowBlur: 26, shadowOffsetY: 0, wordHighlight: true }, { word: "bg-highlight" });
  const layer0 = events(doc, 0);
  const chips = layer0.filter((e) => /\\p1/.test(e));
  const underlays = layer0.filter((e) => /\\blur/.test(e));
  assert.equal(chips.length, 3, "one chip per active-word interval");
  assert.equal(underlays.length, events(doc, 1).length);
});

// ───────────────────────── sentence case (P20.3) ─────────────────────────

test("sentence case capitalises only the caption's FIRST word (it used to Title-Case every word)", async () => {
  const { applyWordTextCase } = await import("../../../types/subtitle.ts");
  assert.equal(applyWordTextCase("every", "sentence", 0), "Every");
  assert.equal(applyWordTextCase("great", "sentence", 1), "great");
  assert.equal(applyWordTextCase("iPhone", "sentence", 3), "iPhone", "later words keep their natural capitalisation");
  assert.equal(applyWordTextCase("great", "uppercase", 2), "GREAT");
  assert.equal(applyWordTextCase("GREAT", "lowercase", 2), "great");
  assert.equal(applyWordTextCase("great", "none", 0), "great");
});

test("export: a sentence-case caption renders 'Every great story', not 'Every Great Story'", () => {
  const sub: Subtitle = {
    id: "s",
    index: 0,
    start: 0,
    end: 2,
    text: "every great story",
    words: [
      { text: "every", start: 0, end: 0.6 },
      { text: "great", start: 0.6, end: 1.2 },
      { text: "story", start: 1.2, end: 2 },
    ],
  };
  const doc = render({ textCase: "sentence" }, { word: "none" }, [sub]);
  const text = events(doc, 1)[0];
  assert.match(text, /Every great story/);
  assert.ok(!/Great|Story/.test(text));
});

test("export: if the first word was removed, the next visible word becomes the capitalised first word", () => {
  const sub: Subtitle = {
    id: "s",
    index: 0,
    start: 0,
    end: 2,
    text: "great story",
    words: [
      { text: "um", start: 0, end: 0.4, removed: true },
      { text: "great", start: 0.4, end: 1.2 },
      { text: "story", start: 1.2, end: 2 },
    ],
  };
  const text = events(render({ textCase: "sentence" }, { word: "none" }, [sub]), 1)[0];
  assert.match(text, /Great story/);
  assert.ok(!/um/i.test(text));
});

test("preview and picker use the same per-caption sentence-case rule", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  for (const f of ["components/editor/subtitle-overlay.tsx", "components/editor/presets-panel.tsx", "lib/subtitles/ass.ts"]) {
    const src = readFileSync(path.join(root, f), "utf-8");
    assert.match(src, /applyWordTextCase/, `${f} must use applyWordTextCase`);
    assert.ok(!/[^a-zA-Z]applyTextCase\(/.test(src.replace(/applyWordTextCase/g, "")), `${f} must not call the per-word applyTextCase directly`);
  }
});

// ───────────────────────── script fallback weight (P20.3) ─────────────────────────

test("a Devanagari word in a heavy single-weight display face (Anton, Bangers…) is bolded; Latin words and normal fonts are not", async () => {
  const { scriptFallbackWeight, HEAVY_DISPLAY_FONTS } = await import("../script-detect.ts");
  assert.equal(scriptFallbackWeight("Anton", 400), 700);
  assert.equal(scriptFallbackWeight("Bangers", 400), 700);
  assert.equal(scriptFallbackWeight("Inter", 400), 400, "a normal family keeps its own weight");
  assert.equal(scriptFallbackWeight("Inter", 800), 800);
  assert.equal(scriptFallbackWeight("Anton", 900), 900);
  assert.ok(HEAVY_DISPLAY_FONTS.has("Permanent Marker") && HEAVY_DISPLAY_FONTS.has("Archivo Black") && HEAVY_DISPLAY_FONTS.has("Bebas Neue"));

  const hindi: Subtitle = {
    id: "h",
    index: 0,
    start: 0,
    end: 2,
    text: "नमस्ते world",
    words: [
      { text: "नमस्ते", start: 0, end: 1 },
      { text: "world", start: 1, end: 2 },
    ],
  };
  const anton = events(render({ fontFamily: "Anton", fontWeight: 400, wordHighlight: false }, { word: "none" }, [hindi]), 1)[0];
  assert.match(anton, /\{\\fnNoto Sans Devanagari\\b1\}नमस्ते/, "the fallback word is bolded");
  assert.equal((anton.match(/\\b1/g) ?? []).length, 1, "only the fallback word is bolded — the Latin word is untouched");
  const inter = events(render({ fontFamily: "Inter", fontWeight: 400, wordHighlight: false }, { word: "none" }, [hindi]), 1)[0];
  assert.ok(!/\\b1/.test(inter), "a normal family's fallback keeps weight 400");
  const bold = events(render({ fontFamily: "Anton", fontWeight: 700, wordHighlight: false }, { word: "none" }, [hindi]), 1)[0];
  assert.ok(!/\\b1/.test(bold), "already bold via the style line — no override needed");
});

test("a word's own weight override still wins over the fallback boost", () => {
  const sub: Subtitle = {
    id: "h",
    index: 0,
    start: 0,
    end: 1,
    text: "नमस्ते",
    words: [{ text: "नमस्ते", start: 0, end: 1, style: { fontWeight: 400 } }],
  };
  const text = events(render({ fontFamily: "Bangers", fontWeight: 400, wordHighlight: false }, { word: "none" }, [sub]), 1)[0];
  assert.match(text, /\\b1.*\\b0/, "manual \\b0 comes after the automatic \\b1");
});
