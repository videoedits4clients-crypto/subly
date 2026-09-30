/**
 * Centralized, human-readable description of the editor's real keyboard shortcuts (Task 91342,
 * P7.1 — discoverability only). This is NOT a second shortcut system: it changes nothing about
 * how shortcuts behave. The actual execution logic remains exactly where it already lived, one
 * imperative `if` chain in hooks/use-keyboard-shortcuts.ts, deliberately untouched by this task
 * (per its own guard-safety requirements — see that file's own comments on why the
 * isTypingTarget/isAnyDialogOpen guard placement fixed a real prior data-corruption bug and must
 * not be disturbed). This file is display-only metadata, hand-verified against that hook's
 * actual `if` conditions at the time of writing (Task 91342) — it is consumed by
 * components/editor/keyboard-shortcuts-dialog.tsx and by this module's own test file, which
 * cross-checks every entry here against a manually-verified list of the hook's real key
 * combinations so a future edit to one can't silently drift from the other without a test
 * failure. If use-keyboard-shortcuts.ts's behavior changes, update BOTH this file and its test.
 */

export interface ShortcutEntry {
  /** Display key sequence, e.g. ["Ctrl", "Z"] — rendered as individual `<kbd>` chips. Matches
   * the key names already shown in this app's existing tooltips (top-bar.tsx, timeline.tsx —
   * e.g. "Ctrl+Z", not "Cmd+Z"), since the shipped product is Windows-only. */
  keys: string[];
  description: string;
  /** Set only when the shortcut's behavior depends on where focus currently is — e.g. Tab only
   * moves between captions while already editing one; everywhere else it's the browser's normal
   * Tab. Left undefined for shortcuts that behave the same everywhere they're allowed to fire. */
  context?: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

/** Grouped for the help dialog's readability only — grouping has no behavioral meaning and
 * doesn't need to match how use-keyboard-shortcuts.ts happens to order its own `if` checks. */
export const KEYBOARD_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { keys: ["Ctrl", "S"], description: "Save — a safe no-op; autosave already saves your work continuously." },
      { keys: ["Ctrl", "F"], description: "Open Find & Replace — scoped to the current selection if one or more captions are selected." },
      { keys: ["Ctrl", "H"], description: "Also opens Find & Replace (the same dialog as Ctrl+F) — the conventional 'Replace' shortcut." },
      { keys: ["Escape"], description: "Close an open dialog, or deselect the current caption and exit text editing." },
    ],
  },
  {
    title: "Undo / redo",
    shortcuts: [
      { keys: ["Ctrl", "Z"], description: "Undo the last change — including a whole batch operation on multiple selected captions, as one step." },
      { keys: ["Ctrl", "Shift", "Z"], description: "Redo." },
    ],
  },
  {
    title: "Multi-selection",
    shortcuts: [
      { keys: ["Ctrl", "A"], description: "Select every caption." },
    ],
  },
  {
    title: "Clipboard",
    shortcuts: [
      { keys: ["Ctrl", "C"], description: "Copy the selected caption(s)' text.", context: "Copies the selected text instead, while editing a caption's text" },
      { keys: ["Ctrl", "X"], description: "Cut the selected caption(s)' text — clears the text but keeps the caption itself.", context: "Cuts the selected text instead, while editing a caption's text" },
      { keys: ["Ctrl", "V"], description: "Paste into the selected caption(s) — from SUBLY's own copy/cut, or plain text from outside.", context: "Pastes into the selected text instead, while editing a caption's text" },
    ],
  },
  {
    title: "Editing captions",
    shortcuts: [
      { keys: ["Tab"], description: "Move to the next caption's text.", context: "While editing a caption's text" },
      { keys: ["Shift", "Tab"], description: "Move to the previous caption's text.", context: "While editing a caption's text" },
      { keys: ["Enter"], description: "Focus the selected caption's text for editing." },
      { keys: ["Ctrl", "Shift", "S"], description: "Split the selected caption at the current playhead position." },
      { keys: ["Ctrl", "Shift", "M"], description: "Merge the selected caption with the one right after it." },
      { keys: ["Ctrl", "D"], description: "Duplicate the selected caption, or the whole selection if multiple captions (a contiguous block) are selected." },
      { keys: ["Delete"], description: "Delete the selected caption, or every selected caption if multiple are selected.", context: "Backspace also works" },
    ],
  },
  {
    title: "Timing",
    shortcuts: [
      { keys: ["Alt", "←"], description: "Nudge the selected caption (or the whole selection, together) one video frame earlier." },
      { keys: ["Alt", "→"], description: "Nudge the selected caption (or the whole selection, together) one video frame later." },
      { keys: ["["], description: "Nudge the selected word's start 0.05s earlier.", context: "A word must be selected" },
      { keys: ["]"], description: "Nudge the selected word's start 0.05s later.", context: "A word must be selected" },
      { keys: ["Shift", "["], description: "Nudge the selected word's end 0.05s earlier.", context: "A word must be selected" },
      { keys: ["Shift", "]"], description: "Nudge the selected word's end 0.05s later.", context: "A word must be selected" },
    ],
  },
  {
    title: "Caption navigation",
    shortcuts: [
      { keys: ["↑"], description: "Select the previous caption and seek to it." },
      { keys: ["↓"], description: "Select the next caption and seek to it." },
      { keys: ["Home"], description: "Seek to the selected caption's own start.", context: "A caption must be selected" },
      { keys: ["End"], description: "Seek to the selected caption's own end.", context: "A caption must be selected" },
    ],
  },
  {
    title: "Quality issues",
    shortcuts: [
      { keys: ["Alt", "↑"], description: "Go to the previous subtitle-quality issue and select its caption." },
      { keys: ["Alt", "↓"], description: "Go to the next subtitle-quality issue and select its caption." },
    ],
  },
  {
    title: "Playback & seeking",
    shortcuts: [
      { keys: ["Space"], description: "Play or pause." },
      {
        keys: ["←"],
        description: "Seek back 1 second — or, when a word is selected, move to the previous word (crossing into the previous caption at the first word).",
        context: "Not while editing caption text",
      },
      {
        keys: ["→"],
        description: "Seek forward 1 second — or, when a word is selected, move to the next word (crossing into the next caption at the last word).",
        context: "Not while editing caption text",
      },
      { keys: ["Shift", "←"], description: "Seek back 5 seconds.", context: "Not while editing caption text" },
      { keys: ["Shift", "→"], description: "Seek forward 5 seconds.", context: "Not while editing caption text" },
      { keys: ["J"], description: "Jump to the previous caption's start (or back 5s if there are no captions)." },
      { keys: ["K"], description: "Pause." },
      { keys: ["L"], description: "Play — or, if already playing, jump to the next caption's start." },
    ],
  },
];

/** Flat list, derived from the groups above — convenient for the reference test and for any
 * future consumer that doesn't care about display grouping. */
export const KEYBOARD_SHORTCUTS: ShortcutEntry[] = KEYBOARD_SHORTCUT_GROUPS.flatMap((g) => g.shortcuts);
