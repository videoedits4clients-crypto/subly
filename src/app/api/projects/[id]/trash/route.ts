import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { track } from "@/lib/analytics";
import { getStorage } from "@/lib/storage";

/** Restores a trashed project. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await prisma.project.update({ where: { id }, data: { deletedAt: null } });
  track("project_restored", { projectId: id });
  return NextResponse.json({ ok: true });
}

/**
 * Permanently deletes a trashed project. Requires it to already be in Trash — use DELETE
 * /api/projects/:id to trash it first.
 *
 * Cleanup performed, in order:
 *  1. Every file under this project's own storage prefix (<projectId>/...) — source video,
 *     extracted audio, exported MP4s, and any .ass sidecars — via storage.delDir(id), which
 *     independently verifies `id` is a safe, single-segment path before touching disk (see
 *     lib/storage/local.ts) so this can never reach into another project's files. Best-effort:
 *     a storage error (e.g. a file already gone, or briefly locked) is logged but never blocks
 *     the database cleanup below — an unremovable Trash entry would be a worse outcome than a
 *     rare orphaned file, and delDir/fs.rm already tolerate a target that doesn't exist.
 *  2. The Project row itself, which cascades (see prisma/schema.prisma's onDelete: Cascade) to
 *     every Subtitle, VideoAsset, SubtitleTrack, and ExportJob row referencing it — captions
 *     and export job records need no separate file-system cleanup beyond step 1, since they're
 *     pure database rows (a caption is text in a column, never its own file). There is also no
 *     separate thumbnail/cache file to clean up: the dashboard's project thumbnail is the
 *     source video itself (see ProjectCard), already covered by step 1.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (!project.deletedAt) {
    return NextResponse.json({ error: "Move the project to Trash before deleting it permanently." }, { status: 400 });
  }

  await getStorage()
    .delDir(id)
    .catch((err) => {
      console.error(`[trash] failed to remove storage files for project ${id} (continuing with DB delete):`, err);
    });

  await prisma.project.delete({ where: { id } });
  track("project_permanently_deleted", { projectId: id });
  return NextResponse.json({ ok: true });
}
