import { promises as fs } from "fs";
import { DEFAULT_CODE_POINT_RANGES, parseFontMetrics, type FontMetricsData } from "./font-metrics.ts";
import { ensureFontCached } from "./server-font-cache.ts";
import { getSystemFonts, resolveSystemFontFile } from "./system-fonts.ts";
import type { MetricsProvider } from "../subtitles/caption-layout.ts";

/**
 * Server-side loading of font metrics (P20.4): reads the same font FILES the export hands to libass
 * (the persistent bundled-font cache, or the user's installed system font) and parses them once.
 * Both the export (buildAssDocument's `fontMetrics`) and the preview's `/api/fonts/metrics` route use
 * this, so the two renderers measure text with identical data.
 *
 * Parsing is memoized per file for the life of the process; a later request needing extra code points
 * just re-parses that one file with the union (a few ms).
 */

export interface FontRequest {
  family: string;
  weight: number;
  source?: "bundled" | "system";
}

interface CacheEntry {
  data: FontMetricsData;
  codePoints: Set<number>;
}
const parsed = new Map<string, CacheEntry>();

function defaultCodePoints(): Set<number> {
  const out = new Set<number>();
  for (const [from, to] of DEFAULT_CODE_POINT_RANGES) for (let cp = from; cp <= to; cp++) out.add(cp);
  return out;
}

async function fontFilePath(req: FontRequest): Promise<string | null> {
  if (req.source === "system") return resolveSystemFontFile(await getSystemFonts(), req.family, req.weight) ?? null;
  return ensureFontCached(req.family, req.weight);
}

/** Metrics of one font file covering at least `extra` code points, or null if the file can't be read/parsed. */
export async function loadFontFileMetrics(filePath: string, extra: Iterable<number> = []): Promise<FontMetricsData | null> {
  const wanted = [...extra];
  const hit = parsed.get(filePath);
  if (hit && wanted.every((cp) => hit.codePoints.has(cp))) return hit.data;
  try {
    const bytes = new Uint8Array(await fs.readFile(filePath));
    const codePoints = new Set<number>([...(hit?.codePoints ?? defaultCodePoints()), ...wanted]);
    const data = parseFontMetrics(bytes, codePoints);
    if (!data) return null;
    parsed.set(filePath, { data, codePoints });
    return data;
  } catch {
    return null;
  }
}

/**
 * A metrics provider for a set of required fonts. `family|weight` lookups that miss fall back to the
 * nearest loaded weight of the same family (a word's manual weight override needn't be fetched
 * separately); a family that couldn't be loaded at all gives `undefined` and that style simply uses the
 * legacy rendering.
 */
export async function loadExportFontMetrics(fonts: FontRequest[], codePoints: Iterable<number> = []): Promise<MetricsProvider> {
  const extra = [...codePoints];
  const loaded = new Map<string, Map<number, FontMetricsData>>();
  await Promise.all(
    fonts.map(async (req) => {
      const file = await fontFilePath(req);
      if (!file) return;
      const data = await loadFontFileMetrics(file, extra);
      if (!data) return;
      const byWeight = loaded.get(req.family) ?? new Map<number, FontMetricsData>();
      byWeight.set(req.weight, data);
      loaded.set(req.family, byWeight);
    }),
  );
  return (family, weight) => {
    const byWeight = loaded.get(family);
    if (!byWeight) return undefined;
    const exact = byWeight.get(weight);
    if (exact) return exact;
    let best: FontMetricsData | undefined;
    let bestDistance = Infinity;
    for (const [w, d] of byWeight) {
      const distance = Math.abs(w - weight);
      if (distance < bestDistance) {
        best = d;
        bestDistance = distance;
      }
    }
    return best;
  };
}

/** Metrics for ONE font request (null when the font file can't be found or parsed). Used by the preview's metrics route. */
export async function loadFontMetrics(req: FontRequest, codePoints: Iterable<number> = []): Promise<FontMetricsData | null> {
  const file = await fontFilePath(req);
  if (!file) return null;
  return loadFontFileMetrics(file, codePoints);
}
