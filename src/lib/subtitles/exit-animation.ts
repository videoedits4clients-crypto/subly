import type { AnimationConfig, EntranceAnimation, ExitAnimation } from "../../types/subtitle.ts";
import {
  entranceFrame,
  entranceFadeFraction,
  hasEntrance,
  inactiveMotionParts,
  motionAssParts,
  resolveEntranceDurationSec,
  withBaseAlphas,
  OPAQUE_BASE,
  SLIDE_DISTANCE_FRAC,
  type AssMotionParts,
  type BaseAlphas,
  type EntranceFrame,
} from "./entrance-animation.ts";

/**
 * Exit animation — the mirror image of entrance-animation.ts, with the same philosophy: a PURE
 * function of (exit type, time, the caption's own start/end, configured duration), read by both
 * the live preview and the ASS export. Nothing holds state.
 *
 * Time origin is the caption's END: the exit window is the last `durationSec` of the caption
 * (shortened if the caption is so short that the entrance would otherwise overlap it — the
 * entrance always wins, so the two windows never overlap and an ASS event never has to carry
 * both a `\move` for the entrance and another for the exit, which libass cannot express).
 * Progress runs 0 at the start of the window → 1 at caption end, where the caption is gone.
 */

export type ExitDirection = "up" | "down" | "left" | "right";

/** The direction a slide exit moves toward; undefined for non-slide exits. The legacy "slide"
 * value means up (what the export always tried to render). */
export function exitSlideDirection(exit: ExitAnimation): ExitDirection | undefined {
  switch (exit) {
    case "slide":
    case "slide-up":
      return "up";
    case "slide-down":
      return "down";
    case "slide-left":
      return "left";
    case "slide-right":
      return "right";
    default:
      return undefined;
  }
}

export function hasExit(exit: ExitAnimation): boolean {
  return exit === "fade" || exit === "pop" || exitSlideDirection(exit) !== undefined;
}

/** The entrance whose opacity curve this exit mirrors (fade → fade, pop → pop, slides → slide). */
function mirroredEntrance(exit: ExitAnimation): EntranceAnimation {
  if (exit === "fade") return "fade";
  if (exit === "pop") return "pop";
  return "slide-up";
}

/** Exit duration in seconds: the configured value clamped to the supported 0.05–2s range, so a
 * NaN/zero/negative value can never divide by zero or produce an instant cut. */
export function resolveExitDurationSec(animation: Pick<AnimationConfig, "durationSec">): number {
  const raw = Number.isFinite(animation.durationSec) ? animation.durationSec : 0.2;
  return Math.max(0.05, Math.min(2, raw));
}

export interface AnimationWindows {
  /** When the entrance finishes (= caption start when there is none). */
  entranceEnd: number;
  /** When the exit begins (= caption end when there is none). */
  exitStart: number;
}

/** The entrance window is [start, entranceEnd]; the exit window is [exitStart, end]. They never
 * overlap: a caption shorter than entrance + exit gives the entrance priority and shortens the
 * exit to what is left (and drops it if nothing is left). */
export function animationWindows(
  captionStart: number,
  captionEnd: number,
  animation: Pick<AnimationConfig, "entrance" | "exit" | "durationSec">,
): AnimationWindows {
  const entranceEnd = hasEntrance(animation.entrance)
    ? Math.min(captionEnd, captionStart + resolveEntranceDurationSec(animation))
    : captionStart;
  const exitStart = hasExit(animation.exit) ? Math.max(entranceEnd, captionEnd - resolveExitDurationSec(animation)) : captionEnd;
  return { entranceEnd, exitStart };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const IDENTITY: EntranceFrame = { opacity: 1, scale: 1, dx: 0, dy: 0 };

/** The frame at exit progress `p` (0 = exit just began, 1 = caption end). */
export function exitFrame(exit: ExitAnimation, p: number): EntranceFrame {
  if (!hasExit(exit)) return IDENTITY;
  const t = clamp01(p);
  const mirror = entranceFrame(mirroredEntrance(exit), 1 - t);
  const dir = exitSlideDirection(exit);
  // fade: the entrance run backwards. pop: same opacity, but a LINEAR 100% → 60% shrink (the
  // mirrored ease-out curve barely moves until the last ~30%, so the shrink was hard to see —
  // and a linear shrink is what the export always rendered for this exit).
  if (exit === "pop") return { opacity: mirror.opacity, scale: 1 - 0.4 * t, dx: 0, dy: 0 };
  if (!dir) return mirror;
  const d = t * SLIDE_DISTANCE_FRAC; // slides are linear, like the entrance (ASS \move is linear)
  return {
    opacity: mirror.opacity,
    scale: 1,
    dx: dir === "left" ? 0 - d : dir === "right" ? d : 0, // `0 - d`, never `-d`: avoids a -0 at rest
    dy: dir === "up" ? 0 - d : dir === "down" ? d : 0,
  };
}

/** Exit progress (0..1) at `time` for a caption spanning [captionStart, captionEnd]. 0 before the
 * exit window and for captions with no exit. */
export function exitProgressAt(
  time: number,
  captionStart: number,
  captionEnd: number,
  animation: Pick<AnimationConfig, "entrance" | "exit" | "durationSec">,
): number {
  if (!hasExit(animation.exit) || !Number.isFinite(time)) return 0;
  const { exitStart } = animationWindows(captionStart, captionEnd, animation);
  const length = captionEnd - exitStart;
  if (length <= 1e-6) return 0;
  return clamp01((time - exitStart) / length);
}

export function exitFrameAt(
  time: number,
  captionStart: number,
  captionEnd: number,
  animation: Pick<AnimationConfig, "entrance" | "exit" | "durationSec">,
): EntranceFrame {
  return exitFrame(animation.exit, exitProgressAt(time, captionStart, captionEnd, animation));
}

/**
 * ASS tags for the exit, for the Dialogue event spanning [eventStart, eventEnd] of a caption that
 * ends at `captionEnd` (one event is emitted per word-boundary interval; every one inside the exit
 * window carries its slice of the same animation, so the exit runs continuously across them).
 */
export function exitAssParts(
  animation: Pick<AnimationConfig, "entrance" | "exit" | "durationSec">,
  captionStart: number,
  captionEnd: number,
  eventStart: number,
  eventEnd: number,
  x: number,
  y: number,
  playResY: number,
  base: BaseAlphas = OPAQUE_BASE,
  precision = 0,
): AssMotionParts {
  if (!hasExit(animation.exit)) return inactiveMotionParts(x, y, precision);
  const { exitStart } = animationWindows(captionStart, captionEnd, animation);
  const length = captionEnd - exitStart;
  if (length <= 1e-6 || eventEnd <= exitStart + 1e-6 || eventStart >= captionEnd - 1e-6) return inactiveMotionParts(x, y, precision);

  return withBaseAlphas(
    motionAssParts({
      frame: (p) => exitFrame(animation.exit, p),
      p0: clamp01((eventStart - exitStart) / length),
      p1: clamp01((eventEnd - exitStart) / length),
      windowSec: length,
      delaySec: Math.max(0, exitStart - eventStart),
      opacityKnee: 1 - entranceFadeFraction(mirroredEntrance(animation.exit)),
      scales: animation.exit === "pop",
      fadeIn: false,
      fadeInEnd: 0,
      x,
      y,
      playResY,
      precision,
    }),
    base,
  );
}
