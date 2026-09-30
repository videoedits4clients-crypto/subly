import { promises as fs } from "fs";
import path from "path";
import type { PutResult, StorageDriver } from "./types";

// All local files live under <repo>/data/uploads by default (web dev/deploy),
// or SUBLY_UPLOADS_DIR when set — the desktop build points this at a
// per-user app-data directory (electron/main.js) rather than inside the
// installed, often read-only, application folder. Served through
// /api/files/[...key] (see src/app/api/files/[...key]/route.ts) so the rest of
// the app never cares whether storage is local disk or S3 — both expose a URL.
const ROOT = process.env.SUBLY_UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

/**
 * Resolves a storage key to an absolute path guaranteed to stay inside ROOT.
 * `key` ultimately comes from a URL path segment (the /api/files/[...key]
 * catch-all route), so a request for a key like "../../../etc/passwd" (or its
 * encoded/backslash variants) must never be able to escape the uploads
 * directory. path.join alone does NOT protect against this — it happily
 * collapses ".." segments right past ROOT.
 */
function resolveSafePath(key: string): string {
  const normalized = path.normalize(key).replace(/^([/\\]|\.\.[/\\])+/, "");
  const abs = path.resolve(ROOT, normalized);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (abs !== ROOT && !abs.startsWith(rootWithSep)) {
    throw new Error(`Refusing to resolve storage key outside root: ${key}`);
  }
  return abs;
}

export class LocalStorageDriver implements StorageDriver {
  async put(key: string, data: Buffer): Promise<PutResult> {
    const abs = resolveSafePath(key);
    await ensureDir(path.dirname(abs));
    await fs.writeFile(abs, data);
    return { key, url: this.publicUrl(key) };
  }

  async getPath(key: string): Promise<string> {
    return resolveSafePath(key);
  }

  async del(key: string): Promise<void> {
    await fs.rm(resolveSafePath(key), { force: true });
  }

  async delDir(prefix: string): Promise<void> {
    // resolveSafePath already refuses anything that would resolve outside ROOT (e.g. a
    // "../sibling-project" prefix) — but a project's own directory is a single path segment
    // one level under ROOT (see the <projectId>/... key layout used throughout: source.mp4,
    // audio.wav, exports/*), so this ALSO rejects a prefix containing its own traversal or
    // separator characters outright, rather than relying on resolveSafePath's containment
    // check alone. This is what keeps "permanently delete project A" from ever being able to
    // reach into project B's files even if a caller passed something unexpected.
    if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
      throw new Error(`Refusing to delete an unsafe storage prefix: ${JSON.stringify(prefix)}`);
    }
    const abs = resolveSafePath(prefix);
    await fs.rm(abs, { recursive: true, force: true });
  }

  async copy(srcKey: string, destKey: string): Promise<PutResult> {
    const src = resolveSafePath(srcKey);
    const dest = resolveSafePath(destKey);
    await ensureDir(path.dirname(dest));
    await fs.copyFile(src, dest);
    return { key: destKey, url: this.publicUrl(destKey) };
  }

  publicUrl(key: string): string {
    return `/api/files/${key.split(path.sep).join("/")}`;
  }

  describeLocation(): string {
    return ROOT;
  }
}
