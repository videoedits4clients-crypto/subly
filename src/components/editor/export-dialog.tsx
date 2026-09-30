"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Download, Loader2, CheckCircle2, FileText, Captions, AlertTriangle, Link2, History, Type, SearchCheck } from "lucide-react";
import { useEditorStore } from "@/store/editor-store";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/utils";
import { isFontUnavailableMessage } from "@/lib/fonts/font-preflight-message";
import { isExportCancelledMessage } from "@/lib/export-status-message";
import { exportDownloadFilename, historyStatusLabel } from "@/lib/export-history-format";
import { toast } from "sonner";

interface ExportHistoryItem {
  id: string;
  status: string;
  resolution: string;
  format: string;
  fps: number;
  outputUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}

type Resolution = "720p" | "1080p" | "4k";
type Quality = "low" | "medium" | "high" | "maximum";

const STAGE_LABEL: Record<string, string> = {
  preparing: "Preparing…",
  rendering: "Rendering…",
  finalizing: "Finalizing…",
  complete: "Complete",
};

/** A compact, factual export-readiness line — never a reason to block export (the user stays in
 * control, per this phase's explicit "do not block export because of warnings"), and never an
 * arbitrary 0-100 score. Reads whatever analysis already ran (see left-panel.tsx's "Subtitle
 * quality" panel) rather than running its own — analysis is user-triggered, not automatic on
 * every dialog open, so a project that's never been checked just says so instead of guessing. */
