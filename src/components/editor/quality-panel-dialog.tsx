"use client";

import { CheckCircle2, ChevronLeft, ChevronRight, Wrench, RefreshCw, SearchCheck, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEditorStore } from "@/store/editor-store";
import { isQualityReportStale, QUALITY_CATEGORY_BY_TYPE, type QualityIssue, type QualityIssueType } from "@/lib/subtitles/quality-analyzer";
import { applyQualityFix, applyAllSafeFixes } from "@/lib/subtitles/quality-fixes";
import { toast } from "sonner";

const ISSUE_LABELS: Record<QualityIssueType, string> = {
  INVALID_DURATION: "Invalid timing",
  OVERLAP: "Overlaps next caption",
  WORD_TIMESTAMP_INVALID: "Invalid word timestamps",
  EMPTY_CAPTION: "Empty caption",
  TOO_MANY_WORDS: "Too many words",
  TOO_MANY_LINES: "Too many lines",
  CHARACTER_LIMIT: "Line too long",
  AWKWARD_LINE_BREAK: "Unbalanced line break",
  ORPHAN_LINE: "Isolated word on its own line",
  TOO_FAST: "Reads too fast",
  TOO_SLOW: "Shown longer than needed",
  TOO_SHORT: "Too short",
  TOO_LONG: "Too long",
  WHITESPACE_ISSUE: "Whitespace needs cleanup",
  REPEATED_PUNCTUATION: "Repeated punctuation",
  SUSPICIOUS_SHORT_TEXT: "Very short caption",
};

// Task 98134 (P11) — the three new content-QA types, surfaced in their own compact "Text" group
// below (parallel to the existing Structural/Readability groups) rather than folded into either —
// none of them are "objectively corrupted data" (Structural) or a configured-rule shortfall
// (Readability), they're content-cleanliness suggestions the batch Text Cleanup workflow fixes.
const TEXT_CONTENT_TYPES: QualityIssueType[] = ["WHITESPACE_ISSUE", "REPEATED_PUNCTUATION", "SUSPICIOUS_SHORT_TEXT"];

// Structural problems (objectively invalid data) vs readability/formatting shortfalls against
// the project's own configured rules — same distinction quality-analyzer.ts's severity model
// documents, used here only to group the compact summary into the two sections Phase 8 asks
// for. "Line-break issues" collapses 4 raw types into one row so this stays a short list, not a
// dashboard — each still keeps its own precise type/message once you drill into an issue.
const STRUCTURAL_TYPES: QualityIssueType[] = ["INVALID_DURATION", "OVERLAP", "WORD_TIMESTAMP_INVALID", "EMPTY_CAPTION"];
const READABILITY_GROUPS: { label: string; types: QualityIssueType[] }[] = [
  { label: "Too fast", types: ["TOO_FAST"] },
  { label: "Too slow", types: ["TOO_SLOW"] },
  { label: "Too short", types: ["TOO_SHORT"] },
  { label: "Too long", types: ["TOO_LONG"] },
  { label: "Too many words", types: ["TOO_MANY_WORDS"] },
  { label: "Line-break issues", types: ["TOO_MANY_LINES", "CHARACTER_LIMIT", "AWKWARD_LINE_BREAK", "ORPHAN_LINE"] },
];

function severityBadgeVariant(severity: QualityIssue["severity"]): "danger" | "warning" | "accent" {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "accent";
}

/** The concrete "Current: X — Target/Maximum/Minimum: Y" line Phase 3 asks for, built straight
 * from the issue's own value/threshold rather than parsing the free-text message — structural
 * issues (overlap, invalid duration, invalid word timestamps, empty caption) already put their
 * concrete facts (timestamps, the specific word) directly in the message instead, since those
 * aren't a single "current vs. target" number. */
