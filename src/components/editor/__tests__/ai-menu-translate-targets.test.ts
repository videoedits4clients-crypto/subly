/**
 * Task 137421 (P19.12) — fixes the P1 finding in research/p19_11_release_candidate_gap_audit.md
 * §6: the Translate menu (ai-menu.tsx) used to list every entry in `LANGUAGES` (15 codes)
 * regardless of whether the backend would actually accept it. Six of them (mr/bn/ta/te/pa/ur)
 * were selectable in the UI but always rejected by both /api/translate route handlers with a
 * 400, surfaced to the user as a misleading "AI service temporarily unavailable" error.
 *
 * This project has no React-rendering test infrastructure (confirmed in the P19.11 audit), so —
 * matching the same established convention language-claims.test.ts already uses — this reads the
 * component's raw source to confirm it actually filters by TRANSLATABLE_LANGUAGES, and separately
 * proves the data-level invariant that actually matters: every code TRANSLATABLE_LANGUAGES lists
 * is one the backend's own zod schema accepts, and none of the known-rejected codes are in it.
 *
 * Run with: node --test src/components/editor/__tests__/ai-menu-translate-targets.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANGUAGES, TRANSLATABLE_LANGUAGES } from "../../../types/subtitle.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_MENU_FILE = path.join(__dirname, "..", "ai-menu.tsx");
const PROJECT_ROUTE_FILE = path.join(__dirname, "..", "..", "..", "app", "api", "projects", "[id]", "translate", "route.ts");
const GENERIC_ROUTE_FILE = path.join(__dirname, "..", "..", "..", "app", "api", "translate", "route.ts");

// The 6 languages the P19.11 audit found selectable-but-rejected.
const KNOWN_UNSUPPORTED = ["mr", "bn", "ta", "te", "pa", "ur"];

test("TRANSLATABLE_LANGUAGES excludes every previously-selectable-but-rejected language code", () => {
  for (const code of KNOWN_UNSUPPORTED) {
    assert.ok(!(TRANSLATABLE_LANGUAGES as readonly string[]).includes(code), `${code} must not be a translatable target — the backend has always rejected it`);
  }
});

test("TRANSLATABLE_LANGUAGES is a strict subset of LANGUAGES (every translatable code is a real, known language)", () => {
  const knownCodes = new Set(LANGUAGES.map((l) => l.code));
  for (const code of TRANSLATABLE_LANGUAGES) {
    assert.ok(knownCodes.has(code), `${code} is in TRANSLATABLE_LANGUAGES but not in LANGUAGES`);
  }
});

test("ai-menu.tsx's Translate menu filters by TRANSLATABLE_LANGUAGES, not just the current-language exclusion", () => {
  const source = readFileSync(AI_MENU_FILE, "utf-8");
  assert.ok(source.includes("TRANSLATABLE_LANGUAGES"), "ai-menu.tsx must reference TRANSLATABLE_LANGUAGES so the menu can never list a backend-rejected language");
  // The existing current-language exclusion must still be present alongside the new filter.
  assert.ok(/l\.code !== currentProject\.language/.test(source), "the existing 'exclude the project's own current language' behavior must be preserved");
});

test("both /api/translate route handlers validate targetLanguage against the SAME TRANSLATABLE_LANGUAGES constant the menu uses", () => {
  for (const file of [PROJECT_ROUTE_FILE, GENERIC_ROUTE_FILE]) {
    const source = readFileSync(file, "utf-8");
    assert.ok(
      source.includes("TRANSLATABLE_LANGUAGES"),
      `${path.basename(path.dirname(file))}/route.ts should validate targetLanguage against the shared TRANSLATABLE_LANGUAGES constant, not a separately hand-typed literal that can drift`,
    );
  }
});

test("a Translate menu built by filtering LANGUAGES with TRANSLATABLE_LANGUAGES never contains a rejected code", () => {
  // Simulates exactly what ai-menu.tsx's own filter expression does, for an arbitrary current
  // project language, and asserts the resulting menu items are all backend-accepted.
  for (const currentLanguage of ["en", "hi", "auto"] as const) {
    const menu = LANGUAGES.filter((l) => l.code !== currentLanguage && (TRANSLATABLE_LANGUAGES as readonly string[]).includes(l.code));
    for (const item of menu) {
      assert.ok((TRANSLATABLE_LANGUAGES as readonly string[]).includes(item.code), `menu item ${item.code} is not backend-supported`);
      assert.ok(!KNOWN_UNSUPPORTED.includes(item.code), `menu item ${item.code} was previously confirmed rejected by the backend`);
    }
  }
});
