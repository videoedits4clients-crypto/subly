import { NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { probeVideo } from "@/lib/ffmpeg";
import { processVideo } from "@/lib/pipeline";
import { track } from "@/lib/analytics";
import { validateUploadFile, DEFAULT_MAX_UPLOAD_MB, type UploadErrorCode } from "@/lib/upload-validation";
import type { AspectRatio } from "@/types/subtitle";

/** Structured, upload-specific error contract — `{ error: { code, message } }`. `message` is
 * always safe to show a user as-is (no stack traces, paths, or internal error objects); `code`
 * lets the frontend (or a test) distinguish failure reasons without parsing prose. Scoped to
 * this route only — not a general application-wide error framework. */
function uploadError(code: UploadErrorCode, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** A malformed/truncated file can occasionally make ffprobe hang scanning for stream info
 * instead of failing outright — without a bound, that would leave the HTTP request (and the
 * user's upload spinner) hanging indefinitely instead of surfacing "this file doesn't look
 * like a valid video." A normal probe of even a very large file completes in well under a
 * second (it reads headers/metadata, not the whole file), so 20s is generous, not tight. */
const PROBE_TIMEOUT_MS = 20_000;

function probeVideoWithTimeout(absPath: string): ReturnType<typeof probeVideo> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Probe timed out.")), PROBE_TIMEOUT_MS);
    probeVideo(absPath).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function closestAspectRatio(width: number, height: number): AspectRatio {
  const ratio = width / (height || 1);
  const candidates: [AspectRatio, number][] = [
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["1:1", 1],
    ["4:5", 4 / 5],
  ];
  candidates.sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio));
  return candidates[0][0];
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const limited = await checkRateLimit(userId, { bucket: "upload", limit: 10, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? String(DEFAULT_MAX_UPLOAD_MB)) * 1024 * 1024;

  const form = await req.formData().catch(() => null);
  if (!form) return uploadError("MISSING_FIELDS", "Invalid upload.", 400);

  const file = form.get("file");
  const projectId = form.get("projectId");
  if (!(file instanceof File) || typeof projectId !== "string") {
    return uploadError("MISSING_FIELDS", "Missing file or project.", 400);
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== userId) {
    return uploadError("PROJECT_NOT_FOUND", "Project not found.", 404);
  }

  // UPLOAD VALIDATION ERROR — rejected before anything is written to disk or the database, and
  // before the project's status changes at all. Distinct from a MEDIA PROCESSING ERROR (below,
  // and in lib/pipeline.ts), which can only happen after a file has already passed these
  // checks and been accepted.
  const validation = validateUploadFile({ name: file.name, type: file.type, size: file.size }, maxBytes);
  if (!validation.ok) {
    const status = validation.code === "FILE_TOO_LARGE" ? 413 : validation.code === "EMPTY_FILE" ? 422 : 415;
    return uploadError(validation.code, validation.message, status);
  }
  const ext = validation.extension;

  const storage = getStorage();
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = path.posix.join(projectId, `source.${ext}`);
  const { url } = await storage.put(key, buffer, file.type);
  const absPath = await storage.getPath(key);

  // MEDIA PROCESSING ERROR (upload-time half): the file passed the cheap metadata checks above
  // but ffprobe can't actually make sense of its contents — a wrong-extension file, a corrupt
  // header, or a truncated download. Cleaned up immediately so no orphaned source file survives
  // a rejected upload.
  let probe;
  try {
    probe = await probeVideoWithTimeout(absPath);
  } catch {
    await storage.del(key).catch(() => {});
    return uploadError("INVALID_MEDIA", "Unable to read this media file. It may be corrupted or in an unsupported format.", 422);
  }

  try {
    await prisma.videoAsset.deleteMany({ where: { projectId } });
    await prisma.videoAsset.create({
      data: {
        projectId,
        url,
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
      },
    });

    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: "LOADING",
        aspectRatio: project.status === "EMPTY" ? closestAspectRatio(probe.width, probe.height) : undefined,
      },
    });
  } catch {
    // The video passed validation, but persisting it failed (e.g. a DB write error) — clean up
    // the file that was just written rather than leaving an orphaned source with no project
    // record pointing at it, and never leave the project looking like the upload succeeded.
    await storage.del(key).catch(() => {});
    return uploadError("INTERNAL_ERROR", "Upload failed. Please try again.", 500);
  }

  // Fire-and-forget: the client polls /api/projects/:id/status for progress. Anything that
  // fails from here on (audio extraction, transcription) is a MEDIA PROCESSING ERROR handled
  // entirely by the existing pipeline.ts / P0-P0.5 reliability path (ERROR status + Retry) —
  // untouched by this change.
  track("video_uploaded", { projectId, sizeMb: Math.round(file.size / 1024 / 1024), durationSec: Math.round(probe.duration) });
  void processVideo(projectId);

  return NextResponse.json({ ok: true });
}
