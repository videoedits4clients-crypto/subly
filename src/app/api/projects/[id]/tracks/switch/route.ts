import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { toJson, fromJson } from "@/lib/db-json";
import { projectInclude, toProjectData } from "@/lib/project-mapper";
import type { Subtitle } from "@/types/subtitle";

const schema = z.object({ language: z.string() });

/** Switches the project's active working transcript to a previously-saved SubtitleTrack, without losing whatever is currently active (it gets archived under its own language first). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id: projectId } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id: projectId }, include: projectInclude });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const track = await prisma.subtitleTrack.findUnique({
    where: { projectId_language: { projectId, language: parsed.data.language } },
  });
  if (!track) return NextResponse.json({ error: "That language version doesn't exist yet." }, { status: 404 });

  const current = toProjectData(project);
  const targetSubtitles = fromJson<Subtitle[]>(track.subtitles, []);

  await prisma.$transaction(async (tx) => {
    // Archive whatever's currently active under its own language before
    // switching away from it, so switching is always non-destructive too.
    if (current.subtitles.length > 0) {
      await tx.subtitleTrack.upsert({
        where: { projectId_language: { projectId, language: current.language } },
        create: { projectId, language: current.language, label: current.language.toUpperCase(), subtitles: toJson(current.subtitles) ?? "[]" },
        update: { subtitles: toJson(current.subtitles) ?? "[]" },
      });
    }

    await tx.subtitle.deleteMany({ where: { projectId } });
    await tx.subtitle.createMany({
      data: targetSubtitles.map((s) => ({
        id: s.id,
        projectId,
        index: s.index,
        start: s.start,
        end: s.end,
        text: s.text,
        words: toJson(s.words) ?? "[]",
        style: toJson(s.style),
        animation: toJson(s.animation),
      })),
    });

    await tx.project.update({ where: { id: projectId }, data: { language: parsed.data.language } });
  });

  const updated = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: projectInclude });
  return NextResponse.json(toProjectData(updated));
}
