// Next.js's `output: "standalone"` deliberately does NOT copy `.next/static`
// or `public/` into the standalone folder (they're meant to be served by a
// CDN in a typical deployment) — but SUBLY's desktop build IS the entire
// deployment, so without this step every CSS/JS asset and font 404s and the
// app renders unstyled. This is a well-known standalone-mode gotcha
// (documented in Next's own release notes), confirmed here by actually
// running the built output and seeing exactly that failure.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

// Next's `output: "standalone"` copies the ENTIRE project root alongside the
// traced node_modules (not just traced source files) — confirmed by directly
// inspecting .next/standalone's contents, and `outputFileTracingExcludes` in
// next.config.ts did NOT prevent this for these specific folders in testing.
// A stale desktop-packaging output folder sitting in the repo root at build
// time therefore gets copied INTO the new standalone output — and if that
// output is then itself packaged, the result contains nested copies of
// itself, ballooning from ~250MB to multiple GB. `npm run clean` deletes
// these first as the primary defense; this is the belt-and-suspenders
// backstop that guarantees it regardless.
// Matched by NAME PATTERN, not a fixed list — a hardcoded list of exactly
// ["release", "release2", "release3"] once let a later ad-hoc `--config.
// directories.output=release5` (used during iteration/testing) slip through
// uncaught and re-introduce the multi-GB bloat this is meant to prevent.
//
// `research/` (multi-GB Gujarati/Hindi/Hinglish benchmark datasets — see the various
// research/*_benchmark directories) got swept in the same way once it grew past a few files,
// and went unnoticed until a real `electron:pack` run produced an installer NSIS refused to
// finish writing ("Generated installer is smaller than the embedded archive(s)") because the
// embedded archive had ballooned to 5+ GB. `python/` is swept in whole too (including
// python/build/, PyInstaller's ~400MB of intermediate build artifacts, never needed at
// runtime) — removed here and re-created below with just the one file the packaged app
// actually needs (python/dist/whisper-worker.exe).
const STRAY_DIR_NAMES = [/^release/i, /^research$/i, /^python$/i];

// Same "entire project root got copied in" behavior as above, but for things that aren't huge
// enough to break the build (so they went unnoticed) — confirmed by directly inspecting a real
// packaged installer's resources/app-server/ directory:
//  - data/  is the DEV-machine default upload root (src/lib/storage/local.ts's `process.cwd()`
//    fallback, used whenever SUBLY_UPLOADS_DIR isn't set — i.e. every plain `npm run dev`/`npm
//    run build`). It had real leftover developer QA videos/exports/audio in it and was shipping
//    to every end user's machine inside their installed app. The packaged app NEVER reads from
//    here — electron/main.js always sets SUBLY_UPLOADS_DIR to a per-user app-data path before
//    the server starts — so this is pure accidental leakage, not a runtime dependency.
//  - src/  is the full uncompiled TypeScript source tree. The standalone server only ever runs
//    the already-compiled output under .next/server; nothing here is `require()`d at runtime.
//    Shipping it just hands every end user the app's complete source for no functional reason.
//  - electron/ and scripts/ are copies of files electron-builder already bundles correctly
//    itself (electron/**/* via the `files` config) or that only matter at build time
//    (scripts/*.js) — server.js never reads from either at runtime.
//  - .env is the dev template (`DATABASE_URL="file:./dev.db"`, a placeholder
//    `AUTH_SECRET="dev-only-insecure-secret-change-me"`, empty API keys). Next's own
//    `@next/env` loads whatever `.env` sits next to server.js at startup, so shipping this
//    means every single packaged install would load the exact same hardcoded, publicly-visible
//    "insecure-change-me" auth secret — harmless in practice (SUBLY_DESKTOP mode never
//    exercises NextAuth's credential/session flow at all, see src/lib/api-auth.ts), but there's
//    no reason to ship it, and every real value it might set is already overridden by
//    electron/main.js's own explicit env before the server ever starts.
//  - package-lock.json/tsconfig.json/tsconfig.tsbuildinfo/eslint.config.mjs/postcss.config.mjs
//    are pure dev tooling with zero runtime relevance. THIRD_PARTY_NOTICES.txt is deliberately
//    NOT in this list — that one is real license-attribution content that should ship.
//  - AGENTS.md/CLAUDE.md/README.md are project/agent-instruction docs (see repo root) — never
//    read by server.js at runtime, no reason for every end user's install to carry them (found
//    shipping in resources/app-server/ by P19.13's packaged-app pre-flight inspection).
const STRAY_ENTRY_NAMES = [
  "data",
  "src",
  "electron",
  "scripts",
  ".env",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.tsbuildinfo",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
];

