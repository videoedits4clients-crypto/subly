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

// ---- P23.1: the installer must carry the speech model --------------------------------------------------------------------
const { assertModelSeed } = require("../electron-builder-after-pack.js");

function writeSeed(appServerDir, { omit = [], emptyFile = null } = {}) {
  const repo = path.join(appServerDir, "assets", "models-seed", "models--Systran--faster-whisper-small");
  fs.mkdirSync(path.join(repo, "refs"), { recursive: true });
  fs.mkdirSync(path.join(repo, "snapshots", "rev1"), { recursive: true });
  fs.writeFileSync(path.join(repo, "refs", "main"), "rev1");
  for (const name of ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"]) {
    if (omit.includes(name)) continue;
    fs.writeFileSync(path.join(repo, "snapshots", "rev1", name), name === emptyFile ? "" : "data");
  }
}

test("P23.1 assertModelSeed passes when the whole model is in the packaged app-server", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-afterpack-seed-"));
  try {
    writeSeed(dir);
    assert.doesNotThrow(() => assertModelSeed(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("P23.1 assertModelSeed ABORTS the build when the model is absent — an installer without it is the v0.1.20 first-run failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-afterpack-seed-"));
  const saved = process.env.SUBLY_ALLOW_NO_MODEL_SEED;
  delete process.env.SUBLY_ALLOW_NO_MODEL_SEED;
  try {
    assert.throws(() => assertModelSeed(dir), /bundled speech model is missing/);
  } finally {
    if (saved !== undefined) process.env.SUBLY_ALLOW_NO_MODEL_SEED = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("P23.1 assertModelSeed aborts on a truncated (zero-byte) model.bin or a missing tokenizer", () => {
  const saved = process.env.SUBLY_ALLOW_NO_MODEL_SEED;
  delete process.env.SUBLY_ALLOW_NO_MODEL_SEED;
  try {
    for (const opts of [{ emptyFile: "model.bin" }, { omit: ["tokenizer.json"] }]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-afterpack-seed-"));
      try {
        writeSeed(dir, opts);
        assert.throws(() => assertModelSeed(dir), /bundled speech model is missing/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    if (saved !== undefined) process.env.SUBLY_ALLOW_NO_MODEL_SEED = saved;
  }
});

test("P23.1 assertModelSeed can be waived explicitly (dev packaging) with SUBLY_ALLOW_NO_MODEL_SEED=1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-afterpack-seed-"));
  const saved = process.env.SUBLY_ALLOW_NO_MODEL_SEED;
  process.env.SUBLY_ALLOW_NO_MODEL_SEED = "1";
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => assertModelSeed(dir));
  } finally {
    console.warn = warn;
    if (saved === undefined) delete process.env.SUBLY_ALLOW_NO_MODEL_SEED;
    else process.env.SUBLY_ALLOW_NO_MODEL_SEED = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
