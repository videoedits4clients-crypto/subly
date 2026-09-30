import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { projectInclude, toProjectData } from "@/lib/project-mapper";
import { toSRT, toVTT, toTXT } from "@/lib/subtitles/export-formats";
import { applyOutputMode } from "@/lib/subtitles/output-mode";
import { sanitizeFilename } from "@/lib/utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id }, include: projectInclude });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const format = new URL(req.url).searchParams.get("format") ?? "srt";
  const data = toProjectData(project);

  const generators = { srt: toSRT, vtt: toVTT, txt: toTXT } as const;
  const gen = generators[format as keyof typeof generators];
  if (!gen) return NextResponse.json({ error: "Unsupported format." }, { status: 400 });

  const subtitles = applyOutputMode(data.subtitles, data.captionOutputMode);
  const body = gen(subtitles);
  const mime = format === "vtt" ? "text/vtt" : "text/plain";
  const filename = `${sanitizeFilename(data.name)}.${format}`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": `${mime}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
