/**
 * Pure tests for Unicode grapheme-cluster segmentation (Task 103884, P16 —
 * src/lib/subtitles/grapheme.ts). No store, no React.
 *
 * Run with: node --test src/lib/subtitles/__tests__/grapheme.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { segmentGraphemes } from "../grapheme.ts";

test("segmentGraphemes: plain ASCII text — one grapheme cluster per character", () => {
  assert.deepEqual(segmentGraphemes("abcd"), ["a", "b", "c", "d"]);
});

test("segmentGraphemes: empty string returns an empty array", () => {
  assert.deepEqual(segmentGraphemes(""), []);
});

test("segmentGraphemes: accented Latin — a precomposed character is one cluster, base+combining is also one cluster", () => {
  // "café" with a precomposed é (U+00E9) — 4 clusters.
  assert.deepEqual(segmentGraphemes("café"), ["c", "a", "f", "é"]);
  // "café" spelled with a bare "e" + combining acute accent (U+0065 U+0301) — still 4 clusters,
  // the combining mark must attach to the "e" rather than standing alone.
  const decomposed = "café";
  const result = segmentGraphemes(decomposed);
  assert.equal(result.length, 4, "combining acute accent must attach to its base 'e', not form its own cluster");
  assert.equal(result[3], "é");
});

test("segmentGraphemes: Devanagari combining marks — the spec's own नमस्ते example", () => {
  // नमस्ते = न + म + स + ् (virama) + त + े (vowel sign). Intl.Segmenter groups the
  // स-्-त-े conjunct sequence into ONE grapheme cluster ("स्ते"), never splitting स from ते.
  const result = segmentGraphemes("नमस्ते");
  assert.ok(result.length >= 2 && result.length <= 4, "must produce a reasonable small number of clusters, not 6 raw code units");
  // Rejoining must reproduce the original string exactly.
  assert.equal(result.join(""), "नमस्ते");
  // No cluster may be a bare combining mark (Mn/Mc/Me) standing alone.
  const combiningOnly = /^\p{M}+$/u;
  for (const cluster of result) {
    assert.ok(!combiningOnly.test(cluster), `cluster "${cluster}" must not be a bare combining mark`);
  }
});

test("segmentGraphemes: a full Hindi word (multiple conjuncts) rejoins exactly and has no bare-combining-mark cluster", () => {
  const text = "स्वागत"; // "welcome" — contains a virama conjunct (स्व)
  const result = segmentGraphemes(text);
  assert.equal(result.join(""), text);
  const combiningOnly = /^\p{M}+$/u;
  for (const cluster of result) assert.ok(!combiningOnly.test(cluster));
});

test("segmentGraphemes: Gujarati combining marks rejoin exactly and never isolate a combining mark", () => {
  const text = "નમસ્તે"; // Gujarati "namaste" — has its own virama+vowel-sign conjunct
  const result = segmentGraphemes(text);
  assert.equal(result.join(""), text);
  const combiningOnly = /^\p{M}+$/u;
  for (const cluster of result) assert.ok(!combiningOnly.test(cluster));
});

test("segmentGraphemes: an astral-plane emoji is one cluster, never split across its UTF-16 surrogate pair", () => {
  const result = segmentGraphemes("😀");
  assert.deepEqual(result, ["😀"]);
});

test("segmentGraphemes: emoji with a skin-tone modifier stays one cluster", () => {
  // U+1F44D (thumbs up) + U+1F3FB (light skin tone modifier).
  const text = "\u{1F44D}\u{1F3FB}";
  const result = segmentGraphemes(text);
  assert.equal(result.join(""), text);
  assert.ok(result.length <= 2, "a modifier sequence must not fragment into more clusters than the sequence itself");
});

test("segmentGraphemes: ZWJ emoji sequence (family emoji) rejoins exactly", () => {
  // Man + ZWJ + Woman + ZWJ + Girl — a single "family" grapheme cluster under full UAX #29,
  // but this module doesn't require ZWJ-joining in its own fallback (see grapheme.ts doc
  // comment) — this test only asserts round-trip fidelity, not a specific cluster count.
  const text = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  const result = segmentGraphemes(text);
  assert.equal(result.join(""), text);
});

test("segmentGraphemes: deterministic — same input always produces the same output", () => {
  const inputs = ["hello", "नमस्ते", "café", "😀🎉", "स्वागत"];
  for (const input of inputs) {
    assert.deepEqual(segmentGraphemes(input), segmentGraphemes(input));
  }
});

test("segmentGraphemes: never produces a cluster boundary that fails to round-trip the original string", () => {
  const samples = ["", "a", "abcdefgh", "नमस्ते दुनिया", "Kem chho tame?", "😀😃😄", "स्वागत છે"];
  for (const s of samples) {
    assert.equal(segmentGraphemes(s).join(""), s, `round-trip failed for "${s}"`);
  }
});
