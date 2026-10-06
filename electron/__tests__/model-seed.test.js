/**
 * P23.1 — the bundled speech model is copied into the user's models folder on first run, so a brand-new install
 * transcribes without reaching huggingface.co. These tests run the real fs code against temp directories.
 *
 * Run with: node --test electron/__tests__/model-seed.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { ensureModelSeed, findCompleteSnapshot, SEED_REPO_DIR, REQUIRED_FILES } = require("../model-seed.js");

const REV = "abc123";

function makeModel(root, { omit = [], emptyFile = null, bytes = 64 } = {}) {
  const repo = path.join(root, SEED_REPO_DIR);
  const snap = path.join(repo, "snapshots", REV);
  fs.mkdirSync(path.join(repo, "refs"), { recursive: true });
  fs.mkdirSync(snap, { recursive: true });
  fs.writeFileSync(path.join(repo, "refs", "main"), REV);
  for (const name of REQUIRED_FILES) {
    if (omit.includes(name)) continue;
    fs.writeFileSync(path.join(snap, name), name === emptyFile ? "" : Buffer.alloc(bytes, name.length));
  }
}
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "subly-seed-"));
}

test("1. first run: the model is copied from the installer's seed and is complete", () => {
  const base = tmp();
  const seedDir = path.join(base, "seed");
  const modelsDir = path.join(base, "user data", "models"); // a path with a space
  makeModel(seedDir);
  const r = ensureModelSeed({ seedDir, modelsDir });
  assert.equal(r.status, "seeded");
  assert.ok(findCompleteSnapshot(modelsDir));
  assert.deepEqual(fs.readdirSync(modelsDir), [SEED_REPO_DIR], "no staging leftovers");
});

test("2. a model that is already there is left alone (no re-copy on every launch)", () => {
  const base = tmp();
  const seedDir = path.join(base, "seed");
  const modelsDir = path.join(base, "models");
  makeModel(seedDir);
  makeModel(modelsDir, { bytes: 7 });
  const marker = path.join(modelsDir, SEED_REPO_DIR, "snapshots", REV, "config.json");
  const before = fs.statSync(marker).mtimeMs;
  assert.equal(ensureModelSeed({ seedDir, modelsDir }).status, "present");
  assert.equal(fs.statSync(marker).mtimeMs, before);
  assert.equal(fs.statSync(marker).size, 7);
});

test("3. a partial / interrupted earlier download is repaired from the seed", () => {
  const base = tmp();
  const seedDir = path.join(base, "seed");
  const modelsDir = path.join(base, "models");
  makeModel(seedDir);
  makeModel(modelsDir, { emptyFile: "model.bin" }); // truncated model.bin
  assert.equal(ensureModelSeed({ seedDir, modelsDir }).status, "seeded");
  assert.ok(findCompleteSnapshot(modelsDir));
  const incomplete = tmp();
  makeModel(incomplete, { omit: ["tokenizer.json"] });
  assert.equal(findCompleteSnapshot(incomplete), null);
});

test("4. leftovers of an interrupted earlier seeding (.seed-tmp-*) are cleaned up", () => {
  const base = tmp();
  const seedDir = path.join(base, "seed");
  const modelsDir = path.join(base, "models");
  makeModel(seedDir);
  fs.mkdirSync(path.join(modelsDir, ".seed-tmp-99999", SEED_REPO_DIR), { recursive: true });
  assert.equal(ensureModelSeed({ seedDir, modelsDir }).status, "seeded");
  assert.deepEqual(fs.readdirSync(modelsDir), [SEED_REPO_DIR]);
});

test("5. a build that ships no (or an incomplete) seed reports no-seed and creates nothing — the worker's own download path is then used", () => {
  const base = tmp();
  const modelsDir = path.join(base, "models");
  assert.equal(ensureModelSeed({ seedDir: path.join(base, "nope"), modelsDir }).status, "no-seed");
  const seedDir = path.join(base, "seed");
  makeModel(seedDir, { omit: ["model.bin"] });
  assert.equal(ensureModelSeed({ seedDir, modelsDir }).status, "no-seed");
  assert.equal(fs.existsSync(modelsDir), false);
});

test("6. a copy that fails (models dir is a file) returns failed and never throws", () => {
  const base = tmp();
  const seedDir = path.join(base, "seed");
  makeModel(seedDir);
  const modelsDir = path.join(base, "models");
  fs.writeFileSync(modelsDir, "i am a file, not a directory");
  const logs = [];
  const r = ensureModelSeed({ seedDir, modelsDir, log: (m) => logs.push(m) });
  assert.equal(r.status, "failed");
  assert.ok(r.error);
  assert.match(logs.join("\n"), /FAILED/);
});

test("7. seeding never writes into the seed (installation) directory", () => {
  const base = tmp();
  const seedDir = path.join(base, "seed");
  const modelsDir = path.join(base, "models");
  makeModel(seedDir);
  const listing = () => fs.readdirSync(seedDir, { recursive: true }).sort().join("|");
  const before = listing();
  ensureModelSeed({ seedDir, modelsDir });
  assert.equal(listing(), before);
});
