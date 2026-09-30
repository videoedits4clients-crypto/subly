/**
 * End-to-end tests for local-whisper-sidecar.ts's progress/cancel/stall handling — spawns a
 * real child process (fixtures/fake-worker.js, a minimal stand-in for python/whisper_worker.py's
 * line-delimited JSON protocol) via the same SUBLY_PYTHON_BIN + SUBLY_WHISPER_SCRIPT override
 * hook local dev already uses, so the actual spawn/readline/watchdog code runs for real rather
 * than being mocked.
 *
 * Run with: node --test src/lib/transcription/__tests__/cancellation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  transcribeLocal,
  ensureModelDownloaded,
  cancelTranscriptionRequest,
  stopSidecar,
  TranscriptionCancelledError,
  TranscriptionStalledError,
} from "../local-whisper-sidecar.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prevPythonBin = process.env.SUBLY_PYTHON_BIN;
const prevScript = process.env.SUBLY_WHISPER_SCRIPT;
process.env.SUBLY_PYTHON_BIN = process.execPath;
process.env.SUBLY_WHISPER_SCRIPT = path.join(__dirname, "fixtures", "fake-worker.js");

test.after(() => {
  stopSidecar();
  if (prevPythonBin === undefined) delete process.env.SUBLY_PYTHON_BIN;
  else process.env.SUBLY_PYTHON_BIN = prevPythonBin;
  if (prevScript === undefined) delete process.env.SUBLY_WHISPER_SCRIPT;
  else process.env.SUBLY_WHISPER_SCRIPT = prevScript;
});

test("1/9. progress callback receives updates and a normal transcription resolves with the worker's result (existing successful transcription still works)", async () => {
  const progressEvents: number[] = [];
  const result = await transcribeLocal("progress-then-result", "en", (p) => progressEvents.push(p));
  assert.deepEqual(progressEvents, [25, 50, 75]);
  assert.equal(result.fullText, "hello");
  assert.equal(result.language, "en");
});

test("2/3. cancelTranscriptionRequest reaches the worker and the request rejects with TranscriptionCancelledError instead of completing", async () => {
  let requestId: string | undefined;
  const promise = transcribeLocal("wait-for-cancel", "en", undefined, (id) => {
    requestId = id;
  });
  assert.ok(requestId, "onRequestId must fire synchronously before transcribeLocal's promise settles");
  cancelTranscriptionRequest(requestId!);
  await assert.rejects(promise, TranscriptionCancelledError);
});

test("cancelling an id that is no longer pending (already finished) is a silent no-op, not an error", () => {
  assert.doesNotThrow(() => cancelTranscriptionRequest("not-a-real-pending-id"));
});

test("4. an unresponsive worker trips the stall watchdog and rejects with TranscriptionStalledError (recoverable failure, not a hang)", async () => {
  const prevTimeout = process.env.SUBLY_WHISPER_STALL_TIMEOUT_MS;
  process.env.SUBLY_WHISPER_STALL_TIMEOUT_MS = "150";
  try {
    await assert.rejects(transcribeLocal("never-respond", "en"), TranscriptionStalledError);
  } finally {
    if (prevTimeout === undefined) delete process.env.SUBLY_WHISPER_STALL_TIMEOUT_MS;
    else process.env.SUBLY_WHISPER_STALL_TIMEOUT_MS = prevTimeout;
  }
});

test("cancellation latency fix: if the worker never honors the cooperative cancel check (deep inside one long decode chunk), the cancel grace timer escalates to a hard kill and still rejects with TranscriptionCancelledError — not left hanging, and not misreported as a stall", async () => {
  const prevGrace = process.env.SUBLY_WHISPER_CANCEL_GRACE_MS;
  process.env.SUBLY_WHISPER_CANCEL_GRACE_MS = "150";
  try {
    let requestId: string | undefined;
    const started = Date.now();
    const promise = transcribeLocal("ignore-cancel", "en", undefined, (id) => {
      requestId = id;
    });
    assert.ok(requestId, "onRequestId must fire synchronously");
    cancelTranscriptionRequest(requestId!);
    await assert.rejects(promise, TranscriptionCancelledError);
    const elapsed = Date.now() - started;
    // Bounded by the grace timer, not by whatever the fake worker would otherwise never do —
    // generous upper bound to avoid flakiness, but well under the old ~70s-observed latency.
    assert.ok(elapsed < 2000, `expected the hard-kill escalation to land quickly, took ${elapsed}ms`);
  } finally {
    if (prevGrace === undefined) delete process.env.SUBLY_WHISPER_CANCEL_GRACE_MS;
    else process.env.SUBLY_WHISPER_CANCEL_GRACE_MS = prevGrace;
  }
});

test("after a cancel-grace hard kill, the next transcription still works (fresh sidecar spawned cleanly)", async () => {
  const result = await transcribeLocal("progress-then-result", "en");
  assert.equal(result.fullText, "hello");
});

test("cancel during model loading: ensureModelDownloaded registers a cancellable request id, and cancelling it while the (simulated) download hangs rejects with TranscriptionCancelledError instead of silently continuing", async () => {
  const prevGrace = process.env.SUBLY_WHISPER_CANCEL_GRACE_MS;
  process.env.SUBLY_WHISPER_CANCEL_GRACE_MS = "150";
  try {
    let requestId: string | undefined;
    const promise = ensureModelDownloaded(
      { model: "small", device: "cpu", computeType: "int8", modelDir: "unused-in-fake-worker" },
      undefined,
      (id) => {
        requestId = id;
      },
    );
    assert.ok(requestId, "onRequestId must fire synchronously for ensure_model too");
    cancelTranscriptionRequest(requestId!);
    await assert.rejects(promise, TranscriptionCancelledError);
  } finally {
    if (prevGrace === undefined) delete process.env.SUBLY_WHISPER_CANCEL_GRACE_MS;
    else process.env.SUBLY_WHISPER_CANCEL_GRACE_MS = prevGrace;
  }
});

test("after cancelling a hung model download, the sidecar recovers and a normal transcription still works", async () => {
  const result = await transcribeLocal("progress-then-result", "en");
  assert.equal(result.fullText, "hello");
});
