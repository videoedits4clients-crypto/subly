import { promises as fs } from "fs";
import path from "path";

/**
 * Discovers fonts actually installed on the Windows machine SUBLY is running
 * on, so the FontPicker can offer them alongside the bundled Google Fonts
 * (see fonts.ts). This only makes sense in the packaged desktop build — in
 * the web/SaaS product the Next server runs on a remote machine, not the
 * end user's, so "installed fonts" would mean the server's fonts, not
 * theirs (gated by the caller, see app/api/system/fonts/route.ts).
 *
 * Reads real SFNT (TTF/OTF/TTC) font files directly — just their table
 * directory, `name` table, and `head`/`OS/2` tables (a few hundred bytes per
 * file, not the whole font) — to extract actual family names and weights.
 * No fonts are ever bundled, copied into the app, or assumed to exist; a
 * name only appears here if a real font file on this machine produced it.
 */

export interface SystemFontFace {
  weight: number;
  italic: boolean;
  filePath: string;
}

export interface SystemFontFamily {
  name: string;
  faces: SystemFontFace[];
}

function fontDirs(): string[] {
  const dirs: string[] = [];
  const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  dirs.push(path.join(windir, "Fonts"));
  // Per-user "install for me only" fonts (no admin rights needed) — Windows
  // still lets a user install fonts without touching the system-wide folder.
  if (process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
  }
  return dirs;
}

const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc"]);

async function readChunk(fh: fs.FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

interface TableEntry {
  tag: string;
  offset: number;
  length: number;
}

/** Reads the sfnt header + table directory starting at `base` (0 for a plain TTF/OTF, or one of a TTC's per-font offsets). */
async function readTableDirectory(fh: fs.FileHandle, base: number): Promise<Map<string, TableEntry>> {
  const header = await readChunk(fh, base, 12);
  const numTables = header.readUInt16BE(4);
  const dirBuf = await readChunk(fh, base + 12, numTables * 16);
  const tables = new Map<string, TableEntry>();
  for (let i = 0; i < numTables; i++) {
    const rec = dirBuf.subarray(i * 16, i * 16 + 16);
    if (rec.length < 16) break;
    const tag = rec.toString("latin1", 0, 4);
    const offset = rec.readUInt32BE(8);
    const length = rec.readUInt32BE(12);
    tables.set(tag, { tag, offset, length });
  }
  return tables;
}

/** Decodes one `name` table record's raw bytes given its platform/encoding. */
function decodeNameBytes(buf: Buffer, platformId: number): string {
  if (platformId === 3 || platformId === 0) {
    // Windows (3) or Unicode (0) platform — UTF-16BE. Node has no native "utf16be"
    // decoder, so byte-swap to little-endian first and decode as utf16le.
    return Buffer.from(swap16(buf)).toString("utf16le");
  }
  // Macintosh (1) or anything else — treat as Latin1/ASCII, good enough for family names.
  return buf.toString("latin1");
}

function swap16(buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length - (buf.length % 2));
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

/** Extracts the best family name (Typographic Family, nameID 16, falling back to nameID 1) from a font's `name` table. */
async function readFamilyName(fh: fs.FileHandle, nameTable: TableEntry): Promise<string | null> {
  const header = await readChunk(fh, nameTable.offset, 6);
  const count = header.readUInt16BE(2);
  const stringOffset = header.readUInt16BE(4);
  const recordsBuf = await readChunk(fh, nameTable.offset + 6, count * 12);

  let nameId1: string | null = null;
  let nameId16: string | null = null;

  for (let i = 0; i < count; i++) {
    const rec = recordsBuf.subarray(i * 12, i * 12 + 12);
    if (rec.length < 12) break;
    const platformId = rec.readUInt16BE(0);
    const nameId = rec.readUInt16BE(6);
    const length = rec.readUInt16BE(8);
    const offset = rec.readUInt16BE(10);
    if (nameId !== 1 && nameId !== 16) continue;
    // Prefer Windows/Unicode platform records; skip anything else once we have one.
    if (platformId !== 3 && platformId !== 0 && nameId1 && nameId16) continue;
    if (length <= 0 || length > 400) continue;
    try {
      const strBuf = await readChunk(fh, nameTable.offset + stringOffset + offset, length);
      const decoded = decodeNameBytes(strBuf, platformId).replace(/\0+$/, "").trim();
      if (!decoded) continue;
      if (nameId === 16) nameId16 = decoded;
      else if (nameId === 1) nameId1 = decoded;
    } catch {
      // corrupt record — skip it, not the whole font
    }
  }

  return nameId16 || nameId1;
}

/** Reads `OS/2.usWeightClass` (falls back to `head.macStyle` bold bit) and `head.macStyle` italic bit. */
async function readWeightAndStyle(
  fh: fs.FileHandle,
  os2Table: TableEntry | undefined,
  headTable: TableEntry | undefined,
): Promise<{ weight: number; italic: boolean }> {
  let weight = 400;
  let italic = false;

  if (headTable && headTable.length >= 46) {
    const head = await readChunk(fh, headTable.offset + 44, 2);
    const macStyle = head.readUInt16BE(0);
    if (macStyle & 0x1) weight = 700; // bold bit, used only as a fallback below
    if (macStyle & 0x2) italic = true;
  }

  if (os2Table && os2Table.length >= 6) {
    const os2 = await readChunk(fh, os2Table.offset + 4, 2);
    const usWeightClass = os2.readUInt16BE(0);
    if (usWeightClass >= 100 && usWeightClass <= 1000) weight = usWeightClass;
  }

  return { weight: nearestStandardWeight(weight), italic };
}

/** Snaps an arbitrary usWeightClass (100-1000) to the nearest value our style model actually uses. */
function nearestStandardWeight(raw: number): number {
  const standard = [400, 500, 600, 700, 800, 900];
  if (raw < 450) return 400;
  return standard.reduce((best, w) => (Math.abs(w - raw) < Math.abs(best - raw) ? w : best), standard[0]);
}

/** Parses one sfnt font (at `base` within the file — 0 unless it's one entry of a TTC) and returns its family name + face info. */
async function parseSfntAt(fh: fs.FileHandle, base: number, filePath: string): Promise<{ name: string; face: SystemFontFace } | null> {
  const tables = await readTableDirectory(fh, base);
  const nameTable = tables.get("name");
  if (!nameTable) return null;
  const name = await readFamilyName(fh, nameTable);
  if (!name) return null;
  const { weight, italic } = await readWeightAndStyle(fh, tables.get("OS/2"), tables.get("head"));
  return { name, face: { weight, italic, filePath } };
}

async function parseFontFile(filePath: string): Promise<{ name: string; face: SystemFontFace }[]> {
  let fh: fs.FileHandle | null = null;
  try {
    fh = await fs.open(filePath, "r");
    const magic = await readChunk(fh, 0, 4);
    const tag = magic.toString("latin1");

    if (tag === "ttcf") {
      // TrueType Collection — a header listing offsets to each embedded font.
      const ttcHeader = await readChunk(fh, 0, 12);
      const numFonts = ttcHeader.readUInt32BE(8);
      const offsetsBuf = await readChunk(fh, 12, numFonts * 4);
      const results: { name: string; face: SystemFontFace }[] = [];
      for (let i = 0; i < numFonts; i++) {
        const base = offsetsBuf.readUInt32BE(i * 4);
        const parsed = await parseSfntAt(fh, base, filePath);
        if (parsed) results.push(parsed);
      }
      return results;
    }

    // Plain sfnt (TTF: 0x00010000 or 'true'/'typ1'; OTF: 'OTTO').
    if (tag === "OTTO" || magic.readUInt32BE(0) === 0x00010000 || tag === "true" || tag === "typ1") {
      const parsed = await parseSfntAt(fh, 0, filePath);
      return parsed ? [parsed] : [];
    }
    return [];
  } catch {
    return []; // corrupt/unreadable font file — skip it, never fail the whole scan
  } finally {
    await fh?.close().catch(() => {});
  }
}

async function listFontFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && FONT_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => path.join(dir, e.name));
  } catch {
    return []; // directory missing/unreadable — not fatal, just contributes nothing
  }
}

