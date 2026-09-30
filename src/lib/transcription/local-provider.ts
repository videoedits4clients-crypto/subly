import path from "path";
import os from "os";
import type { TranscriptionProvider, TranscriptionResult } from "./types.ts";
import { ensureModelDownloaded, ensureModelLoaded, transcribeLocal, type LocalWhisperConfig } from "./local-whisper-sidecar.ts";

/** Where downloaded Whisper models are cached — an OS app-data directory, never inside a project folder (desktop spec section 7/11). */
export function defaultModelDir(): string {
  return process.env.SUBLY_MODEL_DIR || path.join(os.homedir(), ".subly", "models");
}

export const DEFAULT_LOCAL_MODEL = "small";

/**
 * Per-language override of the local model — see the Gujarati small-vs-medium
 * benchmark investigation (real 61.3s Gujarati test audio, faster-whisper,
 * language="gu", word_timestamps=true, vad_filter=true, device="cpu",
 * compute_type="int8"): "small" silently dropped ~30s of real speech and
 * produced fragmented output; "medium" transcribed continuously with
 * substantially better Gujarati vocabulary/terminology, at essentially the
 * same transcription time on that clip. Every language NOT listed here keeps
 * using DEFAULT_LOCAL_MODEL exactly as before — this is an additive,
 * per-language exception, not a global default change. Add a future
 * language's own benchmarked override here the same way.
 */
const LANGUAGE_MODEL_OVERRIDES: Partial<Record<string, string>> = {
  gu: "medium",
};

/**
 * Resolves which local model to use for a given (already-known) transcription
 * language — `undefined` (Whisper "auto-detect") falls through to
 * DEFAULT_LOCAL_MODEL, since the model has to be chosen and loaded BEFORE
 * Whisper transcribes and detects the language (see local-whisper-sidecar.ts:
 * `ensureModelLoaded` always runs before `transcribeLocal`) — there is no
 * point at which an auto-detected "this was actually Gujarati" result could
 * still change which model already ran. Only an explicit, user-selected
 * language can benefit from this override.
 */
export function resolveLocalModel(language: string | undefined): string {
  if (language && LANGUAGE_MODEL_OVERRIDES[language]) return LANGUAGE_MODEL_OVERRIDES[language];
  return DEFAULT_LOCAL_MODEL;
}

/**
 * Local, offline, zero-cost transcription via faster-whisper running in a
 * bundled Python sidecar (see local-whisper-sidecar.ts). CPU + int8 by
 * default — GPU is never auto-selected (desktop spec sections 5 and 21).
 */
export class LocalWhisperProvider implements TranscriptionProvider {
  name = "local";
  private config: LocalWhisperConfig;
  private onProgress?: (percent: number) => void;
  private onRequestId?: (id: string) => void;

  constructor(opts?: {
    model?: string;
    modelDir?: string;
    language?: string;
    onProgress?: (percent: number) => void;
    /** See local-whisper-sidecar.ts transcribeLocal — lets a caller (pipeline.ts) capture the
     * in-flight request id for cancellation before transcription finishes. */
    onRequestId?: (id: string) => void;
  }) {
    this.config = {
      model: opts?.model || process.env.SUBLY_WHISPER_MODEL || resolveLocalModel(opts?.language),
      device: "cpu",
      computeType: "int8",
      modelDir: opts?.modelDir || defaultModelDir(),
    };
    this.onProgress = opts?.onProgress;
    this.onRequestId = opts?.onRequestId;
  }

  async transcribe(audioPath: string, opts?: { language?: string }): Promise<TranscriptionResult> {
    await ensureModelDownloaded(this.config, this.onProgress, this.onRequestId);
    await ensureModelLoaded(this.config, this.onRequestId);
    const result = await transcribeLocal(audioPath, opts?.language, this.onProgress, this.onRequestId);

    return {
      language: result.language,
      fullText: result.fullText,
      words: result.words.map((w) => ({ text: w.text, start: w.start, end: w.end, confidence: w.confidence })),
      segments: result.segments,
      provider: "local",
    };
  }
}
