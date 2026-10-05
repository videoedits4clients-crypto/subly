/**
 * P21 — a scaling animation (pop / bounce entrance, pop exit) must scale the WHOLE caption block about its
 * centre, exactly as the preview's CSS transform does.
 *
 * Root cause being guarded: in geometry mode (P20.4) every visual line is its own ASS event. libass scales an
 * event about its own alignment anchor, so each line shrank/grew about its own baseline: the line pitch did
 * not scale (a 2-line pop was ~15% too tall at its smallest) and the caption drifted toward its anchor (up to
 * 4.6% of the frame height for a corner-anchored caption). The fix moves every anchor by (scale − 1) × (anchor −
 * block centre) and splits a scaling entrance into one event per piecewise-linear scale segment, because that
 * offset is linear in the scale.
 *
 * Also guards the preview side of the same QA pass: the word spans carry a CSS transition (the active-word
 * treatment), so a new caption must get fresh DOM or the previous caption's last highlighted word animates
 * into the next caption's first frames.
 *
 * Run with: node --test src/lib/subtitles/__tests__/animation-block-scale.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAssDocument } from "../ass.ts";
import { buildLayoutLines, layoutCaption, type MetricsProvider } from "../caption-layout.ts";
import { entranceFrame, entranceAssParts, motionAssParts, SCALE_SEGMENTS } from "../entrance-animation.ts";
import { scaleBreakpoints, exitFrame } from "../exit-animation.ts";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE } from "../../../types/subtitle.ts";
import type { AnimationConfig, Subtitle, SubtitleStyle } from "../../../types/subtitle.ts";
import { syntheticMetrics } from "../../fonts/__tests__/synthetic-font.ts";

const METRICS = syntheticMetrics({ cell: 1.4, advanceEm: 0.55, winDescentEm: 0.25 });
const provider: MetricsProvider = () => METRICS;
const W = 1080;
const H = 1920;

const SUB: Subtitle = {
  id: "s",
  index: 0,
  start: 1,
  end: 4,
  text: "Every great story\nbegins right here",
  words: ["Every", "great", "story", "begins", "right", "here"].map((t, i) => ({ text: t, start: 1 + i * 0.5, end: 1.5 + i * 0.5 })),
};

function build(style: Partial<SubtitleStyle>, animation: Partial<AnimationConfig>): string[] {
  const doc = buildAssDocument({
    subtitles: [SUB],
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", fontSize: 80, textCase: "none", wordHighlight: false, ...style },
    globalAnimation: { ...DEFAULT_ANIMATION, entrance: "none", exit: "none", word: "none", durationSec: 0.3, ...animation },
    playResX: W,
    playResY: H,
    fontMetrics: provider,
  });
  return doc.split("\n").filter((l) => l.startsWith("Dialogue: 1,"));
}

const secs = (t: string) => {
  const m = /(\d+):(\d+):(\d+)\.(\d+)/.exec(t)!;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
};
interface Ev {
  start: number;
  end: number;
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  scale0: number;
}
function parse(line: string): Ev {
  const f = line.split(",");
  const move = /\\move\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/.exec(line);
  const pos = /\\pos\(([-\d.]+),([-\d.]+)\)/.exec(line);
  const p = move ?? pos!;
  const sc = /\\fscx(\d+)/.exec(line);
  return {
    start: secs(f[1]),
    end: secs(f[2]),
    text: line.replace(/\{[^}]*\}/g, "").replace(/^Dialogue: [^,]*,[^,]*,[^,]*,[^,]*,,0,0,0,,/, ""),
    x0: Number(p[1]),
    y0: Number(p[2]),
    x1: Number(move ? p[3] : p[1]),
    y1: Number(move ? p[4] : p[2]),
    scale0: sc ? Number(sc[1]) / 100 : 1,
  };
}

function layoutFor(style: Partial<SubtitleStyle>) {
  const full = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Tight", fontSize: 80, textCase: "none" as const, ...style };
  return layoutCaption(buildLayoutLines(SUB.text, SUB.words, full, 1), full, { width: W, height: H }, provider)!;
}

// ───────────────────────── the shared segment / origin maths ─────────────────────────

test("scaleBreakpoints: a pop / bounce entrance splits at its scale-segment boundaries, nothing else does", () => {
  const anim = { entrance: "pop", exit: "none", durationSec: 0.4 } as const;
  const points = scaleBreakpoints(anim, 1, 4);
  assert.equal(points.length, SCALE_SEGMENTS - 1);
  points.forEach((t, i) => assert.ok(Math.abs(t - (1 + (0.4 * (i + 1)) / SCALE_SEGMENTS)) < 1e-9));
  assert.equal(scaleBreakpoints({ ...anim, entrance: "bounce" }, 1, 4).length, SCALE_SEGMENTS - 1);
  for (const entrance of ["none", "fade", "slide-up", "slide-left", "typewriter", "word-pop", "char-pop"] as const) {
    assert.deepEqual(scaleBreakpoints({ ...anim, entrance }, 1, 4), [], entrance);
  }
  assert.deepEqual(scaleBreakpoints({ entrance: "none", exit: "pop", durationSec: 0.4 }, 1, 4), [], "the exit pop is linear: no split needed");
});

test("scaleBreakpoints stops at the end of a caption shorter than its entrance", () => {
  const points = scaleBreakpoints({ entrance: "pop", exit: "none", durationSec: 0.4 }, 1, 1.2);
  assert.ok(points.every((t) => t < 1.2));
});

test("motionAssParts with an origin moves an anchor to origin + scale × (anchor − origin) at both ends of the event", () => {
  const origin = { x: 500, y: 900 };
  const frame = (p: number) => entranceFrame("pop", p);
  const parts = motionAssParts({
    frame,
    p0: 0.25,
    p1: 0.375,
    windowSec: 0.4,
    delaySec: 0,
    opacityKnee: 0.33,
    scales: true,
    fadeIn: true,
    fadeInEnd: 0.33,
    x: 0,
    y: 0,
    playResY: H,
    precision: 3,
    origin,
  });
  const tag = parts.positionAt(700, 1000);
  const m = /\\move\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),/.exec(tag)!;
  const s0 = frame(0.25).scale;
  const s1 = frame(0.375).scale;
  assert.ok(Math.abs(Number(m[1]) - (origin.x + s0 * 200)) < 1e-3);
  assert.ok(Math.abs(Number(m[2]) - (origin.y + s0 * 100)) < 1e-3);
  assert.ok(Math.abs(Number(m[3]) - (origin.x + s1 * 200)) < 1e-3);
  assert.ok(Math.abs(Number(m[4]) - (origin.y + s1 * 100)) < 1e-3);
});

test("without an origin (the legacy renderer) the position tags are exactly what they were", () => {
  const legacy = entranceAssParts({ entrance: "pop", durationSec: 0.3 }, 0, 540, 900, H);
  assert.equal(legacy.position, "\\pos(540,900)");
  const scaled = entranceAssParts({ entrance: "pop", durationSec: 0.3 }, 0, 540, 900, H, undefined, 0, {
    origin: { x: 540, y: 800 },
    eventEndOffsetSec: 0.0375,
  });
  assert.match(scaled.position, /^\\move\(/);
});

// ───────────────────────── the exported events ─────────────────────────

function exactScale(entrance: "pop" | "bounce", e: Ev): number {
  return entranceFrame(entrance, Math.min(1, Math.max(0, Math.round(((e.start - SUB.start) / 0.3) * SCALE_SEGMENTS) / SCALE_SEGMENTS))).scale;
}

/** The block must scale as one: at each event's start every line anchor sits at C + s (A − C). */
function assertBlockScalesAboutCentre(style: Partial<SubtitleStyle>, animation: Partial<AnimationConfig>, window: "entrance" | "exit") {
  const layout = layoutFor(style);
  const C = { x: layout.block.left + layout.block.width / 2, y: layout.block.top + layout.block.height / 2 };
  const an = style.align === "left" ? 1 : style.align === "right" ? 3 : 2;
  void an;
  const events = build(style, animation).map(parse);
  const lineAnchors = layout.lines.map((l) => ({
    x: l.anchorX,
    y: l.baseline + Math.max(...l.words.map((w) => w.assDescentPx)),
    text: l.words.map((w) => SUB.words[w.index].text).join(" "),
  }));
  let checked = 0;
  for (const e of events) {
    const inWindow = window === "entrance" ? e.start < SUB.start + 0.3 - 1e-6 : e.end > SUB.end - 0.3 + 1e-6;
    if (!inWindow) continue;
    const a = lineAnchors.find((l) => l.text === e.text);
    if (!a) continue;
    // the \fscx tag is whole percent; the position is computed from the exact curve at the event's own segment boundary
    const s = window === "entrance" ? exactScale(animation.entrance as "pop" | "bounce", e) : e.scale0;
    // an event that starts before the exit window begins is still at full size
    const expectX = C.x + s * (a.x - C.x);
    const expectY = C.y + s * (a.y - C.y);
    assert.ok(Math.abs(e.x0 - expectX) < 0.25, `"${e.text}" x ${e.x0} vs ${expectX.toFixed(2)} at scale ${s}`);
    assert.ok(Math.abs(e.y0 - expectY) < 0.25, `"${e.text}" y ${e.y0} vs ${expectY.toFixed(2)} at scale ${s}`);
    checked++;
  }
  assert.ok(checked >= 4, `checked ${checked} line events in the ${window} window`);
}

