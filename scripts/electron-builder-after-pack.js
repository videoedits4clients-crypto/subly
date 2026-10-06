// electron-builder's default file-matcher silently drops `node_modules` even
// from `extraResources` copies (confirmed via release/builder-debug.yml
// showing a baked-in `!**/node_modules/**` rule) — so the packaged app's
// bundled Next.js standalone server was missing its own node_modules
// entirely and failed to boot ("Cannot find module 'next'"). Sidestepping
// electron-builder's matcher for just this one subtree by copying it
// ourselves, after packaging, with plain fs.
//
// This step used to fail silently: a missing/empty source directory, or a
// copy that didn't actually land the expected files, would still produce an
// "apparently valid" installer that crashes for every single user on first
// launch. Every check below throws on failure — electron-builder treats a
// thrown/rejected afterPack hook as a fatal packaging error (non-zero exit,
// no installer written), which is exactly what should happen here: a broken
// packaged app must never leave the build pipeline looking successful.
const fs = require("fs");
const path = require("path");

function assertExists(p, what) {
  if (!fs.existsSync(p)) {
    throw new Error(`[afterPack] REQUIRED ${what} is missing at ${p}. The packaged app would not run. Aborting build.`);
  }
}

function assertNonEmptyDir(p, what) {
  assertExists(p, what);
  const entries = fs.readdirSync(p);
  if (entries.length === 0) {
    throw new Error(`[afterPack] REQUIRED ${what} at ${p} exists but is empty. Aborting build.`);
  }
  return entries;
}

/** The pinned model files must be in the packaged app-server, complete (size > 0). Waive with SUBLY_ALLOW_NO_MODEL_SEED=1. */
function assertModelSeed(appServerDir) {
  const repoDir = path.join(appServerDir, "assets", "models-seed", "models--Systran--faster-whisper-small");
  const missing = [];
  try {
    const revision = fs.readFileSync(path.join(repoDir, "refs", "main"), "utf8").trim();
    for (const name of ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"]) {
      const file = path.join(repoDir, "snapshots", revision, name);
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) missing.push(name);
    }
  } catch {
    missing.push("refs/main");
  }
  if (missing.length === 0) return;
  const message =
    `[afterPack] The bundled speech model is missing from the packaged app (${missing.join(", ")} under ${repoDir}). ` +
    `Run "npm run model:seed" (or "node scripts/prepare-model-seed.js --from <hf-cache-dir>") before "npm run build"; ` +
    `without it a customer's first transcription needs internet access to huggingface.co.`;
  if (process.env.SUBLY_ALLOW_NO_MODEL_SEED === "1") {
    console.warn(message + " (waived by SUBLY_ALLOW_NO_MODEL_SEED=1)");
    return;
  }
  throw new Error(message + " Aborting build.");
}

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, ".next", "standalone", "node_modules");
  const appServerDir = path.join(context.appOutDir, "resources", "app-server");
  const dest = path.join(appServerDir, "node_modules");

  // Fail loudly before touching anything if the source itself is missing — this means `npm
  // run build` (which produces .next/standalone) wasn't run before packaging, a distinct
  // problem from the copy itself failing.
  assertNonEmptyDir(src, "Next.js standalone node_modules (run `npm run build` first)");

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });

  // Verify the copy actually landed the one module that caused the original silent failure
  // ("Cannot find module 'next'") — not just that *some* files exist in `dest`.
  const copiedEntries = assertNonEmptyDir(dest, "packaged app-server node_modules");
  assertExists(path.join(dest, "next"), "packaged 'next' module");

  // The server script itself, and the frozen whisper worker — both are produced by earlier
  // steps in `npm run electron:pack` (postbuild-standalone.js and worker:build
  // respectively). If either is missing here, the resulting installer would either not start
  // at all or silently lack local transcription — both are exactly the "apparently valid
  // installer" failure modes this whole check exists to prevent. The whisper worker check is
  // intentionally a warning, not a hard failure: a build deliberately run without
  // `worker:build` (e.g. CI producing an installer for manual QA of everything except
  // transcription) is a real, occasionally-legitimate case, and electron/main.js's own
  // isPackaged-and-missing-worker startup guard is the actual hard stop for END USERS running
  // a truly broken install — this check's job is just to make sure that state is visible at
  // packaging time, not to forbid it outright.
  assertExists(path.join(appServerDir, "server.js"), "Next.js standalone server.js");
  const workerExePath = path.join(appServerDir, "python", "dist", "whisper-worker.exe");
  if (!fs.existsSync(workerExePath)) {
    console.warn(
      `[afterPack] WARNING: frozen whisper-worker.exe not found at ${workerExePath}. ` +
        `This installer will refuse to start local transcription (see electron/main.js's ` +
        `packaged-worker guard) unless this was intentional (e.g. \`npm run worker:build\` was skipped on purpose).`,
    );
  }

  // The bundled speech model. Without it the first transcription needs the network (the failure P23.1 fixed), so an installer
  // without it must never be produced silently: a hard failure unless explicitly waived for a non-transcription QA build.
  assertModelSeed(appServerDir);

  console.log(`[afterPack] verified packaged node_modules (${copiedEntries.length} top-level entries, including 'next') at ${dest}`);
};

// Exported for unit testing (see scripts/__tests__/electron-builder-after-pack.test.js) — the
// real afterPack hook above can't be exercised directly without a full electron-builder
// context, but these pure assertion functions carry all the actual fail/pass logic.
exports.assertModelSeed = assertModelSeed;
exports.assertExists = assertExists;
exports.assertNonEmptyDir = assertNonEmptyDir;
