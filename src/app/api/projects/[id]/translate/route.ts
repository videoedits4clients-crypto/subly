import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { translateSubtitles, isAiDemoMode } from "@/lib/ai";
import { toJson } from "@/lib/db-json";
import { projectInclude, toProjectData } from "@/lib/project-mapper";
import { TRANSLATABLE_LANGUAGES } from "@/types/subtitle";
import type { Subtitle, Word } from "@/types/subtitle";

const schema = z.object({
  targetLanguage: z.enum(TRANSLATABLE_LANGUAGES),
});

function remapWordsEvenly(originalWords: Word[], newText: string): Word[] {
  const tokens = newText.split(/\s+/).filter(Boolean);
  const start = originalWords[0]?.start ?? 0;
  const end = originalWords[originalWords.length - 1]?.end ?? start + 1;
  const dur = Math.max(0.1, end - start);
  const per = dur / Math.max(1, tokens.length);
  return tokens.map((text, i) => ({ text, start: start + i * per, end: start + (i + 1) * per }));
}

/**
 * Translates the project's current working transcript into `targetLanguage`
 * WITHOUT destroying it: the pre-translation subtitles are saved as a
 * SubtitleTrack (keyed by the project's current language, first time only —
 * later re-translations don't clobber that saved original), the newly
 * translated subtitles become both the new active working set AND their own
 * saved track, and the project's language field is updated. Switching back
 * later (POST .../tracks/switch) restores whichever version from its track.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const limited = await checkRateLimit(userId, { bucket: "ai", limit: 20, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const { id: projectId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { id: projectId }, include: projectInclude });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const current = toProjectData(project);
  if (current.subtitles.length === 0) {
    return NextResponse.json({ error: "Nothing to translate yet." }, { status: 400 });
  }

  const textPayload = current.subtitles.map((s) => ({ id: s.id, text: s.text.replace(/\n/g, " ") }));
  const texts = await translateSubtitles(textPayload, parsed.data.targetLanguage);

  const translated: Subtitle[] = current.subtitles.map((s) => {
    const newText = texts[s.id] ?? s.text;
    const words = newText === s.text ? s.words : remapWordsEvenly(s.words, newText);
    return { ...s, text: newText, words };
  });

  await prisma.$transaction(async (tx) => {
    // Archive the pre-translation transcript under its current language,
    // but only the first time — a second translate-to-Spanish shouldn't
    // overwrite the original English just because it was translated before.
    await tx.subtitleTrack.upsert({
      where: { projectId_language: { projectId, language: current.language } },
      create: { projectId, language: current.language, label: current.language.toUpperCase(), subtitles: toJson(current.subtitles) ?? "[]" },
      update: {},
    });

    await tx.subtitleTrack.upsert({
      where: { projectId_language: { projectId, language: parsed.data.targetLanguage } },
      create: {
        projectId,
        language: parsed.data.targetLanguage,
        label: parsed.data.targetLanguage.toUpperCase(),
        subtitles: toJson(translated) ?? "[]",
      },
      update: { subtitles: toJson(translated) ?? "[]" },
    });

    await tx.subtitle.deleteMany({ where: { projectId } });
    await tx.subtitle.createMany({
      data: translated.map((s) => ({
        id: s.id,
        projectId,
        index: s.index,
        start: s.start,
        end: s.end,
        text: s.text,
        words: toJson(s.words) ?? "[]",
        style: toJson(s.style),
        animation: toJson(s.animation),
      })),
    });

    await tx.project.update({ where: { id: projectId }, data: { language: parsed.data.targetLanguage } });
  });

  const updated = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: projectInclude });
  return NextResponse.json({ project: toProjectData(updated), demo: isAiDemoMode() });
}
