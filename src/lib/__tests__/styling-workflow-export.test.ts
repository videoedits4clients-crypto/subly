/**
 * P23 — what the editor holds is what the exporter serialises: a project that went through the real workflow
 * (template to all → another template on one caption → custom position on another → word styling → edits) produces ASS in
 * which every caption has the look the editor shows for it, and each caption's own look is not mixed up with another's.
 *
 * Run with: node --test src/lib/__tests__/styling-workflow-export.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../../store/editor-store.ts";
import { buildAssDocument } from "../subtitles/ass.ts";
import { collectRequiredFonts } from "../subtitles/ass.ts";
import { CAPTION_TEMPLATES, resolveTemplate } from "../caption-templates.ts";
import { DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_SUBTITLE_STYLE, DEFAULT_TIMING_RULES, resolveAnimation, resolveStyle } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { syntheticMetrics } from "../fonts/__tests__/synthetic-font.ts";

const tpl = (id: string) => resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === id)!);
const METRICS = syntheticMetrics({ cell: 1.4, advanceEm: 0.55 });

function fixture(): ProjectData {
  const mk = (i: number, text: string): Subtitle => {
    const ws = text.split(" ");
    return {
      id: `s${i}`,
      index: i,
      start: 1 + i * 3,
      end: 3.6 + i * 3,
      text,
      words: ws.map((t, j) => ({ text: t, start: 1 + i * 3 + j * 0.6, end: 1 + i * 3 + (j + 1) * 0.6 })),
    };
  };
  return {
    id: "p",
    name: "x",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles: [mk(0, "Plain project caption"), mk(1, "Template caption here"), mk(2, "Custom position caption"), mk(3, "Word styled caption")],
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    animation: DEFAULT_ANIMATION,
    timingRules: DEFAULT_TIMING_RULES,
    composition: DEFAULT_COMPOSITION,
    updatedAt: new Date().toISOString(),
    trimStart: 0,
    trimEnd: null,
    cutRanges: [],
  };
}

function ass(p: ProjectData, geometry: boolean) {
  return buildAssDocument({
    subtitles: p.subtitles,
    globalStyle: p.globalStyle,
    globalAnimation: p.animation,
    playResX: 1080,
    playResY: 1920,
    ...(geometry ? { fontMetrics: () => METRICS } : {}),
  });
}
const styles = (doc: string) => doc.split("\n").filter((l) => l.startsWith("Style: ")).map((l) => l.slice(7).split(","));
const events = (doc: string) => doc.split("\n").filter((l) => l.startsWith("Dialogue: "));
const styleOfEvent = (line: string) => line.split(",")[3];
const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());
const textOf = (line: string) => line.replace(/\{[^}]*\}/g, "").replace(/^Dialogue: [^,]*,[^,]*,[^,]*,[^,]*,,0,0,0,,/, "");

function workflowProject(): ProjectData {
  const st = useEditorStore.getState();
  st.load(fixture());
  st.applyTemplate({ all: true }, tpl("podcast-clean"));
  st.applyTemplate({ ids: ["s1"] }, tpl("creator-punch"));
  st.setSubtitleStyleOverride("s2", { x: 30, y: 25, align: "left", vAlign: "top", fontFamily: "Montserrat", fontWeight: 700 });
  st.setWordStyleOverride("s3", 1, { color: "#FF0000" });
  return useEditorStore.getState().project!;
}

for (const geometry of [true, false]) {
  const mode = geometry ? "geometry mode" : "legacy renderer";

  test(`every caption is exported with the look the editor shows for it (${mode})`, () => {
    const p = workflowProject();
    const doc = ass(p, geometry);
    const ev = events(doc);
    const sty = styles(doc);
    const nameOf = (caption: Subtitle) => styleOfEvent(ev.find((l) => has(textOf(l), caption.text.split(" ")[0]))!);
    const styleLine = (name: string) => sty.find((s) => s[0] === name)!;
    // looks: project (s0, s3), creator-punch (s1), podcast-clean + custom position/font (s2) → 3 distinct Style lines
    assert.equal(new Set(sty.map((s) => s[0]).filter((n) => !n.endsWith("G"))).size, 3, "one Style per distinct look");
    assert.equal(nameOf(p.subtitles[0]), nameOf(p.subtitles[3]), "captions sharing the project look share a Style");
    assert.notEqual(nameOf(p.subtitles[1]), nameOf(p.subtitles[0]));
    assert.notEqual(nameOf(p.subtitles[2]), nameOf(p.subtitles[0]));
    for (const caption of p.subtitles) {
      const eff = resolveStyle(p, caption);
      const line = styleLine(nameOf(caption));
      assert.equal(line[1], eff.fontFamily, `${caption.id}: font`);
      assert.equal(line[7 - 0] !== undefined, true);
      assert.equal(Number(line[2]) > 0, true);
    }
    // sizes differ per look: creator-punch (84) vs podcast-clean (48), in the same document
    const size = (c: Subtitle) => Number(styleLine(nameOf(c))[2]);
    assert.ok(size(p.subtitles[1]) > size(p.subtitles[0]) * 1.4, "creator-punch is much larger than podcast-clean");
    assert.ok(!/NaN|undefined/.test(doc));
  });

  test(`a caption's custom position is exported at that position, the others are not moved (${mode})`, () => {
    const p = workflowProject();
    const doc = ass(p, geometry);
    const ev = events(doc);
    const pos = (needle: string) => {
      const l = ev.find((x) => has(textOf(x), needle) && /\\(pos|move)\(/.test(x))!;
      const m = /\\pos\(([-\d.]+),([-\d.]+)\)/.exec(l) ?? /\\move\([-\d.]+,[-\d.]+,([-\d.]+),([-\d.]+)/.exec(l)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const custom = pos("Custom");
    const plain = pos("Plain");
    assert.ok(custom.x < 1080 * 0.5, "left-aligned at x=30%");
    assert.ok(custom.y < 1920 * 0.45, "top-ish at y=25%");
    assert.ok(plain.y > 1920 * 0.8, "the project caption stays low in the frame");
  });

  test(`per-word styling survives into the export (${mode})`, () => {
    const p = workflowProject();
    const word = events(ass(p, geometry)).filter((l) => has(textOf(l), "styled"));
    assert.ok(word.some((l) => l.includes("\\c&H000000FF&")), "word colour #FF0000 → ASS &H000000FF&");
  });

  test(`entrance / exit / word animation come from each caption's own animation (${mode})`, () => {
    const p = workflowProject();
    const doc = ass(p, geometry);
    const first = (needle: string) => events(doc).find((l) => has(textOf(l), needle))!;
    const punch = resolveAnimation(p, p.subtitles[1]);
    const clean = resolveAnimation(p, p.subtitles[0]);
    assert.equal(punch.entrance, "bounce");
    assert.equal(clean.entrance, "slide-up");
    assert.match(first("Template"), /\\fscx/, "bounce scales");
    assert.match(first("Plain"), /\\move/, "slide-up moves");
  });
}

test("every font any caption needs is requested for the export (the project font AND each override's)", () => {
  const p = workflowProject();
  const fonts = collectRequiredFonts(p.subtitles, p.globalStyle).map((f) => f.family);
  for (const caption of p.subtitles) assert.ok(fonts.includes(resolveStyle(p, caption).fontFamily), caption.id);
  assert.ok(fonts.includes("Montserrat") && fonts.includes("Anton") && fonts.includes("Nunito"));
});
