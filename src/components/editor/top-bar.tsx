"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Undo2, Redo2, Search, Download, Loader2, Check, CloudOff, FlaskConical, Sparkles, Keyboard, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useEditorStore } from "@/store/editor-store";
import { isQualityReportStale } from "@/lib/subtitles/quality-analyzer";
import { AiMenu } from "./ai-menu";
import { SearchReplaceDialog } from "./search-replace-dialog";
import { ExportDialog } from "./export-dialog";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { PasteCaptionsDialog } from "./paste-captions-dialog";
import { toast } from "sonner";

export function TopBar() {
  const router = useRouter();
  const project = useEditorStore((s) => s.project);
  const saveState = useEditorStore((s) => s.saveState);
  const aiToolsDemo = useEditorStore((s) => s.aiToolsDemo);
  const transcriptionDemo = useEditorStore((s) => s.transcriptionDemo);
  const isDesktop = typeof window !== "undefined" && window.subly?.isDesktop === true;
  const past = useEditorStore((s) => s.past);
  const future = useEditorStore((s) => s.future);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const qualityReport = useEditorStore((s) => s.qualityReport);
  const qualityReportSubtitles = useEditorStore((s) => s.qualityReportSubtitles);
  const qualityIssueIndex = useEditorStore((s) => s.qualityIssueIndex);
  const goToQualityIssue = useEditorStore((s) => s.goToQualityIssue);

  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Task 101583 (P14) — opened by the Ctrl+V handler (hooks/use-keyboard-shortcuts.ts) via a
  // custom window event, same pattern as "subly:open-search" just below.
  const [pasteMismatchOpen, setPasteMismatchOpen] = useState(false);
  // UI-only, never touches the store — opening/closing this dialog can never mark the project
  // dirty because there is nothing here that writes to it (see keyboard-shortcuts-dialog.tsx).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  // Syncs the input when the project name changes from OUTSIDE this input
  // (e.g. a crash-recovery restore) without clobbering it while the user is
  // mid-keystroke — typing never touches project.name until onBlur commits it.
  const [lastProjectName, setLastProjectName] = useState(project?.name ?? "");
  if (project && project.name !== lastProjectName) {
    setLastProjectName(project.name);
    setName(project.name);
  }

  useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener("subly:open-search", handler);
    return () => window.removeEventListener("subly:open-search", handler);
  }, []);

  useEffect(() => {
    const handler = () => setPasteMismatchOpen(true);
    window.addEventListener("subly:open-paste-mismatch", handler);
    return () => window.removeEventListener("subly:open-paste-mismatch", handler);
  }, []);

  if (!project) return null;

  // Shared by this button pair and the Alt+↑/↓ keyboard shortcut (use-keyboard-shortcuts.ts) —
  // same store cursor (qualityIssueIndex), same stale-report messaging, so both entry points
  // behave identically (Task 92618, P7.2). Deliberately does NOT re-run analysis itself — see
  // goToQualityIssue's own doc comment on why staleness is surfaced, not silently refreshed.
  function navigateQualityIssue(delta: 1 | -1) {
    if (!qualityReport) {
      toast.info("Run Subtitle quality check first (Settings tab) to find issues.");
      return;
    }
    if (qualityReport.issues.length === 0) {
      toast.success("No quality issues found.");
      return;
    }
    if (isQualityReportStale(project!.subtitles, qualityReportSubtitles)) {
      toast.warning("Quality report may be out of date — re-run the check to refresh the issue list.");
    }
    goToQualityIssue(delta);
  }

  function renameProject(newName: string) {
    if (!newName.trim() || newName === project?.name) return;
    useEditorStore.setState((s) => (s.project ? { project: { ...s.project, name: newName.trim() }, dirty: true } : s));
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <Button variant="ghost" size="icon-sm" onClick={() => router.push("/dashboard")} title="Back to dashboard" aria-label="Back to dashboard">
        <ArrowLeft className="size-4" />
      </Button>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => renameProject(name)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-52 border-none bg-transparent px-2 font-medium focus-visible:ring-1"
      />

      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
          <Undo2 className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">
          <Redo2 className="size-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-2">
        {saveState === "unsaved" && <>Unsaved changes</>}
        {saveState === "saving" && (
          <>
            <Loader2 className="size-3 animate-spin" /> Saving…
          </>
        )}
        {saveState === "saved" && (
          <>
            <Check className="size-3 text-success" /> Saved
          </>
        )}
        {saveState === "error" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1.5 text-danger">
                  <CloudOff className="size-3" /> Unable to save changes
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-56">
                Your changes are kept locally and we&apos;ll keep retrying automatically. Check your connection.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Section 9 of the desktop UX pass: this badge previously always read "Demo
          mode" whenever no OPENAI_API_KEY was set — which is wrong on the desktop
          build, where the video IS being transcribed for real by the local Whisper
          engine even without any API key. The label now reflects the actual
          transcription state, not just "is a cloud key configured". */}
      {transcriptionDemo ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="warning" className="cursor-default">
                <FlaskConical className="size-3" /> Demo transcription
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-56">
              Real transcription isn&apos;t set up on this machine, so captions are generated from a sample script, not your actual audio.
              {aiToolsDemo && " AI text tools (rephrase, translate) also need a cloud key and are using demo logic."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="accent" className="cursor-default">
                <Sparkles className="size-3" /> {isDesktop ? "Local • No account" : "AI transcription"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-56">
              {isDesktop
                ? "Your video is transcribed entirely on this computer — no OpenAI API, no account, no upload."
                : "Transcription is running for real."}
              {aiToolsDemo && " AI text tools (rephrase, translate) still need a cloud key and are using demo logic."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <div className="flex-1" />

      <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)} title="Find & replace (Ctrl+F)">
        <Search className="size-4" /> Search
      </Button>
      {/* Quality issue navigation (Task 92618, P7.2) — works even without opening the Subtitle
          quality panel (Settings tab), and shares the exact same cursor (qualityIssueIndex)
          those in-dialog buttons and the Alt+↑/↓ shortcut use, so wherever it's triggered from,
          "the current issue" always means the same thing. Disabled (not hidden) when there's
          nothing to navigate, per the "no report / no issues" safe-empty-state requirement. */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigateQualityIssue(-1)}
          disabled={!qualityReport || qualityReport.issues.length === 0}
          title="Previous quality issue (Alt+↑)"
          aria-label="Previous quality issue"
        >
          <ChevronLeft className="size-4" />
        </Button>
        {qualityReport && qualityReport.issues.length > 0 && (
          <span className="flex items-center gap-1 font-mono text-[10px] text-muted-2" title="Current quality issue / total issues">
            {(qualityIssueIndex ?? 0) + 1}/{qualityReport.issues.length}
            {/* Task 99261 (P12) — a PERSISTENT stale cue (not just the one-shot toast
                navigateQualityIssue already fires on click) so "is this report still current" is
                visible at a glance, matching objective 6's "know when the report is stale"
                without opening the quality panel dialog at all. */}
            {isQualityReportStale(project.subtitles, qualityReportSubtitles) && (
              <AlertTriangle className="size-2.5 text-warning" aria-label="Report may be out of date" />
            )}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigateQualityIssue(1)}
          disabled={!qualityReport || qualityReport.issues.length === 0}
          title="Next quality issue (Alt+↓)"
          aria-label="Next quality issue"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
        <Keyboard className="size-4" />
      </Button>
      <AiMenu />
      <Button variant="accent" size="sm" onClick={() => setExportOpen(true)}>
        <Download className="size-4" /> Export
      </Button>

      <SearchReplaceDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <PasteCaptionsDialog open={pasteMismatchOpen} onOpenChange={setPasteMismatchOpen} />
    </div>
  );
}
