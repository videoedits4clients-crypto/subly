import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { processVideo } from "@/lib/pipeline";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id }, include: { video: true } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (!project.video) {
    return NextResponse.json({ error: "No video uploaded yet." }, { status: 400 });
  }

  await prisma.project.update({ where: { id }, data: { status: "LOADING", errorMessage: null } });
  void processVideo(id);

  return NextResponse.json({ ok: true });
}
