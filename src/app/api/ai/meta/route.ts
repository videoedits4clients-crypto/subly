import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateTitleAndDescription } from "@/lib/ai";

const schema = z.object({ fullText: z.string().min(1) });

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const limited = await checkRateLimit(userId, { bucket: "ai", limit: 20, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const meta = await generateTitleAndDescription(parsed.data.fullText);
  return NextResponse.json(meta);
}
