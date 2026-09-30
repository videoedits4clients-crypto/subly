/**
 * Regression tests for LocalStorageDriver.delDir (src/lib/storage/local.ts) — the fix behind
 * safe permanent project deletion (see api/projects/[id]/trash/route.ts): every file under a
 * project's own storage prefix must be removed on permanent delete, without ever being able to
 * reach outside that project's own directory.
 *
 * SUBLY_UPLOADS_DIR is read once, at module load, to compute the driver's storage root — so
 * this test sets it to a fresh temp directory and only THEN dynamically imports the module,
 * rather than a static top-level import (which would run before the env var is set).
 *
 * Run with: node --test src/lib/storage/__tests__/local-storage.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

let tmpRoot: string;
let LocalStorageDriver: typeof import("../local.ts").LocalStorageDriver;
let driver: InstanceType<typeof LocalStorageDriver>;

test.before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "subly-storage-test-"));
  process.env.SUBLY_UPLOADS_DIR = tmpRoot;
  ({ LocalStorageDriver } = await import("../local.ts"));
  driver = new LocalStorageDriver();
});

test.after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

async function seedProject(projectId: string) {
  await driver.put(path.posix.join(projectId, "source.mp4"), Buffer.from("video"));
  await driver.put(path.posix.join(projectId, "audio.wav"), Buffer.from("audio"));
  await driver.put(path.posix.join(projectId, "exports", "job1.mp4"), Buffer.from("export"));
  await driver.put(path.posix.join(projectId, "exports", "job1.ass"), Buffer.from("[Script Info]"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

test("successful permanent deletion: delDir removes the project's source video, audio, and exports (including .ass sidecars)", async () => {
  const projectId = "proj-success";
  await seedProject(projectId);
  const projectDir = path.join(tmpRoot, projectId);
  assert.ok(await exists(projectDir), "test setup must have created the project directory");

  await driver.delDir(projectId);

  assert.equal(await exists(projectDir), false, "the whole project directory must be gone");
});

test("project with exports: nested exports/ subdirectory is fully, recursively removed", async () => {
  const projectId = "proj-with-exports";
  await seedProject(projectId);
  const exportsDir = path.join(tmpRoot, projectId, "exports");
  assert.ok(await exists(exportsDir));

  await driver.delDir(projectId);

  assert.equal(await exists(exportsDir), false);
});

test("missing files: deleting a project directory that doesn't exist at all is not an error", async () => {
  await assert.doesNotReject(driver.delDir("proj-never-existed"));
});

test("repeated deletion: calling delDir twice in a row for the same project is idempotent, not an error", async () => {
  const projectId = "proj-repeat";
  await seedProject(projectId);
  await driver.delDir(projectId);
  await assert.doesNotReject(driver.delDir(projectId));
});

test("does not delete files belonging to other projects", async () => {
  const target = "proj-target";
  const other = "proj-other-untouched";
  await seedProject(target);
  await seedProject(other);

  await driver.delDir(target);

  assert.equal(await exists(path.join(tmpRoot, target)), false, "target project must be gone");
  assert.equal(await exists(path.join(tmpRoot, other, "source.mp4")), true, "other project's video must survive");
  assert.equal(await exists(path.join(tmpRoot, other, "exports", "job1.mp4")), true, "other project's export must survive");
});

test("path traversal / unsafe paths: a prefix containing path-traversal or separator characters is refused outright, never resolved", async () => {
  await assert.rejects(driver.delDir("../escaped"), /unsafe storage prefix/);
  await assert.rejects(driver.delDir("..\\escaped"), /unsafe storage prefix/);
  await assert.rejects(driver.delDir("nested/path"), /unsafe storage prefix/);
  await assert.rejects(driver.delDir(""), /unsafe storage prefix/);
});

test("path traversal is refused even when it would otherwise stay syntactically 'inside' a longer relative path", async () => {
  // A real sibling directory outside tmpRoot, to prove nothing outside the storage root is
  // ever touched even if the safe-id check were somehow bypassed.
  const siblingDir = path.join(tmpRoot, "..", "subly-storage-test-sibling-should-survive");
  await fs.mkdir(siblingDir, { recursive: true });
  await fs.writeFile(path.join(siblingDir, "must-survive.txt"), "untouched");
  try {
    await assert.rejects(driver.delDir("../subly-storage-test-sibling-should-survive"));
    assert.equal(await exists(path.join(siblingDir, "must-survive.txt")), true);
  } finally {
    await fs.rm(siblingDir, { recursive: true, force: true }).catch(() => {});
  }
});
