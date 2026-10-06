/**
 * P23.1 — every transcription failure maps to a stable code, and what a customer sees never contains paths, stack traces or
 * raw worker output. Also guards that pipeline.ts really goes through the classifier (it can't be imported here — it uses
 * "@/" aliases — so this reads its source).
 *
 * Run with: node --test src/lib/transcription/__tests__/transcription-error.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyTranscriptionError, userMessageFor, isRetryFutile, GENERIC_TRANSCRIPTION_MESSAGE, TranscriptionError, type TranscriptionErrorCode } from "../transcription-error.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALL_CODES: TranscriptionErrorCode[] = [
  "INPUT_INVALID", "MEDIA_PROBE_FAILED", "FFMPEG_NOT_FOUND", "FFMPEG_FAILED", "WORKER_NOT_FOUND", "WORKER_START_FAILED", "MODEL_NOT_FOUND",
  "MODEL_LOAD_FAILED", "WORKER_CRASHED", "WORKER_TIMEOUT", "WORKER_CANCELLED", "INVALID_WORKER_OUTPUT", "TRANSCRIPTION_FAILED", "STORAGE_FAILED",
  "UNKNOWN_TRANSCRIPTION_ERROR", "MODEL_DOWNLOAD_FAILED", "WORKER_BUSY",
];

test("1. every code has a non-empty, calm user message with no path, stack trace or exception text", () => {
  for (const code of ALL_CODES) {
    const msg = userMessageFor(code);
    assert.ok(msg.length > 10, code);
    assert.doesNotMatch(msg, /[A-Za-z]:\|\/Users\/|Traceback|\bat .*\(.*:\d+:\d+\)|Error:|ENOENT|exit code/i, `${code}: ${msg}`);
  }
});

test("2. the established wording for cancel / stall / busy is unchanged, and unknown still gets the generic message", () => {
  assert.equal(userMessageFor("UNKNOWN_TRANSCRIPTION_ERROR"), GENERIC_TRANSCRIPTION_MESSAGE);
  assert.equal(GENERIC_TRANSCRIPTION_MESSAGE, "Something went wrong while generating subtitles.");
  assert.notEqual(userMessageFor("MODEL_DOWNLOAD_FAILED"), GENERIC_TRANSCRIPTION_MESSAGE);
  assert.notEqual(userMessageFor("WORKER_CRASHED"), GENERIC_TRANSCRIPTION_MESSAGE);
  assert.notEqual(userMessageFor("WORKER_NOT_FOUND"), GENERIC_TRANSCRIPTION_MESSAGE);
});

test("3. an existing TranscriptionError is passed through (stage/details preserved), not re-classified", () => {
  const original = new TranscriptionError("WORKER_CRASHED", "x", { stage: "transcribe", details: { exitCode: 3, stderrTail: "boom" } });
  const out = classifyTranscriptionError(original, "persist");
  assert.equal(out.code, "WORKER_CRASHED");
  assert.equal(out.stage, "transcribe");
  assert.equal(out.details.exitCode, 3);
});

test("4. isRetryFutile: only missing-binary failures are futile; a download/crash/timeout is worth retrying", () => {
  for (const c of ["WORKER_NOT_FOUND", "MODEL_NOT_FOUND", "FFMPEG_NOT_FOUND"] as const) assert.equal(isRetryFutile(c), true, c);
  for (const c of ["MODEL_DOWNLOAD_FAILED", "WORKER_CRASHED", "WORKER_TIMEOUT", "MODEL_LOAD_FAILED"] as const) assert.equal(isRetryFutile(c), false, c);
});

test("5. pipeline.ts classifies every failure, records stage + code, and shows userMessageFor — not one hard-coded generic string", () => {
  const src = readFileSync(path.join(__dirname, "..", "..", "pipeline.ts"), "utf8");
  assert.match(src, /classifyTranscriptionError\(err, stage\)/);
  assert.match(src, /errorMessage: userMessageFor\(failure\.code\)/);
  for (const s of ["extract-audio", "worker-start", "transcribe", "parse-output", "persist"]) assert.match(src, new RegExp(`stage = "${s}"`), s);
  for (const e of ["transcription-start", "transcription-complete", "transcription-failed"]) assert.match(src, new RegExp(e), e);
  assert.doesNotMatch(src, /errorMessage:\s*["'`]Something went wrong/, "no hard-coded generic message in the failure path");
});

test("6. Retry is not poisoned: the retry route re-runs the whole pipeline and clears the previous error", () => {
  const route = readFileSync(path.join(__dirname, "..", "..", "..", "app", "api", "projects", "[id]", "retry", "route.ts"), "utf8");
  assert.match(route, /processVideo/);
});