test("a 2-line POP entrance scales the block about its centre (line pitch scales with it)", () => {
  assertBlockScalesAboutCentre({}, { entrance: "pop" }, "entrance");
});

test("a 2-line BOUNCE entrance (overshoots past 1) scales the block about its centre", () => {
  assertBlockScalesAboutCentre({}, { entrance: "bounce" }, "entrance");
});

test("a corner-anchored caption scales about its own block centre, not toward its anchor", () => {
  assertBlockScalesAboutCentre({ align: "left", vAlign: "top", x: 8, y: 12 }, { entrance: "pop" }, "entrance");
  assertBlockScalesAboutCentre({ align: "right", vAlign: "bottom", x: 92, y: 88 }, { entrance: "bounce" }, "entrance");
});

test("a 2-line POP exit scales the block about its centre", () => {
  const layout = layoutFor({});
  const C = { y: layout.block.top + layout.block.height / 2 };
  const events = build({}, { exit: "pop" }).map(parse);
  const last = events.filter((e) => e.end > SUB.end - 0.05);
  assert.ok(last.length >= 2);
  const l1 = layout.lines[0];
  const a1 = l1.baseline + Math.max(...l1.words.map((w) => w.assDescentPx));
  const e1 = last.find((e) => e.text === "Every great story")!;
  // the event ends at the end of the caption: scale 0.6 (the exit pop's end state)
  const endScale = exitFrame("pop", 1).scale;
  assert.ok(Math.abs(e1.y1 - (C.y + endScale * (a1 - C.y))) < 0.3);
});

