import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { isAnyDialogOpen } from "./dialog-open-guard";
import { isQualityReportStale } from "@/lib/subtitles/quality-analyzer";
import { WORD_NUDGE_STEP_SEC } from "@/lib/subtitles/word-timing";
import { resolveWordNavigation } from "@/lib/subtitles/word-navigation";
import {
  buildCaptionClipboard,
  formatClipboardAsPlainText,
  mappingToTextRecord,
  resolvePasteMapping,
} from "@/lib/subtitles/caption-clipboard";
import type { CaptionOutputMode } from "@/types/subtitle";
import { toast } from "sonner";

/** Task 106284 (P17.1) — a small, purely-presentational clarification: Copy/Cut/Paste always
 * operate on the AUTHORITATIVE Original caption text (see lib/subtitles/caption-clipboard.ts
 * buildCaptionClipboard, which reads `s.text`, never the currently-displayed derived text) —
 * completely unchanged, mode-independent behavior. What changes here is only the toast WORDING:
 * while viewing a derived (Hinglish/Gujarati Script) mode, the toast says so, so a user looking at
 * Hinglish text on screen isn't surprised that what lands on the OS clipboard is Devanagari. No
 * semantics change, no mode-dependent branching in the clipboard logic itself — see
 * copySelectedCaptions/cutSelectedCaptions/pasteIntoSelectedCaptions below, all otherwise
 * unmodified. */
function clipboardModeSuffix(mode: CaptionOutputMode): string {
  return mode === "original" ? "" : " (Original text)";
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/** True when `el` currently has a non-empty NATIVE text selection — used only by the Ctrl/Cmd+C
 * handling below (Task 101583, P14), which needs a finer check than the plain isTypingTarget
 * boolean every other guarded shortcut in this file uses (see that handler's own doc comment for
 * why). Wrapped in try/catch: `selectionStart`/`selectionEnd` throw on a few `<input>` types
 * (e.g. type="number"/"email") that don't support text selection at all — never actually reached
 * by a caption's own Textarea (always plain text) or the project-name Input, but defensive
 * regardless, matching this codebase's existing localStorage/clipboard try/catch convention. */
function hasNativeTextSelection(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    try {
      return el.selectionStart !== null && el.selectionStart !== el.selectionEnd;
    } catch {
      return false;
    }
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed;
  }
  return false;
}

/** Moves the caption selection by `delta` (±1), seeking the video to match. When `focusTextarea`
 * is true (Tab navigation while editing), also asks the captions panel to focus the target
 * caption's own textarea so typing can continue uninterrupted — done via a store request
 * (requestCaptionFocus) that the panel's own useEffect fulfills once React has actually
 * committed the new selection, rather than a `requestAnimationFrame` DOM query from out here:
 * that raced against React's render timing and, confirmed live in the packaged app, could
 * update the selection but never actually move focus. */
function selectCaptionByOffset(delta: 1 | -1, focusTextarea: boolean) {
  const store = useEditorStore.getState();
  const subtitles = store.project?.subtitles;
  if (!subtitles?.length) return;

  const currentIndex = store.selectedSubtitleId
    ? subtitles.findIndex((s) => s.id === store.selectedSubtitleId)
    : subtitles.findIndex((s) => store.currentTime >= s.start && store.currentTime < s.end);

  const nextIndex = Math.max(0, Math.min(subtitles.length - 1, (currentIndex === -1 ? 0 : currentIndex) + delta));
  const target = subtitles[nextIndex];
  store.selectSubtitle(target.id);
  store.seek(target.start);

  if (focusTextarea) store.requestCaptionFocus(target.id);
}

/** Task 102741 (P15) — moves the word selection by `delta` (±1), only when a word is already
 * selected (a no-op otherwise — see the caller's own guard). Crossing the current caption's
 * first/last word moves to the adjacent caption's last/first word (see
 * lib/subtitles/word-navigation.ts resolveWordNavigation for the pure "what's next" resolution —
 * this wrapper only adds the DOM/store side effects). Seeks the playhead to the newly-selected
 * word's own start — same convention selectCaptionByOffset above already uses for caption-level
 * Up/Down navigation, so word-level Left/Right behaves consistently with it. When navigation
 * crosses into a different caption, `selectSubtitle` alone already triggers BOTH
 * captions-panel.tsx's and timeline.tsx's own existing selectedId-driven scroll-into-view effects
 * — no new scrolling code needed, and playback auto-scroll (a completely separate, isPlaying-only
 * effect) is untouched. `selectSubtitle` on its own would also CLEAR `selectedWordIndex` (it
 * always does when the caption actually changes — see its own doc comment), so `selectWord` is
 * called right after, as a second, separate, synchronous store update — by the time anything
 * re-renders both the new caption AND the new word index are already set together. */
