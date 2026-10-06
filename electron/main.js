// Electron main process — desktop shell for SUBLY.
//
// Spawns the existing Next.js app as a local, private server (the user never
// starts or sees this — it's an implementation detail of "launching SUBLY"),
// waits for it to come up, then opens a normal BrowserWindow pointed at it.
// All app data (SQLite project database, uploaded videos, exports, cached
// Whisper models) lives under Electron's per-user `userData` directory —
// never inside the installed application folder, and never a shared/cloud
// location. See docs/DESKTOP.md for the full architecture writeup.
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const { runMigrations } = require("./db-migrations");
const { ensureModelSeed } = require("./model-seed");

const DEBUG_LOG = path.join(require("os").tmpdir(), "subly-electron-debug.log");
function dlog(msg) {
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // best-effort debug log only
  }
}

let serverProcess = null;
let mainWindow = null;

// Without this, launching SUBLY a second time (e.g. double-clicking the desktop shortcut again
// by habit, or from the Start Menu while it's already open) spawns a SECOND, fully independent
// instance — its own server process on its own random port, its own BrowserWindow — with no
// coordination between the two. Confirmed live during P4 QA: both instances' servers start
// cleanly against the SAME %APPDATA%\subs\subly.db with no crash, but a user editing a project
// in one window while the other one autosaves a stale in-memory copy can silently lose the
// newer edit (plain last-write-wins at the SQLite level — nothing surfaces this to either
// window). `requestSingleInstanceLock` is the standard Electron fix: a second launch attempt
// gets refused the lock and quits immediately, and the ALREADY-RUNNING instance's own "second
// -instance" event fires so it can bring its existing window to the front instead — the user
// still gets a response to double-clicking the icon (the app comes forward), just not a second,
// silently-conflicting copy of it.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  dlog("second instance detected — another SUBLY instance already holds the lock, quitting");
  app.quit();
} else {
  app.on("second-instance", () => {
    dlog("second-instance event — focusing existing window");
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function tryOnce() {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/system/status", timeout: 1500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (serverProcess && serverProcess.exitCode !== null) {
          reject(new Error(`Local server exited early (code ${serverProcess.exitCode}).`));
          return;
        }
        if (Date.now() > deadline) reject(new Error("Local server did not respond in time."));
        else setTimeout(tryOnce, 300);
      });
      req.on("timeout", () => req.destroy());
    }
    tryOnce();
  });
}

/** Per-user app-data paths — never inside the read-only installed-app folder (desktop spec section 7/11). */
function appDataPaths() {
  const base = app.getPath("userData");
  return {
    base,
    dbPath: path.join(base, "subly.db"),
    uploadsDir: path.join(base, "uploads"),
    modelsDir: path.join(base, "models"),
    fontsCacheDir: path.join(base, "fonts-cache"),
    logsDir: path.join(base, "logs"),
  };
}

/**
 * First-run (or fresh-install) database bootstrap. Rather than shelling out
 * to the Prisma CLI at runtime (it's a dev tool — `@prisma/client`'s runtime
 * is what Next's standalone-output tracer bundles, but the CLI itself is NOT
 * bundled, so it's simply not there in a packaged build; confirmed by
 * actually trying it, not assumed), a pre-migrated EMPTY SQLite file
 * (prisma/template.db, produced once via `prisma db push` during
 * development — see package.json's "db:template" script) ships as a bundled
 * asset and is just copied into place. Simpler, faster, and has no
 * dependency on any tool being present at runtime.
 */
