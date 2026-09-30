import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id: projectId, exportId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const job = await prisma.exportJob.findUnique({ where: { id: exportId } });
  if (!job || job.projectId !== projectId) {
    return NextResponse.json({ error: "Export job not found." }, { status: 404 });
  }

  return NextResponse.json(job);
}