function selectWordByOffset(delta: 1 | -1) {
  const store = useEditorStore.getState();
  const project = store.project;
  if (!project || store.selectedSubtitleId === null || store.selectedWordIndex === null) return;
  const target = resolveWordNavigation(project.subtitles, store.selectedSubtitleId, store.selectedWordIndex, delta);
  if (!target) return;

  if (target.captionId !== store.selectedSubtitleId) store.selectSubtitle(target.captionId);
  store.selectWord(target.wordIndex);

  const caption = project.subtitles.find((s) => s.id === target.captionId);
  const word = caption?.words[target.wordIndex];
  if (word) store.seek(word.start);
}

/** Best-effort write to the real OS clipboard (Task 101583, P14) — the internal
 * `captionClipboard` store field is already populated by the time this is called, so a failure
 * here (unsupported/non-secure context, permission denied) never loses anything: internal
 * copy/cut/paste keeps working purely off that field regardless. Only pasting into a DIFFERENT
 * application depends on this succeeding. */
function writeOsClipboardBestEffort(text: string) {
  try {
    // navigator.clipboard.writeText() returns a Promise that REJECTS (not throws) on failure
    // (e.g. a permission-denied write in some browser/automation contexts) — .catch() here is
    // required, not just this try/catch, or that rejection surfaces as an unhandled promise
    // rejection (confirmed live during this task's own dev QA).
    void navigator.clipboard.writeText(text).catch(() => {});
  } catch {
    // best-effort only, see doc comment above
  }
}

/** Ctrl/Cmd+C outside any text input (Task 101583, P14) — copies the current caption selection's
 * text into the internal structured clipboard AND, best-effort, the real OS clipboard as plain
 * text (one caption's text per line), so pasting into another application also works. Never
 * touches history — copying isn't a project mutation, so no commit() is ever called (P14 §10: "no
 * history entry"). A no-op (with an informational toast) when nothing is selected, matching every
 * other selection-scoped shortcut in this file (e.g. Ctrl+D above). */
function copySelectedCaptions() {
  const store = useEditorStore.getState();
  const project = store.project;
  if (!project) return;
  const ids = project.subtitles.filter((s) => store.selectedSubtitleIds.has(s.id)).map((s) => s.id);
  if (ids.length === 0) {
    toast.info("Nothing selected to copy.");
    return;
  }
  const clipboard = buildCaptionClipboard(project.subtitles, ids);
  store.setCaptionClipboard(clipboard);
  writeOsClipboardBestEffort(formatClipboardAsPlainText(clipboard));
  const suffix = clipboardModeSuffix(project.captionOutputMode);
  toast.success((ids.length === 1 ? "Copied caption" : `Copied ${ids.length} captions`) + suffix);
}

/** Ctrl/Cmd+X outside any text input — cuts the selected caption(s)' text: copies it (same as
 * copySelectedCaptions) then clears the text via the EXISTING applyTextMap commit path, in ONE
 * commit for the whole selection regardless of size (P14 §10: "cut 5 captions = one history
 * entry"). Deliberately does NOT delete the caption(s) themselves, only their text — the
 * resulting empty caption(s) are surfaced by the existing EMPTY_CAPTION quality check rather than
 * silently vanishing (P14 §3/§12; see quality-analyzer.ts, which flags `!text.length` before it
 * even looks at word count). Word timing is handled exactly as applyTextMap/remapWordsToText
 * already handle any text change: a caption's `words` array is left completely untouched when the
 * new token count doesn't match the old one (empty text is a 0-token mismatch for any
 * non-empty caption) — nothing is fabricated, it's simply moot once the caption itself is
 * empty. */
