import { NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { Readable } from "stream";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { getStorage } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  wav: "audio/wav",
  srt: "text/plain; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  ass: "text/plain; charset=utf-8",
};

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: keyParts } = await params;
  const key = keyParts.join("/");
  const projectId = keyParts[0];

  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const storage = getStorage();
  let absPath: string;
  try {
    absPath = await storage.getPath(key);
  } catch {
    // Thrown by the storage driver when a key tries to resolve outside its
    // root (e.g. "../" traversal) — treat identically to "not found" so we
    // never confirm/deny the existence of paths outside the upload sandbox.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  const range = req.headers.get("range");
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : size - 1;
    const stream = createReadStream(absPath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType,
      },
    });
  }

  const stream = createReadStream(absPath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Length": String(size),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    },
  });
}
