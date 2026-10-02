/**
 * P20.2 — cached font files must be matchable by libass. A weighted Google Fonts face has a legacy
 * family name like "Inter ExtraBold" / "Poppins ExtraBold"; the ASS Fontname is the plain family
 * ("Inter"), which libass could not match from the cache directory alone, so Archivo / Inter / Baloo 2
 * (and every style using them — the default style included) exported as Arial on machines without those
 * fonts installed. See lib/fonts/font-name-normalize.ts. Tests run on the real fonts bundled in
 * assets/fonts-cache-seed plus synthetic fonts for the structural edge cases.
 *
 * Run with: node --test src/lib/__tests__/font-name-normalize.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeFontFamilyNames } from "../fonts/font-name-normalize.ts";

const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "fonts-cache-seed");

/** name-table strings of one font, keyed by nameID (Windows records only). */
function names(font: Uint8Array): Record<number, string> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  let nameOffset = -1;
  for (let i = 0; i < view.getUint16(4); i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(font[rec], font[rec + 1], font[rec + 2], font[rec + 3]) === "name") nameOffset = view.getUint32(rec + 8);
  }
  const count = view.getUint16(nameOffset + 2);
  const storage = nameOffset + view.getUint16(nameOffset + 4);
  const out: Record<number, string> = {};
  for (let i = 0; i < count; i++) {
    const at = nameOffset + 6 + i * 12;
    if (view.getUint16(at) !== 3) continue;
    const length = view.getUint16(at + 8);
    const offset = view.getUint16(at + 10);
    let s = "";
    for (let k = 0; k < length; k += 2) s += String.fromCharCode(view.getUint16(storage + offset + k));
    out[view.getUint16(at + 6)] = s;
  }
  return out;
}
const seed = (file: string) => new Uint8Array(readFileSync(path.join(SEED_DIR, file)));

/** A minimal sfnt with just an OS/2 and a (format 0, Windows/Unicode) name table. */
function synthetic(strings: Record<number, string>, weightClass: number): Uint8Array {
  const enc = (s: string) => {
    const b = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      b[i * 2] = s.charCodeAt(i) >> 8;
      b[i * 2 + 1] = s.charCodeAt(i) & 255;
    }
    return b;
  };
  const ids = Object.keys(strings).map(Number).sort((a, b) => a - b);
  const header = 6 + ids.length * 12;
  const bodies = ids.map((id) => enc(strings[id]));
  const nameTable = new Uint8Array(header + bodies.reduce((n, b) => n + b.length, 0));
  const nv = new DataView(nameTable.buffer);
  nv.setUint16(2, ids.length);
  nv.setUint16(4, header);
  let cursor = 0;
  ids.forEach((id, i) => {
    const at = 6 + i * 12;
    nv.setUint16(at, 3);
    nv.setUint16(at + 2, 1);
    nv.setUint16(at + 4, 0x409);
    nv.setUint16(at + 6, id);
    nv.setUint16(at + 8, bodies[i].length);
    nv.setUint16(at + 10, cursor);
    nameTable.set(bodies[i], header + cursor);
    cursor += bodies[i].length;
  });
  const os2 = new Uint8Array(78);
  new DataView(os2.buffer).setUint16(4, weightClass);
  const dirEnd = 12 + 2 * 16;
  const font = new Uint8Array(dirEnd + os2.length + ((4 - (os2.length % 4)) % 4) + nameTable.length);
  const fv = new DataView(font.buffer);
  fv.setUint32(0, 0x00010000);
  fv.setUint16(4, 2);
  const put = (slot: number, tag: string, offset: number, length: number) => {
    const at = 12 + slot * 16;
    for (let i = 0; i < 4; i++) font[at + i] = tag.charCodeAt(i);
    fv.setUint32(at + 8, offset);
    fv.setUint32(at + 12, length);
  };
  put(0, "OS/2", dirEnd, os2.length);
  font.set(os2, dirEnd);
  const nameAt = dirEnd + os2.length + ((4 - (os2.length % 4)) % 4);
  put(1, "name", nameAt, nameTable.length);
  font.set(nameTable, nameAt);
  return font;
}

test("typographic family present: 'Inter ExtraBold' (nameID 1) becomes 'Inter' (the real nameID 16)", () => {
  const original = seed("inter-800.ttf");
  assert.equal(names(original)[1], "Inter ExtraBold");
  assert.equal(names(original)[16], "Inter");
  const patched = normalizeFontFamilyNames(original);
  assert.ok(patched, "must report a change");
  const n = names(patched);
  assert.equal(n[1], "Inter", "the family libass matches on");
  assert.equal(n[16], "Inter");
  assert.equal(n[4], "Inter ExtraBold", "the full name is untouched");
});

