"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { resolveMismatchPasteMapping, resolvePasteMapping, mappingToTextRecord } from "@/lib/subtitles/caption-clipboard";
import { toast } from "sonner";

/**
 * Task 101583 (P14) — the "count mismatch" confirmation/preview for an internal structured
 * caption paste (spec §5/§15). Opened by hooks/use-keyboard-shortcuts.ts's Ctrl+V handler via the
 * `"subly:open-paste-mismatch"` window event (the same custom-event pattern top-bar.tsx already
 * uses for Ctrl+F/H's SearchReplaceDialog) whenever the number of copied captions doesn't match
 * the number of currently selected destination captions — in EITHER direction, including "1
 * copied caption into several selected." Deliberately its own small dialog rather than the
 * generic ConfirmDialog: that one's `description` is a single plain string and can't render a
 * numbered preview list (see this task's own Phase 0 audit of confirm-dialog.tsx), following the
 * same "own dialog when ConfirmDialog can't express it" precedent as TextCleanupDialog (P11).
 *
 * Deliberately re-reads `captionClipboard`/`selectedSubtitleIds` fresh from the store itself
 * (rather than taking them as props/event payload) — the same pattern SearchReplaceDialog already
 * uses for `selectedSubtitleIds` — so there is exactly one source of truth and no risk of a stale
 * payload if the selection changes between the keydown and this dialog actually opening.
 */
export function PasteCaptionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const project = useEditorStore((s) => s.project);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const clipboard = useEditorStore((s) => s.captionClipboard);
  const applyTextMap = useEditorStore((s) => s.applyTextMap);

  const targetIds = useMemo(() => {
    if (!project) return [];
    return project.subtitles.filter((s) => selectedIds.has(s.id)).map((s) => s.id);
  }, [project, selectedIds]);

  // Recomputed purely, every render this is open — never mutates the project itself. Only
  // meaningful while `open`; the dialog unmounts nothing between opens, so this stays cheap.
  const resolution = useMemo(() => {
    if (!clipboard) return null;
    return resolvePasteMapping(clipboard, targetIds);
  }, [clipboard, targetIds]);

  const isMismatch = resolution?.kind === "mismatch";

  function confirmPaste() {
    if (!clipboard || !isMismatch) return;
    const mapping = resolveMismatchPasteMapping(clipboard, targetIds);
    if (mapping.length === 0) return;
    applyTextMap(mappingToTextRecord(mapping));
    toast.success(`Pasted ${mapping.length} caption${mapping.length === 1 ? "" : "s"}.`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paste captions</DialogTitle>
          <DialogDescription>
            {isMismatch
              ? `${resolution.copiedCount} caption${resolution.copiedCount === 1 ? "" : "s"} copied, ${resolution.selectedCount} caption${resolution.selectedCount === 1 ? "" : "s"} selected. The first ${resolution.pasteCount} caption${resolution.pasteCount === 1 ? "" : "s"} will be pasted — nothing will be repeated or left blank on the rest.`
              : "Nothing to paste — the selection changed since this was opened."}
          </DialogDescription>
        </DialogHeader>

        {isMismatch && resolution.preview.length > 0 && (
          <ol className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs text-muted">
            {resolution.preview.map((text, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-muted-2">{i + 1}.</span>
                <span className="whitespace-pre-wrap break-words">{text || "(empty)"}</span>
              </li>
            ))}
          </ol>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" onClick={confirmPaste} disabled={!isMismatch}>
            {isMismatch ? `Paste ${resolution.pasteCount}` : "Paste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
