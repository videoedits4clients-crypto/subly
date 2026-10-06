/**
 * P23.1 — how the sidecar reports and recovers from every way the transcription worker can fail on a customer's machine.
 * Spawns REAL child processes (fixtures/fake-worker-failures.js) through the same SUBLY_PYTHON_BIN / SUBLY_WHISPER_SCRIPT hook
 * the other sidecar tests use, so the actual spawn / stdio / exit handling runs — nothing is mocked.
 *
 * Root cause being guarded: a packaged customer machine that could not complete the first-run model download got the generic
 * "Something went wrong while generating subtitles." with no reason anywhere, and Retry showed the same. These tests pin
 * that each failure now has its own code and evidence, that a failed spawn is reported at once (not after a 5-minute stall),
 * and that Retry performs a genuine second attempt (a failed model load used to be remembered forever).
 *
 * Run with: node --test src/lib/transcription/__tests__/worker-failures.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transcribeLocal, ensureModelDownloaded, ensureModelLoaded, stopSidecar, type LocalWhisperConfig } from "../local-whisper-sidecar.ts";
import { TranscriptionError, classifyTranscriptionError, userMessageFor } from "../transcription-error.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(__dirname, "fixtures", "fake-worker-failures.js");
const CONFIG: LocalWhisperConfig = { model: "small", device: "cpu", computeType: "int8", modelDir: "unused" };
const saved = { bin: process.env.SUBLY_PYTHON_BIN, script: process.env.SUBLY_WHISPER_SCRIPT, exe: process.env.SUBLY_WHISPER_WORKER_EXE, log: process.env.SUBLY_LOG_DIR };

function useWorker(scenario: string) {
  stopSidecar();
  process.env.SUBLY_PYTHON_BIN = process.execPath;
  process.env.SUBLY_WHISPER_SCRIPT = FAKE;
  delete process.env.SUBLY_WHISPER_WORKER_EXE;
  process.env.SUBLY_FAKE_SCENARIO = scenario;
  const dir = mkdtempSync(path.join(os.tmpdir(), "subly-fakeworker-"));
  process.env.SUBLY_FAKE_COUNTER = path.join(dir, "counter.json");
  process.env.SUBLY_LOG_DIR = path.join(dir, "logs");
  return { counter: () => JSON.parse(readFileSync(process.env.SUBLY_FAKE_COUNTER!, "utf8")) as Record<string, number>, logDir: process.env.SUBLY_LOG_DIR };
}

test.afterEach(() => stopSidecar());
test.after(() => {
  stopSidecar();
  for (const [key, value] of [["SUBLY_PYTHON_BIN", saved.bin], ["SUBLY_WHISPER_SCRIPT", saved.script], ["SUBLY_WHISPER_WORKER_EXE", saved.exe], ["SUBLY_LOG_DIR", saved.log]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete process.env.SUBLY_FAKE_SCENARIO;
  delete process.env.SUBLY_FAKE_COUNTER;
});

test("1. a model download that fails is MODEL_DOWNLOAD_FAILED in the model-prepare stage, with a user message that says what to do", async () => {
  useWorker("ensure-model-fails");
  await assert.rejects(ensureModelDownloaded(CONFIG), (err: unknown) => {
    assert.ok(err instanceof TranscriptionError);
    assert.equal(err.code, "MODEL_DOWNLOAD_FAILED");
    assert.equal(err.stage, "model-prepare");
    assert.match(userMessageFor(err.code), /internet connection/i);
    assert.doesNotMatch(userMessageFor(err.code), /WinError|Traceback|C:\\/);
    return true;
  });
});

test("2. Retry after a failed model download is a REAL second attempt that reaches the worker again", async () => {
  const w = useWorker("ensure-model-fails");
  await assert.rejects(ensureModelDownloaded(CONFIG));
  await assert.rejects(ensureModelDownloaded(CONFIG));
  assert.equal(w.counter().ensure_model, 2, "the worker was asked twice — Retry did not replay a stored failure");
});

test("3. a failed model LOAD is not remembered: the next attempt asks the worker again (stale loadPromise regression)", async () => {
  const w = useWorker("load-fails-once");
  await assert.rejects(ensureModelLoaded(CONFIG), (err: unknown) => err instanceof TranscriptionError && err.code === "MODEL_LOAD_FAILED" && err.stage === "model-load");
  await ensureModelLoaded(CONFIG); // Retry: must call load again, and now succeed
  assert.equal(w.counter().load, 2, "load was attempted twice");
  const result = await transcribeLocal("any.wav", "en");
  assert.equal(result.fullText, "hello");
});

test("4. a worker that dies mid-transcription is WORKER_CRASHED with its exit code and the stderr that explains it", async () => {
  useWorker("crash-on-transcribe");
  await ensureModelLoaded(CONFIG);
  await assert.rejects(transcribeLocal("any.wav", "en"), (err: unknown) => {
    assert.ok(err instanceof TranscriptionError);
    assert.equal(err.code, "WORKER_CRASHED");
    assert.equal(err.stage, "transcribe");
    assert.equal(err.details.exitCode, 3);
    assert.match(err.details.stderrTail ?? "", /RuntimeError: CUDA\/CPU kernel failed/);
    return true;
  });
});

test("5. a worker that dies at start-up (a missing DLL, say) is WORKER_CRASHED with exit code 7 and its traceback, not a hang", async () => {
  useWorker("crash-on-start");
  const t0 = Date.now();
  await assert.rejects(ensureModelDownloaded(CONFIG), (err: unknown) => {
    assert.ok(err instanceof TranscriptionError);
    assert.equal(err.code, "WORKER_CRASHED");
    assert.equal(err.details.exitCode, 7);
    assert.match(err.details.stderrTail ?? "", /DLL load failed/);
    return true;
  });
  assert.ok(Date.now() - t0 < 10_000, "reported promptly");
});

test("6. a worker that cannot be launched at all is reported immediately as WORKER_NOT_FOUND (not after the 5-minute stall watchdog)", async () => {
  stopSidecar();
  process.env.SUBLY_WHISPER_WORKER_EXE = path.join(os.tmpdir(), "definitely-missing-whisper-worker.exe");
  process.env.SUBLY_LOG_DIR = path.join(mkdtempSync(path.join(os.tmpdir(), "subly-log-")), "logs");
  const t0 = Date.now();
  await assert.rejects(ensureModelDownloaded(CONFIG), (err: unknown) => {
    assert.ok(err instanceof TranscriptionError);
    assert.equal(err.code, "WORKER_NOT_FOUND");
    assert.equal(err.stage, "worker-start");
    assert.equal(err.details.systemCode, "ENOENT");
    return true;
  });
  assert.ok(Date.now() - t0 < 5_000, `reported in ${Date.now() - t0} ms`);
  const log = readFileSync(path.join(process.env.SUBLY_LOG_DIR, "transcription.log"), "utf8");
  assert.match(log, /worker-spawn-failed/);
  assert.match(log, /ENOENT/);
  delete process.env.SUBLY_WHISPER_WORKER_EXE;
});

test("7. the next call after a failed launch tries again (no dead process is reused)", async () => {
  stopSidecar();
  process.env.SUBLY_WHISPER_WORKER_EXE = path.join(os.tmpdir(), "definitely-missing-whisper-worker.exe");
  await assert.rejects(ensureModelDownloaded(CONFIG));
  delete process.env.SUBLY_WHISPER_WORKER_EXE;
  process.env.SUBLY_PYTHON_BIN = process.execPath;
  process.env.SUBLY_WHISPER_SCRIPT = FAKE;
  process.env.SUBLY_FAKE_SCENARIO = "ok";
  await ensureModelDownloaded(CONFIG); // a fresh process this time
  await ensureModelLoaded(CONFIG);
  assert.equal((await transcribeLocal("any.wav", "en")).fullText, "hello");
});

test("8. the crash is written to the diagnostics log with code, stage and exit code — and none of the stderr paths survive unsanitised", async () => {
  const w = useWorker("crash-on-transcribe");
  await ensureModelLoaded(CONFIG);
  await assert.rejects(transcribeLocal("any.wav", "en"));
  const file = path.join(w.logDir!, "transcription.log");
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, "utf8"), /worker-exited-unexpectedly/);
});

test("9. classification of the plain-text messages the worker and ffmpeg produce", () => {
  const cases: [Error, Parameters<typeof classifyTranscriptionError>[1], string][] = [
    [new Error("Model download failed: x"), "model-prepare", "MODEL_DOWNLOAD_FAILED"],
    [new Error("Model load failed: x"), "model-load", "MODEL_LOAD_FAILED"],
    [new Error("Another transcription is already running."), "transcribe", "WORKER_BUSY"],
    [new Error("Cannot find ffmpeg"), "extract-audio", "FFMPEG_NOT_FOUND"],
    [new Error("ffmpeg exited with code 1: Invalid data found when processing input"), "extract-audio", "INPUT_INVALID"],
    [new Error("ffmpeg exited with code 69"), "extract-audio", "FFMPEG_FAILED"],
    [new Error("probe failed"), "probe", "MEDIA_PROBE_FAILED"],
    [Object.assign(new Error("spawn EACCES"), { code: "EACCES" }), "worker-start", "WORKER_START_FAILED"],
    [Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "worker-start", "WORKER_NOT_FOUND"],
    [new Error("SQLITE_FULL"), "persist", "STORAGE_FAILED"],
    [new Error("???"), "parse-output", "INVALID_WORKER_OUTPUT"],
    [new Error("boom"), "transcribe", "TRANSCRIPTION_FAILED"],
    [new Error("boom"), "probe" as const, "MEDIA_PROBE_FAILED"],
  ];
  for (const [err, stage, code] of cases) assert.equal(classifyTranscriptionError(err, stage).code, code, `${err.message} @ ${stage}`);
  assert.equal(classifyTranscriptionError("a string", "worker-start").code, "UNKNOWN_TRANSCRIPTION_ERROR");
});
