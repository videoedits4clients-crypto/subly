import { promises as fs } from "fs";
import { probeVideo, type VideoProbe } from "./ffmpeg/index.ts";

/** Thrown by verifyExportOutput's caller (export-pipeline.ts) to route a verification
 * failure through the existing catch-block error-message branching (see
 * FontResolutionError/ExportCancelledError/ExportStalledError for the same pattern) — the
 * message is already user-readable, so the catch block just needs to reuse it verbatim. */
export class ExportVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportVerificationError";
  }
}

export interface VerifyExportOutputOptions {
  outputPath: string;
  /** Bounded so a malformed/corrupt file fails cleanly instead of hanging the export worker
   * (ffprobe can otherwise wait indefinitely on a pathological file). */
  timeoutMs?: number;
  /** Injectable ffprobe call — defaults to the real, already-existing probeVideo (see
   * lib/ffmpeg/index.ts, otherwise only used by the upload route) so tests can supply a fake
   * result without touching a real file or a real ffmpeg binary. */
  probe?: (filePath: string) => Promise<VideoProbe>;
  /** Injectable file stat — defaults to fs.stat, likewise for testability. */
  stat?: (filePath: string) => Promise<{ size: number }>;
}

export interface ExportOutputVerificationResult {
  ok: boolean;
  /** User-readable, jargon-free message — no ffmpeg command lines, filesystem paths, stack
   * traces, or ffprobe terminology. Set only when ok is false. */
  message?: string;
  /** The probed media info, for the pipeline to use however it likes (e.g. logging). Set only
   * when ok is true. */
  metadata?: VideoProbe;
}

const DEFAULT_TIMEOUT_MS = 20_000;

const MSG_MISSING = "Export failed: the output file was not created.";
const MSG_INVALID = "Export failed: the exported video could not be verified.";
const MSG_CORRUPT = "Export failed: the exported video appears to be incomplete or corrupted.";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("export verification: ffprobe timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * The gate between "ffmpeg's process exited without error" and "this export is actually safe
 * to hand to the user" — see lib/export-pipeline.ts, which previously treated the former as
 * sufficient proof of the latter. Checks, in order: the output file exists, is non-empty, can
 * be read by ffprobe within a bounded timeout, reports a real video stream, and has a sane
 * non-zero duration. Never throws — every failure path (including an unexpected exception)
 * resolves to `{ ok: false, message }` so a corrupt/adversarial output can never hang or crash
 * the export worker.
 *
 * SUBLY only ever exports burned-in video (mp4) — there is no audio-only export mode — so only
 * the video-stream branch is implemented here.
 */
export async function verifyExportOutput(options: VerifyExportOutputOptions): Promise<ExportOutputVerificationResult> {
  const { outputPath, timeoutMs = DEFAULT_TIMEOUT_MS, probe = probeVideo, stat = (p: string) => fs.stat(p) } = options;

  try {
    let fileStat: { size: number };
    try {
      fileStat = await stat(outputPath);
    } catch {
      return { ok: false, message: MSG_MISSING };
    }

    if (!(fileStat.size > 0)) {
      return { ok: false, message: MSG_INVALID };
    }

    let metadata: VideoProbe;
    try {
      metadata = await withTimeout(probe(outputPath), timeoutMs);
    } catch {
      return { ok: false, message: MSG_CORRUPT };
    }

    if (!metadata || !(metadata.width > 0) || !(metadata.height > 0)) {
      return { ok: false, message: MSG_INVALID };
    }

    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
      return { ok: false, message: MSG_CORRUPT };
    }

    return { ok: true, metadata };
  } catch {
    return { ok: false, message: MSG_INVALID };
  }
}
