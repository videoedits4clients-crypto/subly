/**
 * Font metrics for subtitle typography parity (P20.4).
 *
 * WHY THIS EXISTS. The editor preview sets text in CSS: `font-size` is the font's EM, `line-height`
 * is a multiple of it, and the browser places the baseline using the font's hhea (or typo) ascent /
 * descent. The export hands the same style to libass as an ASS `Fontsize`, and libass does NOT read
 * that as an em: following VSFilter/GDI it scales the face so that its WINDOWS cell height
 * (OS/2 usWinAscent + usWinDescent) equals `Fontsize`:
 *
 *     em_px = Fontsize × unitsPerEm / (winAscent + winDescent)
 *
 * so for the same logical size the exported glyphs were smaller than the preview's by exactly
 * (winAscent + winDescent) / unitsPerEm — 1.20 for Roboto up to 1.76 for Poppins, which is precisely
 * what the P20.3 audit measured (ratios agree with the font tables to two decimals; see
 * docs/STYLE-FAMILIES.md and typography-metrics.test.ts). libass also spaces lines by that same cell
 * height (not by CSS line-height), puts the bottom anchor `winDescent` below the baseline and the top
 * anchor `winAscent` above it — all verified on real FFmpeg renders.
 *
 * This module only READS font files: it parses the handful of tables needed (head, hhea, OS/2, hmtx,
 * cmap) into plain JSON-serialisable data, which the preview (via an API route) and the export share.
 * Summed advance widths are within ~1.2% of what the browser lays out (the difference is kerning), so
 * no shaping engine is needed.
 */

export interface FontMetricsData {
  unitsPerEm: number;
  /** Windows cell metrics — what libass scales to (positive magnitudes). */
  winAscent: number;
  winDescent: number;
  /** hhea metrics (positive magnitudes) — what browsers use unless the font asks for typo metrics. */
  hheaAscent: number;
  hheaDescent: number;
  typoAscent: number;
  typoDescent: number;
  /** OS/2 fsSelection bit 7: browsers then use the typo metrics instead of hhea. */
  useTypoMetrics: boolean;
  capHeight?: number;
  xHeight?: number;
  /** Advance (font units) used for any code point not in `advances`. */
  defaultAdvance: number;
  /** Advance width in font units, keyed by code point, for the code points requested at parse time. */
  advances: Record<number, number>;
}

/** Code points worth shipping by default: Basic Latin, Latin-1, Latin Extended-A, common punctuation,
 * Devanagari and Gujarati (the script-fallback fonts). */
export const DEFAULT_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x17f],
  [0x2000, 0x206f],
  [0x20a0, 0x20bf],
  [0x900, 0x97f],
  [0xa80, 0xaff],
];

function readTable(view: DataView, base: number, wanted: string): { offset: number; length: number } | null {
  const count = view.getUint16(base + 4);
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > view.byteLength) return null;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    if (tag === wanted) return { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
  }
  return null;
}

