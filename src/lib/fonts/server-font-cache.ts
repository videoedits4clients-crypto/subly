import { promises as fs } from "fs";
import path from "path";

/**
 * Downloads and caches real font FILES for export rendering.
 *
 * Why this exists: the ASS `Fontname` field only works if ffmpeg/libass can
 * actually locate a font file with that family name — and NONE of our fonts
 * (Inter, Poppins, Anton, Noto Sans Devanagari, ...) are installed as system
 * fonts on whatever machine runs ffmpeg. `next/font/google` self-hosts fonts
 * for the *browser* preview, but that's irrelevant to the server-side ffmpeg
 * process. Without this, libass silently substitutes whatever fallback font
 * fontconfig finds (or renders nothing for scripts it truly has no glyphs
 * for) — the export would visually NOT match the style the user picked.
 *
 * Fetches the real .ttf from Google Fonts' CSS2 API (requesting with a plain
 * User-Agent, which Google resolves to a `format('truetype')` src — modern
 * browsers get woff2, but ffmpeg's `subtitles` filter needs a stable "point
 * fontsdir at a folder of font files" input, so we always want ttf/otf here)
 * and caches each family+weight once under data/fonts-cache/. On any network
 * failure this degrades gracefully — export still proceeds without that font
 * in fontsdir, so libass falls back to whatever it can find, rather than
 * hard-failing the whole export over a font download hiccup.
 */

// SUBLY_FONTS_CACHE_DIR lets the desktop build point this at a per-user
// app-data directory (electron/main.js) instead of inside the installed,
// often read-only, application folder — same reasoning as SUBLY_UPLOADS_DIR
// in lib/storage/local.ts.
const CACHE_DIR = process.env.SUBLY_FONTS_CACHE_DIR || path.join(process.cwd(), "data", "fonts-cache");

// Weight clamping: requesting a weight a family doesn't actually publish (e.g.
// 700 for Anton, which only ships 400) makes Google's CSS2 API omit the face.
const AVAILABLE_WEIGHTS: Record<string, number[]> = {
  Inter: [400, 500, 600, 700, 800, 900],
  Poppins: [400, 500, 600, 700, 800, 900],
  Montserrat: [400, 500, 600, 700, 800, 900],
  Roboto: [400, 500, 700, 900],
  "Open Sans": [400, 500, 600, 700, 800],
  Nunito: [400, 600, 700, 800, 900],
  "Bebas Neue": [400],
  Anton: [400],
  Oswald: [400, 500, 600, 700],
  Archivo: [400, 500, 600, 700, 800, 900],
  "DM Sans": [400, 500, 700, 900],
  "Plus Jakarta Sans": [400, 500, 600, 700, 800],
  Manrope: [400, 500, 600, 700, 800],
  Outfit: [400, 500, 600, 700, 800, 900],
  Urbanist: [400, 500, 600, 700, 800, 900],
  "League Spartan": [400, 500, 600, 700, 800, 900],
  "Archivo Black": [400],
  "Playfair Display": [400, 500, 600, 700, 800, 900],
  "DM Serif Display": [400],
  Quicksand: [400, 500, 600, 700],
  Fredoka: [400, 500, 600, 700],
  "Baloo 2": [400, 500, 600, 700, 800],
  Hind: [400, 500, 600, 700],
  "Noto Sans Devanagari": [400, 500, 600, 700, 800, 900],
  "Noto Sans Gujarati": [400, 500, 600, 700, 800, 900],
};

function clampWeight(family: string, weight: number): number {
  const available = AVAILABLE_WEIGHTS[family];
  if (!available || available.length === 0) return weight;
  if (available.includes(weight)) return weight;
  return available.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), available[0]);
}

function cacheFileName(family: string, weight: number): string {
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${slug}-${weight}.ttf`;
}

// Only reached for a (family, weight) that isn't already in the offline-seeded cache (see
// ensureFontCached below) — SUBLY is local-first and this is the one place normal styling/export
// can still reach the network. Confirmed with no bound at all, a genuinely offline machine that
// drops packets rather than refusing the connection (common behind some firewalls/VPNs, unlike a
// clean "no network" refusal) could hang here indefinitely, defeating the whole point of
// preflightExportFonts (lib/fonts/font-preflight.ts) — a fast, clear "missing font" error before
// export starts, not an export that silently never starts spinning. Bounding it lets that
// preflight fail promptly instead.
const FONT_FETCH_TIMEOUT_MS = 5000;

async function fetchTtfUrl(family: string, weight: number): Promise<string | null> {
  const familyParam = encodeURIComponent(family).replace(/%20/g, "+");
  const url = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weight}`;
  const res = await fetch(url, {
    headers: {
      // Deliberately NOT a modern browser UA — Google's CSS2 API serves woff2
      // to modern UAs, but resolves to `format('truetype')` for older/unknown
      // ones, which is what we need for libass/freetype to load directly.
      "User-Agent": "Mozilla/5.0 (compatible)",
    },
    signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const css = await res.text();
  const match = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(css);
  return match?.[1] ?? null;
}

/** Ensures one (family, weight) pair is cached locally; returns its absolute path, or null if it couldn't be fetched. */
export async function ensureFontCached(family: string, weight: number): Promise<string | null> {
  const clamped = clampWeight(family, weight);
  const filePath = path.join(CACHE_DIR, cacheFileName(family, clamped));

  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    // not cached yet — fetch below
  }

  try {
    const ttfUrl = await fetchTtfUrl(family, clamped);
    if (!ttfUrl) return null;
    const res = await fetch(ttfUrl, { signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error(`[fonts] failed to cache ${family} ${weight}:`, err);
    return null;
  }
}

/** Ensures every requested (family, weight) pair is cached, then returns the shared cache directory for ffmpeg's `fontsdir`. Individual failures are logged and skipped, never thrown — a missing font shouldn't fail the whole export. */
export async function ensureFontsDir(specs: { family: string; weight: number }[]): Promise<string> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await Promise.all(specs.map((s) => ensureFontCached(s.family, s.weight)));
  return CACHE_DIR;
}
