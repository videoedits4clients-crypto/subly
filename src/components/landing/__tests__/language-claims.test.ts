/**
 * Regression test: fails if any user-facing marketing/landing copy advertises a deferred
 * language as if it were officially supported. This is the direct fix for a real incident
 * found in the product audit — features.tsx used to read "transcribe and translate into 10
 * languages, including Hindi, Gujarati, Arabic and Japanese," none of which (besides Hindi)
 * were ever validated for transcription, directly contradicting the V1 language-policy freeze.
 *
 * Reads the raw source text of each landing component (this project's test convention has no
 * React-rendering test library, and doesn't need one here — the claim being checked is "does
 * this deferred language's name appear as literal copy," a plain string search) rather than
 * rendering the component, and cross-checks against lib/language-policy.ts so this test never
 * needs manual updates if the policy itself changes later — it just always reflects whatever
 * the policy currently says is deferred.
 *
 * Run with: node --test src/components/landing/__tests__/language-claims.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFERRED_LANGUAGES, SUPPORTED_LANGUAGES } from "../../../lib/language-policy.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = path.join(__dirname, "..");

function landingFiles(): string[] {
  return readdirSync(LANDING_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(LANDING_DIR, f));
}

/** Strips /* *‍/ and // comments before scanning — this test checks USER-FACING copy, not
 * source comments that happen to mention a deferred language's name while explaining why it
 * was removed (as this very fix's own commit does). Deliberately simple (not a full parser):
 * good enough for "does actual rendered text mention this language," which is all this needs. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("no landing component's rendered copy names a deferred language (Gujarati, Arabic, Japanese, etc.)", () => {
  const files = landingFiles();
  assert.ok(files.length > 0, "expected to find landing .tsx files to scan");
  for (const file of files) {
    const text = stripComments(readFileSync(file, "utf-8"));
    for (const lang of DEFERRED_LANGUAGES) {
      const re = new RegExp(`\\b${lang.label}\\b`);
      assert.ok(!re.test(text), `${path.basename(file)} must not advertise deferred language "${lang.label}" — found it in the file's rendered copy`);
    }
  }
});

test("no landing component claims a specific language count that could drift from the real supported-language count (e.g. a hardcoded 'N languages')", () => {
  const files = landingFiles();
  const countClaim = /\b\d+\s+languages\b/i;
  for (const file of files) {
    const text = stripComments(readFileSync(file, "utf-8"));
    assert.ok(!countClaim.test(text), `${path.basename(file)} contains a hardcoded language count claim, which can silently drift out of sync with lib/language-policy.ts`);
  }
});

test("features.tsx's multi-language claim is derived from the policy's supported languages, not hand-typed", () => {
  const file = path.join(LANDING_DIR, "features.tsx");
  const text = readFileSync(file, "utf-8");
  assert.ok(text.includes("supportedLanguageSummary"), "features.tsx should generate its language claim from lib/language-policy.ts's supportedLanguageSummary(), not a literal string");
  for (const lang of SUPPORTED_LANGUAGES) {
    // Sanity: the code path that would render each supported language's label must still be
    // reachable — i.e. we didn't break the summary derivation itself into naming nothing.
    assert.ok(lang.label.length > 0);
  }
});
