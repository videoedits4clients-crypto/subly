/**
 * P22 — caption templates: the curated set is well-formed and distinct, resolves into the EXISTING style +
 * animation system (nothing new for the renderers), filters by the existing 12 families, and applies to
 * captions without touching anything but styling.
 *
 * Run with: node --test src/lib/__tests__/caption-templates.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTION_TEMPLATES,
  applyTemplateToSnapshot,
  countTemplateTargets,
  filterTemplates,
  getTemplate,
  resolveTemplate,
  templateFamilies,
  templateMatches,
  type TemplateSnapshot,
} from "../caption-templates.ts";
import { PICKER_PRESETS, STYLE_FAMILIES, FAMILY_INFO, getPreset } from "../presets.ts";
import { findSimilarPairs } from "../preset-audit.ts";
import { buildAssDocument } from "../subtitles/ass.ts";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE, resolveAnimation, resolveStyle } from "../../types/subtitle.ts";
import type { Subtitle } from "../../types/subtitle.ts";

const VALID_ENTRANCE = new Set(["none", "fade", "pop", "slide-up", "slide-down", "slide-left", "slide-right", "bounce", "typewriter", "word-pop", "char-pop"]);
const VALID_EXIT = new Set(["none", "fade", "slide", "slide-up", "slide-down", "slide-left", "slide-right", "pop"]);
const VALID_WORD = new Set(["none", "highlight", "scale", "bounce", "color", "underline", "bg-highlight"]);

// ───────────────────────── definitions ─────────────────────────

test("a small curated set: 12–16 templates with unique ids and names", () => {
  assert.ok(CAPTION_TEMPLATES.length >= 12 && CAPTION_TEMPLATES.length <= 16, `${CAPTION_TEMPLATES.length} templates`);
  assert.equal(new Set(CAPTION_TEMPLATES.map((t) => t.id)).size, CAPTION_TEMPLATES.length);
  assert.equal(new Set(CAPTION_TEMPLATES.map((t) => t.name)).size, CAPTION_TEMPLATES.length);
  for (const t of CAPTION_TEMPLATES) {
    assert.match(t.id, /^[a-z]+(-[a-z]+)*$/, t.id);
    assert.ok(t.name.length >= 3 && t.description.length >= 20 && t.purpose.length >= 40, `${t.id}: name / description / purpose present`);
    assert.ok(t.tags.length >= 3 && t.tags.every((tag) => tag === tag.toLowerCase()), `${t.id}: tags`);
  }
});

test("every template is built on an existing visible preset and shares its family (no second taxonomy)", () => {
  const visible = new Set(PICKER_PRESETS.map((p) => p.id));
  for (const t of CAPTION_TEMPLATES) {
    assert.ok(visible.has(t.base), `${t.id}: base "${t.base}" must be a visible built-in preset`);
    assert.equal(getPreset(t.base)!.family, t.family, `${t.id}: family must equal its base preset's family`);
    assert.ok((STYLE_FAMILIES as readonly string[]).includes(t.family), t.id);
  }
});

test("every template carries a complete, valid motion recipe", () => {
  for (const t of CAPTION_TEMPLATES) {
    assert.ok(VALID_ENTRANCE.has(t.animation.entrance), `${t.id} entrance`);
    assert.ok(VALID_EXIT.has(t.animation.exit), `${t.id} exit`);
    assert.ok(VALID_WORD.has(t.animation.word), `${t.id} word`);
    assert.ok(t.animation.durationSec >= 0.1 && t.animation.durationSec <= 1, `${t.id} duration`);
  }
});

test("a template that shows an active word also enables word highlighting in its resolved style", () => {
  for (const t of CAPTION_TEMPLATES) {
    const r = resolveTemplate(t);
    if (r.animation.word !== "none") assert.equal(r.style.wordHighlight, true, `${t.id}: word animation "${r.animation.word}" needs wordHighlight`);
  }
});

// ───────────────────────── resolution ─────────────────────────

test("a template resolves into an ordinary SubtitleStyle + AnimationConfig: base preset overlaid by the template", () => {
  for (const t of CAPTION_TEMPLATES) {
    const preset = getPreset(t.base)!;
    const r = resolveTemplate(t);
    assert.deepEqual(r.style, { ...preset.style, ...t.style }, `${t.id} style`);
    assert.deepEqual(r.animation, { ...preset.animation, ...t.animation }, `${t.id} animation`);
    assert.deepEqual(Object.keys(r.style).sort(), Object.keys(DEFAULT_SUBTITLE_STYLE).sort(), `${t.id}: exactly the SubtitleStyle fields, nothing new`);
    assert.deepEqual(Object.keys(r.animation).sort(), Object.keys(DEFAULT_ANIMATION).sort(), `${t.id}: exactly the AnimationConfig fields`);
  }
});

test("resolution returns fresh objects: applying a template can never mutate a preset or another application", () => {
  const t = CAPTION_TEMPLATES[0];
  const a = resolveTemplate(t);
  const b = resolveTemplate(t);
  assert.notEqual(a.style, b.style);
  assert.notEqual(a.animation, b.animation);
  const before = JSON.stringify(getPreset(t.base));
  a.style.fontSize = 1;
  a.animation.entrance = "none";
  assert.equal(JSON.stringify(getPreset(t.base)), before);
});

test("only the emphasis fields may be overridden on the base style (templates add no look of their own)", () => {
  const allowed = new Set(["wordHighlight", "highlightColor", "activeWordScale"]);
  for (const t of CAPTION_TEMPLATES) for (const key of Object.keys(t.style ?? {})) assert.ok(allowed.has(key), `${t.id} overrides ${key}`);
});

test("an unknown base preset fails loudly", () => {
  assert.throws(() => resolveTemplate({ ...CAPTION_TEMPLATES[0], base: "no-such-preset" }), /unknown preset/);
});

test("every template renders through the existing ASS exporter: multiline, active word, custom position, no NaN", () => {
  const sub: Subtitle = {
    id: "s",
    index: 0,
    start: 1,
    end: 4,
    text: "Every great story\nbegins right here",
    words: ["Every", "great", "story", "begins", "right", "here"].map((t, i) => ({ text: t, start: 1 + i * 0.5, end: 1.5 + i * 0.5 })),
  };
  for (const t of CAPTION_TEMPLATES) {
    const r = resolveTemplate(t);
    for (const [w, h] of [[720, 1280], [1080, 1920]] as const) {
      const doc = buildAssDocument({ subtitles: [sub], globalStyle: { ...r.style, x: 35, y: 60 }, globalAnimation: r.animation, playResX: w, playResY: h });
      assert.ok(!/NaN|undefined|Infinity/.test(doc), `${t.id} @${w}`);
      assert.ok(doc.split("\n").some((l) => l.startsWith("Dialogue:")), t.id);
    }
  }
});

// ───────────────────────── distinctness ─────────────────────────

test("no two templates are the same look: every pair differs in at least 4 of the 14 perceptual dimensions", () => {
  const items = CAPTION_TEMPLATES.map((t) => ({ id: t.id, ...resolveTemplate(t) }));
  assert.deepEqual(findSimilarPairs(items, 4), []);
});

test("no two templates share a base preset, and the set spans many families", () => {
  assert.equal(new Set(CAPTION_TEMPLATES.map((t) => t.base)).size, CAPTION_TEMPLATES.length);
  assert.ok(new Set(CAPTION_TEMPLATES.map((t) => t.family)).size >= 9);
});

test("two templates in one family differ in structure, not just in tuning", () => {
  for (const family of STYLE_FAMILIES) {
    const members = CAPTION_TEMPLATES.filter((t) => t.family === family);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const pair = findSimilarPairs([{ id: members[i].id, ...resolveTemplate(members[i]) }, { id: members[j].id, ...resolveTemplate(members[j]) }], 5);
        assert.deepEqual(pair, [], `${members[i].id} vs ${members[j].id}`);
      }
    }
  }
});

// ───────────────────────── families / filtering ─────────────────────────

test("filter chips are the existing families that have templates, in the library's own order", () => {
  const chips = templateFamilies(STYLE_FAMILIES);
  assert.deepEqual(chips, STYLE_FAMILIES.filter((f) => CAPTION_TEMPLATES.some((t) => t.family === f)));
  for (const f of chips) assert.ok(FAMILY_INFO[f].label);
});

test("filterTemplates: by family, by search (name / tag / description), and both; 'all' returns every template", () => {
  assert.equal(filterTemplates("all").length, CAPTION_TEMPLATES.length);
  for (const f of templateFamilies(STYLE_FAMILIES)) {
    const got = filterTemplates(f);
    assert.ok(got.length >= 1 && got.every((t) => t.family === f), f);
  }
  assert.deepEqual(filterTemplates("all", "karaoke").map((t) => t.family), ["karaoke", "karaoke"]);
  assert.ok(filterTemplates("all", "trailer").some((t) => t.id === "cinematic-title"), "tag search");
  assert.deepEqual(filterTemplates("podcast", "chip").map((t) => t.id), ["podcast-highlight"]);
  assert.deepEqual(filterTemplates("meme", "karaoke"), []);
  assert.equal(filterTemplates("all", "  ").length, CAPTION_TEMPLATES.length);
});

test("getTemplate finds by id", () => {
  assert.equal(getTemplate("creator-punch")?.name, "Creator Punch");
  assert.equal(getTemplate("nope"), undefined);
});

// ───────────────────────── applying ─────────────────────────

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function fixture(): TemplateSnapshot {
  const mk = (id: string, i: number, extra: Partial<Subtitle> = {}): Subtitle => ({
    id,
    index: i,
    start: i * 2,
    end: i * 2 + 1.5,
    text: `caption ${i}`,
    words: [
      { text: "caption", start: i * 2, end: i * 2 + 0.7, style: i === 1 ? { color: "#FF0000" } : undefined },
      { text: String(i), start: i * 2 + 0.7, end: i * 2 + 1.5 },
    ],
    ...extra,
  });
  return {
    globalStyle: { ...DEFAULT_SUBTITLE_STYLE },
    animation: { ...DEFAULT_ANIMATION },
    subtitles: [mk("a", 0), mk("b", 1, { style: { color: "#00FF00", fontSize: 40 }, animation: { entrance: "slide-up" } }), mk("c", 2), mk("d", 3)],
  };
}

const TEMPLATE = CAPTION_TEMPLATES.find((t) => t.id === "creator-punch")!;

test("applying to selected captions gives exactly those captions the template's complete style and animation", () => {
  const snap = deepFreeze(fixture());
  const r = resolveTemplate(TEMPLATE);
  const next = applyTemplateToSnapshot(snap, { ids: ["a", "b"] }, r);
  for (const id of ["a", "b"]) {
    const sub = next.subtitles.find((s) => s.id === id)!;
    assert.deepEqual(sub.style, r.style, id);
    assert.deepEqual(sub.animation, r.animation, id);
    assert.deepEqual(resolveStyle({ globalStyle: next.globalStyle }, sub), r.style, "the caption now renders as the template");
    assert.deepEqual(resolveAnimation({ animation: next.animation }, sub), r.animation);
  }
  // the others — and the project defaults — are the same objects as before
  assert.equal(next.subtitles[2], snap.subtitles[2]);
  assert.equal(next.subtitles[3], snap.subtitles[3]);
  assert.equal(next.globalStyle, snap.globalStyle);
  assert.equal(next.animation, snap.animation);
});

test("applying never touches caption text, timing, word timestamps, per-word styling, order or ids", () => {
  const snap = deepFreeze(fixture());
  const r = resolveTemplate(TEMPLATE);
  for (const target of [{ ids: ["a", "b", "c"] }, { all: true as const }]) {
    const next = applyTemplateToSnapshot(snap, target, r);
    assert.equal(next.subtitles.length, snap.subtitles.length);
    next.subtitles.forEach((s, i) => {
      const orig = snap.subtitles[i];
      assert.equal(s.id, orig.id);
      assert.equal(s.index, orig.index);
      assert.equal(s.text, orig.text);
      assert.equal(s.start, orig.start);
      assert.equal(s.end, orig.end);
      assert.equal(s.words, orig.words, "the words array — timestamps and manual per-word styles — is the very same object");
    });
  }
});

test("applying to ALL captions sets the project defaults and clears every per-caption override", () => {
  const snap = deepFreeze(fixture());
  const r = resolveTemplate(TEMPLATE);
  const next = applyTemplateToSnapshot(snap, { all: true }, r);
  assert.deepEqual(next.globalStyle, r.style);
  assert.deepEqual(next.animation, r.animation);
  for (const s of next.subtitles) {
    assert.equal(s.style, undefined);
    assert.equal(s.animation, undefined);
    assert.deepEqual(resolveStyle({ globalStyle: next.globalStyle }, s), r.style);
  }
  assert.equal(next.subtitles[0], snap.subtitles[0], "a caption with no overrides is returned unchanged");
});

test("re-applying the same template changes nothing and returns the same snapshot (no history step)", () => {
  const r = resolveTemplate(TEMPLATE);
  const once = applyTemplateToSnapshot(fixture(), { all: true }, r);
  assert.equal(applyTemplateToSnapshot(once, { all: true }, r), once);
  const sel = applyTemplateToSnapshot(fixture(), { ids: ["a", "c"] }, r);
  assert.equal(applyTemplateToSnapshot(sel, { ids: ["a", "c"] }, r), sel);
  assert.notEqual(applyTemplateToSnapshot(sel, { ids: ["a", "b"] }, r), sel, "a new caption in the set is a real change");
});

test("unknown ids and an empty selection are no-ops", () => {
  const snap = fixture();
  const r = resolveTemplate(TEMPLATE);
  assert.equal(applyTemplateToSnapshot(snap, { ids: [] }, r), snap);
  assert.equal(applyTemplateToSnapshot(snap, { ids: ["zzz"] }, r), snap);
  assert.equal(countTemplateTargets(snap.subtitles, { ids: ["a", "zzz"] }), 1);
  assert.equal(countTemplateTargets(snap.subtitles, { all: true }), 4);
});

test("applying one template, then another, leaves the last one — and every template can be applied to a caption", () => {
  let snap = fixture();
  for (const t of CAPTION_TEMPLATES) {
    snap = applyTemplateToSnapshot(snap, { ids: ["a"] }, resolveTemplate(t));
    const sub = snap.subtitles[0];
    assert.ok(templateMatches(t, { style: resolveStyle({ globalStyle: snap.globalStyle }, sub), animation: resolveAnimation({ animation: snap.animation }, sub) }), t.id);
  }
});

test("templateMatches is exact: any tweak to the style or animation un-matches it", () => {
  const r = resolveTemplate(TEMPLATE);
  assert.ok(templateMatches(TEMPLATE, r));
  assert.ok(!templateMatches(TEMPLATE, { style: { ...r.style, fontSize: r.style.fontSize + 1 }, animation: r.animation }));
  assert.ok(!templateMatches(TEMPLATE, { style: r.style, animation: { ...r.animation, durationSec: r.animation.durationSec + 0.1 } }));
});
