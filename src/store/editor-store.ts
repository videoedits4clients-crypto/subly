import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  AnimationConfig,
  CaptionOutputMode,
  CompositionSettings,
  CutRange,
  ProjectData,
  Subtitle,
  SubtitleStyle,
  TimingRules,
  Word,
} from "../types/subtitle.ts";
import { breakIntoLines } from "../lib/subtitles/linebreak.ts";
import { copyStyleToClipboard, readStyleClipboard } from "../lib/style-clipboard.ts";
import { applyTemplateToSnapshot, countTemplateTargets, type ResolvedTemplate, type TemplateTarget } from "../lib/caption-templates.ts";
import { normalizeCuts } from "../lib/timeline/edit-model.ts";
import {
  generateHinglishForSubtitle,
  generateGujaratiScriptForSubtitle,
  isDerivedWordTextStale,
  regenerateHinglishForSubtitle,
  regenerateGujaratiScriptForSubtitle,
  type DerivedCaptionOutputMode,
} from "../lib/subtitles/output-mode.ts";
import { splitSubtitleAt, type SplitSubtitleRejectionReason } from "../lib/subtitles/split.ts";
import { mergeSubtitles, type MergeSubtitlesRejectionReason } from "../lib/subtitles/merge-subtitles.ts";
import { segmentWords } from "../lib/subtitles/segment.ts";
import { analyzeSubtitleQuality, type QualityReport } from "../lib/subtitles/quality-analyzer.ts";
import { tokenizeCaptionText, evenlyDistributeWords, clampWordTiming, validateWordsWithinCaptionBounds } from "../lib/subtitles/word-timing.ts";
import { splitWordText, mergeWords, overlapsOtherWord, deleteWordConservative, resolveWordInsertion, remapWordMetadataForTextReplacement } from "../lib/subtitles/word-edit.ts";
import { reorderSubtitleWord, type WordReorderRejectionReason } from "../lib/subtitles/word-reorder.ts";
import { resolveSingleDuplicateShift, resolveBlockDuplicateShift } from "../lib/subtitles/duplicate-timing.ts";
import { resolveRippleDelete, resolveRippleInsert } from "../lib/subtitles/ripple-edit.ts";
import { computeBatchFindReplace, computeBatchTextTransform, type TextTransformKind } from "../lib/subtitles/batch-text-ops.ts";
import { computeTextCleanupPreview, type CleanupSelection } from "../lib/subtitles/text-cleanup.ts";
import { resolveBoundaryToPlayhead, type BoundaryEdge } from "../lib/timeline/boundary-to-playhead.ts";
import type { CaptionClipboard } from "../lib/subtitles/caption-clipboard.ts";

/** Task 95640 (P9): the outcome of a duplicate attempt — "ok" (one caption/block was added, one
 * commit made), "non-contiguous" (duplicateSubtitles only — the selection isn't a single
 * contiguous run), or "no-room" (the collision-safe placement wouldn't fit before the next
 * caption without overlapping it). No commit is made for either failure case. A plain boolean
 * isn't enough here since the UI needs to show a DIFFERENT, specific toast per reason — see
 * duplicateSubtitle/duplicateSubtitles' own doc comments. */
export type DuplicateResult = "ok" | "non-contiguous" | "no-room";

/** Task 112347 (P18.5) — mirrors DuplicateResult's own shape/reasoning: a plain boolean can't
 * carry which of two genuinely different reasons a ripple delete was rejected for, and the UI
 * needs to show a specific toast per reason. No commit is made for either failure case. */
export type RippleDeleteResult = "ok" | "empty-selection" | "non-contiguous" | "invalid-result";
/** Task 112347 (P18.5) — "noop" is deliberately distinct from the error reasons: the insertion
 * point/duration were both valid, there was just nothing after `insertAtSec` to shift — a correct,
 * unsurprising outcome, not a rejection, but the UI should still say so rather than silently
 * doing nothing. No commit is made for "noop" or any of the error reasons. */
export type RippleInsertResult = "ok" | "noop" | "invalid-duration" | "invalid-insertion-point" | "crosses-caption";

/** Task 113528 (P18.6) — mirrors WordReorderRejectionReason (lib/subtitles/word-reorder.ts) plus
 * "not-found" for a subtitleId that no longer exists (the caption could have been deleted by a
 * concurrent action between the UI reading it and the click handler firing). No commit is made
 * for any failure reason. */
export type WordReorderStoreResult = "ok" | WordReorderRejectionReason | "not-found";

/** Task 114761 (P18.7) — mirrors SplitSubtitleRejectionReason (lib/subtitles/split.ts) plus
 * "not-found" for a subtitleId that no longer exists. No commit is made for any failure reason. */
export type SplitSubtitleAtTimeResult = "ok" | SplitSubtitleRejectionReason | "not-found";
/** Task 114761 (P18.7) — mirrors MergeSubtitlesRejectionReason (lib/subtitles/merge-subtitles.ts)
 * plus "not-found" (the caption no longer exists) and "no-next-caption" (already the last
 * caption — mirrors mergeWithNext's own pre-existing "nothing after it" no-op condition, now
 * surfaced as an explicit reason instead of a silent no-op). No commit for any failure reason. */
export type MergeWithNextResult = "ok" | MergeSubtitlesRejectionReason | "not-found" | "no-next-caption";

/** Task 115894 (P18.8) — mirrors the shape of every other store-action result above:
 * "not-found" for a subtitleId that no longer exists, "word-out-of-bounds" for a resize (a
 * timing change that alters the caption's own duration, as opposed to a pure whole-caption
 * shift — see updateSubtitleTiming's own doc comment) that would leave an existing word's real
 * [start,end) outside the caption's proposed new bounds. No commit is made for either failure
 * reason — see resolveTimingUpdate below, the pre-check that decides whether commit() is called
 * at all. A pure whole-caption shift (nudgeSubtitleTiming, or a whole-block timeline drag) can
 * never produce "word-out-of-bounds": it translates every word by the same delta the caption
 * itself moved by, so a word already inside the caption stays inside after the move. */
export type UpdateSubtitleTimingResult = "ok" | "not-found" | "word-out-of-bounds";

interface HistorySnapshot {
  subtitles: Subtitle[];
  globalStyle: SubtitleStyle;
  animation: AnimationConfig;
  timingRules: TimingRules;
  composition: CompositionSettings;
  trimStart: number;
  trimEnd: number | null;
  cutRanges: CutRange[];
}

interface EditorState {
  project: ProjectData | null;
  /** The FOCUSED caption — the one word inspector/style-panel/animation-panel's "This caption"
   * scope and the timeline's single-caption toolbar act on, and (Task 94820, P8) the
   * last-clicked caption within a multi-selection, visually distinguished from the rest of the
   * selection. Ephemeral UI state: never part of undo/redo, never persisted. */
  selectedSubtitleId: string | null;
  /** Which word (by index into the selected caption's own `words` array) is currently focused
   * in the word-level inspector (Task 92618, P7.2) — ephemeral UI state, same category as
   * `selectedSubtitleId`: never part of undo/redo, never persisted, reset on `load()` and
   * whenever the selected caption itself changes (see selectSubtitle — a word selection can't
   * meaningfully survive its parent caption being deselected). */
  selectedWordIndex: number | null;
  /** Task 94820 (P8): the full multi-caption selection, by stable id (never DOM position, so it
   * stays correct against the virtualized caption list — see captions-panel.tsx). ALWAYS kept in
   * sync with `selectedSubtitleId` as the canonical selection: a plain single-select is just the
   * size-1 case (`{selectedSubtitleId}`), and an ordinary deselect is the size-0 case — there is
   * no second, parallel selection model, per this task's own "adapt the existing architecture"
   * instruction. Populated beyond size 1 only by an explicit Ctrl/Shift-click gesture (see
   * toggleSubtitleSelection/selectSubtitleRange). Ephemeral UI state, same category as
   * `selectedSubtitleId`: never part of undo/redo, never persisted, reset on `load()`. Pruned of
   * any id no longer present in `project.subtitles` inside commit()/undo()/redo() themselves (see
   * pruneSelection) so a mutation that deletes/replaces captions — including via undo/redo, which
   * never goes through commit() — can never leave a stale, dangling id behind. */
  selectedSubtitleIds: Set<string>;
  /** Task 94820 (P8): the fixed end a Shift-click range-selects from — set on every plain click
   * and every Ctrl-click (so the next Shift-click always ranges from the most recent single
   * point), left unchanged by a Shift-click itself (so repeated Shift-clicks re-range from the
   * SAME anchor, not from wherever the previous Shift-click landed — the conventional file-
   * explorer/spreadsheet behavior). Ephemeral UI state, same category as `selectedSubtitleId`:
   * never part of undo/redo, never persisted, pruned alongside `selectedSubtitleIds`. */
  selectionAnchorId: string | null;
  /** Which custom (user-saved) preset — if any — was last applied via applyPreset, so the
   * Presets panel can offer "Update preset" once the current style/animation drifts from it.
   * Lives here (not local component state) because Radix Tabs unmounts inactive TabsContent by
   * default — a plain useState in PresetsPanel would reset to null the moment the user
   * switched to the Style tab to tweak the just-applied preset, which is the exact workflow
   * this exists to support. Ephemeral UI state only, same as selectedSubtitleId: never part of
   * undo/redo, never persisted to the project. */
  lastAppliedCustomPresetId: string | null;
  /** The exact style+animation `applyPreset` last set (built-in OR custom) — a snapshot of
   * "the style that was originally selected" for the P6 Style Creator's "Reset changes"
   * action (see resetToLastApplied), distinct from "Reset to default" (the existing
   * per-caption override reset in style-panel.tsx/animation-panel.tsx, which already worked
   * before P6 and is untouched). Ephemeral UI state, same category as lastAppliedCustomPresetId:
   * never part of undo/redo itself (resetToLastApplied re-applies it through commit(), which
   * DOES become one normal undo step), never persisted, reset on load(). */
  lastAppliedStyleSnapshot: { style: SubtitleStyle; animation: AnimationConfig } | null;
  isPlaying: boolean;
  currentTime: number;
  seekRequest: { time: number; token: number } | null;
  /** Set by Tab/Shift+Tab (see hooks/use-keyboard-shortcuts.ts) to ask the captions panel to
   * focus a caption's textarea once React has actually committed the new selection — same
   * "request + token" shape as seekRequest, and for the same reason: a plain DOM
   * `requestAnimationFrame(() => el.focus())` scheduled from outside React races against
   * React's own render/commit timing (confirmed live in the packaged app: the selection
   * updated correctly but focus never actually moved). A token, not just the id, so
   * requesting the SAME caption again (e.g. Tab past the last one and back) still re-fires
   * the effect that performs the focus. */
  focusCaptionRequest: { id: string; token: number } | null;
  dirty: boolean;
  saveState: "idle" | "unsaved" | "saving" | "saved" | "error";
  aiToolsDemo: boolean;
  transcriptionDemo: boolean;

  /** The most recent subtitle-quality analysis, or `null` if none has been run yet this
   * session (see lib/subtitles/quality-analyzer.ts's NOT_ANALYZED state) — ephemeral UI state,
   * same category as `selectedSubtitleId`/`focusCaptionRequest`: never part of undo/redo, never
   * persisted, reset on `load()`. Kept here (not local component state) so both the quality
   * panel dialog and the export dialog can show the same live result without either one owning
   * it, and so re-opening the quality panel doesn't lose the last analysis. */
  qualityReport: QualityReport | null;
  /** The exact `project.subtitles` array reference `qualityReport` was computed from — compared
   * by `isQualityReportStale` to detect any edit/split/merge/delete/resegment/fix that happened
   * since, without a persisted revision counter (see that function's own doc comment). */
  qualityReportSubtitles: Subtitle[] | null;
  /** Which issue in `qualityReport.issues` next/previous-issue navigation currently points at
   * (Task 92618, P7.2) — the SAME cursor used by every entry point (keyboard shortcut, top bar
   * buttons, the quality panel dialog's own Previous/Next buttons), so there is exactly one
   * "current issue" representation, never several that could disagree. Ephemeral UI state, same
   * category as `qualityReport` itself: never part of undo/redo, never persisted, reset on
   * `load()` and whenever a fresh analysis runs (a new report's issue list may not correspond
   * to the old index at all). */
  qualityIssueIndex: number | null;
  /** Task 99261 (P12) — the SET of `QualityIssue.id`s the reviewer has already navigated to via
   * `goToQualityIssue` (Next/Previous, from any entry point — they all funnel through this one
   * action) during the CURRENT report, so the review UI can show "X of Y reviewed" without a new
   * per-issue "reviewed" flag on the report itself. Deliberately NOT the report's source of
   * truth for anything — a purely additive, ephemeral bookkeeping set, same category as
   * `qualityIssueIndex`: never part of undo/redo, never persisted, reset on `load()` and on every
   * fresh `runQualityAnalysis()` (a new report's issue ids may not even overlap the old ones, so
   * carrying old entries forward would silently over-report progress on a report the reviewer
   * has never actually looked at). */
  reviewedIssueIds: Set<string>;

