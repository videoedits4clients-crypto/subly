import { NextResponse } from "next/server";
import { z } from "zod";
import { loadFontMetrics } from "@/lib/fonts/export-font-metrics";
import { codePointsOf } from "@/lib/fonts/font-metrics";

/**
 * Font metrics for the editor preview (P20.4). The preview wraps and spaces captions with the SAME layout
 * model the export uses (lib/subtitles/caption-layout.ts), and that model measures text with font advance
 * widths read from the very font files the export hands to libass — so the preview asks the server for them
 * here instead of re-deriving them from the browser's own (differently-shaped) text measurement.
 *
 * Body: { fonts: [{ family, weight, source? }], text } → { fonts: [{ family, weight, source, data | null }] }
 * where `data` is FontMetricsData with the advances of every character in `text` (plus Basic Latin,
 * Latin-1/Extended-A, general punctuation, Devanagari and Gujarati). `data: null` means the font isn't
 * available, and the preview then falls back to the browser's own wrapping for that caption.
 */
const bodySchema = z.object({
  fonts: z
    .array(z.object({ family: z.string().min(1).max(120), weight: z.number().int().min(100).max(900), source: z.enum(["bundled", "system"]).optional() }))
    .min(1)
    .max(64),
  text: z.string().max(200_000),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { fonts, text } = parsed.data;
  const codePoints = codePointsOf(text);
  const out = await Promise.all(
    fonts.map(async (f) => {
      // installed Windows fonts only exist for the desktop build (see /api/system/fonts)
      const source = f.source === "system" && process.env.SUBLY_DESKTOP === "1" ? "system" : "bundled";
      const data = await loadFontMetrics({ family: f.family, weight: f.weight, source }, codePoints).catch(() => null);
      return { family: f.family, weight: f.weight, source: f.source ?? "bundled", data };
    }),
  );
  return NextResponse.json({ fonts: out });
}