test("no typographic family: 'Poppins ExtraBold' (weight 800) becomes 'Poppins'", () => {
  const original = seed("poppins-800.ttf");
  assert.equal(names(original)[1], "Poppins ExtraBold");
  assert.equal(names(original)[16], undefined);
  assert.equal(names(normalizeFontFamilyNames(original)!)[1], "Poppins");
});

test("the input buffer is never mutated; the result keeps every original byte except the name table's directory entry, and appends the rebuilt table", () => {
  const original = seed("archivo-800.ttf");
  const copy = new Uint8Array(original);
  const patched = normalizeFontFamilyNames(original)!;
  assert.deepEqual(original, copy);
  assert.ok(patched.length > original.length, "the rebuilt name table is appended");
  const numTables = new DataView(original.buffer, original.byteOffset).getUint16(4);
  const differing: number[] = [];
  for (let i = 0; i < original.length; i++) if (original[i] !== patched[i]) differing.push(i);
  assert.ok(differing.length > 0 && differing.length <= 8, `only the name table's offset+length may change (${differing.length} bytes did)`);
  assert.ok(differing.every((i) => i >= 12 && i < 12 + numTables * 16), "…and they are all inside the table directory");
});

test("idempotent: normalizing an already-normalized font changes nothing", () => {
  for (const f of ["montserrat-800.ttf", "poppins-800.ttf", "baloo-2-800.ttf"].filter((x) => readdirSync(SEED_DIR).includes(x))) {
    const once = normalizeFontFamilyNames(seed(f))!;
    assert.equal(normalizeFontFamilyNames(once), null, f);
  }
});

test("fonts whose nameID 1 is already the family are returned unchanged (null)", () => {
  for (const f of ["oswald-700.ttf", "caveat-700.ttf", "kalam-700.ttf", "bangers-400.ttf", "permanent-marker-400.ttf", "bebas-neue-400.ttf"]) {
    assert.equal(normalizeFontFamilyNames(seed(f)), null, f);
  }
});

test("a family that genuinely ends in a weight word at REGULAR weight ('Archivo Black') is not touched", () => {
  const black = synthetic({ 1: "Archivo Black", 2: "Regular", 4: "Archivo Black Regular" }, 400);
  assert.equal(normalizeFontFamilyNames(black), null);
  const weighted = synthetic({ 1: "Poppins ExtraBold", 2: "Regular", 4: "Poppins ExtraBold" }, 800);
  assert.equal(names(normalizeFontFamilyNames(weighted)!)[1], "Poppins");
  const multiWord = synthetic({ 1: "Plus Jakarta Sans ExtraBold", 2: "Regular" }, 800);
  assert.equal(names(normalizeFontFamilyNames(multiWord)!)[1], "Plus Jakarta Sans");
  const noSuffix = synthetic({ 1: "Playfair Display", 2: "Bold" }, 700);
  assert.equal(normalizeFontFamilyNames(noSuffix), null);
});

test("every bundled seed font ends up with a plain family name (no weight suffix) in nameID 1", () => {
  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith(".ttf"));
  assert.ok(files.length >= 20);
  for (const f of files) {
    const font = seed(f);
    const out = normalizeFontFamilyNames(font) ?? font;
    const n = names(out);
    if (n[16]) assert.equal(n[1], n[16], `${f}: nameID 1 must equal the typographic family`);
    assert.ok(n[1] && !/ (ExtraBold|SemiBold|Black|Medium|Light)$/.test(n[1]), `${f}: family "${n[1]}" still carries a weight suffix`);
  }
});

test("the four P20.2 fonts are bundled for offline export", () => {
  const files = new Set(readdirSync(SEED_DIR));
  for (const f of ["caveat-700.ttf", "kalam-700.ttf", "bangers-400.ttf", "permanent-marker-400.ttf"]) assert.ok(files.has(f), `${f} missing from assets/fonts-cache-seed`);
});

test("garbage / truncated input is handled without throwing", () => {
  assert.equal(normalizeFontFamilyNames(new Uint8Array(0)), null);
  assert.equal(normalizeFontFamilyNames(new Uint8Array(11)), null);
  assert.equal(normalizeFontFamilyNames(new Uint8Array(200)), null, "no name table");
  const truncated = seed("inter-800.ttf").slice(0, 200);
  assert.doesNotThrow(() => normalizeFontFamilyNames(truncated));
});