  /** Task 101583 (P14) — the internal, structured caption-text clipboard populated by Ctrl+C/
   * Ctrl+X and read by Ctrl+V (see hooks/use-keyboard-shortcuts.ts) and the paste-mismatch
   * preview dialog (components/editor/paste-captions-dialog.tsx). Deliberately ephemeral UI
   * state, same category as `selectedSubtitleId`/`qualityReport`: never part of undo/redo (a
   * copy makes no history entry at all — see this task's own spec §10), never persisted (no new
   * DB table — spec §1's own "clipboard state must be ephemeral" decision), reset on `load()`
   * like every other ephemeral field here. Distinct from the pre-existing STYLE clipboard
   * (lib/style-clipboard.ts, `copyStyle`/`pasteStyle` below) — that one is deliberately
   * localStorage-backed so a style survives navigating to a different project; this one holds
   * caption TEXT (words/style/animation copied by value, not applied), is populated far more
   * often (every Ctrl+C), and P14's own spec requires no persistence, so a plain in-memory field
   * is the correct, simpler choice here. */
  captionClipboard: CaptionClipboard | null;
  setCaptionClipboard: (clipboard: CaptionClipboard | null) => void;

  past: HistorySnapshot[];
  future: HistorySnapshot[];

  load: (project: ProjectData) => void;
  /** Runs (or re-runs) subtitle-quality analysis against the project's current subtitles/rules
   * and stores the result — a plain state update, not routed through `commit()`: analysis
   * reports on data, it never changes any, so it isn't an undo/redo step and never marks the
   * project dirty. */
  runQualityAnalysis: () => void;
  /** Task 99261 (P12) — the "Analyze"/"Re-analyze"/"Analyze Again" entry point for a REVIEW
   * session: runs analysis (exactly like `runQualityAnalysis`, including its own
   * `qualityIssueIndex`/`reviewedIssueIds` reset) and then, if the fresh report has any issues,
   * immediately navigates to the first one — the review loop's own "Analyze → Issue 1" step, so
   * the reviewer never has to click Next once more just to land on the first issue. Does nothing
   * further when the fresh report has zero issues (the clean state is just "no issue to go to").
   * Deliberately a SEPARATE action from `runQualityAnalysis` rather than baking the navigation
   * into it — the export dialog's own readiness check also calls `runQualityAnalysis` and must
   * NOT jump the editor's selection/seek position while someone is just checking export
   * readiness, and existing tests already pin `runQualityAnalysis` alone to leave
   * `qualityIssueIndex` at `null` (never auto-navigating). */
  runQualityAnalysisAndReview: () => void;
  /** Moves the "current quality issue" cursor by `delta` (±1), clamped to the report's own
   * issue list — never wraps, matching the existing quality panel dialog's own Previous/Next
   * buttons (Task 92618, P7.2 — this is the SAME cursor those buttons already use, see
   * qualityIssueIndex). Selects and seeks to the target issue's caption, same as the dialog's
   * own navigateToCaption. Task 99261 (P12): also selects the issue's specific word
   * (`selectWord(issue.wordIndex ?? null)`) — the word-level highlight/timing UI for a
   * word-targeted issue (WORD_TIMESTAMP_INVALID), or an explicit clear for a caption-level issue
   * (never a fabricated word focus) — and records the issue's id into `reviewedIssueIds`. A
   * no-op (returns false) when there is no report yet or it has zero issues; the caller decides
   * what, if anything, to tell the user about that. Deliberately does NOT re-run analysis and
   * does NOT itself judge staleness — see isQualityReportStale, which callers can check
   * independently before/after calling this. */
  goToQualityIssue: (delta: 1 | -1) => boolean;
  setAiToolsDemo: (demo: boolean) => void;
  setTranscriptionDemo: (demo: boolean) => void;
  selectSubtitle: (id: string | null) => void;
  /** Focuses one word (by index into the selected caption's `words`) in the word-level
   * inspector, or clears the focus with `null`. Never validates the index against the caption's
   * actual word count here — the UI consuming this already only offers indices that exist. */
  selectWord: (index: number | null) => void;
  /** Ctrl/Cmd+click: toggles one caption in/out of the multi-selection, independent of every
   * other selected id (Task 94820, P8). The clicked id becomes the new focused caption
   * (`selectedSubtitleId`) whether it was just added or just removed — matching the "last
   * touched" convention every other selection action here uses — except when this empties the
   * selection entirely, in which case focus clears too, same as a plain deselect. */
  toggleSubtitleSelection: (id: string) => void;
  /** Shift/Ctrl+Shift+click: selects every caption between `selectionAnchorId` (or the current
   * focused caption if no anchor is set yet) and `targetId`, inclusive, by TIME ORDER in
   * `project.subtitles` (not DOM position, so this is correct against the virtualized list even
   * when most of the range isn't currently mounted — see captions-panel.tsx). Task 94820 (P8):
   * deliberately the SAME behavior for a plain Shift-click and a Ctrl+Shift-click — extending a
   * contiguous range in-place, rather than a separate additive/toggle-range mode, per this task's
   * own "do not overcomplicate the UX if unnecessary" instruction. Leaves `selectionAnchorId`
   * itself unchanged so repeated Shift-clicks keep re-ranging from the same fixed point. */
  selectSubtitleRange: (targetId: string) => void;
  /** Ctrl/Cmd+A: selects every caption in the project (Task 94820, P8). Keeps the current focused
   * caption if it's still in the project, otherwise focuses the first caption. */
  selectAllSubtitles: () => void;
  setLastAppliedCustomPresetId: (id: string | null) => void;
  requestCaptionFocus: (id: string) => void;
  seek: (time: number) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  markDirty: () => void;
  setSaveState: (s: EditorState["saveState"]) => void;

  commit: (mutator: (snapshot: HistorySnapshot) => HistorySnapshot) => void;
  undo: () => void;
  redo: () => void;

