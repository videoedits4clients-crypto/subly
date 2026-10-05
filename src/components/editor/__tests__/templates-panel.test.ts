/**
 * P22 — structural guards for the Templates tab (no component test harness exists here, so these read the source):
 * it applies through the single store action (one undo step), reuses the Presets tab's real-CSS preview instead of
 * a second miniature renderer, says plainly that previews are not animated, filters with the existing families,
 * and is a tab of the right panel.
 *
 * Run with: node --test src/components/editor/__tests__/templates-panel.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync("src/components/editor/templates-panel.tsx", "utf8");
const right = readFileSync("src/components/editor/right-panel.tsx", "utf8");
const presets = readFileSync("src/components/editor/presets-panel.tsx", "utf8");

test("the tab applies via the one store action — never separate style and animation writes", () => {
  assert.match(panel, /applyTemplate\(target, RESOLVED\.get\(template\.id\)!\)/);
  for (const forbidden of ["setGlobalStyle", "setGlobalAnimation", "applyStyleToSubtitles", "applyAnimationToSubtitles", "applyPreset", "setSubtitleStyleOverride"]) {
    assert.ok(!panel.includes(forbidden), `${forbidden} would split one template into several undo steps`);
  }
});

test("cards reuse the Presets tab's real preview (same CSS as the live preview), not a second renderer", () => {
  assert.match(panel, /import \{ PresetPreview, describeMotion \} from "\.\/presets-panel"/);
  assert.match(presets, /export function PresetPreview/);
  assert.ok(!/styleToTextCss|buildAssDocument|<video|canvas/i.test(panel), "no renderer of its own");
});

test("the picker is explicit that its previews are still, and lists the motion in words", () => {
  assert.match(panel, /they are still images/);
  assert.match(panel, /describeMotion\(resolved\.animation\)/);
});

test("filter chips come from the existing family vocabulary", () => {
  assert.match(panel, /FAMILY_INFO\[/);
  assert.match(panel, /templateFamilies\(STYLE_FAMILIES\)/);
});

test("templates are resolved once, and cards are memoised — typing or filtering does not re-resolve or re-render them", () => {
  assert.match(panel, /const RESOLVED = new Map/);
  assert.match(panel, /const TemplateCard = memo\(/);
});

test("Templates is a tab of the right-hand panel", () => {
  assert.match(right, /<TabsTrigger value="templates"/);
  assert.match(right, /<TemplatesPanel \/>/);
});