function cutSelectedCaptions() {
  const store = useEditorStore.getState();
  const project = store.project;
  if (!project) return;
  const ids = project.subtitles.filter((s) => store.selectedSubtitleIds.has(s.id)).map((s) => s.id);
  if (ids.length === 0) {
    toast.info("Nothing selected to cut.");
    return;
  }
  const clipboard = buildCaptionClipboard(project.subtitles, ids);
  store.setCaptionClipboard(clipboard);
  writeOsClipboardBestEffort(formatClipboardAsPlainText(clipboard));
  store.applyTextMap(mappingToTextRecord(ids.map((id) => ({ targetId: id, text: "" }))));
  const suffix = clipboardModeSuffix(project.captionOutputMode);
  toast.success((ids.length === 1 ? "Cut caption" : `Cut ${ids.length} captions`) + suffix);
}

/** Ctrl/Cmd+V outside any text input — routes through the internal structured clipboard when one
 * is populated (P14 §4/§5): an exact copied-count/selected-count match pastes immediately (one
 * applyTextMap commit, one undo step, destination timing/style never touched — P14 §16); a
 * mismatch in EITHER direction (more copied than selected, more selected than copied, or "1
 * copied into several selected") opens the confirmation/preview dialog instead of guessing (see
 * paste-captions-dialog.tsx) and applies nothing until the user explicitly confirms. With no
 * internal clipboard (or an empty one), falls back to the real OS clipboard's plain text, always
 * targeting ONLY the single focused caption regardless of how large the current multi-selection
 * is (P14 §6: "if the implementation cannot reliably distinguish structured multi-caption text
 * from internal caption line breaks, use single-caption paste rather than guessing" — this never
 * splits OS clipboard text by newline across multiple destination captions). Async only for that
 * OS-clipboard fallback (navigator.clipboard.readText() is promise-based); the internal-clipboard
 * path resolves synchronously. */
async function pasteIntoSelectedCaptions() {
  const store = useEditorStore.getState();
  const project = store.project;
  if (!project) return;
  const targetIds = project.subtitles.filter((s) => store.selectedSubtitleIds.has(s.id)).map((s) => s.id);
  if (targetIds.length === 0) {
    toast.info("Nothing selected to paste into.");
    return;
  }

  const suffix = clipboardModeSuffix(project.captionOutputMode);
  const clipboard = store.captionClipboard;
  if (clipboard && clipboard.captions.length > 0) {
    const resolution = resolvePasteMapping(clipboard, targetIds);
    if (resolution.kind === "match") {
      store.applyTextMap(mappingToTextRecord(resolution.mapping));
      toast.success((targetIds.length === 1 ? "Pasted caption" : `Pasted ${targetIds.length} captions`) + suffix);
    } else if (resolution.kind === "mismatch") {
      // Applies nothing itself — the dialog (mounted in top-bar.tsx) reads captionClipboard/
      // selectedSubtitleIds fresh from the store when it opens and calls applyTextMap only once
      // the user explicitly confirms (or does nothing at all on Cancel).
      window.dispatchEvent(new CustomEvent("subly:open-paste-mismatch"));
    }
    return;
  }

  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    toast.error("Couldn't read the clipboard.");
    return;
  }
  if (!text) {
    toast.info("Clipboard is empty.");
    return;
  }
  const focusedId = store.selectedSubtitleId && targetIds.includes(store.selectedSubtitleId) ? store.selectedSubtitleId : targetIds[0];
  store.updateSubtitleText(focusedId, text);
  toast.success("Pasted caption" + suffix);
}

