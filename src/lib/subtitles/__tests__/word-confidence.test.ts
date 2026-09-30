/**
 * Task 108762 (P18.1) — pure tests for src/lib/subtitles/word-confidence.ts. No store, no React.
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-confidence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyWordConfidence, formatWordConfidence, LOW_CONFIDENCE_THRESHOLD } from "../word-confidence.ts";

test("LOW_CONFIDENCE_THRESHOLD is 0.5 — documented, not arbitrary (see the module's own doc comment)", () => {
  assert.equal(LOW_CONFIDENCE_THRESHOLD, 0.5);
});

test("24. classifyWordConfidence(undefined) -> 'unknown', never 'low' — a missing measurement is not a bad measurement", () => {
  assert.equal(classifyWordConfidence(undefined), "unknown");
});

test("25. classifyWordConfidence: below the threshold -> 'low'", () => {
  assert.equal(classifyWordConfidence(0.49), "low");
  assert.equal(classifyWordConfidence(0), "low");
  assert.equal(classifyWordConfidence(0.1), "low");
});

test("26. classifyWordConfidence: EXACTLY the threshold -> 'normal', not 'low' (a strict less-than comparison)", () => {
  assert.equal(classifyWordConfidence(0.5), "normal");
});

test("27. classifyWordConfidence: above the threshold -> 'normal'", () => {
  assert.equal(classifyWordConfidence(0.51), "normal");
  assert.equal(classifyWordConfidence(0.95), "normal");
  assert.equal(classifyWordConfidence(1), "normal");
});

test("formatWordConfidence: undefined -> 'Unknown'", () => {
  assert.equal(formatWordConfidence(undefined), "Unknown");
});

test("formatWordConfidence: a fractional value is rendered as a whole percentage, not the stored 3-decimal precision", () => {
  assert.equal(formatWordConfidence(0.873), "87%");
  assert.equal(formatWordConfidence(0.005), "1%");
  assert.equal(formatWordConfidence(0), "0%");
  assert.equal(formatWordConfidence(1), "100%");
});

test("classifyWordConfidence never mutates or reads anything beyond its single argument (pure function sanity check)", () => {
  const before = 0.42;
  const result = classifyWordConfidence(before);
  assert.equal(before, 0.42, "the input value itself is never touched");
  assert.equal(result, "low");
});
