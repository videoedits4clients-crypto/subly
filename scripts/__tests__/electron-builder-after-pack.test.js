/**
 * Unit tests for the pure assertion helpers behind electron-builder's afterPack hook
 * (scripts/electron-builder-after-pack.js) — these carry all the actual fail/pass logic that
 * makes a broken packaged build (missing node_modules copy, missing server.js, etc.) a fatal,
 * non-zero-exit packaging failure instead of silently producing an installer that crashes on
 * first launch. The hook itself (exports.default) isn't exercised directly here since that
 * needs a full electron-builder `context` object; these functions are what it actually throws
 * through.
 *
 * Run with: node --test scripts/__tests__/electron-builder-after-pack.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { assertExists, assertNonEmptyDir } = require("../electron-builder-after-pack.js");

test("6. assertExists throws when the path does not exist (would otherwise silently produce a broken installer)", () => {
  const missing = path.join(os.tmpdir(), "subly-afterpack-test-does-not-exist", String(Date.now()));
  assert.throws(() => assertExists(missing, "test thing"), /REQUIRED test thing is missing/);
});

test("6. assertExists does not throw when the path exists", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-afterpack-test-"));
  try {
    assert.doesNotThrow(() => assertExists(tmpDir, "test dir"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("6. assertNonEmptyDir throws when the directory does not exist at all", () => {
  const missing = path.join(os.tmpdir(), "subly-afterpack-test-does-not-exist", String(Date.now()));
  assert.throws(() => assertNonEmptyDir(missing, "test dir"), /REQUIRED test dir is missing/);
});

test("6. assertNonEmptyDir throws when the directory exists but is empty — this is exactly the 'copy silently produced nothing' failure mode this check was added to catch", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-afterpack-test-"));
  try {
    assert.throws(() => assertNonEmptyDir(tmpDir, "packaged node_modules"), /exists but is empty/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("6. assertNonEmptyDir returns the directory's entries when non-empty, and does not throw", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-afterpack-test-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "next"), "");
    fs.writeFileSync(path.join(tmpDir, "other-package"), "");
    const entries = assertNonEmptyDir(tmpDir, "packaged node_modules");
    assert.deepEqual(entries.sort(), ["next", "other-package"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
