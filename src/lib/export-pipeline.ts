import path from "path";
import { promises as fs } from "fs";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { renderExport, computeExportDimensions, withTempFile, ExportCancelledError, ExportStalledError } from "@/lib/ffmpeg";
import { buildAssDocument, collectRequiredFonts } from "@/lib/subtitles/ass";
import { loadExportFontMetrics } from "@/lib/fonts/export-font-metrics";
import { codePointsOf } from "@/lib/fonts/font-metrics";
import { prepareExportFontsDir } from "@/lib/fonts/system-font-export";
import { preflightExportFonts } from "@/lib/fonts/font-preflight";
import { FontResolutionError } from "@/lib/fonts/font-preflight-message";
import { verifyExportOutput, ExportVerificationError } from "@/lib/export-output-verification";
import { exportOutputKey, exportAssKey } from "@/lib/export-output-key";
import { EXPORT_CANCELLED_MESSAGE } from "@/lib/export-status-message";
import { applyOutputMode } from "@/lib/subtitles/output-mode";
import { projectInclude, toProjectData } from "@/lib/project-mapper";
import { effectiveCuts, keptRanges, editedDuration, remapSubtitlesToEdited } from "@/lib/timeline/edit-model";
import { track } from "@/lib/analytics";

/** In-memory registry of the AbortController for each running export job, so a Cancel action
 * (see the /cancel API route) can reach the actual ffmpeg process. Process lifetime only —
 * same "runs in-process" scope as pipeline.ts's activeTranscriptions map. */
const activeExports = new Map<string, AbortController>();