function measurementLine(issue: QualityIssue): string | null {
  if (issue.value === undefined || issue.threshold === undefined) return null;
  switch (issue.type) {
    case "TOO_FAST":
      return `Current: ${issue.value.toFixed(1)} CPS  ·  Target: ${issue.threshold} CPS`;
    case "TOO_SLOW":
      return `Current: ${issue.value.toFixed(2)}s on screen  ·  ~${issue.threshold.toFixed(2)}s is comfortable`;
    case "TOO_SHORT":
      return `Current: ${issue.value.toFixed(2)}s  ·  Minimum: ${issue.threshold.toFixed(2)}s`;
    case "TOO_LONG":
      return `Current: ${issue.value.toFixed(2)}s  ·  Maximum: ${issue.threshold.toFixed(2)}s`;
    case "TOO_MANY_WORDS":
      return `Current: ${issue.value} words  ·  Maximum: ${issue.threshold}`;
    case "TOO_MANY_LINES":
      return `Current: ${issue.value} lines  ·  Maximum: ${issue.threshold}`;
    case "CHARACTER_LIMIT":
      return `Current: ${issue.value} characters  ·  Maximum: ${issue.threshold}`;
    case "AWKWARD_LINE_BREAK":
    case "ORPHAN_LINE":
      return `Shorter line: ${issue.value} chars  ·  Longer line: ${issue.threshold} chars`;
    default:
      return null;
  }
}