/** Runs a batch of async tasks with a concurrency cap, so scanning a folder of 500+ fonts doesn't open 500 file handles at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

let cache: SystemFontFamily[] | null = null;

/** Scans the Windows font directories once per server process lifetime (fonts don't change while the app is running) and returns deduplicated families sorted alphabetically. */
export async function getSystemFonts(): Promise<SystemFontFamily[]> {
  if (cache) return cache;
  if (process.platform !== "win32") {
    cache = [];
    return cache;
  }

  const dirs = fontDirs();
  const filesPerDir = await Promise.all(dirs.map(listFontFiles));
  const files = filesPerDir.flat();

  const parsedPerFile = await mapWithConcurrency(files, 16, parseFontFile);

  const byFamily = new Map<string, SystemFontFace[]>();
  for (const parsed of parsedPerFile.flat()) {
    const existing = byFamily.get(parsed.name);
    if (existing) existing.push(parsed.face);
    else byFamily.set(parsed.name, [parsed.face]);
  }

  cache = Array.from(byFamily.entries())
    .map(([name, faces]) => ({ name, faces }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

/** Test-only escape hatch — the module cache means a real Windows install is scanned once and reused for the process lifetime, which is by design (fonts don't change mid-session) but needs to be resettable in tests. */
export function _resetSystemFontsCacheForTests(): void {
  cache = null;
}

/** Looks up the best-matching installed file for a (family, weight) pair — closest weight among the family's non-italic faces, falling back to any face at all. Returns null if the family isn't currently installed. */
export function resolveSystemFontFile(families: SystemFontFamily[], family: string, weight: number): string | null {
  const match = families.find((f) => f.name === family);
  if (!match || match.faces.length === 0) return null;
  const candidates = match.faces.filter((f) => !f.italic);
  const pool = candidates.length ? candidates : match.faces;
  return pool.reduce((best, f) => (Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best), pool[0])
    .filePath;
}
