/**
 * P20.4 — the ASS export's GEOMETRY MODE (used whenever a font-metrics provider is supplied): the
 * logical em is converted to an ASS Fontsize from the font's own Windows cell, every visual line
 * is its own positioned event so libass never re-wraps, and the background box and the active-word
 * chip are drawn from the same layout the preview renders.
 *
 * Also the 12-family regression: ≥2 real presets of every style family go through the same path.
 *
 * Run with: node --test src/lib/subtitles/__tests__/ass-geometry-mode.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAssDocument } from "../ass.ts";
import { buildLayoutLines, layoutCaption, type MetricsProvider } from "../caption-layout.ts";
import { pickerPresetsByFamily, STYLE_FAMILIES } from "../../presets.ts";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE } from "../../../types/subtitle.ts";
import type { AnimationConfig, Subtitle, SubtitleStyle, Word } from "../../../types/subtitle.ts";
import { syntheticMetrics } from "../../fonts/__tests__/synthetic-font.ts";
import { assCellRatio } from "../../fonts/font-metrics.ts";

const TIGHT = syntheticMetrics({ cell: 1.2, advanceEm: 0.5, winDescentEm: 0.2 });
const LOOSE = syntheticMetrics({ cell: 1.76, advanceEm: 0.6, winDescentEm: 0.3 });
const byFamily: MetricsProvider = (family) => (family === "Loose" ? LOOSE : TIGHT);

function mkWords(text: string): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ text: t, start: 1 + i * 0.5, end: 1.5 + i * 0.5 }));
}
function mkSub(text: string, extra: Partial<Subtitle> = {}): Subtitle {
  const words = mkWords(text);
  return { id: "s", index: 0, start: 1, end: 1 + words.length * 0.5, text, words, ...extra };
}

function build(
  style: Partial<SubtitleStyle>,
  animation: Partial<AnimationConfig> = {},
  sub: Subtitle = mkSub("Neon glow style"),
  opts: { metrics?: MetricsProvider | null; w?: number; h?: number } = {},
): string {
  return buildAssDocument({
    subtitles: [sub],
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", ...style },
    globalAnimation: { ...DEFAULT_ANIMATION, entrance: "none", exit: "none", word: "none", ...animation },
    playResX: opts.w ?? 1080,
    playResY: opts.h ?? 1920,
    ...(opts.metrics === null ? {} : { fontMetrics: opts.metrics ?? byFamily }),
  });
}

const styleLines = (doc: string) => doc.split("\n").filter((l) => l.startsWith("Style: ")).map((l) => l.slice(7).split(","));
const allDialogues = (doc: string, layer: number) => doc.split("\n").filter((l) => l.startsWith(`Dialogue: ${layer},`));
/** The events of the FIRST interval only (a caption with word highlighting re-emits its lines per active word). */
const dialogues = (doc: string, layer: number) => {
  const first = doc.split("\n").find((l) => l.startsWith("Dialogue: "))!.split(",")[1];
  return allDialogues(doc, layer).filter((l) => l.split(",")[1] === first);
};
const FONTSIZE = 2;

