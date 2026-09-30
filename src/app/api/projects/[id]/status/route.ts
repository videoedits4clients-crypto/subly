import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      ownerId: true,
      status: true,
      errorMessage: true,
      language: true,
      progress: true,
      processingStartedAt: true,
      _count: { select: { subtitles: true } },
    },
  });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Elapsed time is computed server-side (never an ETA — see ProcessingScreen) so the client
  // doesn't need to trust its own clock skew against processingStartedAt.
  const elapsedSeconds = project.processingStartedAt ? Math.max(0, Math.round((Date.now() - project.processingStartedAt.getTime()) / 1000)) : null;

  return NextResponse.json({
    status: project.status,
    errorMessage: project.errorMessage,
    language: project.language,
    subtitleCount: project._count.subtitles,
    progress: project.progress,
    elapsedSeconds,
  });
}
