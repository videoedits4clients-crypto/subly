"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useEditorStore } from "@/store/editor-store";
import {
  computeTextCleanupPreview,
  EMPTY_CLEANUP_SELECTION,
  type CleanupSelection,
  type CaseTransformChoice,
  type TrailingPunctuationChoice,
} from "@/lib/subtitles/text-cleanup";
import { toast } from "sonner";

/**
 * Task 98134 (P11) — batch Text Cleanup: whitespace cleanup, punctuation normalization,
 * conservative capitalization, trailing-punctuation ensure/remove, and blank-caption removal,
 * scoped to the EXISTING P8 `selectedSubtitleIds` selection (never DOM selection). Deliberately
 * one more compact dialog in the same family as search-replace-dialog.tsx — NOT a new editor
 * panel (see this task's own "do not create a completely separate editor experience"). Every
 * toggle defaults OFF/"none" (see this task's own "do not make every operation selected by
 * default"); the live preview (`computeTextCleanupPreview`) is pure and recomputed on every
 * toggle change, so nothing is written to the project until Apply is explicitly clicked.
 */
export function TextCleanupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const project = useEditorStore((s) => s.project);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const applyTextCleanup = useEditorStore((s) => s.applyTextCleanup);
  const [selection, setSelection] = useState<CleanupSelection>(EMPTY_CLEANUP_SELECTION);

  const preview = useMemo(() => {
    if (!project) return null;
    return computeTextCleanupPreview(project.subtitles, selectedIds, selection);
  }, [project, selectedIds, selection]);

  function set<K extends keyof CleanupSelection>(key: K, value: CleanupSelection[K]) {
    setSelection((s) => ({ ...s, [key]: value }));
  }

  function apply() {
    if (!preview || (preview.changedCount === 0 && preview.deleteCount === 0)) return;
    const result = applyTextCleanup(Array.from(selectedIds), selection);
    if (result.changedCount === 0 && result.deletedCount === 0) {
      toast.info("No change — the selected cleanup had no effect on the selected caption(s).");
    } else {
      const parts: string[] = [];
      if (result.changedCount > 0) parts.push(`${result.changedCount} caption${result.changedCount === 1 ? "" : "s"} changed`);
      if (result.deletedCount > 0) parts.push(`${result.deletedCount} blank caption${result.deletedCount === 1 ? "" : "s"} removed`);
      toast.success(
        `Cleanup applied — ${parts.join(", ")}.` + (result.staleCount > 0 ? ` ${result.staleCount} will need a word-timing review.` : ""),
      );
    }
    // Reset the picked operations for next time — an already-applied choice shouldn't silently
    // stay pre-armed the next time this dialog opens (matches "do not make every operation
    // selected by default", extended to "after Apply" too).
    setSelection(EMPTY_CLEANUP_SELECTION);
    onOpenChange(false);
  }

  function cancel() {
    setSelection(EMPTY_CLEANUP_SELECTION);
    onOpenChange(false);
  }

  const examples = preview?.items.filter((i) => !i.willDelete).slice(0, 3) ?? [];
  const canApply = !!preview && (preview.changedCount > 0 || preview.deleteCount > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : cancel())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Text cleanup</DialogTitle>
          <DialogDescription>
            {selectedIds.size} caption{selectedIds.size === 1 ? "" : "s"} selected — pick which deterministic cleanups to apply. Nothing changes
            until you click Apply.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">Text cleanup</p>
            <ToggleRow label="Trim leading/trailing whitespace" checked={selection.trimWhitespace} onChange={(v) => set("trimWhitespace", v)} />
            <ToggleRow label="Normalize repeated spaces" checked={selection.normalizeSpaces} onChange={(v) => set("normalizeSpaces", v)} />
            <ToggleRow
              label="Normalize whitespace around line breaks"
              checked={selection.normalizeLineBreakWhitespace}
              onChange={(v) => set("normalizeLineBreakWhitespace", v)}
            />
            <ToggleRow
              label="Normalize repeated punctuation (!!, ????, ......)"
              checked={selection.normalizeRepeatedPunctuation}
              onChange={(v) => set("normalizeRepeatedPunctuation", v)}
            />
          </section>

          <section className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">Capitalization</p>
            <Select value={selection.caseTransform} onValueChange={(v) => set("caseTransform", v as CaseTransformChoice)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No change</SelectItem>
                <SelectItem value="sentence">Sentence case</SelectItem>
                <SelectItem value="uppercase">UPPERCASE</SelectItem>
                <SelectItem value="lowercase">lowercase</SelectItem>
                <SelectItem value="titlecase">Title Case</SelectItem>
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">Trailing punctuation</p>
            <Select value={selection.trailingPunctuation} onValueChange={(v) => set("trailingPunctuation", v as TrailingPunctuationChoice)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No change</SelectItem>
                <SelectItem value="ensure">Ensure trailing punctuation</SelectItem>
                <SelectItem value="remove">Remove trailing punctuation</SelectItem>
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-2">Empty captions</p>
            <ToggleRow
              label="Remove blank captions (empty or whitespace-only)"
              checked={selection.removeBlankCaptions}
              onChange={(v) => set("removeBlankCaptions", v)}
            />
          </section>

          {preview && preview.hasAnyOperationSelected && (
            <div className="space-y-2 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs">
              <p className="text-foreground">
                {preview.totalSelected} caption{preview.totalSelected === 1 ? "" : "s"} selected — {preview.changedCount} will change,{" "}
                {preview.unchangedCount} unchanged
                {preview.deleteCount > 0 && <>, {preview.deleteCount} blank caption{preview.deleteCount === 1 ? "" : "s"} will be deleted</>}.
              </p>

              {examples.length > 0 && (
                <div className="space-y-1.5 border-t border-border pt-1.5">
                  {examples.map((item) => (
                    <div key={item.id} className="space-y-0.5 font-mono text-[11px]">
                      <p className="text-danger line-through decoration-danger/50">{JSON.stringify(item.before)}</p>
                      <p className="text-success">{JSON.stringify(item.after)}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-border pt-1.5 text-muted-2">
                {preview.staleCount > 0 ? (
                  <p className="flex items-center gap-1.5 text-warning">
                    <AlertTriangle className="size-3 shrink-0" /> {preview.staleCount} caption{preview.staleCount === 1 ? "" : "s"} will have their
                    word count change — existing word timing will be marked stale, not fabricated. You can rebuild timing after applying.
                  </p>
                ) : (
                  <p>Word timing will remain valid for every changed caption.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="accent" onClick={apply} disabled={!canApply}>
            {preview && preview.staleCount > 0 ? "Apply and mark timing stale" : "Apply cleanup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
