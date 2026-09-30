/**
 * Automated tests for the reading-speed (CPS) pure utility (lib/subtitles/reading-speed.ts).
 *
 * Run with: node --test src/lib/subtitles/__tests__/reading-speed.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { calculateCPS, minDurationForReadableCPS, FAST_READING_CPS } from "../reading-speed.ts";

test("calculateCPS: chars-per-second over the caption's duration", () => {
  assert.equal(calculateCPS("hello", 1), 5);
  assert.equal(calculateCPS("hello world", 2), 5.5);
});

test("calculateCPS: newlines (the caption's own line wrap) don't count as extra reading time", () => {
  assert.equal(calculateCPS("hello\nworld", 2), calculateCPS("hello world", 2));
});

test("calculateCPS: spaces and punctuation count toward reading load, not stripped", () => {
  const withPunct = calculateCPS("Wait, really?!", 1);
  const stripped = "Waitreally".length; // hypothetical if punctuation/spaces were stripped
  assert.notEqual(withPunct, stripped);
  assert.equal(withPunct, "Wait, really?!".length);
});

test("calculateCPS: empty text is 0 regardless of duration", () => {
  assert.equal(calculateCPS("", 5), 0);
  assert.equal(calculateCPS("   ", 0), 0);
});

test("calculateCPS: zero or negative duration with real text is Infinity (definitely too fast)", () => {
  assert.equal(calculateCPS("hello", 0), Infinity);
  assert.equal(calculateCPS("hello", -1), Infinity);
});

test("minDurationForReadableCPS: inverse of calculateCPS at the target rate", () => {
  const text = "a".repeat(40);
  const dur = minDurationForReadableCPS(text, 20);
  assert.equal(dur, 2);
  assert.equal(calculateCPS(text, dur), 20);
});

test("minDurationForReadableCPS: empty text needs zero reading time", () => {
  assert.equal(minDurationForReadableCPS(""), 0);
});

test("minDurationForReadableCPS: defaults to FAST_READING_CPS when no rate is given", () => {
  const text = "a".repeat(FAST_READING_CPS);
  assert.equal(minDurationForReadableCPS(text), 1);
});