  updateSubtitleText: (id: string, text: string) => void;
  /** Switches which text captions actually display/export as (see types/subtitle.ts
   * CaptionOutputMode). Lazily generates any missing `hinglishText` the first time a
   * project switches to "hinglish" — a cache fill, not a content edit, so (like
   * setAiToolsDemo) it's a plain state update rather than routed through commit(),
   * meaning it does NOT itself become an undo/redo step. It does mark the project
   * dirty so the generated text actually gets persisted by autosave. */
  setCaptionOutputMode: (mode: CaptionOutputMode) => void;
  /** Edits one caption's Hinglish text directly (captions-panel, while in "hinglish"
   * mode) — the Hinglish analogue of updateSubtitleText. Never touches `text`/
   * `words[].text`, which stay the untouched original transcript. */
  updateSubtitleHinglishText: (id: string, hinglishText: string) => void;
  /** Edits one caption's Gujarati-script text directly (captions-panel, while in
   * "gujarati-script" mode) — the Gujarati-script analogue of updateSubtitleText. Never
   * touches `text`/`words[].text`, which stay the untouched original transcript. */
  updateSubtitleGujaratiScriptText: (id: string, gujaratiScriptText: string) => void;
  /** Task 115894 (P18.8) — now returns a result instead of `void` (see UpdateSubtitleTimingResult's
   * own doc comment): a RESIZE (one edge moves, duration changes) that would leave an existing
   * word's real timing outside the caption's proposed new bounds is REJECTED — "word-out-of-bounds",
   * zero commits, zero mutation — instead of the old behavior of silently repositioning that word
   * via clampWordsToCaptionBounds, which assumed array order was chronological and could corrupt a
   * P18.6-reordered (non-monotonic) word's real timestamp. A pure whole-caption SHIFT (both edges
   * move by the same delta, duration unchanged) is untouched by this and can never be rejected. */
  updateSubtitleTiming: (id: string, start: number, end: number) => UpdateSubtitleTimingResult;
  /** Shifts one caption's start AND end together by `deltaSec` (negative = earlier, positive =
   * later), preserving its own duration exactly — the keyboard timing-nudge shortcut (Alt+←/→,
   * see hooks/use-keyboard-shortcuts.ts), for corrections too small/fiddly to drag precisely
   * with a mouse. Routes through updateSubtitleTiming, so it gets the exact same
   * overlap-clamping and undo/redo/persistence behavior as a mouse drag — never a special case.
   * Always a pure whole-caption shift (same delta added to both start and end), so it can never
   * hit updateSubtitleTiming's P18.8 "word-out-of-bounds" rejection — the return value is safe
   * to ignore here. */
  nudgeSubtitleTiming: (id: string, deltaSec: number) => void;
  /** Batch analogue of nudgeSubtitleTiming (Task 94820, P8): shifts every caption in `ids` by
   * the SAME delta in ONE commit (one undo step), preserving each one's own duration and every
   * word's timestamp relative to its own caption exactly (a pure translate, identical to
   * nudgeSubtitleTiming's own "whole-block move" case). The delta itself is clamped ONCE against
   * the whole selection's nearest NON-selected neighbors on every side (including gaps between
   * non-contiguous selected captions) before anything is written, so the batch either moves
   * together as a rigid unit or clamps as a unit at the nearest boundary — it can never partially
   * move some selected captions while leaving others behind, and never needs updateSubtitleTiming's
   * per-caption clamp (which would otherwise use stale pre-shift neighbor bounds for captions
   * later in the same batch). A no-op (no commit at all) when the clamped delta rounds to zero,
   * e.g. already pinned against a boundary. */
  nudgeSubtitles: (ids: string[], deltaSec: number) => void;
  /** Task 100742 (P13) — moves the selected caption's `start` (edge "start") or `end` (edge
   * "end") to the current playhead (`currentTime`) — a bounded "set in"/"set out" action, not
   * arbitrary resizing. Returns `false` and makes NO commit at all when the request is invalid
   * (see lib/timeline/boundary-to-playhead.ts's own doc comment for the exact reject conditions:
   * negative time, would overlap the previous/next caption, would violate the minimum caption
   * duration, or the playhead is already exactly at that boundary) — so an invalid request is
   * atomic: no history entry, no partial mutation. When valid, calls the EXISTING
   * `updateSubtitleTiming` with the new bounds — the same single mutation path a mouse drag or
   * Alt+←/→ nudge already uses, so overlap prevention and the minimum-duration floor are inherited
   * for free, never re-implemented here. Task 115894 (P18.8): `updateSubtitleTiming` can now ALSO
   * reject with "word-out-of-bounds" (see its own doc comment) — this action propagates that as a
   * `false` return too, so its own "no commit at all when invalid" guarantee still holds even
   * though resolveBoundaryToPlayhead itself has no notion of word timing. */
  setSubtitleBoundaryToPlayhead: (id: string, edge: BoundaryEdge) => boolean;
  /** Adjusts ONE word's own start/end within a caption (Task 92618, P7.2) — the word-level
   * analogue of updateSubtitleTiming, with the identical clamp shape (see
   * lib/subtitles/word-timing.ts clampWordTiming): never crosses the caption's own bounds,
   * never crosses its actual CHRONOLOGICAL neighbors (Task 117206, P18.9 — never array-adjacent
   * ones; see clampWordTiming's own doc comment for why that distinction matters since P18.6's
   * word reorder), never collapses below a minimum duration. Touches only the one targeted word
   * in the one targeted caption — the caption's own start/end and every other word/caption are
   * left completely untouched. A request `clampWordTiming` can't safely satisfy (out-of-range
   * index, or its real neighbors leave no room) makes ZERO commit() calls — same "no commit at
   * all when invalid" contract as every other rejecting mutation in this file — kept as `void`
   * (not a result type) since nothing currently needs to distinguish "rejected" from "applied":
   * the word's displayed timing simply doesn't change. A satisfiable request is routed through
   * commit() exactly as before, so it is a normal undo/redo step like every other timing
   * mutation, never a special case. */
  updateWordTiming: (subtitleId: string, wordIndex: number, start: number, end: number) => void;
  /** Explicitly regenerates a caption's word timing from its CURRENT text, evenly distributed
   * across the caption's own (unchanged) [start, end] bounds (Task 92618, P7.2 — see
   * lib/subtitles/word-timing.ts evenlyDistributeWords). This is the ONLY thing that ever
   * replaces word timing after a word-count-changing text edit — never automatic, always this
   * explicit, user-triggered, undoable action (see updateSubtitleText's own doc comment for why
   * text edits alone no longer touch mismatched word timing at all). */
  rebuildWordTiming: (subtitleId: string) => void;
  /** Task 102741 (P15) — splits one word into two at an explicit, user-provided text boundary
   * (see lib/subtitles/word-edit.ts splitWordText — never a guessed phonetic split). Timing is
   * divided proportionally by each resulting token's own character length across the original
   * word's [start, end]. Recomputes the caption's own `.text` from the new word sequence via the
   * SAME `breakIntoLines` reflow splitSubtitleAt/mergeWithNext already use, so `isWordTimingStale`
   * (a pure words.length-vs-token-count comparison) stays correctly non-stale — this is not a
   * second word-timing architecture, it's the existing one kept in sync. Returns `false` (no
   * commit at all) when the split is infeasible (empty text, or either half would fall below the
   * minimum word duration) — the caller shows a clear "can't split" message rather than silently
   * doing nothing. One commit = one undo step. */
  splitWord: (subtitleId: string, wordIndex: number, leftText: string, rightText: string) => boolean;
  /** Task 102741 (P15) — merges `wordIndex` with the word immediately after it in the caption's
   * own TEXT into one word (see lib/subtitles/word-edit.ts mergeWords — text joined by a space,
   * timing spans the [min,max] of both real timestamps). Recomputes `.text` the same way splitWord
   * does. Returns `false` (no commit) when there is no next word to merge with (the caller should
   * already have disabled the action in that case — a defensive guard, not the primary UX), or —
   * Task 118943 (P18.10) — when the two words are only textually adjacent (P18.6 word reorder) and
   * merging their real timestamps would silently swallow a third word's own real timing; this
   * second case currently has no dedicated toast (see word-timing-popover.tsx's own "'noop' and
   * 'ok' both need no message" precedent for the reorder buttons) — it simply has no visible
   * effect, matching how an already-disabled-by-the-UI click already behaves. One commit = one
   * undo step on success. */
  mergeWordWithNext: (subtitleId: string, wordIndex: number) => boolean;
  /** Task 102741 (P15) — removes one word, collapsing the gap via the ALWAYS-safe deterministic
   * rule in lib/subtitles/word-edit.ts deleteWordConservative (extend the word's real CHRONOLOGICAL
   * predecessor's end, or its real chronological successor's start if there is no predecessor —
   * Task 118943/P18.10: by actual timestamp, never by array position, since P18.6 word reorder
   * means the array-adjacent word need not be the chronologically closest one) — never
   * redistributes proportionally, never rejects (see that function's own doc comment for why this
   * specific rule can never need to). Deleting a caption's only remaining word leaves it
   * text-less/word-less — the exact same
   * state P14's caption-text Cut already produces, already surfaced by the existing EMPTY_CAPTION
   * quality check, not a new state to special-case. One commit = one undo step. */
  deleteWord: (subtitleId: string, wordIndex: number) => void;
  /** Task 103884 (P16) — inserts ONE new word immediately before/after `words[wordIndex]` (see
   * lib/subtitles/word-edit.ts resolveWordInsertion — the new word claims the ENTIRE available gap
   * between its two neighbors, or the caption's own boundary when there is no neighbor on that
   * side; never fabricated/partial timing, never borrowed from an unrelated word). Recomputes the
   * caption's own `.text` from the new word sequence the same way splitWord/mergeWordWithNext/
   * deleteWord already do, so `isWordTimingStale` reads the caption as freshly correct right after
   * insertion. Returns `false` (no commit at all) when the request is infeasible — empty/
   * multi-token text, or a gap smaller than MIN_WORD_DURATION_SEC — the caller shows a clear
   * rejection message rather than silently doing nothing. Selects the newly inserted word
   * (`wordIndex` for "before", `wordIndex + 1` for "after" — the same index resolveWordInsertion
   * itself computed). One commit = one undo step. */
  insertWord: (subtitleId: string, wordIndex: number, side: "before" | "after", text: string) => boolean;
  /** Task 113528 (P18.6) — MOVE WORD FROM INDEX A TO INDEX B within one caption (Move Left/Move
   * Right). The COMPLETE word object travels — text, start/end, confidence, style, removed,
   * hinglishText/gujaratiScriptText all move together as one unit (see lib/subtitles/word-reorder.ts's
   * own top-of-file doc comment for the full Phase-0 audit this is based on). Deliberately does
   * NOT re-sort or otherwise touch any timestamp — word timing is allowed to become non-monotonic
   * as the direct, expected consequence of the move; both the live preview and ASS export already
   * resolve "which word is active right now" by TIMESTAMP CONTENT, never by array position, so
   * this is safe with zero changes to either. Recomputes the caption's own `.text` from the new
   * word sequence (same `breakIntoLines` shape splitWord/mergeWordWithNext/deleteWord/insertWord
   * already use) and clears the caption-level `hinglishText`/`gujaratiScriptText` cache (same
   * unconditional clear those four already perform on any word-array structural change) — closes
   * the one gap the existing word-COUNT-based P17.1 staleness check can't catch on its own (an
   * order-only change), without touching that shared check at all. Available in every display
   * mode (see caption-display-mode.ts's own `wordReorderAllowed` doc comment for why this is safe
   * the same way Merge/Delete already are). Returns "ok" (one commit) on success; "invalid-index"/
   * "noop" (lib/subtitles/word-reorder.ts's own rejection reasons, no commit) or "not-found" (no
   * commit) otherwise — no partial mutation on any failure. */
  reorderWord: (subtitleId: string, fromIndex: number, toIndex: number) => WordReorderStoreResult;
  /** Task 106284 (P17.1) — forces a caption's per-word AND whole-caption derived text (Hinglish or
   * Gujarati Script, per `mode`) to be recomputed FRESH from the authoritative `words[].text` (see
   * lib/subtitles/output-mode.ts regenerateHinglishForSubtitle/regenerateGujaratiScriptForSubtitle
   * — never reads the stale/mismatched derived text itself). The one safe way to resolve a
   * "word-count-mismatch" (lib/subtitles/output-mode.ts getDerivedWordTextSyncStatus) left behind
   * by a word-count-changing edit to the caption's own derived textarea (see
   * remapHinglishWordsToText/remapGujaratiScriptWordsToText's own doc comments for why that edit
   * deliberately leaves `words` untouched rather than fabricating `Word.text`). Returns `false`
   * (no commit) when the caption isn't actually stale for `mode` — nothing to regenerate, so no
   * pointless undo entry. One commit = one undo step. */
  regenerateDerivedWordText: (subtitleId: string, mode: DerivedCaptionOutputMode) => boolean;
  deleteSubtitle: (id: string) => void;
  /** Batch analogue of deleteSubtitle (Task 94820, P8): removes every id in `ids` and
   * re-indexes the remainder in ONE commit (one undo step for the whole selection, not one per
   * caption), reusing deleteSubtitle's own filter+reindex shape. Clears any of the deleted ids
   * out of the selection/anchor/focus afterward — see pruneSelection, which this also benefits
   * from automatically via commit() itself. */
  deleteSubtitles: (ids: string[]) => void;
  /** Duplicates one caption, placed immediately after it (shifted forward by its own duration —
   * see lib/subtitles/duplicate-timing.ts). Task 95640 (P9): now collision-safe — returns
   * "no-room" (no-op, no commit) instead of silently overlapping whichever caption comes next,
   * when the copy wouldn't fit before it; "ok" otherwise. See duplicateSubtitles for the batch
   * analogue, which shares this exact same fit-check via resolveDuplicateShift/
   * resolveBlockDuplicateShift so single and batch duplication can never disagree about what
   * counts as "enough room." */
  duplicateSubtitle: (id: string) => DuplicateResult;
  /** Batch analogue of duplicateSubtitle (Task 94820 P8; collision-safety added Task 95640 P9),
   * reusing its exact "shift the whole copy forward by its own total width" semantics — but ONLY
   * when `ids` form a single CONTIGUOUS run in the sorted subtitles array (matching
   * duplicateSubtitle/mergeWithNext's own existing "adjacent elements only" scope). A
   * non-contiguous selection (e.g. Ctrl-clicking captions 1 and 3 while skipping 2) has no
   * unambiguous "the duplicated block" placement — inserting a copy of caption 1 next to caption
   * 3's copy would silently invent new timing relationships that were never in the original
   * project, which is exactly the "ambiguous timeline behavior" P8's own spec said to defer
   * rather than force. Returns "non-contiguous" for that case, "no-room" when the (otherwise
   * valid, contiguous) block wouldn't fit before whichever caption comes next without
   * overlapping it (no commit either way), "ok" and one commit (one undo step for the whole
   * block) otherwise. */
  duplicateSubtitles: (ids: string[]) => DuplicateResult;
  /** Task 112347 (P18.5) — RIPPLE DELETE: removes a contiguous, array-index-adjacent selection
   * of captions and shifts every LATER caption (and its words) earlier by exactly the deleted
   * block's own total span (its last caption's `end` minus its first caption's `start`) — a
   * genuinely new, explicitly-invoked operation, distinct from plain deleteSubtitle(s) (which
   * leaves a gap and shifts nothing) and from duplicateSubtitle(s)'s own "never cascade past the
   * immediate neighbor" policy (see lib/subtitles/ripple-edit.ts's own top-of-file doc comment
   * for the exact math and why those two existing behaviors are deliberately left unchanged).
   * A pre-existing gap between the deleted block and whatever came after it is preserved exactly
   * (just relocated earlier), never silently closed. Pure timing translation only: word/caption
   * text, confidence, style, removed, hinglishText, gujaratiScriptText are all carried forward
   * completely untouched on every shifted caption/word. "empty-selection"/"non-contiguous" (no
   * commit either way) mirror duplicateSubtitles' own status-string shape; "invalid-result"
   * (Task 125843, P19.5) is a defense-in-depth rejection — see validateRippleDeleteResult
   * (lib/subtitles/ripple-edit.ts) — practically unreachable for a valid selection but never
   * silently committed if it ever were reachable; "ok" is one commit (one undo step) for the
   * whole ripple regardless of how many captions it shifts. */
  rippleDeleteSubtitles: (ids: string[]) => RippleDeleteResult;
  /** Task 112347 (P18.5) — RIPPLE INSERT: inserts `durationSec` of subtitle-timeline time at
   * `insertAtSec`, shifting every caption (and its words) whose `start >= insertAtSec` forward by
   * exactly `durationSec`; a caption entirely before the insertion point is untouched. A caption
   * whose span STRICTLY straddles the insertion point makes the operation ambiguous and is
   * rejected outright ("crosses-caption") rather than guessed at (split/expand/whole-shift) — see
   * lib/subtitles/ripple-edit.ts. "noop" (no commit) is a legitimate, non-error outcome: the
   * insertion point is valid but falls after every existing caption, so nothing would change.
   * SUBTITLE-TIMING ONLY — never touches project.video, trimStart/trimEnd, or cutRanges. */
  rippleInsertTime: (insertAtSec: number, durationSec: number) => RippleInsertResult;
  /** "Split Here" — splits the caption at the given playhead time (see lib/subtitles/split.ts's
   * own top-of-file doc comment for the full Task 114761/P18.7 audit this is based on). Task
   * 114761 (P18.7) REPLACED the old word-index-based `splitSubtitle` action entirely: the old
   * array-position-based split (and its "snap the playhead to the nearer word boundary" silent
   * fallback) could corrupt a non-monotonic (Task 113528/P18.6-reordered) caption into an
   * inverted, negative-duration half. This is now a pure time-based partition — every word is
   * assigned to LEFT/RIGHT by its own `[start,end)` interval relative to `time`, in its existing
   * array order (never re-sorted). Rejects ("word-straddles-split") rather than guessing when
   * `time` falls inside a word's own span — no commit, no partial mutation, for any rejection. */
  splitSubtitleAtTime: (id: string, time: number) => SplitSubtitleAtTimeResult;
  /** Re-runs full segmentation from every caption's existing word timestamps and the
   * project's current TimingRules — the "reusable path for re-segmentation" the settings
   * spec calls for, so changing maxWordsPerCaption/smartSegmentation/lines-per-caption after
   * transcription never requires re-running Whisper. Rebuilds caption boundaries from
   * scratch: any per-caption style/animation override or edited text is lost (the words
   * themselves — and their timestamps — are untouched), so this is an explicit, undoable,
   * user-triggered action, not something that runs automatically when settings change.
   * Task 118943 (P18.10): the flattened word list fed to `segmentWords` is sorted by real
   * timestamp first — `segmentWords` walks its input SEQUENTIALLY (grouping consecutive words
   * into captions), so it needs chronological input; simply flattening each caption's own `words`
   * in ARRAY order is not guaranteed chronological once a word has been reordered (P18.6). This
   * sorts only a LOCAL, temporary copy used to rebuild the caption structure from scratch — this
   * action already discards every existing caption's own words array entirely (see above), so
   * there is no persisted textual order being overwritten; the freshly-rebuilt captions' own word
   * order is simply chronological, the only sensible order for a brand-new segmentation to
   * produce. Does NOT sort any OTHER caption's persisted `words` array, and does not run
   * unconditionally on every commit — only when this specific action is explicitly invoked. */
  resegmentAll: () => void;
  /** Merges `id` with the caption immediately after it — "A absorbs B" (see
   * lib/subtitles/merge-subtitles.ts's own top-of-file doc comment for the full Task 114761/P18.7
   * audit and the clampWordsToCaptionBounds corruption bug this replaced: the old implementation
   * ran the concatenated word array through a position-order-dependent clamp that could silently
   * drag a non-monotonic (P18.6-reordered) word's real timing forward. Now a pure concatenation,
   * `a.words` then `b.words` in their existing order — never re-sorted — validated (not
   * destructively repaired) for genuine corruption before committing. "no-next-caption" (no
   * commit) replaces the old silent no-op when `id` is already the last caption. */
  mergeWithNext: (id: string) => MergeWithNextResult;
  reorderSubtitle: (id: string, direction: "up" | "down") => void;

  setGlobalStyle: (patch: Partial<SubtitleStyle>) => void;
  setSubtitleStyleOverride: (id: string, patch: Partial<SubtitleStyle> | null) => void;
  /** Batch analogue of setSubtitleStyleOverride (Task 94820, P8): applies the SAME patch (or
   * clears the override entirely, with `null`) to every caption in `ids` in ONE commit — the
   * exact same shallow-merge-onto-the-caption's-own-existing-override semantics as the
   * single-caption version, just looped, so per-word style overrides on those captions (an
   * entirely independent layer — see Word.style's own doc comment) are never read or touched. */
  applyStyleToSubtitles: (ids: string[], patch: Partial<SubtitleStyle> | null) => void;
  setGlobalAnimation: (patch: Partial<AnimationConfig>) => void;
  setSubtitleAnimationOverride: (id: string, patch: Partial<AnimationConfig> | null) => void;
  /** Batch analogue of setSubtitleAnimationOverride (Task 94820, P8) — same shape as
   * applyStyleToSubtitles, for `animation` instead of `style`. */
  applyAnimationToSubtitles: (ids: string[], patch: Partial<AnimationConfig> | null) => void;
  setWordStyleOverride: (subtitleId: string, wordIndex: number, patch: Partial<SubtitleStyle> | null) => void;
  setTimingRules: (patch: Partial<TimingRules>) => void;
  /** Canvas dimensions, video-layer visibility, and background color — see
   * CompositionSettings. Same undo/redo-tracked patch-merge as setTimingRules. */
  setComposition: (patch: Partial<CompositionSettings>) => void;
  replaceAllSubtitles: (subtitles: Subtitle[]) => void;
  applyPreset: (style: SubtitleStyle, animation: AnimationConfig) => void;
  /**
   * Applies a resolved caption template (P22, lib/caption-templates.ts) to specific captions or to all of them as
   * ONE history step (one commit — undo restores every affected caption at once). Only style/animation change; text,
   * timing, words, order and everything else are untouched. Returns how many captions were restyled; 0 means nothing
   * changed (no targets, or they already match) and no history step was created. Applying to `{ all }` also refreshes
   * `lastAppliedStyleSnapshot` so "Reset changes" in the Presets tab refers to it.
   */
  applyTemplate: (target: TemplateTarget, resolved: ResolvedTemplate) => number;
  /** "RESET CHANGES" (P6 Style Creator, distinct from "RESET TO DEFAULT"): reverts
   * globalStyle/animation to whatever `lastAppliedStyleSnapshot` currently holds — i.e. the
   * style/animation as they were the moment the currently-selected preset (built-in or
   * custom) was applied, discarding any tweaks made since. A no-op if nothing has been
   * applied yet this session. Goes through applyPreset (→ commit()), so it's itself a normal,
   * undoable action — "Reset changes" is just "apply the same snapshot again," not a special
   * code path. */
  resetToLastApplied: () => void;
  applyTextMap: (texts: Record<string, string>) => void;

