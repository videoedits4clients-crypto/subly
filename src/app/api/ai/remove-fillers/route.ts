import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { markFillerWords } from "@/lib/subtitles/fillers";
import { segmentWords } from "@/lib/subtitles/segment";
import { resolveTimingRules } from "@/types/subtitle";

const schema = z.object({
  words: z.array(
    z.object({
      text: z.string(),
      start: z.number(),
      end: z.number(),
      confidence: z.number().optional(),
      removed: z.boolean().optional(),
      style: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  timingRules: z
    .object({
      minDuration: z.number(),
      maxDuration: z.number(),
      maxCharsPerLine: z.number(),
      maxLines: z.number(),
      maxWordsPerCaption: z.number().optional(),
      smartSegmentation: z.boolean().optional(),
    })
    .optional(),
});

/** Deterministic (no AI call needed) filler-word detection + re-segmentation. Never deletes words — only flags them `removed`, so callers can restore. */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const limited = await checkRateLimit(userId, { bucket: "ai", limit: 20, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const marked = markFillerWords(parsed.data.words);
  const removedCount = marked.filter((w) => w.removed).length;
  const subtitles = segmentWords(marked, resolveTimingRules(parsed.data.timingRules));

  return NextResponse.json({ subtitles, removedCount });
}
