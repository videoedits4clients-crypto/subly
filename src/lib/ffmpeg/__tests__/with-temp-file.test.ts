/**
 * Regression tests for withTempFile (src/lib/ffmpeg/index.ts) — the helper export-pipeline.ts
 * uses to make sure a caption .ass file never survives an export attempt, whatever the outcome.
 * Previously every export attempt (success, cancel, or failure) left its .ass file behind in
 * the project's exports/ directory forever; this is the fix.
 *
 * Run with: node --test src/lib/ffmpeg/__tests__/with-temp-file.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { withTempFile } from "../index.ts";

let tmpDir: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-with-temp-file-test-"));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test("writes the file (creating parent directories) before running body, and body can read it back", async () => {
  const filePath = path.join(tmpDir, "nested", "dir", "captions.ass");
  let seenDuringBody: string | undefined;
  await withTempFile(filePath, "hello ass", async () => {
    seenDuringBody = await fs.readFile(filePath, "utf-8");
  });
  assert.equal(seenDuringBody, "hello ass");
});

test("removes the file after a successful export (no leftover .ass sidecar)", async () => {
  const filePath = path.join(tmpDir, "success.ass");
  await withTempFile(filePath, "content", async () => {});
  await assert.rejects(fs.access(filePath), /ENOENT/);
});

test("removes the file even when the export is cancelled (body rejects)", async () => {
  const filePath = path.join(tmpDir, "cancelled.ass");
  class FakeCancelled extends Error {}
  await assert.rejects(
    withTempFile(filePath, "content", async () => {
      throw new FakeCancelled("cancelled");
    }),
    FakeCancelled,
  );
  await assert.rejects(fs.access(filePath), /ENOENT/);
});

test("removes the file even when the export fails for an unrelated reason (body rejects with a generic error)", async () => {
  const filePath = path.join(tmpDir, "failed.ass");
  await assert.rejects(
    withTempFile(filePath, "content", async () => {
      throw new Error("ffmpeg exploded");
    }),
    /ffmpeg exploded/,
  );
  await assert.rejects(fs.access(filePath), /ENOENT/);
});

test("resolves with body's own return value", async () => {
  const filePath = path.join(tmpDir, "value.ass");
  const result = await withTempFile(filePath, "content", async () => 42);
  assert.equal(result, 42);
});

test("cleanup never throws even if the file was already removed out from under it", async () => {
  const filePath = path.join(tmpDir, "already-gone.ass");
  await withTempFile(filePath, "content", async () => {
    await fs.rm(filePath, { force: true });
  });
  // No throw from the outer withTempFile call is the assertion here.
});
