import type { Word } from "@/types/subtitle";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  language: string;
  words: Word[];
  segments: TranscriptSegment[];
  fullText: string;
  provider: "openai" | "local" | "mock";
}

export interface TranscriptionProvider {
  name: string;
  /** `audioPath` is a local WAV file path (mono 16kHz), produced by lib/ffmpeg extractAudio. */
  transcribe(audioPath: string, opts?: { language?: string }): Promise<TranscriptionResult>;
}
