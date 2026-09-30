import { promises as fs } from "fs";
import type { TranscriptionProvider, TranscriptionResult } from "./types.ts";

// A short, realistic sample script used whenever OPENAI_API_KEY is unset, so
// the full pipeline (segmentation, editor, styling, export) can be exercised
// without any external API. Word timings are synthesized at a natural
// speaking pace (~2.4 words/sec) with slightly randomized per-word duration
// and small pauses at punctuation, so karaoke highlighting still looks real.
// Task 146220 (P19.17): reworded away from "style every single word... fonts, colors,
// animations" — the same per-word overclaim flagged in how-it-works.tsx/features.tsx. Fonts,
// colors and animation presets are genuinely customizable, just at the caption level, not
// per individual word; per-word highlighting as each word is spoken is the real per-word effect.
const SAMPLE_SCRIPT =
  "Welcome to our channel! Today we're going to show you something amazing. " +
  "This tool automatically transcribes your video, generates perfectly timed subtitles, " +
  "and lets you fully customize the look — fonts, colors, animations and presets. " +
  "Each word even highlights as it's spoken. Once you're happy with the look, " +
  "just hit export and we'll burn the captions directly into your video. Let's get started.";

function synthesizeWords(script: string, durationHint?: number) {
  const tokens = script.split(/\s+/).filter(Boolean);
  const words: { text: string; start: number; end: number }[] = [];
  let t = 0.3;
  for (const token of tokens) {
    const base = 0.16 + Math.min(0.22, token.length * 0.02);
    const jitter = ((token.length * 7) % 5) * 0.01;
    const dur = base + jitter;
    words.push({ text: token, start: Number(t.toFixed(2)), end: Number((t + dur).toFixed(2)) });
    t += dur;
    if (/[.!?]$/.test(token)) t += 0.35;
    else if (/[,;:]$/.test(token)) t += 0.15;
    else t += 0.05;
  }
  if (durationHint && t > 0) {
    const scale = Math.max(0.4, (durationHint - 0.3) / t);
    let cursor = 0.3;
    for (const w of words) {
      const dur = (w.end - w.start) * scale;
      w.start = Number(cursor.toFixed(2));
      w.end = Number((cursor + dur).toFixed(2));
      cursor = w.end + 0.03 * scale;
    }
  }
  return words;
}

function groupSegments(words: { text: string; start: number; end: number }[]) {
  const segments: { start: number; end: number; text: string }[] = [];
  let current: typeof words = [];
  for (const w of words) {
    current.push(w);
    if (/[.!?]$/.test(w.text)) {
      segments.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((x) => x.text).join(" ") });
      current = [];
    }
  }
  if (current.length) {
    segments.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((x) => x.text).join(" ") });
  }
  return segments;
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  name = "mock";

  async transcribe(audioPath: string, opts?: { language?: string }): Promise<TranscriptionResult> {
    // Simulate processing latency proportional to file size so the UI's
    // progress states feel real in demo mode too.
    let sizeBytes = 0;
    try {
      sizeBytes = (await fs.stat(audioPath)).size;
    } catch {
      // audio file may not exist yet in pure-demo contexts — ignore.
    }
    const durationHint = sizeBytes ? sizeBytes / (16000 * 2) : undefined;
    await new Promise((r) => setTimeout(r, Math.min(2500, 400 + sizeBytes / 5000)));

    const words = synthesizeWords(SAMPLE_SCRIPT, durationHint);
    const segments = groupSegments(words);

    return {
      language: opts?.language ?? "en",
      fullText: SAMPLE_SCRIPT,
      words,
      segments,
      provider: "mock",
    };
  }
}
