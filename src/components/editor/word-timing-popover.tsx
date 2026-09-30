"use client";

import { useState } from "react";
import { Scissors, Merge, Trash2, ArrowLeftToLine, ArrowRightToLine, ArrowLeftFromLine, ArrowRightFromLine, MoveLeft, MoveRight } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTime, cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor-store";
import { WORD_NUDGE_STEP_SEC as NUDGE_STEP_SEC, MIN_WORD_DURATION_SEC } from "@/lib/subtitles/word-timing";
import { defaultWordSplit } from "@/lib/subtitles/word-edit";
import { classifyWordConfidence, formatWordConfidence } from "@/lib/subtitles/word-confidence";
import {
  getCaptionDisplayModeCapabilities,
  wordStructuralCreationUnavailableReason,
  derivedWordEditAffectsOriginalNotice,
} from "@/lib/subtitles/caption-display-mode";
import { resolveEffectiveWordStyleValue, isWordStylePropertyOverridden, mergeWordStyleOverride } from "@/lib/subtitles/word-style-capabilities";
import type { CaptionOutputMode, SubtitleStyle } from "@/types/subtitle";
import { toast } from "sonner";

/**
 * Compact, bounded word-timing editor (Task 92618, P7.2) — a Popover, not a modal dialog, per
 * the task's own "no modal dialogs for every small word-timing edit" instruction. Shows one
 * word's current start/end and lets it be adjusted via a numeric input (committed on blur/Enter,
 * matching the caption textarea's own commit-on-blur convention) or +/- nudge buttons (committed
 * immediately, since each click is already one discrete, undoable action). Every value this
 * component produces is just a REQUEST — `onCommit` is expected to be wired to
 * editor-store.ts's `updateWordTiming`, whose own clamp (lib/subtitles/word-timing.ts
 * clampWordTiming) is the actual authority on what's valid; this component never enforces the
 * bounds itself, only displays them for context.
 */
