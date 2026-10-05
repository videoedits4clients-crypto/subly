/**
 * P22 — applying a caption template through the REAL editor store: one logical undo step, redo, single / multiple /
 * all captions, no change to text, timing, words or order, and no history step when nothing would change.
 *
 * Run with: node --test src/store/__tests__/editor-store-templates.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { CAPTION_TEMPLATES, resolveTemplate } from "../../lib/caption-templates.ts";
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
    words: text.split(" ").map((t, j, a) => ({ text: t, start: i * 2 + (j * 1.8) / a.length, end: i * 2 + ((j + 1) * 1.8) / a.length })),
  }));
  subtitles[1] = { ...subtitles[1], style: { color: "#00FF00", fontSize: 40 }, animation: { entrance: "slide-up" } };
  subtitles[2] = { ...subtitles[2], words: subtitles[2].words.map((w, j) => (j === 0 ? { ...w, style: { color: "#FF0000", fontSize: 90 } } : w)) };
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
const templateById = (id: string) => resolveTemplate(CAPTION_TEMPLATES.find((t) => t.id === id)!);
const snapshotOfContent = (p: ProjectData) => JSON.stringify(p.subtitles.map((s) => ({ id: s.id, index: s.index, text: s.text, start: s.start, end: s.end, words: s.words })));

test.beforeEach(() => {
  store().load(fixtureProject());
});

test("1. one caption: apply → the caption renders as the template → undo restores it exactly → redo re-applies", () => {
  const before = JSON.stringify(project());
  const r = templateById("creator-punch");
  assert.equal(store().applyTemplate({ ids: ["s1"] }, r), 1);
  const sub = project().subtitles[0];
  assert.deepEqual(resolveStyle(project(), sub), r.style);
  assert.deepEqual(resolveAnimation(project(), sub), r.animation);
  assert.equal(project().subtitles[2].style, undefined, "other captions untouched");

  store().undo();
  assert.equal(JSON.stringify(project()), before, "undo restores the whole project exactly");

  store().redo();
  assert.deepEqual(resolveStyle(project(), project().subtitles[0]), r.style);
});

test("2. several captions are ONE history step: one undo restores all of them", () => {
  const before = JSON.stringify(project());
  const pastBefore = store().past.length;
  assert.equal(store().applyTemplate({ ids: ["s1", "s2", "s4"] }, templateById("news-bar")), 3);
  assert.equal(store().past.length, pastBefore + 1, "exactly one undo step");
  for (const id of ["s1", "s2", "s4"]) assert.deepEqual(resolveStyle(project(), project().subtitles.find((s) => s.id === id)!), templateById("news-bar").style, id);
  store().undo();
  assert.equal(JSON.stringify(project()), before);
  assert.equal(store().past.length, pastBefore);
  store().redo();
  assert.equal(store().past.length, pastBefore + 1);
  assert.deepEqual(resolveStyle(project(), project().subtitles[3]), templateById("news-bar").style);
});

test("3. apply to ALL: project defaults change, every override is cleared, one undo restores both", () => {
  const before = JSON.stringify(project());
  const r = templateById("cinematic-title");
  assert.equal(store().applyTemplate({ all: true }, r), 4);
  assert.deepEqual(project().globalStyle, r.style);
  assert.deepEqual(project().animation, r.animation);
  assert.ok(project().subtitles.every((s) => s.style === undefined && s.animation === undefined), "the green/slide-up override on s2 is gone");
  assert.deepEqual(store().lastAppliedStyleSnapshot, { style: r.style, animation: r.animation }, "Reset changes refers to the template");
  store().undo();
  assert.equal(JSON.stringify(project()), before, "the override on s2 is restored too");
});

test("4. text, timing, word timestamps, per-word styling, order and ids never change", () => {
  const content = snapshotOfContent(project());
  const composition = JSON.stringify(project().composition);
  for (const t of CAPTION_TEMPLATES) {
    store().applyTemplate({ ids: ["s1", "s3"] }, resolveTemplate(t));
    store().applyTemplate({ all: true }, resolveTemplate(t));
    assert.equal(snapshotOfContent(project()), content, t.id);
  }
  assert.equal(JSON.stringify(project().composition), composition);
  assert.deepEqual(project().subtitles[2].words[0].style, { color: "#FF0000", fontSize: 90 }, "manual per-word styling is preserved");
});

test("5. re-applying what is already applied creates no history step and does not mark the project dirty", () => {
  const r = templateById("podcast-clean");
  store().applyTemplate({ all: true }, r);
  const past = store().past.length;
  useEditorStore.setState({ dirty: false });
  assert.equal(store().applyTemplate({ all: true }, r), 0);
  assert.equal(store().past.length, past);
  assert.equal(store().dirty, false);
});

test("6. no targets / unknown ids: returns 0 and records nothing; no project: returns 0", () => {
  const past = store().past.length;
  assert.equal(store().applyTemplate({ ids: [] }, templateById("meme-impact")), 0);
  assert.equal(store().applyTemplate({ ids: ["nope"] }, templateById("meme-impact")), 0);
  assert.equal(store().past.length, past);
  useEditorStore.setState({ project: null });
  assert.equal(store().applyTemplate({ all: true }, templateById("meme-impact")), 0);
});

test("7. applying marks the project dirty so autosave persists it; undo and redo do too", () => {
  useEditorStore.setState({ dirty: false });
  store().applyTemplate({ ids: ["s1"] }, templateById("social-pop"));
  assert.equal(store().dirty, true);
  useEditorStore.setState({ dirty: false });
  store().undo();
  assert.equal(store().dirty, true);
  useEditorStore.setState({ dirty: false });
  store().redo();
  assert.equal(store().dirty, true);
});

test("8. template A then template B on a caption: undo goes B → A → original, one step each", () => {
  const original = JSON.stringify(project());
  store().applyTemplate({ ids: ["s1"] }, templateById("karaoke-pop"));
  const afterA = JSON.stringify(project());
  store().applyTemplate({ ids: ["s1"] }, templateById("handwritten-marker"));
  store().undo();
  assert.equal(JSON.stringify(project()), afterA);
  store().undo();
  assert.equal(JSON.stringify(project()), original);
});

test("9. the applied style is a copy: editing the caption afterwards never changes a template or another caption", () => {
  const r = templateById("creator-bold");
  store().applyTemplate({ ids: ["s1", "s4"] }, r);
  store().setSubtitleStyleOverride("s1", { fontSize: 33 });
  assert.equal(resolveStyle(project(), project().subtitles[0]).fontSize, 33);
  assert.equal(resolveStyle(project(), project().subtitles[3]).fontSize, r.style.fontSize, "s4 keeps the template size");
  assert.equal(templateById("creator-bold").style.fontSize, r.style.fontSize, "the template itself is unchanged");
});
