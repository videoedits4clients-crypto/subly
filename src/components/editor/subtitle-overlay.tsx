"use client";

import { useMemo } from "react";
import type { Subtitle, SubtitleStyle, AnimationConfig, Word } from "@/types/subtitle";
import { applyWordTextCase } from "@/types/subtitle";
import { styleToContainerCss, styleToTextCss, resolveFontFamilyCss, activeWordCss, scaleWordStyleValue } from "@/lib/subtitles/preview-style";
import { entranceFrameAt } from "@/lib/subtitles/entrance-animation";
import { exitFrameAt } from "@/lib/subtitles/exit-animation";
import { findActiveWordIndex } from "@/lib/subtitles/playback-context";
import { detectScript, scriptFallbackWeight } from "@/lib/subtitles/script-detect";
import { groupWordsIntoLines } from "@/lib/subtitles/word-lines";
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

  // Pure function of (time, word timing): the active word is whichever non-removed word's
  // [start, end) contains the current time — no state carried between frames. `index` below is
  // an index into this same non-removed array, so highlight and render can never disagree.
  const words = subtitle.words.filter((w) => !w.removed);
  const activeIndex = style.wordHighlight ? findActiveWordIndex(words, currentTime) : null;

  const lineNodes = groupWordsIntoLines(subtitle.text, words).map((lineWords, li) => (
    <div key={li}>
      {lineWords.map(({ word: w, index }, i) => (
        <span
          key={index}
          className="inline-block transition-transform"
          style={{
            fontFamily: resolveFontFamilyCss(style.fontFamily, w.text),
            // script-fallback words in a heavy single-weight display face are bolded (see scriptFallbackWeight)
            ...(detectScript(w.text) !== "latin" ? { fontWeight: scriptFallbackWeight(style.fontFamily, style.fontWeight) } : {}),
            ...wordDynamicStyle(style, animation, index === activeIndex, w, refHeightPx),
          }}
        >
          {applyWordTextCase(w.text, style.textCase, index)}
          {i < lineWords.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  ));

  return (
    <div style={containerStyle}>
      <div
        style={{
          ...textStyle,
          ...entranceExitStyle(animation, currentTime, subtitle.start, subtitle.end, isPlaying, refHeightPx),
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
  currentTime: number,
  captionStart: number,
  captionEnd: number,
  isPlaying: boolean,
  refHeightPx: number,
): React.CSSProperties {
  if (!isPlaying) return { opacity: 1, transform: "none" };

  // Entrance and exit are pure functions of time (lib/subtitles/entrance-animation.ts and
  // exit-animation.ts — the same curves the ASS export samples into its tags). Their windows
  // never overlap (animationWindows), so combining them is just a sum / product.
  const inFrame = entranceFrameAt(animation, currentTime - captionStart);
  const outFrame = exitFrameAt(currentTime, captionStart, captionEnd, animation);
  const opacity = Math.min(inFrame.opacity, outFrame.opacity);
  const dx = inFrame.dx + outFrame.dx;
  const dy = inFrame.dy + outFrame.dy;
  const scale = inFrame.scale * outFrame.scale;

  const parts: string[] = [];
  if (dx !== 0 || dy !== 0) parts.push(`translate(${dx * refHeightPx}px, ${dy * refHeightPx}px)`);
  if (scale !== 1) parts.push(`scale(${scale})`);

  return { opacity, transform: parts.length ? parts.join(" ") : "none" };
}
