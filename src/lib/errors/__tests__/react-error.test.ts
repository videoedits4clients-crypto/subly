/**
 * Task 111026 (P18.4) — tests for the pure React-error-boundary diagnostic helpers.
 * Run with: node --test src/lib/errors/__tests__/react-error.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatReactError, isRecoverableRenderError } from "../react-error.ts";

test("formatReactError: a plain Error instance yields its message", () => {
  const result = formatReactError(new Error("captions panel crashed"));
  assert.equal(result.message, "captions panel crashed");
});

test("formatReactError: an Error with an empty message falls back to its name", () => {
  const err = new TypeError("");
  const result = formatReactError(err);
  assert.equal(result.message, "TypeError");
});

test("formatReactError: an Error with a stack surfaces a short detail line, not the full stack", () => {
  const err = new Error("boom");
  err.stack = "Error: boom\n    at renderCaption (captions-panel.tsx:42:10)\n    at reallyDeepInternal (react-dom.js:1:1)";
  const result = formatReactError(err);
  assert.equal(result.message, "boom");
  assert.equal(result.detail, "at renderCaption (captions-panel.tsx:42:10)");
  assert.ok(!result.detail!.includes("reallyDeepInternal"), "only the first stack line is surfaced, not the whole trace");
});

test("formatReactError: an Error with no stack has no detail, not a crash", () => {
  const err = new Error("boom");
  err.stack = undefined;
  const result = formatReactError(err);
  assert.equal(result.message, "boom");
  assert.equal(result.detail, undefined);
});

test("formatReactError: a plain string throw is used directly", () => {
  const result = formatReactError("something broke");
  assert.equal(result.message, "something broke");
});

test("formatReactError: an empty string throw falls back to a generic message", () => {
  const result = formatReactError("");
  assert.equal(result.message, "An unknown error occurred.");
});

test("formatReactError: null and undefined both yield a generic message, never crash", () => {
  assert.equal(formatReactError(null).message, "An unknown error occurred.");
  assert.equal(formatReactError(undefined).message, "An unknown error occurred.");
});

test("formatReactError: an arbitrary thrown object is stringified, bounded", () => {
  const result = formatReactError({ code: "ECAPTION", reason: "bad state" });
  assert.ok(result.message.includes("ECAPTION"));
});

test("formatReactError: a circular object never throws while formatting — falls back safely", () => {
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  const result = formatReactError(circular);
  assert.equal(result.message, "An unknown error occurred.");
});

test("formatReactError: a very long message is truncated, never dumped in full", () => {
  const longMessage = "x".repeat(5000);
  const result = formatReactError(new Error(longMessage));
  assert.ok(result.message.length < 600, `expected a bounded message, got ${result.message.length} chars`);
  assert.ok(result.message.endsWith("…"));
});

test("formatReactError: a long thrown string is truncated the same way", () => {
  const result = formatReactError("y".repeat(5000));
  assert.ok(result.message.length < 600);
  assert.ok(result.message.endsWith("…"));
});

test("isRecoverableRenderError: an ordinary Error is recoverable by default", () => {
  assert.equal(isRecoverableRenderError(new Error("some render bug")), true);
});

test("isRecoverableRenderError: a string throw is recoverable by default", () => {
  assert.equal(isRecoverableRenderError("oops"), true);
});

test("isRecoverableRenderError: null/undefined default to recoverable", () => {
  assert.equal(isRecoverableRenderError(null), true);
  assert.equal(isRecoverableRenderError(undefined), true);
});

test("isRecoverableRenderError: a ChunkLoadError (stale deploy) is NOT recoverable by a simple retry", () => {
  const err = new Error("Loading chunk 42 failed.");
  err.name = "ChunkLoadError";
  assert.equal(isRecoverableRenderError(err), false);
});

test("isRecoverableRenderError: a message matching the chunk-load pattern is caught even without the exact name", () => {
  const err = new Error("Loading chunk vendors-abc123 failed after 3 attempts.");
  assert.equal(isRecoverableRenderError(err), false);
});

test("isRecoverableRenderError: a stack-overflow RangeError is NOT recoverable by a simple retry", () => {
  const err = new RangeError("Maximum call stack size exceeded");
  assert.equal(isRecoverableRenderError(err), false);
});

test("isRecoverableRenderError: an unrelated RangeError is still recoverable", () => {
  const err = new RangeError("Invalid array length");
  assert.equal(isRecoverableRenderError(err), true);
});