function ensureDatabase(resourcesRoot, dbPath) {
  dlog(`ensureDatabase: checking ${dbPath}`);
  if (fs.existsSync(dbPath)) {
    dlog("ensureDatabase: already exists, skipping");
    return;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const templatePath = path.join(resourcesRoot, "prisma", "template.db");
  dlog(`ensureDatabase: copying template from ${templatePath}`);
  fs.copyFileSync(templatePath, dbPath);
  dlog("ensureDatabase: done");
}

/** Seeds the per-user fonts-cache dir from the bundled pre-fetched set on first run, so exporting with a built-in font doesn't need network access (desktop spec section 16). */
function ensureFontsCacheSeed(resourcesRoot, fontsCacheDir) {
  if (fs.existsSync(fontsCacheDir) && fs.readdirSync(fontsCacheDir).length > 0) return;
  const seedDir = path.join(resourcesRoot, "assets", "fonts-cache-seed");
  if (!fs.existsSync(seedDir)) return; // graceful — falls back to network fetch, same as before this existed
  fs.mkdirSync(fontsCacheDir, { recursive: true });
  for (const file of fs.readdirSync(seedDir)) {
    fs.copyFileSync(path.join(seedDir, file), path.join(fontsCacheDir, file));
  }
  dlog(`ensureFontsCacheSeed: seeded ${fontsCacheDir} from ${seedDir}`);
}

async function startServer() {
  const port = await findFreePort();
  const { base, dbPath, uploadsDir, modelsDir, fontsCacheDir, logsDir } = appDataPaths();
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(modelsDir, { recursive: true });

  const isPackaged = app.isPackaged;
  // Packaged: resourcesRoot/app-server holds the Next `output: "standalone"`
  // build. Dev: run against the repo root's own standalone build (`npm run
  // build` produces .next/standalone) so `npm run electron:dev` needs no
  // separate `next start` — Electron itself owns the server's lifecycle.
  const resourcesRoot = isPackaged ? path.join(process.resourcesPath, "app-server") : path.join(__dirname, "..", ".next", "standalone");
  const serverScript = path.join(resourcesRoot, "server.js");

  if (!fs.existsSync(serverScript)) {
    throw new Error(
      `No standalone server build found at ${serverScript}. Run "npm run build" (or the desktop packaging script) first.`,
    );
  }

  await ensureDatabase(resourcesRoot, dbPath);
  // Additive schema catch-up for a database that already existed before this
  // launch (a fresh one, just copied from template.db above, is already
  // current — every migration below will simply no-op against it). See
  // db-migrations.js for the safety guarantees (never drops/recreates
  // anything, never touches existing row data, safe to run every launch).
  // A thrown error here is fatal-but-safe: it propagates to createWindow()'s
  // existing catch block below, which shows it in an error dialog and quits
  // rather than starting the server against a database it can't rely on.
  const { applied, alreadyUpToDate } = runMigrations(dbPath, { log: dlog });
  dlog(`db migrations: applied=[${applied.join(", ")}] alreadyUpToDate=[${alreadyUpToDate.join(", ")}]`);
  ensureFontsCacheSeed(resourcesRoot, fontsCacheDir);

  // The default speech model ships inside the installer; put it where the worker looks, so the first transcription needs no
  // network (see electron/model-seed.js). A dev checkout has no seed and keeps using the worker's own download.
  const modelSeed = ensureModelSeed({ seedDir: path.join(resourcesRoot, "assets", "models-seed"), modelsDir, log: dlog });
  dlog(`model seed: ${modelSeed.status}${modelSeed.error ? ` (${modelSeed.error})` : ""}`);

  // Frozen, Python-free transcription worker (python/build-worker.js) — this
  // is what makes the packaged app not need a system Python install at all.
  // Falls back to a system `python` + the raw script only when the frozen
  // exe hasn't been built (a normal state during quick local dev iteration).
  const frozenWorkerExe = path.join(resourcesRoot, "python", "dist", "whisper-worker.exe");
  const hasFrozenWorker = fs.existsSync(frozenWorkerExe);
  dlog(`frozen worker exe ${hasFrozenWorker ? "found" : "NOT found"} at ${frozenWorkerExe}`);

  // A PACKAGED build with no frozen worker is a corrupted/broken installation — it has no
  // system Python to fall back to, and the server-side desktop-mode guard (see
  // src/lib/transcription/index.ts LocalWhisperUnavailableError) would otherwise let the app
  // limp along into a state where every transcription attempt fails. Refusing to even start
  // the server gives a clear, immediate signal instead of a confusing runtime error deep
  // inside the first transcription a user tries. Dev (`electron:dev`, isPackaged=false) is
  // unaffected — a missing frozen worker there just means "haven't run `npm run worker:build`
  // yet", which local-provider.ts's own system-python fallback already covers.
  if (isPackaged && !hasFrozenWorker) {
    const msg = `Bundled transcription engine missing (expected at ${frozenWorkerExe}). This installation appears to be corrupted — please reinstall SUBLY.`;
    dlog(`FATAL: ${msg}`);
    throw new Error(msg);
  }

  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: `file:${dbPath}`,
    STORAGE_DRIVER: "local",
    SUBLY_UPLOADS_DIR: uploadsDir,
    SUBLY_MODEL_DIR: modelsDir,
    // diagnostics (src/lib/diagnostics.ts): where the transcription log goes, and what version wrote it
    SUBLY_LOG_DIR: logsDir,
    SUBLY_DATA_DIR: base,
    SUBLY_APP_VERSION: app.getVersion(),
    // With the bundled model in place nothing may reach for the network: no metadata check, no download attempt, no waiting on a
    // blocked connection. (Only set when the model is really there — a dev checkout without it still downloads.)
    ...(modelSeed.status === "present" || modelSeed.status === "seeded" ? { HF_HUB_OFFLINE: "1" } : {}),
    SUBLY_FONTS_CACHE_DIR: fontsCacheDir,
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    SUBLY_DESKTOP: "1",
    // NextAuth rejects requests to a host/port it doesn't recognize by
    // default — the desktop server binds to a fresh random port every
    // launch, so it can never be on an allowlist. Safe here: the server only
    // ever listens on 127.0.0.1, never reachable from outside this machine.
    AUTH_TRUST_HOST: "true",
    // NextAuth throws ("MissingSecret") without one — confirmed by actually launching a
    // packaged build with no AUTH_SECRET anywhere in its environment: every page navigation
    // (proxy.ts wraps them in NextAuth's own auth() middleware) logged a MissingSecret error.
    // The web build normally gets this from a real .env; the desktop build has none (see
    // scripts/postbuild-standalone.js — the bundled dev .env, with its hardcoded, publicly-
    // visible "dev-only-insecure-secret-change-me" placeholder, is deliberately excluded from
    // the packaged app). Generating a fresh random one per launch is fine, not just tolerable:
    // desktop mode's own auth check (src/lib/api-auth.ts requireUserId) never goes through
    // NextAuth's credentials/session flow at all — every request is already the one local user
    // — so nothing ever needs a session signed by this secret to still verify across a restart.
    AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
    ...(hasFrozenWorker ? { SUBLY_WHISPER_WORKER_EXE: frozenWorkerExe } : {}),
  };

  serverProcess = spawn(process.execPath, [serverScript], { env, cwd: resourcesRoot, stdio: "pipe" });
  serverProcess.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  await waitForServer(port, 30_000);
  console.log(`[electron] local server ready on 127.0.0.1:${port} (db: ${dbPath})`);
  return port;
}

