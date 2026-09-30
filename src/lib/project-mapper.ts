import type { Prisma, Project, Subtitle as SubtitleRow, VideoAsset } from "@prisma/client";
import { fromJson } from "./db-json.ts";
import {
  DEFAULT_ANIMATION,
  resolveGlobalStyle,
  resolveTimingRules,
  resolveComposition,
  type AnimationConfig,
  type AspectRatio,
  type CompositionSettings,
  type ProjectData,
  type Subtitle,
  type SubtitleStyle,
  type SupportedLanguage,
  type TimingRules,
  type Word,
  type CutRange,
} from "../types/subtitle.ts";

type ProjectWithRelations = Project & {
  video: VideoAsset | null;
  subtitles: SubtitleRow[];
};

export function toProjectData(project: ProjectWithRelations): ProjectData {
  return {
    id: project.id,
    name: project.name,
    status: project.status as ProjectData["status"],
    language: project.language as SupportedLanguage,
    captionOutputMode: (project.captionOutputMode as ProjectData["captionOutputMode"]) ?? "original",
    aspectRatio: project.aspectRatio as AspectRatio,
    errorMessage: project.errorMessage ?? undefined,
    video: project.video
      ? {
          url: project.video.url,
          audioUrl: project.video.audioUrl ?? undefined,
          originalName: project.video.originalName,
          duration: project.video.duration ?? 0,
          width: project.video.width ?? 0,
          height: project.video.height ?? 0,
          fps: project.video.fps ?? 30,
        }
      : undefined,
    subtitles: project.subtitles
      .sort((a, b) => a.index - b.index)
      .map(
        (s): Subtitle => ({
          id: s.id,
          index: s.index,
          start: s.start,
          end: s.end,
          text: s.text,
          words: fromJson<Word[]>(s.words, []),
          style: fromJson<Partial<SubtitleStyle> | undefined>(s.style, undefined),
          animation: fromJson<Partial<AnimationConfig> | undefined>(s.animation, undefined),
          hinglishText: s.hinglishText ?? undefined,
          gujaratiScriptText: s.gujaratiScriptText ?? undefined,
        }),
      ),
    globalStyle: resolveGlobalStyle(fromJson<Partial<SubtitleStyle> | undefined>(project.globalStyle, undefined)),
    animation: fromJson<AnimationConfig>(project.animation, DEFAULT_ANIMATION),
    timingRules: resolveTimingRules(fromJson<Partial<TimingRules>>(project.timingRules, {})),
    composition: resolveComposition(
      fromJson<Partial<CompositionSettings>>(project.composition, {}),
      project.video ? { width: project.video.width ?? 0, height: project.video.height ?? 0 } : undefined,
    ),
    updatedAt: project.updatedAt.toISOString(),
    trimStart: project.trimStart,
    trimEnd: project.trimEnd,
    cutRanges: fromJson<CutRange[]>(project.cutRanges, []),
  };
}

export const projectInclude = {
  video: true,
  subtitles: true,
} satisfies Prisma.ProjectInclude;
