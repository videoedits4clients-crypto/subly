"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { decodeWaveform, type WaveformData } from "@/lib/audio/waveform";
import { pixelsToTime } from "@/lib/timeline/time-scale";

/**
 * Renders the project's audio amplitude as a canvas — deliberately just the amplitude bars,
 * nothing else (playhead, trim/cut dimming, and the selected-caption highlight are drawn by
 * the parent Timeline as separate overlay elements, exactly like it already does for the video
 * track — see timeline.tsx). Keeping this component single-purpose means the one thing that's
 * genuinely expensive (turning peak data into pixels) stays isolated and easy to reason about.
 *
 * Only ever draws a canvas sized to roughly the visible viewport (+ a one-viewport buffer on
 * each side), never the full timeline width — a 60-minute recording at the timeline's own
 * maximum zoom (220px/sec, see MAX_PX_PER_SEC in timeline.tsx) would be a ~790,000px-wide
 * timeline, which exceeds browser canvas dimension limits (Chromium caps a canvas at 32,767px
 * per side) even before considering performance. Repositioned and redrawn as the timeline
 * scrolls, the same virtualization principle timeline.tsx already applies to subtitle blocks.
 */
export function Waveform({
  projectId,
  pxPerSec,
  viewportScrollLeft,
  viewportWidth,
  totalWidth,
  height,
}: {
  projectId: string;
  pxPerSec: number;
  viewportScrollLeft: number;
  viewportWidth: number;
  /** Full scrollable timeline width in px (duration * pxPerSec, same value timeline.tsx computes for its own track container) — only used to clamp the draw window so it never runs past the end of the timeline. */
  totalWidth: number;
  height: number;
}) {
  // undefined = still loading (render nothing yet, avoid a flash of "no audio"), null = no
  // audio / generation failed (render nothing, permanently, for this project) — see the
  // "missing audio" and "audio extraction failure" handling requirements.
  const [data, setData] = useState<WaveformData | null | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getWaveform(projectId)
      .then((res) => {
        if (cancelled) return;
        if (!res.peaks || !res.peaksPerSecond) {
          setData(null);
          return;
        }
        setData(decodeWaveform({ peaks: res.peaks, peaksPerSecond: res.peaksPerSecond, duration: res.duration ?? 0 }));
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const buffer = Math.max(200, viewportWidth);
  const drawStart = Math.max(0, viewportScrollLeft - buffer);
  const drawEnd = Math.min(totalWidth, viewportScrollLeft + viewportWidth + buffer);
  const drawWidth = Math.max(1, Math.ceil(drawEnd - drawStart));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    canvas.width = Math.round(drawWidth * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, drawWidth, height);

    if (!data || data.peaks.length === 0) return; // silent/empty audio still renders as a blank track, not broken

    ctx.fillStyle = "rgba(167, 139, 250, 0.65)"; // accent purple at reduced opacity — audio presence, not a focal element
    const mid = height / 2;
    const minBarHeight = 1;

    // One canvas column per device pixel, each showing the max peak within that column's own
    // time span — this is what keeps the draw cost bounded by SCREEN width, never by peak
    // count or zoom level, and is also what makes zooming in/out just work: at low zoom many
    // peaks collapse into one column (via this max-within-span step); at high zoom each column
    // may span less than one peak bucket, which simply repeats the nearest peak.
    const pixelCols = Math.round(drawWidth * dpr);
    for (let px = 0; px < pixelCols; px++) {
      const xCss = px / dpr;
      const tStart = pixelsToTime(drawStart + xCss, pxPerSec);
      const tEnd = pixelsToTime(drawStart + xCss + 1 / dpr, pxPerSec);
      const i0 = Math.max(0, Math.floor(tStart * data.peaksPerSecond));
      const i1 = Math.min(data.peaks.length, Math.max(i0 + 1, Math.ceil(tEnd * data.peaksPerSecond)));
      let peak = 0;
      for (let i = i0; i < i1; i++) {
        if (data.peaks[i] > peak) peak = data.peaks[i];
      }
      const amp = Math.max(minBarHeight, (peak / 255) * (height / 2 - 2));
      ctx.fillRect(xCss, mid - amp, 1 / dpr, amp * 2);
    }
  }, [data, drawStart, drawWidth, height, pxPerSec]);

  if (data === null) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute top-0"
      style={{ left: drawStart, width: drawWidth, height }}
    />
  );
}
