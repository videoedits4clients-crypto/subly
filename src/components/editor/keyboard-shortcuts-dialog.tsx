"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { KEYBOARD_SHORTCUT_GROUPS } from "@/lib/keyboard-shortcuts-reference";

/** Pure discoverability — renders the existing shortcuts (hooks/use-keyboard-shortcuts.ts),
 * never executes or intercepts any of them. Reads no editor-store state and calls no store
 * action, so opening/closing it can never mark the project dirty (there is nothing here for a
 * "dirty" write to come from). Built entirely from the shared Dialog primitive
 * (components/ui/dialog.tsx) — the same Radix `role="dialog"` content every other dialog in
 * this app already uses — so it's automatically covered by the EXISTING isAnyDialogOpen() guard
 * in use-keyboard-shortcuts.ts: while this dialog is open, every mutating shortcut (undo, split,
 * merge, duplicate, delete, navigation, etc.) already stops firing, with zero new guard code
 * needed here. See the P7.1 report's Part 7 verification for how this was actually exercised
 * live, not just assumed from the guard's existence. */
export function KeyboardShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Every shortcut available in the editor — grouped for reference only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">{group.title}</h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground">{shortcut.description}</p>
                      {shortcut.context && <p className="text-xs text-muted-2">{shortcut.context}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <kbd
                          key={keyIndex}
                          className="rounded-md border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
