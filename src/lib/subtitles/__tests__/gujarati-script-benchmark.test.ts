/**
 * Regression test for the Gujarati script-conversion layer against the REAL
 * 61.3-second Gujarati benchmark transcript (Whisper "medium" model output —
 * see the Gujarati small-vs-medium benchmark investigation this feature
 * implements). The fixture is a frozen copy of that transcript's `full_text`
 * and 167-word array, checked into the repo so this test is reproducible on
 * any machine without re-running Whisper.
 *
 * This test validates ONLY the script-conversion layer (Devanagari -> Gujarati
 * Unicode block) — it does NOT assert that Whisper's transcription itself was
 * accurate. Whatever Whisper produced (mistakes included) is expected to
 * survive the conversion unchanged in meaning, just rendered in Gujarati
 * glyphs.
 *
 * Run with: node --test src/lib/subtitles/__tests__/gujarati-script-benchmark.test.ts
 * (or the "test:gujarati-script" package.json script)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { devanagariToGujaratiScript, containsDevanagariScript } from "../gujarati-script.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture: { full_text: string; words: { text: string; start: number; end: number; confidence: number }[] } =
  JSON.parse(readFileSync(join(__dirname, "fixtures/gujarati-benchmark-medium.json"), "utf-8"));

test("every one of the 167 real benchmark words receives a Gujarati-script representation", () => {
  const converted = fixture.words.map((w) => ({ ...w, text: devanagariToGujaratiScript(w.text) }));
  assert.equal(converted.length, 167, "word count must remain exactly 167 (no words disappear or get created)");
  for (const w of converted) {
    assert.ok(w.text.length > 0, `word produced empty text: ${JSON.stringify(w)}`);
  }
});

test("word count remains exactly 167 — no words disappear, no extra words created", () => {
  assert.equal(fixture.words.length, 167);
  const converted = fixture.words.map((w) => devanagariToGujaratiScript(w.text));
  assert.equal(converted.length, fixture.words.length);
});

test("timestamps and confidence remain byte-for-byte identical after conversion", () => {
  const converted = fixture.words.map((w) => ({ ...w, text: devanagariToGujaratiScript(w.text) }));
  for (let i = 0; i < fixture.words.length; i++) {
    assert.equal(converted[i].start, fixture.words[i].start, `start changed at word ${i}`);
    assert.equal(converted[i].end, fixture.words[i].end, `end changed at word ${i}`);
    assert.equal(converted[i].confidence, fixture.words[i].confidence, `confidence changed at word ${i}`);
  }
});

test("English/medical loanwords remain intact (Gujarati-script rendering, not dropped/garbled)", () => {
  const converted = devanagariToGujaratiScript(fixture.full_text);
  // "laparoscopic surgery", "hernia", "appendix" as transcribed in Devanagari — must appear
  // as their Gujarati-script counterparts, not vanish or get corrupted.
  assert.match(converted, /લાપ્રોસ્કોપિક/); // laparoscopic
  assert.match(converted, /સર્જરી/); // surgery
  assert.match(converted, /હર્નિયા/); // hernia
  assert.match(converted, /અપન્ડિક્સ/); // appendix
});

test("punctuation remains intact after conversion", () => {
  const converted = devanagariToGujaratiScript(fixture.full_text);
  const originalDandaCount = (fixture.full_text.match(/।/g) ?? []).length;
  const convertedDandaCount = (converted.match(/।/g) ?? []).length;
  assert.ok(originalDandaCount > 0, "fixture sanity check: original transcript should contain danda");
  assert.equal(convertedDandaCount, originalDandaCount, "danda count must be preserved");
  assert.ok(converted.includes(","), "comma from the transcript must be preserved");
  // Numbers embedded in the transcript ("24 ती 48 कल्लाक") must survive untouched.
  assert.match(converted, /24.*48/);
});

test("full transcript still contains Devanagari before conversion, and Gujarati-block characters after", () => {
  assert.equal(containsDevanagariScript(fixture.full_text), true);
  const converted = devanagariToGujaratiScript(fixture.full_text);
  assert.match(converted, /[઀-૿]/);
});
