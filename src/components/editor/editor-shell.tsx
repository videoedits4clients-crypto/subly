"use client";

import { useState, useEffect, useRef } from "react";
import { TopBar } from "./top-bar";
import { LeftPanel } from "./left-panel";
import { VideoCanvas } from "./video-canvas";
import { RightPanel } from "./right-panel";
import { Timeline } from "./timeline";
import { ResizeHandle } from "./resize-handle";
import { MobileTabBar, type MobileTab } from "./mobile-tab-bar";
import { useAutosave } from "@/hooks/use-autosave";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { ErrorBoundary } from "@/components/error-boundary";
import { DevCrashTest } from "@/components/dev-crash-test";
import { cn } from "@/lib/utils";
import {
  loadEditorLayoutPreferences,
  saveEditorLayoutPreferences,
  clampCaptionsPanelWidth,
  clampTimelineHeight,
  MIN_CAPTIONS_PANEL_WIDTH,
  MAX_CAPTIONS_PANEL_WIDTH,
  MIN_TIMELINE_HEIGHT,
  MAX_TIMELINE_HEIGHT,
} from "@/lib/editor-layout";

/** Tailwind's own default `lg:` breakpoint (1024px) — the SAME value every other responsive class
 * in this file (`lg:flex-row`, `lg:w-80`, etc.) already switches on; mirrored here as a number
 * only because deciding whether to apply an inline pixel width/height (which Tailwind's own
 * `lg:` prefix can't conditionally gate) needs a JS-side answer to "are we currently at/above
 * that same breakpoint." */
const DESKTOP_BREAKPOINT_PX = 1024;

export function EditorShell({ projectId }: { projectId: string }) {
  // Task 111026 (P18.4) — both hooks are called HERE, in EditorShell's own body, not inside the
  // ErrorBoundary below. A render error in TopBar/LeftPanel/VideoCanvas/Timeline/RightPanel only
  // ever unmounts ITS subtree (everything the boundary wraps) — EditorShell itself, and therefore
  // these two hooks (autosave's store subscription, the global keydown listener), keeps running
  // completely undisturbed. Autosave is never bypassed or interrupted by a UI-only crash.
  useAutosave(projectId);
  useKeyboardShortcuts();

  const [mobileTab, setMobileTab] = useState<MobileTab>("captions");

  return (
    <ErrorBoundary scope="editor">
      <EditorShellContent mobileTab={mobileTab} setMobileTab={setMobileTab} />
    </ErrorBoundary>
  );
}

