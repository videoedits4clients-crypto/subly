/**
 * P23 — the Template → customize → review → undo/redo workflow in the REAL editor store.
 *
 * Bugs these guard (found by auditing the workflow):
 *  1. Every tick of a slider / colour drag was its own undo step (a 40-tick drag = 40 entries, against a 60-entry history),
 *     so one drag could evict the whole history and Ctrl+Z walked back through the drag one pixel at a time.
 *     → consecutive edits of the same property are now one undo step (commit's coalesceKey).
 *  2. After "Template → This caption" the Style / Animation tabs still edited "All captions": the caption carries a complete
 *     override, so the edit silently changed nothing visible. → one shared edit scope (store.editScope).
 *  3. No single step took a caption (or all of them) back to the project look. → clearCaptionLooks.
 *
 * Run with: node --test src/store/__tests__/editor-store-styling-workflow.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { CAPTION_TEMPLATES, resolveTemplate } from "../../lib/caption-templates.ts";
import { getPreset } from "../../lib/presets.ts";
import { resolveEditScope, selectionKeyOf } from "../../lib/edit-scope.ts";
import { DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_SUBTITLE_STYLE, DEFAULT_TIMING_RULES, resolveAnimation, resolveStyle } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";

const TEXTS = ["Hello there", "this is SUBLY", "caption three", "last one"];

function fixtureProject(): ProjectData {
  const subtitles: Subtitle[] = TEXTS.map((text, i) => ({
    id: `s${i + 1}`,
    index: i,
    start: i * 2,
    end: i * 2 + 1.8,
    text,
    words: text.split(" ").map((t, j, a) => ({
      text: t,
      start: i * 2 + (j * 1.8) / a.length,
      end: i * 2 + ((j + 1) * 1.8) / a.length,
      ...(i === 2 && j === 0 ? { style: { color: "#FF0000", fontWeight: 900 as const } } : {}),
    })),
  }));
  return {
    id: "p1",
    name: "Fixture",
    status: "READY",
    language: "en",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles,
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

const store = () => useEditorStore.getState();
const project = () => store().project!;
const tpl = (id: string) => resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === id)!);
const sub = (id: string) => project().subtitles.find((s) => s.id === id)!;
const effStyle = (id: string) => resolveStyle(project(), sub(id));
const effAnim = (id: string) => resolveAnimation(project(), sub(id));
const content = () => JSON.stringify(project().subtitles.map((s) => ({ id: s.id, index: s.index, text: s.text, start: s.start, end: s.end, words: s.words })));
const json = () => JSON.stringify(project());

const realNow = Date.now;
test.beforeEach(() => {
  Date.now = realNow;
  store().load(fixtureProject());
});
test.after(() => {
  Date.now = realNow;
});
function at(ms: number) {
  Date.now = () => ms;
}

// ───────────────────────── 1. one gesture = one undo step ─────────────────────────

test("1. a 40-tick slider drag is ONE undo step and does not evict history", () => {
  const original = json();
  for (let i = 0; i < 40; i++) store().setGlobalStyle({ fontSize: 40 + i });
  assert.equal(store().past.length, 1, "one entry for the whole drag");
  assert.equal(project().globalStyle.fontSize, 79);
  store().undo();
  assert.equal(json(), original, "a single undo returns to before the drag");
  store().redo();
  assert.equal(project().globalStyle.fontSize, 79, "a single redo returns to the end of the drag");
});

test("2. a drag never pushes earlier history out of the 60-entry window", () => {
  for (let i = 0; i < 5; i++) store().updateSubtitleText("s1", `edit ${i}`);
  const before = store().past.length;
  for (let i = 0; i < 200; i++) store().setGlobalStyle({ outlineWidth: i % 20 });
  assert.equal(store().past.length, before + 1);
});

test("3. edits of different properties are separate steps", () => {
  store().setGlobalStyle({ fontSize: 50 });
  store().setGlobalStyle({ color: "#00FF00" });
  store().setGlobalStyle({ fontSize: 55 });
  assert.equal(store().past.length, 3, "size, colour, size again: the colour edit broke the first run");
});

test("4. pausing longer than the gesture window starts a new step", () => {
  at(1_000);
  store().setGlobalStyle({ fontSize: 50 });
  at(1_300);
  store().setGlobalStyle({ fontSize: 52 });
  assert.equal(store().past.length, 1);
  at(2_500);
  store().setGlobalStyle({ fontSize: 54 });
  assert.equal(store().past.length, 2);
});

test("5. an undo, a redo, a template, or any other commit breaks the run", () => {
  at(1_000);
  store().setGlobalStyle({ fontSize: 50 });
  store().undo();
  at(1_050);
  store().setGlobalStyle({ fontSize: 51 });
  assert.equal(store().past.length, 1, "after undo the new edit is its own (only) step");
  store().applyTemplate({ ids: ["s1"] }, tpl("news-bar"));
  at(1_100);
  store().setGlobalStyle({ fontSize: 52 });
  assert.equal(store().past.length, 3, "the template in between made fontSize 52 a new step");
});

test("6. the same property on two different captions are two steps; resets never coalesce", () => {
  store().setSubtitleStyleOverride("s1", { fontSize: 60 });
  store().setSubtitleStyleOverride("s2", { fontSize: 60 });
  assert.equal(store().past.length, 2);
  store().setSubtitleStyleOverride("s1", null);
  store().setSubtitleStyleOverride("s1", null);
  assert.equal(store().past.length, 4, "resets are discrete actions");
});

test("6b. a patch that removes a property (an undefined value) is a discrete step", () => {
  store().setWordStyleOverride("s1", 0, { color: "#00ff00", letterSpacing: 4 });
  store().setWordStyleOverride("s1", 0, { color: "#00ff00", letterSpacing: undefined });
  assert.equal(store().past.length, 2);
  store().undo();
  assert.deepEqual(sub("s1").words[0].style, { color: "#00ff00", letterSpacing: 4 });
});

test("7. animation and word-style drags coalesce the same way", () => {
  for (let i = 0; i < 20; i++) store().setGlobalAnimation({ durationSec: 0.1 + i * 0.01 });
  assert.equal(store().past.length, 1);
  for (let i = 0; i < 20; i++) store().setWordStyleOverride("s1", 0, { fontSize: 50 + i });
  assert.equal(store().past.length, 2);
  for (let i = 0; i < 20; i++) store().applyStyleToSubtitles(["s1", "s2"], { letterSpacing: i / 4 });
  assert.equal(store().past.length, 3);
});

test("8. undo of a coalesced edit never leaves a half-applied value", () => {
  store().setSubtitleStyleOverride("s1", { fontSize: 61 });
  const afterFirst = json();
  store().applyTemplate({ ids: ["s2"] }, tpl("social-pop"));
  for (let i = 0; i < 10; i++) store().setSubtitleStyleOverride("s2", { fontSize: 70 + i });
  store().undo();
  assert.equal(JSON.stringify(project().subtitles[1].style), JSON.stringify(tpl("social-pop").style), "back to the template, not to a mid-drag size");
  store().undo();
  assert.equal(json(), afterFirst);
});

// ───────────────────────── 2. Template → customize ─────────────────────────

test("9. Template → font, size, colour, position, outline, shadow, background on the caption: each undoes and redoes exactly", () => {
  const t = tpl("creator-bold");
  store().applyTemplate({ ids: ["s2"] }, t);
  const steps: [string, Partial<typeof t.style>][] = [
    ["font", { fontFamily: "Poppins", fontWeight: 700 }],
    ["size", { fontSize: 64 }],
    ["colour", { color: "#22D3EE" }],
    ["position", { x: 30, y: 25, align: "left", vAlign: "top" }],
    ["outline", { outlineEnabled: true, outlineWidth: 12, outlineColor: "#111111" }],
    ["shadow", { shadowEnabled: true, shadowBlur: 20, shadowColor: "#FF00FF" }],
    ["background", { backgroundOpacity: 0.7, backgroundColor: "#202040", backgroundRadius: 24 }],
  ];
  const states = [json()];
  for (const [, patch] of steps) {
    store().setSubtitleStyleOverride("s2", patch);
    states.push(json());
    // every step leaves the template's animation exactly as it was
    assert.deepEqual(effAnim("s2"), t.animation);
  }
  for (let i = steps.length; i >= 1; i--) {
    store().undo();
    assert.equal(json(), states[i - 1], `undo of "${steps[i - 1][0]}"`);
  }
  for (let i = 1; i <= steps.length; i++) {
    store().redo();
    assert.equal(json(), states[i], `redo of "${steps[i - 1][0]}"`);
  }
  assert.equal(effStyle("s2").fontFamily, "Poppins");
  assert.equal(effStyle("s2").x, 30);
});

test("10. Template → animation edits (entrance, exit, word, duration) leave the typography alone, and vice versa", () => {
  const t = tpl("karaoke-pop");
  store().applyTemplate({ ids: ["s1"] }, t);
  const typo = JSON.stringify(effStyle("s1"));
  store().setSubtitleAnimationOverride("s1", { entrance: "slide-left" });
  store().setSubtitleAnimationOverride("s1", { exit: "fade" });
  store().setSubtitleAnimationOverride("s1", { word: "underline" });
  store().setSubtitleAnimationOverride("s1", { durationSec: 0.5 });
  assert.equal(JSON.stringify(effStyle("s1")), typo, "typography untouched by animation edits");
  assert.deepEqual(effAnim("s1"), { entrance: "slide-left", exit: "fade", word: "underline", durationSec: 0.5 });
  const anim = JSON.stringify(effAnim("s1"));
  store().setSubtitleStyleOverride("s1", { fontSize: 77, color: "#FACC15" });
  assert.equal(JSON.stringify(effAnim("s1")), anim, "animation untouched by typography edits");
});

test("11. word styling survives template, style, animation, undo and redo", () => {
  const words = JSON.stringify(sub("s3").words);
  store().applyTemplate({ ids: ["s3"] }, tpl("meme-impact"));
  store().setSubtitleStyleOverride("s3", { fontSize: 90 });
  store().setSubtitleAnimationOverride("s3", { word: "bounce" });
  store().applyTemplate({ all: true }, tpl("podcast-clean"));
  assert.equal(JSON.stringify(sub("s3").words), words);
  store().undo();
  store().undo();
  assert.equal(JSON.stringify(sub("s3").words), words);
  store().redo();
  assert.equal(JSON.stringify(sub("s3").words), words);
  assert.deepEqual(sub("s3").words[0].style, { color: "#FF0000", fontWeight: 900 });
});

// ───────────────────────── 3. per-caption overrides ─────────────────────────

test("12. a caption's own customization survives other captions' template, global edits, presets and selection changes", () => {
  store().applyTemplate({ all: true }, tpl("editorial-serif"));
  store().setSubtitleStyleOverride("s2", { fontSize: 70, color: "#FF9900" });
  const custom = JSON.stringify(sub("s2").style);

  store().selectSubtitle("s3");
  store().applyTemplate({ ids: ["s3"] }, tpl("news-bar"));
  store().selectSubtitle("s1");
  store().setGlobalStyle({ fontSize: 99, color: "#123456" });
  store().setGlobalAnimation({ entrance: "pop" });
  store().applyPreset(getPreset("tiktok")!.style, getPreset("tiktok")!.animation);
  store().selectSubtitleRange("s4");

  assert.equal(JSON.stringify(sub("s2").style), custom, "s2 keeps its own style through all of that");
  assert.equal(sub("s3").style!.fontFamily, tpl("news-bar").style.fontFamily, "s3 keeps the template it was given");
  assert.equal(sub("s4").style, undefined, "captions without an override follow the project");
});

test("13. applying a template to ALL deliberately replaces overrides — in ONE step that undoes completely", () => {
  store().applyTemplate({ ids: ["s1"] }, tpl("news-bar"));
  store().setSubtitleStyleOverride("s2", { color: "#FF9900" });
  store().setSubtitleAnimationOverride("s4", { exit: "pop" });
  const before = json();
  const past = store().past.length;
  store().applyTemplate({ all: true }, tpl("cinematic-minimal"));
  assert.equal(store().past.length, past + 1);
  assert.ok(project().subtitles.every((s) => s.style === undefined && s.animation === undefined));
  store().undo();
  assert.equal(json(), before);
});

test("14. clearCaptionLooks: one undoable step, only the named captions, returns the count, no-op when there is nothing to clear", () => {
  store().applyTemplate({ ids: ["s1", "s2", "s3"] }, tpl("social-bounce"));
  const before = json();
  const past = store().past.length;
  assert.equal(store().clearCaptionLooks(["s1", "s3", "s4"]), 2, "s4 had no override");
  assert.equal(store().past.length, past + 1);
  assert.equal(sub("s1").style, undefined);
  assert.equal(sub("s1").animation, undefined);
  assert.ok(sub("s2").style);
  assert.equal(content(), content());
  store().undo();
  assert.equal(json(), before);
  assert.equal(store().clearCaptionLooks(["s4"]), 0);
  assert.equal(store().past.length, past, "no history entry for a no-op");
});

test("15. clearCaptionLooks keeps text, timing and word styling", () => {
  store().applyTemplate({ all: true }, tpl("karaoke-focus"));
  store().applyTemplate({ ids: ["s3"] }, tpl("handwritten-marker"));
  const c = content();
  store().clearCaptionLooks(["s3"]);
  assert.equal(content(), c);
});

// ───────────────────────── 4. Template ↔ Preset ↔ Style ↔ Animation sequences ─────────────────────────

test("16. A: Template → Preset → Style edit (all captions)", () => {
  store().applyTemplate({ all: true }, tpl("creator-punch"));
  const p = getPreset("classic")!;
  store().applyPreset(p.style, p.animation);
  store().setGlobalStyle({ fontSize: 61 });
  assert.deepEqual(effStyle("s2"), { ...p.style, fontSize: 61 });
  assert.deepEqual(effAnim("s2"), p.animation);
});

test("17. B: Template → Style edit → Template: the second template replaces the edit completely", () => {
  store().applyTemplate({ ids: ["s1"] }, tpl("podcast-clean"));
  store().setSubtitleStyleOverride("s1", { fontSize: 99, color: "#00FFFF" });
  store().applyTemplate({ ids: ["s1"] }, tpl("cinematic-title"));
  assert.deepEqual(effStyle("s1"), tpl("cinematic-title").style);
  assert.deepEqual(effAnim("s1"), tpl("cinematic-title").animation);
});

test("18. C: Preset → Template → Preset on the project look", () => {
  const a = getPreset("mrbeast")!;
  const b = getPreset("minimal")!;
  store().applyPreset(a.style, a.animation);
  store().applyTemplate({ all: true }, tpl("news-bar"));
  store().applyPreset(b.style, b.animation);
  assert.deepEqual(project().globalStyle, b.style);
  assert.deepEqual(project().animation, b.animation);
});

test("19. D / E: Template → Animation edit → Style edit; per-caption override → global style edit", () => {
  store().applyTemplate({ all: true }, tpl("karaoke-focus"));
  store().setGlobalAnimation({ exit: "fade" });
  store().setGlobalStyle({ fontSize: 58 });
  assert.equal(effAnim("s1").exit, "fade");
  assert.equal(effAnim("s1").word, tpl("karaoke-focus").animation.word, "the template's word treatment survived");
  assert.equal(effStyle("s1").fontSize, 58);
  store().setSubtitleStyleOverride("s2", { fontSize: 33 });
  store().setGlobalStyle({ fontSize: 80 });
  assert.equal(effStyle("s1").fontSize, 80);
  assert.equal(effStyle("s2").fontSize, 33, "the per-caption size is not overwritten by a later global edit");
});

// ───────────────────────── 5. no history from navigation ─────────────────────────

test("20. selecting captions, changing the edit scope and playing create no history and do not mark the project dirty", () => {
  useEditorStore.setState({ dirty: false });
  const past = store().past.length;
  store().selectSubtitle("s2");
  store().setEditScope("selected");
  store().setEditScope("all");
  store().setPlaying(true);
  store().setCurrentTime(3);
  store().setPlaying(false);
  assert.equal(store().past.length, past);
  assert.equal(store().dirty, false);
});

test("21. the edit scope starts unset, is not part of undo, and is reset by load", () => {
  assert.equal(store().editScope, null);
  store().selectSubtitle("s1");
  store().setEditScope("selected");
  assert.deepEqual(store().editScope, { scope: "selected", selectionKey: "s1" });
  store().applyTemplate({ ids: ["s1"] }, tpl("news-bar"));
  store().undo();
  assert.deepEqual(store().editScope, { scope: "selected", selectionKey: "s1" }, "undo restores caption data, not UI state");
  store().load(fixtureProject());
  assert.equal(store().editScope, null);
});

test("22. a scope chosen for one selection lapses for the next: Template → ALL, then select a caption → a template click is NOT project-wide", () => {
  // nothing selected: the user applies a template to all captions; the scope is remembered for the empty selection
  store().applyTemplate({ all: true }, tpl("editorial-serif"));
  store().setEditScope("all");
  store().selectSubtitle("s2");
  const stored = store().editScope!;
  const key = selectionKeyOf(store().selectedSubtitleId, store().selectedSubtitleIds);
  assert.equal(resolveEditScope(stored, key, true, "selected"), "selected", "Templates default to the new selection");
  assert.equal(resolveEditScope(stored, key, true, "all"), "all", "Style / Animation keep their legacy default");
  // …and the click really is per caption
  const before = JSON.stringify(project().globalStyle);
  store().applyTemplate({ ids: ["s2"] }, tpl("news-bar"));
  assert.equal(JSON.stringify(project().globalStyle), before, "the project look was not touched");
  assert.equal(effStyle("s2").fontFamily, tpl("news-bar").style.fontFamily);
  assert.equal(effStyle("s1").fontFamily, tpl("editorial-serif").style.fontFamily);
});