/** Builds a code point → glyph id lookup from the cmap (formats 4 and 12). */
function cmapLookup(view: DataView, cmapOffset: number): ((cp: number) => number) | null {
  const subtables = view.getUint16(cmapOffset + 2);
  let format4: number | null = null;
  let format12: number | null = null;
  for (let i = 0; i < subtables; i++) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const offset = cmapOffset + view.getUint32(rec + 4);
    const format = view.getUint16(offset);
    if (format === 12 && (platform === 3 || platform === 0)) format12 = offset;
    else if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0) && format4 === null) format4 = offset;
  }
  if (format12 !== null) {
    const groups = view.getUint32(format12 + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = format12! + 16 + mid * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return view.getUint32(at + 8) + (cp - start);
      }
      return 0;
    };
  }
  if (format4 !== null) {
    const segCountX2 = view.getUint16(format4 + 6);
    const segCount = segCountX2 / 2;
    const endBase = format4 + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;
    return (cp) => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < segCount; i++) {
        if (cp > view.getUint16(endBase + i * 2)) continue;
        const start = view.getUint16(startBase + i * 2);
        if (cp < start) return 0;
        const delta = view.getInt16(deltaBase + i * 2);
        const rangeOffset = view.getUint16(rangeBase + i * 2);
        if (rangeOffset === 0) return (cp + delta) & 0xffff;
        const glyph = view.getUint16(rangeBase + i * 2 + rangeOffset + (cp - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  }
  return null;
}

/**
 * Parses the metrics and the advance widths of `codePoints` (default: DEFAULT_CODE_POINT_RANGES) out
 * of a TrueType / OpenType (or first face of a TrueType collection) file. Returns null for anything
 * that isn't a usable font.
 */
export function parseFontMetrics(bytes: Uint8Array, codePoints?: Iterable<number>): FontMetricsData | null {
  try {
    if (bytes.length < 12) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let base = 0;
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "ttcf") base = view.getUint32(12);
    const head = readTable(view, base, "head");
    const hhea = readTable(view, base, "hhea");
    const os2 = readTable(view, base, "OS/2");
    const hmtx = readTable(view, base, "hmtx");
    const cmap = readTable(view, base, "cmap");
    if (!head || !hhea || !hmtx || !cmap) return null;

    const unitsPerEm = view.getUint16(head.offset + 18);
    if (!unitsPerEm) return null;
    const hheaAscent = view.getInt16(hhea.offset + 4);
    const hheaDescent = -view.getInt16(hhea.offset + 6);
    const numberOfHMetrics = view.getUint16(hhea.offset + 34);

    let winAscent = hheaAscent;
    let winDescent = hheaDescent;
    let typoAscent = hheaAscent;
    let typoDescent = hheaDescent;
    let useTypoMetrics = false;
    let capHeight: number | undefined;
    let xHeight: number | undefined;
    if (os2 && os2.length >= 78) {
      const o = os2.offset;
      const version = view.getUint16(o);
      useTypoMetrics = (view.getUint16(o + 62) & 128) !== 0;
      typoAscent = view.getInt16(o + 68);
      typoDescent = -view.getInt16(o + 70);
      const wa = view.getUint16(o + 74);
      const wd = view.getUint16(o + 76);
      // libass falls back to the hhea cell when the Windows metrics are absent
      if (wa + wd > 0) {
        winAscent = wa;
        winDescent = wd;
      }
      if (version >= 2 && os2.length >= 90) {
        xHeight = view.getInt16(o + 86);
        capHeight = view.getInt16(o + 88);
      }
    }

    const lookup = cmapLookup(view, cmap.offset);
    if (!lookup) return null;
    const advanceOf = (glyph: number) => view.getUint16(hmtx.offset + Math.min(glyph, numberOfHMetrics - 1) * 4);

    const advances: Record<number, number> = {};
    const add = (cp: number) => {
      if (cp in advances) return;
      const glyph = lookup(cp);
      if (glyph) advances[cp] = advanceOf(glyph);
    };
    if (codePoints) for (const cp of codePoints) add(cp);
    else for (const [from, to] of DEFAULT_CODE_POINT_RANGES) for (let cp = from; cp <= to; cp++) add(cp);

    return {
      unitsPerEm,
      winAscent,
      winDescent,
      hheaAscent,
      hheaDescent,
      typoAscent,
      typoDescent,
      useTypoMetrics,
      capHeight,
      xHeight,
      defaultAdvance: advanceOf(0),
      advances,
    };
  } catch {
    return null;
  }
}

/** Every code point of `text` (deduplicated), for requesting just the advances a caption needs. */
export function codePointsOf(text: string): number[] {
  const out = new Set<number>();
  for (const ch of text) out.add(ch.codePointAt(0)!);
  return [...out];
}

/** libass's cell height as a multiple of the em: (winAscent + winDescent) / unitsPerEm. */
export function assCellRatio(m: FontMetricsData): number {
  return (m.winAscent + m.winDescent) / m.unitsPerEm;
}

/** The ASS `Fontsize` that makes libass render an em of `emPx` pixels. */
export function emToAssFontSize(emPx: number, m: FontMetricsData): number {
  return emPx * assCellRatio(m);
}

/** Ascent / descent (in ems) a browser uses for the font's content area. */
export function cssContentMetrics(m: FontMetricsData): { ascent: number; descent: number } {
  return m.useTypoMetrics
    ? { ascent: m.typoAscent / m.unitsPerEm, descent: m.typoDescent / m.unitsPerEm }
    : { ascent: m.hheaAscent / m.unitsPerEm, descent: m.hheaDescent / m.unitsPerEm };
}

/** Width of `text` in px at an em of `emPx`, with `letterSpacingPx` added after every character
 * (CSS `letter-spacing` and ASS `Spacing` both add it after each glyph, the last one included). */
export function textAdvance(m: FontMetricsData, text: string, emPx: number, letterSpacingPx = 0): number {
  let units = 0;
  let chars = 0;
  for (const ch of text) {
    units += m.advances[ch.codePointAt(0)!] ?? m.defaultAdvance;
    chars++;
  }
  return (units * emPx) / m.unitsPerEm + chars * letterSpacingPx;
}
