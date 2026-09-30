import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { cancelActiveTranscription } from "@/lib/pipeline";

/** Cancels an in-progress transcription. Safe to call even if nothing is actually running
 * (e.g. a stale button click after the job already finished) — cancelActiveTranscription just
 * no-ops in that case; the actual status transition to ERROR happens asynchronously once the
 * worker acknowledges the cancel (see pipeline.ts's catch block), same as any other failure. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id }, select: { ownerId: true, status: true } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (project.status !== "LOADING" && project.status !== "TRANSCRIBING") {
    return NextResponse.json({ error: "Nothing to cancel." }, { status: 400 });
  }

  const cancelled = cancelActiveTranscription(id);
  return NextResponse.json({ ok: true, cancelled });
}