export function WordTimingPopover({
  word,
  captionStart,
  captionEnd,
  prevWordEnd,
  nextWordStart,
  onCommit,
  onSplit,
  onMergeNext,
  onDelete,
  onInsert,
  hasNextWord,
  displayMode,
  captionStyle,
  onSetStyle,
  wordIndex,
  totalWords,
  onReorder,
  children,
}: {
  /** Task 108762 (P18.1) — `confidence` is optional and read-only here: this component only
   * ever DISPLAYS it (via classifyWordConfidence/formatWordConfidence, lib/subtitles/word-confidence.ts),
   * never edits or clears it — the stored value is owned entirely by the word-mutation paths in
   * editor-store.ts/word-edit.ts. Task 110184 (P18.3): `style` is this word's own manual style
   * OVERRIDE (Word.style — distinct from the automatic active-word highlight), read here only to
   * derive the Bold toggle's current state; every mutation still goes through `onSetStyle`. */
  word: { text: string; start: number; end: number; confidence?: number; style?: Partial<SubtitleStyle> };
  captionStart: number;
  captionEnd: number;
  /** The previous word's own end, or null when this is the caption's first word (bounded by
   * captionStart instead) — display only, for the "bounded by X–Y" hint. */
  prevWordEnd: number | null;
  /** The next word's own start, or null when this is the caption's last word (bounded by
   * captionEnd instead) — display only. */
  nextWordStart: number | null;
  onCommit: (start: number, end: number) => void;
  /** Task 102741 (P15) — confirms a Split Word request with the two edited text tokens; returns
   * `false` when the split is infeasible (empty text, or either half would fall below the
   * minimum word duration — see lib/subtitles/word-edit.ts splitWordText), so this component can
   * show a clear rejection message rather than silently closing as if it worked. */
  onSplit: (leftText: string, rightText: string) => boolean;
  /** Merges this word with the next one — a single click, no further input needed (see
   * lib/subtitles/word-edit.ts mergeWords: text is just the two originals joined by a space). */
  onMergeNext: () => void;
  onDelete: () => void;
  /** Task 103884 (P16) — confirms an Insert Word request on the given side with the entered text;
   * returns `false` when the insertion is infeasible (empty/whitespace-only text, more than one
   * token, or the available gap is smaller than the minimum word duration — see
   * lib/subtitles/word-edit.ts resolveWordInsertion), so this component can show a clear rejection
   * message rather than silently closing as if it worked. */
  onInsert: (side: "before" | "after", text: string) => boolean;
  /** Whether a next word exists to merge with — disables the Merge button rather than letting it
   * silently no-op (the store action itself also guards this, but the UI should never invite a
   * click that can't do anything). */
  hasNextWord: boolean;
  /** Task 105631/106284 (P17/P17.1) — the project's CURRENT caption display mode — this component
   * derives its own per-operation capability row from it (lib/subtitles/caption-display-mode.ts)
   * rather than receiving one combined boolean: Split/Insert are Original-only, but Merge/Delete
   * are now available in every mode (see that module's own top-of-file doc comment). Start/End
   * timing stays editable in every mode regardless. */
  displayMode: CaptionOutputMode;
  /** Task 110184 (P18.3) — this caption's fully-resolved style (types/subtitle.ts resolveStyle:
   * project.globalStyle merged with the caption's own override), needed only to know what
   * fontWeight this word would INHERIT if it had no override of its own — never written to. */
  captionStyle: SubtitleStyle;
  /** Task 110184 (P18.3) — editor-store.ts's `setWordStyleOverride` for this exact word, already
   * bound to (subtitleId, wordIndex) by the caller. `null` clears every property this word's
   * style override sets; a patch object merges onto whatever's already there (same semantics as
   * style-panel.tsx's own "Word overrides" section, which uses the same store action). */
  onSetStyle: (patch: Partial<SubtitleStyle> | null) => void;
  /** Task 113528 (P18.6) — this word's own CURRENT index within the caption's `words` array
   * (not a stable id — recomputed every render from array position, exactly like every other
   * index this popover already receives, e.g. for onSplit/onDelete). Used only to compute
   * Move Left/Right's target index and to disable each button at its own boundary. */
  wordIndex: number;
  /** How many words the caption currently has — Move Right is disabled when `wordIndex` is
   * already the last one. */
  totalWords: number;
  /** Task 113528 (P18.6) — editor-store.ts's `reorderWord`, already bound to (subtitleId,
   * wordIndex) by the caller; only the TARGET index is supplied here. Moves the COMPLETE word
   * object (text, timing, confidence, style, removed, derived fields) — never regenerates or
   * resorts anything. Returns "ok" on success (one undo step); any other value means no commit
   * was made (a boundary click the button's own `disabled` state should already have prevented,
   * or the caption having been removed by something else in the meantime) — shown as a toast
   * rather than silently doing nothing. */
  onReorder: (toIndex: number) => "ok" | "invalid-index" | "noop" | "not-found";
  children: React.ReactNode;
}) {
  // Task 123041 (P19.3) — a stable, direct Zustand action reference (no id/context to bind, so
  // no wrapper is needed — same reasoning as every other bare store action this codebase already
  // passes straight through, e.g. this file's own `onCommit`/`onDelete` callers upstream).
  // `word.start`/`word.end` below are this word's OWN prop values — exactly the object the caller
  // (captions-panel.tsx) reads from `words[index]`, never re-derived from array position — so
  // jumping here is safe even when this caption's `words` are stored in non-monotonic (P18.6)
  // order: a reordered word's own timestamps travel WITH it, and this component never consults a
  // neighbor to find them.
  const seek = useEditorStore((s) => s.seek);
  const capabilities = getCaptionDisplayModeCapabilities(displayMode);
  const confidenceStatus = classifyWordConfidence(word.confidence);
  const [open, setOpen] = useState(false);
  const [startInput, setStartInput] = useState(word.start.toFixed(2));
  const [endInput, setEndInput] = useState(word.end.toFixed(2));
  // Task 102741 (P15) — Split Word's own small inline editor: closed by default (nothing extra
  // shown until the user explicitly asks to split, per this task's own "small, conservative UI"
  // scope), pre-filled with a deterministic default split (see defaultWordSplit) the user can
  // edit before confirming. Reset whenever the popover itself closes/reopens or the word changes,
  // so a stale split-in-progress from a PREVIOUS word never leaks into this one.
  const [splitting, setSplitting] = useState(false);
  const [splitLeft, setSplitLeft] = useState("");
  const [splitRight, setSplitRight] = useState("");
  // Task 103884 (P16) — Insert Word's own small inline editor, same closed-by-default /
  // reset-on-close shape as `splitting` above (see that state's own comment). `inserting` holds
  // which side was chosen (or null when not inserting) so the same editor markup can serve both
  // "Insert Before" and "Insert After".
  const [inserting, setInserting] = useState<"before" | "after" | null>(null);
  const [insertText, setInsertText] = useState("");
  // Re-syncs the local buffered inputs whenever the word's ACTUAL (possibly store-clamped)
  // timing changes — same "compare current vs. last-seen prop at render time" pattern
  // captions-panel.tsx's CaptionRow already uses for its own text buffering, so a nudge/typed
  // value that got clamped by the store shows the real, clamped result, not the raw request.
  const [lastWord, setLastWord] = useState(word);
  if (word.start !== lastWord.start || word.end !== lastWord.end) {
    setLastWord(word);
    setStartInput(word.start.toFixed(2));
    setEndInput(word.end.toFixed(2));
  }

  function onOpenChange(next: boolean) {
    if (next) {
      setStartInput(word.start.toFixed(2));
      setEndInput(word.end.toFixed(2));
    }
    // Closing (or reopening fresh) always discards any in-progress split/insert — never carries a
    // half-typed request from one open/close cycle into the next.
    setSplitting(false);
    setInserting(null);
    setInsertText("");
    setOpen(next);
  }

  function openSplitting() {
    const suggestion = defaultWordSplit(word.text);
    if (!suggestion) {
      toast.error("This word is too short to split.");
      return;
    }
    setSplitLeft(suggestion.left);
    setSplitRight(suggestion.right);
    setInserting(null);
    setSplitting(true);
  }

  function confirmSplit() {
    const ok = onSplit(splitLeft, splitRight);
    if (!ok) {
      toast.error("Can't split into those two parts — check both have text and aren't too short.");
      return;
    }
    setSplitting(false);
    setOpen(false);
  }

  // Task 103884 (P16) — the exact same gap geometry `resolveWordInsertion` (word-edit.ts) itself
  // computes, mirrored here PURELY for display (the "claims X.XX–Y.YY, N.NNs" preview text below) —
  // this component never decides feasibility itself, `onInsert`'s return value is the only
  // authority on whether a given request actually succeeds.
  const beforeGapStart = prevWordEnd !== null ? prevWordEnd : captionStart;
  const beforeGapEnd = word.start;
  const afterGapStart = word.end;
  const afterGapEnd = nextWordStart !== null ? nextWordStart : captionEnd;
  const insertGap = inserting === "before" ? { start: beforeGapStart, end: beforeGapEnd } : inserting === "after" ? { start: afterGapStart, end: afterGapEnd } : null;
  const insertGapDuration = insertGap ? insertGap.end - insertGap.start : 0;
  const insertGapTooSmall = insertGap !== null && insertGapDuration < MIN_WORD_DURATION_SEC;

  function openInserting(side: "before" | "after") {
    const gap = side === "before" ? { start: beforeGapStart, end: beforeGapEnd } : { start: afterGapStart, end: afterGapEnd };
    if (gap.end - gap.start < MIN_WORD_DURATION_SEC) {
      toast.error("No room to insert a word here — the neighboring words are too close together.");
      return;
    }
    setInsertText("");
    setSplitting(false);
    setInserting(side);
  }

  function confirmInsert() {
    if (!inserting) return;
    const ok = onInsert(inserting, insertText);
    if (!ok) {
      toast.error("Can't insert that — enter exactly one word (no spaces).");
      return;
    }
    setInserting(null);
    setInsertText("");
    setOpen(false);
  }

  function commitStart(raw: string) {
    const value = Number(raw);
    if (Number.isFinite(value)) onCommit(value, word.end);
    else setStartInput(word.start.toFixed(2));
  }
  function commitEnd(raw: string) {
    const value = Number(raw);
    if (Number.isFinite(value)) onCommit(word.start, value);
    else setEndInput(word.end.toFixed(2));
  }
  function nudge(edge: "start" | "end", deltaSec: number) {
    if (edge === "start") onCommit(word.start + deltaSec, word.end);
    else onCommit(word.start, word.end + deltaSec);
  }

  const lowerLabel = prevWordEnd !== null ? formatTime(prevWordEnd) : formatTime(captionStart);
  const upperLabel = nextWordStart !== null ? formatTime(nextWordStart) : formatTime(captionEnd);

  // Task 110184 (P18.3) — the one word-level style property fully supported end-to-end (editor
  // + preview + ASS export, see lib/subtitles/word-style-capabilities.ts) that had no UI control
  // yet. `isBold` is the EFFECTIVE value (word override, else inherited caption style) so the
  // toggle always reflects what the word actually looks like right now, not just whether an
  // override exists.
  const effectiveFontWeight = resolveEffectiveWordStyleValue(captionStyle, word.style, "fontWeight");
  const isBold = effectiveFontWeight >= 700;
  const boldIsOverridden = isWordStylePropertyOverridden(word.style, "fontWeight");
  function toggleBold() {
    // Always writes an EXPLICIT override for the opposite of the current EFFECTIVE state — the
    // same "always write a concrete value" pattern the Color/Size/Background word-override
    // controls already use (style-panel.tsx's ColorPicker/NumberSlider onChange handlers), so a
    // click always produces a visible, predictable flip. This matters specifically because the
    // caption's own weight can already be bold (e.g. an 800 preset): un-setting a word's override
    // there would just fall back to the still-bold caption value, silently failing to make that
    // one word NOT bold. Writing an explicit 400/700 genuinely overrides either direction, and
    // wordStyleTag (ass.ts) reads it with `!== undefined`, so an explicit 400 correctly forces
    // \b0 in export even against a bold caption-level ASS style.
    onSetStyle(mergeWordStyleOverride(word.style, { fontWeight: isBold ? 400 : 700 }));
  }
  function resetBold() {
    // Distinct from toggleBold: reverts to INHERITING the caption's own weight, rather than
    // writing an explicit opposite value — un-sets just this one property (never touches a
    // color/size/background override set separately via the Style panel's own Word overrides
    // section). mergeWordStyleOverride collapses the result to a full `null` clear if fontWeight
    // was the only override this word had, so it never leaves a stray, effectively-empty style
    // object behind.
    onSetStyle(mergeWordStyleOverride(word.style, { fontWeight: undefined }));
  }

  // Task 113528 (P18.6) — MOVE WORD FROM INDEX A TO INDEX B. `disabled` already prevents the
  // only two ways onReorder could ever be called with an out-of-range target (moving the first
  // word left, or the last word right), so a rejection here in practice only means the caption
  // changed shape from under this popover — still surfaced with a toast rather than swallowed.
  function moveWord(direction: "left" | "right") {
    const targetIndex = direction === "left" ? wordIndex - 1 : wordIndex + 1;
    const result = onReorder(targetIndex);
    if (result === "not-found") toast.error("Can't move this word — the caption changed.");
    else if (result === "invalid-index") toast.error("Can't move this word any further.");
    // "noop" and "ok" both need no message: "ok" is the normal, silent-success case (matches
    // nudge/timing edits, which don't toast either), and "noop" can't actually be reached from
    // this UI (targetIndex is always exactly ±1, and the `disabled` props below already stop a
    // click at either boundary before onReorder is ever called).
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="truncate text-xs font-semibold text-foreground">&ldquo;{word.text}&rdquo;</p>
          <p className="text-[11px] text-muted-2">
            Bounded by {lowerLabel} – {upperLabel}
          </p>
          {/* Task 108762 (P18.1) — a read-only review signal, never a claim of error (see
              lib/subtitles/word-confidence.ts's own doc comment): "Unknown" for a word with no
              measurement (undefined), a plain percentage otherwise, with a "low confidence" note
              only when it's actually below the threshold. */}
          <p className={cn("text-[11px]", confidenceStatus === "low" ? "text-warning" : "text-muted-2")}>
            Confidence: {formatWordConfidence(word.confidence)}
            {confidenceStatus === "low" && " (low)"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-2">Start</label>
            <div className="mt-1 flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={() => nudge("start", -NUDGE_STEP_SEC)} title="Earlier">
                −
              </Button>
              <Input
                type="number"
                step={0.01}
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                onBlur={() => commitStart(startInput)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="h-7 px-1.5 text-center text-xs"
              />
              <Button variant="outline" size="icon-sm" onClick={() => nudge("start", NUDGE_STEP_SEC)} title="Later">
                +
              </Button>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-2">End</label>
            <div className="mt-1 flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={() => nudge("end", -NUDGE_STEP_SEC)} title="Earlier">
                −
              </Button>
              <Input
                type="number"
                step={0.01}
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
                onBlur={() => commitEnd(endInput)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="h-7 px-1.5 text-center text-xs"
              />
              <Button variant="outline" size="icon-sm" onClick={() => nudge("end", NUDGE_STEP_SEC)} title="Later">
                +
              </Button>
            </div>
          </div>
        </div>

        {/* Task 123041 (P19.3) — moves the PLAYHEAD to this word's own start/end; never edits
            the word itself (that's what the Start/End inputs and −/+ nudges just above already
            do) — plain `seek()`, the same existing mechanism every other navigation control in
            this app already uses. */}
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 gap-1 px-1.5 text-[10px]"
            onClick={() => seek(word.start)}
            title="Move the playhead to this word's start"
          >
            <ArrowLeftFromLine className="size-3" /> Jump to start
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 gap-1 px-1.5 text-[10px]"
            onClick={() => seek(word.end)}
            title="Move the playhead to this word's end"
          >
            <ArrowRightFromLine className="size-3" /> Jump to end
          </Button>
        </div>

        {/* Task 110184 (P18.3) — word-level style parity: kept to a single Bold toggle rather
            than the full 6-value weight dropdown the caption-level Style panel offers, because
            ASS export only distinguishes bold/not-bold per word (wordStyleTag in
            lib/subtitles/ass.ts emits \b1/\b0 at the 700 threshold) — a finer per-word dropdown
            would look right in the live preview but silently flatten on export, the kind of
            false editor/export parity this task's own audit explicitly avoids. "Reset" (shown
            only once overridden) is scoped to just this property, distinct from style-panel.tsx's
            own "Clear override" button, which also clears any color/size/background override set
            there — this popover only ever writes fontWeight, so its own reset only ever touches
            fontWeight. Color/size/background word overrides stay in style-panel.tsx's existing
            "Word overrides" section — not duplicated here, per this task's own "avoid turning
            WordTimingPopover into a miniature Style panel" scope. */}
        <div className="border-t border-border-strong pt-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-2">Word style</span>
            <div className="flex items-center gap-1">
              {boldIsOverridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px] text-muted-2"
                  onClick={resetBold}
                  title="Remove this word's Bold override — follow the caption style again"
                >
                  Reset
                </Button>
              )}
              <Button
                variant={isBold ? "accent" : "outline"}
                size="sm"
                className="h-6 w-7 px-0 text-[11px] font-bold"
                onClick={toggleBold}
                title={isBold ? "Make this word not bold" : "Make this word bold"}
                aria-pressed={isBold}
              >
                B
              </Button>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-muted-2">
            {boldIsOverridden ? `Bold ${isBold ? "on" : "off"} — word override` : `Bold ${isBold ? "on" : "off"} — inherited from caption style`}
          </p>
        </div>

        {/* Task 113528 (P18.6) — word reorder: MOVES THE COMPLETE WORD OBJECT (text, timing,
            confidence, style, removed, derived fields all travel together) to an adjacent
            position — never regenerates or redistributes timing, never re-sorts words back into
            timestamp order (see lib/subtitles/word-reorder.ts's own top-of-file doc comment for
            why a resulting non-monotonic word order is safe for both preview and export). Two
            plain buttons, not drag-and-drop — this codebase has @dnd-kit installed but wires it
            up NOWHERE, and introducing real drag interaction for the first time anywhere in the
            editor would be substantially more complexity than this bounded task's own "prefer
            Move Left/Move Right" guidance calls for. Disabled at each boundary rather than
            letting a click no-op silently. Available in every display mode — see
            caption-display-mode.ts's own `wordReorderAllowed` doc comment for why this is safe
            the same way Merge/Delete already are; the "affects the Original transcript" notice
            below already covers reorder alongside them. */}
        <div className="flex items-center justify-between border-t border-border-strong pt-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-2">Reorder</span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={wordIndex === 0}
              onClick={() => moveWord("left")}
              title="Move this word earlier in the caption's text"
            >
              <MoveLeft className="size-3" /> Move left
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={wordIndex >= totalWords - 1}
              onClick={() => moveWord("right")}
              title="Move this word later in the caption's text"
            >
              <MoveRight className="size-3" /> Move right
            </Button>
          </div>
        </div>

        {/* Task 105631/106284 (P17/P17.1) — two SEPARATE, independent notices rather than one
            combined message, since Split/Insert and Merge/Delete no longer share the same
            availability (see lib/subtitles/caption-display-mode.ts's own top-of-file doc
            comment). Start/End timing above stays fully editable in every mode either way. */}
        {wordStructuralCreationUnavailableReason(displayMode) && (
          <p className="border-t border-border-strong pt-2.5 text-[10px] text-muted-2">{wordStructuralCreationUnavailableReason(displayMode)}</p>
        )}
        {derivedWordEditAffectsOriginalNotice(displayMode) && (
          <p className="text-[10px] text-muted-2">{derivedWordEditAffectsOriginalNotice(displayMode)}</p>
        )}

        {/* Task 102741 (P15) — Split/Merge/Delete: kept inside this SAME existing popover rather
            than a new dialog/panel, per this task's own "prefer small pure helpers + existing
            store mutation paths... do not add a full transcript-editor UI" scope rule. Task
            106284 (P17.1): each of the three buttons is now individually gated — Merge/Delete are
            available in every mode, Split stays Original-only — so this row can show a PARTIAL
            set of buttons instead of being all-or-nothing. */}
        {splitting ? (
          <div className="space-y-2 border-t border-border-strong pt-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-2">Split into two words</p>
            <div className="flex items-center gap-1.5">
              <Input
                value={splitLeft}
                onChange={(e) => setSplitLeft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmSplit()}
                className="h-7 px-1.5 text-xs"
                autoFocus
              />
              <span className="text-muted-2">+</span>
              <Input
                value={splitRight}
                onChange={(e) => setSplitRight(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmSplit()}
                className="h-7 px-1.5 text-xs"
              />
            </div>
            <p className="text-[10px] text-muted-2">
              Timing splits proportionally by length — never a guessed pronunciation boundary.
            </p>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setSplitting(false)}>
                Cancel
              </Button>
              <Button variant="accent" size="sm" className="h-6 px-2 text-[11px]" onClick={confirmSplit}>
                Split
              </Button>
            </div>
          </div>
        ) : (
          !inserting &&
          (capabilities.wordSplitAllowed || capabilities.wordMergeAllowed || capabilities.wordDeleteAllowed) && (
            <div className="flex items-center gap-1 border-t border-border-strong pt-2.5">
              {capabilities.wordSplitAllowed && (
                <Button variant="outline" size="sm" className="h-6 flex-1 px-1.5 text-[11px]" onClick={openSplitting} title="Split this word into two">
                  <Scissors className="size-3" /> Split
                </Button>
              )}
              {capabilities.wordMergeAllowed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 flex-1 px-1.5 text-[11px]"
                  onClick={onMergeNext}
                  disabled={!hasNextWord}
                  title={hasNextWord ? "Merge with the next word" : "No next word to merge with"}
                >
                  <Merge className="size-3" /> Merge
                </Button>
              )}
              {capabilities.wordDeleteAllowed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] text-danger hover:text-danger"
                  onClick={() => {
                    onDelete();
                    setOpen(false);
                  }}
                  title="Delete this word"
                  aria-label="Delete this word"
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </div>
          )
        )}

        {/* Task 103884 (P16) — Insert Word Before/After: its own row (not folded into the
            Split/Merge/Delete row above — five buttons at once would be too cramped for this
            popover's 256px width), with the SAME toggle-to-inline-editor pattern `splitting`
            already established just above. Task 105631/106284 (P17/P17.1): stays gated on its OWN
            `wordInsertAllowed` capability — no longer tied to Merge/Delete's own availability. */}
        {capabilities.wordInsertAllowed && (inserting ? (
          <div className="space-y-2 border-t border-border-strong pt-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-2">
              Insert word {inserting === "before" ? "before" : "after"} &ldquo;{word.text}&rdquo;
            </p>
            <Input
              value={insertText}
              onChange={(e) => setInsertText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmInsert()}
              className="h-7 px-1.5 text-xs"
              placeholder="One word"
              autoFocus
            />
            <p className={`text-[10px] ${insertGapTooSmall ? "text-danger" : "text-muted-2"}`}>
              {insertGapTooSmall
                ? "No room here — the neighboring words are too close together."
                : `Claims the full gap: ${formatTime(insertGap!.start)} – ${formatTime(insertGap!.end)} (${insertGapDuration.toFixed(2)}s).`}
            </p>
            <div className="flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  setInserting(null);
                  setInsertText("");
                }}
              >
                Cancel
              </Button>
              <Button variant="accent" size="sm" className="h-6 px-2 text-[11px]" onClick={confirmInsert} disabled={insertGapTooSmall}>
                Insert
              </Button>
            </div>
          </div>
        ) : (
          !splitting && (
            <div className="flex items-center gap-1 border-t border-border-strong pt-2.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 px-1.5 text-[11px]"
                onClick={() => openInserting("before")}
                title="Insert a new word before this one"
              >
                <ArrowLeftToLine className="size-3" /> Insert before
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 px-1.5 text-[11px]"
                onClick={() => openInserting("after")}
                title="Insert a new word after this one"
              >
                <ArrowRightToLine className="size-3" /> Insert after
              </Button>
            </div>
          )
        ))}
      </PopoverContent>
    </Popover>
  );
}
