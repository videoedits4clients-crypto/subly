import { createReadStream } from "fs";
import OpenAI from "openai";
import type { TranscriptionProvider, TranscriptionResult } from "./types.ts";

/**
 * Real Whisper-compatible transcription via the OpenAI API. Requests word-
 * level timestamp granularity (verbose_json), which OpenAI's Whisper endpoint
 * returns as `words: [{ word, start, end }]` alongside sentence `segments`.
 * Swap this file out (implementing TranscriptionProvider) to point at any
 * other Whisper-compatible endpoint (Azure, Groq, self-hosted faster-whisper).
 */
export class OpenAIWhisperProvider implements TranscriptionProvider {
  name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audioPath: string, opts?: { language?: string }): Promise<TranscriptionResult> {
    const response = await this.client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      language: opts?.language,
    });

    // The SDK's verbose_json type doesn't declare `words`/`segments` in all
    // versions — the API does return them when timestamp_granularities is set.
    const raw = response as unknown as {
      language?: string;
      text: string;
      words?: { word: string; start: number; end: number }[];
      segments?: { start: number; end: number; text: string }[];
    };

    return {
      language: raw.language ?? opts?.language ?? "en",
      fullText: raw.text,
      words: (raw.words ?? []).map((w) => ({ text: w.word, start: w.start, end: w.end })),
      segments: (raw.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
      provider: "openai",
    };
  }
}
