"use client";

import { useMemo, useRef, useState, useCallback, useEffect, memo } from "react";
import {
  Scissors,
  Copy,
  Trash2,
  Merge,
  ZoomIn,
  ZoomOut,
  LogIn,
  LogOut,
  X,
  Undo2,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Waves,
  Maximize2,
  Focus,
} from "lucide-react";
import { useEditorStore, resolveTimingUpdate } from "@/store/editor-store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { formatTime, cn } from "@/lib/utils";
import { applyOutputMode } from "@/lib/subtitles/output-mode";
import { timeToPixels, pixelsToTime } from "@/lib/timeline/time-scale";
import { computeSnappedTiming, type DragEdge } from "@/lib/timeline/snapping";
import { computeAutoScrollTarget } from "@/lib/timeline/auto-scroll";
import { computeZoomAnchor, computeZoomScrollLeft } from "@/lib/timeline/zoom-anchor";
import { computeSelectionBoundingRange, computeFitView } from "@/lib/timeline/fit-view";
import { clampTimelineTime } from "@/lib/timeline/timecode";
import { filterVisibleSubtitles, computeRulerTickStep, computeVisibleTicks } from "@/lib/timeline/visible-range";
import { getRenderableWordSegments, clampWordTiming, findChronologicalWordNeighbors } from "@/lib/subtitles/word-timing";
import { isTimeWithinCaption, findActiveWordIndex } from "@/lib/subtitles/playback-context";
import { computeWordSnappedTiming, type WordDragEdge } from "@/lib/timeline/word-snapping";
import { Waveform } from "./waveform";
import { toast } from "sonner";
import type { Subtitle } from "@/types/subtitle";

const WAVEFORM_HEIGHT = 40;

const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 220;

// Task 91342 (P7.1): a small, fixed magnetic-snap distance expressed in SCREEN pixels (per the
// task's own instruction) rather than a fixed number of seconds — converted to seconds via the
// existing pixelsToTime mapping at the CURRENT zoom level on every drag update, so snapping
// feels the same whether zoomed all the way in or out, instead of becoming much "stickier" in
// time-terms at a low zoom level. 8px is a conventional, unobtrusive magnetic-snap distance
// (small enough to never fight a deliberate drag, large enough to reliably catch an
// intended "line it up exactly" gesture) — not user-configurable, per the task's own
// "do not add a settings control for the threshold" instruction.
const SNAP_THRESHOLD_PX = 8;

// How long after a user-initiated (non-programmatic) timeline scroll to suppress playback
// auto-scroll — long enough that a deliberate manual scroll during playback isn't immediately
// fought on the very next currentTime tick, short enough that auto-follow resumes quickly once
// the user is done looking around. Not user-configurable, matching this task's "avoid a
// complicated follow-mode system" instruction — this is the whole mechanism.
const MANUAL_SCROLL_SUPPRESS_MS = 1500;

// Keeps the playhead within the middle 75% of the visible viewport during playback (a 12.5%
// margin on each side) before auto-scroll nudges the view — the task's own "approximately the
// middle 70-80%" guidance, landing on the midpoint of that range.
const AUTO_SCROLL_SAFE_ZONE_RATIO = 0.75;

