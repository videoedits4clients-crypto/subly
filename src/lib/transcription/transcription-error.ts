/**
 * Structured transcription failures (P23.1).
 *
 * Until now every failure on the way from "uploaded video" to "captions" collapsed into one user-facing line
 * ("Something went wrong while generating subtitles.") and the real reason existed only in a server console nobody
 * can see in a packaged app. A real customer hit exactly that: the packaged app could not fetch its speech model on
 * their machine, and neither they nor we could tell. This module gives every failure a CODE, the STAGE it happened
 * in, and the evidence (exit code, worker stderr tail) — for the diagnostics log — while the user-facing text stays short
 * and free of paths, stack traces and internals.
 */

export type TranscriptionErrorCode =
  | "INPUT_INVALID"
  | "MEDIA_PROBE_FAILED"
  | "FFMPEG_NOT_FOUND"
  | "FFMPEG_FAILED"
  | "WORKER_NOT_FOUND"
  | "WORKER_START_FAILED"
  | "MODEL_NOT_FOUND"
  | "MODEL_DOWNLOAD_FAILED"
  | "MODEL_LOAD_FAILED"
  | "WORKER_CRASHED"
  | "WORKER_TIMEOUT"
  | "WORKER_CANCELLED"
  | "WORKER_BUSY"
  | "INVALID_WORKER_OUTPUT"
  | "TRANSCRIPTION_FAILED"
  | "STORAGE_FAILED"
  | "UNKNOWN_TRANSCRIPTION_ERROR";

export type TranscriptionStage = "probe" | "extract-audio" | "worker-start" | "model-prepare" | "model-load" | "transcribe" | "parse-output" | "persist";

export interface TranscriptionErrorDetails {
  exitCode?: number | null;
  signal?: string | null;
  /** Last lines the worker wrote to stderr (raw — sanitised before it is logged). */
  stderrTail?: string;
  /** Node's own error code for a failed spawn (ENOENT, EACCES, EPERM, UNKNOWN…). */
  systemCode?: string;
}

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly stage: TranscriptionStage | undefined;
  readonly details: TranscriptionErrorDetails;

  constructor(code: TranscriptionErrorCode, message: string, opts?: { stage?: TranscriptionStage; details?: TranscriptionErrorDetails; cause?: unknown }) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.stage = opts?.stage;
    this.details = opts?.details ?? {};
    if (opts?.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/** The generic line the app has always shown; kept verbatim for codes we can't say anything more useful about. */
export const GENERIC_TRANSCRIPTION_MESSAGE = "Something went wrong while generating subtitles.";

/**
 * What the user sees (stored in project.errorMessage and shown on the error screen). Short, actionable, no internals.
 * Cancelled / timed-out / busy keep the exact wording they already had.
 */
export function userMessageFor(code: TranscriptionErrorCode): string {
  switch (code) {
    case "WORKER_CANCELLED":
      return "Transcription cancelled.";
    case "WORKER_TIMEOUT":
      return "Transcription timed out — the worker stopped responding.";
    case "WORKER_BUSY":
      return "Another transcription was already in progress. Please wait for it to finish, then retry.";
    case "MODEL_DOWNLOAD_FAILED":
      return "SUBLY couldn't download its speech-recognition model. Check your internet connection (or firewall/VPN) and press Retry.";
    case "MODEL_NOT_FOUND":
    case "MODEL_LOAD_FAILED":
      return "SUBLY's speech-recognition model couldn't be loaded. Please reinstall SUBLY.";
    case "WORKER_NOT_FOUND":
      return "SUBLY's transcription engine is missing. Please reinstall SUBLY.";
    case "WORKER_START_FAILED":
      return "SUBLY's transcription engine couldn't start. Security software may be blocking it — allow SUBLY, then press Retry.";
    case "WORKER_CRASHED":
      return "SUBLY's transcription engine stopped unexpectedly. Press Retry; if it keeps happening, reinstall SUBLY.";
    case "FFMPEG_NOT_FOUND":
      return "SUBLY's media tools are missing. Please reinstall SUBLY.";
    case "FFMPEG_FAILED":
    case "MEDIA_PROBE_FAILED":
    case "INPUT_INVALID":
      return "SUBLY couldn't read the audio in this video. Try a different file or re-export it as MP4.";
    case "STORAGE_FAILED":
      return "SUBLY couldn't save the transcription. Check that your disk isn't full and press Retry.";
    case "INVALID_WORKER_OUTPUT":
    case "TRANSCRIPTION_FAILED":
    case "UNKNOWN_TRANSCRIPTION_ERROR":
    default:
      return GENERIC_TRANSCRIPTION_MESSAGE;
  }
}

/** True for codes where pressing Retry is pointless until something outside the app changes (a reinstall). */
export function isRetryFutile(code: TranscriptionErrorCode): boolean {
  return code === "WORKER_NOT_FOUND" || code === "MODEL_NOT_FOUND" || code === "FFMPEG_NOT_FOUND";
}

const SPAWN_NOT_FOUND = new Set(["ENOENT"]);

/**
 * Maps whatever was thrown at `stage` to a TranscriptionError. Already-structured errors pass through (gaining the stage
 * if they had none). The sidecar's plain-text worker messages ("Model download failed: …", "Model load failed: …") and
 * ffmpeg's error text are recognised by their stable prefixes; everything else is UNKNOWN_TRANSCRIPTION_ERROR with the
 * original message kept for the log.
 */
export function classifyTranscriptionError(err: unknown, stage: TranscriptionStage): TranscriptionError {
  if (err instanceof TranscriptionError) return err.stage ? err : new TranscriptionError(err.code, err.message, { stage, details: err.details, cause: err.cause });
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const systemCode = (err as { code?: unknown } | null)?.code;
  const sys = typeof systemCode === "string" ? systemCode : undefined;
  const make = (code: TranscriptionErrorCode, details?: TranscriptionErrorDetails) => new TranscriptionError(code, message, { stage, details: { systemCode: sys, ...details }, cause: err });

  if (name === "TranscriptionCancelledError") return make("WORKER_CANCELLED");
  if (name === "TranscriptionStalledError") return make("WORKER_TIMEOUT");
  if (name === "LocalWhisperUnavailableError") return make("WORKER_NOT_FOUND");
  if (/Another transcription is already running|already in progress/i.test(message)) return make("WORKER_BUSY");
  if (/^Model download failed/i.test(message)) return make("MODEL_DOWNLOAD_FAILED");
  if (/^Model load failed/i.test(message) || /Model not loaded yet/i.test(message)) return make("MODEL_LOAD_FAILED");
  if (/Cannot find ffmpeg|ffmpeg was not found|ffprobe.*(not found|ENOENT)/i.test(message) || (stage === "extract-audio" && sys === "ENOENT")) return make("FFMPEG_NOT_FOUND");
  if (stage === "probe") return make("MEDIA_PROBE_FAILED");
  if (stage === "extract-audio") return make(/Invalid data found|does not contain any stream|no audio|Output file .* does not contain/i.test(message) ? "INPUT_INVALID" : "FFMPEG_FAILED");
  if (stage === "worker-start" && sys) return make(SPAWN_NOT_FOUND.has(sys) ? "WORKER_NOT_FOUND" : "WORKER_START_FAILED");
  if (stage === "persist") return make("STORAGE_FAILED");
  if (stage === "parse-output") return make("INVALID_WORKER_OUTPUT");
  if (stage === "transcribe") return make("TRANSCRIPTION_FAILED");
  return make("UNKNOWN_TRANSCRIPTION_ERROR");
}