test("the entrance runs as one event per scale segment, each one linear (a single \\move)", () => {
  const events = build({}, { entrance: "pop" }).map(parse);
  const first = events.filter((e) => e.text === "Every great story" && e.start < SUB.start + 0.3);
  assert.equal(first.length, SCALE_SEGMENTS, "8 segments over the 0.3 s entrance");
  for (let i = 1; i < first.length; i++) assert.ok(Math.abs(first[i].start - first[i - 1].end) < 1e-6, "no gap between segments");
  for (const e of first) assert.ok(e.end - e.start > 0.02, "centisecond-rounded events keep a real duration");
});

test("a non-scaling entrance (fade, slide) is unchanged: one \\fad / \\move event per interval", () => {
  const fade = build({}, { entrance: "fade" }).map(parse);
  assert.equal(fade.filter((e) => e.text === "Every great story" && e.start < SUB.start + 0.3).length, 1);
  const slide = build({}, { entrance: "slide-up" }).map(parse);
  assert.equal(slide.filter((e) => e.text === "Every great story" && e.start < SUB.start + 0.3).length, 1);
});

// ───────────────────────── preview: no leakage between captions ─────────────────────────

test("the live preview gives every caption fresh DOM (no previous-caption highlight leaking into the next)", () => {
  const src = readFileSync("src/components/editor/live-subtitle-layer.tsx", "utf8");
  assert.match(src, /<SubtitleOverlay[\s\S]*?key=\{activeSubtitle\.id\}/, "SubtitleOverlay is keyed by the caption id");
  const overlay = readFileSync("src/components/editor/subtitle-overlay.tsx", "utf8");
  assert.match(overlay, /key=\{index\}/, "the word spans are keyed by index — which is why the caption itself must be keyed");
  assert.match(overlay, /transition: `all/.test(readFileSync("src/lib/subtitles/preview-style.ts", "utf8")) ? /className="inline-block transition-transform"/ : /./, "the active-word style animates, so stale spans would show it");
});