/** Wires the global editor keyboard shortcuts (spec section 26). */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const store = useEditorStore.getState();
      const meta = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+S, Ctrl/Cmd+F, Ctrl/Cmd+H, Escape, and Tab/Shift+Tab are the only shortcuts
      // that deliberately fire even while typing inside a caption's textarea (each documented
      // at its own check below) — none of them can mutate caption data BY THEMSELVES (opening a
      // dialog is not a mutation — see search-replace-dialog.tsx's own "do not silently modify
      // the project when opening the operation UI" contract), so none of them risk silently
      // discarding or overwriting a caption's own uncommitted local edit. Every shortcut that
      // DOES mutate a caption (undo, redo, split, merge, duplicate, delete, navigation) is
      // checked further down, after the isTypingTarget guard — see that guard's own comment for
      // why undo/redo/split specifically had to move there.
      if (meta && e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        return; // autosave already handles persistence; explicit no-op save.
      }
      // Ctrl/Cmd+F and Ctrl/Cmd+H both open the SAME Find & Replace dialog (Task 97025, P10
      // added H as a second, conventional "Replace" entry point — Ctrl+H is unused anywhere else
      // in this file, confirmed by reading it in full before adding this). The dialog itself
      // decides its own mode from the current selection (0 selected = the original project-wide
      // find/replace; 1+ selected = the new batch-scoped mode with preview) — there is nothing
      // for this handler itself to decide, so both keys share one dispatch.
      if (meta && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "h")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("subly:open-search"));
        return;
      }

      // Escape means "cancel" everywhere, including while typing a caption —
      // it should exit text editing, not be swallowed by it. EXCEPT while a modal dialog is
      // open: closing IT is Escape's job there (Radix's own Dialog already does this), and
      // this handler must not also reach through the dialog to deselect the caption/blur focus
      // behind it — see isAnyDialogOpen's own doc comment.
      if (e.key === "Escape") {
        if (isAnyDialogOpen()) return;
        store.selectSubtitle(null);
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }

      // Ctrl/Cmd+C/X/V (Task 101583, P14) are checked HERE, ahead of the blanket isTypingTarget
      // guard below, because they need a more nuanced rule than every other guarded shortcut in
      // this file. Selecting a caption ALWAYS focuses its own Textarea (see captions-panel.tsx's
      // CaptionRow — its onFocus IS how a plain click selects a caption), so gating C/X/V on
      // isTypingTarget alone would silently swallow every one of them as a native no-op the
      // instant ANY caption is selected — making the single most common "select a caption, then
      // Ctrl+C/X/V it" workflow completely unreachable via keyboard, which is the opposite of
      // this task's whole point. Native copy/cut/paste still wins whenever the two things that
      // actually matter for "is the user editing text right now" are true: focus is in a typing
      // target AND it's either NOT a caption's own textarea (search box, project name, a dialog's
      // input, a numeric field — every one of those keeps the exact ordinary blanket
      // isTypingTarget behavior, unchanged) OR it IS a caption's textarea but that textarea
      // currently has an actual non-empty text selection (normal mid-sentence editing — the
      // worked example in this task's own spec §13: "selecting 'world' inside a textarea and
      // pressing Ctrl+C copies 'world'"). Everywhere else — nothing focused, or a caption's own
      // textarea focused with NO selection in it (the ordinary "I just selected this caption"
      // state) — these act on the caption selection instead, behind the same isAnyDialogOpen
      // guard every other editor-scoped shortcut below already uses.
      if (meta && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x" || e.key.toLowerCase() === "v")) {
        const target = e.target;
        const isCaptionTextarea = target instanceof HTMLTextAreaElement && !!target.closest("[data-sub-id]");
        const nativeEditingWins = isTypingTarget(target) && (!isCaptionTextarea || hasNativeTextSelection(target));
        if (!nativeEditingWins && !isAnyDialogOpen()) {
          e.preventDefault();
          const key = e.key.toLowerCase();
          if (key === "c") copySelectedCaptions();
          else if (key === "x") cutSelectedCaptions();
          else void pasteIntoSelectedCaptions();
        }
        return;
      }

      // Tab/Shift+Tab move between captions while editing one — lets someone
      // transcribe-edit an entire project without leaving the keyboard. Only
      // hijacks Tab when focus is actually inside a caption's own textarea;
      // everywhere else (dialogs, other inputs) Tab keeps its normal behavior.
      // Specifically checks for the TEXTAREA itself (not just "somewhere inside the caption's
      // [data-sub-id] wrapper div") — Task 92618 (P7.2) added a bounded word-timing popover
      // whose own numeric Start/End inputs also live inside that same wrapper (see
      // captions-panel.tsx/word-timing-popover.tsx); without this, Tab while adjusting a word's
      // timing would jump to a completely different caption instead of just moving focus to the
      // next field, discarding the open popover's context.
      if (e.key === "Tab") {
        const isCaptionTextarea = e.target instanceof HTMLTextAreaElement && (e.target as HTMLElement).closest("[data-sub-id]");
        if (isCaptionTextarea) {
          e.preventDefault();
          selectCaptionByOffset(e.shiftKey ? -1 : 1, true);
        }
        return;
      }

      // Everything below here can mutate a caption (or the undo stack) and so must NEVER fire
      // while the user is typing inside a caption's own textarea — confirmed live that,
      // before this guard covered them, Ctrl+Z / Ctrl+Shift+S while mid-edit in one caption
      // could silently revert or overwrite a DIFFERENT caption's committed text (undo) or
      // discard the very text just typed (split, which re-reads the caption's last-committed
      // words, not the textarea's uncommitted local value) with zero visual warning. Matches
      // the existing, already-correct pattern Delete/Backspace/arrow-navigation used below.
      if (isTypingTarget(e.target)) return;

      // Everything below this point can mutate the project, move caption selection, or control
      // video playback — all of which belong to the editor BEHIND a modal dialog, not to the
      // dialog itself. None of these shortcuts should reach through an open dialog and act on
      // the editor underneath it — see isAnyDialogOpen's own doc comment for the confirmed
      // live symptom (arrow-key Select navigation also moving caption selection/seeking).
      if (isAnyDialogOpen()) return;

      if (meta && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        store.undo();
        return;
      }
      // Select all captions (Task 94820, P8) — the standard "select everything in this list"
      // shortcut; unused anywhere in this file before this task (confirmed by that task's own
      // pre-implementation audit), so it carries no risk of colliding with an existing binding.
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        store.selectAllSubtitles();
        return;
      }
      // "Split Here" — splits the selected caption at the current playhead position (see
      // splitSubtitleAtTime / lib/subtitles/split.ts).
      if (meta && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (store.selectedSubtitleId) {
          const result = store.splitSubtitleAtTime(store.selectedSubtitleId, store.currentTime);
          if (result === "word-straddles-split") toast.error("Can't split here — a word spans the split point.");
          else if (result === "invalid-time" || result === "empty-side") toast.error("Can't split here.");
        }
        return;
      }
      // Merge the selected caption with the one right after it (see mergeWithNext) — the
      // keyboard equivalent of the timeline toolbar's existing "Merge with next" button.
      if (meta && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (store.selectedSubtitleId) {
          const result = store.mergeWithNext(store.selectedSubtitleId);
          if (result === "no-next-caption") toast.error("Nothing after this caption to merge with.");
          else if (result === "overlap" || result === "out-of-bounds") toast.error("Can't merge these captions — their words overlap.");
        }
        return;
      }
      // Duplicate the selected caption (see duplicateSubtitle) — the keyboard equivalent of
      // the timeline toolbar's existing "Duplicate" button. Task 94820 (P8): batch-aware when
      // more than one caption is selected — same contiguous-selection-only rule as the timeline
      // toolbar's own Duplicate button (see duplicateSubtitles' own doc comment for why). Task
      // 95640 (P9): both single and batch duplicate can also reject with "no-room" when the
      // collision-safe placement wouldn't fit.
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (store.selectedSubtitleIds.size > 1) {
          const result = store.duplicateSubtitles(Array.from(store.selectedSubtitleIds));
          if (result === "non-contiguous") toast.error("Batch duplicate needs a contiguous selection — try selecting adjacent captions only.");
          else if (result === "no-room") toast.error("Not enough room to duplicate here — the next caption starts too soon.");
        } else if (store.selectedSubtitleId) {
          const result = store.duplicateSubtitle(store.selectedSubtitleId);
          if (result === "no-room") toast.error("Not enough room to duplicate here — the next caption starts too soon.");
        }
        return;
      }

      // Word-level timing nudge (Task 93471, P7.3) — adjusts ONLY the currently selected WORD's
      // own start or end by WORD_NUDGE_STEP_SEC (0.05s, the exact same step the word-timing
      // popover's own +/- buttons already use — see word-timing-popover.tsx — so the keyboard
      // shortcut and the popover buttons always agree on "one nudge"). Never touches the parent
      // caption's own timing. Uses bracket keys, not an Alt+Arrow variant: this task's own
      // pre-implementation audit confirmed bare Alt+←/→ is already the CAPTION-level nudge, and
      // Ctrl+Alt+←/→ — a natural-seeming "one modifier further out" choice — is a known
      // OS/graphics-driver screen-rotation hotkey on some Windows machines (this app is
      // Windows-only), which could silently swallow the keydown before the renderer ever sees
      // it. `[`/`]` and their Shift-modified forms were confirmed completely unused and carry no
      // such OS-level hijack risk. `[`/`]` adjust the word's START (mirroring how a caption's own
      // left/right timeline handles work); Shift+`[`/`]` adjust its END. A no-op with nothing
      // selected, matching every other selection-scoped shortcut in this file (e.g. Ctrl+D
      // above) — never fabricates a target to act on.
      // Direction (earlier/later) is read from the actual produced character — on a standard
      // layout, holding Shift while pressing the physical bracket key changes `e.key` itself to
      // "{"/"}" (unlike a letter key, where `e.key.toLowerCase()` already normalizes away
      // Shift's case change elsewhere in this file). Which EDGE (start vs end) is read from
      // `e.shiftKey` directly rather than solely from that shifted character, since not every
      // environment recomputes `e.key` for Shift+symbol the same way a physical keyboard does
      // (confirmed during this task's own live QA) — checking both keeps this correct either way.
      if ((e.key === "[" || e.key === "]" || e.key === "{" || e.key === "}") && !meta && !e.altKey) {
        e.preventDefault();
        if (store.selectedSubtitleId && store.selectedWordIndex !== null) {
          const sub = store.project?.subtitles.find((s) => s.id === store.selectedSubtitleId);
          const word = sub?.words[store.selectedWordIndex];
          if (sub && word) {
            const isEarlier = e.key === "[" || e.key === "{";
            const delta = isEarlier ? -WORD_NUDGE_STEP_SEC : WORD_NUDGE_STEP_SEC;
            const isEnd = e.key === "{" || e.key === "}" || e.shiftKey;
            if (isEnd) {
              store.updateWordTiming(sub.id, store.selectedWordIndex, word.start, word.end + delta);
            } else {
              store.updateWordTiming(sub.id, store.selectedWordIndex, word.start + delta, word.end);
            }
          }
        }
        return;
      }

      // Alt+←/→ nudges the selected caption's whole timing (start AND end together, duration
      // preserved) by exactly one video frame — for corrections too small/fiddly to drag
      // precisely with a mouse. Frame-accurate: uses the project's own source fps (falling
      // back to 30 for a project with no video yet, matching the export pipeline's own
      // default). Checked before the plain (unmodified) ArrowLeft/Right seek below so the two
      // never both fire for the same keypress. Never touches the video if nothing is selected.
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const fps = store.project?.video?.fps || 30;
        const frameSec = 1 / fps;
        const deltaSec = e.key === "ArrowLeft" ? -frameSec : frameSec;
        // Task 94820 (P8): moves the WHOLE selection together (one undo step) when more than one
        // caption is selected — see nudgeSubtitles' own doc comment for the clamping rule. Falls
        // back to the original single-caption path (nudgeSubtitleTiming) otherwise, unchanged.
        if (store.selectedSubtitleIds.size > 1) {
          store.nudgeSubtitles(Array.from(store.selectedSubtitleIds), deltaSec);
        } else if (store.selectedSubtitleId) {
          store.nudgeSubtitleTiming(store.selectedSubtitleId, deltaSec);
        }
        return;
      }

      // Alt+↑/↓: next/previous quality issue (Task 92618, P7.2) — same
      // store cursor (qualityIssueIndex) and same stale-report messaging as the top bar's own
      // Previous/Next buttons (top-bar.tsx's navigateQualityIssue) and the quality panel
      // dialog's in-dialog buttons, so every entry point stays in sync. Checked before the
      // plain ArrowUp/Down caption-nav below, same "Alt-modified variant checked first" pattern
      // Alt+←/→ already uses above for the plain ←/→ seek.
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? -1 : 1;
        if (!store.qualityReport) {
          toast.info("Run Subtitle quality check first (Settings tab) to find issues.");
        } else if (store.qualityReport.issues.length === 0) {
          toast.success("No quality issues found.");
        } else {
          if (store.project && isQualityReportStale(store.project.subtitles, store.qualityReportSubtitles)) {
            toast.warning("Quality report may be out of date — re-run the check to refresh the issue list.");
          }
          store.goToQualityIssue(delta);
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectCaptionByOffset(-1, false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectCaptionByOffset(1, false);
        return;
      }

      // Home/End: jump to the SELECTED caption's own start/end (Task 100742, P13) — deliberately
      // NOT J/K as this task's own spec first suggested: this file's pre-existing J/K/L already
      // jump to the nearest caption edge RELATIVE TO THE CURRENT PLAYHEAD among ALL captions (see
      // the J/K/L block below), which is a related but different operation from "seek to exactly
      // the caption I have SELECTED" — e.g. after a Ctrl/Shift-click multi-select (which
      // deliberately does NOT move the playhead, see timeline.tsx's own onClick), J/L would jump
      // relative to wherever the playhead already was, not to the selection's own focused
      // caption. Home/End were confirmed completely unused in this file before this task and
      // carry no OS-level hijack risk (unlike, say, repurposing a bracket or Ctrl-modified key).
      // Seeking only (never mutates caption data), so — like the plain arrow-key seeks just above
      // — this still respects the isTypingTarget/isAnyDialogOpen guards above it, but needs no
      // further guard of its own.
      if (e.key === "Home") {
        e.preventDefault();
        if (store.selectedSubtitleId) {
          const sub = store.project?.subtitles.find((s) => s.id === store.selectedSubtitleId);
          if (sub) store.seek(sub.start);
        }
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (store.selectedSubtitleId) {
          const sub = store.project?.subtitles.find((s) => s.id === store.selectedSubtitleId);
          if (sub) store.seek(sub.end);
        }
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        // Dispatched synchronously so VideoCanvas's play()/pause() call stays
        // inside this trusted keydown's user-gesture chain (see video-canvas.tsx).
        window.dispatchEvent(new CustomEvent("subly:toggle-play"));
        return;
      }
      // Word navigation (Task 102741, P15) — plain (unmodified) Left/Right move between words
      // ONLY when a word is already selected; Shift+Left/Right always keep their existing 5s-seek
      // meaning regardless of word selection (never stolen — a word-nav convenience shouldn't
      // remove an existing shortcut), and plain Left/Right fall through to the existing 1s-seek
      // below whenever no word is selected. Checked here (already past isTypingTarget/
      // isAnyDialogOpen above) so this can never fire while typing, in a dialog, or in any other
      // input — same guard chain every other shortcut in this block already relies on.
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && store.selectedWordIndex !== null) {
        e.preventDefault();
        selectWordByOffset(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        store.seek(Math.max(0, store.currentTime - (e.shiftKey ? 5 : 1)));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        store.seek(store.currentTime + (e.shiftKey ? 5 : 1));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Task 94820 (P8): deletes the whole selection (one undo step) when more than one
        // caption is selected, matching the timeline toolbar's/captions panel's own batch
        // Delete button.
        if (store.selectedSubtitleIds.size > 1) {
          e.preventDefault();
          store.deleteSubtitles(Array.from(store.selectedSubtitleIds));
        } else if (store.selectedSubtitleId) {
          e.preventDefault();
          store.deleteSubtitle(store.selectedSubtitleId);
        }
        return;
      }
      if (e.key === "Enter") {
        if (store.selectedSubtitleId) {
          const el = document.querySelector(`[data-sub-id="${store.selectedSubtitleId}"] textarea`) as HTMLTextAreaElement | null;
          el?.focus();
        }
        return;
      }
      // J/K/L: standard NLE transport controls.
      const subtitles = store.project?.subtitles;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("subly:set-play", { detail: { playing: false } }));
        return;
      }
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (subtitles?.length) {
          const prev = [...subtitles].reverse().find((s) => s.start < store.currentTime - 0.05);
          store.seek(prev ? prev.start : 0);
        } else {
          store.seek(Math.max(0, store.currentTime - 5));
        }
        return;
      }
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (!store.isPlaying) {
          window.dispatchEvent(new CustomEvent("subly:set-play", { detail: { playing: true } }));
        } else if (subtitles?.length) {
          const next = subtitles.find((s) => s.start > store.currentTime + 0.05);
          if (next) store.seek(next.start);
        } else {
          store.seek(store.currentTime + 5);
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