export function QualityPanelDialog({
  open,
  onOpenChange,
  onNavigateToCaption,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called whenever an issue is navigated to (Go to caption / Previous / Next) — lets the
   * parent (left-panel.tsx) switch the captions tab into view, since that list only renders
   * while its own tab is active. Selection/scroll into the list itself is still handled entirely
   * by the existing selectedSubtitleId-driven mechanism in captions-panel.tsx/timeline.tsx —
   * this callback only makes sure that mechanism has somewhere visible to render into. */
  onNavigateToCaption?: () => void;
}) {
  const project = useEditorStore((s) => s.project);
  const qualityReport = useEditorStore((s) => s.qualityReport);
  const qualityReportSubtitles = useEditorStore((s) => s.qualityReportSubtitles);
  const qualityIssueIndex = useEditorStore((s) => s.qualityIssueIndex);
  const reviewedIssueIds = useEditorStore((s) => s.reviewedIssueIds);
  const runQualityAnalysisAndReview = useEditorStore((s) => s.runQualityAnalysisAndReview);
  const goToQualityIssue = useEditorStore((s) => s.goToQualityIssue);
  const selectSubtitle = useEditorStore((s) => s.selectSubtitle);
  const selectWord = useEditorStore((s) => s.selectWord);
  const seek = useEditorStore((s) => s.seek);
  const replaceAllSubtitles = useEditorStore((s) => s.replaceAllSubtitles);

  if (!project) return null;

  const report = qualityReport;
  const stale = report ? isQualityReportStale(project.subtitles, qualityReportSubtitles) : false;
  // qualityIssueIndex (Task 92618, P7.2) is the ONE shared cursor every entry point uses —
  // keyboard shortcut, top bar Previous/Next buttons, and these in-dialog buttons all move the
  // exact same store value, so they can never disagree about "which issue is current". Falls
  // back to 0 for display before anything has navigated yet, same as this dialog's own previous
  // local-state default.
  const clampedIndex = report?.issues.length ? Math.max(0, Math.min(report.issues.length - 1, qualityIssueIndex ?? 0)) : 0;
  const issue: QualityIssue | undefined = report?.issues[clampedIndex];
  const captionNumber = issue ? issue.captionIndex + 1 : null;
  // Task 99261 (P12) — "how many of THIS report's issues has the reviewer already stepped
  // through" (objective 7: "know when all currently reported issues have been reviewed").
  // Intersected against the current report's own issue ids (not just reviewedIssueIds.size) so a
  // leftover id from a previous, since-replaced report can never inflate this count.
  const reviewedCount = report ? report.issues.filter((i) => reviewedIssueIds.has(i.id)).length : 0;
  const allReviewed = report !== null && report.issues.length > 0 && reviewedCount === report.issues.length;

  // Task 99261 (P12): takes the whole issue (not just its captionId) so "Go to caption" selects
  // the issue's own word too — the exact same caption+word focus goToQualityIssue's Next/Previous
  // already produce, so this button is a real alias for "go to the CURRENT issue," not a
  // caption-only shortcut that silently drops word-level focus.
  function navigateToCaption(target: QualityIssue | undefined) {
    if (!target || !project) return;
    selectSubtitle(target.captionId);
    selectWord(target.wordIndex ?? null);
    const sub = project.subtitles.find((s) => s.id === target.captionId);
    if (sub) seek(sub.start);
    onNavigateToCaption?.();
  }

  function analyze() {
    // Task 99261 (P12): the review-session entry point — runs analysis AND (if the fresh report
    // has any issues) navigates straight to the first one, so "Analyze"/"Re-analyze"/"Analyze
    // Again" always lands the reviewer on Issue 1 rather than a blank "nothing navigated yet"
    // state they'd have to hit Next once more to leave.
    runQualityAnalysisAndReview();
  }

  function fixOne() {
    if (!issue || !project) return;
    const fixed = applyQualityFix(project.subtitles, issue, project.timingRules);
    if (!fixed) {
      toast.info("Nothing safe to change for this issue right now.");
      return;
    }
    replaceAllSubtitles(fixed);
    // Task 99261 (P12): deliberately does NOT re-run analysis here anymore (that used to happen
    // automatically) — the report simply goes stale via the existing isQualityReportStale
    // mechanism (project.subtitles no longer === qualityReportSubtitles), the same way any other
    // edit does. This keeps `qualityIssueIndex`/`reviewedIssueIds` completely stable (the review
    // loop's own "current issue navigation must remain stable" requirement) instead of silently
    // resetting the reviewer back to a blank cursor after every single fix. The now-visible stale
    // banner below is what tells the reviewer to explicitly re-analyze when they're ready.
    toast.success("Fixed. The quality report is now out of date — Analyze again when you're ready to continue.");
  }

  function fixAllSafe() {
    if (!project) return;
    const result = applyAllSafeFixes(project.subtitles, project.timingRules);
    if (result.fixedCount === 0) {
      toast.info("No safe fixes available.");
      return;
    }
    replaceAllSubtitles(result.subtitles);
    // Same reasoning as fixOne() — no silent re-analysis; the stale banner takes over from here.
    toast.success(`Fixed ${result.fixedCount} issue${result.fixedCount === 1 ? "" : "s"}. The quality report is now out of date — Analyze again to refresh it.`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Subtitle quality</DialogTitle>
          <DialogDescription>Check every caption for timing, readability, and structural issues, with safe automatic fixes where available.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              {!report ? (
                <span className="text-muted-2">Not analyzed yet</span>
              ) : report.issues.length === 0 ? (
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="size-4" /> No quality issues found
                </span>
              ) : (
                <>
                  <span className="font-medium text-foreground">{report.issues.length}</span> issue
                  {report.issues.length === 1 ? "" : "s"} found across{" "}
                  <span className="font-medium text-foreground">{report.captionsWithIssues}</span> of {report.totalCaptions} captions
                </>
              )}
            </p>
            <Button variant={report ? "ghost" : "accent"} size={report ? "icon-sm" : "sm"} onClick={analyze} title="Re-run analysis">
              {report ? <RefreshCw className="size-3.5" /> : (
                <>
                  <SearchCheck className="size-3.5" /> Analyze
                </>
              )}
            </Button>
          </div>

          {report && stale && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" /> Quality report is outdated because the project changed. The issues below reflect the
                project as it was at the last analysis, not its current state.
              </span>
              <Button variant="outline" size="sm" className="h-6 shrink-0 px-2 text-xs" onClick={analyze}>
                Analyze again
              </Button>
            </div>
          )}

          {/* Task 99261 (P12) — objective 7: "know when all currently reported issues have been
              reviewed." Only shown against a CURRENT (non-stale) report — a stale report's
              "reviewed" count describes issues that may no longer even be accurate. */}
          {report && !stale && allReviewed && (
            <div className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="size-3.5 shrink-0" /> All {report.issues.length} issue{report.issues.length === 1 ? "" : "s"} reviewed.
            </div>
          )}

          {/* Task 98134 (P11) — compact "CONTENT QA" summary: severity counts + a 3-way
              Timing/Text/Style category breakdown, computed purely from the existing report
              (QUALITY_CATEGORY_BY_TYPE), reusing the existing report infrastructure rather than
              redesigning this panel. */}
          {report && report.issues.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
              <span className="text-muted-2">
                <span className="font-medium text-foreground">{report.issues.length}</span> issues · {report.issueCountsBySeverity.error} error
                {report.issueCountsBySeverity.error === 1 ? "" : "s"} · {report.issueCountsBySeverity.warning} warning
                {report.issueCountsBySeverity.warning === 1 ? "" : "s"} · {report.issueCountsBySeverity.info} info
              </span>
              <span className="flex gap-2.5 text-muted-2">
                {(["Timing", "Text", "Style"] as const).map((cat) => {
                  const count = report.issues.filter((i) => QUALITY_CATEGORY_BY_TYPE[i.type] === cat).length;
                  return (
                    <span key={cat} className={count ? "text-foreground" : ""}>
                      {cat} {count}
                    </span>
                  );
                })}
              </span>
            </div>
          )}

          {report && report.issues.length > 0 && (
            <div className="space-y-2.5 rounded-lg border border-border bg-surface-2 p-2.5">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">Structural</p>
                <div className="space-y-1">
                  {STRUCTURAL_TYPES.map((type) => {
                    const count = report.issueCountsByType[type] ?? 0;
                    return (
                      <div key={type} className="flex items-center justify-between text-xs">
                        <span className={count ? "text-foreground" : "text-muted-2"}>{ISSUE_LABELS[type]}</span>
                        {count ? <Badge variant={severityBadgeVariant(report.issues.find((i) => i.type === type)!.severity)}>{count}</Badge> : <CheckCircle2 className="size-3.5 text-success" />}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">Text content</p>
                <div className="space-y-1">
                  {TEXT_CONTENT_TYPES.map((type) => {
                    const count = report.issueCountsByType[type] ?? 0;
                    return (
                      <div key={type} className="flex items-center justify-between text-xs">
                        <span className={count ? "text-foreground" : "text-muted-2"}>{ISSUE_LABELS[type]}</span>
                        {count ? <Badge variant={severityBadgeVariant(report.issues.find((i) => i.type === type)!.severity)}>{count}</Badge> : <CheckCircle2 className="size-3.5 text-success" />}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">Readability</p>
                <div className="space-y-1">
                  {READABILITY_GROUPS.map((group) => {
                    const count = group.types.reduce((sum, t) => sum + (report.issueCountsByType[t] ?? 0), 0);
                    const firstMatch = count ? report.issues.find((i) => group.types.includes(i.type)) : undefined;
                    return (
                      <div key={group.label} className="flex items-center justify-between text-xs">
                        <span className={count ? "text-foreground" : "text-muted-2"}>{group.label}</span>
                        {count ? <Badge variant={severityBadgeVariant(firstMatch!.severity)}>{count}</Badge> : <CheckCircle2 className="size-3.5 text-success" />}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="size-3.5" /> Safe fixes available
                </span>
                <span className="font-medium text-foreground">{report.safeFixCount}</span>
              </div>
              {report.issues.length - report.safeFixCount > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-warning">
                    <AlertTriangle className="size-3.5" /> Require manual review
                  </span>
                  <span className="font-medium text-foreground">{report.issues.length - report.safeFixCount}</span>
                </div>
              )}
            </div>
          )}

          {issue && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-2">Caption {captionNumber}</span>
                <span className="text-xs text-muted-2" title="Current issue / total issues · how many of the current report's issues you've navigated to so far">
                  {clampedIndex + 1} / {report!.issues.length}
                  {reviewedCount > 0 && ` · ${reviewedCount} reviewed`}
                </span>
              </div>
              <Badge variant={severityBadgeVariant(issue.severity)}>{ISSUE_LABELS[issue.type]}</Badge>
              {measurementLine(issue) && <p className="font-mono text-xs text-foreground">{measurementLine(issue)}</p>}
              <p className="text-sm text-muted">{issue.message}</p>
              <div className="flex items-center justify-between pt-1">
                <div className="flex gap-1">
                  <Button variant="outline" size="icon-sm" onClick={() => goToQualityIssue(-1)} disabled={clampedIndex === 0} title="Previous issue">
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button variant="outline" size="icon-sm" onClick={() => goToQualityIssue(1)} disabled={clampedIndex >= report!.issues.length - 1} title="Next issue">
                    <ChevronRight className="size-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => navigateToCaption(issue)}>
                    Go to caption
                  </Button>
                </div>
                {issue.fixability === "safe" ? (
                  <Button variant="outline" size="sm" onClick={fixOne}>
                    <Wrench className="size-3.5" /> Fix
                  </Button>
                ) : (
                  <span className="text-xs text-muted-2" title="Fixing this would require guessing intent (a word's true timestamp, or which caption is correct) — never done automatically.">
                    Manual review required
                  </span>
                )}
              </div>
            </div>
          )}

          {report && report.safeFixCount > 0 && (
            <Button variant="accent" className="w-full" onClick={fixAllSafe}>
              Fix all safe issues ({report.safeFixCount})
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
