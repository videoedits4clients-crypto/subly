// Prepares assets/models-seed — the speech model that ships inside the Windows installer (see electron/model-seed.js).
//
//   node scripts/prepare-model-seed.js                 # download from huggingface.co (needs network, once, on the build machine)
//   node scripts/prepare-model-seed.js --from <dir>    # copy from an existing Hugging Face cache dir (e.g. an app's models folder)
//
// Every file is verified against a pinned SHA-256 (model.bin's is the LFS hash Hugging Face publishes), so a truncated or
// substituted download can never be packaged. assets/models-seed is git-ignored (≈ 480 MB); run `npm run model:seed` before
// `npm run electron:pack`. The packaging step refuses to produce an installer without it (scripts/electron-builder-after-pack.js).
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const REPO = "Systran/faster-whisper-small";
const REVISION = "536b0662742c02347bc0e980a01041f333bce120";
const REPO_DIR = "models--Systran--faster-whisper-small";
const FILES = {
  "config.json": "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828",
  "model.bin": "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
  "tokenizer.json": "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
  "vocabulary.txt": "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
};

const root = path.join(__dirname, "..");
const seedRoot = path.join(root, "assets", "models-seed");

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "subly-model-seed" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
          res.resume();
          resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

async function check() {
  const snapshotDir = path.join(seedRoot, REPO_DIR, "snapshots", REVISION);
  for (const [name, expected] of Object.entries(FILES)) {
    const file = path.join(snapshotDir, name);
    if (!fs.existsSync(file)) throw new Error(`${file} is missing — run "npm run model:seed"`);
    const actual = await sha256(file);
    if (actual !== expected) throw new Error(`${name}: SHA-256 mismatch — run "npm run model:seed"`);
  }
  if (fs.readFileSync(path.join(seedRoot, REPO_DIR, "refs", "main"), "utf8").trim() !== REVISION) throw new Error("refs/main does not match the pinned revision");
  console.log("model seed present and verified");
}

async function main() {
  if (process.argv.includes("--check")) return check();
  const fromIdx = process.argv.indexOf("--from");
  const from = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
  const snapshotDir = path.join(seedRoot, REPO_DIR, "snapshots", REVISION);
  fs.rmSync(seedRoot, { recursive: true, force: true });
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.mkdirSync(path.join(seedRoot, REPO_DIR, "refs"), { recursive: true });
  fs.writeFileSync(path.join(seedRoot, REPO_DIR, "refs", "main"), REVISION);

  for (const [name, expected] of Object.entries(FILES)) {
    const dest = path.join(snapshotDir, name);
    if (from) {
      const src = path.join(from, REPO_DIR, "snapshots", REVISION, name);
      if (!fs.existsSync(src)) throw new Error(`${src} not found — --from must be a Hugging Face cache dir holding revision ${REVISION}`);
      fs.copyFileSync(src, dest);
    } else {
      console.log(`downloading ${name}…`);
      await download(`https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`, dest);
    }
    const actual = await sha256(dest);
    if (actual !== expected) {
      fs.rmSync(seedRoot, { recursive: true, force: true });
      throw new Error(`${name}: SHA-256 mismatch (expected ${expected}, got ${actual}) — seed removed`);
    }
    console.log(`ok  ${name}  ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB  sha256 verified`);
  }
  console.log(`model seed ready at ${seedRoot}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = { REPO, REVISION, REPO_DIR, FILES };