  /** Copies the resolved style of `subtitleId` (or the project's global style if omitted) to the cross-project clipboard. */
  copyStyle: (subtitleId?: string) => void;
  /** Pastes the clipboard's style+animation onto one caption, or the whole project's global style. */
  pasteStyle: (target: { subtitleId: string } | { all: true }) => boolean;

  findReplace: (search: string, replace: string, all: boolean) => number;
  /** Task 97025 (P10) — batch analogue of findReplace, scoped to `ids` (from P8's
   * `selectedSubtitleIds`, never DOM selection) instead of the whole project, with match-case/
   * whole-word options (see lib/subtitles/batch-text-ops.ts). A caption outside `ids` is never
   * touched, even if its text would otherwise match. Uses the exact same `remapWordsToText` path
   * as findReplace/applyTextMap/updateSubtitleText — a caption whose replacement changes its
   * token count keeps its OLD (now stale, per the existing P7.2 derivation) word array untouched;
   * one whose token count is unchanged keeps its real timestamps exactly as they were. ONE
   * commit (one undo step) for the whole batch, regardless of how many captions actually change;
   * a `search` that matches nothing in the selection makes NO commit at all. Returns a summary
   * for the caller's own success toast — the affected/stale counts always reflect what was
   * ACTUALLY applied, not a possibly-stale earlier preview. */
  applyBatchFindReplace: (
    ids: string[],
    search: string,
    replace: string,
    options: { matchCase: boolean; wholeWord: boolean },
  ) => { totalMatches: number; affectedCount: number; staleCount: number };
  /** Task 97025 (P10) — applies one deterministic case transform (uppercase/lowercase/title
   * case) to every caption in `ids`, in one commit. Same word-timing-safety and
   * selection-scoping guarantees as applyBatchFindReplace; see lib/subtitles/batch-text-ops.ts's
   * applyTextTransform for the exact per-caption transform (whitespace/newlines always
   * preserved exactly; a script with no case distinction, e.g. Devanagari, is left unchanged by
   * design, not a bug). */
  applyBatchTextTransform: (
    ids: string[],
    kind: TextTransformKind,
  ) => { affectedCount: number; staleCount: number };
  /** Task 98134 (P11) — applies the batch TEXT CLEANUP workflow (whitespace cleanup, repeated-
   * punctuation normalization, sentence case, trailing-punctuation ensure/remove, and blank-
   * caption removal — see lib/subtitles/text-cleanup.ts) to every caption in `ids`, in exactly
   * ONE commit regardless of how many captions change AND how many are deleted (a cleanup that
   * both edits some captions and deletes a blank one among them is still one undo step — see
   * that module's own `computeTextCleanupPreview` doc comment). Recomputes the same pure preview
   * the dialog already showed, at the moment Apply is clicked (same "no divergence possible in
   * this single-threaded UI" reasoning applyBatchFindReplace/applyBatchTextTransform already
   * rely on) rather than trusting a stale prop. A selection with nothing to change AND nothing to
   * delete makes NO commit at all. Text-changing captions go through the exact same
   * `remapWordsToText` path as every other text mutation in this file — token-count-preserving
   * edits keep their real word timestamps, token-count-changing edits go stale via the existing
   * derivation, never a fabricated one. */
  applyTextCleanup: (
    ids: string[],
    selection: CleanupSelection,
  ) => { changedCount: number; deletedCount: number; staleCount: number };

  /** Non-destructive video editing (see lib/timeline/edit-model.ts). Trim bounds are source-time; null trimEnd means "to the end". */
  setTrim: (start: number, end: number | null) => void;
  addCutRange: (range: Omit<CutRange, "id">) => void;
  addCutRanges: (ranges: Omit<CutRange, "id">[]) => void;
  removeCutRange: (id: string) => void;
  clearCutRanges: (reason?: CutRange["reason"]) => void;
}

const MAX_HISTORY = 60;

/** The floor on a caption's own duration — matches the timeline drag's pre-existing minimum
 * (see timeline.tsx's onPointerMove, which already used this same 0.1s bound inline before
 * updateSubtitleTiming grew its own overlap-clamping — see that action for why it now lives
 * here too). */
const MIN_CAPTION_DURATION_SEC = 0.1;

export type TimingUpdateResolution =
  | { ok: true; idx: number; clampedStart: number; clampedEnd: number; isPureShift: boolean; wordDelta: number }
  | { ok: false; reason: "not-found" | "word-out-of-bounds" };

/** Task 115894 (P18.8) — the pure clamp-and-validate calculation `updateSubtitleTiming` needs,
 * factored out so it can run TWICE against two different snapshots (see that action below): once
 * outside commit() to decide whether to call commit() AT ALL (so a rejection makes literally zero
 * commit() calls — every other rejecting store action in this file, e.g. mergeWithNext, uses the
 * same "pre-check outside, re-check inside the mutator" shape), and once more inside commit()'s
 * own mutator against the fresh snapshot, as defense against state having changed between the two
 * (the same double-check splitSubtitleAtTime/mergeWithNext already use).
 *
 * Byte-for-byte the same neighbor-clamp arithmetic updateSubtitleTiming always used (unchanged —
 * this task does not touch caption-level overlap prevention or the minimum-duration floor, only
 * what happens to WORDS during a resize). The one addition: for a genuine RESIZE (duration
 * changes — a pure whole-caption SHIFT is untouched, see isPureShift below), every existing word
 * must already fit inside the proposed new bounds (validateWordsWithinCaptionBounds — an
 * order-independent check, unlike the old clampWordsToCaptionBounds-based repair this replaces for
 * this one call site), or the whole resize is rejected. */
/** Task 137421 (P19.12) — exported (was module-private) so timeline.tsx's caption-edge/move drag
 * can call this SAME pure clamp-and-validate calculation directly, on every pointermove, for its
 * OWN live local-state preview WITHOUT committing — mirroring how TimelineWordHandles' own word
 * drag already uses the exported `clampWordTiming` the identical way. This fixes the P1 finding in
 * research/p19_11_release_candidate_gap_audit.md §6 P1-3 (a caption drag previously called the
 * real `updateSubtitleTiming` — a full commit — on every pointermove, so a long drag could push
 * more than MAX_HISTORY distinct undo entries and evict the user's prior history); the timeline
 * now calls this function for live preview and calls `updateSubtitleTiming` exactly once, on
 * pointer-up, with the final clamped result — same validation, same visual "stops at the wall"
 * behavior during the drag, but exactly one commit per gesture. Undo/redo architecture
 * (commit/MAX_HISTORY/snapshot format) is completely untouched by this — only which function the
 * timeline calls, and how often, changed. */
export function resolveTimingUpdate(subtitles: Subtitle[], id: string, start: number, end: number): TimingUpdateResolution {
  const idx = subtitles.findIndex((s) => s.id === id);
  if (idx === -1) return { ok: false, reason: "not-found" };
  const prevEnd = idx > 0 ? subtitles[idx - 1].end : 0;
  const nextStart = idx < subtitles.length - 1 ? subtitles[idx + 1].start : Infinity;
  const clampedStart = Math.max(0, prevEnd, Math.min(start, nextStart - MIN_CAPTION_DURATION_SEC));
  const clampedEnd = Math.min(nextStart, Math.max(end, clampedStart + MIN_CAPTION_DURATION_SEC));
  const original = subtitles[idx];
  const isPureShift = Math.abs(clampedEnd - clampedStart - (original.end - original.start)) < 1e-6;
  if (!isPureShift) {
    const validation = validateWordsWithinCaptionBounds(original.words, clampedStart, clampedEnd);
    if (!validation.ok) return { ok: false, reason: "word-out-of-bounds" };
  }
  return { ok: true, idx, clampedStart, clampedEnd, isPureShift, wordDelta: clampedStart - original.start };
}

/** Shared by commit()/undo()/redo() (Task 94820, P8) — every one of them can change WHICH
 * caption ids exist (a mutation's own subtitles.map/filter, or undo/redo restoring a past/future
 * snapshot with a different set of captions than what's selected right now). Selection is
 * ephemeral, never part of a HistorySnapshot, so undo/redo can't restore it automatically the way
 * they restore caption data — without this, an id could survive in `selectedSubtitleIds` (or as
 * `selectedSubtitleId`/`selectionAnchorId`) referencing a caption that no longer exists, which is
 * exactly the "corrupted/stale selection" this task's own spec forbids. Returns an empty object
 * (no-op patch) when nothing needs pruning — the overwhelmingly common case — so this never
 * forces an extra render for mutations that don't touch selection at all. */
function pruneSelection(
  s: Pick<EditorState, "selectedSubtitleId" | "selectedSubtitleIds" | "selectionAnchorId" | "selectedWordIndex">,
  validIds: Set<string>,
): Partial<EditorState> {
  const prunedIds =
    s.selectedSubtitleIds.size === 0 ? s.selectedSubtitleIds : new Set([...s.selectedSubtitleIds].filter((id) => validIds.has(id)));
  const idsChanged = prunedIds.size !== s.selectedSubtitleIds.size;
  const focusedGone = s.selectedSubtitleId !== null && !validIds.has(s.selectedSubtitleId);
  const anchorGone = s.selectionAnchorId !== null && !validIds.has(s.selectionAnchorId);
  if (!idsChanged && !focusedGone && !anchorGone) return {};
  return {
    selectedSubtitleIds: idsChanged ? prunedIds : s.selectedSubtitleIds,
    selectedSubtitleId: focusedGone ? null : s.selectedSubtitleId,
    selectedWordIndex: focusedGone ? null : s.selectedWordIndex,
    selectionAnchorId: anchorGone ? null : s.selectionAnchorId,
  };
}

function snapshotOf(project: ProjectData): HistorySnapshot {
  return {
    subtitles: project.subtitles,
    globalStyle: project.globalStyle,
    animation: project.animation,
    timingRules: project.timingRules,
    composition: project.composition,
    trimStart: project.trimStart,
    trimEnd: project.trimEnd,
    cutRanges: project.cutRanges,
  };
}

/** Fills in `hinglishText` for any subtitle that's missing it, but ONLY when the project
 * is actually in "hinglish" mode — a no-op array-identity-preserving pass otherwise. Applied
 * at every place a subtitle can newly appear or change (commit() — covering split,
 * duplicate, merge, delete, reorder, text edits, applyTextMap, replaceAllSubtitles — and
 * load()), so a caption created by split/duplicate/paste, or a brand-new project loaded
 * while already in hinglish mode, always has a valid Hinglish rendering immediately,
 * without ever touching a caption that already has one (generateHinglishForSubtitle only
 * fills gaps — see lib/subtitles/output-mode.ts — so an existing generated OR user-edited
 * hinglishText is always left exactly as it was). Regenerates only the affected captions,
 * never the whole project, since untouched captions already have hinglishText and are
 * skipped by the `every` check below before any mapping happens. */
function ensureHinglishCoverage(subtitles: Subtitle[], mode: CaptionOutputMode): Subtitle[] {
  if (mode !== "hinglish" || subtitles.every((s) => s.hinglishText !== undefined)) return subtitles;
  return subtitles.map((s) => (s.hinglishText === undefined ? generateHinglishForSubtitle(s) : s));
}

/** Gujarati-script analogue of ensureHinglishCoverage — same no-op-when-nothing-to-do,
 * fill-only-what's-missing convention, applied at the same call sites (commit(), load(),
 * setCaptionOutputMode()) so a caption created by split/duplicate/paste, or a project
 * loaded while already in "gujarati-script" mode, always has a valid Gujarati-script
 * rendering immediately, without ever touching a caption that already has one. */
