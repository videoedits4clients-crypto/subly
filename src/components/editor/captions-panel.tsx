"use client";

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { ChevronUp, ChevronDown, Captions, AlertTriangle, ShieldAlert } from "lucide-react";
import { useEditorStore } from "@/store/editor-store";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { formatTime, cn } from "@/lib/utils";
import { computeVisibleRange, computeScrollTargetForIndex } from "@/lib/timeline/list-virtualization";
import { isWordTimingStale, getRenderableWordSegments, findChronologicalWordNeighbors } from "@/lib/subtitles/word-timing";
import { applyOutputModeToWords, isDerivedWordTextStale, type DerivedCaptionOutputMode } from "@/lib/subtitles/output-mode";
import { findActiveWordIndex } from "@/lib/subtitles/playback-context";
import { classifyWordConfidence } from "@/lib/subtitles/word-confidence";
import { computeBatchTextTransform, type TextTransformKind } from "@/lib/subtitles/batch-text-ops";
import { TextCleanupDialog } from "./text-cleanup-dialog";
import { WordTimingPopover } from "./word-timing-popover";
import type { Word, CaptionOutputMode, SubtitleStyle } from "@/types/subtitle";
import { resolveStyle } from "@/types/subtitle";
import { hasOwnLook } from "@/lib/edit-scope";
import { toast } from "sonner";

const TRANSFORM_LABELS: Record<TextTransformKind, string> = {
  uppercase: "UPPERCASE",
  lowercase: "lowercase",
  titlecase: "Title Case",
};

/**
 * Windowed rendering for large caption lists (see research/p2_editor_performance_scalability_report.md).
 * Measured: mounting every CaptionRow unconditionally took ~340ms at 300 captions, ~880ms at
 * 1,800, ~1.3s at 3,600, and ~1.6s at 5,400 — a real, user-visible "editor feels slow to open"
 * delay that scales with caption count, confirmed via performance.mark instrumentation around
 * the actual mount (not a guess). Below VIRTUALIZE_THRESHOLD this is skipped entirely — small/
 * typical projects (the common case) keep the exact same plain `.map()` over every caption,
 * unchanged from before. The windowing math itself lives in lib/timeline/list-virtualization.ts
 * so it's unit-testable without React/DOM.
 *
 * ROW_HEIGHT_ESTIMATE is measured against this panel's own real rendered row (81px row + the
 * list's own 8px `gap-2`) — used only to decide which rows to mount, never to size anything
 * visually. A caption whose text wraps past 2 lines renders slightly taller than this estimate;
 * normal document flow absorbs that exactly like any fixed/estimated-row-height virtualized
 * list does — a well-known, accepted tradeoff, not a correctness bug (nothing here assumes
 * uniform height for anything other than *approximately* which rows are near the viewport).
 */
const ROW_HEIGHT_ESTIMATE = 89;
const OVERSCAN_ROWS = 10;
const VIRTUALIZE_THRESHOLD = 150;

/** Stable (never-reallocated) fallback for when there's no project yet — using `[]` inline
 * would create a brand-new array reference on every render, which would defeat useMemo's
 * dependency check below even though there's nothing to memoize yet. */
const EMPTY_SUBTITLES: never[] = [];

