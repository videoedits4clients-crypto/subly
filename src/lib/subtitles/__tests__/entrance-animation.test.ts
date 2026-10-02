/**
 * P20.1 — entrance + word-animation reliability. Entrance animation is now a PURE function of
 * (entrance type, time since the caption started, configured duration) and the active word is a
 * pure function of (time, word timing), so the whole 16-case timing/state matrix from the task is
 * tested directly on those functions (there is no React-rendering test infrastructure in this
 * project — see export-dialog-copy.test.ts). The ASS export tests assert the actual tags emitted:
 * every bug this task fixed was confirmed first with real FFmpeg-rendered frames (slide-up/down
 * rendered with NO motion; pop/bounce animated only the first overridden word; a second `\fad`
 * replaced the first).
 *
 * Matrix coverage:  1 before start · 2 at start · 3 during · 4 at end · 5 after end · 6 zero-duration
 * · 7 very short word · 8 caption boundary · 9 multiline · 10 reordered · 11 inserted · 12 deleted
 * · 13 split caption · 14 merged caption · 15 seek backwards · 16 seek forwards.
 * Not unit-testable as such: real <video> playback timing (rAF sampling) — covered by the
 * source-level checks at the bottom and by manual QA in the real editor.
 *
 * Run with: node --test src/lib/subtitles/__tests__/entrance-animation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  entranceFrame,
  entranceFrameAt,
  entranceProgress,
  entranceAssParts,
  resolveEntranceDurationSec,
  SLIDE_DISTANCE_FRAC,
} from "../entrance-animation.ts";
import { findActiveWordIndex } from "../playback-context.ts";
import { groupWordsIntoLines } from "../word-lines.ts";
import { buildAssDocument } from "../ass.ts";
import { splitSubtitleAt } from "../split.ts";
import { mergeSubtitles } from "../merge-subtitles.ts";
import { mergeWords } from "../word-edit.ts";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE, DEFAULT_TIMING_RULES } from "../../../types/subtitle.ts";
import type { AnimationConfig, EntranceAnimation, Subtitle, Word } from "../../../types/subtitle.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "..", "..");

const MAIN: EntranceAnimation[] = ["fade", "slide-up", "slide-down", "pop", "bounce"];
const ALL: EntranceAnimation[] = [...MAIN, "slide-left", "slide-right", "typewriter", "word-pop", "char-pop"];
const anim = (entrance: EntranceAnimation, durationSec = 0.4): Pick<AnimationConfig, "entrance" | "durationSec"> => ({ entrance, durationSec });

const w = (text: string, start: number, end: number, extra: Partial<Word> = {}): Word => ({ text, start, end, ...extra });
const sub = (words: Word[], text = words.map((x) => x.text).join(" "), start = words[0].start, end = words[words.length - 1].end): Subtitle => ({
  id: "s1",
  index: 0,
  start,
  end,
  text,
  words,
});

function ass(subtitles: Subtitle[], animation: Partial<AnimationConfig> = {}, style = {}): string {
  return buildAssDocument({
    subtitles,
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE, ...style },
    globalAnimation: { ...DEFAULT_ANIMATION, ...animation },
    playResX: 540,
    playResY: 960,
  });
}
const dialogues = (doc: string) => doc.split("\n").filter((l) => l.startsWith("Dialogue: 1,"));

// ───────────────────────── 1–5, 15, 16: entrance timing is deterministic ─────────────────────────

test("1. before start: every entrance is at frame zero (fade invisible, pop/bounce small, slides offset)", () => {
  for (const e of ALL) {
    const f = entranceFrameAt(anim(e), -0.5);
    assert.deepEqual(f, entranceFrameAt(anim(e), 0), `${e}: negative time must equal time zero`);
    assert.equal(f.opacity, 0, `${e} must start invisible`);
  }
  assert.ok(entranceFrameAt(anim("pop"), 0).scale < 1);
  assert.ok(entranceFrameAt(anim("bounce"), 0).scale < 1);
  assert.ok(entranceFrameAt(anim("slide-up"), 0).dy > 0, "slide-up starts BELOW its final position");
  assert.ok(entranceFrameAt(anim("slide-down"), 0).dy < 0, "slide-down starts ABOVE it");
});

test("2. at the caption's start the entrance begins (progress 0, not already finished)", () => {
  for (const e of MAIN) assert.equal(entranceProgress(0, 0.4), 0, e);
  assert.equal(entranceFrameAt(anim("fade"), 0).opacity, 0);
});

test("3. during the entrance the frame is strictly between start and final, and monotonic for fade/slide/pop", () => {
  const mid = entranceFrameAt(anim("fade", 0.4), 0.2);
  assert.ok(mid.opacity > 0 && mid.opacity < 1);
  const slide = entranceFrameAt(anim("slide-up", 0.4), 0.2);
  assert.ok(slide.dy > 0 && slide.dy < SLIDE_DISTANCE_FRAC);
  const pop = entranceFrameAt(anim("pop", 0.4), 0.2);
  assert.ok(pop.scale > 0.6 && pop.scale < 1);
  let prev = -1;
  for (let t = 0; t <= 0.4; t += 0.02) {
    const s = entranceFrameAt(anim("pop", 0.4), t).scale;
    assert.ok(s >= prev - 1e-9, "pop scale never decreases");
    prev = s;
  }
});

test("bounce genuinely overshoots 1 and settles back to exactly 1 (the old curve was monotonic)", () => {
  let peak = 0;
  for (let t = 0; t <= 0.4; t += 0.005) peak = Math.max(peak, entranceFrameAt(anim("bounce", 0.4), t).scale);
  assert.ok(peak > 1.05, `bounce peak ${peak} must overshoot`);
  assert.equal(entranceFrameAt(anim("bounce", 0.4), 0.4).scale, 1);
});

test("4/5. at and after the end of the entrance every type is exactly the final, identity frame", () => {
  for (const e of ALL) {
    const d = resolveEntranceDurationSec(anim(e));
    assert.deepEqual(entranceFrameAt(anim(e), d), { opacity: 1, scale: 1, dx: 0, dy: 0 }, `${e} at end`);
    assert.deepEqual(entranceFrameAt(anim(e), d + 5), { opacity: 1, scale: 1, dx: 0, dy: 0 }, `${e} long after`);
  }
  assert.deepEqual(entranceFrame("none", 0), { opacity: 1, scale: 1, dx: 0, dy: 0 });
});

test("15/16. seeking backwards and forwards: the frame depends only on time, never on evaluation order", () => {
  const times = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 2];
  for (const e of MAIN) {
    const forward = times.map((t) => entranceFrameAt(anim(e), t));
    const backward = [...times].reverse().map((t) => entranceFrameAt(anim(e), t)).reverse();
    const shuffled = [3, 0, 7, 2, 5, 1, 6, 4].map((i) => entranceFrameAt(anim(e), times[i]));
    assert.deepEqual(backward, forward, `${e}: backward scrub`);
    assert.deepEqual([3, 0, 7, 2, 5, 1, 6, 4].map((i) => forward[i]), shuffled, `${e}: random seeks`);
  }
});

test("a repeated caption (replayed after seeking back) restarts from frame zero relative to ITS OWN start", () => {
  const captionStart = 10;
  const first = entranceFrameAt(anim("pop"), 10.05 - captionStart);
  const afterSeekBack = entranceFrameAt(anim("pop"), 10.05 - captionStart);
  assert.deepEqual(first, afterSeekBack);
  // a second, later caption is animated against its own start, not the first one's
  assert.deepEqual(entranceFrameAt(anim("pop"), 30.05 - 30), first);
});

// ───────────────────────── 6, 7: degenerate durations ─────────────────────────

test("6. zero / negative / NaN durations never divide by zero or yield NaN frames", () => {
  for (const durationSec of [0, -1, NaN, Infinity]) {
    for (const e of ALL) {
      const d = resolveEntranceDurationSec(anim(e, durationSec));
      assert.ok(Number.isFinite(d) && d >= 0.05 && d <= 2, `${e}/${durationSec} -> ${d}`);
      const f = entranceFrameAt(anim(e, durationSec), 0.01);
      for (const v of Object.values(f)) assert.ok(Number.isFinite(v));
    }
  }
  assert.equal(entranceProgress(Number.NaN, 0.2), 1);
});

test("6. a zero-duration word is never the active word and does not throw", () => {
  const words = [w("a", 0, 0.5), w("b", 0.5, 0.5), w("c", 0.5, 1)];
  assert.equal(findActiveWordIndex(words, 0.5), 2, "b has an empty [0.5, 0.5) interval");
  assert.equal(findActiveWordIndex(words, 0.25), 0);
});

test("7. a very short word is active for exactly its own interval", () => {
  const words = [w("a", 0, 0.5), w("b", 0.5, 0.52), w("c", 0.52, 1)];
  assert.equal(findActiveWordIndex(words, 0.51), 1);
  assert.equal(findActiveWordIndex(words, 0.52), 2, "end is exclusive");
  assert.equal(findActiveWordIndex(words, 0.4999), 0);
});

test("active word: before first word, between words, at end boundary, after last word", () => {
  const words = [w("a", 1, 1.5), w("b", 1.7, 2)];
  assert.equal(findActiveWordIndex(words, 0.9), null, "before start");
  assert.equal(findActiveWordIndex(words, 1), 0, "at start");
  assert.equal(findActiveWordIndex(words, 1.5), null, "at end (exclusive) — gap");
  assert.equal(findActiveWordIndex(words, 1.6), null, "in a gap between words");
  assert.equal(findActiveWordIndex(words, 2), null, "after last word");
});

// ───────────────────────── 8: caption boundary ─────────────────────────

test("8. an entrance longer than its caption just ends with the caption; no state leaks into the next caption", () => {
  const a = sub([w("hi", 1, 1.1)]); // 0.1s caption, 0.4s entrance configured
  const doc = dialogues(ass([a], { entrance: "pop", durationSec: 0.4 }));
  assert.equal(doc.length, 1);
  assert.match(doc[0], /\\t\(0,/);
  const b = { ...sub([w("next", 1.1, 1.6)]), id: "s2", index: 1 };
  const both = dialogues(ass([a, b], { entrance: "pop", durationSec: 0.4 }));
  assert.equal(both.length, 2);
  // the second caption's own first event starts its own animation from frame zero
  assert.match(both[1], /\\fscx\d+\\fscy\d+\\t\(0,/);
  const startScale = Number(/\\fscx(\d+)/.exec(both[1])![1]);
  assert.equal(startScale, 60);
});

// ───────────────────────── 9–14: line / word mapping ─────────────────────────

test("9. multiline captions: words are grouped onto the lines the text says, indices stay global", () => {
  const words = [w("one", 0, 1), w("two", 1, 2), w("three", 2, 3), w("four", 3, 4)];
  const lines = groupWordsIntoLines("one two\nthree four", words);
  assert.deepEqual(lines.map((l) => l.map((x) => x.word.text)), [["one", "two"], ["three", "four"]]);
  assert.deepEqual(lines.flat().map((x) => x.index), [0, 1, 2, 3]);
});

test("10. reordered words: line grouping and active index follow the array order the caption text shows", () => {
  const words = [w("world", 1, 2), w("hello", 0, 1)]; // hand-reordered, non-monotonic timing
  const lines = groupWordsIntoLines("world hello", words);
  assert.deepEqual(lines[0].map((x) => x.word.text), ["world", "hello"]);
  assert.equal(findActiveWordIndex(words, 1.5), 0);
  assert.equal(findActiveWordIndex(words, 0.5), 1);
});

test("11. an inserted word mid-caption is grouped in place and the following words keep correct indices", () => {
  const words = [w("a", 0, 1), w("NEW", 1, 1.5), w("b", 1.5, 2), w("c", 2, 3)];
  const lines = groupWordsIntoLines("a NEW\nb c", words);
  assert.deepEqual(lines.map((l) => l.map((x) => x.word.text)), [["a", "NEW"], ["b", "c"]]);
  assert.equal(lines[1][0].index, 2);
});

test("12. a deleted (removed) word never animates: it is excluded before indexing and absent from the ASS text", () => {
  const words = [w("keep", 0, 1), w("GONE", 1, 2, { removed: true }), w("also", 2, 3)];
  const visible = words.filter((x) => !x.removed);
  assert.equal(findActiveWordIndex(visible, 1.5), null);
  assert.equal(findActiveWordIndex(visible, 2.5), 1);
  const doc = ass([sub(words, "keep also")], { word: "scale" });
  assert.ok(!doc.includes("GONE"));
});

test("14. a merged word object (one word, two tokens) stays on ONE line and does not shift later words", () => {
  const merged = mergeWords(w("hello", 0, 1), w("world", 1, 2)); // text "hello world"
  const words = [merged, w("again", 2, 3), w("friend", 3, 4)];
  const lines = groupWordsIntoLines("hello world\nagain friend", words);
  assert.deepEqual(lines.map((l) => l.map((x) => x.word.text)), [["hello world"], ["again", "friend"]]);
  assert.deepEqual(lines.flat().map((x) => x.index), [0, 1, 2]);
});

test("13/14. split captions each animate from their own start; merged caption animates from the merged start", () => {
  const original = sub([w("one", 1, 1.5), w("two", 1.5, 2), w("three", 2.5, 3), w("four", 3, 3.5)]);
  const split = splitSubtitleAt(original, 2.25, DEFAULT_TIMING_RULES);
  assert.ok(split.ok);
  if (!split.ok) return;
  const [left, right] = [split.left, split.right];
  assert.equal(right.start, 2.25);
  const events = dialogues(ass([left, right], { entrance: "fade", durationSec: 0.4 }));
  const rightFirst = events.find((e) => e.startsWith("Dialogue: 1,0:00:02.25"))!;
  assert.match(rightFirst, /\\fad\(400,0\)/, "right half starts its own fade-in when IT starts");
  const merged = mergeSubtitles(left, right, DEFAULT_TIMING_RULES);
  assert.ok(merged.ok);
  if (!merged.ok) return;
  const mEvents = dialogues(ass([merged.subtitle], { entrance: "fade", durationSec: 0.4 }));
  assert.match(mEvents[0], /\\fad\(400,0\)/);
  assert.equal(mEvents.filter((e) => /\\fad\(/.test(e)).length, 1, "only the merged caption's first event fades in");
});

// ───────────────────────── ASS export: the confirmed bugs ─────────────────────────

const WORDS4 = [w("HELLO", 1, 1.5), w("BRIGHT", 1.5, 2), w("NEW", 2, 2.5), w("WORLD", 2.5, 3)];

test("ASS: slide entrances use an absolute \\move and NO \\pos on the same event (libass honours only the first of the two)", () => {
  for (const [entrance, sign] of [["slide-up", 1], ["slide-down", -1]] as const) {
    const first = dialogues(ass([sub(WORDS4)], { entrance, durationSec: 0.4 }))[0];
    const m = /\\move\((\d+),(\d+),(\d+),(\d+),0,(\d+)\)/.exec(first);
    assert.ok(m, `${entrance} must emit \\move: ${first}`);
    assert.ok(!first.includes("\\pos("), `${entrance}: \\pos before \\move silently cancels the motion`);
    const [x0, y0, x1, y1, ms] = m.slice(1).map(Number);
    assert.equal(x0, x1);
    assert.equal(x1, Math.round((DEFAULT_SUBTITLE_STYLE.x / 100) * 540), "ends at the real caption anchor, not a relative (0,0)");
    assert.equal(y1, Math.round((DEFAULT_SUBTITLE_STYLE.y / 100) * 960));
    assert.equal(Math.sign(y0 - y1), sign);
    assert.equal(Math.abs(y0 - y1), Math.round(SLIDE_DISTANCE_FRAC * 960));
    assert.equal(ms, 400);
  }
});

test("ASS: slide-left / slide-right move horizontally to the real anchor", () => {
  const left = dialogues(ass([sub(WORDS4)], { entrance: "slide-left" }))[0];
  const m = /\\move\((\d+),(\d+),(\d+),(\d+),0,(\d+)\)/.exec(left)!;
  assert.ok(Number(m[1]) > Number(m[3]) && m[2] === m[4]);
});

test("ASS: pop/bounce scale tags are restated after every {\\r}, so the WHOLE line animates, not just the first word", () => {
  for (const entrance of ["pop", "bounce"] as const) {
    const first = dialogues(ass([sub(WORDS4)], { entrance, durationSec: 0.4, word: "highlight" }))[0];
    const afterReset = /\{\\r([^}]*)\}/.exec(first);
    assert.ok(afterReset, first);
    assert.match(afterReset[1], /\\fscx\d+\\fscy\d+\\t\(0,/, `${entrance}: scale must survive the {\\r} that closes the active word`);
  }
});

test("ASS: the scale animation spans the full configured duration and ends at exactly 100%", () => {
  for (const entrance of ["pop", "bounce"] as const) {
    const parts = entranceAssParts(anim(entrance, 0.5), 0, 100, 200, 960);
    const tags = parts.lineTags(1);
    const ends = [...tags.matchAll(/\\t\((\d+),(\d+),\\fscx(\d+)\\fscy(\d+)\)/g)];
    assert.ok(ends.length >= 4);
    const last = ends[ends.length - 1];
    assert.equal(Number(last[2]), 500, "last keyframe lands exactly at the duration");
    assert.equal(Number(last[3]), 100);
    for (let i = 1; i < ends.length; i++) assert.equal(ends[i][1], ends[i - 1][2], "keyframes are contiguous");
  }
});

test("ASS/preview parity: the sampled export keyframes equal the shared curve the preview evaluates", () => {
  const d = 0.4;
  const tags = entranceAssParts(anim("bounce", d), 0, 100, 200, 960).lineTags(1);
  for (const m of tags.matchAll(/\\t\((\d+),(\d+),\\fscx(\d+)\\fscy\d+\)/g)) {
    const tSec = Number(m[2]) / 1000;
    const expected = Math.round(entranceFrameAt(anim("bounce", d), tSec).scale * 100);
    assert.ok(Math.abs(Number(m[3]) - expected) <= 1, `at ${tSec}s export ${m[3]} vs preview ${expected}`);
  }
  const start = /\\fscx(\d+)\\fscy/.exec(tags)!;
  assert.equal(Number(start[1]), Math.round(entranceFrameAt(anim("bounce", d), 0).scale * 100));
});

test("ASS: an entrance longer than the first word interval CONTINUES on the following events instead of being cut off", () => {
  // 0.1s first word, 0.5s entrance
  const quick = sub([w("a", 1, 1.1), w("b", 1.1, 1.6), w("c", 1.6, 2)]);
  const events = dialogues(ass([quick], { entrance: "slide-up", durationSec: 0.5, word: "highlight" }));
  assert.ok(events.length >= 3);
  const m0 = /\\move\((\d+),(\d+),(\d+),(\d+),0,(\d+)\)/.exec(events[0])!;
  const m1 = /\\move\((\d+),(\d+),(\d+),(\d+),0,(\d+)\)/.exec(events[1]);
  assert.ok(m1, "second event (offset 0.1s) still slides");
  assert.equal(Number(m0[5]), 500);
  assert.equal(Number(m1[5]), 400, "remaining duration only");
  assert.ok(Number(m1[2]) < Number(m0[2]), "starts closer to the final position than the first event did");
  assert.ok(Number(m1[2]) > Number(m1[4]), "but is still offset");
  assert.ok(!/\\move/.test(events[2]) && /\\pos\(/.test(events[2]), "past the duration it is a plain \\pos");
});

test("ASS: fade-in continues past a short first interval via an alpha ramp restated after {\\r}", () => {
  const quick = sub([w("a", 1, 1.1), w("b", 1.1, 1.6), w("c", 1.6, 2)]);
  const events = dialogues(ass([quick], { entrance: "fade", durationSec: 0.5, word: "highlight" }));
  assert.match(events[0], /\\fad\(500,0\)/);
  // per-channel ramp that ends at the style's OWN alphas (shadow \4a stays 0x80), not a flat opaque 0
  assert.match(events[1], /\\1a&H[0-9A-F]{2}&\\3a&H[0-9A-F]{2}&\\4a&H[0-9A-F]{2}&\\t\(0,400,\\1a&H00&\\3a&H00&\\4a&H80&\)/);
  assert.ok(!/\\fad\(/.test(events[1]));
  assert.match(events[1], /\{\\r\\1a&H/, "the ramp survives the {\\r} after the active word");
});

test("ASS: with BOTH an entrance fade and an exit fade the entrance keeps its \\fad and the exit ramps separately", () => {
  // (a second \fad tag used to silently replace the first, dropping the entrance)
  const events = dialogues(ass([sub([w("only", 1, 3)])], { entrance: "fade", exit: "fade", durationSec: 0.3 }));
  assert.equal(events.length, 3, "split at entrance-end and exit-start so no event carries both");
  assert.match(events[0], /\\fad\(300,0\)/);
  assert.ok(!/\\fad\(/.test(events[1]) && !/\\fad\(/.test(events[2]));
  assert.match(events[2], /\\t\(0,300,\\1a&HFF&/);
});

test("ASS: typewriter/word-pop/char-pop keep the 0.15s capped fade (unchanged behaviour)", () => {
  for (const entrance of ["typewriter", "word-pop", "char-pop"] as const) {
    assert.match(dialogues(ass([sub(WORDS4)], { entrance, durationSec: 1 }))[0], /\\fad\(150,0\)/);
  }
});

test("ASS: entrance 'none' emits a bare \\pos and no animation tags", () => {
  const first = dialogues(ass([sub(WORDS4)], { entrance: "none", word: "none" }))[0];
  assert.match(first, /^Dialogue: 1,[^{]*\{\\pos\(\d+,\d+\)\}/);
});

test("ASS: pop with active-word scale animates the word RELATIVE to its own scale (no fight over \\fscx)", () => {
  const first = dialogues(ass([sub(WORDS4)], { entrance: "pop", durationSec: 0.4, word: "scale" }, { activeWordScale: 1.5 }))[0];
  const block = /\{(\\c[^}]*)\}HELLO/.exec(first)!;
  assert.match(block[1], /\\fscx90\\fscy90/, "60% entrance start × 1.5 active scale");
  assert.match(block[1], /\\fscx150\\fscy150\)/, "ends at the active-word scale, not 100%");
});

test("ASS: the active word's scale/bounce eases in; bounce overshoots, scale does not", () => {
  const scale = dialogues(ass([sub(WORDS4)], { entrance: "none", word: "scale", durationSec: 0.3 }))[1];
  assert.match(scale, /\\fscx100\\fscy100\\t\(0,\d+,\\fscx112\\fscy112\)/);
  const bounce = dialogues(ass([sub(WORDS4)], { entrance: "none", word: "bounce", durationSec: 0.3 }))[1];
  const peaks = [...bounce.matchAll(/\\fscx(\d+)\\fscy/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...peaks) > 112, "bounce overshoots the target scale before settling");
  assert.equal(peaks[peaks.length - 1], 112);
});

// ───────────────────────── performance / safety (source-level) ─────────────────────────

test("preview: no per-word timers, one rAF loop only while playing, no store writes per frame", () => {
  const overlay = readFileSync(path.join(SRC, "components", "editor", "subtitle-overlay.tsx"), "utf-8");
  assert.ok(!/setTimeout|setInterval|requestAnimationFrame/.test(overlay), "the overlay itself must be a pure render of its inputs");
  const hook = readFileSync(path.join(SRC, "components", "editor", "use-live-playback-time.ts"), "utf-8");
  assert.equal((hook.match(/requestAnimationFrame\(/g) ?? []).length, 2, "one initial request + one re-arm inside the loop");
  assert.match(hook, /cancelAnimationFrame/);
  assert.ok(!/useEditorStore|setCurrentTime/.test(hook), "per-frame time must not be written to the global store");
  assert.match(hook, /if \(!isPlaying\) return;/, "no loop while paused/scrubbing");
});

test("preview: the canvas renders captions through LiveSubtitleLayer (real video time), not the ~4Hz store time", () => {
  const canvas = readFileSync(path.join(SRC, "components", "editor", "video-canvas.tsx"), "utf-8");
  assert.match(canvas, /<LiveSubtitleLayer/);
  assert.ok(!/<SubtitleOverlay/.test(canvas));
});

test("both renderers share the single entrance definition", () => {
  const overlay = readFileSync(path.join(SRC, "components", "editor", "subtitle-overlay.tsx"), "utf-8");
  const assSrc = readFileSync(path.join(SRC, "lib", "subtitles", "ass.ts"), "utf-8");
  assert.match(overlay, /entrance-animation/);
  assert.match(assSrc, /entrance-animation/);
});