function QualityReadinessRow({ report, onAnalyze }: { report: ReturnType<typeof useEditorStore.getState>["qualityReport"]; onAnalyze: () => void }) {
  if (!report) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-2">
        <span>Subtitle quality hasn&apos;t been checked yet.</span>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onAnalyze}>
          <SearchCheck className="size-3 shrink-0" /> Check now
        </Button>
      </div>
    );
  }

  if (report.issues.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
        <CheckCircle2 className="size-3.5 shrink-0" /> No quality issues detected
      </div>
    );
  }

  if (report.issueCountsBySeverity.error > 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        <AlertTriangle className="size-3.5 shrink-0" /> Structural issues remain ({report.issueCountsBySeverity.error})
      </div>
    );
  }

  const manualCount = report.issues.length - report.safeFixCount;
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      <AlertTriangle className="size-3.5 shrink-0" />
      {report.issues.length} warning{report.issues.length === 1 ? "" : "s"}
      {manualCount > 0 && <span>&nbsp;·&nbsp;{manualCount} require manual review</span>}
    </div>
  );
}

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const project = useEditorStore((s) => s.project);
  const qualityReport = useEditorStore((s) => s.qualityReport);
  const runQualityAnalysis = useEditorStore((s) => s.runQualityAnalysis);
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [fps, setFps] = useState("30");
  const [quality, setQuality] = useState<Quality>("high");
  // Composition options (see types/subtitle.ts CompositionSettings) — seeded from the
  // project's current settings each time the dialog opens. The project's canvas dimensions
  // are the ONE source of truth for output aspect ratio (see lib/ffmpeg/index.ts
  // computeExportDimensions) — there's no separate export aspect-ratio choice anymore;
  // "Resolution" below scales the canvas up/down as export quality without changing its ratio.
  const [videoVisible, setVideoVisible] = useState(project?.composition.videoVisible ?? true);
  const [backgroundColor, setBackgroundColor] = useState(project?.composition.backgroundColor ?? "#000000");

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("preparing");
  const [progress, setProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportHistoryItem[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset the aspect ratio default from the project each time the dialog is
  // (re-)opened, without clobbering the user's in-dialog choice on every
  // unrelated project update (the store replaces `project` on every edit).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && project) {
      setVideoVisible(project.composition.videoVisible);
      setBackgroundColor(project.composition.backgroundColor);
      api.listExportJobs(project.id).then(setHistory).catch(() => setHistory([]));
    }
  }

  useEffect(() => {
    if (!jobId || !project) return;
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.getExportJob(project.id, jobId);
        setStatus(job.status);
        setStage(job.stage);
        setProgress(job.progress);
        if (job.status === "DONE") {
          setOutputUrl(job.outputUrl);
          if (pollRef.current) clearInterval(pollRef.current);
          api.listExportJobs(project.id).then(setHistory).catch(() => {});
        }
        if (job.status === "ERROR") {
          setErrorMessage(job.errorMessage ?? "Something went wrong while exporting your video.");
          if (pollRef.current) clearInterval(pollRef.current);
          // Same history refresh as the DONE branch above — a failed (or cancelled) export must
          // show up in "what did I export?" immediately, not only after the dialog is closed and
          // reopened (which is the only other place history gets (re)fetched).
          api.listExportJobs(project.id).then(setHistory).catch(() => {});
        }
      } catch {
        // transient — keep polling
      }
    }, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, project]);

  async function startExport(allowFontFallback = false) {
    if (!project) return;
    setOutputUrl(null);
    setErrorMessage(null);
    setProgress(0);
    setStage("preparing");
    setStatus("QUEUED");
    try {
      const { id } = await api.startExport(project.id, {
        resolution,
        fps: Number(fps),
        quality,
        videoVisible,
        backgroundColor,
        canvasWidth: project.composition.canvasWidth,
        canvasHeight: project.composition.canvasHeight,
        allowFontFallback,
      });
      setJobId(id);
    } catch {
      setErrorMessage("Couldn't start the export. Please try again.");
      setStatus("ERROR");
    }
  }

  async function cancelExport() {
    if (!project || !jobId) return;
    setCancelling(true);
    try {
      await api.cancelExport(project.id, jobId);
      // Status flips to ERROR ("Export cancelled.") asynchronously once ffmpeg actually stops
      // — the existing poll loop above picks that up, same as any other export failure.
    } catch {
      // best-effort — the export likely already finished or failed on its own by the time
      // this request landed; the next poll tick reflects whatever actually happened
    } finally {
      setCancelling(false);
    }
  }

  async function copyLink() {
    if (!outputUrl) return;
    try {
      await navigator.clipboard.writeText(new URL(outputUrl, window.location.origin).toString());
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  const busy = status === "QUEUED" || status === "RUNNING";
  const failed = status === "ERROR";
  // A blocked-by-font-preflight failure gets its own actions (go fix the font, or explicitly
  // choose to export with a substitute) instead of the plain "Retry export" every other export
  // failure gets — detected from the message itself (see isFontUnavailableMessage's doc
  // comment) rather than a new ExportJob column, since this is the one place that distinction
  // is ever needed.
  const fontUnavailable = failed && isFontUnavailableMessage(errorMessage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export video</DialogTitle>
          <DialogDescription>Captions are burned directly into the video using SUBLY&apos;s bundled FFmpeg.</DialogDescription>
        </DialogHeader>

        {!busy && !outputUrl && !failed && (
          <div className="space-y-4">
            {/* Informational only — see quality-analyzer.ts's deriveQualityState. Export always
                stays available regardless of what this shows; the user decides whether readability
                warnings matter for this export, and there is no arbitrary overall "score" here,
                only counts of things that are actually true. */}
            <QualityReadinessRow report={qualityReport} onAnalyze={runQualityAnalysis} />

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3">
              <div>
                <p className="text-sm font-medium">Video layer</p>
                <p className="text-xs text-muted-2">
                  {videoVisible ? "Video + background + captions." : "Off — exports background + captions only, no video frames."}
                </p>
              </div>
              <Switch checked={videoVisible} onCheckedChange={setVideoVisible} />
            </div>

            {/* Composition (project canvas) — the one source of truth for output aspect
                ratio, shown read-only here regardless of Video layer state; edited from the
                editor's own Settings tab, not per-export. Background is still editable per
                export since it visibly matters in both branches: padded around a contained
                video, or filling the whole frame when Video is off. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Composition</Label>
                <p className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm">
                  {project?.composition.canvasWidth} × {project?.composition.canvasHeight}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Background</Label>
                <ColorPicker value={backgroundColor} onChange={setBackgroundColor} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Export quality</Label>
                <Select value={resolution} onValueChange={(v) => setResolution(v as Resolution)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="1080p">1080p</SelectItem>
                    <SelectItem value="4k">4K</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>FPS</Label>
                <Select value={fps} onValueChange={setFps}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24</SelectItem>
                    <SelectItem value="30">30</SelectItem>
                    <SelectItem value="60">60</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Quality</Label>
                <Select value={quality} onValueChange={(v) => setQuality(v as Quality)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="maximum">Maximum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="mb-2 text-xs font-medium text-muted">Subtitle files</p>
              <div className="flex gap-2">
                {(["srt", "vtt", "txt"] as const).map((fmt) => (
                  <a
                    key={fmt}
                    href={project ? api.subtitlesDownloadUrl(project.id, fmt) : "#"}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface px-2 py-2 text-xs uppercase text-muted hover:text-foreground"
                  >
                    {fmt === "txt" ? <FileText className="size-3.5" /> : <Captions className="size-3.5" />}
                    {fmt}
                  </a>
                ))}
              </div>
            </div>

            {history !== null && history.length > 0 && (
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                  <History className="size-3.5" /> Export history
                </p>
                <div className="max-h-32 space-y-1.5 overflow-y-auto">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 rounded-md bg-surface px-2 py-1.5 text-xs">
                      <span className="text-muted">
                        {h.resolution} · {h.fps}fps · {relativeTime(h.createdAt)}
                      </span>
                      {h.status === "DONE" && h.outputUrl ? (
                        <a
                          href={h.outputUrl}
                          download={project ? exportDownloadFilename(project.name, h.resolution) : true}
                          className="text-accent hover:underline"
                        >
                          Download
                        </a>
                      ) : (
                        <span className={h.status === "ERROR" && !isExportCancelledMessage(h.errorMessage) ? "text-danger" : "text-muted-2"}>
                          {historyStatusLabel(h)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {busy && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-8 animate-spin text-accent" />
            <p className="text-sm font-medium">{STAGE_LABEL[stage] ?? "Rendering…"}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-2">{progress}% — this can take a few minutes for longer videos.</p>
            <Button variant="outline" size="sm" onClick={cancelExport} disabled={cancelling}>
              {cancelling && <Loader2 className="size-3.5 animate-spin" />}
              Cancel
            </Button>
          </div>
        )}

        {failed && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
              {fontUnavailable ? <Type className="size-6" /> : <AlertTriangle className="size-6" />}
            </div>
            <p className="text-sm font-medium">{fontUnavailable ? "Font unavailable" : "Export failed"}</p>
            <p className="max-w-xs whitespace-pre-line text-xs text-muted-2">{errorMessage}</p>
            {fontUnavailable && (
              <Button variant="outline" size="sm" onClick={() => startExport(true)}>
                Export with a substitute font
              </Button>
            )}
          </div>
        )}

        {outputUrl && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="size-8 text-success" />
            <p className="text-sm font-medium">Your video is ready</p>
            <video src={outputUrl} controls className="max-h-64 w-auto rounded-lg border border-border bg-black" />
            <div className="flex gap-2">
              <Button variant="accent" asChild>
                <a href={outputUrl} download={project ? exportDownloadFilename(project.name, resolution) : true}>
                  <Download className="size-4" /> Download video
                </a>
              </Button>
              <Button variant="outline" onClick={copyLink}>
                <Link2 className="size-4" /> Copy link
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {!busy && !outputUrl && fontUnavailable && (
            // Retrying with the same settings would just hit the same missing font again — the
            // useful next step is going back to fix the style (see the inline "Export with a
            // substitute font" action above for the explicit-fallback alternative), so this
            // primary action closes the dialog instead of re-submitting the same export.
            <Button variant="accent" onClick={() => onOpenChange(false)}>
              Choose another font
            </Button>
          )}
          {!busy && !outputUrl && !fontUnavailable && (
            <Button variant="accent" onClick={() => startExport()}>
              {failed ? "Retry export" : "Start export"}
            </Button>
          )}
          {outputUrl && (
            <Button variant="outline" onClick={() => setOutputUrl(null)}>
              Export again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
