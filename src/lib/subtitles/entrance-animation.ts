import type { AnimationConfig, EntranceAnimation } from "../../types/subtitle.ts";
import { effectiveEntranceDurationSec } from "./animation-render.ts";

/**
 * Entrance animation as a PURE function of (entrance type, time since the caption started,
 * configured duration) — the single definition both renderers read:
 *   - the live preview (components/editor/subtitle-overlay.tsx) evaluates `entranceFrameAt`
 *     directly with the video element's current time;
 *   - the ASS export (lib/subtitles/ass.ts) samples the very same `entranceFrame` curve into
 *     `\t` keyframes (scale) / a `\move` (slides) / a `\fad` (opacity) — see entranceAssParts.
 * Nothing here holds state: the same inputs always give the same frame, so scrubbing backwards,
 * seeking, replaying and repeated captions can never accumulate or leak animation state.
 *
 * Time origin is always the CAPTION's own start (never word start, never global time), so an
 * entrance always begins exactly when its caption appears and is over `durationSec` later.
 */

export interface EntranceFrame {
  /** 0..1 */
  opacity: number;
  /** Uniform scale of the whole caption box, 1 = final size. */
  scale: number;
  /** Horizontal / vertical displacement from the final position, as a fraction of the canvas
   * HEIGHT (so it scales with preview size and export resolution alike). Positive y = lower. */
  dx: number;
  dy: number;
}

/** Slide distance as a fraction of canvas height (~48px on a 1920-tall canvas). */
export const SLIDE_DISTANCE_FRAC = 0.025;

/** Per-entrance opacity ramp: opacity rises linearly 0→1 over this fraction of the duration
 * (a linear ramp is exactly what ASS `\fad(in,0)` renders, which is why it is linear). */
const FADE_FRACTION: Partial<Record<EntranceAnimation, number>> = {
  fade: 1,
  typewriter: 1,
  "word-pop": 1,
  "char-pop": 1,
  "slide-up": 0.5,
  "slide-down": 0.5,
  "slide-left": 0.5,
  "slide-right": 0.5,
  pop: 0.33,
  bounce: 0.33,
};

const IDENTITY: EntranceFrame = { opacity: 1, scale: 1, dx: 0, dy: 0 };

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
/** Overshooting ease: rises past 1 (peak ≈ 1.18) then settles back to exactly 1. */
function easeOutBack(t: number): number {
  const c1 = 2.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** The entrance duration (seconds) both renderers actually use: the configured value clamped to
 * the export's supported 0.05–2s range (a NaN/zero/negative value can never produce an instant
 * pop or a divide-by-zero), then capped for the three approximated entrances. */
export function resolveEntranceDurationSec(animation: Pick<AnimationConfig, "entrance" | "durationSec">): number {
  const raw = Number.isFinite(animation.durationSec) ? animation.durationSec : 0.2;
  const clamped = Math.max(0.05, Math.min(2, raw));
  return effectiveEntranceDurationSec(animation.entrance, clamped);
}

/** Linear 0→1 progress of the entrance given time since the caption started. Before the
 * caption (negative) = 0; at/after `durationSec` = 1. */
export function entranceProgress(timeIntoCaption: number, durationSec: number): number {
  if (!Number.isFinite(timeIntoCaption)) return 1;
  return clamp01(timeIntoCaption / Math.max(0.001, durationSec));
}

/** Whether this entrance type animates at all. */
export function hasEntrance(entrance: EntranceAnimation): boolean {
  return entrance in FADE_FRACTION;
}

/** The linear opacity-ramp fraction of the entrance duration (0 when there is no entrance). */
export function entranceFadeFraction(entrance: EntranceAnimation): number {
  return FADE_FRACTION[entrance] ?? 0;
}

