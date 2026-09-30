/**
 * Regression tests for the single authoritative V1 transcription-language policy
 * (src/lib/language-policy.ts) — the fix for the product audit's P0 findings that the
 * transcription-language picker and marketing copy both claimed support for languages this
 * project never validated (Gujarati, Marathi, Bengali, Tamil, Telugu, Punjabi, Urdu, Spanish,
 * French, German, Portuguese, Arabic, Japanese, Korean).
 *
 * Run with: node --test src/lib/__tests__/language-policy.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LANGUAGE_POLICY,
  SUPPORTED_LANGUAGES,
  DEFERRED_LANGUAGES,
  isLanguageSupported,
  isKnownLanguageCode,
  isValidTranscriptionLanguageRequest,
  TRANSCRIPTION_LANGUAGE_POLICY_OPTIONS,
  supportedLanguageSummary,
} from "../language-policy.ts";
import { TRANSCRIPTION_LANGUAGE_OPTIONS, LANGUAGES } from "../../types/subtitle.ts";

test("the final V1 supported-language list is exactly English and Hindi", () => {
  assert.deepEqual(
    SUPPORTED_LANGUAGES.map((l) => l.code).sort(),
    ["en", "hi"],
  );
});

test("every officially supported language is accepted by isValidTranscriptionLanguageRequest", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(isValidTranscriptionLanguageRequest(lang.code), true, `expected "${lang.code}" (${lang.label}) to be accepted`);
    assert.equal(isLanguageSupported(lang.code), true);
  }
});

test("every deferred language is rejected by isValidTranscriptionLanguageRequest (Gujarati included)", () => {
  assert.ok(DEFERRED_LANGUAGES.some((l) => l.code === "gu"), "Gujarati must be present in the policy as deferred, not absent");
  for (const lang of DEFERRED_LANGUAGES) {
    assert.equal(isValidTranscriptionLanguageRequest(lang.code), false, `expected "${lang.code}" (${lang.label}) to be rejected`);
    assert.equal(isLanguageSupported(lang.code), false);
  }
});

test("Auto Detect is always a valid transcription request", () => {
  assert.equal(isValidTranscriptionLanguageRequest("auto"), true);
});

test("an unknown/invalid language code is rejected, not silently accepted", () => {
  assert.equal(isValidTranscriptionLanguageRequest("xx"), false);
  assert.equal(isValidTranscriptionLanguageRequest(""), false);
  assert.equal(isValidTranscriptionLanguageRequest("not-a-language"), false);
  assert.equal(isKnownLanguageCode("xx"), false);
});

test("the pre-transcription picker offers Auto Detect plus only the supported languages — no deferred language ever appears", () => {
  const codes = TRANSCRIPTION_LANGUAGE_POLICY_OPTIONS.map((o) => o.code);
  assert.deepEqual(codes, ["auto", "en", "hi"]);
  for (const deferred of DEFERRED_LANGUAGES) {
    assert.ok(!codes.includes(deferred.code), `deferred language "${deferred.code}" must not appear in the picker`);
  }
});

test("types/subtitle.ts's TRANSCRIPTION_LANGUAGE_OPTIONS re-export matches the policy exactly (single source of truth, not a drifted copy)", () => {
  assert.deepEqual(TRANSCRIPTION_LANGUAGE_OPTIONS, TRANSCRIPTION_LANGUAGE_POLICY_OPTIONS);
});

test("supportedLanguageSummary() names only supported languages, never a deferred one", () => {
  const summary = supportedLanguageSummary();
  assert.equal(summary, "English and Hindi");
  for (const deferred of DEFERRED_LANGUAGES) {
    assert.ok(!summary.includes(deferred.label), `summary must not mention deferred language "${deferred.label}": got "${summary}"`);
  }
});

test("the full language catalog (types/subtitle.ts LANGUAGES, used for translate targets/labels) still contains every policy entry — the policy restricts TRANSCRIPTION selection only, not the separate translate-target catalog", () => {
  const catalogCodes = new Set<string>(LANGUAGES.map((l) => l.code));
  for (const entry of LANGUAGE_POLICY) {
    assert.ok(catalogCodes.has(entry.code), `policy code "${entry.code}" should still exist in the full language catalog`);
  }
});
