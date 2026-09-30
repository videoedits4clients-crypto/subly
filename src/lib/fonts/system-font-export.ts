import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { ensureFontCached } from "./server-font-cache";
import { getSystemFonts, resolveSystemFontFile } from "./system-fonts";

export interface RequiredFont {
  family: string;
  weight: number;
  source: "bundled" | "system";
}

/**
 * Builds ONE temporary directory for this export's ffmpeg/libass `fontsdir`, containing
 * ONLY the specific font files this project actually needs — never the whole Windows
 * Fonts folder, and never a persistent copy (see section 6 of the desktop font-support
 * pass: "safely provide only the required font files and clean them up afterward").
 *
 * Bundled (Google) fonts still go through the existing persistent download cache
 * (server-font-cache.ts) first — that part of the pipeline is unchanged, we just also
 * copy its output into this export's temp dir so a single `fontsdir` covers both bundled
 * and system fonts (ffmpeg's `subtitles` filter only accepts one fontsdir path). Copying
 * an already-local cached file is a cheap disk copy, not a re-download.
 *
 * Returns the temp dir path and a `cleanup()` to call once the export has finished
 * (success or failure) — the caller is responsible for awaiting cleanup in a `finally`.
 */
export async function prepareExportFontsDir(requiredFonts: RequiredFont[]): Promise<{ fontsDir: string; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-export-fonts-"));

  const systemFamilies = requiredFonts.some((f) => f.source === "system") ? await getSystemFonts() : [];

  await Promise.all(
    requiredFonts.map(async (req) => {
      if (req.source === "system") {
        const filePath = resolveSystemFontFile(systemFamilies, req.family, req.weight);
        if (!filePath) {
          // Font no longer installed — nothing to copy. libass will fall back to
          // whatever it can find (same graceful-degradation as a failed Google
          // Fonts download, see server-font-cache.ts), rather than failing the export.
          console.error(`[fonts] system font "${req.family}" is not installed — export will substitute a fallback.`);
          return;
        }
        const dest = path.join(tempDir, path.basename(filePath));
        try {
          await fs.copyFile(filePath, dest);
        } catch (err) {
          console.error(`[fonts] failed to copy system font "${req.family}" for export:`, err);
        }
        return;
      }

      const cachedPath = await ensureFontCached(req.family, req.weight);
      if (!cachedPath) return; // download failure — already logged by ensureFontCached
      const dest = path.join(tempDir, path.basename(cachedPath));
      try {
        await fs.copyFile(cachedPath, dest);
      } catch (err) {
        console.error(`[fonts] failed to stage bundled font "${req.family}" for export:`, err);
      }
    }),
  );

  return {
    fontsDir: tempDir,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
