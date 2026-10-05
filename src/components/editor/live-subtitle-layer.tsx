"use client";

import { useMemo, type RefObject } from "react";
import { useEditorStore } from "@/store/editor-store";
import { resolveAnimation, resolveStyle } from "@/types/subtitle";
import { applyOutputMode } from "@/lib/subtitles/output-mode";
import { findActiveCaption } from "@/lib/subtitles/playback-context";
import { SubtitleOverlay } from "./subtitle-overlay";
import { useLivePlaybackTime } from "./use-live-playback-time";
import { useProjectFontMetrics } from "./use-font-metrics";

/**
 * Picks the caption active at the video's REAL current time and renders it. Lives in its own
 * component (rather than inside VideoCanvas) so the per-frame time updates from
 * useLivePlaybackTime re-render only this small subtree, not the transport bar, scrubber and
 * menus around it.
 */
export function LiveSubtitleLayer({ videoRef, refHeightPx }: { videoRef: RefObject<HTMLVideoElement | null>; refHeightPx: number }) {
  const project = useEditorStore((s) => s.project);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const storeTime = useEditorStore((s) => s.currentTime);
  const currentTime = useLivePlaybackTime(videoRef, storeTime, isPlaying);
  // Font metrics for the whole project, requested once up front (debounced) so layout never waits mid-playback.
  useProjectFontMetrics(project);

  // Task 100742 (P13): the SAME shared active-caption definition timeline.tsx uses.
  const activeRaw = project ? findActiveCaption(project.subtitles, currentTime) : undefined;
  const outputMode = project?.captionOutputMode;
  // Preview must match export/SRT/VTT fidelity — same applyOutputMode used everywhere else text
  // is displayed ("hinglish" mode shows the Romanized text here too, word timing untouched).
  const activeSubtitle = useMemo(() => (activeRaw && outputMode ? applyOutputMode([activeRaw], outputMode)[0] : undefined), [activeRaw, outputMode]);

  // Resolved objects are memoized so the overlay's own memoized CSS isn't rebuilt every frame.
  const style = useMemo(() => (project && activeSubtitle ? resolveStyle(project, activeSubtitle) : undefined), [project, activeSubtitle]);
  const animation = useMemo(() => (project && activeSubtitle ? resolveAnimation(project, activeSubtitle) : undefined), [project, activeSubtitle]);

  if (!activeSubtitle || !style || !animation) return null;
  return (
    <SubtitleOverlay
      subtitle={activeSubtitle}
      style={style}
      animation={animation}
      currentTime={currentTime}
      refHeightPx={refHeightPx}
      canvasWidthPx={project ? refHeightPx * (project.composition.canvasWidth / project.composition.canvasHeight) : undefined}
      isPlaying={isPlaying}
    />
  );
}
