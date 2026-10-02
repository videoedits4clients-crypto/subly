/**
 * Makes cached font files matchable by libass (the renderer behind FFmpeg's `subtitles=` filter).
 *
 * Google Fonts serves a weighted face as a static instance whose legacy family name (nameID 1) carries
 * the weight: "Inter ExtraBold", "Archivo ExtraBold", "Baloo 2 ExtraBold", "Poppins ExtraBold". The ASS
 * `Fontname` the export writes is the plain family ("Inter"). On a machine where that family is not
 * installed system-wide, libass could not match "Inter" to a file whose family is "Inter ExtraBold" and
 * silently fell back to Arial — confirmed with real FFmpeg frames: Archivo, Inter and Baloo 2 all
 * exported as Arial from the cache directory alone (fonts that happened to be installed on the
 * developer's machine, e.g. Poppins/Montserrat, hid the problem).
 *
 * The fix rewrites each face's nameID 1 to its real family:
 *   - the typographic family (nameID 16) when the face has one ("Inter ExtraBold" → "Inter"); otherwise
 *   - the legacy name with a trailing weight word removed ("Poppins ExtraBold" → "Poppins") — but ONLY when
 *     the face's OS/2 weight class is not 400, so a family that genuinely ends in a weight word at regular
 *     weight ("Archivo Black") is left alone.
 * Each weight keeps its own OS/2 weight class, so when several weights of one family sit in the cache
 * libass still picks the one closest to the requested weight. The name table is rebuilt and appended at
 * the end of the file (the table directory is repointed); nothing else is touched, and FreeType does not
 * verify table checksums. Faces whose nameID 1 is already the family (Oswald, Caveat, Kalam, …) are
 * returned unchanged.
 */

const WEIGHT_WORDS = /\s+(Thin|Hairline|ExtraLight|UltraLight|Light|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy)$/i;

interface NameRecord {
  platform: number;
  encoding: number;
  language: number;
  nameId: number;
  bytes: Uint8Array;
}

function decode(rec: NameRecord): string {
  if (rec.platform === 3 || rec.platform === 0) {
    let s = "";
    for (let i = 0; i + 1 < rec.bytes.length; i += 2) s += String.fromCharCode((rec.bytes[i] << 8) | rec.bytes[i + 1]);
    return s;
  }
  return String.fromCharCode(...rec.bytes);
}

function encode(rec: NameRecord, text: string): Uint8Array {
  if (rec.platform === 3 || rec.platform === 0) {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      out[i * 2] = text.charCodeAt(i) >> 8;
      out[i * 2 + 1] = text.charCodeAt(i) & 0xff;
    }
    return out;
  }
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}

/** Returns a patched copy, or null when nothing needed changing (or the buffer isn't a usable TrueType/OpenType font). */
export function normalizeFontFamilyNames(font: Uint8Array): Uint8Array | null {
  if (font.length < 12) return null;
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = view.getUint16(4);
  if (12 + numTables * 16 > font.length) return null;

  let nameRecordAt = -1;
  let nameOffset = -1;
  let weightClass = 400;
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(font[at], font[at + 1], font[at + 2], font[at + 3]);
    const offset = view.getUint32(at + 8);
    if (tag === "name") {
      nameRecordAt = at;
      nameOffset = offset;
    } else if (tag === "OS/2" && offset + 6 <= font.length) {
      weightClass = view.getUint16(offset + 4);
    }
  }
  if (nameRecordAt < 0 || nameOffset + 6 > font.length) return null;
  if (view.getUint16(nameOffset) !== 0) return null; // format 1 (language-tag records) isn't rebuilt

  const count = view.getUint16(nameOffset + 2);
  const storage = nameOffset + view.getUint16(nameOffset + 4);
  if (nameOffset + 6 + count * 12 > font.length) return null;
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const at = nameOffset + 6 + i * 12;
    const length = view.getUint16(at + 8);
    const offset = storage + view.getUint16(at + 10);
    if (offset + length > font.length) return null;
    records.push({
      platform: view.getUint16(at),
      encoding: view.getUint16(at + 2),
      language: view.getUint16(at + 4),
      nameId: view.getUint16(at + 6),
      bytes: font.slice(offset, offset + length),
    });
  }

  let changed = false;
  for (const family of records) {
    if (family.nameId !== 1) continue;
    const same = (r: NameRecord) => r.platform === family.platform && r.encoding === family.encoding && r.language === family.language;
    const typographic = records.find((r) => r.nameId === 16 && same(r));
    const legacy = decode(family);
    let wanted: string | null = null;
    if (typographic) wanted = decode(typographic);
    else if (weightClass !== 400 && WEIGHT_WORDS.test(legacy)) wanted = legacy.replace(WEIGHT_WORDS, "");
    if (wanted && wanted !== legacy) {
      family.bytes = encode(family, wanted);
      changed = true;
    }
  }
  if (!changed) return null;

  // Rebuild the (format 0) name table: header + records + string storage, appended at the end of the file.
  const headerSize = 6 + records.length * 12;
  let storageSize = 0;
  for (const r of records) storageSize += r.bytes.length;
  if (storageSize > 0xffff) return null;
  const table = new Uint8Array(headerSize + storageSize);
  const tv = new DataView(table.buffer);
  tv.setUint16(0, 0);
  tv.setUint16(2, records.length);
  tv.setUint16(4, headerSize);
  let cursor = 0;
  records.forEach((r, i) => {
    const at = 6 + i * 12;
    tv.setUint16(at, r.platform);
    tv.setUint16(at + 2, r.encoding);
    tv.setUint16(at + 4, r.language);
    tv.setUint16(at + 6, r.nameId);
    tv.setUint16(at + 8, r.bytes.length);
    tv.setUint16(at + 10, cursor);
    table.set(r.bytes, headerSize + cursor);
    cursor += r.bytes.length;
  });

  const pad = (4 - (font.length % 4)) % 4;
  const out = new Uint8Array(font.length + pad + table.length);
  out.set(font);
  out.set(table, font.length + pad);
  const ov = new DataView(out.buffer);
  ov.setUint32(nameRecordAt + 8, font.length + pad);
  ov.setUint32(nameRecordAt + 12, table.length);
  return out;
}
