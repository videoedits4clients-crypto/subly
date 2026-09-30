import OpenAI from "openai";
import { LANGUAGES, type SupportedLanguage } from "@/types/subtitle";

export interface TextSubtitle {
  id: string;
  text: string;
}

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

export function isAiDemoMode() {
  return !process.env.OPENAI_API_KEY;
}

const MODEL = "gpt-4o-mini";

async function chatJSON<T>(system: string, user: string, fallback: T): Promise<T> {
  const c = client();
  if (!c) return fallback;
  try {
    const res = await c.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return fallback;
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

/** Fixes punctuation/capitalization for each subtitle's text, preserving word arrays 1:1 (only inserts/adjusts punctuation on word text). */
export async function fixPunctuation(subtitles: TextSubtitle[]): Promise<Record<string, string>> {
  const payload = subtitles.map((s) => ({ id: s.id, text: s.text.replace(/\n/g, " ") }));
  const fallback: Record<string, string> = Object.fromEntries(payload.map((p) => [p.id, p.text]));
  const result = await chatJSON<{ items: { id: string; text: string }[] }>(
    "You fix punctuation and capitalization in short video subtitle lines. Keep wording and word count IDENTICAL — only adjust casing and punctuation marks. Respond as JSON: {\"items\":[{\"id\":string,\"text\":string}]}",
    JSON.stringify(payload),
    { items: payload },
  );
  return Object.fromEntries(result.items.map((i) => [i.id, i.text]));
}

/** Translates each subtitle segment independently (preserves segmentation/timing), never the whole transcript as one block. */
export async function translateSubtitles(
  subtitles: TextSubtitle[],
  targetLanguage: SupportedLanguage,
): Promise<Record<string, string>> {
  const langLabel = LANGUAGES.find((l) => l.code === targetLanguage)?.label ?? targetLanguage;
  const payload = subtitles.map((s) => ({ id: s.id, text: s.text.replace(/\n/g, " ") }));

  const c = client();
  if (!c) {
    // Demo mode: no network call available — surface original text unchanged
    // so the UI can clearly show "translation requires an API key" rather
    // than silently faking a language it doesn't actually speak.
    return Object.fromEntries(payload.map((p) => [p.id, p.text]));
  }

  const result = await chatJSON<{ items: { id: string; text: string }[] }>(
    `You translate video subtitles into ${langLabel}. Translate each item's text independently, preserving meaning and a natural, concise phrasing suitable for on-screen captions. Use proper Unicode script for the target language. Respond as JSON: {"items":[{"id":string,"text":string}]}`,
    JSON.stringify(payload),
    { items: payload },
  );
  return Object.fromEntries(result.items.map((i) => [i.id, i.text]));
}

export async function rephraseCaptions(subtitles: TextSubtitle[], mode: "shorten" | "rephrase"): Promise<Record<string, string>> {
  const payload = subtitles.map((s) => ({ id: s.id, text: s.text.replace(/\n/g, " ") }));
  const instruction =
    mode === "shorten"
      ? "Shorten each caption to at most 6 words while preserving core meaning."
      : "Rephrase each caption to sound punchier and more engaging, similar length.";
  const result = await chatJSON<{ items: { id: string; text: string }[] }>(
    `You edit video captions. ${instruction} Respond as JSON: {"items":[{"id":string,"text":string}]}`,
    JSON.stringify(payload),
    { items: payload },
  );
  return Object.fromEntries(result.items.map((i) => [i.id, i.text]));
}

export async function generateTitleAndDescription(fullText: string): Promise<{ title: string; description: string }> {
  const fallback = {
    title: fullText.split(/[.!?]/)[0]?.slice(0, 60) || "Untitled video",
    description: fullText.slice(0, 200),
  };
  return chatJSON(
    'You write engaging, scroll-stopping social video titles and descriptions from a transcript. Respond as JSON: {"title": string, "description": string}',
    fullText.slice(0, 4000),
    fallback,
  );
}
