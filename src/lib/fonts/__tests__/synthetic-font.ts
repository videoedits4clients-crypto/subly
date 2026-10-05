import type { FontMetricsData } from "../font-metrics.ts";

/**
 * Test helpers for P20.4: a tiny hand-assembled TrueType file (head / hhea / OS/2 / hmtx / cmap /
 * maxp) so the metric extractor is tested deterministically and offline, plus a plain-data
 * FontMetricsData factory for the layout / ASS tests. Every Basic Latin glyph gets `advance`.
 */
export interface SyntheticFontSpec {
  unitsPerEm: number;
  hheaAscent: number;
  hheaDescent: number;
  typoAscent: number;
  typoDescent: number;
  winAscent: number;
  winDescent: number;
  useTypoMetrics?: boolean;
  capHeight?: number;
  xHeight?: number;
  /** advance of every glyph except the ones in `advances` (font units) */
  advance: number;
  /** per-character advance overrides, keyed by character */
  advances?: Record<string, number>;
}

function u16(n: number): number[] {
  return [(n >> 8) & 255, n & 255];
}
function i16(n: number): number[] {
  return u16(n < 0 ? n + 65536 : n);
}
function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

export function buildSyntheticTtf(spec: SyntheticFontSpec): Uint8Array {
  // glyph 0 = .notdef, glyph k = code point 0x1f + k for 0x20..0x7e
  const glyphCount = 1 + (0x7e - 0x20 + 1);
  const advanceFor = (cp: number) => spec.advances?.[String.fromCharCode(cp)] ?? spec.advance;

  const head = new Array<number>(54).fill(0);
  head.splice(18, 2, ...u16(spec.unitsPerEm));

  const hhea = new Array<number>(36).fill(0);
  hhea.splice(4, 2, ...i16(spec.hheaAscent));
  hhea.splice(6, 2, ...i16(-spec.hheaDescent));
  hhea.splice(34, 2, ...u16(glyphCount));

  const os2 = new Array<number>(96).fill(0);
  os2.splice(0, 2, ...u16(2));
  os2.splice(62, 2, ...u16(spec.useTypoMetrics ? 128 : 0));
  os2.splice(68, 2, ...i16(spec.typoAscent));
  os2.splice(70, 2, ...i16(-spec.typoDescent));
  os2.splice(74, 2, ...u16(spec.winAscent));
  os2.splice(76, 2, ...u16(spec.winDescent));
  os2.splice(86, 2, ...i16(spec.xHeight ?? 0));
  os2.splice(88, 2, ...i16(spec.capHeight ?? 0));

  const hmtx: number[] = [...u16(spec.advance), ...u16(0)];
  for (let cp = 0x20; cp <= 0x7e; cp++) hmtx.push(...u16(advanceFor(cp)), ...u16(0));

  const maxp = [...u32(0x00010000), ...u16(glyphCount)];

  // cmap format 4: one real segment 0x20..0x7e (idDelta maps cp -> cp-0x1f) and the 0xFFFF terminator
  const segCount = 2;
  const sub = [
    ...u16(4),
    ...u16(16 + segCount * 8),
    ...u16(0),
    ...u16(segCount * 2),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0x7e),
    ...u16(0xffff),
    ...u16(0),
    ...u16(0x20),
    ...u16(0xffff),
    ...i16(-0x1f),
    ...u16(1),
    ...u16(0),
    ...u16(0),
  ];
  const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12), ...sub];

  const tables: [string, number[]][] = [
    ["OS/2", os2],
    ["cmap", cmap],
    ["head", head],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["maxp", maxp],
  ];
  const out: number[] = [...u32(0x00010000), ...u16(tables.length), ...u16(0), ...u16(0), ...u16(0)];
  let offset = 12 + tables.length * 16;
  const bodies: number[][] = [];
  for (const [tag, body] of tables) {
    out.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(offset), ...u32(body.length));
    const padded = body.concat(new Array((4 - (body.length % 4)) % 4).fill(0));
    bodies.push(padded);
    offset += padded.length;
  }
  for (const b of bodies) out.push(...b);
  return Uint8Array.from(out);
}

/** Plain metrics (no file) with a flat advance, for layout / ASS tests. `cell` = (winAscent+winDescent)/upm. */
export function syntheticMetrics(opts: {
  cell: number;
  advanceEm?: number;
  winDescentEm?: number;
  hheaAscentEm?: number;
  hheaDescentEm?: number;
  capEm?: number;
}): FontMetricsData {
  const upm = 1000;
  const winDescent = Math.round((opts.winDescentEm ?? 0.25) * upm);
  const winAscent = Math.round(opts.cell * upm) - winDescent;
  const hheaAscent = Math.round((opts.hheaAscentEm ?? 0.95) * upm);
  const hheaDescent = Math.round((opts.hheaDescentEm ?? 0.25) * upm);
  const advance = Math.round((opts.advanceEm ?? 0.55) * upm);
  const advances: Record<number, number> = {};
  for (let cp = 0x20; cp <= 0x7e; cp++) advances[cp] = advance;
  advances[0x20] = Math.round(advance * 0.5);
  return {
    unitsPerEm: upm,
    winAscent,
    winDescent,
    hheaAscent,
    hheaDescent,
    typoAscent: hheaAscent,
    typoDescent: hheaDescent,
    useTypoMetrics: false,
    capHeight: Math.round((opts.capEm ?? 0.7) * upm),
    xHeight: 500,
    defaultAdvance: advance,
    advances,
  };
}