/** The frame at linear progress `p` (0..1). */
export function entranceFrame(entrance: EntranceAnimation, p: number): EntranceFrame {
  const t = clamp01(p);
  if (!hasEntrance(entrance)) return IDENTITY;
  const opacity = clamp01(t / (FADE_FRACTION[entrance] as number));
  switch (entrance) {
    case "pop":
      return { opacity, scale: 0.6 + 0.4 * easeOutCubic(t), dx: 0, dy: 0 };
    case "bounce":
      return { opacity, scale: 0.4 + 0.6 * easeOutBack(t), dx: 0, dy: 0 };
    // Slides are LINEAR in position: ASS `\move` can only express one linear segment, and a
    // curve here that the export cannot reproduce would be a preview/export mismatch.
    case "slide-up":
      return { opacity, scale: 1, dx: 0, dy: (1 - t) * SLIDE_DISTANCE_FRAC };
    case "slide-down":
      return { opacity, scale: 1, dx: 0, dy: (t - 1) * SLIDE_DISTANCE_FRAC };
    case "slide-left":
      return { opacity, scale: 1, dx: (1 - t) * SLIDE_DISTANCE_FRAC, dy: 0 };
    case "slide-right":
      return { opacity, scale: 1, dx: (t - 1) * SLIDE_DISTANCE_FRAC, dy: 0 };
    default:
      return { opacity, scale: 1, dx: 0, dy: 0 };
  }
}

/** The frame `timeIntoCaption` seconds after the caption started. */
export function entranceFrameAt(animation: Pick<AnimationConfig, "entrance" | "durationSec">, timeIntoCaption: number): EntranceFrame {
  const d = resolveEntranceDurationSec(animation);
  return entranceFrame(animation.entrance, entranceProgress(timeIntoCaption, d));
}

// ───────────────────────── ASS export ─────────────────────────

/** Piecewise-linear segments used to approximate a scale curve with chained ASS `\t` tags. */
export const SCALE_SEGMENTS = 8;

/** ASS alpha bytes (0 = opaque, 255 = transparent) of a style's primary / outline / back colours.
 * Alpha ramps animate FROM/TO these rather than to a flat 0, so a caption with a translucent
 * background box or reduced opacity never jumps to fully opaque mid-animation. */
export interface BaseAlphas {
  a1: number;
  a3: number;
  a4: number;
}
export const OPAQUE_BASE: BaseAlphas = { a1: 0, a3: 0, a4: 0 };

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clampByte(n).toString(16).toUpperCase().padStart(2, "0");
const alphaAt = (base: number, opacity: number) => base + (255 - base) * (1 - clamp01(opacity));
function alphaSet(base: BaseAlphas, opacity: number): string {
  return `\\1a&H${hex2(alphaAt(base.a1, opacity))}&\\3a&H${hex2(alphaAt(base.a3, opacity))}&\\4a&H${hex2(alphaAt(base.a4, opacity))}&`;
}

export interface AssMotionParts {
  /** The caption's position tag: `\pos(x,y)`, or `\move(...)` for slides (never both — libass
   * only honours the first of the two, which is why slides used to render with no motion). */
  position: string;
  /** The same motion applied to another anchor (the active-word background chip). */
  positionAt: (px: number, py: number) => string;
  /** Milliseconds of linear event-level fade-in for `\fad(in,0)`; 0 = none. */
  fadeInMs: number;
  /** Alpha tags for this event's opacity ramp ("" when opacity doesn't change). `{\r}` resets
   * them, so the text must re-emit them after every reset. */
  alpha: (base: BaseAlphas) => string;
  /** Scale keyframes ("" when the animation doesn't scale). `mult` multiplies the scale — a word
   * with its own scale animates relative to it so the two never fight. Also reset by `{\r}`. */
  scale: (mult: number) => string;
  /** Text-level tags to emit at the event start and after every `{\r}` (opaque base alphas). */
  lineTags: (mult: number) => string;
  /** True while this event has animation to play. */
  active: boolean;
}

export function inactiveMotionParts(x: number, y: number, precision = 0): AssMotionParts {
  const rnd = (n: number) => (precision === 0 ? Math.round(n) : Number(n.toFixed(precision)));
  return {
    position: `\\pos(${x},${y})`,
    positionAt: (px, py) => `\\pos(${rnd(px)},${rnd(py)})`,
    fadeInMs: 0,
    alpha: () => "",
    scale: () => "",
    lineTags: () => "",
    active: false,
  };
}