function EditorShellContent({ mobileTab, setMobileTab }: { mobileTab: MobileTab; setMobileTab: (tab: MobileTab) => void }) {
  // Task 120417 (P19.1) — resizable captions-panel width / timeline height. Lazy-initialized
  // straight from localStorage (same pattern style-panel.tsx's own collapsed-section state
  // already uses) — safe because EditorShellContent is never rendered during EditorPage's own
  // "loading" phase (src/app/editor/[id]/page.tsx only mounts EditorShell once the project fetch
  // resolves), so `window`/`localStorage` are always available by the time this first runs; no
  // SSR/hydration guard needed. This state is PURELY UI layout — never read by, written to, or
  // derived from useEditorStore, and never routed through commit()/autosave/undo-redo (see
  // lib/editor-layout.ts's own top-of-file doc comment).
  const [captionsPanelWidth, setCaptionsPanelWidth] = useState(() => loadEditorLayoutPreferences().captionsPanelWidth);
  const [timelineHeight, setTimelineHeight] = useState(() => loadEditorLayoutPreferences().timelineHeight);
  // Tracks the live viewport so both dimensions' EFFECTIVE (displayed/draggable) bounds shrink
  // gracefully on a small window — see lib/editor-layout.ts's clampCaptionsPanelWidth/
  // clampTimelineHeight. Deliberately NOT persisted itself (a temporarily small window must never
  // permanently overwrite the user's own preferred width/height — widening the window again
  // should restore it, per this task's own "clamp saved values to current min/max bounds," not
  // "destructively rewrite them").
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    function onResize() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isDesktop = viewport.width >= DESKTOP_BREAKPOINT_PX;
  const effectiveCaptionsPanelWidth = clampCaptionsPanelWidth(captionsPanelWidth, viewport.width);
  const effectiveTimelineHeight = clampTimelineHeight(timelineHeight, viewport.height);
  const effectiveMaxCaptionsPanelWidth = clampCaptionsPanelWidth(MAX_CAPTIONS_PANEL_WIDTH, viewport.width);
  const effectiveMaxTimelineHeight = clampTimelineHeight(MAX_TIMELINE_HEIGHT, viewport.height);

  // Debounced persistence — never writes on every pointermove tick (this task's own explicit
  // performance requirement), only once dragging/keyboard-nudging has settled for a moment. The
  // stored values are the RAW (pre-viewport-clamp) ones, so a preference set on a wide monitor is
  // preserved exactly and restored in full the next time the window is that wide again.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveEditorLayoutPreferences({ captionsPanelWidth, timelineHeight });
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [captionsPanelWidth, timelineHeight]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Task 111026 (P18.4) Phase 4 — dev-only controlled failure trigger, mounted INSIDE the
          ErrorBoundary above (via EditorShellContent) so a deliberate throw here exercises the
          exact same catch path a real panel crash would. Renders nothing, ever, in production. */}
      <DevCrashTest />
      <div className="shrink-0 overflow-x-auto">
        <TopBar />
      </div>

      {/* A single flex container reflows Left/Center/Right between desktop's
          always-visible 3-pane row and mobile's stacked, tab-switched layout —
          VideoCanvas (and its one <video> element) is mounted exactly once and
          repositioned via `order`, never duplicated. Task 120417 (P19.1): the captions panel's
          width and the timeline's height are now resizable at `lg:` — the inline `style` widths/
          heights below only ever apply when `isDesktop` (mirroring the SAME `lg:` 1024px
          breakpoint every other responsive class here already uses), so mobile's own stacked,
          full-width/full-height tab behavior is completely untouched. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className={cn(
            // Task 120417 (P19.1): `lg:flex-none` (`flex: 0 0 auto`) explicitly cancels the
            // mobile-only `flex-1` (`flex: 1 1 0%`) below at desktop sizes — `flex-1`'s
            // `flex-basis: 0%` makes the flex item ignore any `width` (inline or class-based)
            // entirely when computing its main-axis size; only reverting flex-basis to `auto`
            // (not just zeroing flex-grow) lets the inline pixel `width` set below actually apply.
            "order-2 min-h-0 lg:order-none lg:flex lg:flex-none",
            mobileTab === "captions" ? "flex flex-1" : "hidden lg:flex",
          )}
          style={isDesktop ? { width: effectiveCaptionsPanelWidth } : undefined}
        >
          <LeftPanel />
        </div>

        <ResizeHandle
          orientation="vertical"
          direction={1}
          value={captionsPanelWidth}
          min={MIN_CAPTIONS_PANEL_WIDTH}
          max={effectiveMaxCaptionsPanelWidth}
          onChange={setCaptionsPanelWidth}
          label="Resize captions panel"
          className="hidden lg:block"
        />

        <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-none">
          <div className="min-h-0 flex-1">
            <VideoCanvas />
          </div>
          <ResizeHandle
            orientation="horizontal"
            direction={-1}
            value={timelineHeight}
            min={MIN_TIMELINE_HEIGHT}
            max={effectiveMaxTimelineHeight}
            onChange={setTimelineHeight}
            label="Resize timeline"
            className="hidden lg:block"
          />
          {/* h-52 -> h-64 (desktop) / h-64 -> h-72 (mobile timeline tab): the audio waveform
              row (see timeline.tsx) needed real room to be legible, not a sliver — bumped by
              roughly the waveform row's own height rather than shrinking any existing row. */}
          <div
            className={cn("shrink-0 lg:block", mobileTab === "timeline" ? "block h-72" : "hidden")}
            style={isDesktop ? { height: effectiveTimelineHeight } : undefined}
          >
            <Timeline />
          </div>
        </div>

        <div
          className={cn(
            "order-3 min-h-0 lg:order-none lg:flex lg:w-80 lg:shrink-0",
            mobileTab === "style" || mobileTab === "animation" ? "flex flex-1" : "hidden lg:flex",
          )}
        >
          <RightPanel forceTab={mobileTab === "animation" ? "animation" : mobileTab === "style" ? "style" : undefined} />
        </div>
      </div>

      <MobileTabBar active={mobileTab} onChange={setMobileTab} />
    </div>
  );
}
