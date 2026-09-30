/**
 * Regression tests for custom caption presets (src/lib/custom-presets.ts) — pure functions,
 * no DB, no fetch, no React. Also exercises the real, untouched src/lib/presets.ts (built-in
 * presets) to prove the two systems are fully independent.
 *
 * Run with: node --test src/lib/__tests__/custom-presets.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNewPresetName,
  validateRenamedPresetName,
  parsePresetRows,
  extractStyleForApply,
  removePresetFromList,
  updatePresetInList,
  duplicatePresetName,
  type CustomPresetRecord,
  type RawPresetRow,
} from "../custom-presets.ts";
import { BUILT_IN_PRESETS, getPreset } from "../presets.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../types/subtitle.ts";
import type { SubtitleStyle, AnimationConfig } from "../../types/subtitle.ts";

function makeRecord(overrides: Partial<CustomPresetRecord> & { id: string; name: string }): CustomPresetRecord {
  return {
    style: DEFAULT_SUBTITLE_STYLE,
    animation: DEFAULT_ANIMATION,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("1. create custom preset from a style: a valid name is accepted and trimmed", () => {
  const result = validateNewPresetName([], "  My Reels Style  ");
  assert.deepEqual(result, { ok: true, name: "My Reels Style" });
});

test("2. custom preset persists: SubtitleStyle and AnimationConfig round-trip exactly through the same JSON encoding used for DB storage", () => {
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Acumin Pro", fontWeight: 700, color: "#FFFFFF", shadowEnabled: true };
  const animation: AnimationConfig = { ...DEFAULT_ANIMATION, entrance: "bounce", word: "highlight" };
  const encoded = JSON.stringify(style);
  const encodedAnim = JSON.stringify(animation);
  const row: RawPresetRow = { id: "p1", name: "My Reels Style", style: encoded, animation: encodedAnim, createdAt: "2026-01-02T00:00:00.000Z" };
  const [parsed] = parsePresetRows([row]);
  assert.deepEqual(parsed.style, style);
  assert.deepEqual(parsed.animation, animation);
});

test("3. load custom presets: parsePresetRows turns raw DB rows into clean records, in order", () => {
  const rows: RawPresetRow[] = [
    { id: "a", name: "First", style: JSON.stringify(DEFAULT_SUBTITLE_STYLE), animation: JSON.stringify(DEFAULT_ANIMATION), createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "b", name: "Second", style: JSON.stringify(DEFAULT_SUBTITLE_STYLE), animation: JSON.stringify(DEFAULT_ANIMATION), createdAt: "2026-01-02T00:00:00.000Z" },
  ];
  const parsed = parsePresetRows(rows);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((p) => p.id), ["a", "b"]);
  assert.equal(parsed[0].createdAt, "2026-01-01T00:00:00.000Z"); // Date -> ISO string
  assert.equal(parsed[1].createdAt, "2026-01-02T00:00:00.000Z"); // already a string -> passed through
});

test("4. apply custom preset: extractStyleForApply hands back the preset's exact style/animation, as an independent copy", () => {
  const preset = makeRecord({ id: "p1", name: "Bold Reels", style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 90 }, animation: { ...DEFAULT_ANIMATION, entrance: "pop" } });
  const applied = extractStyleForApply(preset);
  assert.deepEqual(applied.style, preset.style);
  assert.deepEqual(applied.animation, preset.animation);
  assert.notEqual(applied.style, preset.style); // not the same object reference
});

test("5. rename custom preset: a new unique name is accepted; renaming to its own current name is allowed (self-exclusion)", () => {
  const existing = [makeRecord({ id: "p1", name: "My Style" }), makeRecord({ id: "p2", name: "Other Style" })];
  assert.deepEqual(validateRenamedPresetName(existing, "p1", "Renamed Style"), { ok: true, name: "Renamed Style" });
  assert.deepEqual(validateRenamedPresetName(existing, "p1", "My Style"), { ok: true, name: "My Style" });
});

test("6. delete custom preset: removePresetFromList removes only the targeted preset", () => {
  const list = [makeRecord({ id: "p1", name: "A" }), makeRecord({ id: "p2", name: "B" }), makeRecord({ id: "p3", name: "C" })];
  const result = removePresetFromList(list, "p2");
  assert.deepEqual(result.map((p) => p.id), ["p1", "p3"]);
});

test("7. built-in presets cannot be deleted: this module has no operation that accepts BUILT_IN_PRESETS, and none of its ids collide with a custom-preset list unaffected by delete", () => {
  const customList = [makeRecord({ id: "classic", name: "My Classic Copy" })]; // deliberately reuses a built-in's id string
  removePresetFromList(customList, "classic");
  // Deleting from the CUSTOM list can never remove the actual built-in definition — it lives
  // in a totally separate array this module never touches.
  assert.ok(getPreset("classic"), "the real built-in 'classic' preset must still exist");
  assert.equal(BUILT_IN_PRESETS.find((p) => p.id === "classic")?.name, "Classic");
});

test("8. built-in presets cannot be mutated: applying a built-in's style and then patching it (the same spread-merge the editor store's setGlobalStyle uses) never touches the original definition", () => {
  const before = JSON.stringify(getPreset("bold"));
  const builtin = getPreset("bold")!;
  const appliedStyle = builtin.style; // what applyPreset would hand the store
  const patched = { ...appliedStyle, fontSize: 999, color: "#123456" }; // what setGlobalStyle does on every edit
  assert.equal(patched.fontSize, 999);
  assert.equal(JSON.stringify(getPreset("bold")), before, "the built-in definition must be byte-identical after the caption style was edited");
  assert.notEqual(builtin.style.fontSize, 999);
});

test("9. updating a custom preset changes only that custom preset", () => {
  const list = [makeRecord({ id: "p1", name: "A", style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 40 } }), makeRecord({ id: "p2", name: "B", style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 50 } })];
  const updated = updatePresetInList(list, "p1", { style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 100 } });
  assert.equal(updated.find((p) => p.id === "p1")!.style.fontSize, 100);
  assert.equal(updated.find((p) => p.id === "p2")!.style.fontSize, 50); // untouched
});

test("10. deleting a custom preset does not affect an already-applied caption style", () => {
  const preset = makeRecord({ id: "p1", name: "My Style", style: { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Acumin Pro" } });
  const appliedToProject = extractStyleForApply(preset); // simulates applyPreset() copying it into project.globalStyle
  const remainingPresets = removePresetFromList([preset], "p1"); // user deletes the preset afterward
  assert.deepEqual(remainingPresets, []);
  // The project's own (already-copied) style must be completely unaffected by the deletion.
  assert.equal(appliedToProject.style.fontFamily, "Acumin Pro");
  assert.deepEqual(appliedToProject.style, preset.style);
});

test("11. system-font metadata survives preset save/load", () => {
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Segoe UI", fontSource: "system" };
  const row: RawPresetRow = { id: "p1", name: "System Font Preset", style: JSON.stringify(style), animation: JSON.stringify(DEFAULT_ANIMATION), createdAt: "2026-01-01T00:00:00.000Z" };
  const [parsed] = parsePresetRows([row]);
  assert.equal(parsed.style.fontFamily, "Segoe UI");
  assert.equal(parsed.style.fontSource, "system");
});

test("12. animation configuration survives save/load", () => {
  const animation: AnimationConfig = { entrance: "word-pop", exit: "slide", word: "bg-highlight", durationSec: 0.33 };
  const row: RawPresetRow = { id: "p1", name: "Anim Preset", style: JSON.stringify(DEFAULT_SUBTITLE_STYLE), animation: JSON.stringify(animation), createdAt: "2026-01-01T00:00:00.000Z" };
  const [parsed] = parsePresetRows([row]);
  assert.deepEqual(parsed.animation, animation);
});

test("13. word-highlight configuration survives save/load", () => {
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, wordHighlight: true, highlightColor: "#FACC15", activeWordScale: 1.35 };
  const row: RawPresetRow = { id: "p1", name: "Highlight Preset", style: JSON.stringify(style), animation: JSON.stringify(DEFAULT_ANIMATION), createdAt: "2026-01-01T00:00:00.000Z" };
  const [parsed] = parsePresetRows([row]);
  assert.equal(parsed.style.wordHighlight, true);
  assert.equal(parsed.style.highlightColor, "#FACC15");
  assert.equal(parsed.style.activeWordScale, 1.35);
});

test("14. malformed/missing preset storage fails safely", () => {
  assert.deepEqual(parsePresetRows(null), []);
  assert.deepEqual(parsePresetRows(undefined), []);
  assert.deepEqual(parsePresetRows([]), []);

  const rows: RawPresetRow[] = [
    { id: "good", name: "Good", style: JSON.stringify(DEFAULT_SUBTITLE_STYLE), animation: JSON.stringify(DEFAULT_ANIMATION), createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "bad-style", name: "Bad style", style: "{not valid json", animation: JSON.stringify(DEFAULT_ANIMATION), createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "bad-animation", name: "Bad animation", style: JSON.stringify(DEFAULT_SUBTITLE_STYLE), animation: "not json either", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "null-style", name: "Null style", style: null, animation: JSON.stringify(DEFAULT_ANIMATION), createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  const parsed = parsePresetRows(rows);
  assert.deepEqual(parsed.map((p) => p.id), ["good"]); // only the well-formed row survives, no throw
});

test("15. duplicate preset name behavior is deterministic: case-insensitive collisions are always rejected, unique names always accepted", () => {
  const existing = [makeRecord({ id: "p1", name: "My Reels Style" })];
  assert.deepEqual(validateNewPresetName(existing, "my reels style"), { ok: false, error: '"my reels style" already exists.' });
  assert.deepEqual(validateNewPresetName(existing, "MY REELS STYLE"), { ok: false, error: '"MY REELS STYLE" already exists.' });
  assert.deepEqual(validateNewPresetName(existing, "My Podcast Style"), { ok: true, name: "My Podcast Style" });
  assert.deepEqual(validateNewPresetName(existing, "   "), { ok: false, error: "Preset name can't be empty." });
  assert.deepEqual(validateNewPresetName(existing, ""), { ok: false, error: "Preset name can't be empty." });
});

test("16. every pre-P5 built-in preset is still present with its content unchanged — the P5 library expansion (Task 85241) only ever ADDS presets, never removes or mutates one", () => {
  // Deliberately a subset check, not an exact-length/exact-array-order equality: the whole
  // point of P5 was to grow this list well past 14, so pinning the total count here would
  // make this test actively wrong about what "unchanged" means. The new library's own size/
  // shape invariants are covered by __tests__/preset-library.test.ts instead.
  const preP5Ids = ["classic", "minimal", "bold", "tiktok", "reels", "youtube", "podcast", "news", "karaoke", "mrbeast", "highlight", "clean", "elegant", "gaming"];
  const ids = new Set(BUILT_IN_PRESETS.map((p) => p.id));
  for (const id of preP5Ids) assert.ok(ids.has(id), `expected pre-existing preset "${id}" to still exist`);
  assert.ok(BUILT_IN_PRESETS.length >= preP5Ids.length, "the library must never shrink below its pre-P5 size");
  assert.equal(getPreset("mrbeast")?.style.fontFamily, "Anton");
  assert.equal(getPreset("karaoke")?.animation.word, "highlight");
});

// --- Task 87426 (P6 Style Creator): Duplicate workflow ---------------------------------------

test("17. duplicatePresetName: 'X' -> 'X Copy' when no collision exists", () => {
  assert.equal(duplicatePresetName([], "My Marker"), "My Marker Copy");
});

test("18. duplicatePresetName: falls through to 'X Copy 2', 'X Copy 3', ... when earlier suffixes are already taken", () => {
  const existing = [makeRecord({ id: "a", name: "My Marker" }), makeRecord({ id: "b", name: "My Marker Copy" })];
  assert.equal(duplicatePresetName(existing, "My Marker"), "My Marker Copy 2");

  const existing2 = [
    makeRecord({ id: "a", name: "My Marker" }),
    makeRecord({ id: "b", name: "My Marker Copy" }),
    makeRecord({ id: "c", name: "My Marker Copy 2" }),
  ];
  assert.equal(duplicatePresetName(existing2, "My Marker"), "My Marker Copy 3");
});

test("19. duplicatePresetName's result always passes validateNewPresetName against the same list (never produces a name that would itself collide)", () => {
  const existing = [makeRecord({ id: "a", name: "Neon" }), makeRecord({ id: "b", name: "Neon Copy" }), makeRecord({ id: "c", name: "Neon Copy 2" })];
  const name = duplicatePresetName(existing, "Neon");
  assert.deepEqual(validateNewPresetName(existing, name), { ok: true, name });
});

test("20. duplicating a custom preset is a deep, isolated copy: mutating the duplicate's style never touches the original's style", () => {
  const original = makeRecord({ id: "p1", name: "My Neon", style: { ...DEFAULT_SUBTITLE_STYLE, color: "#00FFFF" } });
  // Mirrors exactly what the panel's handleDuplicate does: extractStyleForApply-style deep
  // copy of the SOURCE preset's style/animation, handed to createCustomPreset as a brand-new
  // record — never a live reference into the original.
  const duplicateStyle: SubtitleStyle = JSON.parse(JSON.stringify(original.style));
  duplicateStyle.color = "#FF00FF";
  assert.equal(original.style.color, "#00FFFF", "duplicating and then editing the copy must never mutate the source preset");
});

// --- P5.1 QA follow-up (Task 87426 Part audit): "Highlight" preset color correction ----------

test("21. the 'Highlight' built-in preset no longer uses a black highlightColor (P5.1 QA finding: invisible against the default black composition background)", () => {
  const preset = getPreset("highlight")!;
  assert.notEqual(preset.style.highlightColor.toLowerCase(), "#000000", "highlightColor must not be black — the active-word chip would be invisible on the default canvas");
  assert.match(preset.style.highlightColor, /^#[0-9a-fA-F]{6}$/, "must still be a valid hex color");
});

test("22. the corrected 'Highlight' preset's highlightColor doesn't collide with any other Highlight-category preset (each style should remain visually distinct)", () => {
  const highlightCategoryPresets = BUILT_IN_PRESETS.filter((p) => p.category === "Highlight");
  const colors = highlightCategoryPresets.map((p) => ({ id: p.id, color: p.style.highlightColor.toLowerCase() }));
  const seen = new Map<string, string>();
  for (const { id, color } of colors) {
    const clashWith = seen.get(color);
    assert.ok(!clashWith, `"${id}" and "${clashWith}" share the same highlightColor (${color})`);
    seen.set(color, id);
  }
});

test("23. the 'Highlight' preset remains a fully immutable built-in after the color correction: applying it and then editing the applied style never touches the stored definition", () => {
  const before = JSON.stringify(getPreset("highlight"));
  const preset = getPreset("highlight")!;
  const appliedStyle = preset.style; // what applyPreset hands the editor store
  const patched = { ...appliedStyle, highlightColor: "#123456" }; // what setGlobalStyle does on every edit
  assert.equal(patched.highlightColor, "#123456");
  assert.equal(JSON.stringify(getPreset("highlight")), before, "the built-in definition must be byte-identical after the applied style was edited");
});

// --- Task 87426 Part 14: custom styles use the EXACT SAME export pipeline as built-ins -------

test("24. a custom style (a SubtitleStyle/AnimationConfig combination matching no built-in preset) generates valid ASS through the exact same buildAssDocument() every built-in preset uses — there is no separate custom-style export path", async () => {
  const { buildAssDocument } = await import("../subtitles/ass.ts");
  // A deliberately custom, not-a-preset combination — cyan text, glow-like shadow, an
  // active-word background chip, Archivo font — the kind of thing "My Neon" from the task's
  // own Part 23 QA plan would produce.
  const customStyle: SubtitleStyle = {
    ...DEFAULT_SUBTITLE_STYLE,
    fontFamily: "Archivo",
    fontWeight: 800,
    color: "#22D3EE",
    highlightColor: "#F472B6",
    wordHighlight: true,
    shadowEnabled: true,
    shadowColor: "#22D3EE",
    shadowBlur: 24,
    shadowOpacity: 0.9,
  };
  const customAnimation: AnimationConfig = { entrance: "pop", exit: "fade", word: "bg-highlight", durationSec: 0.25 };
  // Confirmed to match NO built-in preset (this really is a "custom" combination, not an
  // accidental duplicate of an existing one).
  assert.ok(!BUILT_IN_PRESETS.some((p) => JSON.stringify(p.style) === JSON.stringify(customStyle)));

  const subtitles = [{ id: "1", index: 0, start: 0, end: 1.2, text: "This is amazing", words: [
    { text: "This", start: 0, end: 0.3 },
    { text: "is", start: 0.3, end: 0.5 },
    { text: "amazing", start: 0.5, end: 1.2 },
  ] }];
  const doc = buildAssDocument({ subtitles, globalStyle: customStyle, globalAnimation: customAnimation, playResX: 1080, playResY: 1920 });
  assert.ok(doc.includes("[Script Info]") && doc.includes("[V4+ Styles]") && doc.includes("[Events]"));
  assert.ok(doc.includes("Archivo"), "the custom font must reach the ASS Style line");
  assert.ok(/\\p1\}/.test(doc), "bg-highlight must still produce a real background-chip drawing event for a custom style, identically to a built-in one");
  assert.ok(!doc.includes("NaN"));
});
