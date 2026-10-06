// Seeds the per-user speech model cache from the model that ships INSIDE the installer (P23.1).
//
// Before this, a brand-new install had no speech model: the first transcription downloaded ~480 MB from huggingface.co. On a
// machine that cannot reach it (offline, firewall/VPN/proxy, a country or network that blocks it, an interrupted download) that
// first transcription failed with a generic "Something went wrong" — and so did every Retry — which is exactly what a real
// customer hit. The installer now carries the default model (Systran/faster-whisper-small, pinned revision) and this copies it
// into the user's models folder on first run, so the first transcription needs no network at all.
//
// The cache layout is huggingface_hub's own (models--<org>--<name>/refs/main + snapshots/<revision>/…), which is what the worker
// (python/whisper_worker.py) already looks for, so the worker needs no change. Never writes inside the installation folder.
const fs = require("fs");
const path = require("path");

const SEED_REPO_DIR = "models--Systran--faster-whisper-small";
/** The files faster-whisper needs to load the model. */
const REQUIRED_FILES = ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"];

/** Returns the snapshot directory of a COMPLETE copy of the model inside `root` (an HF cache dir or the seed dir), or null. */
function findCompleteSnapshot(root) {
  try {
    const repo = path.join(root, SEED_REPO_DIR);
    const revision = fs.readFileSync(path.join(repo, "refs", "main"), "utf8").trim();
    if (!revision) return null;
    const snapshot = path.join(repo, "snapshots", revision);
    for (const name of REQUIRED_FILES) {
      const stat = fs.statSync(path.join(snapshot, name));
      if (!stat.isFile() || stat.size === 0) return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function sameSizes(srcSnapshot, destSnapshot) {
  return REQUIRED_FILES.every((name) => fs.statSync(path.join(srcSnapshot, name)).size === fs.statSync(path.join(destSnapshot, name)).size);
}

/**
 * Makes sure `modelsDir` holds a complete copy of the bundled model.
 * Returns { status, ms? } where status is:
 *   "present"  — a complete model was already there (nothing done)
 *   "seeded"   — copied from the installer (first run, or repairing an incomplete/partial download)
 *   "no-seed"  — this build ships no model (a dev checkout) — the worker's own download path is used
 *   "failed"   — copying failed (disk full, permissions…); `error` explains. Never throws: the worker can still try to download.
 */
function ensureModelSeed({ seedDir, modelsDir, log = () => {} }) {
  const started = Date.now();
  try {
    if (findCompleteSnapshot(modelsDir)) return { status: "present" };
    const seedSnapshot = findCompleteSnapshot(seedDir);
    if (!seedSnapshot) return { status: "no-seed" };

    fs.mkdirSync(modelsDir, { recursive: true });
    // leftovers of an interrupted earlier seeding
    for (const entry of fs.readdirSync(modelsDir)) {
      if (entry.startsWith(".seed-tmp-")) fs.rmSync(path.join(modelsDir, entry), { recursive: true, force: true });
    }
    // copy into a staging folder on the same volume, then rename: a crash mid-copy can never leave a half-written model that
    // looks complete
    const staging = path.join(modelsDir, `.seed-tmp-${process.pid}`);
    fs.cpSync(path.join(seedDir, SEED_REPO_DIR), path.join(staging, SEED_REPO_DIR), { recursive: true });
    const stagedSnapshot = findCompleteSnapshot(staging);
    if (!stagedSnapshot || !sameSizes(seedSnapshot, stagedSnapshot)) throw new Error("copied model failed its size check");

    const finalRepo = path.join(modelsDir, SEED_REPO_DIR);
    // an incomplete cache (a download that never finished) is replaced; it holds nothing worth keeping
    fs.rmSync(finalRepo, { recursive: true, force: true });
    fs.renameSync(path.join(staging, SEED_REPO_DIR), finalRepo);
    fs.rmSync(staging, { recursive: true, force: true });
    const ms = Date.now() - started;
    log(`model seed: copied ${SEED_REPO_DIR} into ${modelsDir} in ${ms} ms`);
    return { status: "seeded", ms };
  } catch (err) {
    log(`model seed FAILED: ${err && err.message ? err.message : err}`);
    return { status: "failed", error: String(err && err.message ? err.message : err) };
  }
}

module.exports = { ensureModelSeed, findCompleteSnapshot, SEED_REPO_DIR, REQUIRED_FILES };
