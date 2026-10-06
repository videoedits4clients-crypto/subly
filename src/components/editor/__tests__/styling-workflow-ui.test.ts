/**
 * P23 — structural guards for the shared edit scope and the scope notices (no component test harness exists here, so
 * these read the source): the four tabs share ONE scope in the store, the Style/Animation tabs no longer keep a private
 * "All captions" state that a template applied to one caption would bypass, a caption's own look is visible in the list,
 * and the word editor can no longer index a different caption's words.
 *
 * Run with: node --test src/components/editor/__tests__/styling-workflow-ui.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(`src/components/editor/${f}`, "utf8");
const style = read("style-panel.tsx");
const animation = read("animation-panel.tsx");
const templates = read("templates-panel.tsx");
const presets = read("presets-panel.tsx");
const captions = read("captions-panel.tsx");
const scope = read("scope-controls.tsx");

test("Style, Animation, Templates and Presets all read and write the one store scope", () => {
  for (const [name, src] of [["style", style], ["animation", animation], ["templates", templates], ["presets", presets]] as const) {
    assert.match(src, /useEditorStore\(\(s\) => s\.editScope\)/, `${name} reads editScope`);
    assert.match(src, /useEditorStore\(\(s\) => s\.setEditScope\)/, `${name} writes it`);
    assert.match(src, /resolveEditScope\(/, `${name} resolves it with the shared rule`);
  }
});

test("no tab keeps a private copy of the scope any more", () => {
  assert.ok(!/useState\(false\)[\s\S]{0,40}scopeSelected|const \[scopeSelected/.test(style), "style-panel");
  assert.ok(!/const \[scopeSelected/.test(animation), "animation-panel");
  assert.ok(!/const \[scopeChoice/.test(templates), "templates-panel");
});

test("applying a template or preset leaves the scope it used as the scope of the other tabs", () => {
  assert.match(templates, /setEditScope\(scope\)/);
  assert.match(presets, /setEditScope\("selected"\)/);
  assert.match(presets, /setEditScope\("all"\)/);
});

test("the project-look scope shows a notice when captions have their own look (Style, Animation, Presets)", () => {
  assert.match(style, /<OverrideNotice kind="style"/);
  assert.match(animation, /<OverrideNotice kind="animation"/);
  assert.match(presets, /<OverrideNotice kind="look"/);
  assert.match(scope, /clearCaptionLooks/);
  assert.match(scope, /action: \{ label: "Undo"/, "the reset offers Undo");
});

test("a caption's own look is visible in the captions list", () => {
  assert.match(captions, /hasOwnLook=\{hasOwnLook\(s\)\}/);
  assert.match(captions, /Custom look/);
});

test("the word editor takes its index from validWordIndex (never another caption's, never out of range)", () => {
  assert.match(style, /validWordIndex\(wordMemory, selectedSub\)/);
  assert.ok(!/const \[selectedWordIndex, setSelectedWordIndex\] = useState/.test(style));
});

test("Presets applies through the shared action for a selection, and the legacy project action otherwise", () => {
  assert.match(presets, /applyTemplate\(\{ ids: selectionIds \}, \{ style, animation \}\)/);
  assert.match(presets, /applyPreset\(style, animation\)/);
});
