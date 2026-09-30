import type { PrismaClient } from "@prisma/client";
import { toJson } from "./db-json.ts";

export interface ProjectPatchSubtitle {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  words: unknown;
  style?: unknown;
  animation?: unknown;
  hinglishText?: string;
  gujaratiScriptText?: string;
}

export interface ProjectPatchData {
  name?: string;
  status?: string;
  language?: string;
  captionOutputMode?: string;
  aspectRatio?: string;
  errorMessage?: string | null;
  globalStyle?: unknown;
  animation?: unknown;
  timingRules?: unknown;
  composition?: unknown;
  subtitles?: ProjectPatchSubtitle[];
  trimStart?: number;
  trimEnd?: number | null;
  cutRanges?: unknown;
}

/** The minimal slice of PrismaClient this needs — lets tests supply a real, temporary
 * SQLite-backed PrismaClient instead of the app's shared singleton (see project-patch.test.ts),
 * the same pattern used by lib/recovery/stale-job-recovery.ts. */
export type PatchDb = Pick<PrismaClient, "project" | "subtitle" | "$transaction">;

/**
 * Applies a validated project-edit PATCH payload atomically — the single source of truth for
 * "what does saving an editor change actually do to the database", used by both the real
 * `PATCH /api/projects/:id` route and its own unit tests, so the two can never silently drift
 * apart (see project-patch.test.ts).
 *
 * Two rules, both load-bearing:
 *  1. Every `Project` column is passed through Prisma's own `undefined`-means-"leave this
 *     column alone" semantics — a partial payload (e.g. a bare rename with no `subtitles`,
 *     `globalStyle`, etc.) never touches anything it didn't explicitly include. This is what
 *     keeps an unrelated PATCH (e.g. the dashboard's rename) from ever clobbering the editor's
 *     own autosaved state, and vice versa.
 *  2. `subtitles`, when present, REPLACES the entire set for the project (delete every existing
 *     row, then recreate exactly what was sent) rather than diffing/merging — the client's
 *     array is always the full, authoritative state (captions can be added, removed, reordered,
 *     split, merged), so anything less than a full replace would risk stale rows surviving a
 *     deletion. `subtitles` being *absent* (not an empty array) is what means "don't touch
 *     captions at all" — an explicit empty array legitimately deletes all of them.
 */
export async function applyProjectPatch(db: PatchDb, id: string, data: ProjectPatchData): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.project.update({
      where: { id },
      data: {
        name: data.name,
        status: data.status,
        language: data.language,
        captionOutputMode: data.captionOutputMode,
        aspectRatio: data.aspectRatio,
        errorMessage: data.errorMessage ?? undefined,
        globalStyle: data.globalStyle ? toJson(data.globalStyle) : undefined,
        animation: data.animation ? toJson(data.animation) : undefined,
        timingRules: data.timingRules ? toJson(data.timingRules) : undefined,
        composition: data.composition ? toJson(data.composition) : undefined,
        trimStart: data.trimStart,
        trimEnd: data.trimEnd,
        cutRanges: data.cutRanges ? toJson(data.cutRanges) : undefined,
      },
    });

    if (data.subtitles) {
      await tx.subtitle.deleteMany({ where: { projectId: id } });
      if (data.subtitles.length) {
        await tx.subtitle.createMany({
          data: data.subtitles.map((s) => ({
            id: s.id,
            projectId: id,
            index: s.index,
            start: s.start,
            end: s.end,
            text: s.text,
            words: toJson(s.words) ?? "[]",
            style: toJson(s.style),
            animation: toJson(s.animation),
            hinglishText: s.hinglishText,
            gujaratiScriptText: s.gujaratiScriptText,
          })),
        });
      }
    }
  });
}
