/**
 * Tests for getTranscriptionProvider()'s desktop-mode guard (src/lib/transcription/index.ts) —
 * in the packaged desktop app (SUBLY_DESKTOP=1), a missing/broken local Whisper worker must
 * throw LocalWhisperUnavailableError instead of silently handing back MockTranscriptionProvider
 * and producing a fake transcript the user would never know was fake. Outside desktop mode
 * (the hosted/SaaS build), the mock fallback is still the accepted behavior.
 *
 * isLocalWhisperAvailable() memoizes its result for the life of the process (see index.ts), so
 * these tests are ordered deliberately: the "missing worker" scenario is set up once via
 * SUBLY_WHISPER_WORKER_EXE pointing at a path that doesn't exist, and reused (still missing)
 * across the desktop-mode and non-desktop-mode assertions that follow it.
 *
 * Run with: node --test src/lib/transcription/__tests__/desktop-mode-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { getTranscriptionProvider, LocalWhisperUnavailableError } from "../index.ts";

const ENV_KEYS = ["SUBLY_TRANSCRIPTION_PROVIDER", "SUBLY_WHISPER_WORKER_EXE", "SUBLY_PYTHON_BIN", "OPENAI_API_KEY", "SUBLY_DESKTOP"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

test.after(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("the explicit SUBLY_TRANSCRIPTION_PROVIDER=mock escape hatch still works even in desktop mode (documented dev/test-only override)", () => {
  process.env.SUBLY_TRANSCRIPTION_PROVIDER = "mock";
  process.env.SUBLY_DESKTOP = "1";
  const provider = getTranscriptionProvider();
  assert.equal(provider.name, "mock");
  delete process.env.SUBLY_TRANSCRIPTION_PROVIDER;
});

test("5. in desktop mode, a missing packaged worker (and no OpenAI key) throws LocalWhisperUnavailableError instead of silently returning a mock transcript", () => {
  delete process.env.OPENAI_API_KEY;
  process.env.SUBLY_WHISPER_WORKER_EXE = path.join(os.tmpdir(), "subly-test-worker-that-does-not-exist", String(Date.now()) + ".exe");
  process.env.SUBLY_DESKTOP = "1";
  assert.throws(() => getTranscriptionProvider(), LocalWhisperUnavailableError);
});

test("5. outside desktop mode, the same missing-worker condition still falls back to the mock provider (unaffected — the guard is scoped to SUBLY_DESKTOP=1 only)", () => {
  delete process.env.SUBLY_DESKTOP;
  const provider = getTranscriptionProvider();
  assert.equal(provider.name, "mock");
});
