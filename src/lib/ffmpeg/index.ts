import ffmpegPath from "ffmpeg-static";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { promises as fs } from "fs";
import { escapeAssPathForFfmpeg } from "../subtitles/ass.ts";

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
ffmpeg.setFfprobePath(ffprobePath);

/** Writes `content` to `filePath` (creating parent directories as needed), runs `body`, and
 * always removes `filePath` afterward — whether `body` resolves, rejects, or is a cancelled/
 * stalled export — never leaving a temporary file behind regardless of outcome. Used for
 * export's temporary .ass caption file (see export-pipeline.ts), which libass reads from disk
 * during renderExport but which has no reason to exist afterward in any case: success,
 * cancelled, or failed. Deliberately generic/side-effect-scoped to just this one path — never
 * touches the user-facing SRT/VTT/TXT subtitle downloads, which are a wholly separate on-demand
 * route generated fresh from the database. */
export async function withTempFile<T>(filePath: string, content: string, body: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  try {
    return await body();
  } finally {
    await fs.rm(filePath, { force: true }).catch(() => {});
  }
}

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export function probeVideo(filePath: string): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const videoStream = data.streams.find((s) => s.codec_type === "video");
      const audioStream = data.streams.find((s) => s.codec_type === "audio");
      const fpsRaw = videoStream?.r_frame_rate ?? "30/1";
      const [num, den] = fpsRaw.split("/").map(Number);
      resolve({
        duration: Number(data.format.duration ?? videoStream?.duration ?? 0),
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0,
        fps: den ? num / den : 30,
        hasAudio: Boolean(audioStream),
      });
    });
  });
}

/** Extracts mono 16kHz WAV audio — the format Whisper-style transcription APIs expect. */
export async function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("error", reject)
      .on("end", () => resolve())
      .save(outputPath);
  });
}

export interface SilenceRange {
  start: number;
  end: number;
}

/**
 * Detects silent stretches of at least `minDuration` seconds using ffmpeg's
 * `silencedetect` audio filter (noise floor -30dB — quiet enough to skip true
 * silence/room tone without catching soft speech). Returns candidates only;
 * nothing is cut until the caller turns them into CutRanges.
 */
export function detectSilence(inputPath: string, minDuration: number): Promise<SilenceRange[]> {
  return new Promise((resolve, reject) => {
    const ranges: SilenceRange[] = [];
    let pendingStart: number | null = null;
    const devNull = process.platform === "win32" ? "NUL" : "/dev/null";

    ffmpeg(inputPath)
      .noVideo()
      .audioFilters(`silencedetect=noise=-30dB:d=${minDuration}`)
      .format("null")
      .on("stderr", (line: string) => {
        const startMatch = /silence_start:\s*([\d.]+)/.exec(line);
        if (startMatch) pendingStart = Number(startMatch[1]);
        const endMatch = /silence_end:\s*([\d.]+)/.exec(line);
        if (endMatch && pendingStart !== null) {
          ranges.push({ start: pendingStart, end: Number(endMatch[1]) });
          pendingStart = null;
        }
      })
      .on("error", reject)
      .on("end", () => resolve(ranges))
      .save(devNull);
  });
}

export interface ExportOptions {
  inputPath: string;
  assPath: string;
  outputPath: string;
  /** The project's composition canvas (see types/subtitle.ts CompositionSettings) — the
   * single source of truth for output aspect ratio in BOTH the videoVisible branches below.
   * `resolution` scales these up/down as export quality while preserving this exact ratio;
   * it never substitutes a different ratio of its own (there is no separate "export aspect
   * ratio" concept anymore — see lib/export-pipeline.ts). */
  canvasWidth: number;
  canvasHeight: number;
  resolution: "720p" | "1080p" | "4k";
  fps: 24 | 30 | 60;
  quality: "low" | "medium" | "high" | "maximum";
  /** Directory of cached font files (see lib/fonts/server-font-cache.ts) so libass can find fonts that aren't installed system-wide. Optional — omitted, libass falls back to whatever fontconfig can find. */
  fontsDir?: string;
  /** Source-time [start,end) ranges to KEEP, in order — everything else (trim + filler/silence/manual cuts) is dropped. Omit/empty = keep the whole source. See lib/timeline/edit-model.ts for how this is computed from a project's trim/cutRanges. */
  keepRanges?: { start: number; end: number }[];
  onProgress?: (percent: number) => void;
  /** Video layer visibility (see types/subtitle.ts CompositionSettings). Defaults to true. */
  videoVisible?: boolean;
  backgroundColor?: string;
  /** Required when videoVisible is false — a solid-color source has no frames of its own to
   * select/cut down to size, so the edited-timeline duration must be given explicitly (see
   * lib/timeline/edit-model.ts editedDuration). Ignored when videoVisible is true, where the
   * existing select-filter/keepRanges mechanism determines duration as it always has. */
  duration?: number;
  /** Aborting this signal kills the underlying ffmpeg process (SIGKILL) and rejects with
   * ExportCancelledError — see export-pipeline.ts's cancel route. */
  signal?: AbortSignal;
}