/** Returns true if a cancel signal was actually sent — false if there was nothing running to cancel. */
export function cancelActiveExport(jobId: string): boolean {
  const controller = activeExports.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export interface ExportRequestOptions {
  resolution: "720p" | "1080p" | "4k";
  format: "mp4";
  fps: 24 | 30 | 60;
  quality: "low" | "medium" | "high" | "maximum";
  videoVisible: boolean;
  backgroundColor: string;
  canvasWidth: number;
  canvasHeight: number;
}

export interface RunExportJobOptions {
  /** Explicit, user-chosen opt-in to proceed even though the font preflight found one or more
   * requested fonts unresolvable — see the "Export with a substitute font" action in
   * export-dialog.tsx. Never defaults to true: a silent fallback is exactly what this feature
   * exists to prevent (see lib/fonts/font-preflight.ts). When true, the preflight still runs
   * (so a future export attempt without this flag can't accidentally skip it) but a failed
   * preflight no longer blocks — the export proceeds exactly as it did before this phase. */
  allowFontFallback?: boolean;
}

/** Runs the actual burn-in export in the background; the API layer polls ExportJob rows for progress. */
export async function runExportJob(jobId: string, options: RunExportJobOptions = {}): Promise<void> {
  const job = await prisma.exportJob.findUniqueOrThrow({ where: { id: jobId } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: job.projectId }, include: projectInclude });
  const storage = getStorage();
  // Hoisted out of the try block (rather than declared where it's computed below) so the catch
  // block can still reach it to delete a truncated/killed partial output — a `const` declared
  // inside `try { ... }` is block-scoped to that block and invisible from `catch`.
  let outputAbsPath: string | undefined;

  try {
    if (!project.video) throw new Error("Project has no video.");
    await prisma.exportJob.update({ where: { id: jobId }, data: { status: "RUNNING", stage: "preparing", progress: 1 } });
    track("export_started", { projectId: job.projectId, resolution: job.resolution, fps: job.fps, videoVisible: job.videoVisible });

    const data = toProjectData(project);

    // Trim + filler/silence/manual cuts collapse to one cut list; subtitles
    // get remapped into the resulting gapless "edited timeline" so the
    // burned captions land on the right frame of the CUT video, not the
    // original — this is the same source↔edited model the live preview and
    // timeline use (lib/timeline/edit-model.ts), just applied once at export.
    const duration = project.video.duration ?? 0;
    const cuts = effectiveCuts(data.trimStart, data.trimEnd, duration, data.cutRanges);
    const keepRanges = keptRanges(duration, cuts);
    const editedSubtitles = cuts.length > 0 ? remapSubtitlesToEdited(data.subtitles, cuts, data.timingRules) : data.subtitles;
    // Burn in whatever's actually selected as the caption output — Original or
    // Hinglish (see lib/subtitles/output-mode.ts) — same function the live preview
    // and SRT/VTT/TXT routes use, so export always visually matches what was shown.
    const exportSubtitles = applyOutputMode(editedSubtitles, data.captionOutputMode);

    // The project's own composition canvas is the ONE source of truth for output aspect
    // ratio, in both branches — `resolution` just scales it up/down as export quality, never
    // substituting a different ratio (see lib/ffmpeg/index.ts computeExportDimensions). The
    // ASS document's PlayResX/PlayResY must match whatever renderExport actually produces
    // pixel-for-pixel, so both are computed from that exact same function here.
    const videoVisible = job.videoVisible;
    const { width: playResX, height: playResY } = computeExportDimensions(
      job.canvasWidth,
      job.canvasHeight,
      job.resolution as "720p" | "1080p" | "4k",
    );

    // Real font FILES, not just family names — see server-font-cache.ts (bundled fonts)
    // and system-fonts.ts (Windows fonts) for why this matters: neither kind is
    // installed as a system font on ffmpeg's own search path by default (bundled fonts
    // aren't installed at all; a Windows system font's *file* still needs to be handed
    // to libass explicitly since we can't assume its font-config/DirectWrite lookup
    // finds it), so without this the export would silently substitute the wrong font.
    const requiredFonts = collectRequiredFonts(exportSubtitles, data.globalStyle);

    // FONT PREFLIGHT — checks every required font can actually be resolved to a real file
    // BEFORE any temp files are written or ffmpeg starts. prepareExportFontsDir (below) has
    // always silently skipped a font it couldn't find (logging to the server console only,
    // never surfaced to the user) and let libass substitute whatever it could — this is the
    // "never silently fall back" guarantee this phase adds. `allowFontFallback` is the one,
    // explicit way a user can choose to proceed anyway (see RunExportJobOptions above).
    if (!options.allowFontFallback) {
      const preflight = await preflightExportFonts(requiredFonts);
      if (!preflight.ok) throw new FontResolutionError(preflight.missing);
    }

    const { fontsDir, cleanup: cleanupFontsDir } = await prepareExportFontsDir(requiredFonts);

    const outputKey = exportOutputKey(job.projectId, jobId);
    outputAbsPath = await storage.getPath(outputKey);
    const controller = new AbortController();
    activeExports.set(jobId, controller);

    try {
      // Font metrics for typography parity (P20.4): the preview sets the style's size as a CSS em, while ASS
      // reads Fontsize as the font's Windows cell height — so the export needs each font's own metrics (read
      // from the very files handed to libass) to size, wrap and place the text like the preview does. Built
      // AFTER the fonts are resolved; a font that can't be read just keeps the legacy rendering.
      const fontMetrics = await loadExportFontMetrics(
        requiredFonts,
        exportSubtitles.flatMap((sub) => sub.words.flatMap((w) => [w.text, w.text.toUpperCase(), w.text.toLowerCase()].flatMap(codePointsOf))),
      );
      const ass = buildAssDocument({
        subtitles: exportSubtitles,
        globalStyle: data.globalStyle,
        globalAnimation: data.animation,
        playResX,
        playResY,
        fontMetrics,
      });

      const inputPath = await storage.getPath(project.video.url.replace(/^\/api\/files\//, ""));
      const assKey = exportAssKey(job.projectId, jobId);
      const assAbsPath = await storage.getPath(assKey);

      await fs.mkdir(path.dirname(outputAbsPath), { recursive: true });

      await prisma.exportJob.update({ where: { id: jobId }, data: { stage: "rendering", progress: 3 } });

      // withTempFile writes the .ass, runs the render, and always removes the .ass afterward —
      // success, cancelled, or failed — so no export attempt leaves this render-time
      // intermediate behind (see lib/ffmpeg/index.ts's doc comment on withTempFile).
      await withTempFile(assAbsPath, ass, () =>
        renderExport({
          inputPath,
          assPath: assAbsPath,
          outputPath: outputAbsPath!,
          canvasWidth: job.canvasWidth,
          canvasHeight: job.canvasHeight,
          resolution: job.resolution as "720p" | "1080p" | "4k",
          fps: job.fps as 24 | 30 | 60,
          quality: job.quality as "low" | "medium" | "high" | "maximum",
          fontsDir,
          keepRanges: cuts.length > 0 ? keepRanges : undefined,
          videoVisible,
          backgroundColor: job.backgroundColor,
          // Only meaningful (and only computed) for the video-off path — see
          // planExportRender; a video-on export keeps determining its own duration from
          // keepRanges/the source video exactly as before.
          duration: videoVisible ? undefined : editedDuration(duration, cuts),
          onProgress: (percent) => {
            const stage = percent >= 95 ? "finalizing" : "rendering";
            void prisma.exportJob.update({ where: { id: jobId }, data: { progress: percent, stage } }).catch(() => {});
          },
          signal: controller.signal,
        }),
      );
    } finally {
      activeExports.delete(jobId);
      await cleanupFontsDir();
    }

    // ffmpeg exiting without error only means the process finished — it says nothing about
    // whether the file it produced is actually a usable video (a truncated/zero-byte/corrupt
    // output is possible without ffmpeg itself reporting an error). Verify the real file before
    // ever telling the user their export is ready — see lib/export-output-verification.ts.
    const verification = await verifyExportOutput({ outputPath: outputAbsPath });
    if (!verification.ok) {
      throw new ExportVerificationError(verification.message ?? "Export failed: the exported video could not be verified.");
    }

    const outputUrl = storage.publicUrl(outputKey);
    await prisma.exportJob.update({
      where: { id: jobId },
      data: { status: "DONE", stage: "complete", progress: 100, outputUrl },
    });
    await prisma.project.update({ where: { id: job.projectId }, data: { status: "EXPORTED" } });
    track("export_completed", { projectId: job.projectId, jobId });
  } catch (err) {
    // A killed ffmpeg process leaves a truncated, unplayable partial output file — clean it up
    // so a cancelled/timed-out export never leaves a corrupt file sitting in storage that
    // could be confused for a real (if broken) result. outputAbsPath is only set once the
    // render actually started (see above) — a failure before that point has nothing to clean up.
    if (outputAbsPath) await fs.rm(outputAbsPath, { force: true }).catch(() => {});

    const cancelled = err instanceof ExportCancelledError;
    const stalled = err instanceof ExportStalledError;
    const fontUnavailable = err instanceof FontResolutionError;
    const verificationFailed = err instanceof ExportVerificationError;
    console.error(
      `[export] job ${jobId} ${cancelled ? "cancelled" : stalled ? "stalled" : fontUnavailable ? "blocked (font unavailable)" : verificationFailed ? "failed verification" : "failed"}:`,
      err,
    );
    track(
      cancelled
        ? "export_cancelled"
        : stalled
          ? "export_stalled"
          : fontUnavailable
            ? "export_font_unavailable"
            : verificationFailed
              ? "export_verification_failed"
              : "export_failed",
      { projectId: job.projectId, jobId },
    );
    await prisma.exportJob.update({
      where: { id: jobId },
      data: {
        status: "ERROR",
        // A FontResolutionError/ExportVerificationError's own .message IS the user-facing text
        // (see buildMissingFontMessage in lib/fonts/font-preflight-message.ts and
        // verifyExportOutput in lib/export-output-verification.ts) — reused as-is here, the same
        // way cancelled/stalled already get their own specific message instead of the generic
        // fallback below.
        errorMessage: cancelled
          ? EXPORT_CANCELLED_MESSAGE
          : stalled
            ? "Export timed out — rendering stopped responding."
            : fontUnavailable
              ? err.message
              : verificationFailed
                ? err.message
                : "Something went wrong while exporting your video.",
      },
    });
    // Never leave the project stuck showing "EXPORTING" — this was previously missing for
    // ALL export failures (not just cancel/timeout), so a plain ffmpeg error would strand the
    // project in that state indefinitely with no way back into the editor. READY (not ERROR)
    // because the project/editor itself is completely fine — only this one export attempt
    // failed, and export can be retried from the same dialog without reloading anything.
    await prisma.project.update({ where: { id: job.projectId }, data: { status: "READY" } }).catch(() => {});
  }
}
