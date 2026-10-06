"use client";

import { toast } from "sonner";
import { useEditorStore } from "@/store/editor-store";
import { describeOverrides, summarizeOverrides, type EditScope } from "@/lib/edit-scope";
import { cn } from "@/lib/utils";

/**
 * The two-button "This caption / N selected | All captions" control used by the Templates and Presets tabs. The scope
 * lives in the store (editScope), so the Style and Animation tabs — which have their own, richer header — follow it.
 */
export function ScopeToggle({
  scope,
  hasSelection,
  selectedCount,
  captionCount,
  onChange,
}: {
  scope: EditScope;
  hasSelection: boolean;
  selectedCount: number;
  captionCount: number;
  onChange: (scope: EditScope) => void;
}) {
  return (
    <div className="flex rounded-md border border-border-strong bg-surface p-0.5 text-xs" role="group" aria-label="Apply to">
      <button
        disabled={!hasSelection}
        onClick={() => onChange("selected")}
        className={cn("rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50", scope === "selected" ? "bg-accent text-white" : "text-muted")}
        title={hasSelection ? undefined : "Select one or more captions to change just those"}
      >
        {hasSelection ? (selectedCount === 1 ? "This caption" : `${selectedCount} selected`) : "Selected"}
      </button>
      <button onClick={() => onChange("all")} className={cn("rounded px-2 py-1", scope === "all" ? "bg-accent text-white" : "text-muted")}>
        All captions ({captionCount})
      </button>
    </div>
  );
}

/**
 * Shown while the scope is "All captions" and some captions carry their own look: an edit to the project look does not
 * reach them, and without a hint the panel would appear to ignore the user. States it plainly, and offers the two ways
 * out — edit the selected caption instead, or reset the captions to the project look (one undoable step).
 */
export function OverrideNotice({ kind, className }: { kind: "style" | "animation" | "look"; className?: string }) {
  const project = useEditorStore((s) => s.project);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const selectedId = useEditorStore((s) => s.selectedSubtitleId);
  const setEditScope = useEditorStore((s) => s.setEditScope);
  const clearCaptionLooks = useEditorStore((s) => s.clearCaptionLooks);
  const undo = useEditorStore((s) => s.undo);
  if (!project) return null;
  const summary = summarizeOverrides(project.subtitles);
  const message = describeOverrides(summary, kind);
  if (!message) return null;
  const ids = kind === "style" ? summary.style : kind === "animation" ? summary.animation : summary.any;
  const selection = new Set(selectedIds);
  if (selectedId) selection.add(selectedId);
  const selectedOverridden = ids.some((id) => selection.has(id));

  function reset() {
    const n = clearCaptionLooks(summary.any);
    if (n > 0) toast.success(`${n} ${n === 1 ? "caption now follows" : "captions now follow"} the project look.`, { action: { label: "Undo", onClick: () => undo() } });
  }

  return (
    <div className={cn("rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-[11px] leading-snug text-muted", className)} role="note">
      <p>
        {message} — changes to the project {kind === "look" ? "look" : kind} don&apos;t reach {ids.length === 1 ? "it" : "them"}.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {selectedOverridden && (
          <button className="text-accent underline-offset-2 hover:underline" onClick={() => setEditScope("selected")}>
            Edit the selected caption instead
          </button>
        )}
        <button className="text-muted-2 underline-offset-2 hover:text-danger hover:underline" onClick={reset} title="Removes the custom style and animation of every caption that has one">
          Reset {summary.any.length === 1 ? "it" : `${summary.any.length} captions`} to the project look
        </button>
      </div>
    </div>
  );
}
