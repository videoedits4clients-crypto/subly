import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { fromJson } from "@/lib/db-json";

/** Lists every saved language version of this project's transcript. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const tracks = await prisma.subtitleTrack.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(
    tracks.map((t) => ({
      language: t.language,
      label: t.label,
      subtitleCount: fromJson<unknown[]>(t.subtitles, []).length,
      isActive: t.language === project.language,
    })),
  );
}
