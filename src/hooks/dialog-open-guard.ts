/**
 * Pure, dependency-free guard used by use-keyboard-shortcuts.ts — split into its own module
 * (rather than living inline in the hook) purely so it has a direct unit test: the hook itself
 * imports "@/store/editor-store", which Node's native test runner (plain `node --test`, no
 * bundler) can't resolve via the "@/" alias — the same constraint that already motivated
 * lib/subtitles/animation-render.ts and lib/export-status-message.ts as separate, plain-import
 * modules in earlier phases of this project.
 */

/** True while any modal Dialog (Export, Subtitle quality, Presets, Find & Replace, Remove
 * silence, Transcription settings, etc.) — or the word-timing Popover (Task 92618, P7.2) — is
 * actually open. Every one of them renders via a shared Radix primitive (Dialog:
 * src/components/ui/dialog.tsx, Popover: src/components/ui/popover.tsx) whose Content always
 * carries `role="dialog"`. Needed because use-keyboard-shortcuts.ts's listener is a plain
 * `window` keydown listener with no built-in awareness of dialog state: confirmed live that,
 * without this check, pressing Escape to close a dialog ALSO deselected whatever caption was
 * selected in the editor behind it, and arrow keys used to navigate a Select's own options (e.g.
 * the export dialog's Resolution dropdown) ALSO moved the caption selection and seeked the video
 * behind the dialog — neither a Select's trigger/options nor Escape are caught by the hook's own
 * isTypingTarget guard, since none of them are an INPUT/TEXTAREA/contentEditable element.
 *
 * Task 93471 (P7.3): checking element PRESENCE alone is not enough — confirmed live that a
 * closed word-timing Popover can remain mounted in the DOM (still carrying `role="dialog"`,
 * `data-state="closed"`) after its exit animation, in at least this environment, apparently
 * because the animation never actually completes/fires `animationend`, which is what Radix's own
 * Presence wrapper waits for before unmounting. Without checking `data-state`, that single stale
 * node would permanently block every dialog-guarded shortcut (undo, redo, split, merge,
 * duplicate, delete, ...) for the rest of the session after the first popover interaction — every
 * Radix Content element sets `data-state="open"|"closed"` as a stable, documented part of its own
 * animate-in/out styling contract (already relied on by both dialog.tsx's and popover.tsx's own
 * Tailwind classes), so filtering on it here needs no new dependency or fragile heuristic.
 * Checks ALL matching elements (not just the first) so one stale closed node can never mask a
 * different, genuinely open dialog elsewhere in the DOM.
 *
 * Takes an optional `root` (defaults to the real `document`) purely so this predicate has a
 * direct unit test without needing a real browser DOM — the same dependency-injection pattern
 * lib/recovery/stale-job-recovery.ts already uses for the same reason. */
export function isAnyDialogOpen(root: Pick<Document, "querySelectorAll"> = document): boolean {
  const candidates = root.querySelectorAll('[role="dialog"]');
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].getAttribute("data-state") !== "closed") return true;
  }
  return false;
}
