import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { MockTranscriptionProvider } from "./mock-provider.ts";
import { OpenAIWhisperProvider } from "./openai-provider.ts";
import { LocalWhisperProvider } from "./local-provider.ts";
import type { TranscriptionProvider } from "./types.ts";

let localAvailableCache: boolean | null = null;

/** Checks once (and caches) whether local transcription can actually run — either the frozen,
 * Python-free whisper-worker.exe (the packaged desktop build; SUBLY_WHISPER_WORKER_EXE), or a
 * dev machine with `pip install faster-whisper` done. Never assumes system Python exists. */
export function isLocalWhisperAvailable(): boolean {
  if (localAvailableCache !== null) return localAvailableCache;

  const frozenExe = process.env.SUBLY_WHISPER_WORKER_EXE;
  if (frozenExe) {
    localAvailableCache = existsSync(frozenExe);
    return localAvailableCache;
  }

  try {
    const bin = process.env.SUBLY_PYTHON_BIN || "python";
    const result = spawnSync(bin, ["-c", "import faster_whisper"], { timeout: 10_000 });
    localAvailableCache = result.status === 0;
  } catch {
    localAvailableCache = false;
  }
  return localAvailableCache;
}

/** Thrown instead of silently returning MockTranscriptionProvider when running as the
 * packaged/desktop build (SUBLY_DESKTOP=1) and no real transcription engine is usable — see
 * getTranscriptionProvider. A demo/mock transcript must never be produced in that mode: a
 * user who installed the desktop app expects real local transcription, and a silent fake
 * result would be actively misleading, not a graceful degradation. */
export class LocalWhisperUnavailableError extends Error {
  constructor() {
    super(
      "The bundled transcription engine is unavailable. This installation may be corrupted — " +
        "please reinstall SUBLY. (Local Whisper could not be found, and no cloud fallback is configured.)",
    );
    this.name = "LocalWhisperUnavailableError";
  }
}

/**
 * Provider precedence: local (default, offline, zero-cost) unless explicitly
 * overridden — OpenAI is an optional cloud feature, never mandatory (desktop
 * spec section 4/15). Falls back to the mock provider only outside desktop mode
 * (the hosted/SaaS build, where a clearly-labeled demo transcript is an accepted
 * product experience on a machine without Python/faster-whisper set up). In
 * desktop mode (SUBLY_DESKTOP=1), silently faking a transcript is never
 * acceptable — see LocalWhisperUnavailableError.
 *
 * `language` (the same already-resolved value passed to `provider.transcribe()`
 * — i.e. `undefined` for "auto", a real code otherwise) lets the local
 * provider pick a per-language model override (see local-provider.ts
 * resolveLocalModel) BEFORE the model is loaded. Irrelevant to the other
 * providers: OpenAI's API has no local model to choose, and the mock provider
 * has none either.
 */
export function getTranscriptionProvider(opts?: {
  language?: string;
  onProgress?: (percent: number) => void;
  onRequestId?: (id: string) => void;
}): TranscriptionProvider {
  const forced = process.env.SUBLY_TRANSCRIPTION_PROVIDER;
  if (forced === "openai" && process.env.OPENAI_API_KEY) return new OpenAIWhisperProvider(process.env.OPENAI_API_KEY);
  // "mock" stays available even in desktop mode when explicitly forced — this is the
  // documented dev/test-only escape hatch (see isDemoMode's own callers), not something that
  // can happen implicitly from local Whisper simply being missing.
  if (forced === "mock") return new MockTranscriptionProvider();

  if (isLocalWhisperAvailable()) {
    return new LocalWhisperProvider({ language: opts?.language, onProgress: opts?.onProgress, onRequestId: opts?.onRequestId });
  }
  if (process.env.OPENAI_API_KEY) return new OpenAIWhisperProvider(process.env.OPENAI_API_KEY);
  if (process.env.SUBLY_DESKTOP === "1") throw new LocalWhisperUnavailableError();
  return new MockTranscriptionProvider();
}

/** True when transcription will fall back to the offline demo script — i.e. neither local Whisper nor a real OpenAI key is available. */
export function isDemoMode(): boolean {
  return !isLocalWhisperAvailable() && !process.env.OPENAI_API_KEY;
}

export type { TranscriptionProvider, TranscriptionResult, TranscriptSegment } from "./types.ts";
