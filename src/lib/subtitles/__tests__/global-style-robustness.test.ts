/**
 * Regression tests for the P3 backend-hardening fix (Task 58314): a malformed raw PATCH that
 * replaces a project's entire `globalStyle` with a partial object (e.g. `{ fontFamily, fontSize }`)
 * could previously reach export and crash lib/subtitles/ass.ts's assColorWithAlpha()
 * (`hex.trim()` on `undefined`) — confirmed unreachable through the real Style panel UI (which
 * always sends a complete object), but reachable through the raw API. See:
 *   - types/subtitle.ts's resolveGlobalStyle() — fills any missing field from
 *     DEFAULT_SUBTITLE_STYLE, the one canonical source of truth, mirroring the existing
 *     resolveTimingRules/resolveComposition pattern.
 *   - lib/global-style-validation.ts's globalStyleSchema — rejects a wrong-TYPED field (not a
 *     missing one) at the API boundary (PATCH /api/projects/:id), before it's ever persisted.
 *
 * ass.ts itself is intentionally NOT modified — these tests prove the boundary fix stops
 * malformed data from ever reaching it, not that the renderer became tolerant of it.
 *
 * Run with: node --test src/lib/subtitles/__tests__/global-style-robustness.test.ts
 * (or the "test:global-style-robustness" package.json script)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveGlobalStyle, DEFAULT_SUBTITLE_STYLE } from "../../../types/subtitle.ts";
import type { SubtitleStyle, Subtitle } from "../../../types/subtitle.ts";
import { buildAssDocument } from "../ass.ts";
import { globalStyleSchema } from "../../global-style-validation.ts";

const SAMPLE_SUBTITLES: Subtitle[] = [{ id: "1", index: 0, start: 0, end: 1, text: "hi", words: [{ text: "hi", start: 0, end: 1 }] }];
const SAMPLE_ANIMATION = { entrance: "fade" as const, exit: "none" as const, word: "highlight" as const, durationSec: 0.2 };

function buildDoc(globalStyle: SubtitleStyle) {
  return buildAssDocument({ subtitles: SAMPLE_SUBTITLES, globalStyle, globalAnimation: SAMPLE_ANIMATION, playResX: 1080, playResY: 1920 });
}

// --- resolveGlobalStyle: complete valid globalStyle --------------------------------------

test("1. resolveGlobalStyle leaves a complete, valid globalStyle effectively unchanged", () => {
  const complete: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Montserrat", color: "#123456", fontSize: 88 };
  const resolved = resolveGlobalStyle(complete);
  assert.deepEqual(resolved, complete);
});

// --- resolveGlobalStyle: missing color field ----------------------------------------------

test("2. resolveGlobalStyle fills a single missing field (color) from DEFAULT_SUBTITLE_STYLE, preserving everything else present", () => {
  const withoutColor: Partial<SubtitleStyle> = { ...DEFAULT_SUBTITLE_STYLE };
  delete withoutColor.color;
  const partial = { ...withoutColor, fontFamily: "Poppins" };
  const resolved = resolveGlobalStyle(partial);
  assert.equal(resolved.color, DEFAULT_SUBTITLE_STYLE.color);
  assert.equal(resolved.fontFamily, "Poppins");
  assert.equal(resolved.fontSize, DEFAULT_SUBTITLE_STYLE.fontSize);
});

// --- resolveGlobalStyle: missing multiple fields ------------------------------------------

test("3. resolveGlobalStyle fills every missing field when only a couple of fields are present — reproduces the exact real-world malformed payload", () => {
  const malformed = { fontFamily: "Montserrat", fontSize: 70 };
  const resolved = resolveGlobalStyle(malformed);
  assert.equal(resolved.fontFamily, "Montserrat");
  assert.equal(resolved.fontSize, 70);
  // Every other field must be present and match the canonical default — not invented.
  assert.equal(resolved.color, DEFAULT_SUBTITLE_STYLE.color);
  assert.equal(resolved.backgroundColor, DEFAULT_SUBTITLE_STYLE.backgroundColor);
  assert.equal(resolved.outlineColor, DEFAULT_SUBTITLE_STYLE.outlineColor);
  assert.equal(resolved.shadowColor, DEFAULT_SUBTITLE_STYLE.shadowColor);
  assert.equal(resolved.highlightColor, DEFAULT_SUBTITLE_STYLE.highlightColor);
  assert.equal(Object.keys(resolved).length, Object.keys(DEFAULT_SUBTITLE_STYLE).length);
});

// --- resolveGlobalStyle: null/undefined malformed field -----------------------------------

test("4. resolveGlobalStyle(undefined) and resolveGlobalStyle(null) both return exactly DEFAULT_SUBTITLE_STYLE", () => {
  assert.deepEqual(resolveGlobalStyle(undefined), DEFAULT_SUBTITLE_STYLE);
  assert.deepEqual(resolveGlobalStyle(null), DEFAULT_SUBTITLE_STYLE);
});

// --- globalStyleSchema: malformed raw PATCH -----------------------------------------------

test("5. globalStyleSchema accepts a partial-but-correctly-typed object (the real malformed-PATCH shape) — missing fields are not themselves an error", () => {
  const result = globalStyleSchema.safeParse({ fontFamily: "Montserrat", fontSize: 70 });
  assert.equal(result.success, true);
});

test("6. globalStyleSchema rejects a wrong-typed known field (color as a number) — this is what 'fundamentally invalid' means here", () => {
  const result = globalStyleSchema.safeParse({ fontFamily: "Inter", color: 123 });
  assert.equal(result.success, false);
});

test("7. globalStyleSchema rejects a non-object payload outright (a raw malformed PATCH body)", () => {
  assert.equal(globalStyleSchema.safeParse("not-an-object").success, false);
  assert.equal(globalStyleSchema.safeParse(42).success, false);
  assert.equal(globalStyleSchema.safeParse(null).success, false);
});

test("8. globalStyleSchema rejects a wrong-typed enum field (align as an arbitrary string)", () => {
  const result = globalStyleSchema.safeParse({ align: "middle" });
  assert.equal(result.success, false);
});

// --- export path with normalized style ----------------------------------------------------

test("9. buildAssDocument still crashes on a raw, un-normalized malformed globalStyle — proves the renderer itself was intentionally NOT changed", () => {
  const malformed = { fontFamily: "Montserrat", fontSize: 70 } as unknown as SubtitleStyle;
  assert.throws(() => buildDoc(malformed), /Cannot read properties of undefined/);
});

test("10. buildAssDocument succeeds once the same malformed globalStyle is passed through resolveGlobalStyle first — the actual fix in effect on the export path", () => {
  const malformed = { fontFamily: "Montserrat", fontSize: 70 };
  const normalized = resolveGlobalStyle(malformed);
  const doc = buildDoc(normalized);
  assert.ok(doc.includes("Montserrat"), "the submitted fontFamily must survive normalization into the ASS output");
  assert.ok(doc.length > 0);
});

// --- existing valid style regression -------------------------------------------------------

test("11. a complete, valid globalStyle produces an unaffected ASS document — the fix changes nothing for already-valid data", () => {
  const complete: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Roboto", color: "#EEEEEE" };
  const docDirect = buildDoc(complete);
  const docViaResolve = buildDoc(resolveGlobalStyle(complete));
  assert.equal(docDirect, docViaResolve);
});
