import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { applyProjectPatch } from "@/lib/project-patch";
import { projectInclude, toProjectData } from "@/lib/project-mapper";
import { track } from "@/lib/analytics";
import { isValidTranscriptionLanguageRequest } from "@/lib/language-policy";
import { globalStyleSchema } from "@/lib/global-style-validation";
import { resolveGlobalStyle } from "@/types/subtitle";

async function loadOwnedProject(id: string, userId: string) {
  const project = await prisma.project.findUnique({ where: { id }, include: projectInclude });
  if (!project || project.ownerId !== userId || project.deletedAt) return null;
  return project;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const project = await loadOwnedProject(id, userId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  return NextResponse.json(toProjectData(project));
}

const subtitleSchema = z.object({
  id: z.string(),
  index: z.number(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(
    z.object({
      text: z.string(),
      start: z.number(),
      end: z.number(),
      confidence: z.number().optional(),
      removed: z.boolean().optional(),
      style: z.record(z.string(), z.unknown()).optional(),
      hinglishText: z.string().optional(),
      gujaratiScriptText: z.string().optional(),
    }),
  ),
  style: z.record(z.string(), z.unknown()).optional(),
  animation: z.record(z.string(), z.unknown()).optional(),
  hinglishText: z.string().optional(),
  gujaratiScriptText: z.string().optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(["EMPTY", "LOADING", "TRANSCRIBING", "READY", "EDITING", "EXPORTING", "EXPORTED", "ERROR"]).optional(),
  // "auto" and every officially-supported code pass; a deferred or unknown language code is
  // rejected here so a client can never bypass the transcription-settings picker (which the
  // same lib/language-policy.ts already restricts) and request an unvalidated language
  // directly — see lib/language-policy.ts for the single authoritative list.
  language: z
    .string()
    .optional()
    .refine((v) => v === undefined || isValidTranscriptionLanguageRequest(v), {
      message: "This language isn't supported for transcription yet.",
    }),
  captionOutputMode: z.enum(["original", "hinglish", "gujarati-script"]).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional(),
  errorMessage: z.string().nullable().optional(),
  globalStyle: globalStyleSchema.optional(),
  animation: z.record(z.string(), z.unknown()).optional(),
  timingRules: z.record(z.string(), z.unknown()).optional(),
  composition: z.record(z.string(), z.unknown()).optional(),
  subtitles: z.array(subtitleSchema).optional(),
  trimStart: z.number().min(0).optional(),
  trimEnd: z.number().min(0).nullable().optional(),
  cutRanges: z
    .array(z.object({ id: z.string(), start: z.number(), end: z.number(), reason: z.enum(["trim", "filler", "silence", "manual"]) }))
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid update payload." }, { status: 400 });
  const data = parsed.data;

  // globalStyleSchema (above) already rejected any wrong-typed field, so `data.globalStyle` here
  // is a structurally valid Partial<SubtitleStyle> — but a client legitimately may only have sent
  // a subset of fields (see globalStyleSchema's own doc comment). Filling the rest from
  // DEFAULT_SUBTITLE_STYLE before it's ever persisted means every consumer that reads it back
  // (preview, export/ass.ts) always sees a complete style, matching what the real Style panel UI
  // already effectively guarantees by always sending every field itself.
  if (data.globalStyle) {
    data.globalStyle = resolveGlobalStyle(data.globalStyle);
  }

  await applyProjectPatch(prisma, id, data);

  const updated = await loadOwnedProject(id, userId);
  return NextResponse.json(updated ? toProjectData(updated) : { ok: true });
}

/** Soft-delete: moves the project to Trash rather than deleting it immediately — see /api/projects/[id]/trash for restore / permanent delete. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== userId || existing.deletedAt) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
  track("project_deleted", { projectId: id });
  return NextResponse.json({ ok: true, trashed: true });
}
