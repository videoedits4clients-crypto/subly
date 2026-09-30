"use client";

import { useMemo } from "react";
import type { Subtitle, SubtitleStyle, AnimationConfig, Word } from "@/types/subtitle";
import { applyTextCase } from "@/types/subtitle";
import { styleToContainerCss, styleToTextCss, resolveFontFamilyCss, activeWordCss, scaleWordStyleValue } from "@/lib/subtitles/preview-style";
import { effectiveEntranceDurationSec } from "@/lib/subtitles/animation-render";
import { cn } from "@/lib/utils";

/** Live browser preview of one subtitle at the current playback time — the counterpart to buildAssDocument for the burned export. */
export function SubtitleOverlay({
  subtitle,
  style,
  animation,
  currentTime,
  refHeightPx,
  isPlaying,
}: {
  subtitle: Subtitle;
  style: SubtitleStyle;
  animation: AnimationConfig;
  currentTime: number;
  refHeightPx: number;
  /** While paused/scrubbed, the entrance/exit animation is skipped and the caption is shown at full
   * opacity — otherwise landing the playhead on a caption's exact start (every click/arrow-key/Tab
   * navigation does this) would freeze it at frame zero of its fade-in, i.e. invisible. Real playback
   * still animates normally, matching the export. */
  isPlaying: boolean;
}) {
  const containerStyle = useMemo(() => styleToContainerCss(style, refHeightPx), [style, refHeightPx]);
  const textStyle = useMemo(() => styleToTextCss(style, refHeightPx, subtitle.text), [style, refHeightPx, subtitle.text]);

  const timeIntoSub = currentTime - subtitle.start;
  const timeToEnd = subtitle.end - currentTime;

  const words = subtitle.words.filter((w) => !w.removed);
  const activeIndex = style.wordHighlight
    ? words.findIndex((w) => currentTime >= w.start && currentTime < w.end)
    : -1;

  const lines = subtitle.text.split("\n");
  const wordsPerLine = lines.map((l) => l.split(/\s+/).filter(Boolean).length);
  const lineStartIndexes = wordsPerLine.reduce<number[]>((acc, count, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + wordsPerLine[i - 1]);
    return acc;
  }, []);

  const lineNodes = lines.map((line, li) => {
    const count = wordsPerLine[li];
    const startIdx = lineStartIndexes[li];
    const lineWords = words.slice(startIdx, startIdx + count);
    return (
      <div key={li}>
        {lineWords.map((w, i) => {
          const globalIdx = startIdx + i;
          const isActive = globalIdx === activeIndex;
          return (
            <span
              key={globalIdx}
              className="inline-block transition-transform"
              style={{ fontFamily: resolveFontFamilyCss(style.fontFamily, w.text), ...wordDynamicStyle(style, animation, isActive, w, refHeightPx) }}
            >
              {applyTextCase(w.text, style.textCase)}
              {i < lineWords.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    );
  });

  return (
    <div style={containerStyle}>
      <div
        style={{
          ...textStyle,
          ...entranceExitStyle(animation, timeIntoSub, timeToEnd, isPlaying),
        }}
        className={cn("select-none")}
      >
        {lineNodes}
      </div>
    </div>
  );
}

function wordDynamicStyle(style: SubtitleStyle, animation: AnimationConfig, isActive: boolean, word: Word, refHeightPx: number): React.CSSProperties {
  const active = isActive ? activeWordCss(style, animation) : {};
  // A word's own manual style (Style panel → this caption → word overrides)
  // wins over the automatic highlight for whatever properties it sets — same
  // precedence as the ASS export (see wordStyleTag in lib/subtitles/ass.ts).
  const manual: React.CSSProperties = {};
  // Task 137421 (P19.12) — word.style.fontSize/letterSpacing are authored against the same
  // REFERENCE_HEIGHT=1920 reference frame as every other SubtitleStyle numeric field (see
  // types/subtitle.ts), so they need the same scaling styleToTextCss already applies to the
  // caption-level fontSize/letterSpacing — without it, a word override rendered its raw
  // reference-height number directly as CSS px, ~3x too large at a typical ~640px-tall preview
  // canvas (see research/p19_11_release_candidate_gap_audit.md §6 P1-2).
  if (word.style?.color) manual.color = word.style.color;
  if (word.style?.fontSize) manual.fontSize = `${scaleWordStyleValue(word.style.fontSize, refHeightPx)}px`;
  if (word.style?.fontWeight) manual.fontWeight = word.style.fontWeight;
  // !== undefined (not truthy) — 0 and negative values are meaningful letter-spacing
  // overrides, matching the caption-level control's own -2..12 range (style-panel.tsx).
  if (word.style?.letterSpacing !== undefined) manual.letterSpacing = `${scaleWordStyleValue(word.style.letterSpacing, refHeightPx)}px`;
  if (word.style?.backgroundColor && word.style.backgroundOpacity) {
    manual.backgroundColor = hexWithAlphaLocal(word.style.backgroundColor, word.style.backgroundOpacity);
    manual.borderRadius = "0.2em";
    manual.padding = "0 0.15em";
  }
  return { ...active, ...manual };
}

function hexWithAlphaLocal(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

function entranceExitStyle(
  animation: AnimationConfig,
  timeIntoSub: number,
  timeToEnd: number,
  isPlaying: boolean,
): React.CSSProperties {
  if (!isPlaying) return { opacity: 1, transform: "none" };

  const entranceDurationSec = effectiveEntranceDurationSec(animation.entrance, animation.durationSec);
  const entranceProgress = Math.min(1, Math.max(0, timeIntoSub / Math.max(0.01, entranceDurationSec)));
  const exitProgress = Math.min(1, Math.max(0, timeToEnd / Math.max(0.01, animation.durationSec)));

  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
  const inT = easeOut(entranceProgress);
  const outT = easeOut(exitProgress);
  const opacity = Math.min(inT, animation.exit === "none" ? 1 : outT === 1 ? 1 : outT);

  let transform = "none";
  const offset = 24;
  switch (animation.entrance) {
    case "slide-up":
      transform = `translateY(${(1 - inT) * offset}px)`;
      break;
    case "slide-down":
      transform = `translateY(${-(1 - inT) * offset}px)`;
      break;
    case "slide-left":
      transform = `translateX(${(1 - inT) * offset}px)`;
      break;
    case "slide-right":
      transform = `translateX(${-(1 - inT) * offset}px)`;
      break;
    case "pop":
      transform = `scale(${0.6 + 0.4 * inT})`;
      break;
    case "bounce":
      transform = `scale(${0.7 + 0.3 * Math.min(1.15, inT * 1.15)})`;
      break;
    // "word-pop"/"char-pop"/"typewriter" fall through to the plain fade above (no transform),
    // matching export's own approximation for these three (see entranceOverride in ass.ts) —
    // giving "word-pop" its own scale/transform here (as an earlier version of this file did,
    // grouping it with "pop") would make the editor preview show a different animation than
    // what the export actually burns in.
    default:
      transform = "none";
  }

  return {
    opacity: animation.entrance === "none" && animation.exit === "none" ? 1 : opacity,
    transform,
  };
}
