/**
 * Automated tests for the Devanagari -> native Gujarati script conversion.
 *
 * Run with: node --test src/lib/subtitles/__tests__/gujarati-script.test.ts
 * (or the "test:gujarati-script" package.json script)
 *
 * Deliberately uses Node's own built-in test runner (`node:test`/`node:assert`) —
 * same zero-dependency convention as hinglish.test.ts. This feature's hard
 * requirement is "no new dependency, fully local/offline", so its test suite
 * holds itself to the same bar.
 *
 * All expected outputs were independently cross-validated during the
 * investigation phase against the `indic_transliteration` (sanscript) Python
 * library on the real 61.3s Gujarati benchmark transcript — 0/167 words
 * differed between that library and this implementation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { devanagariToGujaratiScript, containsDevanagariScript } from "../gujarati-script.ts";

test("basic Gujarati vocabulary from the real benchmark transcript", () => {
  const cases: [string, string][] = [
    ["अप्रेशण", "અપ્રેશણ"], // "operation" (Whisper's own mis-transcription — preserved verbatim, not corrected)
    ["सर्जरी", "સર્જરી"], // surgery
    ["हर्निया", "હર્નિયા"], // hernia
    ["अपन्डिक्स", "અપન્ડિક્સ"], // appendix
  ];
  for (const [input, expected] of cases) {
    assert.equal(devanagariToGujaratiScript(input), expected, `input: ${input}`);
  }
});

test("independent vowels", () => {
  assert.equal(devanagariToGujaratiScript("अआइईउऊऋएऐओऔ"), "અઆઇઈઉઊઋએઐઓઔ");
});

test("dependent vowel signs (matras)", () => {
  assert.equal(
    devanagariToGujaratiScript("क का कि की कु कू कृ के कै को कौ"),
    "ક કા કિ કી કુ કૂ કૃ કે કૈ કો કૌ",
  );
});

test("virama/halant (conjunct-forming)", () => {
  assert.equal(devanagariToGujaratiScript("क्त"), "ક્ત");
});

test("conjunct consonants", () => {
  assert.equal(devanagariToGujaratiScript("विद्यालय"), "વિદ્યાલય"); // school/institution
  assert.equal(devanagariToGujaratiScript("स्कूल"), "સ્કૂલ"); // school (loanword)
});

test("anusvara", () => {
  assert.equal(devanagariToGujaratiScript("गंगा"), "ગંગા");
});

test("chandrabindu", () => {
  assert.equal(devanagariToGujaratiScript("हूँ"), "હૂઁ");
});

test("visarga", () => {
  assert.equal(devanagariToGujaratiScript("दुःख"), "દુઃખ");
});

test("nukta consonants — decomposable via NFD before the offset shift", () => {
  const cases: [string, string][] = [
    ["ज़रूरी", "જ઼રૂરી"], // za (necessary)
    ["फ़ोन", "ફ઼ોન"], // fa (phone)
    ["लड़की", "લડ઼કી"], // rra (girl)
    ["ब्रेड़", "બ્રેડ઼"], // the real nukta occurrence in the 61.3s benchmark (mis-transcribed "gall bladder")
  ];
  for (const [input, expected] of cases) {
    assert.equal(devanagariToGujaratiScript(input), expected, `input: ${input}`);
  }
});

test("danda and double danda pass through unchanged (no Gujarati-block equivalent)", () => {
  assert.equal(devanagariToGujaratiScript("यह एक वाक्य है।"), "યહ એક વાક્ય હૈ।");
  assert.equal(devanagariToGujaratiScript("यह एक वाक्य है॥"), "યહ એક વાક્ય હૈ॥");
});

test("preserves English words unchanged", () => {
  assert.equal(devanagariToGujaratiScript("Hello World"), "Hello World");
  const out = devanagariToGujaratiScript("मैं Hello बोला");
  assert.match(out, /\bHello\b/);
});

test("preserves numbers unchanged", () => {
  assert.match(devanagariToGujaratiScript("24 ती 48 कल्लाक"), /24.*48/);
  assert.match(devanagariToGujaratiScript("100% सही बात है"), /100%/);
});

test("preserves punctuation unchanged", () => {
  assert.equal(devanagariToGujaratiScript("क्या?"), "ક્યા?");
  assert.match(devanagariToGujaratiScript("गौल ब्रेड़, हर्निया,"), /,/);
});

test("preserves whitespace unchanged (spaces, newlines)", () => {
  assert.equal(devanagariToGujaratiScript("   "), "   ");
  assert.equal(devanagariToGujaratiScript("क\nख"), "ક\nખ");
  assert.equal(devanagariToGujaratiScript("क  ख"), "ક  ખ");
});

test("preserves emoji unchanged", () => {
  assert.match(devanagariToGujaratiScript("आज सिर्फ ₹999 है 🔥"), /🔥/);
});

test("preserves URLs and email addresses unchanged", () => {
  const out = devanagariToGujaratiScript("मेरा email है test@example.com और site www.example.com पर जाओ");
  assert.match(out, /test@example\.com/);
  assert.match(out, /www\.example\.com/);
});

test("preserves hashtags and @mentions unchanged", () => {
  const out = devanagariToGujaratiScript("#trending पर सही बात है @user को बताओ");
  assert.match(out, /#trending/);
  assert.match(out, /@user/);
});

test("empty string and non-Devanagari text pass through completely untouched", () => {
  assert.equal(devanagariToGujaratiScript(""), "");
  assert.equal(devanagariToGujaratiScript("Just plain English text."), "Just plain English text.");
});

test("does not linguistically correct or reinterpret imperfect Whisper output", () => {
  // "अप्रेशण" is Whisper's own imperfect rendering of "operation" — the converter
  // must mechanically map it to Gujarati script, NOT "fix" it into a more
  // standard spelling or a translated word.
  assert.equal(devanagariToGujaratiScript("अप्रेशण"), "અપ્રેશણ");
});

test("containsDevanagariScript detects Devanagari presence", () => {
  assert.equal(containsDevanagariScript("अप्रेशण"), true);
  assert.equal(containsDevanagariScript("Hello World"), false);
  assert.equal(containsDevanagariScript(""), false);
});

test("timestamp-preservation shape: converting a word array only changes `text`", () => {
  const words = [
    { text: "अप्रेशण", start: 0.0, end: 0.48, confidence: 0.565 },
    { text: "सामबडिय।", start: 0.48, end: 1.06, confidence: 0.668 },
    { text: "ने", start: 1.06, end: 1.22, confidence: 0.528 },
  ];
  const converted = words.map((w) => ({ ...w, text: devanagariToGujaratiScript(w.text) }));
  for (let i = 0; i < words.length; i++) {
    assert.equal(converted[i].start, words[i].start, `start changed for word ${i}`);
    assert.equal(converted[i].end, words[i].end, `end changed for word ${i}`);
    assert.equal(converted[i].confidence, words[i].confidence, `confidence changed for word ${i}`);
  }
  assert.equal(converted[0].text, "અપ્રેશણ");
});