export function Timeline() {
  const project = useEditorStore((s) => s.project);
  const selectedId = useEditorStore((s) => s.selectedSubtitleId);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const selectedWordIndex = useEditorStore((s) => s.selectedWordIndex);
  const selectWord = useEditorStore((s) => s.selectWord);
  const updateWordTiming = useEditorStore((s) => s.updateWordTiming);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const selectSubtitle = useEditorStore((s) => s.selectSubtitle);
  const toggleSubtitleSelection = useEditorStore((s) => s.toggleSubtitleSelection);
  const selectSubtitleRange = useEditorStore((s) => s.selectSubtitleRange);
  const seek = useEditorStore((s) => s.seek);
  const updateTiming = useEditorStore((s) => s.updateSubtitleTiming);
  const deleteSubtitle = useEditorStore((s) => s.deleteSubtitle);
  const deleteSubtitles = useEditorStore((s) => s.deleteSubtitles);
  const duplicateSubtitle = useEditorStore((s) => s.duplicateSubtitle);
  const duplicateSubtitles = useEditorStore((s) => s.duplicateSubtitles);
  const rippleDeleteSubtitles = useEditorStore((s) => s.rippleDeleteSubtitles);
  const rippleInsertTime = useEditorStore((s) => s.rippleInsertTime);
  const mergeWithNext = useEditorStore((s) => s.mergeWithNext);
  const splitSubtitleAtTime = useEditorStore((s) => s.splitSubtitleAtTime);
  const setSubtitleBoundaryToPlayhead = useEditorStore((s) => s.setSubtitleBoundaryToPlayhead);
  const setTrim = useEditorStore((s) => s.setTrim);
  const addCutRange = useEditorStore((s) => s.addCutRange);
  const removeCutRange = useEditorStore((s) => s.removeCutRange);
  const clearCutRanges = useEditorStore((s) => s.clearCutRanges);

  const [pxPerSec, setPxPerSec] = useState(70);
  const [scrubbing, setScrubbing] = useState(false);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  // Task 112347 (P18.5) — Ripple Insert's own small inline editor, closed by default, same
  // toggle-to-inline-editor shape as word-timing-popover.tsx's Split/Insert (this file's own Mark
  // in/Mark out/Cut range controls are the closer local precedent — same toolbar row, same "click
  // a button, act on the current playhead" pattern — but ripple insert additionally needs one
  // piece of user input, the duration, hence the small popover rather than a single click).
  const [rippleInsertOpen, setRippleInsertOpen] = useState(false);
  const [rippleInsertSeconds, setRippleInsertSeconds] = useState("1.0");
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 800 });
  // Visual feedback only (Task 91342 P7.1 snapping) — which time a drag is currently snapped to,
  // and which edge snapped, so the guide line can be drawn and cleared as the drag moves in and
  // out of snap range. Never read by any timing calculation; purely a render of `computeSnappedTiming`'s
  // own result, kept separate from `dragState` (a ref) because this one DOES need to trigger a
  // re-render to actually show/hide the guide.
  const [snapGuide, setSnapGuide] = useState<{ time: number; edge: "start" | "end" } | null>(null);
  // Task 137421 (P19.12) — the caption-level drag's own live-preview state, following the exact
  // same shape/pattern TimelineWordHandles' `dragPreview` already established: updated on every
  // pointermove via the pure `resolveTimingUpdate` (no commit), and committed to the store exactly
  // ONCE, on pointer-up, via `updateTiming`. Fixes P19.11's P1-3 finding — previously `updateTiming`
  // (a full commit) ran on every pointermove, so one long drag gesture could push more undo
  // entries than MAX_HISTORY and evict the user's prior history.
  const [captionDragPreview, setCaptionDragPreview] = useState<{ id: string; start: number; end: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    id: string;
    edge: DragEdge;
    originStart: number;
    originEnd: number;
    startX: number;
    // Captured ONCE at drag-start (see startDrag) from the caption's neighbors in the already-
    // sorted subtitles array — an O(1) lookup per drag gesture, not a re-scan on every
    // pointermove. A caption's sorted neighbors can't change mid-drag (the overlap clamp in
    // updateSubtitleTiming never lets it cross past either one), so this stays valid for the
    // whole gesture.
    prevEnd: number | null;
    nextStart: number | null;
  } | null>(null);
  const trimDragRef = useRef<{ edge: "trimStart" | "trimEnd" } | null>(null);
  // Task 115894 (P18.8) — onPointerMove calls updateTiming on every mouse-move tick of a drag, so
  // a rejected resize (a word would fall outside the new bounds) would otherwise spam one toast
  // per tick. This tracks whether the CURRENT drag gesture has already shown its one toast; reset
  // at the start of each new drag (startDrag) and on pointer-up. The caption itself simply stops
  // moving further in the rejected direction (no commit happens — the same visual "stops at the
  // wall" feel the existing neighbor-overlap clamp already has), the toast is just the explanation.
  const dragRejectedToastShownRef = useRef(false);
  const scrubbingRef = useRef(false);
  // Task 91342 (P7.1) auto-scroll/zoom-anchor bookkeeping. `programmaticScrollRef` distinguishes
  // a scrollLeft write THIS component made (auto-scroll or zoom-anchor preservation) from a real
  // user scroll gesture, so the native onScroll handler below never mistakes its own work for
  // "the user just manually scrolled" and doesn't need to suppress auto-scroll after itself.
  // `manualScrollUntilRef` is a plain timestamp (not React state) specifically so recording a
  // manual scroll never triggers a re-render on its own — only the auto-scroll effect reads it,
  // and only while playback is actually running.
  const programmaticScrollRef = useRef(false);
  const manualScrollUntilRef = useRef(0);
  // Set synchronously by a zoom button's click handler (zoomBy) with the anchor computed from
  // the OLD pxPerSec/scrollLeft, then consumed and cleared by the effect below once pxPerSec has
  // actually changed — a ref, not state, because it's read exactly once per zoom action and must
  // never itself trigger a render.
  const pendingZoomAnchorRef = useRef<{ anchorTime: number; anchorOffsetPx: number } | null>(null);

  const duration = project?.video?.duration ?? 0;
  const width = Math.max(800, duration * pxPerSec);

  // The ONE place a screen x-coordinate becomes a timestamp — the waveform's own click/scrub
  // handling relies on this being the exact same formula (via lib/timeline/time-scale.ts) used
  // here, so a click on the waveform and a click anywhere else on the track always agree on
  // what time it corresponds to (see components/editor/waveform.tsx's doc comment).
  //
  // Task 124572 (P19.4) — Phase-0 audit finding: this clamped only the LOWER bound (never
  // negative), never the upper one. The track's own rendered width is `Math.max(800, duration *
  // pxPerSec)` (see `width` below) — for a short project at a low zoom, that 800px floor extends
  // well past the project's actual duration, so a click/scrub anywhere in that empty trailing
  // region previously produced a time beyond `duration`, violating this task's own explicit
  // "clamp to [0, project.video.duration]" requirement. Reuses `clampTimelineTime` (P19.3,
  // lib/timeline/timecode.ts) rather than a second hand-rolled clamp — the exact same "clamp a
  // candidate seek target to [0, duration]" contract the "Go to time" input already relies on,
  // including its "no known duration -> clamp to exactly 0" fallback. `duration` is read fresh
  // via `useEditorStore.getState()` rather than closed over, so this callback's identity (and
  // every memoized consumer of it) doesn't need to change just because the project's own
  // duration is now a dependency — the exact same "read current state without subscribing"
  // pattern this file's own `selectCaptionByOffset`/`startDrag` already use for the identical
  // reason.
  const timeFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const raw = pixelsToTime(clientX - rect.left + (trackRef.current?.scrollLeft ?? 0), pxPerSec);
      return clampTimelineTime(raw, useEditorStore.getState().project?.video?.duration ?? 0);
    },
    [pxPerSec],
  );

  function onTrackClick(e: React.MouseEvent) {
    if (dragState.current) return;
    seek(timeFromClientX(e.clientX));
  }

  function startScrub(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrubbingRef.current = true;
    setScrubbing(true);
    seek(timeFromClientX(e.clientX));
  }

  function onScrubMove(e: React.PointerEvent) {
    if (!scrubbingRef.current) return;
    seek(timeFromClientX(e.clientX));
  }

  function endScrub() {
    scrubbingRef.current = false;
    setScrubbing(false);
  }

  // Task 109431 (P18.2) — wrapped in useCallback, reading `project` via `useEditorStore.getState()`
  // rather than closing over the render-time `project` variable, so this reference stays
  // permanently stable across renders (its only other dependency, `selectSubtitle`, is a Zustand
  // action reference that never changes — see CaptionsPanel's own handler-definition comment for
  // the full reasoning, identical here). This is what lets `TimelineCaptionBlock` (below) be
  // `React.memo`'d effectively: `startDrag` is passed to every visible block as a prop, and an
  // unstable reference here would defeat that memoization exactly the way captions-panel.tsx's
  // old inline row closures used to. Behavior is byte-for-byte unchanged — same one-time neighbor
  // lookup, same dragState write, same selectSubtitle(id) call.
  const startDrag = useCallback(
    (e: React.PointerEvent, id: string, edge: DragEdge, start: number, end: number) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      // One-time neighbor lookup for snapping (see dragState's own comment) — not repeated per
      // pointermove.
      const subs = useEditorStore.getState().project?.subtitles ?? [];
      const idx = subs.findIndex((s) => s.id === id);
      const prevEnd = idx > 0 ? subs[idx - 1].end : null;
      const nextStart = idx !== -1 && idx < subs.length - 1 ? subs[idx + 1].start : null;
      dragState.current = { id, edge, originStart: start, originEnd: end, startX: e.clientX, prevEnd, nextStart };
      dragRejectedToastShownRef.current = false;
      selectSubtitle(id);
    },
    [selectSubtitle],
  );

  // Task 109431 (P18.2) — the caption block's plain-click/Ctrl-click/Shift-click selection logic
  // (previously three branches inline inside the block's own onClick, recreated per block on
  // every Timeline render), now one stable, id-parameterized callback — same exact behavior
  // (blur any focused textarea before a modifier-click, then range-select / toggle-select /
  // select+seek), just fed to every block as a stable prop instead of a fresh closure each time.
  const handleBlockActivate = useCallback(
    (id: string, shiftKey: boolean, ctrlOrMeta: boolean) => {
      if (shiftKey) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        selectSubtitleRange(id);
      } else if (ctrlOrMeta) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        toggleSubtitleSelection(id);
      } else {
        selectSubtitle(id);
        const sub = useEditorStore.getState().project?.subtitles.find((s) => s.id === id);
        if (sub) seek(sub.start);
      }
    },
    [selectSubtitleRange, toggleSubtitleSelection, selectSubtitle, seek],
  );

  // The SELECTED caption's own word-handle callbacks — stable for the same reason as above.
  // `onWordSelect` never needed an id in the first place (TimelineWordHandles already resolves
  // the word's own start time itself and passes it straight through); `updateWordTiming` is
  // already the store's own `(subtitleId, wordIndex, start, end) => void` action, so it needs no
  // wrapping at all and is passed straight through at the call site below.
  const handleWordSelect = useCallback(
    (index: number, startTime: number) => {
      selectWord(index);
      seek(startTime);
    },
    [selectWord, seek],
  );

  function startTrimDrag(e: React.PointerEvent, edge: "trimStart" | "trimEnd") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    trimDragRef.current = { edge };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (scrubbingRef.current) {
      onScrubMove(e);
      return;
    }
    if (trimDragRef.current && project) {
      const t = timeFromClientX(e.clientX);
      const trimEnd = project.trimEnd ?? duration;
      if (trimDragRef.current.edge === "trimStart") setTrim(Math.max(0, Math.min(trimEnd - 0.2, t)), project.trimEnd);
      else setTrim(project.trimStart, Math.max(project.trimStart + 0.2, Math.min(duration, t)));
      return;
    }
    const drag = dragState.current;
    if (!drag) return;
    const deltaSec = (e.clientX - drag.startX) / pxPerSec;
    let start = drag.originStart;
    let end = drag.originEnd;
    if (drag.edge === "start") start = Math.min(drag.originEnd - 0.1, Math.max(0, drag.originStart + deltaSec));
    else if (drag.edge === "end") end = Math.max(drag.originStart + 0.1, drag.originEnd + deltaSec);
    else {
      start = Math.max(0, drag.originStart + deltaSec);
      end = start + (drag.originEnd - drag.originStart);
    }

    // Snapping (Task 91342 P7.1) — nudges the continuous drag position computed above toward a
    // nearby caption boundary or the playhead when within SNAP_THRESHOLD_PX. This is a proposal
    // only: the result still goes through resolveTimingUpdate below unchanged, which remains the
    // EXISTING, untouched overlap-prevention clamp in editor-store.ts — snapping can shift where
    // the drag lands, it can never bypass that clamp, so it can never itself create an overlap
    // or an invalid (sub-minimum) duration.
    const snapThresholdSec = pixelsToTime(SNAP_THRESHOLD_PX, pxPerSec);
    const snapped = computeSnappedTiming(drag.edge, start, end, { prevEnd: drag.prevEnd, nextStart: drag.nextStart, playhead: currentTime }, snapThresholdSec);
    start = snapped.start;
    end = snapped.end;
    setSnapGuide((prev) => {
      const next = snapped.snappedEdge ? { time: snapped.snapTime!, edge: snapped.snappedEdge } : null;
      if (prev === null && next === null) return prev; // bail: no identity churn when nothing changed
      if (prev && next && prev.time === next.time && prev.edge === next.edge) return prev;
      return next;
    });

    // Task 137421 (P19.12) — the SAME authoritative clamp/validation updateSubtitleTiming itself
    // uses on commit, called here for a LOCAL-ONLY live preview (no commit — see
    // captionDragPreview's own doc comment). A rejection ("word-out-of-bounds") leaves
    // captionDragPreview exactly where it was — the caption visibly "stops at the wall" for the
    // rest of this gesture's moves in the rejected direction, identical to the pre-fix behavior,
    // just without a commit (rejected or not) on every tick.
    const subtitles = useEditorStore.getState().project?.subtitles ?? [];
    const resolution = resolveTimingUpdate(subtitles, drag.id, start, end);
    if (resolution.ok) {
      setCaptionDragPreview({ id: drag.id, start: resolution.clampedStart, end: resolution.clampedEnd });
    } else if (resolution.reason === "word-out-of-bounds" && !dragRejectedToastShownRef.current) {
      dragRejectedToastShownRef.current = true;
      toast.error("Can't resize here — a word falls outside the new caption bounds.");
    }
  }

  function onPointerUp() {
    // Task 137421 (P19.12) — the ONE commit for the entire just-finished caption drag gesture
    // (word-handle drags already worked this way; see TimelineWordHandles' own onPointerUp).
    // captionDragPreview holds the final, already-clamped/validated position from the last
    // accepted pointermove — pointer-up calling updateTiming (still the exact same validated store
    // action, same overlap/word-bounds clamp, same UpdateSubtitleTimingResult) is the FIRST and
    // ONLY commit()/undo-entry this gesture ever produces. If the drag never moved far enough to
    // pass resolveTimingUpdate even once (captionDragPreview stays null), there is nothing to
    // commit — matches the pre-fix "no movement, no mutation" behavior exactly.
    if (captionDragPreview) {
      updateTiming(captionDragPreview.id, captionDragPreview.start, captionDragPreview.end);
      setCaptionDragPreview(null);
    }
    dragState.current = null;
    trimDragRef.current = null;
    dragRejectedToastShownRef.current = false;
    if (scrubbingRef.current) endScrub();
    setSnapGuide(null);
  }

  function cutMarkedRange() {
    if (markIn === null || markOut === null) return;
    const start = Math.min(markIn, markOut);
    const end = Math.max(markIn, markOut);
    if (end - start < 0.1) {
      toast.error("Mark a wider range to cut.");
      return;
    }
    addCutRange({ start, end, reason: "manual" });
    setMarkIn(null);
    setMarkOut(null);
    toast.success("Range cut — the export (and preview playback) will skip it.");
  }

  // Task 100742 (P13) — "set in"/"set out": moves the selected caption's start/end to the
  // current playhead. setSubtitleBoundaryToPlayhead itself decides validity (overlap, minimum
  // duration, no-op, and — Task 115894/P18.8 — a word falling outside the proposed bounds) and
  // makes NO commit at all when it rejects — this handler only surfaces that outcome to the
  // user, it never second-guesses it. It stays a plain boolean (not the reason string) to avoid
  // widening this one boolean-returning action's contract for a single toast's wording — the
  // message below is deliberately worded to stay true for every rejection reason.
  function applyBoundaryToPlayhead(edge: "start" | "end") {
    if (!selected) return;
    const ok = setSubtitleBoundaryToPlayhead(selected.id, edge);
    if (!ok) {
      toast.error(
        edge === "start"
          ? "Can't set the start here — it would overlap the previous caption, leave too little room, or push a word outside the caption."
          : "Can't set the end here — it would overlap the next caption, leave too little room, or push a word outside the caption.",
      );
    }
  }

  const selected = project?.subtitles.find((s) => s.id === selectedId);
  // Task 94820 (P8): the toolbar's Duplicate/Delete buttons become batch-aware once more than
  // one caption is selected — same buttons, same position, just acting on the whole selection
  // instead of `selected` alone (per this task's own "no huge new toolbar — reuse existing
  // controls" instruction). Split/Merge stay single-caption only: both are inherently scoped to
  // one caption's own word index or its one adjacent neighbor, and batch variants of either are
  // explicitly out of this task's scope.
  const isBatchSelection = selectedIds.size > 1;
  const selectedSubs = useMemo(
    () => (isBatchSelection && project ? project.subtitles.filter((s) => selectedIds.has(s.id)) : []),
    [isBatchSelection, project, selectedIds],
  );
  const manualCuts = project?.cutRanges.filter((c) => c.reason !== "trim") ?? [];
  // "Split Here" only makes sense with the playhead actually over the selected caption's
  // own words (and at least 2 of them to split between).
  const canSplitHere = !!selected && selected.words.length >= 2 && currentTime > selected.start && currentTime < selected.end;

  // Task 127416 (P19.6) — P19.5's own audit finding: unlike `visibleSubtitles` below (already
  // viewport-virtualized since P7.1), the ruler unconditionally mounted one DOM node per tick
  // across the ENTIRE project duration — ~1800 nodes for a 60-minute project at the 2s step,
  // regardless of how much of that was ever actually scrolled into view. Now computed the exact
  // same "viewport + one-screen overscan" way `visibleSubtitles` already is (same
  // `computeVisibleTimeRange` buffer, same `[viewport, pxPerSec]`-shaped dependency — not a
  // second virtualization convention), via `computeVisibleTicks` (lib/timeline/visible-range.ts),
  // which computes the first/last relevant tick INDEX directly rather than looping from 0. Tick
  // STEP selection (`computeRulerTickStep`) is unchanged from the original inline expression —
  // this task's own explicit "tick interval selection remains unchanged" invariant — just a named
  // function now instead of a bare ternary.
  const rulerStep = computeRulerTickStep(pxPerSec);
  const rulerMarks = useMemo(
    () => computeVisibleTicks({ scrollLeft: viewport.scrollLeft, viewportWidth: viewport.width, pxPerSec, step: rulerStep, duration }),
    [viewport, pxPerSec, rulerStep, duration],
  );

  // Task 121684 (P19.2): a `ResizeObserver`, not a mount-only read — P19.1 (Task 120417) made the
  // captions panel's own width (and therefore this timeline's own available width, since they
  // share the same flex row) draggable AFTER mount, and the P19.1 report's own claim that this
  // observer already existed was incorrect (confirmed by this task's own Phase-0 audit: it did
  // not). Without it, `viewport.width` went stale the instant a P19.1 panel resize changed this
  // container's real `clientWidth` — self-correcting only on the next native scroll event (see
  // the `onScroll` handler below), which a Fit/zoom action taken before any scroll would miss
  // entirely. Mirrors captions-panel.tsx's/video-canvas.tsx's own established
  // `ResizeObserver(() => setX(el.clientWidth))` pattern exactly — not a new one.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setViewport((v) => ({ ...v, width: el.clientWidth })));
    obs.observe(el);
    setViewport((v) => ({ ...v, width: el.clientWidth }));
    return () => obs.disconnect();
  }, []);

  // Scrolls the timeline horizontally so the selected caption's clip is in view whenever
  // selection changes from OUTSIDE a drag/click here — e.g. keyboard nav, search, or (new in
  // this phase) jumping to a caption from the quality panel's issue navigation. Mirrors
  // captions-panel.tsx's own selectedId-driven scroll-into-view effect (same "nearest" philosophy
  // — only scrolls when the target isn't already visible, never re-centers on every render) so
  // this is the SAME mechanism applied to the timeline's horizontal axis, not a second one.
  // Keyed on selectedId alone (not pxPerSec/project) so zooming or unrelated edits never
  // re-trigger a scroll the user didn't ask for.
  useEffect(() => {
    if (!selectedId || !project || !scrollRef.current) return;
    const sub = project.subtitles.find((s) => s.id === selectedId);
    if (!sub) return;
    const el = scrollRef.current;
    const targetLeft = timeToPixels(sub.start, pxPerSec);
    const targetRight = timeToPixels(sub.end, pxPerSec);
    const margin = 40;
    let nextScrollLeft: number | null = null;
    if (targetLeft < el.scrollLeft + margin) {
      nextScrollLeft = Math.max(0, targetLeft - margin);
    } else if (targetRight > el.scrollLeft + el.clientWidth - margin) {
      nextScrollLeft = targetRight - el.clientWidth + margin;
    }
    if (nextScrollLeft !== null) {
      // Set both the real DOM scroll position and the React viewport state directly (a
      // programmatic scrollLeft assignment doesn't reliably fire a native "scroll" event
      // synchronously in every environment) — same dual-update reasoning as
      // captions-panel.tsx's own scrollIndexIntoView, so the virtualized visibleSubtitles
      // window recomputes immediately instead of waiting on an event that might not arrive.
      // Tagged as programmatic (Task 91342 P7.1) so the onScroll handler below doesn't mistake
      // this selection-driven scroll for a manual one and needlessly suppress playback
      // auto-scroll for the next MANUAL_SCROLL_SUPPRESS_MS.
      programmaticScrollRef.current = true;
      el.scrollLeft = nextScrollLeft;
      setViewport((v) => ({ ...v, scrollLeft: nextScrollLeft! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Playback auto-scroll (Task 91342 P7.1): while playing, keeps the playhead inside the middle
  // AUTO_SCROLL_SAFE_ZONE_RATIO of the viewport by nudging scrollLeft just enough — never
  // re-centering, never running every animation frame (currentTime only updates a handful of
  // times per second via the video's own timeupdate event, not per-frame — see video-canvas.tsx
  // — and computeAutoScrollTarget itself returns null, doing nothing, on the overwhelming
  // majority of those updates where the playhead is already comfortably in view). Skips
  // entirely while a caption/trim drag is in progress (dragState/trimDragRef checked directly,
  // not via React state, so this reads their live value with no extra re-render), and skips for
  // MANUAL_SCROLL_SUPPRESS_MS after a real user scroll so it never fights a deliberate manual
  // pan — see the onScroll handler below for how manualScrollUntilRef gets set. Left out of the
  // dependency array deliberately (same "intentionally narrow deps" pattern as the selectedId
  // effect above): pxPerSec/duration/viewport rarely change and, when they do, the next
  // currentTime tick (usually within a fraction of a second while playing) re-evaluates with
  // fresh values anyway.
  //
  // Task 124572 (P19.4) — Phase-0 audit finding: `scrubbingRef` was missing from this guard.
  // A ruler/playhead scrub calls `seek()` on every pointermove, which changes `currentTime` —
  // exactly this effect's own dependency — so scrubbing WHILE the video happens to be playing
  // re-ran this effect on every drag tick and could nudge `scrollLeft` out from under the user's
  // own pointer mid-gesture (this task's own explicit "automatic playback scrolling must not
  // fight the user's pointer" requirement). `dragState`/`trimDragRef` were already excluded for
  // the identical reason; `scrubbingRef` was simply the one drag-in-progress flag this effect
  // hadn't been taught about yet — same ref-read pattern, not a new mechanism.
  useEffect(() => {
    if (!isPlaying) return;
    if (dragState.current || trimDragRef.current || scrubbingRef.current) return;
    if (Date.now() < manualScrollUntilRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const totalWidth = Math.max(800, duration * pxPerSec);
    const maxScrollLeft = Math.max(0, totalWidth - viewport.width);
    const target = computeAutoScrollTarget({
      playheadPx: timeToPixels(currentTime, pxPerSec),
      scrollLeft: viewport.scrollLeft,
      viewportWidth: viewport.width,
      maxScrollLeft,
      safeZoneRatio: AUTO_SCROLL_SAFE_ZONE_RATIO,
    });
    if (target === null) return;
    programmaticScrollRef.current = true;
    el.scrollLeft = target;
    // The React-state mirror (not just the raw DOM write above) is the SAME dual-update this
    // file's own pre-existing selectedId effect already uses, and for the identical reason —
    // see that effect's comment a few lines up. The set-state-in-effect lint rule flags this
    // occurrence specifically because currentTime changes continuously during playback rather
    // than on a single discrete event; the underlying pattern (synchronize a real DOM property,
    // then mirror it into React state so the virtualized visibleSubtitles window recomputes
    // immediately) is identical and already established as correct in this file.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewport((v) => ({ ...v, scrollLeft: target }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, isPlaying]);

  // Zoom position preservation (Task 91342 P7.1): consumes whatever computeZoomAnchor() the
  // zoomBy() handler below recorded (from the OLD pxPerSec) right before changing pxPerSec, and
  // adjusts scrollLeft so that same anchor time lands back at the same on-screen pixel offset
  // under the NEW pxPerSec — see lib/timeline/zoom-anchor.ts. Guarded on the ref being non-null
  // so this never does anything on an unrelated re-render (e.g. a caption edit), and the ref is
  // cleared immediately, so this can't loop: the next pxPerSec change is a brand new zoom action
  // with its own freshly-set pending anchor, not a re-trigger of this one.
  useEffect(() => {
    const pending = pendingZoomAnchorRef.current;
    if (!pending || !scrollRef.current) return;
    pendingZoomAnchorRef.current = null;
    const nextScrollLeft = computeZoomScrollLeft({
      anchorTime: pending.anchorTime,
      anchorOffsetPx: pending.anchorOffsetPx,
      newPxPerSec: pxPerSec,
      duration,
      viewportWidth: viewport.width,
    });
    programmaticScrollRef.current = true;
    scrollRef.current.scrollLeft = nextScrollLeft;
    setViewport((v) => ({ ...v, scrollLeft: nextScrollLeft }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerSec]);

  // Task 91342 (P7.1) zoom handler — replaces the old bare `setPxPerSec` calls. Records the zoom
  // anchor from the CURRENT (about-to-be-old) pxPerSec/scrollLeft before changing anything, so
  // the effect above has what it needs; a no-op (no anchor recorded, no state change) if already
  // at the min/max zoom, so repeatedly clicking a maxed-out zoom button never fires the effect
  // for nothing.
  function zoomBy(deltaPx: number) {
    const next = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, pxPerSec + deltaPx));
    if (next === pxPerSec) return;
    const el = scrollRef.current;
    pendingZoomAnchorRef.current = computeZoomAnchor({
      currentTime,
      scrollLeft: el?.scrollLeft ?? viewport.scrollLeft,
      viewportWidth: el?.clientWidth ?? viewport.width,
      pxPerSec,
    });
    setPxPerSec(next);
  }

  // Task 121684 (P19.2) — applies a Fit to Project/Selection result. Unlike zoomBy above (which
  // PRESERVES a specific anchor across a zoom-only change via pendingZoomAnchorRef), a fit
  // deliberately jumps to a NEW pxPerSec AND scrollLeft together — there is no anchor to hold
  // fixed, the whole point is to bring a different range into view — so this intentionally does
  // NOT set pendingZoomAnchorRef (that effect no-ops when nothing is pending, see its own guard),
  // and instead directly writes both the real DOM scrollLeft and the pxPerSec/viewport React
  // state in one go — the SAME dual-write shape this file's own selectedId-scroll-into-view
  // effect already uses, so the virtualized visibleSubtitles window recomputes immediately
  // instead of waiting on a scroll event that a purely programmatic write doesn't always fire.
  // A `null` result (zero/unavailable duration, or no selection) is a deliberate, silent no-op —
  // this task's own explicit "fail safely and do nothing" / "do not guess a range" requirement.
  function applyFitView(range: { start: number; end: number } | null) {
    if (!range) return;
    const el = scrollRef.current;
    const viewportWidth = el?.clientWidth ?? viewport.width;
    const result = computeFitView({ range, duration, viewportWidth, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC });
    if (!result) return;
    programmaticScrollRef.current = true;
    if (el) el.scrollLeft = result.scrollLeft;
    setPxPerSec(result.pxPerSec);
    setViewport({ scrollLeft: result.scrollLeft, width: viewportWidth });
  }

  function fitToProject() {
    applyFitView(duration > 0 ? { start: 0, end: duration } : null);
  }

  function fitToSelection() {
    const captions = isBatchSelection ? selectedSubs : selected ? [selected] : [];
    applyFitView(computeSelectionBoundingRange(captions));
  }

  // Virtualization: a long recording can have thousands of subtitle segments
  // — rendering an absolutely-positioned DOM node for every one of them
  // (most scrolled far offscreen) is what makes a long timeline feel
  // sluggish. Only the segments that actually intersect the visible scroll
  // window (+ a one-screen buffer on each side, so nothing pops in/out while
  // scrolling) get mounted.
  const visibleSubtitles = useMemo(() => {
    if (!project) return [];
    const inView = filterVisibleSubtitles(project.subtitles, { scrollLeft: viewport.scrollLeft, viewportWidth: viewport.width, pxPerSec });
    // Same display rule as the preview/export — see lib/subtitles/output-mode.ts —
    // so the timeline's block labels never show a different script than what's
    // actually playing.
    return applyOutputMode(inView, project.captionOutputMode);
  }, [project, viewport, pxPerSec]);

  if (!project) return null;

  return (
    <div className="flex h-full flex-col border-t border-border bg-surface">
      {/* Task 121684 (P19.2) — `overflow-x-auto` added as a safety net discovered during this
          task's own live QA: this row was already tight with every Ripple/Mark/Cut control, and
          adding Fit Project/Fit Selection (even icon-only, see below) can still overflow the
          available width once the P19.1 captions panel is widened (shrinking this timeline's own
          share of the row). Without this, an overflowing button doesn't wrap or shrink — it's
          simply clipped by this row's own layout and becomes unreachable by mouse. A horizontal
          scrollbar (styled globally in globals.css) is a safety net, not the primary fix — the
          icon-only sizing below is what keeps this row's steady-state width in check. */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted">Timeline</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canSplitHere}
          onClick={() => {
            if (!selected) return;
            const result = splitSubtitleAtTime(selected.id, currentTime);
            if (result === "word-straddles-split") toast.error("Can't split here — a word spans the split point.");
            else if (result === "invalid-time" || result === "empty-side") toast.error("Can't split here.");
          }}
          title="Split Here (at playhead) — Ctrl/Cmd+Shift+S"
        >
          <Scissors className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            const result = mergeWithNext(selected.id);
            if (result === "no-next-caption") toast.error("Nothing after this caption to merge with.");
            else if (result === "overlap" || result === "out-of-bounds") toast.error("Can't merge these captions — their words overlap.");
          }}
          title="Merge with next — Ctrl/Cmd+Shift+M"
        >
          <Merge className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected}
          onClick={() => applyBoundaryToPlayhead("start")}
          title="Set selected caption's start to playhead"
        >
          <ArrowLeftToLine className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected}
          onClick={() => applyBoundaryToPlayhead("end")}
          title="Set selected caption's end to playhead"
        >
          <ArrowRightToLine className="size-3.5" />
        </Button>
        {/* Task 123041 (P19.3) — the reverse direction of the two mutation buttons just above:
            move the PLAYHEAD to the selection's own start/end, never the other way around, and
            never touch caption timing, undo history, or dirty state — plain `seek()`, the same
            existing mechanism every other navigation control in this file already uses. Reuses
            `computeSelectionBoundingRange` (lib/timeline/fit-view.ts, P19.2) rather than a second
            "min start / max end" implementation, so a multi-selection's bounding range is computed
            identically here and in Fit Selection. Distinct icon direction (arrow pointing AWAY
            from the line, vs. the mutation buttons' arrow pointing INTO it) so the two opposite
            operations are never visually confusable. */}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected && !isBatchSelection}
          onClick={() => {
            const captions = isBatchSelection ? selectedSubs : selected ? [selected] : [];
            const range = computeSelectionBoundingRange(captions);
            if (range) seek(range.start);
          }}
          title={selected || isBatchSelection ? "Jump to selection start" : "Select a caption first"}
        >
          <ArrowLeftFromLine className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected && !isBatchSelection}
          onClick={() => {
            const captions = isBatchSelection ? selectedSubs : selected ? [selected] : [];
            const range = computeSelectionBoundingRange(captions);
            if (range) seek(range.end);
          }}
          title={selected || isBatchSelection ? "Jump to selection end" : "Select a caption first"}
        >
          <ArrowRightFromLine className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected && !isBatchSelection}
          onClick={() => {
            if (isBatchSelection) {
              const result = duplicateSubtitles(Array.from(selectedIds));
              if (result === "non-contiguous") toast.error("Batch duplicate needs a contiguous selection — try selecting adjacent captions only.");
              else if (result === "no-room") toast.error("Not enough room to duplicate here — the next caption starts too soon.");
            } else if (selected) {
              const result = duplicateSubtitle(selected.id);
              if (result === "no-room") toast.error("Not enough room to duplicate here — the next caption starts too soon.");
            }
          }}
          title={isBatchSelection ? `Duplicate ${selectedIds.size} selected captions — Ctrl/Cmd+D` : "Duplicate — Ctrl/Cmd+D"}
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected && !isBatchSelection}
          onClick={() => {
            if (isBatchSelection) deleteSubtitles(Array.from(selectedIds));
            else if (selected) deleteSubtitle(selected.id);
          }}
          title={isBatchSelection ? `Delete ${selectedIds.size} selected captions — Delete/Backspace` : "Delete — Delete/Backspace"}
        >
          <Trash2 className="size-3.5" />
        </Button>
        {/* Task 112347 (P18.5) — Ripple Delete: unlike the plain Delete button above (which
            leaves a gap, see deleteSubtitle/deleteSubtitles), this also shifts every LATER
            caption earlier by the deleted span, closing the gap. Same single-or-batch
            selection routing as Duplicate/Delete just above; a non-contiguous batch selection
            is rejected with a toast rather than silently guessing a placement. */}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!selected && !isBatchSelection}
          onClick={() => {
            const ids = isBatchSelection ? Array.from(selectedIds) : selected ? [selected.id] : [];
            const result = rippleDeleteSubtitles(ids);
            if (result === "non-contiguous") toast.error("Ripple delete needs a contiguous selection — try selecting adjacent captions only.");
            else if (result === "empty-selection") toast.error("Select a caption to ripple delete.");
            else if (result === "invalid-result") toast.error("Can't ripple delete here — the result would be invalid.");
          }}
          title={
            isBatchSelection
              ? `Ripple delete ${selectedIds.size} selected captions — later captions shift earlier to close the gap`
              : "Ripple delete — later captions shift earlier to close the gap"
          }
        >
          <Waves className="size-3.5" />
        </Button>
        <div className="mx-2 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={() => setMarkIn(currentTime)} title="Mark in at playhead">
          <LogIn className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setMarkOut(currentTime)} title="Mark out at playhead">
          <LogOut className="size-3.5" />
        </Button>
        <Button variant="outline" size="sm" disabled={markIn === null || markOut === null} onClick={cutMarkedRange}>
          <Scissors className="size-3.5" /> Cut range
        </Button>
        {/* Task 112347 (P18.5) — Ripple Insert: the one ripple action that needs a piece of user
            input (the duration), so it gets a small popover rather than a single click, same
            "click a button, act on the current playhead" pattern as Mark in/Mark out just
            above. Rejects (with a clear message, staying open) rather than guessing when the
            playhead falls strictly inside a caption — see rippleInsertTime's own doc comment. */}
        <Popover open={rippleInsertOpen} onOpenChange={setRippleInsertOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" title="Insert subtitle-timeline time at the playhead, shifting later captions forward">
              <Waves className="size-3.5" /> Ripple insert
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 space-y-2.5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-2">Insert time at playhead</p>
            <p className="text-[11px] text-muted-2">At {formatTime(currentTime)} — later captions shift forward by this amount.</p>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step={0.1}
                min={0.1}
                value={rippleInsertSeconds}
                onChange={(e) => setRippleInsertSeconds(e.target.value)}
                className="h-7 px-1.5 text-xs"
              />
              <span className="text-xs text-muted-2">sec</span>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setRippleInsertOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="accent"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  const seconds = Number(rippleInsertSeconds);
                  const result = rippleInsertTime(currentTime, seconds);
                  if (result === "ok") {
                    toast.success(`Inserted ${seconds.toFixed(2)}s at ${formatTime(currentTime)}.`);
                    setRippleInsertOpen(false);
                  } else if (result === "invalid-duration") {
                    toast.error("Enter a positive number of seconds to insert.");
                  } else if (result === "invalid-insertion-point") {
                    toast.error("Can't insert here.");
                  } else if (result === "crosses-caption") {
                    toast.error("Can't insert here — a caption spans the playhead. Move the playhead to a gap or caption boundary first.");
                  } else if (result === "noop") {
                    toast.info("Nothing after the playhead to shift — no change made.");
                    setRippleInsertOpen(false);
                  }
                }}
              >
                Insert
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {manualCuts.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => clearCutRanges("manual")} title="Revert all manual cuts">
            <Undo2 className="size-3.5" /> Revert cuts
          </Button>
        )}
        <div className="mx-2 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={() => zoomBy(-20)} title="Zoom out">
          <ZoomOut className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => zoomBy(20)} title="Zoom in">
          <ZoomIn className="size-3.5" />
        </Button>
        {/* Task 121684 (P19.2) — Fit to Project always available (a zero/unavailable duration is
            a silent no-op inside applyFitView, per this task's own "fail safely" requirement, so
            disabling the button for that case isn't necessary — the button simply does nothing,
            same as every other already-at-its-limit control in this toolbar). Fit to Selection is
            explicitly disabled with no selection — "do not guess a range" — rather than guessing
            or silently no-op'ing on click, so the unavailability is visible, not just inert. */}
        <Button variant="ghost" size="icon-sm" onClick={fitToProject} title="Fit to Project — zoom to show the entire project">
          <Maximize2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fitToSelection}
          disabled={!selected && !isBatchSelection}
          title={selected || isBatchSelection ? "Fit to Selection — zoom to show the selected caption(s)" : "Select a caption first"}
        >
          <Focus className="size-3.5" />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // Task 124572 (P19.4) — Phase-0 audit finding: this container's own caption-edge/trim
        // drags and the ruler/playhead scrub (startScrub, below) all clean up via `onPointerUp`,
        // but a pointer can also end via `pointercancel` (a browser/OS-level interruption — e.g.
        // a touch gesture the OS reassigns to something else, or a context menu appearing mid-
        // drag) WITHOUT a `pointerup` ever firing. Before this fix, that left `scrubbingRef`/
        // `dragState`/`trimDragRef` stuck "active" with no further pointermove to ever clear
        // them — exactly the "no stuck dragging state" failure this task's own spec calls out.
        // `onPointerUp` is reused verbatim (not a new handler) since the cleanup is identical
        // either way; `TimelineWordHandles`' own word-drag layer already does the same thing
        // (see its own `onPointerCancel={onPointerUp}`, further down this file) — this brings the
        // caption/scrub layer up to that same, already-established convention.
        onPointerCancel={onPointerUp}
        onScroll={(e) => {
          const scrollLeft = e.currentTarget.scrollLeft;
          setViewport({ scrollLeft, width: e.currentTarget.clientWidth });
          // Task 91342 (P7.1): only a scroll event NOT caused by our own programmatic write
          // counts as "the user manually scrolled" — see programmaticScrollRef's own comment.
          if (!programmaticScrollRef.current) {
            manualScrollUntilRef.current = Date.now() + MANUAL_SCROLL_SUPPRESS_MS;
          }
          programmaticScrollRef.current = false;
        }}
      >
        <div
          ref={trackRef}
          className="relative h-full cursor-pointer select-none"
          style={{ width }}
          onClick={onTrackClick}
        >
          {/* ruler — draggable to scrub */}
          <div
            className="sticky top-0 z-30 h-5 cursor-ew-resize border-b border-border bg-surface"
            onPointerDown={startScrub}
          >
            {rulerMarks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-border/70 pl-1 text-[9px] text-muted-2" style={{ left: timeToPixels(t, pxPerSec) }}>
                {formatTime(t).slice(0, 5)}
              </div>
            ))}
          </div>

          {/* video track: full source duration, with trim handles and cut markers */}
          <div className="relative h-8 border-b border-border/60 bg-surface-2">
            <div
              className="absolute inset-y-1 rounded-sm bg-border-strong"
              style={{ left: project.trimStart * pxPerSec, width: Math.max(2, ((project.trimEnd ?? duration) - project.trimStart) * pxPerSec) }}
            />
            {/* trimmed-away regions, dimmed */}
            {project.trimStart > 0 && (
              <div className="absolute inset-y-1 left-0 rounded-sm bg-black/50" style={{ width: project.trimStart * pxPerSec }} />
            )}
            {(project.trimEnd ?? duration) < duration && (
              <div
                className="absolute inset-y-1 rounded-sm bg-black/50"
                style={{ left: (project.trimEnd ?? duration) * pxPerSec, width: (duration - (project.trimEnd ?? duration)) * pxPerSec }}
              />
            )}
            {/* filler/silence/manual cut markers, revertible */}
            {project.cutRanges.map((c) => (
              <div
                key={c.id}
                className="group absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-sm border border-danger/50 bg-danger/25"
                style={{ left: c.start * pxPerSec, width: Math.max(3, (c.end - c.start) * pxPerSec) }}
                title={`${c.reason} cut: ${formatTime(c.start)}–${formatTime(c.end)}`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCutRange(c.id);
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Revert this cut"
                >
                  <X className="size-3 text-white" />
                </button>
              </div>
            ))}
            {/* trim handles */}
            <div
              className="absolute inset-y-0 w-2 cursor-ew-resize bg-accent"
              style={{ left: project.trimStart * pxPerSec - 4 }}
              onPointerDown={(e) => startTrimDrag(e, "trimStart")}
            />
            <div
              className="absolute inset-y-0 w-2 cursor-ew-resize bg-accent"
              style={{ left: (project.trimEnd ?? duration) * pxPerSec - 4 }}
              onPointerDown={(e) => startTrimDrag(e, "trimEnd")}
            />
            {markIn !== null && (
              <div className="absolute inset-y-0 w-0.5 bg-success" style={{ left: markIn * pxPerSec }} title="Mark in" />
            )}
            {markOut !== null && (
              <div className="absolute inset-y-0 w-0.5 bg-warning" style={{ left: markOut * pxPerSec }} title="Mark out" />
            )}
          </div>

          {/* audio waveform — amplitude only (see components/editor/waveform.tsx); trim/cut
              dimming and the selected-caption highlight are drawn here as plain overlay divs,
              the same pattern the video track above already uses, so there's exactly one way
              this kind of overlay is built in this file, not two. Pointer-events are disabled
              on every element in this row: a click here falls through to the track's own
              onClick (see onTrackClick above) via the SAME timeFromClientX math the ruler/video
              track already use, so the waveform can never disagree with the rest of the
              timeline about where a click landed or create a second, competing seek path. */}
          <div className="relative border-b border-border/60 bg-surface-2/50" style={{ height: WAVEFORM_HEIGHT }}>
            <Waveform
              key={project.id}
              projectId={project.id}
              pxPerSec={pxPerSec}
              viewportScrollLeft={viewport.scrollLeft}
              viewportWidth={viewport.width}
              totalWidth={width}
              height={WAVEFORM_HEIGHT}
            />
            {/* Task 94820 (P8): one overlay per selected caption when a batch is active (the
                focused one drawn with the ORIGINAL single-selection styling, every other
                selected caption drawn slightly dimmer — same "focused caption stays visually
                distinguishable from the rest of the selection" rule captions-panel.tsx's own
                row styling uses), falling back to the exact original single-`selected` overlay
                when there's no batch at all. */}
            {isBatchSelection
              ? selectedSubs.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "pointer-events-none absolute inset-y-0 border-x",
                      s.id === selectedId ? "border-accent/40 bg-accent/10" : "border-accent/25 bg-accent/5",
                    )}
                    style={{ left: timeToPixels(s.start, pxPerSec), width: Math.max(2, timeToPixels(s.end - s.start, pxPerSec)) }}
                  />
                ))
              : selected && (
                  <div
                    className="pointer-events-none absolute inset-y-0 border-x border-accent/40 bg-accent/10"
                    style={{ left: timeToPixels(selected.start, pxPerSec), width: Math.max(2, timeToPixels(selected.end - selected.start, pxPerSec)) }}
                  />
                )}
            {project.trimStart > 0 && (
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/50" style={{ width: timeToPixels(project.trimStart, pxPerSec) }} />
            )}
            {(project.trimEnd ?? duration) < duration && (
              <div
                className="pointer-events-none absolute inset-y-0 bg-black/50"
                style={{
                  left: timeToPixels(project.trimEnd ?? duration, pxPerSec),
                  width: timeToPixels(duration - (project.trimEnd ?? duration), pxPerSec),
                }}
              />
            )}
            {project.cutRanges.map((c) => (
              <div
                key={c.id}
                className="pointer-events-none absolute inset-y-0 bg-danger/20"
                style={{ left: timeToPixels(c.start, pxPerSec), width: Math.max(2, timeToPixels(c.end - c.start, pxPerSec)) }}
              />
            ))}
          </div>

          {/* subtitle blocks — virtualized, see visibleSubtitles above */}
          <div className="relative h-16 py-2">
            {visibleSubtitles.map((s) => {
              const isSelected = s.id === selectedId;
              const isMultiSelected = selectedIds.has(s.id);
              // Distinct from "selected": whichever caption the playhead is actually
              // over right now, so scrubbing/playback always shows a clear answer to
              // "where am I" even when it's not the caption someone clicked to edit.
              // Task 100742 (P13): now the shared lib/subtitles/playback-context.ts definition —
              // same "first in sorted-array order wins on overlap" rule as before, just no longer
              // a bespoke inline copy of it.
              const isActive = isTimeWithinCaption(s, currentTime);
              return (
                <TimelineCaptionBlock
                  key={s.id}
                  subtitle={s}
                  pxPerSec={pxPerSec}
                  isSelected={isSelected}
                  isMultiSelected={isMultiSelected}
                  isActive={isActive}
                  selectedWordIndex={selectedWordIndex}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  // Task 137421 (P19.12) — `null` for every caption except the one currently being
                  // drag-previewed, so this prop stays the exact same `null` reference (no re-render)
                  // for every OTHER visible block on every pointermove tick — the same per-caption
                  // re-render granularity the old per-tick `updateTiming` commit already had (only
                  // the touched caption's object ever changed reference), just without a commit.
                  dragPreview={captionDragPreview && captionDragPreview.id === s.id ? captionDragPreview : null}
                  onStartDrag={startDrag}
                  onActivate={handleBlockActivate}
                  onSelectWord={handleWordSelect}
                  onCommitWordTiming={updateWordTiming}
                />
              );
            })}
          </div>

          {/* playhead — the handle is draggable to scrub, independent of the ruler drag above */}
          <div className="pointer-events-none absolute top-0 z-20 h-full w-px bg-accent-cyan" style={{ left: currentTime * pxPerSec }}>
            <div
              className={cn(
                "pointer-events-auto absolute -left-1.5 -top-0.5 size-3 cursor-ew-resize rounded-full bg-accent-cyan shadow-[0_0_0_3px_rgba(34,211,238,0.25)] transition-transform",
                scrubbing && "scale-125",
              )}
              onPointerDown={startScrub}
            />
          </div>

          {/* Snap guide (Task 91342 P7.1) — a subtle, momentary indicator that the current
              drag is snapped to a nearby caption boundary or the playhead; distinct in color
              from the playhead itself so the two are never confused, and disappears the instant
              snapGuide clears (drag moves out of range, or the pointer is released — see
              onPointerMove/onPointerUp). Deliberately just a thin line, no animation, no large
              overlay — "subtle" per the task's own instruction. */}
          {snapGuide && (
            <div
              className="pointer-events-none absolute top-0 z-20 h-full w-px bg-warning shadow-[0_0_4px_1px_rgba(234,179,8,0.6)]"
              style={{ left: snapGuide.time * pxPerSec }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Task 109431 (P18.2) — one timeline caption block, extracted out of `Timeline`'s own
 * `visibleSubtitles.map()` and wrapped in `React.memo` so an edit to one caption no longer forces
 * every OTHER visible block to re-render too (the P18 preflight audit's own finding — see
 * research/p18_professional_editor_preflight_report.md §3 item 18/30 — that timeline blocks were
 * "inline JSX, re-created and reconciled on each Timeline render," never memoized at all).
 *
 * Every prop here is either a primitive (`pxPerSec`, `isSelected`, `isActive`, ...) or a STABLE
 * callback reference (`onStartDrag`/`onActivate`/`onSelectWord` — all defined once in `Timeline`
 * via `useCallback` against only permanently-stable Zustand action deps; `onCommitWordTiming` is
 * `updateWordTiming` passed straight through, already exactly `(subtitleId, wordIndex, start,
 * end) => void`). `subtitle` itself is the one exception worth calling out explicitly: for an
 * UNRELATED caption, `commit()`/`undo()`/`redo()` (editor-store.ts) return the exact SAME
 * `Subtitle` object reference when that caption wasn't touched — so in "original" display mode,
 * where `applyOutputMode` is a pure passthrough (`if (mode === "original") return subtitles;`,
 * output-mode.ts), this prop is reference-stable too, and `React.memo`'s default shallow
 * comparison correctly skips re-rendering an unrelated block.
 *
 * KNOWN LIMITATION (documented, not fixed — fixing it would mean changing the protected
 * Original/Hinglish/Gujarati-Script architecture, out of this task's scope): in "hinglish"/
 * "gujarati-script" mode, `applyOutputMode` unconditionally rebuilds every subtitle's `text`/
 * `words` from its own per-word derived text (deliberately, so a non-destructive trim/cut can
 * never desync the displayed text from the post-cut word set — see applyOutputMode's own doc
 * comment) — so `subtitle` is a NEW object on every render for every caption, in those two modes,
 * regardless of which caption actually changed. Memoization therefore only prevents unrelated-
 * caption re-renders while in Original mode; it is a no-op safety net (never incorrect, just not
 * a further speedup) in the two derived modes. This mirrors, and does not attempt to fix, the
 * exact same pre-existing constraint on `applyOutputMode` itself.
 */
const TimelineCaptionBlock = memo(function TimelineCaptionBlock({
  subtitle,
  pxPerSec,
  isSelected,
  isMultiSelected,
  isActive,
  selectedWordIndex,
  currentTime,
  isPlaying,
  dragPreview,
  onStartDrag,
  onActivate,
  onSelectWord,
  onCommitWordTiming,
}: {
  subtitle: Subtitle;
  pxPerSec: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  isActive: boolean;
  /** Only meaningful while `isSelected` (see TimelineWordHandles, only ever rendered then) — kept
   * as a plain prop rather than a store subscription here so this block's own memo comparison
   * stays a simple, default shallow one; the SELECTED block re-rendering on word-selection change
   * is correct and expected, exactly as before this task. */
  selectedWordIndex: number | null;
  /** Passed straight through to TimelineWordHandles (selected block only) — see that component's
   * own doc comment for why it needs both directly rather than subscribing itself. */
  currentTime: number;
  isPlaying: boolean;
  /** Task 137421 (P19.12) — this caption's own in-progress drag position, or `null` when it isn't
   * the one currently being dragged (see Timeline's own call site: every OTHER block always gets
   * the same `null` reference, so this never defeats memoization for unrelated captions). Read
   * INSTEAD of `subtitle.start`/`subtitle.end` for on-screen position/width only — the underlying
   * `subtitle` is never mutated until the gesture's one final commit on pointer-up. */
  dragPreview: { id: string; start: number; end: number } | null;
  onStartDrag: (e: React.PointerEvent, id: string, edge: DragEdge, start: number, end: number) => void;
  onActivate: (id: string, shiftKey: boolean, ctrlOrMeta: boolean) => void;
  onSelectWord: (index: number, startTime: number) => void;
  onCommitWordTiming: (subtitleId: string, wordIndex: number, start: number, end: number) => void;
}) {
  const effectiveStart = dragPreview?.start ?? subtitle.start;
  const effectiveEnd = dragPreview?.end ?? subtitle.end;
  const left = effectiveStart * pxPerSec;
  const w = Math.max(6, (effectiveEnd - effectiveStart) * pxPerSec);
  return (
    <div
      className={cn(
        "group absolute top-1 flex h-12 items-center gap-1.5 overflow-hidden rounded-md border px-2 text-[11px] transition-colors",
        isSelected
          ? "border-accent bg-accent-soft z-10"
          : isMultiSelected
            ? "border-accent/50 bg-accent-soft/50 z-10"
            : "border-border-strong bg-surface-2 hover:bg-surface-3",
        isActive && !isSelected && !isMultiSelected && "border-accent-cyan/70 bg-accent-cyan/10",
      )}
      style={{ left, width: w }}
      onPointerDown={(e) => {
        // Task 94820 (P8): a Ctrl/Cmd/Shift-click adjusts the selection instead of
        // starting a move-drag — same "modifier-click means selection, not the
        // caption's normal interaction" rule captions-panel.tsx's row uses.
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        onStartDrag(e, subtitle.id, "move", subtitle.start, subtitle.end);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onActivate(subtitle.id, e.shiftKey, e.ctrlKey || e.metaKey);
      }}
    >
      {/* Word boundaries + handles (Task 92618 P7.2 boundaries; Task 102741 P15 adds
          click-to-seek and the selected word's own drag handles) — for the SELECTED
          caption alone (never computed for the other captions in the virtualized
          window, let alone the whole project — see this file's own
          visibleSubtitles/virtualization doc comments on why per-caption cost matters
          here). Extracted into its own component (TimelineWordHandles, below) so a
          drag frame only re-renders this small subtree, never the whole Timeline.
          Rendered BEFORE the caption's own start/end resize handles below (in DOM/
          paint order) so those two always stay on top and clickable at the block's
          outer edges — a word's own click/drag region can coincide with the caption's
          own edge there (the caption's first/last word starts/ends exactly where the
          caption itself does), and the EXISTING caption-level resize must never be
          the thing that loses that fight. */}
      {isSelected && (
        <TimelineWordHandles
          subtitle={subtitle}
          blockWidth={w}
          pxPerSec={pxPerSec}
          selectedWordIndex={selectedWordIndex}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onSelectWord={onSelectWord}
          onCommitWordTiming={(index, start, end) => onCommitWordTiming(subtitle.id, index, start, end)}
        />
      )}
      <div
        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-accent/0 hover:bg-accent/60"
        onPointerDown={(e) => onStartDrag(e, subtitle.id, "start", subtitle.start, subtitle.end)}
      />
      {isActive && <span className="size-1.5 shrink-0 rounded-full bg-accent-cyan" aria-hidden />}
      <span className="truncate text-foreground">{subtitle.text.replace(/\n/g, " ")}</span>
      <div
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-accent/0 hover:bg-accent/60"
        onPointerDown={(e) => onStartDrag(e, subtitle.id, "end", subtitle.start, subtitle.end)}
      />
    </div>
  );
});

/**
 * Task 102741 (P15) — the SELECTED caption's own word-level interaction layer: click any word to
 * select + seek to it, and drag the SELECTED word's own start/end handles to retime it. Extracted
 * into its own component (same reasoning as captions-panel.tsx's WordChips) so a drag frame only
 * re-renders this small subtree, never the whole Timeline or every visible caption block.
 *
 * Drag model (spec §4/§12): unlike the caption-level drag above (which calls updateSubtitleTiming
 * — a commit — on every pointermove), this component keeps the in-progress drag in LOCAL state
 * only (`dragPreview`) and commits exactly ONCE, on pointer release, via `onCommitWordTiming` —
 * this task's own explicit "do not create a history entry on every pointer movement" requirement
 * for word drags specifically. The live preview position is still run through the SAME
 * authoritative `clampWordTiming` (word-timing.ts) on every move, so what's drawn during the drag
 * never shows an out-of-bounds position waiting to "snap back" only at commit time — no second,
 * looser validation rule invented for the preview.
 */
function TimelineWordHandles({
  subtitle,
  blockWidth,
  pxPerSec,
  selectedWordIndex,
  currentTime,
  isPlaying,
  onSelectWord,
  onCommitWordTiming,
}: {
  subtitle: Subtitle;
  /** The caption block's own rendered width in px (`w` in the parent) — ticks/handles outside
   * `[0, blockWidth]` are skipped, matching the pre-existing tick-rendering's own out-of-bounds
   * guard. */
  blockWidth: number;
  pxPerSec: number;
  selectedWordIndex: number | null;
  currentTime: number;
  isPlaying: boolean;
  onSelectWord: (index: number, startTime: number) => void;
  onCommitWordTiming: (index: number, start: number, end: number) => void;
}) {
  const [dragPreview, setDragPreview] = useState<{ index: number; start: number; end: number } | null>(null);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const dragRef = useRef<{
    index: number;
    edge: WordDragEdge;
    startX: number;
    captionStart: number;
    captionEnd: number;
    prevWordEnd: number | null;
    nextWordStart: number | null;
  } | null>(null);

  const segments = getRenderableWordSegments(subtitle);
  const blockLeftPx = timeToPixels(subtitle.start, pxPerSec);

  function startWordDrag(e: React.PointerEvent, index: number, edge: WordDragEdge) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const word = subtitle.words[index];
    // Task 117206 (P18.9): the snap-target proposal below must aim at this word's REAL
    // chronological neighbors, not array-adjacent ones — see findChronologicalWordNeighbors's own
    // doc comment. This is a PROPOSAL only (computeWordSnappedTiming); the authoritative clamp
    // (clampWordTiming, called fresh on every pointermove below) derives its own bounds
    // independently and can never be bypassed by a wrong snap target.
    const neighbors = findChronologicalWordNeighbors(subtitle.words, index);
    dragRef.current = {
      index,
      edge,
      startX: e.clientX,
      captionStart: subtitle.start,
      captionEnd: subtitle.end,
      prevWordEnd: neighbors.prevEnd,
      nextWordStart: neighbors.nextStart,
    };
    setDragPreview({ index, start: word.start, end: word.end });
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const word = subtitle.words[drag.index];
    const deltaSec = (e.clientX - drag.startX) / pxPerSec;
    const raw = (drag.edge === "start" ? word.start : word.end) + deltaSec;

    const snapThresholdSec = pixelsToTime(SNAP_THRESHOLD_PX, pxPerSec);
    const snapped = computeWordSnappedTiming(
      drag.edge,
      raw,
      { captionStart: drag.captionStart, captionEnd: drag.captionEnd, prevWordEnd: drag.prevWordEnd, nextWordStart: drag.nextWordStart, playhead: currentTime },
      snapThresholdSec,
    );

    // The SAME authoritative clamp updateWordTiming itself uses on commit — run here too so the
    // live preview is never out of bounds, and the eventual commit can never surprise the user
    // with a different result than what they saw while dragging.
    const clamped = clampWordTiming(subtitle, drag.index, drag.edge === "start" ? snapped.value : word.start, drag.edge === "end" ? snapped.value : word.end);
    if (!clamped) return;

    setDragPreview({ index: drag.index, start: clamped.start, end: clamped.end });
    setSnapGuide(snapped.snapped ? snapped.value : null);
  }

  function onPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    dragRef.current = null;
    setSnapGuide(null);
    setDragPreview((preview) => {
      const original = subtitle.words[drag.index];
      if (preview && (preview.start !== original.start || preview.end !== original.end)) {
        onCommitWordTiming(drag.index, preview.start, preview.end);
      }
      return null;
    });
  }

  const selected = selectedWordIndex !== null ? segments.find((seg) => seg.index === selectedWordIndex) : undefined;
  const previewStart = dragPreview && dragPreview.index === selectedWordIndex ? dragPreview.start : (selected?.word.start ?? null);
  const previewEnd = dragPreview && dragPreview.index === selectedWordIndex ? dragPreview.end : (selected?.word.end ?? null);
  const selectedLeft = previewStart !== null ? timeToPixels(previewStart, pxPerSec) - blockLeftPx : null;
  const selectedWidth = previewStart !== null && previewEnd !== null ? timeToPixels(previewEnd, pxPerSec) - timeToPixels(previewStart, pxPerSec) : null;

  // Task 100742 (P13) — the CURRENTLY PLAYING word, distinct from the manually SELECTED word
  // above (playback-highlight vs. manual-selection stay two independent concepts — spec §10:
  // clicking/dragging a word never touches this, and playback crossing a word boundary never
  // touches `selectedWordIndex`). Only computed while actually playing, and only drawn when it
  // differs from the selected word, exactly as before P15.
  const activeWordIdx = isPlaying ? findActiveWordIndex(subtitle.words, currentTime) : null;
  const active = activeWordIdx !== null && activeWordIdx !== selectedWordIndex ? segments.find((seg) => seg.index === activeWordIdx) : undefined;
  const activeLeft = active ? timeToPixels(active.word.start, pxPerSec) - blockLeftPx : null;
  const activeWidth = active ? timeToPixels(active.word.end, pxPerSec) - timeToPixels(active.word.start, pxPerSec) : null;

  return (
    <div className="absolute inset-0" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {selected && selectedLeft !== null && selectedWidth !== null && selectedLeft < blockWidth && selectedLeft + selectedWidth > 0 && (
        <div
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-sm bg-accent/25 ring-1 ring-inset ring-accent/50"
          style={{ left: Math.max(0, selectedLeft), width: Math.min(blockWidth, selectedLeft + selectedWidth) - Math.max(0, selectedLeft) }}
          aria-hidden
        />
      )}
      {active && activeLeft !== null && activeWidth !== null && activeLeft < blockWidth && activeLeft + activeWidth > 0 && (
        <div
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-sm bg-accent-cyan/20 ring-1 ring-inset ring-accent-cyan/50"
          style={{ left: Math.max(0, activeLeft), width: Math.min(blockWidth, activeLeft + activeWidth) - Math.max(0, activeLeft) }}
          aria-hidden
        />
      )}
      {/* Tick marks (unchanged visual from P7.2) — the first boundary coincides with the block's
          own left edge, so index 0 is skipped, same as before P15. */}
      {segments.map(({ index, word }) => {
        if (index === 0) return null;
        const tickLeft = timeToPixels(word.start, pxPerSec) - blockLeftPx;
        if (tickLeft <= 0 || tickLeft >= blockWidth) return null;
        return <div key={index} className="pointer-events-none absolute top-1 bottom-1 w-px bg-foreground/25" style={{ left: tickLeft }} aria-hidden />;
      })}
      {/* Click-to-seek regions (Task 102741, P15 spec §3) — one per renderable word, spanning its
          own [start, end). stopPropagation on pointerdown so a click here never also starts the
          caption's own move-drag (see the parent block's own onPointerDown). A small (2px)
          inset from each end keeps this from swallowing the caption's own start/end resize
          handles even though those are painted after this component (see this component's own
          call site comment) — belt and suspenders, not load-bearing on its own. */}
      {segments.map(({ index, word }) => {
        const left = timeToPixels(word.start, pxPerSec) - blockLeftPx;
        const right = timeToPixels(word.end, pxPerSec) - blockLeftPx;
        const clippedLeft = Math.max(0, left);
        const clippedRight = Math.min(blockWidth, right);
        if (clippedRight - clippedLeft <= 0) return null;
        return (
          <div
            key={index}
            className="absolute top-0 bottom-0 cursor-pointer"
            style={{ left: clippedLeft, width: clippedRight - clippedLeft }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectWord(index, word.start);
            }}
          />
        );
      })}
      {/* Start/end drag handles — only for the SELECTED word (spec §4: "for the selected word,
          provide a start/end boundary handle"), positioned at the LIVE preview position while a
          drag is in progress so the handle itself visually tracks the pointer, not just the
          highlight region above. */}
      {selected && selectedLeft !== null && (
        <div
          className="absolute top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-ew-resize bg-accent/0 hover:bg-accent"
          style={{ left: selectedLeft }}
          onPointerDown={(e) => startWordDrag(e, selected.index, "start")}
          title="Drag to adjust this word's start"
        />
      )}
      {selected && selectedLeft !== null && selectedWidth !== null && (
        <div
          className="absolute top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-ew-resize bg-accent/0 hover:bg-accent"
          style={{ left: selectedLeft + selectedWidth }}
          onPointerDown={(e) => startWordDrag(e, selected.index, "end")}
          title="Drag to adjust this word's end"
        />
      )}
      {snapGuide !== null && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-warning shadow-[0_0_4px_1px_rgba(234,179,8,0.6)]"
          style={{ left: timeToPixels(snapGuide, pxPerSec) - blockLeftPx }}
        />
      )}
    </div>
  );
}