export interface MotionSpec {
  /** The frame at linear progress p (0..1) of the animation window. */
  frame: (p: number) => EntranceFrame;
  /** Progress at the Dialogue event's start / end (clamped 0..1). */
  p0: number;
  p1: number;
  /** Length of the whole animation window, seconds. */
  windowSec: number;
  /** Seconds the animation window starts AFTER this event starts (0 when it started earlier). */
  delaySec: number;
  /** Progress at which the opacity slope changes (0..1), or null for a straight line. */
  opacityKnee: number | null;
  /** Whether the curve scales the caption. */
  scales: boolean;
  /** Use a plain `\fad(in,0)` for the opacity ramp when the event starts at progress 0 (entrance). */
  fadeIn: boolean;
  /** Progress at which the entrance opacity ramp ends, used to size `\fad`. */
  fadeInEnd: number;
  x: number;
  y: number;
  playResY: number;
  /** Decimal places for \pos / \move coordinates (default 0: whole pixels). */
  precision?: number;
  /**
   * The point the caption scales about (the centre of its block). libass scales an event about its own
   * alignment anchor, but the preview scales the whole caption box about its centre — so when this is
   * set, every anchor is also moved by `(scale − 1) × (anchor − origin)`, which makes each independently
   * positioned line / box / chip land exactly where a uniform scale of the whole block would put it.
   * The offset is linear in the scale, so an event must lie within ONE scale segment (the caller splits
   * its intervals at `SCALE_SEGMENTS` boundaries — see scaleBreakpoints in exit-animation.ts).
   */
  origin?: { x: number; y: number };
}

/**
 * Turns one animation window (entrance or exit) into the ASS tags for ONE Dialogue event inside
 * it. The event starts in exactly the state `frame(p0)` and ends in `frame(p1)`; every curve is
 * piecewise linear (slides, opacity) or sampled (scale), so this renders the same curve the
 * preview evaluates. Entrance and exit share this one builder.
 */