async function createWindow() {
  dlog("createWindow: starting");
  try {
    const port = await startServer();
    dlog(`createWindow: server started on ${port}, creating BrowserWindow`);
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Load the dashboard directly, not "/" — the marketing homepage (with its
    // "Log in" / "Create subtitles" → /register links) is for the web SaaS
    // product and has no place in a no-account desktop app. src/proxy.ts also
    // hard-redirects "/", "/login", and "/register" to "/dashboard" under
    // SUBLY_DESKTOP=1 as a backstop for any stray navigation back to them.
    mainWindow.loadURL(`http://127.0.0.1:${port}/dashboard`);
    dlog("createWindow: loadURL called");
  } catch (err) {
    dlog(`createWindow: FAILED ${err && err.stack ? err.stack : err}`);
    dialog.showErrorBox("SUBLY couldn't start", String(err && err.message ? err.message : err));
    app.quit();
  }
}

// gotSingleInstanceLock is false only when another instance already holds the lock (handled
// above with app.quit()) — app.quit() itself is async, so this guard stops THIS process from
// still going on to open its own window/server in the meantime.
if (gotSingleInstanceLock) {
  dlog("main.js loaded, waiting for app.whenReady()");
  app.whenReady().then(() => {
    dlog("app.whenReady resolved");
    createWindow();
  });
}
process.on("uncaughtException", (err) => dlog(`uncaughtException: ${err && err.stack ? err.stack : err}`));

/** Kills the Next server AND everything it spawned (the whisper-worker.exe
 * sidecar, and on Windows that .exe's own PyInstaller-onefile inner process)
 * — a plain `.kill()` only signals the direct child, which reproducibly
 * leaves the sidecar (and its inner process) running as an orphan after the
 * app quits. `taskkill /t` walks the whole descendant tree from the server's
 * pid down. Same fix as local-whisper-sidecar.ts's stopSidecar(), applied
 * here too since this is the path that actually runs on every app quit. */
function killServerTree() {
  if (!serverProcess?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(serverProcess.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    serverProcess.kill();
  }
  serverProcess = null;
}

app.on("window-all-closed", () => {
  killServerTree();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  killServerTree();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
