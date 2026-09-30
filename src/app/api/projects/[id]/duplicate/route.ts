import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { getStorage } from "@/lib/storage";

/** Storage keys are embedded in the /api/files/* URL — strip that prefix to recover the raw key. */
function keyFromUrl(url: string): string {
  return url.replace(/^\/api\/files\//, "");
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id }, include: { video: true, subtitles: true } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Video/audio files are NOT nested-created here: a duplicate must own its
  // own physical files, not just a copy of the original's URL, or editing/
  // replacing one project's video would silently affect the other's. The new
  // project's id (needed to build its own storage keys) only exists once the
  // row itself has been created, so files are copied in a second step below.
  const copy = await prisma.project.create({
    data: {
      ownerId: userId,
      name: `${project.name} (copy)`,
      status: project.status,
      language: project.language,
      aspectRatio: project.aspectRatio,
      globalStyle: project.globalStyle,
      animation: project.animation,
      timingRules: project.timingRules,
      brandKitId: project.brandKitId,
      subtitles: {
        create: project.subtitles.map((s) => ({
          index: s.index,
          start: s.start,
          end: s.end,
          text: s.text,
          words: s.words,
          style: s.style,
          animation: s.animation,
        })),
      },
    },
  });

  if (project.video) {
    const storage = getStorage();
    const srcVideoKey = keyFromUrl(project.video.url);
    const destVideoKey = path.posix.join(copy.id, `source${path.extname(srcVideoKey) || ".mp4"}`);
    const { url: newVideoUrl } = await storage.copy(srcVideoKey, destVideoKey);

    let newAudioUrl: string | undefined;
    if (project.video.audioUrl) {
      const srcAudioKey = keyFromUrl(project.video.audioUrl);
      const destAudioKey = path.posix.join(copy.id, "audio.wav");
      newAudioUrl = (await storage.copy(srcAudioKey, destAudioKey)).url;
    }

    await prisma.videoAsset.create({
      data: {
        projectId: copy.id,
        url: newVideoUrl,
        audioUrl: newAudioUrl,
        originalName: project.video.originalName,
        mimeType: project.video.mimeType,
        sizeBytes: project.video.sizeBytes,
        duration: project.video.duration,
        width: project.video.width,
        height: project.video.height,
        fps: project.video.fps,
      },
    });
  }

  return NextResponse.json({ id: copy.id });
}
