/**
 * Regression test for the P3 release-hardening fix: a deliberate "sidecar already busy"
 * transcription failure (see python/whisper_worker.py's one-decode-at-a-time guard) was being
 * collapsed into the same generic "Something went wrong" message as a real, unexplained
 * failure. Reproduced live: two projects uploaded concurrently, the second's transcription
 * failed with this exact message while the sidecar was still busy with the first.
 *
 * Run with: node --test src/lib/__tests__/transcription-status-message.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SIDECAR_BUSY_MESSAGE, isSidecarBusyMessage } from "../transcription-status-message.ts";

test("isSidecarBusyMessage recognizes the exact sidecar-busy message", () => {
  assert.equal(isSidecarBusyMessage(SIDECAR_BUSY_MESSAGE), true);
  assert.equal(isSidecarBusyMessage("Another transcription is already running."), true);
});

test("isSidecarBusyMessage returns false for an unrelated failure message", () => {
  assert.equal(isSidecarBusyMessage("Model download failed: connection refused"), false);
});

test("isSidecarBusyMessage returns false for null/undefined", () => {
  assert.equal(isSidecarBusyMessage(null), false);
  assert.equal(isSidecarBusyMessage(undefined), false);
});
