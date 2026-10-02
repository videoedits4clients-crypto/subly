/**
 * P20.1.1 — exit-animation parity. Exit is a pure function of (exit type, time, the caption's own
 * start/end, configured duration) read by BOTH the preview and the ASS export, mirroring the
 * entrance. The bug this fixes (reproduced with a real FFmpeg render before the change): exit
 * "slide" emitted `\pos(x,y)` followed by `\move(...)` on the same event — libass honours only the
 * first of the two, so the caption never moved (and, with no fade either, simply vanished at its
 * end) — and the preview showed a plain fade for it.
 *
 * Tests stay on the pure functions and on the ASS text; real-render evidence (extracted frames of
 * an exported MP4) is in the task report. Run with:
 *   node --test src/lib/subtitles/__tests__/exit-animation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  animationWindows,
  exitAssParts,
  exitFrame,
  exitFrameAt,
  exitProgressAt,
  exitSlideDirection,
  hasExit,
  resolveExitDurationSec,
} from "../exit-animation.ts";
import { SLIDE_DISTANCE_FRAC } from "../entrance-animation.ts";
import { buildAssDocument } from "../ass.ts";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE } from "../../../types/subtitle.ts";
import type { AnimationConfig, ExitAnimation, Subtitle, Word } from "../../../types/subtitle.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "..", "..");

const SLIDES: ExitAnimation[] = ["slide-up", "slide-down", "slide-left", "slide-right"];
const ALL_EXITS: ExitAnimation[] = ["fade", "pop", "slide", ...SLIDES];
const cfg = (exit: ExitAnimation, durationSec = 0.5, entrance: AnimationConfig["entrance"] = "none") => ({ entrance, exit, durationSec });

const w = (text: string, start: number, end: number, extra: Partial<Word> = {}): Word => ({ text, start, end, ...extra });
const sub = (words: Word[], text = words.map((x) => x.text).join(" "), start = words[0].start, end = words[words.length - 1].end, extra: Partial<Subtitle> = {}): Subtitle => ({
  id: "s1",
  index: 0,
  start,
  end,
  text,
  words,
  ...extra,
});
function ass(subtitles: Subtitle[], animation: Partial<AnimationConfig> = {}, style = {}): string {
  return buildAssDocument({
    subtitles,
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, ...style },
    globalAnimation: { ...DEFAULT_ANIMATION, entrance: "none", ...animation },
    playResX: 540,
    playResY: 960,
  });
}
const text = (doc: string) => doc.split("\n").filter((l) => l.startsWith("Dialogue: 1,"));
const MOVE = /\\move\((-?\d+),(-?\d+),(-?\d+),(-?\d+),(\d+),(\d+)\)/;
const ms = (t: string) => {
  const [h, m, s] = t.split(":");
  return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000);
};
const span = (line: string) => {
  const m = /^Dialogue: \d,([^,]+),([^,]+),/.exec(line)!;
  return { start: ms(m[1]), end: ms(m[2]) };
};
const WORDS = [w("EXIT", 1, 1.5), w("SLIDE", 1.5, 2), w("OUT", 2, 2.5), w("NOW", 2.5, 3)];
const X = Math.round((DEFAULT_SUBTITLE_STYLE.x / 100) * 540);
const Y = Math.round((DEFAULT_SUBTITLE_STYLE.y / 100) * 960);

// ───────────────────────── pure: directions, frames, windows ─────────────────────────

test("exit directions: the four slides map to their own direction; legacy \"slide\" means up", () => {
  assert.equal(exitSlideDirection("slide-up"), "up");
  assert.equal(exitSlideDirection("slide-down"), "down");
  assert.equal(exitSlideDirection("slide-left"), "left");
  assert.equal(exitSlideDirection("slide-right"), "right");
  assert.equal(exitSlideDirection("slide"), "up");
  assert.equal(exitSlideDirection("fade"), undefined);
  assert.ok(ALL_EXITS.every(hasExit));
  assert.ok(!hasExit("none"));
});

test("exit frames: start at identity, end invisible, never NaN; 'none' is always identity", () => {
  for (const e of ALL_EXITS) {
    assert.deepEqual(exitFrame(e, 0), { opacity: 1, scale: 1, dx: 0, dy: 0 }, `${e} starts at rest`);
    assert.equal(exitFrame(e, 1).opacity, 0, `${e} ends invisible`);
    for (const p of [-1, 0.3, 2, NaN]) for (const v of Object.values(exitFrame(e, p))) assert.ok(Number.isFinite(v) || Number.isNaN(p));
  }
  assert.deepEqual(exitFrame("none", 0.7), { opacity: 1, scale: 1, dx: 0, dy: 0 });
});

test("exit slide direction: up moves up (-y), down moves down (+y), left moves left (-x), right moves right (+x)", () => {
  const f = (e: ExitAnimation) => exitFrame(e, 1);
  assert.ok(f("slide-up").dy < 0 && f("slide-up").dx === 0);
  assert.ok(f("slide-down").dy > 0 && f("slide-down").dx === 0);
  assert.ok(f("slide-left").dx < 0 && f("slide-left").dy === 0);
  assert.ok(f("slide-right").dx > 0 && f("slide-right").dy === 0);
  assert.deepEqual(exitFrame("slide", 0.6), exitFrame("slide-up", 0.6));
  assert.ok(Math.abs(Math.abs(f("slide-up").dy) - SLIDE_DISTANCE_FRAC) < 1e-12, "same travel distance as the entrance slides");
});

test("exit opacity mirrors the entrance: holds at 1 for the first half of a slide, then falls linearly to 0", () => {
  assert.equal(exitFrame("slide-up", 0.5).opacity, 1);
  assert.ok(Math.abs(exitFrame("slide-up", 0.75).opacity - 0.5) < 1e-9);
  assert.ok(Math.abs(exitFrame("fade", 0.25).opacity - 0.75) < 1e-9, "fade is a straight line");
  let prev = 2;
  for (let p = 0; p <= 1; p += 0.05) {
    const o = exitFrame("pop", p).opacity;
    assert.ok(o <= prev + 1e-9, "opacity never rises during an exit");
    prev = o;
  }
});

test("exit pop shrinks linearly from 100% to 60% (visible for the whole window, matching what the export always rendered)", () => {
  assert.equal(exitFrame("pop", 0).scale, 1);
  assert.ok(Math.abs(exitFrame("pop", 0.5).scale - 0.8) < 1e-9);
  assert.ok(Math.abs(exitFrame("pop", 1).scale - 0.6) < 1e-9);
});

test("exit timing: the window is the LAST durationSec of the caption and ends exactly at caption end", () => {
  const win = animationWindows(10, 14, cfg("slide-up", 0.5));
  assert.equal(win.exitStart, 13.5);
  assert.equal(exitProgressAt(13.4, 10, 14, cfg("slide-up")), 0, "before the window");
  assert.equal(exitProgressAt(13.5, 10, 14, cfg("slide-up")), 0, "at the window start");
  assert.ok(Math.abs(exitProgressAt(13.75, 10, 14, cfg("slide-up")) - 0.5) < 1e-9);
  assert.equal(exitProgressAt(14, 10, 14, cfg("slide-up")), 1, "at caption end");
  assert.equal(exitProgressAt(20, 10, 14, cfg("slide-up")), 1, "after");
  assert.equal(exitProgressAt(13.9, 10, 14, cfg("none")), 0, "no exit configured");
});

test("exit timing: very short captions — the entrance keeps priority and the exit gets what is left (windows never overlap)", () => {
  // 0.4s caption, 0.3s entrance + 0.3s exit configured
  const win = animationWindows(5, 5.4, cfg("slide-up", 0.3, "slide-up"));
  assert.ok(Math.abs(win.entranceEnd - 5.3) < 1e-9);
  assert.ok(Math.abs(win.exitStart - 5.3) < 1e-9, "exit starts where the entrance ends, not before");
  assert.ok(win.exitStart >= win.entranceEnd);
  // shorter than the entrance alone: no room left for an exit at all
  const tiny = animationWindows(5, 5.2, cfg("fade", 0.5, "fade"));
  assert.equal(tiny.entranceEnd, 5.2);
  assert.equal(exitProgressAt(5.19, 5, 5.2, cfg("fade", 0.5, "fade")), 0);
});

test("exit state is a pure function of time: forward, backward and random-order evaluation agree (seek/scrub/replay)", () => {
  const times = [13.2, 13.5, 13.6, 13.75, 13.9, 14, 14.5];
  for (const e of ALL_EXITS) {
    const fwd = times.map((t) => exitFrameAt(t, 10, 14, cfg(e)));
    const back = [...times].reverse().map((t) => exitFrameAt(t, 10, 14, cfg(e))).reverse();
    assert.deepEqual(back, fwd, `${e} backward`);
    assert.deepEqual([4, 1, 6, 0, 3, 5, 2].map((i) => exitFrameAt(times[i], 10, 14, cfg(e))), [4, 1, 6, 0, 3, 5, 2].map((i) => fwd[i]));
  }
});

test("exit duration is clamped: zero / negative / NaN never divide by zero", () => {
  for (const d of [0, -3, NaN, Infinity]) {
    const r = resolveExitDurationSec({ durationSec: d });
    assert.ok(Number.isFinite(r) && r >= 0.05 && r <= 2);
    assert.ok(Number.isFinite(exitFrameAt(13.99, 10, 14, cfg("slide-left", d)).dx));
  }
});

// ───────────────────────── ASS export ─────────────────────────

test("ASS: every slide exit emits a real \\move and NEVER a \\pos on the same event (the root-cause conflict)", () => {
  for (const exit of ["slide", ...SLIDES] as ExitAnimation[]) {
    const events = text(ass([sub(WORDS)], { exit, durationSec: 0.5 }));
    const moving = events.filter((e) => MOVE.test(e));
    assert.ok(moving.length >= 1, `${exit}: no \\move emitted`);
    for (const e of events) assert.ok(!(MOVE.test(e) && /\\pos\(/.test(e)), `${exit}: \\pos + \\move on one event: ${e}`);
  }
});

test("ASS: slide exit direction and distance — rest position → displaced, matching the shared frame", () => {
  const expected = Math.round(SLIDE_DISTANCE_FRAC * 960);
  for (const exit of ["slide", ...SLIDES] as ExitAnimation[]) {
    const last = text(ass([sub(WORDS)], { exit, durationSec: 0.5 })).at(-1)!;
    const [x0, y0, x1, y1] = MOVE.exec(last)!.slice(1, 5).map(Number);
    assert.deepEqual([x0, y0], [X, Y], `${exit} starts at the caption anchor`);
    const dir = exitSlideDirection(exit)!;
    assert.deepEqual(
      [x1 - X, y1 - Y],
      dir === "up" ? [0, -expected] : dir === "down" ? [0, expected] : dir === "left" ? [-expected, 0] : [expected, 0],
      `${exit} ends displaced in its own direction`,
    );
  }
});

test("ASS: slide exit timing — lasts the configured duration and the last event's motion ends exactly at caption end", () => {
  const events = text(ass([sub(WORDS)], { exit: "slide-up", durationSec: 0.5 }));
  const last = events.at(-1)!;
  const { start, end } = span(last);
  const [, , , , t0, t1] = MOVE.exec(last)!.slice(1).map(Number);
  assert.equal(end, 3000, "caption end is untouched");
  assert.equal(t0, 0);
  assert.equal(t1, end - start, "motion finishes with the event, i.e. at the caption's end");
  assert.equal(end - start, 500, "the window is exactly the configured 0.5s");
  assert.equal(events.filter((e) => MOVE.test(e)).length, 1, "only the events inside the window move");
});

test("ASS: the exit runs CONTINUOUSLY across word intervals inside the window (each event continues where the last stopped)", () => {
  // words change every 0.1s so the 0.5s window spans several events
  const fast = sub([w("A", 1, 1.4), w("B", 1.4, 1.6), w("C", 1.6, 1.8), w("D", 1.8, 2.0), w("E", 2.0, 2.2), w("F", 2.2, 2.4)]);
  const events = text(ass([fast], { exit: "slide-left", durationSec: 0.5 })).filter((e) => MOVE.test(e));
  assert.ok(events.length >= 3);
  for (let i = 1; i < events.length; i++) {
    const prev = MOVE.exec(events[i - 1])!.slice(1).map(Number);
    const cur = MOVE.exec(events[i])!.slice(1).map(Number);
    assert.equal(cur[0], prev[2], "next event starts at the previous event's end X");
    assert.equal(span(events[i]).start, span(events[i - 1]).end, "events are back to back");
  }
  const lastMove = MOVE.exec(events.at(-1)!)!.slice(1).map(Number);
  assert.equal(lastMove[2], X - Math.round(SLIDE_DISTANCE_FRAC * 960), "ends at the full displacement");
});

test("ASS: exit fade ramps every channel down to fully transparent over the window (no bare \\fad conflicts)", () => {
  const last = text(ass([sub(WORDS)], { exit: "fade", durationSec: 0.5 })).at(-1)!;
  assert.match(last, /\\t\(0,500,\\1a&HFF&\\3a&HFF&\\4a&HFF&\)/);
  assert.ok(!/\\fad\(/.test(last), "exit no longer relies on a \\fad that collides with the entrance's");
});

test("ASS: exit pop shrinks the WHOLE line (scale restated after every {\\r}) and ends at 60%", () => {
  const last = text(ass([sub(WORDS)], { exit: "pop", durationSec: 0.5 })).at(-1)!;
  const afterReset = /\{\\r([^}]*)\}/.exec(last);
  assert.ok(afterReset, last);
  assert.match(afterReset[1], /\\fscx\d+\\fscy\d+\\t\(0,/);
  assert.match(last, /\\t\(438,500,\\fscx60\\fscy60\)/);
});

test("ASS: alpha ramps respect the style's own alphas — a translucent background box never jumps to opaque", () => {
  const last = text(ass([sub(WORDS)], { exit: "slide-down", durationSec: 0.5 }, { backgroundOpacity: 0.5, backgroundColor: "#000000" })).at(-1)!;
  // box (back colour) alpha starts at 0x80 (50%) rather than 0x00
  assert.match(last, /\\4a&H80&/);
  assert.ok(!/\\4a&H00&/.test(last));
});

// ───────────────────────── edge cases ─────────────────────────

test("edge: a very short caption still gets a valid exit; nothing negative, no overlap with the entrance", () => {
  const short = sub([w("hi", 4, 4.25)]);
  const events = text(ass([short], { entrance: "slide-up", exit: "slide-down", durationSec: 0.5 }));
  for (const e of events) {
    assert.ok(!(MOVE.test(e) && /\\pos\(/.test(e)));
    const m = MOVE.exec(e);
    if (m) assert.ok(Number(m[5]) >= 0 && Number(m[6]) >= Number(m[5]));
  }
  // entrance wins: the one event is the entrance slide (offset 0), no exit event is carved out
  assert.ok(events.every((e) => !/\\move\(\d+,\d+,\d+,\d+,0,\d+\)/.test(e) || span(e).end <= 4250));
  assert.equal(Math.max(...events.map((e) => span(e).end)), 4250, "caption end unchanged");
});

test("edge: an entrance slide and an exit slide on the same caption never share an event", () => {
  const events = text(ass([sub(WORDS)], { entrance: "slide-up", exit: "slide-down", durationSec: 0.5 }));
  const moves = events.filter((e) => MOVE.test(e));
  assert.equal(moves.length, 2);
  assert.ok(span(moves[0]).end <= span(moves[1]).start, "entrance and exit \\move events are disjoint in time");
  const [, y0, , y1] = MOVE.exec(moves[0])!.slice(1).map(Number);
  assert.ok(y0 > y1, "entrance rises into place");
  const [, ey0, , ey1] = MOVE.exec(moves[1])!.slice(1).map(Number);
  assert.ok(ey1 > ey0, "exit drops away");
});

test("edge: multiline captions — one anchor, one displacement, tags restated after every reset across both lines", () => {
  const multi = sub([w("ONE", 1, 1.5), w("TWO", 1.5, 2), w("THREE", 2, 2.5), w("FOUR", 2.5, 3)], "ONE TWO\nTHREE FOUR");
  const last = text(ass([multi], { exit: "pop", durationSec: 0.5 })).at(-1)!;
  assert.ok(last.includes("\\N"), "line break preserved");
  const [x0, y0] = [X, Y];
  const slide = text(ass([multi], { exit: "slide-up", durationSec: 0.5 })).at(-1)!;
  const m = MOVE.exec(slide)!.slice(1).map(Number);
  assert.deepEqual([m[0], m[1]], [x0, y0], "geometry is anchored once for the whole box, not per line");
  assert.equal(m[3] - m[1], -Math.round(SLIDE_DISTANCE_FRAC * 960));
  const resets = last.match(/\{\\r[^}]*\}/g) ?? [];
  assert.ok(resets.length >= 1);
  for (const r of resets) assert.match(r, /\\fscx\d+/, "every {\\r} restores the exit scale");
});

test("edge: word-level styling, active-word styling and a manual font-size override don't break the exit", () => {
  const styled = sub(
    [w("PLAIN", 1, 1.5), w("BIG", 1.5, 2, { style: { fontSize: 120 } }), w("RED", 2, 2.5, { style: { color: "#FF0000" } }), w("END", 2.5, 3)],
    undefined,
    undefined,
    undefined,
  );
  for (const exit of ["pop", "slide-up", "fade"] as ExitAnimation[]) {
    const events = text(ass([styled], { exit, word: "scale", durationSec: 0.5 }));
    for (const e of events) assert.ok(!(MOVE.test(e) && /\\pos\(/.test(e)));
    const last = events.at(-1)!;
    assert.match(last, /\\1a&H00&/, `${exit}: alpha restated on the last event`);
  }
  // pop on a manually enlarged word: exit scale is RELATIVE to its own 120/64 scale, not a fight over \fscx
  const bigEvent = text(ass([sub([w("BIG", 1, 3, { style: { fontSize: 128 } })])], { exit: "pop", word: "none", durationSec: 0.5 })).at(-1)!;
  // (one 2s event spans the whole caption; the 0.5s exit window starts 1.5s into it, so its \t begins there)
  const starts = [...bigEvent.matchAll(/\\fscx(\d+)\\fscy\d+\\t\(1500,/g)].map((m) => Number(m[1]));
  assert.ok(starts.includes(200), "the word block starts at 128 / 64 = 200% and shrinks from there");
  assert.match(bigEvent, /\\t\(1938,2000,\\fscx120\\fscy120\)/, "ends at 60% of the 200% word scale, exactly at caption end");
});

test("edge: active-word styling keeps working through the exit (highlight colour survives; ramp skipped while exiting)", () => {
  const events = text(ass([sub(WORDS)], { exit: "slide-up", word: "scale", durationSec: 0.5 }));
  const last = events.at(-1)!; // NOW is active here
  assert.match(last, /\\c&H[0-9A-F]{8}&/);
  assert.ok(!/\\fscx100\\fscy100\\t\(0,\d+,\\fscx112/.test(last), "word-scale ease-in is skipped while the exit runs");
  const earlier = events[0]; // outside the window — unchanged word behaviour
  assert.ok(!MOVE.test(earlier));
});

test("edge: consecutive and back-to-back captions — each exits on its own clock and never bleeds into the next", () => {
  const a = sub([w("FIRST", 1, 1.5), w("ONE", 1.5, 2)]);
  const b = { ...sub([w("SECOND", 2, 2.5), w("ONE", 2.5, 3)]), id: "s2", index: 1 }; // starts the instant a ends
  const events = text(ass([a, b], { exit: "slide-right", durationSec: 0.5 }));
  const aMoves = events.filter((e) => e.includes("FIRST") || (e.includes("ONE") && span(e).end <= 2000)).filter((e) => MOVE.test(e));
  const bMoves = events.filter((e) => span(e).start >= 2000).filter((e) => MOVE.test(e));
  assert.equal(aMoves.length, 1);
  assert.equal(span(aMoves[0]).end, 2000, "a's exit ends at its own end, exactly when b begins");
  assert.equal(bMoves.length, 1);
  assert.equal(span(bMoves[0]).end, 3000);
  const firstOfB = events.find((e) => span(e).start === 2000)!;
  assert.ok(!MOVE.test(firstOfB), "b starts at rest, not mid-exit");
});

test("edge: a custom caption position is the anchor for the exit (and a per-caption exit overrides the project's)", () => {
  const custom = sub(WORDS, undefined, undefined, undefined, { style: { x: 20, y: 40 }, animation: { exit: "slide-left" } });
  const last = text(ass([custom], { exit: "fade", durationSec: 0.5 })).at(-1)!;
  const [x0, y0, x1, y1] = MOVE.exec(last)!.slice(1, 5).map(Number);
  assert.deepEqual([x0, y0], [Math.round(0.2 * 540), Math.round(0.4 * 960)]);
  assert.equal(y1, y0);
  assert.ok(x1 < x0, "per-caption slide-left wins over the project's fade");
});

test("edge: an exit never corrupts style state — the event after a reset is back to the style's own tags", () => {
  const events = text(ass([sub(WORDS)], { exit: "pop", word: "highlight", durationSec: 0.5 }));
  const early = events[0];
  assert.ok(!/\\fscx/.test(early) && !/\\1a/.test(early), "events before the window carry no exit tags at all");
  // each event is self-contained: the exit tags are re-applied per event, never inherited
  for (const e of events.slice(1)) assert.ok(e.startsWith("Dialogue: 1,"));
});

test("edge: no exit configured leaves the document exactly as before (no breakpoints, no extra tags)", () => {
  const plain = text(ass([sub(WORDS)], { exit: "none", entrance: "none" }));
  assert.equal(plain.length, 4, "one event per word interval, nothing carved out");
  for (const e of plain) assert.ok(!/\\move|\\fad|\\1a|\\t\(/.test(e));
});

test("bg-highlight chip follows the exit (it used to stay behind while the text slid/faded away)", () => {
  const doc = ass([sub(WORDS)], { exit: "slide-up", word: "bg-highlight", durationSec: 0.5 });
  const chip = doc.split("\n").filter((l) => l.startsWith("Dialogue: 0,")).at(-1)!;
  assert.match(chip, /\\move\(/);
  assert.ok(!/\\pos\(/.test(chip));
  const txt = text(doc).at(-1)!;
  const tm = MOVE.exec(txt)!.slice(1).map(Number);
  const cm = MOVE.exec(chip)!.slice(1).map(Number);
  assert.equal(cm[3] - cm[1], tm[3] - tm[1], "same vertical travel as the text");
  assert.equal(cm[5], tm[5], "same duration");
  assert.match(chip, /\\1a&H00&\\3a&HFF&\\4a&HFF&\\t\(/, "chip fades with the text");
});

// ───────────────────────── preview / export consistency ─────────────────────────

test("parity: the ASS move endpoints equal the shared exit frame scaled to the export canvas", () => {
  for (const exit of SLIDES) {
    const parts = exitAssParts(cfg(exit, 0.5), 0, 4, 3.5, 4, 270, 787, 960);
    const [x0, y0, x1, y1] = MOVE.exec(parts.position)!.slice(1, 5).map(Number);
    const a = exitFrame(exit, 0);
    const b = exitFrame(exit, 1);
    assert.equal(x0, Math.round(270 + a.dx * 960));
    assert.equal(y0, Math.round(787 + a.dy * 960));
    assert.equal(x1, Math.round(270 + b.dx * 960));
    assert.equal(y1, Math.round(787 + b.dy * 960));
  }
});

test("parity: sampled exit-pop keyframes equal the curve the preview evaluates", () => {
  const tags = exitAssParts(cfg("pop", 0.5), 0, 4, 3.5, 4, 270, 787, 960).scale(1);
  for (const m of tags.matchAll(/\\t\((\d+),(\d+),\\fscx(\d+)\\fscy\d+\)/g)) {
    const p = Number(m[2]) / 500;
    assert.ok(Math.abs(Number(m[3]) - Math.round(exitFrame("pop", p).scale * 100)) <= 1, `p=${p}`);
  }
});

test("parity: a mid-window event starts exactly where the shared frame says it should", () => {
  // event covering the second half of a 0.5s window
  const parts = exitAssParts(cfg("slide-up", 0.5), 0, 4, 3.75, 4, 270, 787, 960);
  const [, y0, , y1, t0, t1] = MOVE.exec(parts.position)!.slice(1).map(Number);
  assert.equal(y0, Math.round(787 + exitFrame("slide-up", 0.5).dy * 960));
  assert.equal(y1, Math.round(787 + exitFrame("slide-up", 1).dy * 960));
  assert.deepEqual([t0, t1], [0, 250]);
});

// ───────────────────────── performance / safety (source-level) ─────────────────────────

test("preview: exit goes through the shared pure function; no timers, no per-frame store writes added", () => {
  const overlay = readFileSync(path.join(SRC, "components", "editor", "subtitle-overlay.tsx"), "utf-8");
  assert.match(overlay, /exit-animation/);
  assert.match(overlay, /exitFrameAt\(/);
  assert.ok(!/setTimeout|setInterval|requestAnimationFrame|useEditorStore|useState|useEffect/.test(overlay), "overlay stays a pure render of its inputs");
  const hook = readFileSync(path.join(SRC, "components", "editor", "use-live-playback-time.ts"), "utf-8");
  assert.equal((hook.match(/requestAnimationFrame\(/g) ?? []).length, 2, "still the single P20.1 rAF loop");
  assert.ok(!/useEditorStore|setCurrentTime/.test(hook));
});

test("animation panel offers all four slide directions and keeps the legacy \"slide\" highlighted as Slide Up", () => {
  const panel = readFileSync(path.join(SRC, "components", "editor", "animation-panel.tsx"), "utf-8");
  for (const v of SLIDES) assert.ok(panel.includes(`value: "${v}", label:`), v);
  assert.match(panel, /animation\.exit === "slide"/);
});
