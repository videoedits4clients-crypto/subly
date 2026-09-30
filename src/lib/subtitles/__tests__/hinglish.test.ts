/**
 * Automated tests for the Hinglish (Romanized Hindi) transliteration engine.
 *
 * Run with: node --test src/lib/subtitles/__tests__/hinglish.test.ts
 * (or the "test:hinglish" package.json script)
 *
 * Deliberately uses Node's own built-in test runner (`node:test`/`node:assert`)
 * rather than adding a testing framework as a new dependency — this project has
 * no test runner configured at all, and the Hinglish feature's own hard
 * requirement is "no new external dependency", so the test suite for it holds
 * itself to the same bar.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { transliterateToHinglish, transliterateWord } from "../hinglish.ts";

test("7 official ground-truth examples", () => {
  const cases: [string, string][] = [
    ["बहुत अच्छी है", "Bahut achhi hai"],
    ["मुझे ये बहुत पसंद है।", "Mujhe ye bahut pasand hai."],
    ["ये product बहुत comfortable है।", "Ye product bahut comfortable hai."],
    ["आज सिर्फ ₹999 है 🔥", "Aaj sirf ₹999 hai 🔥"],
    ["आप लोग comment करके बताना।", "Aap log comment karke batana."],
    ["क्या आपको ये पसंद आया?", "Kya aapko ye pasand aaya?"],
    [
      "ये product बहुत comfortable है और इसका fabric बहुत अच्छा है।",
      "Ye product bahut comfortable hai aur iska fabric bahut achha hai.",
    ],
  ];
  for (const [input, expected] of cases) {
    assert.equal(transliterateToHinglish(input), expected, `input: ${input}`);
  }
});

test("common casual speech sentences", () => {
  const cases: [string, string][] = [
    ["मैं घर जा रहा हूँ", "Main ghar ja raha hoon"],
    ["तुम कहाँ जा रहे हो?", "Tum kahan ja rahe ho?"],
    ["मुझे नहीं पता", "Mujhe nahi pata"],
    ["क्या कर रहे हो?", "Kya kar rahe ho?"],
    ["अभी आता हूँ", "Abhi aata hoon"],
    ["बहुत अच्छा लग रहा है", "Bahut achha lag raha hai"],
    ["मुझे समझ नहीं आया", "Mujhe samajh nahi aaya"],
    ["आपने खाना खाया?", "Aapne khaana khaaya?"],
    ["कल मिलते हैं", "Kal milte hain"],
    ["यह बहुत अच्छा है", "Yeh bahut achha hai"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(transliterateToHinglish(input), expected, `input: ${input}`);
  }
});

test("harder words — irregular/nukta cases the rule engine alone can't get naturally right", () => {
  const cases: [string, string][] = [
    ["समझा", "samjha"],
    ["समझना", "samajhna"],
    ["पानी", "paani"],
    ["कहानी", "kahaani"],
    ["ज़्यादा", "zyada"],
    ["ज़रूरी", "zaroori"],
    ["फ़ोन", "phone"],
    ["लड़की", "ladki"],
    ["लड़का", "ladka"],
    ["बढ़िया", "badhiya"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(transliterateWord(input), expected, `word: ${input}`);
  }
});

test("mixed Hindi/English creator speech", () => {
  const cases: [string, string][] = [
    ["तो आज हम इस product को try करने वाले हैं", "To aaj hum is product ko try karne wale hain"],
    ["अगर आपको ये video पसंद आए तो like करना", "Agar aapko ye video pasand aaye to like karna"],
    ["मैं आपको पूरा process बताता हूँ", "Main aapko poora process batata hoon"],
    ["इसका fabric बहुत comfortable है", "Iska fabric bahut comfortable hai"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(transliterateToHinglish(input), expected, `input: ${input}`);
  }
});

test("preserves English words unchanged", () => {
  const out = transliterateToHinglish("ये product बहुत comfortable है");
  assert.match(out, /\bproduct\b/);
  assert.match(out, /\bcomfortable\b/);
});

test("preserves numbers and currency unchanged", () => {
  assert.match(transliterateToHinglish("आज सिर्फ ₹999 है"), /₹999/);
  assert.match(transliterateToHinglish("100% सही बात है"), /100%/);
});

test("preserves URLs and email addresses unchanged", () => {
  const out = transliterateToHinglish("मेरा email है test@example.com और site www.example.com पर जाओ");
  assert.match(out, /test@example\.com/);
  assert.match(out, /www\.example\.com/);
});

test("preserves hashtags and @mentions unchanged", () => {
  const out = transliterateToHinglish("#trending पर 100% सही बात है @user को बताओ");
  assert.match(out, /#[Tt]rending/); // only the leading letter's case is affected by whole-string capitalization
  assert.match(out, /@user/);
});

test("preserves emoji unchanged", () => {
  assert.match(transliterateToHinglish("आज सिर्फ ₹999 है 🔥"), /🔥/);
});

test("preserves punctuation (danda -> period, question mark, etc.)", () => {
  assert.equal(transliterateToHinglish("क्या आपको ये पसंद आया?"), "Kya aapko ye pasand aaya?");
  assert.equal(transliterateToHinglish("मुझे ये बहुत पसंद है।").endsWith("."), true);
});

test("non-Devanagari text passes through completely untouched", () => {
  assert.equal(transliterateToHinglish("Just plain English text."), "Just plain English text.");
});
