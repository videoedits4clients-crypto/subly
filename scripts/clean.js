// Removes build/packaging artifacts only — never touches %APPDATA%/subs
// (the user's actual projects/database/models) or source code. Run before
// every `electron:pack` so a stale release/ folder can never get swept into
// the next build's file trace again (see postbuild-standalone.js and the
// .gitignore comment on /release*/ for the bug this caused previously).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// release* is matched by pattern, not a fixed list — a hardcoded list once
// missed an ad-hoc `--config.directories.output=releaseN` used during
// iteration and let the multi-GB bloat bug back in (see
// postbuild-standalone.js, which has the same pattern-match fix).
const releaseDirs = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^release/i.test(e.name))
  .map((e) => e.name);

const targets = [
  ".next",
  ...releaseDirs,
  path.join("python", "build"),
  path.join("python", "dist"),
  path.join("python", "__pycache__"),
];

let failures = 0;
for (const rel of targets) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  try {
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`[clean] removed ${rel}`);
  } catch (err) {
    // Windows Defender / a lingering process (a just-killed Electron/SUBLY.exe
    // releasing its file handle) can hold a brief lock on a just-written
    // .exe/.asar — report and continue rather than aborting the whole clean;
    // the caller (postbuild-standalone / afterPack) always overwrites in
    // place, so a leftover locked file here is stale but harmless UNLESS it
    // survives all the way into the next package (that's caught separately —
    // see the .gitignore comment on why /release*/ must never exist at
    // `next build` time).
    failures++;
    console.warn(`[clean] could not remove ${rel} (likely locked): ${err.message}`);
  }
}
if (failures > 0) {
  console.warn(
    `[clean] ${failures} path(s) could not be removed — if any of these are release*/ directories, ` +
      `stop here and close any running SUBLY.exe/electron.exe before building, or the next build may embed them.`,
  );
}
