import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { detectSilence } from "@/lib/ffmpeg";

const schema = z.object({ minDuration: z.number().min(0.2).max(10) });

/** Detects candidate silence ranges — returns them for the client to review/select before cutting; never applies anything itself. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const limited = await checkRateLimit(userId, { bucket: "ai", limit: 20, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const { id: projectId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { video: true } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (!project.video) return NextResponse.json({ error: "No video uploaded yet." }, { status: 400 });

  try {
    const storage = getStorage();
    const inputPath = await storage.getPath(project.video.url.replace(/^\/api\/files\//, ""));
    const ranges = await detectSilence(inputPath, parsed.data.minDuration);
    return NextResponse.json({ ranges });
  } catch (err) {
    console.error(`[detect-silence] project ${projectId} failed:`, err);
    return NextResponse.json({ error: "Couldn't analyze the audio for silence." }, { status: 500 });
  }
}