export function CaptionsPanel() {
  const project = useEditorStore((s) => s.project);
  const selectedId = useEditorStore((s) => s.selectedSubtitleId);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const selectSubtitle = useEditorStore((s) => s.selectSubtitle);
  const toggleSubtitleSelection = useEditorStore((s) => s.toggleSubtitleSelection);
  const selectSubtitleRange = useEditorStore((s) => s.selectSubtitleRange);
  const deleteSubtitles = useEditorStore((s) => s.deleteSubtitles);
  const applyBatchTextTransform = useEditorStore((s) => s.applyBatchTextTransform);
  const [pendingTransform, setPendingTransform] = useState<TextTransformKind | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const seek = useEditorStore((s) => s.seek);
  const updateText = useEditorStore((s) => s.updateSubtitleText);
  const updateHinglishText = useEditorStore((s) => s.updateSubtitleHinglishText);
  const updateGujaratiScriptText = useEditorStore((s) => s.updateSubtitleGujaratiScriptText);
  const focusCaptionRequest = useEditorStore((s) => s.focusCaptionRequest);
  const selectedWordIndex = useEditorStore((s) => s.selectedWordIndex);
  const selectWord = useEditorStore((s) => s.selectWord);
  const updateWordTiming = useEditorStore((s) => s.updateWordTiming);
  const rebuildWordTiming = useEditorStore((s) => s.rebuildWordTiming);
  const splitWord = useEditorStore((s) => s.splitWord);
  const mergeWordWithNext = useEditorStore((s) => s.mergeWordWithNext);
  const deleteWord = useEditorStore((s) => s.deleteWord);
  const insertWord = useEditorStore((s) => s.insertWord);
  const regenerateDerivedWordText = useEditorStore((s) => s.regenerateDerivedWordText);
  // Task 110184 (P18.3) — already `(subtitleId, wordIndex, patch) => void`, same id-first shape
  // as updateWordTiming/splitWord/etc. above, so it's passed straight through to CaptionRow
  // unwrapped (see that prop's own doc comment for why that's safe under P18.2's memoization).
  const setWordStyleOverride = useEditorStore((s) => s.setWordStyleOverride);
  // Task 113528 (P18.6) — already `(subtitleId, fromIndex, toIndex) => WordReorderStoreResult`,
  // same id-first shape, same unwrapped-passthrough pattern.
  const reorderWord = useEditorStore((s) => s.reorderWord);
  const qualityReport = useEditorStore((s) => s.qualityReport);
  const qualityIssueIndex = useEditorStore((s) => s.qualityIssueIndex);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const obs = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Task 109431 (P18.2) — STABLE, id-parameterized row handlers, defined exactly ONCE per
  // CaptionsPanel instance (never recreated per row, never recreated on an unrelated edit).
  // `React.memo(CaptionRow)` (below) already existed, but every one of the 11 callback props
  // passed into it used to be a brand-new inline arrow function created fresh inside the
  // `visibleSubtitles.map()` call on EVERY CaptionsPanel render — memo()'s shallow prop
  // comparison sees a new function reference on every render regardless of whether THIS row's
  // own data changed, so a single edit anywhere in the project re-rendered every mounted row
  // (see research/p18_professional_editor_preflight_report.md §3 item 30 / §10, the P18
  // preflight audit finding this task fixes).
  //
  // The fix: give every callback an `(id, ...)` signature instead of a closure baked around one
  // specific caption, and define each ONE time via `useCallback` whose OWN dependencies are
  // themselves permanently stable — every store action below (`selectSubtitle`, `seek`,
  // `updateWordTiming`, etc.) is a Zustand action reference that never changes across the
  // store's lifetime (defined once inside `create<EditorState>(...)`, never reassigned by any
  // `set()` call — confirmed directly: `useEditorStore.getState()` returns the identical action
  // object on every call). A `useCallback` whose dependency array never actually changes value
  // returns the SAME function reference forever, by React's own useCallback contract — nothing
  // new is being proven about React here, only that this component now actually FEEDS it stable
  // inputs. Several of the store's own actions (`updateWordTiming`, `rebuildWordTiming`,
  // `splitWord`, `mergeWordWithNext`, `deleteWord`, `insertWord`, `regenerateDerivedWordText`)
  // already take the caption id as their own first argument — those are passed straight through
  // to CaptionRow with NO wrapping at all, since they're already exactly the stable, id-first
  // shape this fix needs. Only the four callbacks that combine a store action with OTHER
  // per-call context (which mode is active, which word's start time to seek to) need an actual
  // wrapper — each one reads that context FRESH via `useEditorStore.getState()` at call time
  // rather than closing over a render-time snapshot, so it can never go stale between renders
  // (the standard, documented Zustand pattern for "read current state inside a handler without
  // subscribing to it").
  const handleRowFocus = useCallback(
    (id: string) => {
      const sub = useEditorStore.getState().project?.subtitles.find((s) => s.id === id);
      selectSubtitle(id);
      if (sub) seek(sub.start);
    },
    [selectSubtitle, seek],
  );
  const handleMultiSelectClick = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) selectSubtitleRange(id);
      else toggleSubtitleSelection(id);
    },
    [selectSubtitleRange, toggleSubtitleSelection],
  );
  const handleRowChange = useCallback(
    (id: string, text: string) => {
      const mode = useEditorStore.getState().project?.captionOutputMode;
      if (mode === "hinglish") updateHinglishText(id, text);
      else if (mode === "gujarati-script") updateGujaratiScriptText(id, text);
      else updateText(id, text);
    },
    [updateHinglishText, updateGujaratiScriptText, updateText],
  );
  const handleSelectWord = useCallback(
    (id: string, index: number | null) => {
      selectWord(index);
      if (index === null) return;
      const sub = useEditorStore.getState().project?.subtitles.find((s) => s.id === id);
      const word = sub?.words[index];
      if (word) seek(word.start);
    },
    [selectWord, seek],
  );

  const subtitles = project?.subtitles ?? EMPTY_SUBTITLES;
  const totalCount = subtitles.length;
  const { startIndex, endIndex, virtualized } = computeVisibleRange(
    totalCount,
    scrollTop,
    viewportHeight,
    ROW_HEIGHT_ESTIMATE,
    OVERSCAN_ROWS,
    VIRTUALIZE_THRESHOLD,
  );

  const visibleSubtitles = useMemo(() => subtitles.slice(startIndex, endIndex), [subtitles, startIndex, endIndex]);
  const topSpacerHeight = startIndex * ROW_HEIGHT_ESTIMATE;
  const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * ROW_HEIGHT_ESTIMATE);

  /** Scrolls a caption into view given only its index — works even when the row isn't
   * currently mounted (virtualized out), unlike scrollIntoView, which needs the node to
   * already exist. Used as a fallback by both effects below for the case where keyboard nav,
   * Tab, or search jumps to a caption outside the current window. */
  const scrollIndexIntoView = useCallback((index: number) => {
    const el = listRef.current;
    if (!el) return;
    const next = computeScrollTargetForIndex(index, ROW_HEIGHT_ESTIMATE, el.scrollTop, el.clientHeight);
    if (next === null) return;
    // Set BOTH the real DOM scroll position (so the scrollbar visibly moves) AND the React
    // `scrollTop` state directly (so the visible-range calculation re-renders immediately) —
    // a programmatic `element.scrollTop = ...` assignment doesn't reliably fire a native
    // "scroll" event synchronously/promptly in every environment, and this effect's whole
    // purpose is to bring an off-window row into the rendered range, so it must not depend on
    // that event actually arriving.
    el.scrollTop = next;
    setScrollTop(next);
  }, []);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-sub-id="${selectedId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      // Task 99261 (P12): the jump uses ROW_HEIGHT_ESTIMATE, which is only approximate (see its
      // own doc comment) — a caption with extra content (e.g. a stale-word-timing warning row)
      // renders taller than the estimate, and that drift compounds over a long list, so a jump
      // to a target deep into a 1,800+/5,400-caption project (e.g. quality-issue review landing
      // on the very last caption) could land the target just outside the visible viewport even
      // though it's now mounted (confirmed live during this task's own QA — off by about one
      // row height at caption 199 of a 199-caption list). Once the estimate-based jump has
      // actually mounted the row (next paint), the SAME rAF-retry shape the focusCaptionRequest
      // effect below already uses corrects this with the real, now-measurable DOM position.
      scrollIndexIntoView(subtitles.findIndex((s) => s.id === selectedId));
      requestAnimationFrame(() => {
        const retryEl = listRef.current?.querySelector(`[data-sub-id="${selectedId}"]`);
        retryEl?.scrollIntoView({ block: "nearest" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Fulfills Tab/Shift+Tab's "move focus to the next caption" (see
  // hooks/use-keyboard-shortcuts.ts) — an effect, not a `requestAnimationFrame` DOM query
  // from outside React, so it only ever runs once this component has actually re-rendered
  // with the new selection (React guarantees an effect's DOM is up to date, requestAnimationFrame
  // does not). Keyed on the token, not just the id, so re-requesting the same caption still fires.
  useEffect(() => {
    if (!focusCaptionRequest) return;
    const el = listRef.current?.querySelector(`[data-sub-id="${focusCaptionRequest.id}"] textarea`) as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      el.select();
      return;
    }
    // Not currently mounted (virtualized out) — jump the scroll position to where it will
    // mount, then pick it up on the next paint once React has actually committed the row.
    scrollIndexIntoView(subtitles.findIndex((s) => s.id === focusCaptionRequest.id));
    requestAnimationFrame(() => {
      const retryEl = listRef.current?.querySelector(`[data-sub-id="${focusCaptionRequest.id}"] textarea`) as HTMLTextAreaElement | null;
      retryEl?.focus();
      retryEl?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCaptionRequest?.token]);

  // Pure preview (see lib/subtitles/batch-text-ops.ts) for whichever transform is pending
  // confirmation (Task 97025, P10) — never mutates the project; only applyBatchTextTransform
  // (called from confirmTransform below) does that, and only once the user explicitly confirms.
  // Declared before the early return below, like every other hook in this component must be.
  const transformPreview = useMemo(() => {
    if (!pendingTransform || !project) return null;
    return computeBatchTextTransform(project.subtitles, selectedIds, pendingTransform);
  }, [pendingTransform, project, selectedIds]);

  if (!project) return null;

  function goToCaption(delta: 1 | -1) {
    if (!project) return;
    const subtitles = project.subtitles;
    if (!subtitles.length) return;
    const currentIndex = selectedId
      ? subtitles.findIndex((s) => s.id === selectedId)
      : subtitles.findIndex((s) => useEditorStore.getState().currentTime < s.end);
    const nextIndex = Math.max(0, Math.min(subtitles.length - 1, (currentIndex === -1 ? 0 : currentIndex) + delta));
    const target = subtitles[nextIndex];
    selectSubtitle(target.id);
    seek(target.start);
  }

  const isHinglish = project.captionOutputMode === "hinglish";
  const isGujaratiScript = project.captionOutputMode === "gujarati-script";
  // Current-quality-issue indicator (Task 93471, P7.3) — uses ONLY the existing qualityReport/
  // qualityIssueIndex as the canonical source (see editor-store.ts's own doc comments on
  // qualityIssueIndex being the ONE shared cursor every nav entry point already uses); no second
  // issue-state model. Only set once the user has actually navigated to a specific issue
  // (qualityIssueIndex !== null) — before that, nothing is marked "current" (matches the top bar/
  // dialog's own "nothing navigated yet" convention, where the 0-index display fallback is just
  // a DISPLAY default, not a real "this is the current issue" fact).
  const currentIssueCaptionId = qualityIssueIndex !== null ? (qualityReport?.issues[qualityIssueIndex]?.captionId ?? null) : null;

  // Task 94820 (P8): "3 captions selected" indicator + the batch actions that make sense to
  // surface right here (Clear / Delete / — Task 97025 P10 adds Transform) — deliberately NOT a
  // new toolbar, just this same header bar's existing right-aligned button row, which already
  // holds the prev/next buttons. Delete/Clear stay scoped to an actual multi-selection (size > 1,
  // unchanged from P8 — a single caption already has its own Delete key/toolbar button). Transform
  // (and the Ctrl+H batch Find & Replace dialog) are available from size 1 upward, per this
  // task's own "the same operation should be reusable for multiple captions" requirement — the
  // selection-count label reflects that too.
  const hasSelection = selectedIds.size >= 1;
  const isBatchSelection = selectedIds.size > 1;

  function confirmTransform() {
    if (!pendingTransform) return;
    const result = applyBatchTextTransform(Array.from(selectedIds), pendingTransform);
    if (result.affectedCount === 0) {
      toast.info("No change — the transform had no effect on the selected caption(s).");
    } else {
      toast.success(
        `Applied ${TRANSFORM_LABELS[pendingTransform]} to ${result.affectedCount} caption${result.affectedCount === 1 ? "" : "s"}.` +
          (result.staleCount > 0 ? ` ${result.staleCount} will need a word-timing review.` : ""),
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        {hasSelection ? (
          <span className="text-xs font-medium text-accent">
            {selectedIds.size} caption{selectedIds.size === 1 ? "" : "s"} selected
          </span>
        ) : (
          <span className="text-xs text-muted-2">
            ↑/↓ to navigate · Tab to move while editing · Ctrl+click / Shift+click to select multiple
          </span>
        )}
        <div className="flex gap-1">
          {hasSelection ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Apply a deterministic text transform to the selected caption(s)">
                    Transform
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(TRANSFORM_LABELS) as TextTransformKind[]).map((kind) => (
                    <DropdownMenuItem key={kind} onClick={() => setPendingTransform(kind)}>
                      {TRANSFORM_LABELS[kind]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setCleanupOpen(true)}
                title="Batch text cleanup — whitespace, punctuation, capitalization, blank captions"
              >
                Cleanup
              </Button>
              {isBatchSelection && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-danger"
                    onClick={() => deleteSubtitles(Array.from(selectedIds))}
                    title="Delete all selected captions — Delete/Backspace"
                  >
                    Delete {selectedIds.size}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => selectSubtitle(null)}
                    title="Clear selection — Escape"
                  >
                    Clear
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon-sm" onClick={() => goToCaption(-1)} title="Previous caption (↑)">
                <ChevronUp className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => goToCaption(1)} title="Next caption (↓)">
                <ChevronDown className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      <div
        ref={listRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-3"
        onScroll={virtualized ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
      >
        {project.subtitles.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Captions className="size-6 text-muted-2" />
            <p className="text-sm font-medium">No captions yet</p>
            <p className="max-w-[220px] text-xs text-muted-2">
              No speech was detected, or every caption was removed. Re-import the video to transcribe it again.
            </p>
          </div>
        )}
        {virtualized && topSpacerHeight > 0 && <div style={{ height: topSpacerHeight, flexShrink: 0 }} aria-hidden />}
        {visibleSubtitles.map((s) => {
          // In "hinglish"/"gujarati-script" mode, edit the derived text directly — never
          // the original transcript (see lib/subtitles/output-mode.ts). Falls back to the
          // original when a caption hasn't been generated yet (shouldn't normally happen,
          // since switching modes generates it for every caption up front, but a caption
          // added afterwards — e.g. by splitting — could still be missing it).
          const displayText = isHinglish
            ? (s.hinglishText ?? s.text)
            : isGujaratiScript
              ? (s.gujaratiScriptText ?? s.text)
              : s.text;
          // Task 106284 (P17.1) — computed here (not inside CaptionRow) because it needs the RAW
          // `s.hinglishText`/`s.gujaratiScriptText` caption-level field, distinct from `displayText`
          // above (which already falls back to `s.text` when ungenerated — a fallback that would
          // hide the "pending-generation" vs "word-count-mismatch" distinction
          // getDerivedWordTextSyncStatus itself needs to make). A no-op (`false`) in Original mode.
          const derivedWordTextStale = isHinglish ? isDerivedWordTextStale(s, "hinglish") : isGujaratiScript ? isDerivedWordTextStale(s, "gujarati-script") : false;
          const isSelected = s.id === selectedId;
          const isMultiSelected = selectedIds.has(s.id);
          return (
            <CaptionRow
              key={s.id}
              id={s.id}
              text={displayText}
              start={s.start}
              end={s.end}
              isSelected={isSelected}
              isMultiSelected={isMultiSelected}
              hasOwnLook={hasOwnLook(s)}
              isCurrentQualityIssue={s.id === currentIssueCaptionId}
              // Word-level detail (Task 92618, P7.2) is only ever computed/rendered for the
              // selected caption — every other row gets `null`, so the per-word inspector never
              // costs anything for the other captions in a large project (see this file's own
              // ROW_HEIGHT_ESTIMATE doc comment on why per-row cost matters here).
              //
              // Task 105631 (P17): word chips are now shown in EVERY display mode, not just
              // "original" — see lib/subtitles/caption-display-mode.ts's own top-of-file doc
              // comment for the audit this is based on (word selection + timing adjustment are
              // already proven safe in any mode by the timeline's own, unconditional
              // TimelineWordHandles). `applyOutputModeToWords` swaps each word's `.text` for its
              // own `hinglishText`/`gujaratiScriptText` for DISPLAY only — same word count, same
              // order, same timestamps, so every index below still refers to the exact same real
              // word in the store; only `.text` differs from `s.words` itself.
              //
              // Task 106284 (P17.1): Merge/Delete are now available in every mode too (Split/
              // Insert stay Original-only) — `displayMode` alone is threaded down to WordChips/
              // WordTimingPopover, which derive the full per-operation capability row themselves
              // (lib/subtitles/caption-display-mode.ts) rather than this file computing it twice.
              words={isSelected ? applyOutputModeToWords(s.words, project.captionOutputMode) : null}
              // Task 110184 (P18.3) — same "selected row only" gate as `words` above: the word
              // style popover only needs the caption's resolved style while it can actually be
              // opened, so an unrelated row never pays resolveStyle's cost.
              captionStyle={isSelected ? resolveStyle(project, s) : null}
              selectedWordIndex={isSelected ? selectedWordIndex : null}
              displayMode={project.captionOutputMode}
              derivedWordTextStale={derivedWordTextStale}
              // Task 109431 (P18.2) — every callback below is now a STABLE reference (either one
              // of the four handlers defined once above via useCallback, or a store action passed
              // straight through unwrapped — see the handlers' own doc comment for exactly why
              // each one is safe to pass directly). None of these is a per-row closure created by
              // this `.map()` anymore, so `React.memo(CaptionRow)`'s shallow prop comparison can
              // now actually tell an unrelated caption's row apart from one that changed.
              onFocus={handleRowFocus}
              onMultiSelectClick={handleMultiSelectClick}
              onChange={handleRowChange}
              onSelectWord={handleSelectWord}
              onUpdateWordTiming={updateWordTiming}
              onRebuildWordTiming={rebuildWordTiming}
              onSplitWord={splitWord}
              onMergeWordWithNext={mergeWordWithNext}
              onDeleteWord={deleteWord}
              onInsertWord={insertWord}
              onRegenerateDerivedWordText={regenerateDerivedWordText}
              onSetWordStyle={setWordStyleOverride}
              onReorderWord={reorderWord}
            />
          );
        })}
        {virtualized && bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight, flexShrink: 0 }} aria-hidden />}
      </div>

      {/* Task 97025 (P10): reuses the existing generic ConfirmDialog (see
          components/ui/confirm-dialog.tsx) rather than a bespoke transform dialog — "prefer a
          compact dialog... do not create a giant new editor panel." The preview (transformPreview)
          is computed purely, before this even opens, so nothing is written until Confirm. */}
      <ConfirmDialog
        open={pendingTransform !== null}
        onOpenChange={(v) => !v && setPendingTransform(null)}
        title={pendingTransform ? `Apply ${TRANSFORM_LABELS[pendingTransform]}?` : ""}
        description={
          pendingTransform && transformPreview
            ? `${TRANSFORM_LABELS[pendingTransform]} will be applied to ${transformPreview.textById.size} of ${selectedIds.size} selected caption${selectedIds.size === 1 ? "" : "s"}.` +
              (transformPreview.staleIds.size > 0
                ? ` ${transformPreview.staleIds.size} will require word-timing review — the transform changes the number of words there, so the existing timestamps can't be reused.`
                : "")
            : ""
        }
        confirmLabel={transformPreview && transformPreview.staleIds.size > 0 ? "Apply and mark timing stale" : "Apply"}
        confirmVariant="accent"
        onConfirm={confirmTransform}
      />

      {/* Task 98134 (P11) — its own dialog (not ConfirmDialog): needs a checklist of toggles plus
          a rich before/after preview, which the generic single-description ConfirmDialog can't
          express. Still just one more compact dialog in the same family, not a new panel. */}
      <TextCleanupDialog open={cleanupOpen} onOpenChange={setCleanupOpen} />
    </div>
  );
}

const CaptionRow = memo(function CaptionRow({
  id,
  text,
  start,
  end,
  isSelected,
  isMultiSelected,
  hasOwnLook: ownLook,
  isCurrentQualityIssue,
  words,
  captionStyle,
  selectedWordIndex,
  displayMode,
  derivedWordTextStale,
  onFocus,
  onMultiSelectClick,
  onChange,
  onSelectWord,
  onUpdateWordTiming,
  onRebuildWordTiming,
  onSplitWord,
  onMergeWordWithNext,
  onDeleteWord,
  onInsertWord,
  onRegenerateDerivedWordText,
  onSetWordStyle,
  onReorderWord,
}: {
  id: string;
  text: string;
  start: number;
  end: number;
  isSelected: boolean;
  /** True when this caption is part of the active multi-selection (Task 94820, P8) — a superset
   * of `isSelected` (the focused caption is always a member of it too, see editor-store.ts's own
   * `selectedSubtitleIds` doc comment). Used only for styling: `isSelected` alone still decides
   * everything about word-level detail/editing, so the focused caption keeps looking distinct
   * from the rest of the batch, per this task's own requirement. */
  isMultiSelected: boolean;
  /** P23: the caption carries its own style and/or animation override (shown as a "Custom look" tag). */
  hasOwnLook: boolean;
  /** True when this is the caption the shared qualityIssueIndex cursor currently points at
   * (Task 93471, P7.3) — a subtle indicator distinct from ordinary caption selection, since a
   * caption can be selected for entirely unrelated reasons (the user just clicked it) without
   * being "the current quality issue." */
  isCurrentQualityIssue: boolean;
  /** Null when word-level detail shouldn't render for this row at all (not selected — see the
   * parent's own comment; Task 105631/P17 removed the old "only in Original mode" restriction). */
  words: Word[] | null;
  /** Task 110184 (P18.3) — this caption's fully-resolved style (null when this row isn't
   * selected, matching `words`'s own gate above), threaded down to WordTimingPopover so it can
   * show a word's EFFECTIVE Bold state (word override, else inherited from caption style). Never
   * written to here — read-only context for the popover's own resolveEffectiveWordStyleValue. */
  captionStyle: SubtitleStyle | null;
  selectedWordIndex: number | null;
  /** Task 105631 (P17) — the project's current caption display mode, so this row can decide
   * whether "Rebuild timing" makes sense to offer (it always rebuilds from the ORIGINAL `text`,
   * regardless of what's displayed — see editor-store.ts rebuildWordTiming — so offering it while
   * viewing a derived mode would silently rebuild against a DIFFERENT text than what's on screen;
   * shown Original-only, with a small explanation in derived modes instead). */
  displayMode: CaptionOutputMode;
  /** Task 106284 (P17.1) — true when this caption's per-word derived text (for the CURRENT
   * `displayMode`, which must then be "hinglish" or "gujarati-script") no longer reconstructs its
   * own caption-level derived text — see lib/subtitles/output-mode.ts isDerivedWordTextStale.
   * Always `false` in Original mode. Distinct from `isWordTimingStale` (word-timing.ts) — the two
   * are never conflated into one banner. */
  derivedWordTextStale: boolean;
  /** Task 109431 (P18.2) — every callback below now takes this row's own `id` as its first
   * argument instead of being a closure the parent recreates per row on every render (see
   * CaptionsPanel's own handler-definition comment for the full reasoning). Several are the
   * store's own actions passed straight through unwrapped (they already have exactly this
   * `(id, ...)` shape), so their doc comments below point at editor-store.ts rather than
   * repeating it. */
  onFocus: (id: string) => void;
  /** Ctrl/Cmd-click (shiftKey=false) or Shift-click (shiftKey=true) on this row (Task 94820,
   * P8) — fired from a `pointerdown` BEFORE the browser would otherwise focus the textarea (see
   * the wrapper div's own onPointerDown below), so a modifier-click toggles/ranges the selection
   * without also moving text-edit focus into this caption. */
  onMultiSelectClick: (id: string, shiftKey: boolean) => void;
  onChange: (id: string, text: string) => void;
  onSelectWord: (id: string, index: number | null) => void;
  /** editor-store.ts's `updateWordTiming` action, passed through directly — already `(subtitleId,
   * wordIndex, start, end) => void`. */
  onUpdateWordTiming: (id: string, index: number, start: number, end: number) => void;
  /** editor-store.ts's `rebuildWordTiming` action, passed through directly. */
  onRebuildWordTiming: (id: string) => void;
  /** editor-store.ts's `splitWord` action, passed through directly — see
   * lib/subtitles/word-edit.ts for the actual split mechanics. */
  onSplitWord: (id: string, index: number, leftText: string, rightText: string) => boolean;
  /** editor-store.ts's `mergeWordWithNext` action, passed through directly. */
  onMergeWordWithNext: (id: string, index: number) => void;
  /** editor-store.ts's `deleteWord` action, passed through directly. */
  onDeleteWord: (id: string, index: number) => void;
  /** editor-store.ts's `insertWord` action, passed through directly — see
   * lib/subtitles/word-edit.ts for the actual insertion mechanics. */
  onInsertWord: (id: string, index: number, side: "before" | "after", text: string) => boolean;
  /** editor-store.ts's `regenerateDerivedWordText` action, passed through directly — see
   * lib/subtitles/output-mode.ts regenerateHinglishForSubtitle/regenerateGujaratiScriptForSubtitle.
   * Returns `false` (no commit) when the caption wasn't actually stale for that mode. */
  onRegenerateDerivedWordText: (id: string, mode: DerivedCaptionOutputMode) => boolean;
  /** editor-store.ts's `setWordStyleOverride` action, passed through directly — already
   * `(subtitleId, wordIndex, patch) => void` (Task 110184, P18.3). */
  onSetWordStyle: (id: string, index: number, patch: Partial<SubtitleStyle> | null) => void;
  /** editor-store.ts's `reorderWord` action, passed through directly — already `(subtitleId,
   * fromIndex, toIndex) => WordReorderStoreResult` (Task 113528, P18.6). */
  onReorderWord: (id: string, fromIndex: number, toIndex: number) => "ok" | "invalid-index" | "noop" | "not-found";
}) {
  const [value, setValue] = useState(text);
  const [lastText, setLastText] = useState(text);
  if (text !== lastText) {
    setLastText(text);
    setValue(text);
  }

  const stale = words !== null && words.length > 0 && isWordTimingStale({ text, words });
  const segments = words !== null && words.length > 0 && !stale ? getRenderableWordSegments({ words }) : [];

  return (
    <div
      data-sub-id={id}
      onPointerDown={(e) => {
        // Task 94820 (P8): a Ctrl/Cmd/Shift-click means "adjust the selection," not "start
        // editing this caption's text" — preventDefault here stops the click from ever focusing
        // the Textarea below (which would otherwise fire onFocus and collapse the multi-selection
        // right back down to one caption via the ordinary selectSubtitle path). An unmodified
        // click is untouched: it falls through to the Textarea's own onFocus exactly as before.
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          // A DIFFERENT caption's textarea can still hold DOM focus from an earlier plain click
          // (preventDefault above only stops THIS click from moving focus, it doesn't touch
          // whatever already had it) — left alone, every keyboard shortcut guarded by
          // isTypingTarget (use-keyboard-shortcuts.ts), including the new batch Delete/Alt+←→/
          // Ctrl+A, would silently no-op right after a multi-select click. Confirmed live during
          // this task's own QA. Blurring here matches what a user would expect anyway: clicking
          // away to build a selection should end text editing, not silently leave it active.
          (document.activeElement as HTMLElement | null)?.blur?.();
          onMultiSelectClick(id, e.shiftKey);
        }
      }}
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        isSelected
          ? "border-accent bg-accent-soft"
          : isMultiSelected
            ? "border-accent/50 bg-accent-soft/50"
            : "border-border bg-surface-2 hover:border-border-strong",
      )}
    >
      <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-2">
        {formatTime(start)} → {formatTime(end)}
        {/* Task 100742 (P13) — compact START/END/DURATION context (objective 4), scoped to the
            SELECTED row only: every row already shows start→end, so duration is the one value
            actually missing, and showing it only when selected keeps a long virtualized list
            just as compact as before instead of adding a third number to every row. */}
        {isSelected && <span className="text-muted-2/80">· Duration: {(end - start).toFixed(3)}s</span>}
        {ownLook && (
          <span
            className="rounded-sm bg-accent-soft px-1 py-0.5 font-sans text-accent"
            title="This caption has its own style or animation, so changes to the project look don't reach it. Reset it from the Style or Animation tab."
          >
            Custom look
          </span>
        )}
        {isCurrentQualityIssue && (
          <span
            className="flex items-center gap-0.5 rounded-sm bg-warning/15 px-1 py-0.5 font-sans text-warning"
            title="This caption is the current quality issue (see the quality-check navigation in the top bar or Settings tab)"
          >
            <ShieldAlert className="size-2.5" /> Current issue
          </span>
        )}
      </p>
      <Textarea
        value={value}
        onFocus={() => onFocus(id)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== text && onChange(id, value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          // Task 143208 (P19.15): without this, Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z here falls through
          // to the BROWSER'S OWN native per-field text undo (this textarea's own uncommitted
          // keystroke history) instead of ever reaching use-keyboard-shortcuts.ts's global
          // undo()/redo() — that global handler deliberately skips every shortcut, including
          // undo/redo, while focus is in a typing target (isTypingTarget), specifically to avoid
          // clobbering in-progress typing (see its own doc comment). Native undo mutates the
          // textarea's raw DOM value without going through this component's `onChange`, so it
          // never reaches the store: it visibly "looks like" undo happened, but nothing was ever
          // committed, autosaved, or added to the app's own undo history — confirmed live
          // (research/p19_15_undo_redo_persistence_fix_report.md) as the actual cause of a P1
          // "undo doesn't persist" report, not a defect in commit()/undo()/redo()/use-autosave.ts
          // themselves (both proven correct by that report's own regression tests). Committing
          // any pending edit first (the same onBlur path above) and then calling the real store
          // undo()/redo() directly makes Ctrl+Z/Ctrl+Shift+Z always mean the same thing
          // everywhere in the app, with no invisible, autosave-bypassing native fallback — and
          // committing first (rather than discarding the pending edit) keeps the original
          // isTypingTarget fix's own guarantee: undo/redo here only ever act on content the user
          // just saw change, never silently reach across to an unrelated caption.
          const meta = e.ctrlKey || e.metaKey;
          if (meta && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (value !== text) onChange(id, value);
            if (e.shiftKey) useEditorStore.getState().redo();
            else useEditorStore.getState().undo();
          }
        }}
        rows={2}
        className="min-h-0 border-none bg-transparent p-0 text-sm focus-visible:ring-0"
      />

      {/* Word-level inspector (Task 92618, P7.2) — only for the selected caption's own row
          (words is null otherwise, see the parent map). Distinct "no timing" (nothing rendered
          at all — see hasWordTiming's own doc comment) / "stale, needs review" / "normal word
          chips" states, per the task's own "clearly treat captions with no word-level timing as
          such" and "surface a clear non-blocking warning" requirements. */}
      {stale && displayMode === "original" && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="size-3 shrink-0" /> Text changed the number of words. Word timing needs review.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => onRebuildWordTiming(id)}
            title="Replaces the current (stale) word timing with evenly-spaced timing across this caption. Undoable."
          >
            Rebuild timing
          </Button>
        </div>
      )}
      {/* Task 105631 (P17) — "Rebuild timing" always rebuilds from the ORIGINAL text (see
          editor-store.ts rebuildWordTiming), regardless of what's displayed, so offering it while
          viewing a derived mode would silently target different text than what's on screen. Shown
          read-only here instead, pointing at the one mode where rebuilding is unambiguous. */}
      {stale && displayMode !== "original" && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          <AlertTriangle className="size-3 shrink-0" />
          Word timing needs review. Switch to Original mode to rebuild it.
        </div>
      )}
      {/* Task 106284 (P17.1) — a SEPARATE concept from the two banners above: not "does word
          TIMING match the ORIGINAL text" (isWordTimingStale), but "does the per-word derived-text
          breakdown still reconstruct THIS caption's own derived text" (isDerivedWordTextStale) —
          the residue of a word-count-changing edit to the Hinglish/Gujarati-Script textarea (see
          remapHinglishWordsToText/remapGujaratiScriptWordsToText's own doc comments). Shown
          alongside the word chips below (not instead of them) — the old per-word breakdown is
          still valid content, just not an exact reconstruction of the newest caption-level text,
          so there's no reason to hide it while the user decides whether to regenerate. */}
      {derivedWordTextStale && (displayMode === "hinglish" || displayMode === "gujarati-script") && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="size-3 shrink-0" /> Word-level {displayMode === "hinglish" ? "Hinglish" : "Gujarati Script"} text is out of date.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => onRegenerateDerivedWordText(id, displayMode)}
            title="Regenerates this caption's word-level breakdown from the authoritative Original words. Undoable."
          >
            Regenerate
          </Button>
        </div>
      )}
      {!stale && segments.length > 0 && words && captionStyle && (
        <WordChips
          segments={segments}
          words={words}
          displayMode={displayMode}
          captionStart={start}
          captionEnd={end}
          captionStyle={captionStyle}
          selectedWordIndex={selectedWordIndex}
          // WordChips itself is a plain (non-memoized) child of CaptionRow — it already
          // re-renders whenever CaptionRow does (e.g. every playback tick while this caption is
          // active, via its own direct currentTime/isPlaying subscription — see its own doc
          // comment), so binding `id` here with an ordinary inline closure costs nothing extra:
          // it's recreated only as often as CaptionRow itself now correctly, rarely re-renders.
          onSelectWord={(index) => onSelectWord(id, index)}
          onUpdateWordTiming={(index, s, e) => onUpdateWordTiming(id, index, s, e)}
          onSplitWord={(index, leftText, rightText) => onSplitWord(id, index, leftText, rightText)}
          onMergeWordWithNext={(index) => onMergeWordWithNext(id, index)}
          onDeleteWord={(index) => onDeleteWord(id, index)}
          onInsertWord={(index, side, text) => onInsertWord(id, index, side, text)}
          onSetWordStyle={(index, patch) => onSetWordStyle(id, index, patch)}
          onReorderWord={(fromIndex, toIndex) => onReorderWord(id, fromIndex, toIndex)}
        />
      )}
    </div>
  );
});

