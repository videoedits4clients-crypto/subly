"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, AlertTriangle, Sparkles, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "upload", label: "Uploading" },
  { key: "audio", label: "Extracting audio" },
  { key: "transcribe", label: "Transcribing" },
  { key: "words", label: "Detecting words" },
  { key: "subtitles", label: "Generating subtitles" },
  { key: "editor", label: "Preparing editor" },
] as const;

function stepIndexFor(status: string): number {
  switch (status) {
    case "EMPTY":
      return 0;
    case "LOADING":
      return 1;
    case "TRANSCRIBING":
      return 3;
    case "READY":
    case "EDITING":
    case "EXPORTING":
    case "EXPORTED":
      return 6;
    default:
      return 0;
  }
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function ProcessingScreen({ projectId, onReady }: { projectId: string; onReady: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState("LOADING");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** True from the moment Cancel is clicked until the job actually leaves LOADING/TRANSCRIBING
   * (i.e. until polling observes the real ERROR status) — distinct from `cancelling`, which
   * only covers the brief POST /cancel round-trip. A running transcription can take a while to
   * actually stop (see local-whisper-sidecar.ts's cancelTranscriptionRequest — the worker's
   * cooperative check only runs between decode chunks), so this keeps the UI honestly showing
   * "Cancelling…" for as long as that takes, rather than going quiet and looking frozen. Never
   * set to a "done" state by anything other than the real poll-observed status change — this
   * must never imply cancellation completed before the worker actually stopped. */
  const [cancelRequested, setCancelRequested] = useState(false);
  const [transcriptionDemo, setTranscriptionDemo] = useState<boolean | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getSystemStatus().then((s) => setTranscriptionDemo(s.transcriptionDemo)).catch(() => {});
  }, []);

  useEffect(() => {
    async function poll() {
      try {
        const s = await api.getStatus(projectId);
        setStatus(s.status);
        setErrorMessage(s.errorMessage);
        setProgress(s.progress);
        setElapsedSeconds(s.elapsedSeconds);
        if (s.status === "READY" || s.status === "EDITING") {
          if (timer.current) clearInterval(timer.current);
          onReady();
        }
        if (s.status === "ERROR" && timer.current) {
          clearInterval(timer.current);
        }
      } catch {
        // transient network hiccup — keep polling
      }
    }
    poll();
    timer.current = setInterval(poll, 1200);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [projectId, onReady]);

  const activeIndex = stepIndexFor(status);
  const cancellable = status === "LOADING" || status === "TRANSCRIBING";

  async function retry() {
    setRetrying(true);
    try {
      await api.retryProcessing(projectId);
      setStatus("LOADING");
      setErrorMessage(null);
      setProgress(0);
      setCancelRequested(false);
    } finally {
      setRetrying(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    setCancelRequested(true);
    try {
      await api.cancelProcessing(projectId);
      // The pipeline sets status to ERROR asynchronously once the worker actually
      // acknowledges the cancellation — polling (already running above) picks that up and
      // shows the standard error/Retry screen, so there's nothing further to do here beyond
      // not double-submitting the request.
    } catch {
      // best-effort — if this failed the job likely already finished or errored on its own;
      // the next poll tick will reflect whatever actually happened
    } finally {
      setCancelling(false);
    }
  }

  if (status === "ERROR") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-grid px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted">{errorMessage ?? "We couldn't generate subtitles for this video."}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/dashboard")}>
            Back to dashboard
          </Button>
          <Button variant="accent" onClick={retry} disabled={retrying}>
            {retrying && <Loader2 className="size-4 animate-spin" />}
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-grid px-6">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-cyan">
        <Sparkles className="size-6 text-white" />
      </div>
      <div className="text-center">
        <h1 className="text-xl font-semibold">Generating your subtitles</h1>
        <p className="mt-1 text-sm text-muted">
          {cancelRequested
            ? "Cancelling…"
            : status === "TRANSCRIBING" && progress > 0
              ? `${Math.round(progress)}%${elapsedSeconds !== null ? ` · ${formatElapsed(elapsedSeconds)} elapsed` : ""}`
              : elapsedSeconds !== null && elapsedSeconds > 3
                ? `${formatElapsed(elapsedSeconds)} elapsed`
                : "This usually takes under a minute for short videos — longer videos take longer."}
        </p>
        {transcriptionDemo !== null && (
          <Badge variant={transcriptionDemo ? "warning" : "accent"} className="mt-3">
            {transcriptionDemo ? (
              <>
                <FlaskConical className="size-3" /> Demo transcription mode
              </>
            ) : (
              <>
                <Sparkles className="size-3" /> {typeof window !== "undefined" && window.subly?.isDesktop ? "Local • No account" : "AI transcription"}
              </>
            )}
          </Badge>
        )}
      </div>

      <div className="w-full max-w-sm space-y-3">
        {status === "TRANSCRIBING" && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(2, progress)}%` }} />
          </div>
        )}
        {STEPS.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <div key={step.key} className="flex items-center gap-3">
              <div
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                  done && "border-success bg-success/10 text-success",
                  active && "border-accent bg-accent-soft text-accent",
                  !done && !active && "border-border-strong text-muted-2",
                )}
              >
                {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
              </div>
              <span className={cn("text-sm", done ? "text-muted" : active ? "font-medium text-foreground" : "text-muted-2")}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {cancellable && (
        <Button variant="outline" onClick={cancel} disabled={cancelling || cancelRequested}>
          {(cancelling || cancelRequested) && <Loader2 className="size-4 animate-spin" />}
          {cancelRequested ? "Cancelling…" : "Cancel"}
        </Button>
      )}
    </div>
  );
}
