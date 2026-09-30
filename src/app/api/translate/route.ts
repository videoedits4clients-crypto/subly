import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { translateSubtitles, isAiDemoMode } from "@/lib/ai";
import { TRANSLATABLE_LANGUAGES } from "@/types/subtitle";

const schema = z.object({
  subtitles: z.array(z.object({ id: z.string(), text: z.string() })),
  targetLanguage: z.enum(TRANSLATABLE_LANGUAGES),
});

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const limited = await checkRateLimit(userId, { bucket: "ai", limit: 20, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const texts = await translateSubtitles(parsed.data.subtitles, parsed.data.targetLanguage);
  return NextResponse.json({ texts, demo: isAiDemoMode() });
}
