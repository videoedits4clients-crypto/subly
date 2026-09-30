/**
 * Task 141673 (P19.14) — deterministic verification for the stray-file sweep in
 * scripts/postbuild-standalone.js. P19.13's packaged-app pre-flight inspection found that
 * AGENTS.md, CLAUDE.md, README.md, and a stray `.db.bak-*` marker file were all shipping inside
 * resources/app-server/ because Next's `output: "standalone"` copies the entire project root and
 * the sweep's stray-entry list didn't cover them. These tests exercise the actual sweep function
 * (not a reimplementation of it) against a throwaway directory standing in for `.next/standalone`.
 *
 * Run with: node --test scripts/__tests__/postbuild-standalone.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { sweepStrayEntries } = require("../postbuild-standalone.js");

function makeFakeStandalone(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-postbuild-test-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test("DEFECT-1 regression: AGENTS.md, CLAUDE.md, and README.md are removed from the standalone output", () => {
  const dir = makeFakeStandalone({
    "AGENTS.md": "agent instructions",
    "CLAUDE.md": "@AGENTS.md",
    "README.md": "# SUBLY",
    "server.js": "require required at runtime",
  });
  try {
    sweepStrayEntries(dir);
    assert.equal(fs.existsSync(path.join(dir, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(dir, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(dir, "README.md")), false);
    assert.equal(fs.existsSync(path.join(dir, "server.js")), true, "must never remove real runtime files");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DEFECT-2 regression: a stray *.db.bak-* marker file is removed regardless of its exact name", () => {
  const dir = makeFakeStandalone({
    "UsersUserAppDataRoamingsubssubly.db.bak-pre-p8-multi-caption-qa": "",
    "some-other.db.bak-pre-a-totally-different-qa-session": "",
    "template.db": "not a bak file — must survive",
  });
  try {
    const removed = sweepStrayEntries(dir);
    assert.ok(removed.includes("UsersUserAppDataRoamingsubssubly.db.bak-pre-p8-multi-caption-qa"));
    assert.ok(removed.includes("some-other.db.bak-pre-a-totally-different-qa-session"), "matched by pattern, not a fixed name — a differently-named future stray must also be caught");
    assert.equal(fs.existsSync(path.join(dir, "template.db")), true, "a real, non-backup .db file must never be swept");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not remove unrelated files or directories that happen to share a substring", () => {
  const dir = makeFakeStandalone({
    "README-something-else.md": "not an exact match — must survive",
    "server.js": "x",
  });
  try {
    sweepStrayEntries(dir);
    assert.equal(fs.existsSync(path.join(dir, "README-something-else.md")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sweeps stray release*/research/python directories by pattern (pre-existing behavior, still correct after the refactor)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subly-postbuild-test-"));
  try {
    fs.mkdirSync(path.join(dir, "release5"));
    fs.mkdirSync(path.join(dir, "research"));
    fs.mkdirSync(path.join(dir, "python"));
    fs.mkdirSync(path.join(dir, "keep-me"));
    sweepStrayEntries(dir);
    assert.equal(fs.existsSync(path.join(dir, "release5")), false);
    assert.equal(fs.existsSync(path.join(dir, "research")), false);
    assert.equal(fs.existsSync(path.join(dir, "python")), false);
    assert.equal(fs.existsSync(path.join(dir, "keep-me")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
