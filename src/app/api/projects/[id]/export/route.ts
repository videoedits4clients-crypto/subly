import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { runExportJob } from "@/lib/export-pipeline";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  resolution: z.enum(["720p", "1080p", "4k"]).default("1080p"),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  quality: z.enum(["low", "medium", "high", "maximum"]).default("high"),
  // Composition options (see types/subtitle.ts CompositionSettings) — canvasWidth/canvasHeight
  // are the ONE source of truth for output aspect ratio in both videoVisible branches;
  // `resolution` above just scales them up/down as export quality (see
  // lib/ffmpeg/index.ts computeExportDimensions). There is no separate export-aspect-ratio
  // option anymore — the legacy `aspectRatio` ExportJob column keeps its DB default and is
  // no longer read by the render pipeline.
  videoVisible: z.boolean().default(true),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#000000"),
  canvasWidth: z.number().int().min(2).max(7680).default(1080),
  canvasHeight: z.number().int().min(2).max(7680).default(1920),
  // Not persisted on ExportJob (no DB column, no migration needed for this one-shot flag) —
  // just an explicit, per-attempt opt-in into the font preflight's fallback path. See
  // RunExportJobOptions in lib/export-pipeline.ts.
  allowFontFallback: z.boolean().default(false),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const limited = await checkRateLimit(userId, { bucket: "export", limit: 8, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid export options." }, { status: 400 });

  const { allowFontFallback, ...jobFields } = parsed.data;
  const job = await prisma.exportJob.create({
    data: { projectId, ...jobFields, status: "QUEUED" },
  });

  await prisma.project.update({ where: { id: projectId }, data: { status: "EXPORTING" } });

  void runExportJob(job.id, { allowFontFallback });

  return NextResponse.json({ id: job.id });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const jobs = await prisma.exportJob.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 10 });
  return NextResponse.json(jobs);
}
