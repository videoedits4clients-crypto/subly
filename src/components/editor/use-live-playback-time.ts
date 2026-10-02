"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The video element's real current time, sampled once per display frame while playing.
 *
 * The editor store's `currentTime` is fed by the <video> `timeupdate` event, which Chromium fires
 * only ~4 times a second (measured ≈265ms apart in the P20.1 audit). That is far too coarse for
 * subtitle animation: a default 0.2s entrance fits entirely between two ticks, a caption can
 * appear up to ~265ms late, and any word shorter than ~265ms can be skipped by the highlight
 * altogether. While playing, this hook samples `video.currentTime` from a single
 * requestAnimationFrame loop (no per-word timers, no store writes — only the component that
 * calls it re-renders, and React bails out when the sampled time hasn't changed). While paused it
 * simply returns `fallbackTime` (the store's value), so seeking/scrubbing behaves exactly as
 * before and no loop runs.
 */
export function useLivePlaybackTime(videoRef: RefObject<HTMLVideoElement | null>, fallbackTime: number, isPlaying: boolean): number {
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setLive(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setLive(null);
    };
  }, [isPlaying, videoRef]);

  return isPlaying && live !== null ? live : fallbackTime;
}