// Stray dev-only snapshot/backup files (e.g. a QA `.db.bak-*` marker copied from the repo root
// alongside everything else `output: "standalone"` sweeps in — see the top-of-file comment).
// Matched by PATTERN, not a fixed name, for the same reason STRAY_DIR_NAMES above is pattern-
// matched: a one-off QA snapshot's exact filename will differ next time one gets left at the
// repo root, and a fixed-name list would silently miss it (P19.13 found one such file,
// `UsersUserAppDataRoamingsubssubly.db.bak-pre-p8-multi-caption-qa`, that a fixed list would only
// have caught by exact name).
const STRAY_FILE_PATTERNS = [/\.db\.bak/i];

/** Removes every known stray dir/file/pattern from a standalone output directory. Pulled out as
 * its own function (rather than inlined into this script's top-level run) so a test can exercise
 * the actual sweep logic against a throwaway directory instead of the real .next/standalone —
 * see scripts/__tests__/postbuild-standalone.test.js. */
function sweepStrayEntries(standaloneDir) {
  const removed = [];
  for (const entry of fs.readdirSync(standaloneDir, { withFileTypes: true })) {
    const isStrayDir = entry.isDirectory() && STRAY_DIR_NAMES.some((re) => re.test(entry.name));
    const isStrayFile = entry.isFile() && STRAY_FILE_PATTERNS.some((re) => re.test(entry.name));
    if (isStrayDir || isStrayFile) {
      fs.rmSync(path.join(standaloneDir, entry.name), { recursive: true, force: true });
      console.log(`[postbuild] removed stray ${entry.name}${isStrayDir ? "/" : ""} that got swept into the standalone output`);
      removed.push(entry.name);
    }
  }
  for (const name of STRAY_ENTRY_NAMES) {
    const p = path.join(standaloneDir, name);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      console.log(`[postbuild] removed stray ${name} that got swept into the standalone output`);
      removed.push(name);
    }
  }
  return removed;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

if (require.main === module) {
  sweepStrayEntries(standalone);

  copyDir(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
  copyDir(path.join(root, "public"), path.join(standalone, "public"));
  // The dev-only sqlite file has no business in a distributable build.
  fs.rmSync(path.join(standalone, "prisma", "dev.db"), { force: true });
  // The empty-schema template SQLite the Electron shell copies on first run
  // (see electron/main.js ensureDatabase) — regenerate with `npm run db:template` if schema.prisma changes.
  fs.copyFileSync(path.join(root, "prisma", "template.db"), path.join(standalone, "prisma", "template.db"));

  // Pre-fetched Google Fonts files for SUBLY's built-in font list, so the
  // desktop build's first export of each font doesn't need network access
  // (desktop spec section 16, offline-first) — copied into the per-user
  // fonts-cache dir on first run by electron/main.js. Not exhaustive (fonts a
  // user never selects are never pre-cached), but covers the built-in set.
  copyDir(path.join(root, "assets", "fonts-cache-seed"), path.join(standalone, "assets", "fonts-cache-seed"));

  // The default speech model, bundled so the first transcription needs no network (electron/model-seed.js copies it into the
  // per-user models folder on first run). Optional here — a plain web/dev build has no seed — but the desktop packaging step
  // (scripts/electron-builder-after-pack.js) refuses to produce an installer without it.
  copyDir(path.join(root, "assets", "models-seed"), path.join(standalone, "assets", "models-seed"));

  // The frozen, Python-free transcription worker (see python/build-worker.js /
  // `npm run worker:build`) — optional here so a plain `npm run build` (web
  // dev/deploy, no desktop packaging) doesn't require it to exist.
  const workerExe = path.join(root, "python", "dist", "whisper-worker.exe");
  if (fs.existsSync(workerExe)) {
    fs.mkdirSync(path.join(standalone, "python", "dist"), { recursive: true });
    fs.copyFileSync(workerExe, path.join(standalone, "python", "dist", "whisper-worker.exe"));
    console.log("[postbuild] copied whisper-worker.exe into .next/standalone/python/dist");
  }

  console.log("[postbuild] copied .next/static, public/, and prisma/template.db into .next/standalone");
}

module.exports = { sweepStrayEntries, STRAY_DIR_NAMES, STRAY_ENTRY_NAMES, STRAY_FILE_PATTERNS };
