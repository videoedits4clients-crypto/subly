// Freezes whisper_worker.py into a standalone whisper-worker.exe via
// PyInstaller — no system Python required to RUN the result (system Python
// is only needed on the machine that builds SUBLY itself, same as Node is
// needed to build but not to run the packaged app). Run with `npm run
// worker:build` before `npm run electron:pack`.
const { spawnSync } = require("child_process");
const path = require("path");

function sitePackagesAssetPath(pkg, subpath) {
  const probe = spawnSync("python", ["-c", `import ${pkg}, os; print(os.path.dirname(${pkg}.__file__))`], { encoding: "utf-8" });
  if (probe.status !== 0) throw new Error(`Could not locate ${pkg}: ${probe.stderr}`);
  return path.join(probe.stdout.trim(), subpath);
}

const assetsDir = sitePackagesAssetPath("faster_whisper", "assets");

const result = spawnSync(
  "pyinstaller",
  [
    "--onefile",
    "--name",
    "whisper-worker",
    "--clean",
    "--noconfirm",
    "--add-data",
    `${assetsDir};faster_whisper/assets`,
    "whisper_worker.py",
  ],
  { cwd: __dirname, stdio: "inherit" },
);

if (result.status !== 0) {
  console.error("PyInstaller build failed");
  process.exit(1);
}
console.log(`[build-worker] wrote ${path.join(__dirname, "dist", "whisper-worker.exe")}`);
