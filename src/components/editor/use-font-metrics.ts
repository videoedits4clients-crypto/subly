"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ProjectData, Subtitle } from "@/types/subtitle";
import { resolveStyle } from "@/types/subtitle";
import { buildLayoutLines, layoutFontsNeeded } from "@/lib/subtitles/caption-layout";
import {
  ensureFontMetrics,
  getFontMetricsVersion,
  subscribeFontMetrics,
  type FontMetricsRequest,
} from "@/lib/fonts/client-font-metrics";

/** Re-renders the caller when new font metrics land in the shared client cache (see client-font-metrics.ts). */
export function useFontMetricsVersion(): number {
  return useSyncExternalStore(subscribeFontMetrics, getFontMetricsVersion, () => 0);
}

/**
 * Every font + character the project's captions will need for the preview layout, gathered once per change
 * (debounced) and requested in ONE call — so by the time playback reaches a caption its metrics are already
 * cached. Nothing here runs per frame.
 */
export function collectProjectFontNeeds(project: Pick<ProjectData, "subtitles" | "globalStyle">): { fonts: FontMetricsRequest[]; text: string } {
  const fonts = new Map<string, FontMetricsRequest>();
  let text = "";
  for (const sub of project.subtitles as Subtitle[]) {
    const style = resolveStyle(project, sub);
    const visible = sub.words.filter((w) => !w.removed);
    for (const need of layoutFontsNeeded(buildLayoutLines(sub.text, visible, style, 1), style)) {
      const source = need.family === style.fontFamily ? style.fontSource ?? "bundled" : "bundled";
      fonts.set(`${source}|${need.family}|${need.weight}`, { ...need, source });
    }
    for (const w of visible) text += w.text;
    text += sub.text;
  }
  return { fonts: [...fonts.values()], text };
}

export function useProjectFontMetrics(project: Pick<ProjectData, "subtitles" | "globalStyle"> | null | undefined): void {
  useEffect(() => {
    if (!project) return;
    const timer = window.setTimeout(() => {
      const { fonts, text } = collectProjectFontNeeds(project);
      if (fonts.length) void ensureFontMetrics(fonts, text + text.toUpperCase() + text.toLowerCase());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project]);
}