/** Task 100742 (P13) — split out of CaptionRow specifically so the active-playback-word
 * highlight can subscribe to `currentTime`/`isPlaying` DIRECTLY from the store, rather than as
 * props from CaptionsPanel — this block only ever mounts for the SELECTED caption's own row (see
 * CaptionRow's own `words={isSelected ? s.words : null}` gate in the parent), so this confines
 * the "re-render on every video timeupdate" cost to exactly the one row that needs it, instead of
 * re-rendering the whole CaptionsPanel/every visible CaptionRow on every tick (this task's own
 * "do not run expensive React state updates for every animation frame" requirement — `timeupdate`
 * fires a handful of times a second, not per-frame, but there's no reason to pay that cost more
 * than once). */
function WordChips({
  segments,
  words,
  displayMode,
  captionStart,
  captionEnd,
  captionStyle,
  selectedWordIndex,
  onSelectWord,
  onUpdateWordTiming,
  onSplitWord,
  onMergeWordWithNext,
  onDeleteWord,
  onInsertWord,
  onSetWordStyle,
  onReorderWord,
}: {
  segments: ReturnType<typeof getRenderableWordSegments>;
  words: Word[];
  /** Task 105631/106284 (P17/P17.1) — passed straight through to each word's own popover, which
   * derives its own capability row from this (lib/subtitles/caption-display-mode.ts). Word
   * selection/timing here is unaffected either way. */
  displayMode: CaptionOutputMode;
  captionStart: number;
  captionEnd: number;
  /** Task 110184 (P18.3) — passed straight through to each word's own popover to resolve its
   * effective (inherited vs overridden) Bold state. */
  captionStyle: SubtitleStyle;
  selectedWordIndex: number | null;
  onSelectWord: (index: number | null) => void;
  onUpdateWordTiming: (index: number, start: number, end: number) => void;
  onSplitWord: (index: number, leftText: string, rightText: string) => boolean;
  onMergeWordWithNext: (index: number) => void;
  onDeleteWord: (index: number) => void;
  onInsertWord: (index: number, side: "before" | "after", text: string) => boolean;
  onSetWordStyle: (index: number, patch: Partial<SubtitleStyle> | null) => void;
  onReorderWord: (fromIndex: number, toIndex: number) => "ok" | "invalid-index" | "noop" | "not-found";
}) {
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  // Only meaningful while this caption is actually the one playing — a caption that's selected
  // but not under the playhead (or playback is paused) shows no active-word indicator at all,
  // matching this task's own "selected word" vs "currently playing word" distinction: pausing
  // preserves the selected word but the active-playback word simply disappears.
  const activeWordIndex = isPlaying && currentTime >= captionStart && currentTime < captionEnd ? findActiveWordIndex(words, currentTime) : null;

  return (
    <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
      {segments.map(({ index, word }) => {
        // Task 117206 (P18.9): the "Bounded by" hint must reflect this word's REAL chronological
        // neighbors, not its array-adjacent ones — a P18.6 word reorder can put a chronologically
        // earlier/later word at any array position. See lib/subtitles/word-timing.ts
        // findChronologicalWordNeighbors's own doc comment; this is display-only (onCommit below
        // still routes through the store's own clampWordTiming, the actual authority).
        const { prevEnd: prevWordEnd, nextStart: nextWordStart } = findChronologicalWordNeighbors(words, index);
        const isWordSelected = selectedWordIndex === index;
        // Distinct from `isWordSelected` (a deliberate user choice) — drawn only when the two
        // differ so a word that's both selected AND currently playing doesn't need a third,
        // blended visual state; the existing selected styling already covers that case.
        const isWordActive = !isWordSelected && index === activeWordIndex;
        // Task 108762 (P18.1) — a purely additive visual hint, layered on top of whichever of the
        // three existing chip states (selected/active/default) applies; never its own 4th
        // background state, and never shown for "unknown" (no measurement) — only a genuinely
        // low measured value (see lib/subtitles/word-confidence.ts).
        const isLowConfidence = classifyWordConfidence(word.confidence) === "low";
        return (
          <WordTimingPopover
            key={index}
            word={word}
            captionStart={captionStart}
            captionEnd={captionEnd}
            prevWordEnd={prevWordEnd}
            nextWordStart={nextWordStart}
            displayMode={displayMode}
            captionStyle={captionStyle}
            onCommit={(s, e) => onUpdateWordTiming(index, s, e)}
            onSplit={(leftText, rightText) => onSplitWord(index, leftText, rightText)}
            onMergeNext={() => onMergeWordWithNext(index)}
            onDelete={() => onDeleteWord(index)}
            onInsert={(side, text) => onInsertWord(index, side, text)}
            onSetStyle={(patch) => onSetWordStyle(index, patch)}
            wordIndex={index}
            totalWords={words.length}
            onReorder={(toIndex) => onReorderWord(index, toIndex)}
            hasNextWord={index < words.length - 1}
          >
            <button
              type="button"
              onClick={() => onSelectWord(index)}
              title={
                isLowConfidence
                  ? `${formatTime(word.start)} → ${formatTime(word.end)} · low transcription confidence`
                  : `${formatTime(word.start)} → ${formatTime(word.end)}`
              }
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                isWordSelected
                  ? "border-accent bg-accent-soft text-accent"
                  : isWordActive
                    ? "border-accent-cyan/70 bg-accent-cyan/10 text-foreground"
                    : "border-border-strong bg-surface text-muted hover:text-foreground",
                isLowConfidence && "outline outline-1 outline-offset-1 outline-warning/70",
              )}
            >
              {word.text}
            </button>
          </WordTimingPopover>
        );
      })}
    </div>
  );
}
