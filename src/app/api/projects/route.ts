import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { DEFAULT_ANIMATION, DEFAULT_SUBTITLE_STYLE, DEFAULT_TIMING_RULES } from "@/types/subtitle";
import { toJson } from "@/lib/db-json";
import { getPreset } from "@/lib/presets";
import { track } from "@/lib/analytics";
import { isValidTranscriptionLanguageRequest } from "@/lib/language-policy";

export async function GET() {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const projects = await prisma.project.findMany({
    where: { ownerId: userId, deletedAt: null },
    include: { video: true, _count: { select: { subtitles: true } }, exportJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      aspectRatio: p.aspectRatio,
      language: p.language,
      duration: p.video?.duration ?? 0,
      width: p.video?.width ?? 0,
      height: p.video?.height ?? 0,
      thumbnailUrl: p.video?.url ?? null,
      subtitleCount: p._count.subtitles,
      exportStatus: p.exportJobs[0]?.status ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  );
}

const createSchema = z.object({
  name: z.string().min(1).max(120).default("Untitled project"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  // Same V1 transcription-language policy as the PATCH route (src/app/api/projects/[id]/
  // route.ts) — see lib/language-policy.ts. The normal UI never sends anything but the
  // default here (language is actually set via that PATCH call, from the upload flow's
  // TranscriptionSettingsDialog), but this is a public API surface, so it's validated too.
  language: z
    .string()
    .default("en")
    .refine((v) => isValidTranscriptionLanguageRequest(v), { message: "This language isn't supported for transcription yet." }),
  presetId: z.string().optional(),
});

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project data." }, { status: 400 });

  const preset = parsed.data.presetId ? getPreset(parsed.data.presetId) : undefined;

  const project = await prisma.project.create({
    data: {
      ownerId: userId,
      name: parsed.data.name,
      aspectRatio: parsed.data.aspectRatio,
      language: parsed.data.language,
      status: "EMPTY",
      globalStyle: toJson(preset?.style ?? DEFAULT_SUBTITLE_STYLE),
      animation: toJson(preset?.animation ?? DEFAULT_ANIMATION),
      timingRules: toJson(DEFAULT_TIMING_RULES),
    },
  });

  track("project_created", { projectId: project.id, aspectRatio: project.aspectRatio, hasPreset: Boolean(preset) });
  return NextResponse.json({ id: project.id });
}