function ensureGujaratiScriptCoverage(subtitles: Subtitle[], mode: CaptionOutputMode): Subtitle[] {
  if (mode !== "gujarati-script" || subtitles.every((s) => s.gujaratiScriptText !== undefined)) return subtitles;
  return subtitles.map((s) => (s.gujaratiScriptText === undefined ? generateGujaratiScriptForSubtitle(s) : s));
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  selectedSubtitleId: null,
  selectedWordIndex: null,
  selectedSubtitleIds: new Set(),
  selectionAnchorId: null,
  lastAppliedCustomPresetId: null,
  lastAppliedStyleSnapshot: null,
  isPlaying: false,
  currentTime: 0,
  seekRequest: null,
  focusCaptionRequest: null,
  dirty: false,
  saveState: "idle",
  aiToolsDemo: true,
  transcriptionDemo: true,
  qualityReport: null,
  qualityReportSubtitles: null,
  qualityIssueIndex: null,
  reviewedIssueIds: new Set(),
  captionClipboard: null,
  setCaptionClipboard: (captionClipboard) => set({ captionClipboard }),
  past: [],
  future: [],

  load: (project) => {
    const withHinglish = ensureHinglishCoverage(project.subtitles, project.captionOutputMode);
    const subtitles = ensureGujaratiScriptCoverage(withHinglish, project.captionOutputMode);
    // ensureHinglishCoverage/ensureGujaratiScriptCoverage return the SAME array reference
    // when there was nothing to fill in (the overwhelmingly common case) — only mark dirty
    // when one of them actually generated something, so that gets persisted promptly
    // instead of sitting client-side-only until some unrelated edit triggers the next autosave.
    const generated = subtitles !== project.subtitles;
    set({
      project: { ...project, subtitles },
      past: [],
      future: [],
      selectedSubtitleId: null,
      selectedWordIndex: null,
      selectedSubtitleIds: new Set(),
      selectionAnchorId: null,
      lastAppliedCustomPresetId: null,
      lastAppliedStyleSnapshot: null,
      dirty: generated,
      saveState: "idle",
      // A report from whatever project was open before (or a stale one from this same project
      // pre-reload/crash-recovery) must never be shown as if it still describes the data below.
      qualityReport: null,
      qualityReportSubtitles: null,
      qualityIssueIndex: null,
      reviewedIssueIds: new Set(),
      // Task 101583 (P14): a caption-text clipboard populated while editing one project should
      // not silently paste into a DIFFERENT one loaded afterward — same reasoning as every other
      // per-project ephemeral field reset here.
      captionClipboard: null,
    });
  },
  runQualityAnalysis: () => {
    const { project } = get();
    if (!project) return;
    set({
      qualityReport: analyzeSubtitleQuality(project.subtitles, project.timingRules),
      qualityReportSubtitles: project.subtitles,
      // A fresh report's issues may not correspond at all to whatever the cursor was pointing
      // at in a previous report — start clean, same as the quality panel dialog's own analyze().
      qualityIssueIndex: null,
      // Task 99261 (P12): a fresh report's issue ids may not even overlap the previous report's
      // — carrying old "reviewed" entries forward would silently claim progress on issues the
      // reviewer never actually looked at in THIS report.
      reviewedIssueIds: new Set(),
    });
  },
  runQualityAnalysisAndReview: () => {
    get().runQualityAnalysis();
    const { qualityReport } = get();
    if (qualityReport && qualityReport.issues.length > 0) {
      get().goToQualityIssue(1);
    }
  },
  goToQualityIssue: (delta) => {
    const { qualityReport, project, qualityIssueIndex } = get();
    if (!project || !qualityReport || qualityReport.issues.length === 0) return false;
    const base = qualityIssueIndex ?? -1;
    const next = Math.max(0, Math.min(qualityReport.issues.length - 1, base + delta));
    const issue = qualityReport.issues[next];
    set((s) => ({ qualityIssueIndex: next, reviewedIssueIds: new Set(s.reviewedIssueIds).add(issue.id) }));
    const sub = project.subtitles.find((s) => s.id === issue.captionId);
    // The report can reference a caption that no longer exists (deleted since analysis ran) —
    // still move the cursor (so repeated presses can step past it), just skip the navigation.
    if (sub) {
      get().selectSubtitle(sub.id);
      get().seek(sub.start);
      // Task 99261 (P12): select the issue's specific word for a word-targeted issue (its
      // wordIndex — see quality-analyzer.ts), or explicitly clear word selection otherwise
      // (selectSubtitle already cleared it when moving to a DIFFERENT caption, but this also
      // covers navigating between two word-level issues on the SAME caption, and re-navigating
      // to the same caption+word after the user manually selected a different word meanwhile).
      get().selectWord(issue.wordIndex ?? null);
    }
    return true;
  },
  setAiToolsDemo: (aiToolsDemo) => set({ aiToolsDemo }),
  setTranscriptionDemo: (transcriptionDemo) => set({ transcriptionDemo }),

  selectSubtitle: (id) =>
    set((s) => ({
      selectedSubtitleId: id,
      selectedWordIndex: id === s.selectedSubtitleId ? s.selectedWordIndex : null,
      // Task 94820 (P8): a plain (unmodified) select always collapses any active multi-selection
      // down to just this one caption (or to nothing, for a deselect) — the same behavior every
      // existing call site of selectSubtitle already gets for free (plain click, quality-issue
      // nav, keyboard caption nav, Tab, Escape's deselect), matching this task's own explicit
      // "normal click selects one + clears multi-selection" requirement and giving a single,
      // deterministic answer to "does jumping to a quality issue destroy my multi-selection?" —
      // yes, always, since goToQualityIssue calls this same action.
      selectedSubtitleIds: id === null ? new Set() : new Set([id]),
      selectionAnchorId: id,
    })),
  selectWord: (index) => set({ selectedWordIndex: index }),

  toggleSubtitleSelection: (id) =>
    set((s) => {
      const next = new Set(s.selectedSubtitleIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) {
        return { selectedSubtitleIds: next, selectedSubtitleId: null, selectedWordIndex: null, selectionAnchorId: null };
      }
      return {
        selectedSubtitleIds: next,
        selectedSubtitleId: id,
        selectedWordIndex: id === s.selectedSubtitleId ? s.selectedWordIndex : null,
        selectionAnchorId: s.selectionAnchorId ?? id,
      };
    }),

  selectSubtitleRange: (targetId) => {
    const { project, selectionAnchorId, selectedSubtitleId } = get();
    if (!project) return;
    const anchor = selectionAnchorId ?? selectedSubtitleId ?? targetId;
    const subs = project.subtitles;
    const anchorIdx = subs.findIndex((s) => s.id === anchor);
    const targetIdx = subs.findIndex((s) => s.id === targetId);
    if (anchorIdx === -1 || targetIdx === -1) {
      get().selectSubtitle(targetId);
      return;
    }
    const [lo, hi] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    const ids = new Set(subs.slice(lo, hi + 1).map((s) => s.id));
    set({ selectedSubtitleIds: ids, selectedSubtitleId: targetId, selectionAnchorId: anchor, selectedWordIndex: null });
  },

  selectAllSubtitles: () =>
    set((s) => {
      if (!s.project || s.project.subtitles.length === 0) return s;
      const ids = new Set(s.project.subtitles.map((sub) => sub.id));
      const keepFocused = s.selectedSubtitleId !== null && ids.has(s.selectedSubtitleId);
      const focused = keepFocused ? s.selectedSubtitleId : s.project.subtitles[0].id;
      return {
        selectedSubtitleIds: ids,
        selectedSubtitleId: focused,
        selectedWordIndex: keepFocused ? s.selectedWordIndex : null,
        selectionAnchorId: s.selectionAnchorId && ids.has(s.selectionAnchorId) ? s.selectionAnchorId : focused,
      };
    }),
  setLastAppliedCustomPresetId: (id) => set({ lastAppliedCustomPresetId: id }),

  requestCaptionFocus: (id) =>
    set((s) => ({ focusCaptionRequest: { id, token: (s.focusCaptionRequest?.token ?? 0) + 1 } })),

  seek: (time) =>
    set((s) => ({ currentTime: time, seekRequest: { time, token: (s.seekRequest?.token ?? 0) + 1 } })),

  setCurrentTime: (time) => set({ currentTime: time }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  markDirty: () => set({ dirty: true }),
  setSaveState: (saveState) => set({ saveState }),

  commit: (mutator) => {
    const { project } = get();
    if (!project) return;
    const before = snapshotOf(project);
    const after = mutator(before);
    const withHinglish = ensureHinglishCoverage(after.subtitles, project.captionOutputMode);
    const subtitles = ensureGujaratiScriptCoverage(withHinglish, project.captionOutputMode);
    set((s) => ({
      project: { ...project, ...after, subtitles },
      past: [...s.past, before].slice(-MAX_HISTORY),
      future: [],
      dirty: true,
      ...pruneSelection(s, new Set(subtitles.map((sub) => sub.id))),
    }));
  },

  undo: () => {
    const { past, project } = get();
    if (!past.length || !project) return;
    const previous = past[past.length - 1];
    const current = snapshotOf(project);
    // Task 137421 (P19.12) — fixes the P1 finding in
    // research/p19_11_release_candidate_gap_audit.md §6: `captionOutputMode` is a project-level
    // "which text is currently displayed" setting, deliberately NOT part of a HistorySnapshot
    // (setCaptionOutputMode itself is not a commit — see its own doc comment), so it's untouched
    // by undo. The snapshot being restored here can therefore predate the mode this project is
    // CURRENTLY in ever having been switched to — e.g. undo crossing back past the very commit
    // that happened right before a Hinglish/Gujarati switch — leaving some/all captions with no
    // hinglishText/gujaratiScriptText even though the editor is still displaying that mode. The
    // exact same gap-filling regeneration commit()/load() already apply closes it here too: it
    // NEVER overwrites existing (generated or user-edited) derived text, only fills what this
    // specific restored snapshot is missing.
    const withHinglish = ensureHinglishCoverage(previous.subtitles, project.captionOutputMode);
    const subtitles = ensureGujaratiScriptCoverage(withHinglish, project.captionOutputMode);
    set((s) => ({
      project: { ...project, ...previous, subtitles },
      past: past.slice(0, -1),
      future: [current, ...s.future].slice(0, MAX_HISTORY),
      dirty: true,
      ...pruneSelection(s, new Set(subtitles.map((sub) => sub.id))),
    }));
  },

  redo: () => {
    const { future, project } = get();
    if (!future.length || !project) return;
    const next = future[0];
    const current = snapshotOf(project);
    // Task 137421 (P19.12) — same reasoning as undo() just above, symmetric direction: a `future`
    // snapshot can equally predate the project's CURRENT captionOutputMode if the mode was
    // switched again after the undo that produced this snapshot.
    const withHinglish = ensureHinglishCoverage(next.subtitles, project.captionOutputMode);
    const subtitles = ensureGujaratiScriptCoverage(withHinglish, project.captionOutputMode);
    set((s) => ({
      project: { ...project, ...next, subtitles },
      future: future.slice(1),
      past: [...s.past, current].slice(-MAX_HISTORY),
      dirty: true,
      ...pruneSelection(s, new Set(subtitles.map((sub) => sub.id))),
    }));
  },

  updateSubtitleText: (id, text) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        s.id === id
          ? { ...s, text, words: remapWordsToText(s.words, text), hinglishText: undefined, gujaratiScriptText: undefined }
          : s,
      ),
    })),

  setCaptionOutputMode: (mode) => {
    const { project } = get();
    if (!project) return;
    const withHinglish = ensureHinglishCoverage(project.subtitles, mode);
    const subtitles = ensureGujaratiScriptCoverage(withHinglish, mode);
    set({ project: { ...project, captionOutputMode: mode, subtitles }, dirty: true });
  },

  updateSubtitleHinglishText: (id, hinglishText) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        s.id === id ? { ...s, hinglishText, words: remapHinglishWordsToText(s.words, hinglishText) } : s,
      ),
    })),

  updateSubtitleGujaratiScriptText: (id, gujaratiScriptText) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        s.id === id
          ? { ...s, gujaratiScriptText, words: remapGujaratiScriptWordsToText(s.words, gujaratiScriptText) }
          : s,
      ),
    })),

  // Clamp against the immediately-adjacent captions (the array is kept sorted by start — see
  // the .sort() below — so index-adjacent IS time-adjacent) so a timing change can never create
  // an overlap, the same "stops at the neighboring clip" behavior virtually every timeline-based
  // editor already has. Applies uniformly regardless of caller — the timeline's own edge/whole-
  // block drag AND the keyboard timing-nudge shortcut both funnel through this one function, so
  // both get this guarantee for free.
  //
  // A WHOLE-BLOCK move (the timeline's "move" drag, or nudgeSubtitleTiming) preserves the
  // caption's duration exactly and only translates it — in that one unambiguous case, shift every
  // word's own start/end by the same delta so karaoke highlighting and quality validation stay in
  // sync with the caption's new position. A RESIZE (only one edge moves, changing duration) is
  // handled entirely differently (Task 115894, P18.8 — see resolveTimingUpdate above): every
  // existing word must already fit inside the proposed new bounds, checked independently of
  // every other word and of its own array position (validateWordsWithinCaptionBounds), or the
  // ENTIRE resize is rejected — "word-out-of-bounds", zero mutation. Task 93471 (P7.3) originally
  // had this REPOSITION a violating word back inside the new bounds via clampWordsToCaptionBounds,
  // walking the array in order with a running lower bound — safe only because every caption's
  // words were chronologically sorted at the time. Task 113528 (P18.6) made that assumption false
  // (an explicit word reorder can put a chronologically-earlier word LATER in the array), so that
  // walk could silently drag a valid, reordered word's real timestamp forward to wherever the
  // previous (array-order) word happened to end — see editor-store-resize-word-bounds.test.ts's
  // own "MANDATORY REGRESSION" test for the exact reproduction this replaces.
  updateSubtitleTiming: (id, start, end) => {
    const { project } = get();
    if (!project) return "not-found";
    const pre = resolveTimingUpdate(project.subtitles, id, start, end);
    if (!pre.ok) return pre.reason;
    get().commit((snap) => {
      const fresh = resolveTimingUpdate(snap.subtitles, id, start, end);
      if (!fresh.ok) return snap; // state changed between the check above and this commit — no-op
      const { idx, clampedStart, clampedEnd, isPureShift, wordDelta } = fresh;
      return {
        ...snap,
        subtitles: snap.subtitles
          .map((s, i) =>
            i === idx
              ? {
                  ...s,
                  start: clampedStart,
                  end: clampedEnd,
                  // A resize's words are already validated as fully inside the new bounds (or
                  // this whole update would have been rejected above), so — unlike the old
                  // clamp-and-reposition behavior — nothing about them ever needs to change; the
                  // exact same `words` reference is kept (Task 115894, P18.8's own "word object
                  // reference preservation" requirement).
                  words: isPureShift && wordDelta !== 0 ? s.words.map((w) => ({ ...w, start: w.start + wordDelta, end: w.end + wordDelta })) : s.words,
                }
              : s,
          )
          .sort((a, b) => a.start - b.start),
      };
    });
    return "ok";
  },

  nudgeSubtitleTiming: (id, deltaSec) => {
    const { project } = get();
    if (!project) return;
    const idx = project.subtitles.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const sub = project.subtitles[idx];
    // Clamp the DELTA itself (not just the resulting start/end) so a nudge that would bump
    // into a neighbor simply stops there — preserving the caption's own duration exactly —
    // rather than letting updateSubtitleTiming's own start/end clamp squeeze it shorter. Always
    // a pure shift (see updateSubtitleTiming's own doc comment) — the "word-out-of-bounds"
    // result is not possible here, so it's safe to ignore.
    const prevEnd = idx > 0 ? project.subtitles[idx - 1].end : 0;
    const nextStart = idx < project.subtitles.length - 1 ? project.subtitles[idx + 1].start : Infinity;
    const clampedDelta = Math.max(prevEnd - sub.start, Math.min(nextStart - sub.end, deltaSec));
    get().updateSubtitleTiming(id, sub.start + clampedDelta, sub.end + clampedDelta);
  },

  nudgeSubtitles: (ids, deltaSec) => {
    const { project } = get();
    if (!project || ids.length === 0) return;
    const idSet = new Set(ids);
    const subs = project.subtitles;
    // Single pass over the whole (sorted) array — O(n) regardless of how many of the n captions
    // are selected, never O(selected * n) — see this action's own doc comment on why a batch
    // nudge can't just loop nudgeSubtitleTiming per id (stale neighbor bounds) and this task's
    // own "do not iterate the whole dataset repeatedly per selected caption" requirement.
    let lower = -Infinity;
    let upper = Infinity;
    let anySelected = false;
    let earliestStart = Infinity;
    for (let i = 0; i < subs.length; i++) {
      if (!idSet.has(subs[i].id)) continue;
      anySelected = true;
      earliestStart = Math.min(earliestStart, subs[i].start);
      // Only a NON-selected neighbor constrains the delta — two adjacent selected captions move
      // together by the same delta, so the gap (or lack of one) between them never changes and
      // can never newly collide with itself.
      if (i > 0 && !idSet.has(subs[i - 1].id)) lower = Math.max(lower, subs[i - 1].end - subs[i].start);
      if (i < subs.length - 1 && !idSet.has(subs[i + 1].id)) upper = Math.min(upper, subs[i + 1].start - subs[i].end);
    }
    if (!anySelected) return;
    lower = Math.max(lower, -earliestStart); // never shift the earliest selected caption before 0
    const clampedDelta = Math.max(lower, Math.min(upper, deltaSec));
    if (clampedDelta === 0) return;
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        idSet.has(s.id)
          ? {
              ...s,
              start: s.start + clampedDelta,
              end: s.end + clampedDelta,
              words: s.words.map((w) => ({ ...w, start: w.start + clampedDelta, end: w.end + clampedDelta })),
            }
          : s,
      ),
    }));
  },

  setSubtitleBoundaryToPlayhead: (id, edge) => {
    const { project, currentTime } = get();
    if (!project) return false;
    const idx = project.subtitles.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    const sub = project.subtitles[idx];
    const prevEnd = idx > 0 ? project.subtitles[idx - 1].end : null;
    const nextStart = idx < project.subtitles.length - 1 ? project.subtitles[idx + 1].start : null;
    const resolved = resolveBoundaryToPlayhead(edge, {
      captionStart: sub.start,
      captionEnd: sub.end,
      playheadTime: currentTime,
      prevEnd,
      nextStart,
      minDurationSec: MIN_CAPTION_DURATION_SEC,
    });
    if (!resolved) return false;
    // updateSubtitleTiming is the ONE existing timing-mutation path (overlap clamp, min-duration
    // floor) — resolveBoundaryToPlayhead already proved the caption-level bounds are valid, so
    // this call is a pass-through, never a second/different clamp. Task 115894 (P18.8):
    // updateSubtitleTiming can now separately reject on "word-out-of-bounds" (resolveBoundaryToPlayhead
    // has no notion of word timing), so its result is checked here to preserve this action's own
    // "no commit at all when invalid" contract.
    return get().updateSubtitleTiming(id, resolved.start, resolved.end) === "ok";
  },

  updateWordTiming: (subtitleId, wordIndex, start, end) => {
    // Task 117206 (P18.9) — pre-check OUTSIDE commit(), same "decide before committing" shape
    // updateSubtitleTiming/splitSubtitleAtTime/mergeWithNext already use: commit() unconditionally
    // pushes a history entry and sets dirty whenever it's called, so the only way to guarantee
    // ZERO of that for a request clampWordTiming can't satisfy is to never call commit() at all.
    const { project } = get();
    if (!project) return;
    const subtitle = project.subtitles.find((s) => s.id === subtitleId);
    if (!subtitle || !clampWordTiming(subtitle, wordIndex, start, end)) return;
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        // Re-derived against the FRESH snapshot — state could in principle have changed between
        // the check above and this call — a no-op (`return s`) here if it's no longer
        // satisfiable, matching the same defensive double-check every other rejecting action uses.
        const clamped = clampWordTiming(s, wordIndex, start, end);
        if (!clamped) return s;
        const words = s.words.map((w, i) => (i === wordIndex ? { ...w, start: clamped.start, end: clamped.end } : w));
        return { ...s, words };
      }),
    }));
  },

  rebuildWordTiming: (subtitleId) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        s.id === subtitleId ? { ...s, words: evenlyDistributeWords(tokenizeCaptionText(s.text), s.start, s.end) } : s,
      ),
    })),

  splitWord: (subtitleId, wordIndex, leftText, rightText) => {
    const { project } = get();
    if (!project) return false;
    const sub = project.subtitles.find((s) => s.id === subtitleId);
    if (!sub || wordIndex < 0 || wordIndex >= sub.words.length) return false;
    // Feasibility (empty text, sub-minimum-duration halves) is decided PURELY here, before any
    // commit — an infeasible request makes no commit at all, matching every other reject-without-
    // mutating action in this file (duplicateSubtitle's "no-room", resolveBoundaryToPlayhead's own
    // invalid-request guard).
    const result = splitWordText(sub.words[wordIndex], leftText, rightText);
    if (!result) return false;
    get().commit((snap) => {
      const rules = snap.timingRules;
      const subtitles = snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        const words = [...s.words.slice(0, wordIndex), result.left, result.right, ...s.words.slice(wordIndex + 1)];
        // Recomputed from the NEW word sequence (not the caption's own pre-split text) — the same
        // "derive .text from words" shape splitSubtitleAt/mergeWithNext already use, so
        // isWordTimingStale (a pure words.length-vs-token-count check) reads this caption as
        // freshly correct, never stale, right after the split.
        // Task 137421 (P19.12) — reconstructed caption text must reflect only the words the user
        // actually sees (non-removed) — a soft-deleted filler word (removed: true) is intentionally
        // KEPT in the `words` array (its timing/style/confidence metadata is preserved, per the
        // existing soft-delete design), but must never resurface in the visible/exported `.text`
        // just because a later structural edit happened to rebuild it. Fixes the P1 finding in
        // research/p19_11_release_candidate_gap_audit.md §6 (B1): every one of this file's five
        // "rebuild .text from the new words array" call sites had this same gap.
        const text = breakIntoLines(words.filter((w) => !w.removed).map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
        return { ...s, words, text, hinglishText: undefined, gujaratiScriptText: undefined };
      });
      return { ...snap, subtitles };
    });
    // Keep the selection on the LEFT half — same index the original word occupied.
    set({ selectedWordIndex: wordIndex });
    return true;
  },

  mergeWordWithNext: (subtitleId, wordIndex) => {
    const { project } = get();
    if (!project) return false;
    const sub = project.subtitles.find((s) => s.id === subtitleId);
    if (!sub || wordIndex < 0 || wordIndex >= sub.words.length - 1) return false; // no next word to merge with
    // Task 118943 (P18.10): `word`/`nextWord` are only guaranteed TEXTUALLY adjacent (P18.6 word
    // reorder can put a chronologically-distant word right next to this one in the array) —
    // mergeWords itself now spans [min,max] of both real timestamps (never inverted), but that
    // span could still silently swallow a THIRD word sitting chronologically between the two being
    // merged. Checked OUTSIDE commit() — same "decide before committing" shape every other
    // rejecting action in this file uses — so a rejected merge makes zero commit() calls.
    const candidate = mergeWords(sub.words[wordIndex], sub.words[wordIndex + 1]);
    if (overlapsOtherWord(candidate, sub.words, new Set([wordIndex, wordIndex + 1]))) return false;
    get().commit((snap) => {
      const rules = snap.timingRules;
      const subtitles = snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        const merged = mergeWords(s.words[wordIndex], s.words[wordIndex + 1]);
        const words = [...s.words.slice(0, wordIndex), merged, ...s.words.slice(wordIndex + 2)];
        // Task 137421 (P19.12) — reconstructed caption text must reflect only the words the user
        // actually sees (non-removed) — a soft-deleted filler word (removed: true) is intentionally
        // KEPT in the `words` array (its timing/style/confidence metadata is preserved, per the
        // existing soft-delete design), but must never resurface in the visible/exported `.text`
        // just because a later structural edit happened to rebuild it. Fixes the P1 finding in
        // research/p19_11_release_candidate_gap_audit.md §6 (B1): every one of this file's five
        // "rebuild .text from the new words array" call sites had this same gap.
        const text = breakIntoLines(words.filter((w) => !w.removed).map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
        return { ...s, words, text, hinglishText: undefined, gujaratiScriptText: undefined };
      });
      return { ...snap, subtitles };
    });
    set({ selectedWordIndex: wordIndex });
    return true;
  },

  deleteWord: (subtitleId, wordIndex) => {
    const { project } = get();
    if (!project) return;
    const sub = project.subtitles.find((s) => s.id === subtitleId);
    if (!sub) return;
    const words = deleteWordConservative(sub.words, wordIndex);
    if (words === null) return;
    get().commit((snap) => {
      const rules = snap.timingRules;
      const subtitles = snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        // Task 137421 (P19.12) — reconstructed caption text must reflect only the words the user
        // actually sees (non-removed) — a soft-deleted filler word (removed: true) is intentionally
        // KEPT in the `words` array (its timing/style/confidence metadata is preserved, per the
        // existing soft-delete design), but must never resurface in the visible/exported `.text`
        // just because a later structural edit happened to rebuild it. Fixes the P1 finding in
        // research/p19_11_release_candidate_gap_audit.md §6 (B1): every one of this file's five
        // "rebuild .text from the new words array" call sites had this same gap.
        const text = breakIntoLines(words.filter((w) => !w.removed).map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
        return { ...s, words, text, hinglishText: undefined, gujaratiScriptText: undefined };
      });
      return { ...snap, subtitles };
    });
    // The word at `wordIndex` no longer exists — move the selection to whatever now occupies
    // that position (the collapse rule never removes MORE than the one deleted word, so this is
    // always either "the word that shifted into this slot" or, if the deletion was at the very
    // end, the new last word), or clear it entirely if the caption has no words left at all.
    set((s) => {
      if (s.selectedWordIndex === null) return {};
      if (words.length === 0) return { selectedWordIndex: null };
      return { selectedWordIndex: Math.min(s.selectedWordIndex, words.length - 1) };
    });
  },

  insertWord: (subtitleId, wordIndex, side, text) => {
    const { project } = get();
    if (!project) return false;
    const sub = project.subtitles.find((s) => s.id === subtitleId);
    if (!sub) return false;
    // Feasibility (text normalization, minimum-gap check) is decided PURELY here, before any
    // commit — an infeasible request makes no commit at all, matching splitWord/mergeWordWithNext's
    // own reject-without-mutating shape.
    const result = resolveWordInsertion(sub.words, wordIndex, side, text, sub.start, sub.end);
    if (!result) return false;
    get().commit((snap) => {
      const rules = snap.timingRules;
      const subtitles = snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        const words = [...s.words.slice(0, result.index), result.word, ...s.words.slice(result.index)];
        // Task 137421 (P19.12) — reconstructed caption text must reflect only the words the user
        // actually sees (non-removed) — a soft-deleted filler word (removed: true) is intentionally
        // KEPT in the `words` array (its timing/style/confidence metadata is preserved, per the
        // existing soft-delete design), but must never resurface in the visible/exported `.text`
        // just because a later structural edit happened to rebuild it. Fixes the P1 finding in
        // research/p19_11_release_candidate_gap_audit.md §6 (B1): every one of this file's five
        // "rebuild .text from the new words array" call sites had this same gap.
        const text = breakIntoLines(words.filter((w) => !w.removed).map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
        return { ...s, words, text, hinglishText: undefined, gujaratiScriptText: undefined };
      });
      return { ...snap, subtitles };
    });
    set({ selectedWordIndex: result.index });
    return true;
  },

  reorderWord: (subtitleId, fromIndex, toIndex) => {
    const { project } = get();
    if (!project) return "not-found";
    const sub = project.subtitles.find((s) => s.id === subtitleId);
    if (!sub) return "not-found";
    // Feasibility decided PURELY here, before any commit — matches every other reject-without-
    // mutating action in this file.
    const resolution = reorderSubtitleWord(sub, fromIndex, toIndex);
    if (!resolution.ok) return resolution.reason;
    get().commit((snap) => {
      const rules = snap.timingRules;
      const subtitles = snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        const fresh = reorderSubtitleWord(s, fromIndex, toIndex);
        if (!fresh.ok) return s; // state changed between the check above and this commit — no-op
        const words = fresh.subtitle.words;
        // Task 137421 (P19.12) — reconstructed caption text must reflect only the words the user
        // actually sees (non-removed) — a soft-deleted filler word (removed: true) is intentionally
        // KEPT in the `words` array (its timing/style/confidence metadata is preserved, per the
        // existing soft-delete design), but must never resurface in the visible/exported `.text`
        // just because a later structural edit happened to rebuild it. Fixes the P1 finding in
        // research/p19_11_release_candidate_gap_audit.md §6 (B1): every one of this file's five
        // "rebuild .text from the new words array" call sites had this same gap.
        const text = breakIntoLines(words.filter((w) => !w.removed).map((w) => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines).join("\n");
        return { ...fresh.subtitle, text, hinglishText: undefined, gujaratiScriptText: undefined };
      });
      return { ...snap, subtitles };
    });
    // Keep selection on the moved word at its NEW position — same "follow what the user just
    // acted on" convention splitWord uses (keeps selection on the left half after a split).
    set({ selectedWordIndex: toIndex });
    return "ok";
  },

  regenerateDerivedWordText: (subtitleId, mode) => {
    const { project } = get();
    if (!project) return false;
    const sub = project.subtitles.find((s) => s.id === subtitleId);
    if (!sub) return false;
    // Feasibility decided PURELY here, before any commit — matches every other reject-without-
    // mutating action in this file: a caption that's already synchronized (or has no cached
    // derived text for `mode` yet at all) has nothing to regenerate, so this makes no commit and
    // no pointless undo entry.
    if (!isDerivedWordTextStale(sub, mode)) return false;
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        return mode === "hinglish" ? regenerateHinglishForSubtitle(s) : regenerateGujaratiScriptForSubtitle(s);
      }),
    }));
    return true;
  },

  deleteSubtitle: (id) => {
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.filter((s) => s.id !== id).map((s, i) => ({ ...s, index: i })),
    }));
    // Task 93471 (P7.3): selectedWordIndex refers to a position inside the just-deleted
    // caption's own words array — it must not outlive its parent's deselection (matches
    // selectSubtitle's own "word selection can't survive its parent caption being deselected"
    // rule). Without this, a delete-then-undo left selectedSubtitleId null but selectedWordIndex
    // pointing at a word index with no selected caption at all — undo/redo never touch selection
    // state (it's ephemeral UI state, not part of the history snapshot), so this had to be fixed
    // at the point of deletion itself.
    if (get().selectedSubtitleId === id) set({ selectedSubtitleId: null, selectedWordIndex: null });
  },

  deleteSubtitles: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.filter((s) => !idSet.has(s.id)).map((s, i) => ({ ...s, index: i })),
    }));
    // commit()'s own pruneSelection already clears any deleted id out of selectedSubtitleIds/
    // selectedSubtitleId/selectionAnchorId (they no longer exist in the post-commit subtitles),
    // so nothing further is needed here — unlike deleteSubtitle, which predates that generic
    // mechanism and keeps its own explicit check for backward-compatible test coverage.
  },

  duplicateSubtitle: (id) => {
    const { project } = get();
    if (!project) return "no-room";
    const idx = project.subtitles.findIndex((s) => s.id === id);
    if (idx === -1) return "no-room";
    const original = project.subtitles[idx];
    const next = idx < project.subtitles.length - 1 ? project.subtitles[idx + 1] : null;
    // Task 95640 (P9): computed BEFORE commit() so a copy is only ever placed when it's
    // collision-safe — see lib/subtitles/duplicate-timing.ts for why only the immediate next
    // caption needs checking. Reading `project` here (not `snap` inside the mutator) matches
    // duplicateSubtitles' own existing pattern: synchronous, no divergence is possible between
    // this read and the commit() call right after it.
    const shift = resolveSingleDuplicateShift(original, next);
    if (shift === null) return "no-room";
    get().commit((snap) => {
      const o = snap.subtitles[idx];
      // Words carry their own absolute start/end (used for karaoke highlighting and quality
      // validation) — shifting the caption forward without shifting its words by the exact
      // same amount would leave every word timestamped for the ORIGINAL caption's time range,
      // completely outside the duplicate's own [start, end) bounds.
      const words = o.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }));
      const copy: Subtitle = { ...o, id: nanoid(10), start: o.start + shift, end: o.end + shift, words };
      const subtitles = [...snap.subtitles.slice(0, idx + 1), copy, ...snap.subtitles.slice(idx + 1)].map((s, i) => ({
        ...s,
        index: i,
      }));
      return { ...snap, subtitles };
    });
    return "ok";
  },

  duplicateSubtitles: (ids) => {
    const { project } = get();
    if (!project || ids.length === 0) return "no-room";
    const idSet = new Set(ids);
    const subs = project.subtitles;
    const indices = subs.map((s, i) => (idSet.has(s.id) ? i : -1)).filter((i) => i !== -1);
    if (indices.length === 0) return "no-room";
    const isContiguous = indices.every((idx, k) => k === 0 || idx === indices[k - 1] + 1);
    if (!isContiguous) return "non-contiguous";
    const startIdx = indices[0];
    const endIdx = indices[indices.length - 1];
    const block = subs.slice(startIdx, endIdx + 1);
    const next = endIdx < subs.length - 1 ? subs[endIdx + 1] : null;
    // Task 95640 (P9): same collision-safe fit-check as duplicateSubtitle, applied to the whole
    // block's own total width at once (never per-caption — see this module's own doc comment on
    // why single/batch must share exactly one rule, and duplicate-timing.ts's own doc comment on
    // why checking only the immediate next caption is sufficient).
    const shift = resolveBlockDuplicateShift(block, next);
    if (shift === null) return "no-room";
    get().commit((snap) => {
      const freshBlock = snap.subtitles.slice(startIdx, endIdx + 1);
      // Same "shift by the block's own total width" rule duplicateSubtitle uses for a single
      // caption, applied to the whole contiguous block at once — the copy starts exactly where
      // the original block ends, preserving every caption's own duration and every gap between
      // them (including any pre-existing internal spacing) untouched.
      const copies: Subtitle[] = freshBlock.map((s) => ({
        ...s,
        id: nanoid(10),
        start: s.start + shift,
        end: s.end + shift,
        words: s.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })),
      }));
      const subtitles = [...snap.subtitles.slice(0, endIdx + 1), ...copies, ...snap.subtitles.slice(endIdx + 1)].map((s, i) => ({
        ...s,
        index: i,
      }));
      return { ...snap, subtitles };
    });
    return "ok";
  },

  rippleDeleteSubtitles: (ids) => {
    const { project } = get();
    if (!project) return "empty-selection";
    const idSet = new Set(ids);
    const resolution = resolveRippleDelete(project.subtitles, idSet);
    // Task 125843 (P19.5): "invalid-result" (the defense-in-depth overlap/duration re-check,
    // see validateRippleDeleteResult) maps straight through rather than collapsing into
    // "non-contiguous" — a distinct, if practically unreachable, reason deserves its own status
    // rather than a misleading one, matching this codebase's own "no commit for any rejection
    // reason" convention for every other action's result type.
    if (!resolution.ok) return resolution.reason === "empty-selection" ? "empty-selection" : resolution.reason === "invalid-result" ? "invalid-result" : "non-contiguous";
    // Re-resolve against the fresh snapshot inside commit() rather than reusing `resolution`
    // directly — matches every other batch action's own "compute the check outside for an early
    // return, recompute the actual mutation from the snapshot commit() hands the mutator" shape
    // (see duplicateSubtitles above), so a ripple delete is never applied against stale state.
    get().commit((snap) => {
      const fresh = resolveRippleDelete(snap.subtitles, idSet);
      if (!fresh.ok) return snap; // selection became invalid between the check and the commit — no-op
      return { ...snap, subtitles: fresh.subtitles };
    });
    return "ok";
  },

  rippleInsertTime: (insertAtSec, durationSec) => {
    const { project } = get();
    if (!project) return "invalid-insertion-point";
    const resolution = resolveRippleInsert(project.subtitles, insertAtSec, durationSec);
    if (!resolution.ok) return resolution.reason;
    if (resolution.affectedCount === 0) return "noop"; // nothing would actually change — no pointless commit/undo entry
    get().commit((snap) => {
      const fresh = resolveRippleInsert(snap.subtitles, insertAtSec, durationSec);
      if (!fresh.ok || fresh.affectedCount === 0) return snap;
      return { ...snap, subtitles: fresh.subtitles };
    });
    return "ok";
  },

  splitSubtitleAtTime: (id, time) => {
    const { project } = get();
    if (!project) return "not-found";
    const sub = project.subtitles.find((s) => s.id === id);
    if (!sub) return "not-found";
    const resolution = splitSubtitleAt(sub, time, project.timingRules);
    if (!resolution.ok) return resolution.reason;
    get().commit((snap) => {
      const idx = snap.subtitles.findIndex((s) => s.id === id);
      if (idx === -1) return snap;
      const fresh = splitSubtitleAt(snap.subtitles[idx], time, snap.timingRules);
      if (!fresh.ok) return snap; // state changed between the check above and this commit — no-op
      // Task 114761 (P18.7): only captions from `idx` onward actually change (their `index`
      // shifts by +1 to make room for the new right half) — everything BEFORE `idx` keeps its
      // exact object reference, matching lib/subtitles/ripple-edit.ts's own established
      // "reindex only what actually changed" pattern rather than the blanket
      // `.map((s,i)=>({...s,index:i}))` the pre-P18.7 code applied to the WHOLE array (which
      // silently broke P18.2 memoization for every caption before the split point too).
      const subtitles = [
        ...snap.subtitles.slice(0, idx),
        fresh.left,
        fresh.right,
        ...snap.subtitles.slice(idx + 1).map((s, i) => (s.index === idx + 2 + i ? s : { ...s, index: idx + 2 + i })),
      ];
      return { ...snap, subtitles };
    });
    // Task 114761 (P18.7): the LEFT half keeps the ORIGINAL caption's own id, so
    // commit()'s own pruneSelection (which only clears selectedWordIndex when the FOCUSED
    // CAPTION ITSELF disappears) never fires here — but the left half's `words` array is now
    // SHORTER than it was. A selectedWordIndex that pointed into what's now the RIGHT half (a
    // different caption, with a brand-new id) would be silently out of bounds for the left
    // half's own array. There's no well-defined "which side does the old selection follow"
    // answer here (unlike reorderWord, where the SAME word just moves position) — the word
    // could legitimately have ended up on either side — so this clears it rather than guessing,
    // the same safe fallback deleteSubtitle already uses when a word's parent caption vanishes.
    const after = get().project;
    const left = after?.subtitles.find((s) => s.id === id);
    if (left && get().selectedSubtitleId === id && get().selectedWordIndex !== null && get().selectedWordIndex! >= left.words.length) {
      set({ selectedWordIndex: null });
    }
    return "ok";
  },

  resegmentAll: () =>
    get().commit((snap) => {
      // Sorted by real timestamp — see this action's own interface doc comment for why.
      const words = snap.subtitles.flatMap((s) => s.words).sort((a, b) => a.start - b.start);
      if (!words.length) return snap;
      const subtitles = segmentWords(words, snap.timingRules);
      return { ...snap, subtitles };
    }),

  mergeWithNext: (id) => {
    const { project } = get();
    if (!project) return "not-found";
    const idx = project.subtitles.findIndex((s) => s.id === id);
    if (idx === -1) return "not-found";
    if (idx === project.subtitles.length - 1) return "no-next-caption";
    const resolution = mergeSubtitles(project.subtitles[idx], project.subtitles[idx + 1], project.timingRules);
    if (!resolution.ok) return resolution.reason;
    get().commit((snap) => {
      const freshIdx = snap.subtitles.findIndex((s) => s.id === id);
      if (freshIdx === -1 || freshIdx === snap.subtitles.length - 1) return snap;
      const fresh = mergeSubtitles(snap.subtitles[freshIdx], snap.subtitles[freshIdx + 1], snap.timingRules);
      if (!fresh.ok) return snap; // state changed between the check above and this commit — no-op
      // Task 114761 (P18.7): only the merged caption and everything after it actually change
      // (their `index` shifts down by 1) — everything BEFORE `freshIdx` keeps its exact object
      // reference, same "reindex only what changed" fix as splitSubtitleAtTime above (the
      // pre-P18.7 blanket `.map((s,i)=>({...s,index:i}))` broke P18.2 memoization for every
      // earlier caption too).
      const subtitles = [
        ...snap.subtitles.slice(0, freshIdx),
        { ...fresh.subtitle, index: freshIdx },
        ...snap.subtitles.slice(freshIdx + 2).map((s, i) => (s.index === freshIdx + 1 + i ? s : { ...s, index: freshIdx + 1 + i })),
      ];
      return { ...snap, subtitles };
    });
    return "ok";
  },

  reorderSubtitle: (id, direction) =>
    get().commit((snap) => {
      const idx = snap.subtitles.findIndex((s) => s.id === id);
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (idx === -1 || swapWith < 0 || swapWith >= snap.subtitles.length) return snap;
      const subtitles = [...snap.subtitles];
      const a = subtitles[idx];
      const b = subtitles[swapWith];
      [subtitles[idx], subtitles[swapWith]] = [
        { ...b, start: a.start, end: a.end, index: idx },
        { ...a, start: b.start, end: b.end, index: swapWith },
      ];
      return { ...snap, subtitles };
    }),

  setGlobalStyle: (patch) => get().commit((snap) => ({ ...snap, globalStyle: { ...snap.globalStyle, ...patch } })),

  setSubtitleStyleOverride: (id, patch) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        s.id === id ? { ...s, style: patch === null ? undefined : { ...s.style, ...patch } } : s,
      ),
    })),

  applyStyleToSubtitles: (ids, patch) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        idSet.has(s.id) ? { ...s, style: patch === null ? undefined : { ...s.style, ...patch } } : s,
      ),
    }));
  },

  setGlobalAnimation: (patch) => get().commit((snap) => ({ ...snap, animation: { ...snap.animation, ...patch } })),

  setSubtitleAnimationOverride: (id, patch) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        s.id === id ? { ...s, animation: patch === null ? undefined : { ...s.animation, ...patch } } : s,
      ),
    })),

  applyAnimationToSubtitles: (ids, patch) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        idSet.has(s.id) ? { ...s, animation: patch === null ? undefined : { ...s.animation, ...patch } } : s,
      ),
    }));
  },

  setWordStyleOverride: (subtitleId, wordIndex, patch) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) => {
        if (s.id !== subtitleId) return s;
        const words = s.words.map((w, i) => {
          if (i !== wordIndex) return w;
          return { ...w, style: patch === null ? undefined : { ...w.style, ...patch } };
        });
        return { ...s, words };
      }),
    })),

  setTimingRules: (patch) => get().commit((snap) => ({ ...snap, timingRules: { ...snap.timingRules, ...patch } })),

  setComposition: (patch) => get().commit((snap) => ({ ...snap, composition: { ...snap.composition, ...patch } })),

  replaceAllSubtitles: (subtitles) => get().commit((snap) => ({ ...snap, subtitles })),

  // Deep-cloned (not just spread — SubtitleStyle/AnimationConfig are flat, but this stays
  // correct even so) so the project's globalStyle/animation is always its own independent
  // value, never a live reference into BUILT_IN_PRESETS (a shared, module-level array) or a
  // custom preset record — applying a preset must copy its data, never share it.
  applyPreset: (style, animation) => {
    get().commit((snap) => ({ ...snap, globalStyle: { ...style }, animation: { ...animation } }));
    // Snapshotted AFTER commit(), from the same deep-copied values just written — so
    // "Reset changes" restores exactly what was applied, never a live reference to the
    // preset (built-in or custom) that produced it.
    set({ lastAppliedStyleSnapshot: { style: { ...style }, animation: { ...animation } } });
  },

  applyTemplate: (target, resolved) => {
    const { project } = get();
    if (!project) return 0;
    const before = snapshotOf(project);
    const after = applyTemplateToSnapshot(before, target, resolved);
    if (after === before) return 0;
    get().commit((snap) => applyTemplateToSnapshot(snap, target, resolved));
    if ("all" in target) set({ lastAppliedStyleSnapshot: { style: { ...resolved.style }, animation: { ...resolved.animation } } });
    return countTemplateTargets(project.subtitles, target);
  },

  resetToLastApplied: () => {
    const { lastAppliedStyleSnapshot, applyPreset } = get();
    if (!lastAppliedStyleSnapshot) return;
    applyPreset(lastAppliedStyleSnapshot.style, lastAppliedStyleSnapshot.animation);
  },

  copyStyle: (subtitleId) => {
    const { project } = get();
    if (!project) return;
    const sub = subtitleId ? project.subtitles.find((s) => s.id === subtitleId) : undefined;
    const style = sub ? { ...project.globalStyle, ...sub.style } : project.globalStyle;
    const animation = sub ? { ...project.animation, ...sub.animation } : project.animation;
    copyStyleToClipboard(style, animation);
  },

  pasteStyle: (target) => {
    const clip = readStyleClipboard();
    if (!clip) return false;
    if ("all" in target) {
      get().commit((snap) => ({ ...snap, globalStyle: clip.style, animation: clip.animation }));
    } else {
      get().commit((snap) => ({
        ...snap,
        subtitles: snap.subtitles.map((s) => (s.id === target.subtitleId ? { ...s, style: clip.style, animation: clip.animation } : s)),
      }));
    }
    return true;
  },

  applyTextMap: (texts) =>
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) =>
        texts[s.id] !== undefined
          ? {
              ...s,
              text: texts[s.id],
              words: remapWordsToText(s.words, texts[s.id]),
              hinglishText: undefined,
              gujaratiScriptText: undefined,
            }
          : s,
      ),
    })),

  findReplace: (search, replace, all) => {
    if (!search) return 0;
    let count = 0;
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) => {
        if (!all && count > 0) return s;
        const regex = new RegExp(escapeRegex(search), "gi");
        const matches = s.text.match(regex);
        if (!matches) return s;
        if (!all) count += 1;
        else count += matches.length;
        const newText = s.text.replace(regex, replace);
        return {
          ...s,
          text: newText,
          words: remapWordsToText(s.words, newText),
          hinglishText: undefined,
          gujaratiScriptText: undefined,
        };
      }),
    }));
    return count;
  },

  applyBatchFindReplace: (ids, search, replace, options) => {
    const { project } = get();
    if (!project || ids.length === 0) return { totalMatches: 0, affectedCount: 0, staleCount: 0 };
    const idSet = new Set(ids);
    const result = computeBatchFindReplace(project.subtitles, idSet, search, replace, options);
    if (result.textById.size === 0) return { totalMatches: result.totalMatches, affectedCount: 0, staleCount: 0 };
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) => {
        const newText = result.textById.get(s.id);
        if (newText === undefined) return s;
        return { ...s, text: newText, words: remapWordsToText(s.words, newText), hinglishText: undefined, gujaratiScriptText: undefined };
      }),
    }));
    return { totalMatches: result.totalMatches, affectedCount: result.textById.size, staleCount: result.staleIds.size };
  },

  applyBatchTextTransform: (ids, kind) => {
    const { project } = get();
    if (!project || ids.length === 0) return { affectedCount: 0, staleCount: 0 };
    const idSet = new Set(ids);
    const result = computeBatchTextTransform(project.subtitles, idSet, kind);
    if (result.textById.size === 0) return { affectedCount: 0, staleCount: 0 };
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles.map((s) => {
        const newText = result.textById.get(s.id);
        if (newText === undefined) return s;
        return { ...s, text: newText, words: remapWordsToText(s.words, newText), hinglishText: undefined, gujaratiScriptText: undefined };
      }),
    }));
    return { affectedCount: result.textById.size, staleCount: result.staleIds.size };
  },

  applyTextCleanup: (ids, selection) => {
    const { project } = get();
    if (!project || ids.length === 0) return { changedCount: 0, deletedCount: 0, staleCount: 0 };
    const idSet = new Set(ids);
    const preview = computeTextCleanupPreview(project.subtitles, idSet, selection);
    if (preview.changedCount === 0 && preview.deleteCount === 0) {
      return { changedCount: 0, deletedCount: 0, staleCount: 0 };
    }
    const textById = new Map(preview.items.filter((i) => !i.willDelete).map((i) => [i.id, i.after]));
    const deleteIds = new Set(preview.items.filter((i) => i.willDelete).map((i) => i.id));
    // ONE commit for both the text changes AND the deletions (Task 98134 P11's own "one Apply =
    // one undo step, even when it both edits and deletes captions" requirement) — filter first,
    // then reindex, then remap text/words exactly like every other text-mutating action here.
    get().commit((snap) => ({
      ...snap,
      subtitles: snap.subtitles
        .filter((s) => !deleteIds.has(s.id))
        .map((s, i) => {
          const newText = textById.get(s.id);
          const withText =
            newText === undefined
              ? s
              : { ...s, text: newText, words: remapWordsToText(s.words, newText), hinglishText: undefined, gujaratiScriptText: undefined };
          return withText.index === i ? withText : { ...withText, index: i };
        }),
    }));
    return { changedCount: preview.changedCount, deletedCount: preview.deleteCount, staleCount: preview.staleCount };
  },

  setTrim: (start, end) => get().commit((snap) => ({ ...snap, trimStart: Math.max(0, start), trimEnd: end })),

  addCutRange: (range) =>
    get().commit((snap) => ({
      ...snap,
      cutRanges: normalizeCuts([...snap.cutRanges, { ...range, id: nanoid(8) }], get().project?.video?.duration ?? Infinity),
    })),

  addCutRanges: (ranges) =>
    get().commit((snap) => ({
      ...snap,
      cutRanges: normalizeCuts(
        [...snap.cutRanges, ...ranges.map((r) => ({ ...r, id: nanoid(8) }))],
        get().project?.video?.duration ?? Infinity,
      ),
    })),

  removeCutRange: (id) => get().commit((snap) => ({ ...snap, cutRanges: snap.cutRanges.filter((c) => c.id !== id) })),

  clearCutRanges: (reason) =>
    get().commit((snap) => ({
      ...snap,
      cutRanges: reason ? snap.cutRanges.filter((c) => c.reason !== reason) : [],
    })),
}));

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Re-maps word text onto new caption text, keeping every word's own timestamp (and
 * `confidence`/`removed`/`style`) exactly as it was, when the word count is unchanged — the
 * overwhelmingly common case for a small wording fix. Clears each changed word's
 * `hinglishText`/`gujaratiScriptText` — the ORIGINAL text just changed, so any previously-
 * generated derived text no longer corresponds to it and would otherwise show stale, wrong text
 * next time that mode is viewed (see ensureHinglishCoverage/ensureGujaratiScriptCoverage, which
 * only regenerate whatever is undefined).
 *
 * P7.2 fix (Task 92618): when the word count DOES change, this used to silently discard every
 * real per-word timestamp and replace them with evenly-spaced synthetic ones — real
 * transcription timing lost with no warning. It now does neither: the original `words` array is
 * returned completely untouched. The caption is then "word-timing stale" — see
 * lib/subtitles/word-timing.ts isWordTimingStale, which derives this purely from `words.length`
 * no longer matching the new text's token count, so no extra field is needed anywhere. The user
 * must explicitly call rebuildWordTiming to get fresh, text-matching timing; real timestamps are
 * never silently overwritten just because text changed. */