export function motionAssParts(spec: MotionSpec): AssMotionParts {
  const { frame, p0, p1, windowSec, delaySec, x, y, playResY } = spec;
  const digits = spec.precision ?? 0;
  const rnd = (n: number) => (digits === 0 ? Math.round(n) : Number(n.toFixed(digits)));
  const delayMs = Math.round(delaySec * 1000);
  const localMs = (p: number) => Math.max(0, Math.round(delayMs + (p - p0) * windowSec * 1000));
  const f0 = frame(p0);
  const f1 = frame(p1);

  const origin = spec.scales ? spec.origin : undefined;
  const moves = f0.dx !== f1.dx || f0.dy !== f1.dy || (origin !== undefined && f0.scale !== f1.scale);
  // where an anchor at (px, py) sits at one end of the event: the slide displacement plus, when the caption
  // scales about `origin`, the anchor's own displacement from that point
  const at = (px: number, py: number, f: EntranceFrame) =>
    [px + f.dx * playResY + (origin ? (f.scale - 1) * (px - origin.x) : 0), py + f.dy * playResY + (origin ? (f.scale - 1) * (py - origin.y) : 0)] as const;
  const positionAt = (px: number, py: number) => {
    const [x0, y0] = at(px, py, f0);
    if (!moves) return `\\pos(${rnd(x0)},${rnd(y0)})`;
    const [x1, y1] = at(px, py, f1);
    return `\\move(${rnd(x0)},${rnd(y0)},${rnd(x1)},${rnd(y1)},${delayMs},${localMs(p1)})`;
  };

  // Opacity breakpoints inside this event (piecewise linear, optional knee).
  const stops = [p0];
  if (spec.opacityKnee !== null && spec.opacityKnee > p0 + 1e-6 && spec.opacityKnee < p1 - 1e-6) stops.push(spec.opacityKnee);
  stops.push(p1);
  const opacityChanges = stops.some((p, i) => i > 0 && Math.abs(frame(p).opacity - frame(stops[i - 1]).opacity) > 1e-6);
  const useFad = spec.fadeIn && p0 <= 1e-6 && delayMs === 0 && f0.opacity < 1;
  const fadeInMs = useFad ? Math.round(spec.fadeInEnd * windowSec * 1000) : 0;

  const alpha = (base: BaseAlphas) => {
    if (useFad) return "";
    if (!opacityChanges) return f0.opacity < 1 ? alphaSet(base, f0.opacity) : "";
    let tags = alphaSet(base, f0.opacity);
    for (let i = 1; i < stops.length; i++) {
      const a = frame(stops[i - 1]).opacity;
      const b = frame(stops[i]).opacity;
      if (Math.abs(a - b) > 1e-6) tags += `\\t(${localMs(stops[i - 1])},${localMs(stops[i])},${alphaSet(base, b)})`;
    }
    return tags;
  };

  const keys: { ms: number; scale: number }[] = [];
  if (spec.scales) {
    for (let k = 1; k <= SCALE_SEGMENTS; k++) {
      const pk = k / SCALE_SEGMENTS;
      if (pk <= p0 + 1e-6 || pk > p1 + 1e-6) continue;
      keys.push({ ms: localMs(pk), scale: frame(pk).scale });
    }
    if (!keys.length || keys[keys.length - 1].ms < localMs(p1)) keys.push({ ms: localMs(p1), scale: f1.scale });
  }
  const scale = (mult: number) => {
    if (!spec.scales || (f0.scale === 1 && keys.every((k) => k.scale === 1))) return "";
    const pct = (s: number) => Math.round(s * mult * 100);
    let tags = `\\fscx${pct(f0.scale)}\\fscy${pct(f0.scale)}`;
    let prev = delayMs;
    for (const key of keys) {
      if (key.ms <= prev) continue;
      tags += `\\t(${prev},${key.ms},\\fscx${pct(key.scale)}\\fscy${pct(key.scale)})`;
      prev = key.ms;
    }
    return tags;
  };

  return {
    position: positionAt(x, y),
    positionAt,
    fadeInMs,
    alpha,
    scale,
    lineTags: (mult) => alpha(OPAQUE_BASE) + scale(mult),
    active: true,
  };
}

/** Binds an animation's alpha tags to a style's real base alphas for text-level emission. */
export function withBaseAlphas(parts: AssMotionParts, base: BaseAlphas): AssMotionParts {
  return { ...parts, lineTags: (mult) => parts.alpha(base) + parts.scale(mult) };
}

/**
 * ASS tags for the entrance, for the Dialogue event that starts `offsetSec` after the caption's
 * start (one event is emitted per word-boundary interval, so an entrance longer than the first
 * interval must CONTINUE across the following events rather than being truncated to the first).
 */
export function entranceAssParts(
  animation: Pick<AnimationConfig, "entrance" | "durationSec">,
  offsetSec: number,
  x: number,
  y: number,
  playResY: number,
  base: BaseAlphas = OPAQUE_BASE,
  precision = 0,
  scaleAbout?: { origin: { x: number; y: number }; eventEndOffsetSec: number },
): AssMotionParts {
  if (!hasEntrance(animation.entrance)) return inactiveMotionParts(x, y, precision);
  const d = resolveEntranceDurationSec(animation);
  const o = Math.max(0, offsetSec);
  if (o >= d - 1e-6) return inactiveMotionParts(x, y, precision);

  return withBaseAlphas(
    motionAssParts({
      frame: (p) => entranceFrame(animation.entrance, p),
      p0: o / d,
      // with a scale origin the event is one scale segment (see MotionSpec.origin): it ends where the event ends
      p1: scaleAbout ? clamp01(scaleAbout.eventEndOffsetSec / d) : 1,
      windowSec: d,
      delaySec: 0,
      opacityKnee: entranceFadeFraction(animation.entrance),
      scales: animation.entrance === "pop" || animation.entrance === "bounce",
      fadeIn: true,
      fadeInEnd: entranceFadeFraction(animation.entrance),
      x,
      y,
      playResY,
      precision,
      origin: scaleAbout?.origin,
    }),
    base,
  );
}
