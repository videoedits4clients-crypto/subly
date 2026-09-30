/**
 * Task 123041 (P19.3) — pure tests for lib/timeline/timecode.ts's parse/clamp functions. No
 * React, no store, no DOM. See that file's own doc comments for why no format function lives
 * here: lib/utils.ts's existing `formatTime` is reused unchanged (see the report's own §6).
 *
 * Run with: node --test src/lib/timeline/__tests__/timecode.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseTimelineTime, clampTimelineTime } from "../timecode.ts";

// --- parseTimelineTime -------------------------------------------------------------------

test("1. parses a bare zero", () => {
  assert.equal(parseTimelineTime("0"), 0);
});

test("2. parses a normal MM:SS.cc time (matches formatTime's own output shape)", () => {
  assert.equal(parseTimelineTime("00:03.54"), 3.54);
});

test("3. parses at a minute boundary", () => {
  assert.equal(parseTimelineTime("01:00"), 60);
  assert.equal(parseTimelineTime("00:59.99"), 59.99);
});

test("3b. parses at an hour boundary (HH:MM:SS)", () => {
  assert.equal(parseTimelineTime("01:00:00"), 3600);
  assert.equal(parseTimelineTime("00:59:59"), 3599);
});

test("4. parses a bare (non-colon) number of seconds, including beyond 60", () => {
  assert.equal(parseTimelineTime("125"), 125);
  assert.equal(parseTimelineTime("125.5"), 125.5);
});

test("5. parses valid input with surrounding whitespace", () => {
  assert.equal(parseTimelineTime("  00:03.54  "), 3.54);
});

test("6. rejects malformed (non-numeric) input", () => {
  assert.equal(parseTimelineTime("abc"), null);
  assert.equal(parseTimelineTime("12:ab"), null);
  assert.equal(parseTimelineTime("1::2"), null);
});

test("7. rejects negative input", () => {
  assert.equal(parseTimelineTime("-5"), null);
  assert.equal(parseTimelineTime("-1:30"), null);
});

test("8. rejects NaN/Infinity-producing input and empty/whitespace-only input", () => {
  assert.equal(parseTimelineTime("NaN"), null);
  assert.equal(parseTimelineTime("Infinity"), null);
  assert.equal(parseTimelineTime(""), null);
  assert.equal(parseTimelineTime("   "), null);
  assert.equal(parseTimelineTime("1:"), null);
  assert.equal(parseTimelineTime(":30"), null);
});

test("8b. rejects more than 3 colon-separated parts", () => {
  assert.equal(parseTimelineTime("1:2:3:4"), null);
});

test("8c. never throws on adversarial input", () => {
  for (const input of ["", " ", ":", "::", "1:2:3:4:5", "a:b:c", "-0", "1.2.3", "  \t\n  "]) {
    assert.doesNotThrow(() => parseTimelineTime(input));
  }
});

// --- clampTimelineTime --------------------------------------------------------------------

test("9. clamps a value below zero up to zero", () => {
  assert.equal(clampTimelineTime(-5, 100), 0);
});

test("10. clamps a value above duration down to duration", () => {
  assert.equal(clampTimelineTime(500, 100), 100);
});

test("10b. leaves an in-range value untouched", () => {
  assert.equal(clampTimelineTime(50, 100), 50);
});

test("11. duration unavailable (0, negative, or non-finite) clamps everything to exactly 0", () => {
  assert.equal(clampTimelineTime(50, 0), 0);
  assert.equal(clampTimelineTime(50, -10), 0);
  assert.equal(clampTimelineTime(50, NaN), 0);
  assert.equal(clampTimelineTime(0, 0), 0);
});

test("11b. non-finite seconds input falls back to 0 rather than propagating NaN/Infinity", () => {
  assert.equal(clampTimelineTime(NaN, 100), 0);
  assert.equal(clampTimelineTime(Infinity, 100), 0);
  assert.equal(clampTimelineTime(-Infinity, 100), 0);
});

test("11c. never throws, never returns NaN/Infinity", () => {
  for (const [s, d] of [
    [NaN, NaN],
    [Infinity, Infinity],
    [-Infinity, -Infinity],
    [0, 0],
    [-1, -1],
  ] as const) {
    let result = 0;
    assert.doesNotThrow(() => {
      result = clampTimelineTime(s, d);
    });
    assert.ok(Number.isFinite(result));
  }
});