function remapWordsToText(originalWords: Word[], newText: string): Word[] {
  const newTokens = tokenizeCaptionText(newText);
  if (newTokens.length === originalWords.length) {
    // Task 108762 (P18.1): metadata (confidence/style/removed) is decided per-word by
    // remapWordMetadataForTextReplacement, not by a blanket spread — see that function's own doc
    // comment for exactly which fields survive a same-position text change and which don't.
    // hinglishText/gujaratiScriptText are still unconditionally cleared here, unchanged from
    // before this task — this fix touches ONLY the confidence-carryover gap, nothing else.
    return originalWords.map((w, i) => ({
      ...remapWordMetadataForTextReplacement(w, newTokens[i]),
      hinglishText: undefined,
      gujaratiScriptText: undefined,
    }));
  }
  return originalWords;
}

/** Hinglish analogue of remapWordsToText — re-distributes `hinglishText` across
 * `originalWords`, preserving each word's own timestamp (and its original `text`/
 * `hinglishText` untouched) when the word count matches.
 *
 * Task 105631 (P17) fix: when the user's edit changes the word count, this USED TO fall back to
 * synthesizing brand-new `Word` objects whose `.text` field was set to the just-typed HINGLISH
 * text — silently writing Romanized/derived content into the one field this whole app treats as
 * "the untouched original transcript" (see types/subtitle.ts Word.hinglishText's own doc comment,
 * and this task's own explicit "derived representations must NOT silently overwrite or corrupt
 * the authoritative Original text" safety principle). It now does what remapWordsToText already
 * does for the analogous original-text case: `originalWords` is returned COMPLETELY UNTOUCHED —
 * every real original `text`/timestamp/confidence is preserved, never fabricated — and the
 * caption's own whole-caption `hinglishText` field (set by the caller, editor-store.ts's
 * updateSubtitleHinglishText) still reflects exactly what the user typed. The trade-off: this
 * caption's PER-WORD hinglishText breakdown (used by applyOutputMode for export/preview/timeline
 * labels — see output-mode.ts) can lag behind the whole-caption text until something else
 * regenerates it (e.g. an original-text edit, which clears both derived fields for a fresh
 * lazy-regenerate next time this mode is viewed) — an honest staleness, not a silent corruption. */
function remapHinglishWordsToText(originalWords: Word[], newHinglishText: string): Word[] {
  const newTokens = newHinglishText.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  if (newTokens.length !== originalWords.length) return originalWords;
  return originalWords.map((w, i) => ({ ...w, hinglishText: newTokens[i] }));
}

/** Gujarati-script analogue of remapHinglishWordsToText — same Task 105631 (P17) fix and the exact
 * same reasoning: a word-count-changing edit leaves `originalWords` completely untouched instead
 * of fabricating new words whose `.text` holds Gujarati-script content. */
function remapGujaratiScriptWordsToText(originalWords: Word[], newGujaratiScriptText: string): Word[] {
  const newTokens = newGujaratiScriptText.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  if (newTokens.length !== originalWords.length) return originalWords;
  return originalWords.map((w, i) => ({ ...w, gujaratiScriptText: newTokens[i] }));
}
