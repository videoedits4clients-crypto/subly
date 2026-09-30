import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { cancelActiveExport } from "@/lib/export-pipeline";

/** Cancels an in-progress export. Safe to call even if the job already finished/failed on its
 * own — cancelActiveExport just no-ops in that case. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id: projectId, exportId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const job = await prisma.exportJob.findUnique({ where: { id: exportId } });
  if (!job || job.projectId !== projectId) {
    return NextResponse.json({ error: "Export job not found." }, { status: 404 });
  }
  if (job.status !== "QUEUED" && job.status !== "RUNNING") {
    return NextResponse.json({ error: "Nothing to cancel." }, { status: 400 });
  }

  const cancelled = cancelActiveExport(exportId);
  return NextResponse.json({ ok: true, cancelled });
}
