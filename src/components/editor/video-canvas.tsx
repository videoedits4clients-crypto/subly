"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2, SkipBack, SkipForward, ShieldCheck, Gauge, ChevronFirst, ChevronLast } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/store/editor-store";
import { LiveSubtitleLayer } from "./live-subtitle-layer";
import { RecommendedStyles } from "./recommended-styles";
import { formatTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { parseTimelineTime, clampTimelineTime } from "@/lib/timeline/timecode";
import { Input } from "@/components/ui/input";
import { effectiveCuts, isInsideCut } from "@/lib/timeline/edit-model";

export function VideoCanvas() {
  const project = useEditorStore((s) => s.project);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const currentTime = useEditorStore((s) => s.currentTime);
  const seekRequest = useEditorStore((s) => s.seekRequest);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const seek = useEditorStore((s) => s.seek);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [containerHeight, setContainerHeight] = useState(640);
  // Task 123041 (P19.3) — the "Go to time" input's own DISPLAY string, distinct from
  // `currentTime` itself: while the field isn't focused it always mirrors `formatTime(currentTime)`
  // (so it stays live during playback, per this task's own "must update smoothly during
  // playback" requirement), but while the user is actively typing a replacement it holds their
  // in-progress text instead — otherwise every keystroke would be stomped by the next
  // `onTimeUpdate` tick. `null` means "not being edited right now."
  const [timeInputDraft, setTimeInputDraft] = useState<string | null>(null);
  // Escape cancels an in-progress edit without committing it — the native `blur()` call this
  // triggers still fires `onBlur` synchronously (before React re-renders with the cleared
  // draft), so `onBlur` alone can't tell "Escape" apart from "the user just typed and tabbed
  // away." This ref is the flag that lets it: set right before the cancel-blur, checked (and
  // cleared) at the very start of `commitTimeInput`.
  const timeInputCancelledRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const obs = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    obs.observe(el);
    setContainerHeight(el.clientHeight);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seekRequest) return;
    if (Math.abs(v.currentTime - seekRequest.time) > 0.02) v.currentTime = seekRequest.time;
  }, [seekRequest]);

  // Play/pause is triggered imperatively (here and via the "subly:toggle-play"
  // custom event from the Space-bar shortcut) rather than through a
  // useEffect watching `isPlaying` — calling video.play() from inside a
  // useEffect runs after React's passive-effect flush, which is late enough
  // that Chrome no longer considers it part of the original click/keydown
  // user gesture and silently rejects it. Calling it synchronously inside the
  // event handler itself keeps the gesture chain intact. `isPlaying` in the
  // store stays purely a read model, updated from the video's own
  // onPlay/onPause events below.
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  useEffect(() => {
    const handler = () => togglePlay();
    window.addEventListener("subly:toggle-play", handler);
    return () => window.removeEventListener("subly:toggle-play", handler);
  }, []);

  // K/L (standard NLE transport shortcuts) need explicit play/pause rather
  // than a toggle — same user-gesture-preservation reasoning as togglePlay above.
  useEffect(() => {
    function handler(e: Event) {
      const v = videoRef.current;
      if (!v) return;
      const playing = (e as CustomEvent<{ playing: boolean }>).detail?.playing;
      if (playing) v.play().catch(() => {});
      else v.pause();
    }
    window.addEventListener("subly:set-play", handler);
    return () => window.removeEventListener("subly:set-play", handler);
  }, []);

  const cuts = useMemo(
    () => (project?.video ? effectiveCuts(project.trimStart, project.trimEnd, project.video.duration, project.cutRanges) : []),
    [project],
  );

  // Live "preview of the edit": trim/filler/silence cuts aren't re-encoded
  // until export, but playback skips over them here so editing feels
  // immediate — matching what the final export will actually contain.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !project?.video) return;
    const trimEnd = project.trimEnd ?? project.video.duration;
    if (v.currentTime >= trimEnd) {
      v.currentTime = trimEnd;
      v.pause();
      return;
    }
    if (cuts.length === 0) return;
    const cut = isInsideCut(v.currentTime, cuts);
    if (cut) v.currentTime = cut.end;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, cuts]);

  if (!project?.video) return null;

  const { canvasWidth: refW, canvasHeight: refH, videoVisible, backgroundColor } = project.composition;
  const playableStart = project.trimStart;
  const playableEnd = project.trimEnd ?? project.video.duration;

  function stepFrame(dir: 1 | -1) {
    const fps = project?.video?.fps || 30;
    seek(Math.max(playableStart, Math.min(playableEnd, currentTime + dir / fps)));
  }

  // Task 123041 (P19.3) — "Go to Start"/"Go to End": plain navigation through the SAME existing
  // `seek()` the transport bar's own scrubber already uses (never a second, independent
  // playback-time state) — t=0 and t=project.video.duration respectively, per this task's own
  // explicit definition. `goToEnd` is guarded by the JSX `disabled` below (duration unavailable/
  // invalid), not by an early return here, matching this file's existing pattern of keeping
  // guard logic visible at the call site.
  function goToStart() {
    seek(0);
  }
  function goToEnd() {
    seek(project!.video!.duration);
  }

  function commitTimeInput(raw: string) {
    if (timeInputCancelledRef.current) {
      timeInputCancelledRef.current = false;
      setTimeInputDraft(null);
      return;
    }
    const parsed = parseTimelineTime(raw);
    if (parsed !== null) seek(clampTimelineTime(parsed, project!.video!.duration));
    // Invalid input is silently discarded (never crashes, never seeks) — the input reverts to
    // showing the real current time on the very next render once `timeInputDraft` clears below,
    // matching this task's own "input remains stable" / "do not throw" requirements.
    setTimeInputDraft(null);
  }

  function toggleFullscreen() {
    containerRef.current?.requestFullscreen?.().catch(() => {});
  }

  return (
    <div className="flex h-full flex-col items-center gap-3 bg-background p-6">
      {/* Available-space wrapper: fills whatever room the flex column has left after the
          controls bar below, and centers the actual canvas inside it. The canvas itself is
          absolutely positioned against THIS div specifically so its `height: 100%` has an
          unambiguous, definite containing block to resolve against — as a plain flex child
          sharing this wrapper's own box, `aspect-ratio` was silently overridden by the flex
          layout's own definite width AND height, so the preview never actually reflected the
          project's real aspect ratio (any ratio produced the exact same on-screen shape). */}
      <div className="relative w-full min-h-0 flex-1">
        <div
          ref={containerRef}
          className="absolute left-1/2 top-1/2 max-h-full max-w-full -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl shadow-2xl"
          style={{ aspectRatio: `${refW}/${refH}`, height: "100%", backgroundColor }}
        >
        {/* The composition canvas, back to front: solid background (this div's own
            backgroundColor, above) -> video layer (fit, never cropped/stretched, so the
            background shows through any letterbox/pillarbox gap) -> captions, always on top
            and always rendered regardless of videoVisible (see SubtitleOverlay below) —
            turning the video off is a composition/export setting, never caption visibility. */}
        <video
          ref={videoRef}
          src={project.video.url}
          className={cn("absolute inset-0 h-full w-full cursor-pointer object-contain", !videoVisible && "opacity-0")}
          onClick={togglePlay}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            e.currentTarget.volume = volume;
          }}
        />

        {/* Large center play glyph — only shown while paused, so "how do I play this"
            is answered the instant the video loads, not just via the transport bar below. */}
        {!isPlaying && (
          <button
            onClick={togglePlay}
            aria-label="Play"
            className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/20"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-white/90 shadow-lg">
              <Play className="size-7 translate-x-0.5 text-black" fill="black" />
            </span>
          </button>
        )}

        {showSafeArea && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-[5%] border border-dashed border-white/30" />
            <div className="absolute inset-[10%] border border-dashed border-white/20" />
          </div>
        )}

        {/* Active caption at the video's REAL current time (per-frame while playing) — see
            LiveSubtitleLayer / useLivePlaybackTime for why this doesn't read the ~4Hz store time. */}
        <LiveSubtitleLayer videoRef={videoRef} refHeightPx={containerHeight} />

        <RecommendedStyles />
        </div>
      </div>

      {/* Playback controls — always visible below the preview, never hidden behind
          hover, so "how do I play this" never requires discovering an overlay. */}
      <div className="w-full shrink-0 space-y-2 rounded-lg border border-border bg-surface-2 p-3">
        <input
          type="range"
          min={playableStart}
          max={playableEnd || 0}
          step={0.01}
          value={currentTime}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          className="h-1.5 w-full cursor-pointer accent-[var(--accent)]"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={goToStart}
            className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-foreground"
            aria-label="Go to start"
            title="Go to start (00:00.00)"
          >
            <ChevronFirst className="size-4" />
          </button>
          <button onClick={() => stepFrame(-1)} className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-foreground" aria-label="Previous frame">
            <SkipBack className="size-4" />
          </button>
          <button
            onClick={togglePlay}
            className="flex size-9 items-center justify-center rounded-full bg-accent text-white shadow-sm hover:bg-accent/90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="size-4" fill="white" /> : <Play className="size-4 translate-x-0.5" fill="white" />}
          </button>
          <button onClick={() => stepFrame(1)} className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-foreground" aria-label="Next frame">
            <SkipForward className="size-4" />
          </button>
          <button
            onClick={goToEnd}
            disabled={!(project.video.duration > 0)}
            className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Go to end"
            title={project.video.duration > 0 ? `Go to end (${formatTime(project.video.duration)})` : "Project duration unavailable"}
          >
            <ChevronLast className="size-4" />
          </button>
          {/* Task 123041 (P19.3) — the "Go to time" control: shows `formatTime(currentTime)` (the
              SAME existing display format used everywhere else in this app) whenever the field
              isn't being edited, so it keeps updating live during playback exactly like the plain
              span it replaces; while focused, it holds the user's own in-progress text instead
              (see `timeInputDraft`'s own doc comment above). Enter or blur both commit through the
              same `commitTimeInput` -> `parseTimelineTime`/`clampTimelineTime` -> `seek()` path —
              the existing seek mechanism, never a second playback-time state. */}
          <label htmlFor="video-canvas-goto-time" className="sr-only">
            Go to time
          </label>
          <Input
            id="video-canvas-goto-time"
            type="text"
            inputMode="decimal"
            value={timeInputDraft ?? formatTime(currentTime)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTimeInputDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              else if (e.key === "Escape") {
                timeInputCancelledRef.current = true;
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={(e) => commitTimeInput(e.target.value)}
            title="Go to time — type MM:SS.ss (or plain seconds) and press Enter"
            className="h-7 w-24 shrink-0 px-1.5 text-center font-mono text-xs tabular-nums"
          />
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">/ {formatTime(project.video.duration)}</span>
          <div className="flex-1" />
          <button
            onClick={() => {
              setMuted((m) => !m);
              if (videoRef.current) videoRef.current.muted = !muted;
            }}
            className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-foreground"
            aria-label="Toggle mute"
          >
            {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              if (videoRef.current) videoRef.current.volume = v;
            }}
            aria-label="Volume"
            className="h-1.5 w-16 cursor-pointer accent-[var(--accent)]"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-muted hover:bg-surface-3 hover:text-foreground"
                aria-label="Playback speed"
              >
                <Gauge className="size-4" />
                {playbackRate}×
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <DropdownMenuItem
                  key={rate}
                  onSelect={() => {
                    setPlaybackRate(rate);
                    if (videoRef.current) videoRef.current.playbackRate = rate;
                  }}
                >
                  {rate}× {rate === 1 && "(Normal)"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={() => setShowSafeArea((s) => !s)}
            className={cn("rounded p-1.5 text-muted hover:bg-surface-3 hover:text-foreground", showSafeArea && "text-accent")}
            aria-label="Toggle safe area guides"
          >
            <ShieldCheck className="size-4" />
          </button>
          <button onClick={toggleFullscreen} className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-foreground" aria-label="Fullscreen">
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