export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled.");
    this.name = "ExportCancelledError";
  }
}

export class ExportStalledError extends Error {
  constructor() {
    super("Export stopped responding.");
    this.name = "ExportStalledError";
  }
}

/** No ffmpeg "progress" event for this long is treated as a stalled/hung encode. Generous on
 * purpose — real progress events fire every 1-2s of encoding on a healthy run, but the first
 * one can take a little while to arrive on a large/high-quality job, and this must never trip
 * on a legitimately slow-but-working export. Overridable via env for tests. */
function exportStallTimeoutMs(): number {
  const override = process.env.SUBLY_EXPORT_STALL_TIMEOUT_MS;
  return override ? Number(override) : 5 * 60 * 1000;
}

// The pixel count of the SHORTER edge at each tier. Scaling by the shorter edge is what makes
// "1080p" mean the conventional 1080x1920 for a vertical canvas and 1920x1080 for a landscape
// one, rather than always treating the requested number as a literal output height regardless
// of orientation — see computeExportDimensions.
const RESOLUTION_SHORT_EDGE: Record<ExportOptions["resolution"], number> = {
  "720p": 720,
  "1080p": 1080,
  "4k": 2160,
};

const QUALITY_CRF: Record<ExportOptions["quality"], number> = {
  low: 30,
  medium: 24,
  high: 19,
  maximum: 15,
};

/** Rounds to the nearest even integer (h264 requires even width/height), never below 2. */
function evenDimension(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** ffmpeg's `color=` lavfi source wants `0xRRGGBB`, not CSS's `#RRGGBB`. */
function toFfmpegColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return `0x${m ? m[1] : "000000"}`;
}

export interface ExportRenderPlan {
  /** true = real video input, fit (never cropped/stretched) + padded with background; false = solid-color lavfi source. */
  useVideo: boolean;
  /** Set only when !useVideo — the lavfi `color=...` source spec, used as ffmpeg's `-i`. */
  lavfiInput?: string;
  /** The `-vf`/videoFilters chain, in both cases ending with the `subtitles=` burn-in. */
  filter: string;
  /** Output pixel size — also what the ASS document's PlayResX/PlayResY must match 1:1. */
  width: number;
  height: number;
}

/**
 * The single source of truth for an export's output pixel size, in BOTH videoVisible
 * branches: the project's own composition canvas, scaled by the chosen export-quality tier
 * while preserving the canvas's exact aspect ratio (never substituting a different one) —
 * see lib/export-pipeline.ts, which also uses this to size the ASS document's PlayResX/Y so
 * captions map 1:1 onto pixels regardless of which branch actually renders.
 */
export function computeExportDimensions(
  canvasWidth: number,
  canvasHeight: number,
  resolution: ExportOptions["resolution"],
): { width: number; height: number } {
  const scale = RESOLUTION_SHORT_EDGE[resolution] / Math.min(canvasWidth, canvasHeight);
  return { width: evenDimension(canvasWidth * scale), height: evenDimension(canvasHeight * scale) };
}

/**
 * Pure planning step for `renderExport`, factored out so the branching between "burn
 * captions over the real video" and "burn captions over a solid-color canvas" (see
 * types/subtitle.ts CompositionSettings.videoVisible) can be unit-tested without actually
 * invoking ffmpeg.
 */