/** pos(x,y) of an event line */
function pos(line: string): { x: number; y: number } {
  const m = /\\pos\(([-\d.]+),([-\d.]+)\)/.exec(line);
  assert.ok(m, `no \\pos in ${line}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}
const plain = (line: string) => line.replace(/^Dialogue: [^{]*/, "").replace(/\{[^}]*\}/g, "");

// ───────────────────────── logical size → ASS Fontsize ─────────────────────────

test("Fontsize = logical em × the font's own Windows cell ratio", () => {
  const doc = build({ fontSize: 100 });
  const [s] = styleLines(doc);
  assert.ok(Math.abs(Number(s[FONTSIZE]) - 100 * assCellRatio(TIGHT)) < 0.01);
  const loose = styleLines(build({ fontSize: 100, fontFamily: "Loose" }))[0];
  assert.ok(Math.abs(Number(loose[FONTSIZE]) - 100 * assCellRatio(LOOSE)) < 0.01);
  assert.ok(Number(loose[FONTSIZE]) > Number(s[FONTSIZE]) * 1.4, "different fonts, same logical size → different Fontsize");
});

test("the conversion scales with the export size (540×960 is half of 1080×1920)", () => {
  const big = Number(styleLines(build({ fontSize: 80 }))[0][FONTSIZE]);
  const small = Number(styleLines(build({ fontSize: 80 }, {}, mkSub("a b"), { w: 540, h: 960 }))[0][FONTSIZE]);
  assert.ok(Math.abs(big - 2 * small) < 0.02);
});

test("without a metrics provider the legacy rendering is untouched (Fontsize = logical px)", () => {
  const [s] = styleLines(build({ fontSize: 100 }, {}, mkSub("a b"), { metrics: null }));
  assert.equal(Number(s[FONTSIZE]), 100);
});

test("a font the provider can't supply keeps the legacy rendering for that style", () => {
  const none: MetricsProvider = () => undefined;
  const [s] = styleLines(build({ fontSize: 100 }, {}, mkSub("a b"), { metrics: none }));
  assert.equal(Number(s[FONTSIZE]), 100);
});

// ───────────────────────── one event per visual line ─────────────────────────

test("every visual line is its own positioned Dialogue — libass never re-wraps", () => {
  const sub = mkSub("one two three four five six seven eight nine ten eleven twelve", { text: "one two three four five six seven eight nine ten eleven twelve" });
  const doc = build({ fontSize: 80, boxWidthPercent: 60 }, {}, sub);
  const lines = dialogues(doc, 1);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.match(l, /\{\\an2\\pos\(/);
  assert.equal(
    lines.map(plain).join(" ").toLowerCase().replace(/\s+/g, " "),
    sub.text,
    "all words, in order, nothing dropped",
  );
});

test("the export's line breaks are exactly the layout's (the preview renders the same ones)", () => {
  const text = "the quick brown fox jumps over the lazy dog and keeps on running";
  const sub = mkSub(text);
  const style = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", fontSize: 90, boxWidthPercent: 55, textCase: "none" as const };
  const lines = buildLayoutLines(sub.text, sub.words, style, 1);
  const layout = layoutCaption(lines, style, { width: 1080, height: 1920 }, byFamily)!;
  const doc = build({ fontSize: 90, boxWidthPercent: 55, textCase: "none" }, {}, sub);
  const exported = dialogues(doc, 1).map(plain);
  assert.deepEqual(
    exported,
    layout.lines.map((l) => l.words.map((w) => sub.words[w.index].text).join(" ")),
  );
});

test("explicit line breaks stay separate events and no \\N is emitted", () => {
  const sub = mkSub("hello world\nsecond line", { text: "hello world\nsecond line" });
  const doc = build({ textCase: "none" }, {}, sub);
  assert.deepEqual(dialogues(doc, 1).map(plain), ["hello world", "second line"]);
  assert.ok(!/\\N/.test(dialogues(doc, 1).join("\n")));
});

test("the same wrap happens at every export size", () => {
  const text = "the quick brown fox jumps over the lazy dog and keeps on running";
  const a = dialogues(build({ fontSize: 90, boxWidthPercent: 55 }, {}, mkSub(text)), 1).map(plain);
  const b = dialogues(build({ fontSize: 90, boxWidthPercent: 55 }, {}, mkSub(text), { w: 540, h: 960 }), 1).map(plain);
  const c = dialogues(build({ fontSize: 90, boxWidthPercent: 55 }, {}, mkSub(text), { w: 720, h: 1280 }), 1).map(plain);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

// ───────────────────────── anchoring / position ─────────────────────────

test("alignment picks \\an1 / \\an2 / \\an3 and anchors each line at the layout's edge / centre", () => {
  const sub = mkSub("hello there", { text: "hello there" });
  const left = dialogues(build({ align: "left", x: 10, backgroundPaddingX: 0 }, {}, sub), 1)[0];
  assert.match(left, /\\an1/);
  assert.ok(Math.abs(pos(left).x - 108) < 0.5, "x = 10% of 1080 (no padding)");
  const right = dialogues(build({ align: "right", x: 90, backgroundPaddingX: 0 }, {}, sub), 1)[0];
  assert.match(right, /\\an3/);
  assert.ok(Math.abs(pos(right).x - 972) < 0.5);
  const centre = dialogues(build({ align: "center", x: 50 }, {}, sub), 1)[0];
  assert.match(centre, /\\an2/);
  assert.ok(Math.abs(pos(centre).x - 540) < 0.5);
});

test("the bottom-anchored line sits where the layout's baseline plus libass's own descent put it", () => {
  const sub = mkSub("hello", { text: "hello" });
  const style = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", fontSize: 100, textCase: "none" as const, y: 80, vAlign: "bottom" as const };
  const layout = layoutCaption(buildLayoutLines(sub.text, sub.words, style, 1), style, { width: 1080, height: 1920 }, byFamily)!;
  const y = pos(dialogues(build({ fontSize: 100, textCase: "none", y: 80, vAlign: "bottom" }, {}, sub), 1)[0]).y;
  assert.ok(Math.abs(y - (layout.lines[0].baseline + 0.2 * 100)) < 0.1);
});

test("a custom position moves every line with it", () => {
  const sub = mkSub("a\nb", { text: "a\nb" });
  const low = dialogues(build({ y: 85 }, {}, sub), 1).map((l) => pos(l).y);
  const high = dialogues(build({ y: 20 }, {}, sub), 1).map((l) => pos(l).y);
  assert.ok(Math.abs(low[0] - high[0] - 0.65 * 1920) < 0.5);
  assert.ok(Math.abs(low[1] - low[0] - (high[1] - high[0])) < 0.01, "line pitch unchanged");
});

test("line pitch follows lineHeight × em, not the font's libass cell", () => {
  const sub = mkSub("a\nb", { text: "a\nb" });
  for (const fontFamily of ["Tight", "Loose"]) {
    const ys = dialogues(build({ fontFamily, fontSize: 80, lineHeight: 1.5 }, {}, sub), 1).map((l) => pos(l).y);
    assert.ok(Math.abs(ys[1] - ys[0] - 120) < 0.1, `${fontFamily}: ${ys[1] - ys[0]}`);
  }
});

// ───────────────────────── box, chip, glow ─────────────────────────

test("a background is ONE rounded vector shape behind all lines, not libass's per-line box", () => {
  const sub = mkSub("hello world\nsecond", { text: "hello world\nsecond" });
  const doc = build({ backgroundOpacity: 1, backgroundColor: "#B91C1C", backgroundRadius: 20, backgroundPaddingX: 30, backgroundPaddingY: 20 }, {}, sub);
  assert.equal(styleLines(doc)[0][15], "1", "BorderStyle 1: no per-line libass box");
  const boxes = dialogues(doc, 0).filter((l) => l.includes("\\p1"));
  assert.equal(boxes.length, 1);
  assert.match(boxes[0], /\\1c&H001C1CB9&/);
  assert.match(boxes[0], / b /, "rounded corners are bezier segments");
  assert.equal(dialogues(doc, 1).length, 2);
});

test("box size = widest line + padding, taken from the layout", () => {
  const sub = mkSub("hello world", { text: "hello world" });
  const style = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", fontSize: 80, backgroundPaddingX: 40, backgroundPaddingY: 25, textCase: "none" as const };
  const layout = layoutCaption(buildLayoutLines(sub.text, sub.words, style, 1), style, { width: 1080, height: 1920 }, byFamily)!;
  const doc = build({ fontSize: 80, backgroundOpacity: 1, backgroundPaddingX: 40, backgroundPaddingY: 25, textCase: "none", backgroundRadius: 0 }, {}, sub);
  const shape = dialogues(doc, 0).find((l) => l.includes("\\p1"))!;
  const nums = (/\\p1\}(.*)\{\\p0\}/.exec(shape)![1].match(/[\d.]+/g) ?? []).map(Number);
  assert.ok(Math.abs(Math.max(...nums) - Math.round(layout.block.height)) <= 1 || Math.abs(Math.max(...nums) - Math.round(layout.block.width)) <= 1);
  assert.ok(nums.some((n) => Math.abs(n - layout.block.width) <= 1), "path spans the block width");
  assert.ok(nums.some((n) => Math.abs(n - layout.block.height) <= 1), "path spans the block height");
});

test("the active-word chip is a rounded shape from the layout, one per active interval, behind the text", () => {
  const sub = mkSub("alpha beta gamma", { text: "alpha beta gamma" });
  const doc = build({ wordHighlight: true, highlightColor: "#FACC15" }, { word: "bg-highlight" }, sub);
  const chips = allDialogues(doc, 0).filter((l) => l.includes("\\p1") && l.includes("\\1c&H0015CCFA&"));
  assert.equal(chips.length, 3, "one chip per word interval");
  const xs = chips.map((c) => pos(c).x);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], "the chip walks left to right with the active word");
  for (const c of chips) assert.match(c, /\{\\an7/);
});

test("the chip hugs the active word's own box: its left edge is 0.15em left of the word", () => {
  const sub = mkSub("alpha beta", { text: "alpha beta" });
  const style = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", textCase: "none" as const, fontSize: 100 };
  const layout = layoutCaption(buildLayoutLines(sub.text, sub.words, style, 1), style, { width: 1080, height: 1920 }, byFamily)!;
  const doc = build({ wordHighlight: true, textCase: "none", fontSize: 100 }, { word: "bg-highlight" }, sub);
  const chips = allDialogues(doc, 0).filter((l) => l.includes("\\p1"));
  const second = layout.lines[0].words[1];
  assert.ok(Math.abs(pos(chips[1]).x - (second.left - 15)) < 0.1);
});

test("a scaled active word is its own event: neighbours stay at their layout positions, nothing re-flows", () => {
  const sub = mkSub("alpha beta gamma", { text: "alpha beta gamma" });
  const style = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", fontSize: 100, textCase: "none" as const, wordHighlight: true, activeWordScale: 1.5 };
  const layout = layoutCaption(buildLayoutLines(sub.text, sub.words, style, 1), style, { width: 1080, height: 1920 }, byFamily)!;
  const doc = build({ wordHighlight: true, activeWordScale: 1.5, fontSize: 100, textCase: "none" }, { word: "scale" }, sub);
  const ev = dialogues(doc, 1); // first interval: "alpha" is active
  assert.equal(ev.length, 3, "one event per word on the line holding the scaled word");
  const line = layout.lines[0];
  const [alpha, beta, gamma] = line.words;
  for (const [event, w] of [[ev[1], beta], [ev[2], gamma]] as const) {
    const p = pos(event);
    assert.ok(Math.abs(p.x - (w.left + w.right) / 2) < 0.1, "centre of the word's own advance");
    assert.ok(Math.abs(p.y - (line.baseline + w.assDescentPx)) < 0.1);
  }
  // the active word scales about the centre of its inline box: its final anchor is Q + s(A − Q)
  const m = /\\move\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),0,(\d+)\)/.exec(ev[0]);
  assert.ok(m, "the active word eases in with a move");
  const ax = (alpha.left + alpha.right) / 2;
  const ay = line.baseline + alpha.assDescentPx;
  const qx = (alpha.left + alpha.boxRight) / 2;
  const qy = line.baseline - alpha.runAbove + alpha.runHeight / 2;
  assert.ok(Math.abs(Number(m![1]) - ax) < 0.1 && Math.abs(Number(m![2]) - ay) < 0.1, "starts at the unscaled anchor");
  assert.ok(Math.abs(Number(m![3]) - (qx + 1.5 * (ax - qx))) < 0.1 && Math.abs(Number(m![4]) - (qy + 1.5 * (ay - qy))) < 0.1, "ends at Q + s(A − Q)");
});

test("a line without the scaled word keeps one event; word animations that don't scale keep one event per line", () => {
  const sub = mkSub("alpha beta gamma delta", { text: "alpha beta\ngamma delta" });
  const scaled = dialogues(build({ wordHighlight: true, textCase: "none" }, { word: "scale" }, sub), 1);
  assert.equal(scaled.length, 3, "line 1 split into two words, line 2 intact");
  for (const word of ["color", "underline", "highlight", "none"] as const) {
    assert.equal(dialogues(build({ wordHighlight: true, textCase: "none" }, { word }, sub), 1).length, 2, word);
  }
});

test("glow styles emit one blurred underlay per line, in their own style, under the text", () => {
  const sub = mkSub("hello world\nsecond", { text: "hello world\nsecond" });
  const doc = build({ shadowEnabled: true, shadowColor: "#00E5FF", shadowBlur: 40, shadowOffsetX: 0, shadowOffsetY: 0, shadowOpacity: 1 }, {}, sub);
  const glow = dialogues(doc, 0);
  assert.equal(glow.length, 2);
  for (const l of glow) assert.match(l, /\\blur/);
  assert.equal(dialogues(doc, 1).length, 2);
});

test("a manual per-word font size is a run scale (\\fscx / \\fscy) relative to the base size", () => {
  const words = mkWords("big small");
  words[0] = { ...words[0], style: { fontSize: 160 } };
  const sub: Subtitle = { id: "s", index: 0, start: 1, end: 2, text: "big small", words };
  const doc = build({ fontSize: 80, textCase: "none" }, {}, sub);
  const line = dialogues(doc, 1)[0];
  assert.match(line, /\\fscx200\\fscy200\}big/, "160 / 80 = 200%");
});

// ───────────────────────── 12-family regression ─────────────────────────

test("12 families, at least 2 presets each, go through geometry mode cleanly", () => {
  assert.equal(STYLE_FAMILIES.length, 12);
  // a distinct synthetic cell per font family: nothing may depend on the font NAME
  const providerFor: MetricsProvider = (family) => {
    let h = 0;
    for (const ch of family) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return syntheticMetrics({ cell: 1.2 + (h % 60) / 100, advanceEm: 0.45 + (h % 20) / 100 });
  };
  const sub = mkSub("Preview and export must match exactly", { text: "Preview and export\nmust match exactly" });
  for (const family of STYLE_FAMILIES) {
    const presets = pickerPresetsByFamily(family);
    assert.ok(presets.length >= 2, `${family} has ≥2 presets`);
    for (const preset of presets.slice(0, 2)) {
      const doc = buildAssDocument({
        subtitles: [sub],
        globalStyle: preset.style,
        globalAnimation: { ...preset.animation, entrance: "none", exit: "none" },
        playResX: 720,
        playResY: 1280,
        fontMetrics: providerFor,
      });
      assert.ok(!/NaN|undefined|Infinity/.test(doc), `${preset.id}: no NaN/undefined in the document`);
      const [s] = styleLines(doc);
      const m = providerFor(preset.style.fontFamily, preset.style.fontWeight)!;
      const expected = preset.style.fontSize * (1280 / 1920) * assCellRatio(m);
      assert.ok(Math.abs(Number(s[FONTSIZE]) - expected) < 0.02, `${preset.id}: Fontsize ${s[FONTSIZE]} vs ${expected.toFixed(2)}`);
      const text = dialogues(doc, 1);
      assert.ok(text.length >= 2, `${preset.id}: the explicit line break is kept`);
      for (const l of text) assert.match(l, /\\an[123]\\(pos|move)\(/, preset.id);
      if (preset.style.backgroundOpacity > 0) assert.equal(dialogues(doc, 0).filter((l) => l.includes("\\p1")).length, 1, `${preset.id}: one box`);
    }
  }
});

test("every preset (visible and legacy) builds in geometry mode without error", () => {
  const sub = mkSub("Check this out now", { text: "Check this out now" });
  for (const family of STYLE_FAMILIES) {
    for (const preset of pickerPresetsByFamily(family)) {
      assert.doesNotThrow(() =>
        buildAssDocument({
          subtitles: [sub],
          globalStyle: preset.style,
          globalAnimation: preset.animation,
          playResX: 1080,
          playResY: 1920,
          fontMetrics: byFamily,
        }),
      preset.id);
    }
  }
});

test("entrance and exit animations still produce well-formed per-line events in geometry mode", () => {
  for (const entrance of ["fade", "slide-up", "pop", "typewriter", "bounce"] as const) {
    const doc = build({}, { entrance, exit: "fade" } as Partial<AnimationConfig>, mkSub("hello world", { text: "hello world" }));
    assert.ok(dialogues(doc, 1).length >= 1, entrance);
    assert.ok(!/NaN|undefined/.test(doc), entrance);
  }
});
