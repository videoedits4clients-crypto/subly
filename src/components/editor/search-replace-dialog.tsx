"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEditorStore } from "@/store/editor-store";
import { computeBatchFindReplace } from "@/lib/subtitles/batch-text-ops";
import { toast } from "sonner";

/**
 * Task 97025 (P10): this dialog now has two modes, chosen automatically from the EXISTING P8
 * selection model (`selectedSubtitleIds` — never DOM selection, per that task's own architecture):
 *
 *  - 0 captions selected: the ORIGINAL global find/replace (Replace next / Replace all,
 *    project-wide, case-insensitive-only) — completely UNCHANGED from before this task, so
 *    nothing about its existing behavior regresses.
 *  - 1+ captions selected: the NEW batch mode — scoped to ONLY the selected captions, with
 *    Match case / Whole word options and a live preview ("N replacements in M captions") computed
 *    PURELY (see lib/subtitles/batch-text-ops.ts — calling it never mutates the project) before
 *    an explicit Apply, plus an inline word-timing-safety warning when applicable. Deliberately
 *    reuses this SAME dialog/shortcut rather than adding a second one — "prefer a compact
 *    dialog... do not create a giant new editor panel" (this task's own instruction).
 */
export function SearchReplaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const findReplace = useEditorStore((s) => s.findReplace);
  const applyBatchFindReplace = useEditorStore((s) => s.applyBatchFindReplace);
  const project = useEditorStore((s) => s.project);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const isBatch = selectedIds.size >= 1;

  // Pure — never touches the store. Recomputed on every keystroke while the dialog is open, which
  // is exactly this task's own "do not silently modify the project when opening the operation UI"
  // requirement: nothing is written until Apply is clicked.
  const preview = useMemo(() => {
    if (!isBatch || !project) return null;
    return computeBatchFindReplace(project.subtitles, selectedIds, search, replace, { matchCase, wholeWord });
  }, [isBatch, project, selectedIds, search, replace, matchCase, wholeWord]);

  function run(all: boolean) {
    const count = findReplace(search, replace, all);
    if (count === 0) toast.info("No matches found.");
    else toast.success(`Replaced ${count} match${count === 1 ? "" : "es"}.`);
  }

  function applyBatch() {
    if (!preview || preview.textById.size === 0) return;
    const result = applyBatchFindReplace(Array.from(selectedIds), search, replace, { matchCase, wholeWord });
    if (result.affectedCount === 0) {
      toast.info("No matches found in the selected captions.");
      return;
    }
    toast.success(
      `Replaced ${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"} across ${result.affectedCount} caption${result.affectedCount === 1 ? "" : "s"}.` +
        (result.staleCount > 0 ? ` ${result.staleCount} will need a word-timing review.` : ""),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Find & replace</DialogTitle>
          <DialogDescription>
            {isBatch
              ? `${selectedIds.size} caption${selectedIds.size === 1 ? "" : "s"} selected — search and replace within just this selection.`
              : "Search across every caption's text and optionally replace matches."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="find">Find</Label>
            <Input id="find" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="replace">Replace with</Label>
            <Input id="replace" value={replace} onChange={(e) => setReplace(e.target.value)} />
          </div>

          {isBatch && (
            <>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="match-case" className="font-normal">
                  Match case
                </Label>
                <Switch id="match-case" checked={matchCase} onCheckedChange={setMatchCase} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="whole-word" className="font-normal">
                  Whole word
                </Label>
                <Switch id="whole-word" checked={wholeWord} onCheckedChange={setWholeWord} />
              </div>

              {search && (
                <div className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs text-muted">
                  {preview && preview.textById.size > 0 ? (
                    <>
                      <p>
                        {preview.totalMatches} replacement{preview.totalMatches === 1 ? "" : "s"} in {preview.textById.size} caption
                        {preview.textById.size === 1 ? "" : "s"}.
                      </p>
                      {preview.staleIds.size > 0 && (
                        <p className="mt-1 text-warning">
                          {preview.staleIds.size} caption{preview.staleIds.size === 1 ? "" : "s"} will require word-timing review — the replacement
                          changes the number of words, so the existing timestamps can&apos;t be reused. Real timing is never invented or discarded.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>No matches in the selected caption{selectedIds.size === 1 ? "" : "s"}.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          {isBatch ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="accent" onClick={applyBatch} disabled={!preview || preview.textById.size === 0}>
                {preview && preview.staleIds.size > 0 ? "Apply and mark timing stale" : "Apply"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => run(false)}>
                Replace next
              </Button>
              <Button variant="accent" onClick={() => run(true)}>
                Replace all
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