export function planExportRender(opts: ExportOptions): ExportRenderPlan {
  const assArg = escapeAssPathForFfmpeg(opts.assPath);
  const fontsdirArg = opts.fontsDir ? `:fontsdir='${escapeAssPathForFfmpeg(opts.fontsDir)}'` : "";
  const subtitlesFilter = `subtitles='${assArg}'${fontsdirArg}`;
  const bg = toFfmpegColor(opts.backgroundColor ?? "#000000");
  const { width, height } = computeExportDimensions(opts.canvasWidth, opts.canvasHeight, opts.resolution);

  if (opts.videoVisible === false) {
    // No source video at all: a flat color the exact size of the canvas, held for the
    // project's edited-timeline duration (trim/cuts already collapsed into this number by
    // the caller — see lib/timeline/edit-model.ts editedDuration) — so captions land on
    // identical timestamps to a video-on export of the same project. Nothing to fit/pad/
    // select beyond the caption burn-in and a forced 1:1 pixel aspect ratio (see the
    // videoVisible:true branch's own comment on setsar=1 for why this is always set
    // explicitly rather than left to the encoder's default).
    const duration = Math.max(0.1, opts.duration ?? 1);
    return {
      useVideo: false,
      lavfiInput: `color=c=${bg}:s=${width}x${height}:d=${duration}:r=${opts.fps}`,
      filter: `setsar=1,${subtitlesFilter}`,
      width,
      height,
    };
  }

  // Trim/filler/silence cuts are applied as a single `select`/`aselect` expression (kept
  // ranges OR'd together) rather than the concat demuxer — one filter, one pass, no temp
  // files, and frame timestamps are renumbered by setpts/asetpts so the kept segments play
  // back back-to-back with no gap, exactly matching the edited-timeline model.
  const hasCuts = opts.keepRanges && opts.keepRanges.length > 0;
  const selectExpr = hasCuts ? opts.keepRanges!.map((r) => `between(t,${r.start},${r.end})`).join("+") : null;
  const cutVideoFilter = selectExpr ? `select='${selectExpr}',setpts=N/FRAME_RATE/TB,` : "";

  // 1) drop cut ranges (if any), 2) FIT the source inside the canvas preserving its own
  // aspect ratio (never crops, never stretches — `force_original_aspect_ratio=decrease`
  // shrinks to fit within width x height), 3) pad the result out to the full canvas size
  // with the project's background color, centering the video exactly like the live
  // preview's `object-contain` does, 4) force a 1:1 pixel (sample) aspect ratio explicitly —
  // confirmed by direct ffprobe on real rendered output that leaving this to libx264's own
  // default produces a very slightly non-1:1 SAR (observed: 1216:1215) for several canvas
  // sizes, including a perfectly SQUARE 1080x1080 canvas, which should be structurally
  // incapable of having anything but SAR/DAR 1:1 — an encoder-level quirk unrelated to this
  // filter chain's own math (confirmed identical for a 1:1-scale export, i.e. one where
  // scale/pad above are themselves no-ops), fixed the standard way: state the pixel aspect
  // ratio explicitly instead of leaving it to be inferred. 5) burn subtitles at that same
  // resolution so ASS PlayRes maps 1:1 onto pixel size. `fontsdir` points libass at our
  // cached font files directly — none of our fonts are installed system-wide on whatever
  // machine runs ffmpeg, so without it libass would silently substitute an unrelated
  // fallback font instead of the one the user chose.
  const filter =
    cutVideoFilter +
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bg},` +
    `setsar=1,` +
    subtitlesFilter;

  return { useVideo: true, filter, width, height };
}

/**
 * Renders the final subtitled video. When `videoVisible` is true (default): fits the source
 * video inside the project's composition canvas preserving its own aspect ratio (never
 * cropping or stretching), pads any unused canvas area with the background color, then burns
 * the ASS file in via libass — matching the live preview's `object-contain` framing exactly.
 * When false: renders a solid-color canvas + captions only — see planExportRender.
 */
export function renderExport(opts: ExportOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const plan = planExportRender(opts);

    const command = plan.useVideo
      ? ffmpeg(opts.inputPath)
      : ffmpeg().input(plan.lavfiInput!).inputFormat("lavfi");
    command.videoFilters(plan.filter);

    if (plan.useVideo) {
      const hasCuts = opts.keepRanges && opts.keepRanges.length > 0;
      if (hasCuts) {
        const selectExpr = opts.keepRanges!.map((r) => `between(t,${r.start},${r.end})`).join("+");
        command.audioFilters([`aselect='${selectExpr}'`, "asetpts=N/SR/TB"]);
      }
    }

    command
      .fps(opts.fps)
      .videoCodec("libx264")
      .outputOptions([`-crf ${QUALITY_CRF[opts.quality]}`, "-preset veryfast", "-pix_fmt yuv420p", "-movflags +faststart"]);

    // The lavfi color source has no audio stream to encode — a video-off export is
    // video-only (background + captions), so there's nothing to attach an audio codec to.
    if (plan.useVideo) command.audioCodec("aac").audioBitrate("192k");
    else command.noAudio();

    // `reason` distinguishes a deliberate kill (cancel/stall) from a genuine ffmpeg failure —
    // fluent-ffmpeg's "error" event fires in all three cases (a killed process looks like an
    // error to it), so without this every cancellation would incorrectly surface as "export
    // failed" instead of the specific, actionable error the caller asked for.
    let reason: "cancel" | "stall" | null = null;
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    function clearStallTimer() {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    }
    function armStallTimer() {
      clearStallTimer();
      stallTimer = setTimeout(() => {
        reason = "stall";
        command.kill("SIGKILL");
      }, exportStallTimeoutMs());
    }
    function finish(fn: () => void) {
      if (settled) return;
      settled = true;
      clearStallTimer();
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    }
    function onAbort() {
      reason = "cancel";
      command.kill("SIGKILL");
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        finish(() => reject(new ExportCancelledError()));
        return;
      }
      opts.signal.addEventListener("abort", onAbort);
    }
    armStallTimer(); // covers the window before the first progress event too — a process that never starts producing output is just as stalled as one that stops midway

    command
      .on("progress", (p) => {
        armStallTimer(); // real progress just arrived — push the stall deadline out
        opts.onProgress?.(Math.min(99, Math.round(p.percent ?? 0)));
      })
      .on("error", (err) => finish(() => reject(reason === "cancel" ? new ExportCancelledError() : reason === "stall" ? new ExportStalledError() : err)))
      .on("end", () => finish(resolve))
      .save(opts.outputPath);
  });
}
