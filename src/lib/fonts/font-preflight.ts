import { getSystemFonts, resolveSystemFontFile, type SystemFontFamily } from "./system-fonts.ts";
import { ensureFontCached } from "./server-font-cache.ts";
import type { MissingFont } from "./font-preflight-message.ts";

export type { MissingFont };

export interface RequiredFont {
  family: string;
  weight: number;
  source: "bundled" | "system";
}

export interface FontPreflightResult {
  ok: boolean;
  missing: MissingFont[];
}

/** The two real ways a required font gets resolved to an actual file, already used
 * (unchanged) by prepareExportFontsDir when actually staging the export — reused here,
 * dependency-injected, so the preflight can be tested against a controlled fake font
 * environment instead of a real Windows install or a real network call. */
export interface FontResolvers {
  resolveSystemFontFile: (families: SystemFontFamily[], family: string, weight: number) => string | null;
  resolveBundledFont: (family: string, weight: number) => Promise<string | null>;
}

export const DEFAULT_FONT_RESOLVERS: FontResolvers = {
  resolveSystemFontFile,
  resolveBundledFont: ensureFontCached,
};

/**
 * Checks that every font the export actually needs (see collectRequiredFonts in
 * lib/subtitles/ass.ts) can really be resolved to a font file BEFORE ffmpeg starts
 * rendering — the same two resolution paths prepareExportFontsDir already uses when
 * building the export's fontsdir, just used here to decide whether to proceed at all,
 * instead of silently skipping whatever can't be found (see system-font-export.ts's
 * pre-existing "libass will fall back to whatever it can find" comment — that silent
 * substitution is exactly what this preflight exists to stop).
 *
 * Collects EVERY missing font, not just the first — a project can require several
 * distinct fonts (per-caption overrides, script-fallback fonts, a preset's font), and the
 * user needs to see all of them at once, not fix one and immediately hit the next.
 */
export async function preflightRequiredFonts(
  requiredFonts: RequiredFont[],
  systemFamilies: SystemFontFamily[],
  resolvers: FontResolvers = DEFAULT_FONT_RESOLVERS,
): Promise<FontPreflightResult> {
  const missing: MissingFont[] = [];
  for (const font of requiredFonts) {
    if (font.source === "system") {
      const filePath = resolvers.resolveSystemFontFile(systemFamilies, font.family, font.weight);
      if (!filePath) missing.push(font);
      continue;
    }
    const cachedPath = await resolvers.resolveBundledFont(font.family, font.weight);
    if (!cachedPath) missing.push(font);
  }
  return { ok: missing.length === 0, missing };
}

/** Convenience wrapper for the real export pipeline — fetches the real system-font list
 * only when at least one required font actually needs it (same short-circuit
 * prepareExportFontsDir already uses), then runs the preflight above. */
export async function preflightExportFonts(requiredFonts: RequiredFont[]): Promise<FontPreflightResult> {
  const systemFamilies = requiredFonts.some((f) => f.source === "system") ? await getSystemFonts() : [];
  return preflightRequiredFonts(requiredFonts, systemFamilies);
}
