import path from "path";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { extractAudio } from "@/lib/ffmpeg";
import { getTranscriptionProvider } from "@/lib/transcription";
import { cancelTranscriptionRequest, TranscriptionCancelledError, TranscriptionStalledError } from "@/lib/transcription/local-whisper-sidecar";
import { isSidecarBusyMessage } from "@/lib/transcription-status-message";
import { classifyTranscriptionError, userMessageFor, type TranscriptionStage } from "@/lib/transcription/transcription-error";
import { logDiagnostic, sanitize, sanitizeTail } from "@/lib/diagnostics";
import { promises as fsp } from "fs";
import { segmentWords } from "@/lib/subtitles/segment";
import { resolveTimingRules } from "@/types/subtitle";
import { toJson, fromJson } from "@/lib/db-json";
import { track } from "@/lib/analytics";
import type { TimingRules } from "@/types/subtitle";

/** In-memory registry of the sidecar request id currently transcribing each project, so a
 * Cancel action (see the /cancel API route) can reach the actual running worker call. Process
 * lifetime only — matches this pipeline's existing "runs in-process, fire-and-forget" design
 * (see the module doc comment below); a real queue would carry this in job metadata instead. */
const activeTranscriptions = new Map<string, string>();

/** Returns true if a cancel signal was actually sent (i.e. a transcription for this project
 * was genuinely in flight) — false if there was nothing to cancel. */
export function cancelActiveTranscription(projectId: string): boolean {
  const requestId = activeTranscriptions.get(projectId);
  if (!requestId) return false;
  cancelTranscriptionRequest(requestId);
  return true;
}

/**
 * Runs the full "upload -> subtitled project" pipeline for a project that
 * already has a VideoAsset row. Fired-and-forgotten by the upload route so the
 * HTTP request returns immediately; the client polls
 * GET /api/projects/:id/status for progress (LOADING -> TRANSCRIBING -> READY).
 *
 * NOTE for production: this runs in-process on the Next.js server. For a
 * serverless deployment or heavy concurrent load, move this to a real queue
 * (BullMQ/SQS) — the function itself has no framework dependency so it drops
 * into a worker unchanged.
 */
export async function processVideo(projectId: string): Promise<void> {
  const storage = getStorage();
  let requestId: string | undefined;
  // Where the pipeline currently is — a failure is classified (and logged) with the stage it happened in.
  let stage: TranscriptionStage = "probe";
  const startedAt = Date.now();
  let inputInfo: { ext: string; bytes?: number } | undefined;
  let languageForLog: string | undefined;

  // Throttled DB progress writes — the worker emits a "progress" event per Whisper segment,
  // which for a long video can be many times a second; writing every single one would hammer
  // SQLite for no user-visible benefit. 1s is frequent enough to feel live without it.
  let lastProgressWrite = 0;
  const PROGRESS_WRITE_INTERVAL_MS = 1000;
  function persistProgress(percent: number) {
    const now = Date.now();
    if (now - lastProgressWrite < PROGRESS_WRITE_INTERVAL_MS && percent < 100) return;
    lastProgressWrite = now;
    void prisma.project.update({ where: { id: projectId }, data: { progress: percent } }).catch(() => {});
  }

  try {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { video: true },
    });
    if (!project.video) throw new Error("No video asset attached to project.");

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "LOADING", progress: 0, processingStartedAt: new Date() },
    });

    const inputPath = await storage.getPath(project.video.url.replace(/^\/api\/files\//, ""));
    const audioKey = path.posix.join(path.dirname(project.video.url.replace(/^\/api\/files\//, "")), "audio.wav");
    const audioAbsPath = await storage.getPath(audioKey);

    const inputBytes = await fsp.stat(inputPath).then((st) => st.size).catch(() => undefined);
    inputInfo = { ext: path.extname(inputPath).toLowerCase(), bytes: inputBytes };
    languageForLog = project.language;
    logDiagnostic({ event: "transcription-start", projectId, language: project.language, input: inputInfo });
    stage = "extract-audio";
    await extractAudio(inputPath, audioAbsPath);
    const audioUrl = storage.publicUrl(audioKey);
    await prisma.videoAsset.update({ where: { projectId }, data: { audioUrl } });

    await prisma.project.update({ where: { id: projectId }, data: { status: "TRANSCRIBING" } });
    track("transcription_started", { projectId });

    // "auto" (the pre-transcription settings modal's default) means "let Whisper detect the
    // language itself" — undefined. Any real code (including "en") is now passed straight
    // through, so an explicitly-chosen language always reaches Whisper directly instead of
    // being silently treated as auto-detect. Resolved once and reused for both the provider
    // (which may pick a per-language local model — see local-provider.ts resolveLocalModel)
    // and the actual transcribe() call, so the two can never disagree about what was asked.
    const language = project.language === "auto" ? undefined : project.language;
    stage = "worker-start";
    const provider = getTranscriptionProvider({
      language,
      onProgress: persistProgress,
      onRequestId: (id) => {
        requestId = id;
        activeTranscriptions.set(projectId, id);
      },
    });
    stage = "transcribe";
    const result = await provider.transcribe(audioAbsPath, { language });
    stage = "parse-output";

    if (!result || !Array.isArray(result.words) || !Array.isArray(result.segments)) throw new Error("The transcription engine returned an unreadable result.");
    const rules = resolveTimingRules(fromJson<Partial<TimingRules>>(project.timingRules, {}));
    const subtitles = segmentWords(result.words, rules, result.segments);

    stage = "persist";
    await prisma.$transaction(async (tx) => {
      await tx.subtitle.deleteMany({ where: { projectId } });
      if (subtitles.length) {
        await tx.subtitle.createMany({
          data: subtitles.map((s) => ({
            id: s.id,
            projectId,
            index: s.index,
            start: s.start,
            end: s.end,
            text: s.text,
            words: toJson(s.words) ?? "[]",
          })),
        });
      }
      await tx.project.update({
        where: { id: projectId },
        data: { status: "READY", language: result.language || project.language, errorMessage: null, progress: 100, processingStartedAt: null },
      });
    });
    track("transcription_completed", { projectId, provider: result.provider, subtitleCount: subtitles.length });
    logDiagnostic({ event: "transcription-complete", projectId, language: result.language, provider: result.provider, captions: subtitles.length, words: result.words.length, durationMs: Date.now() - startedAt });
  } catch (err) {
    // Cancellation and a stalled/unresponsive worker are distinct, expected outcomes — not
    // generic failures — so the user sees an accurate message rather than "something went
    // wrong" for either. Both leave the project in ERROR (never a half-committed READY
    // project — the $transaction above is the only path that can set READY, and it never ran)
    // with Retry available via the existing /retry route, exactly as any other ERROR does.
    // The failure is classified into a structured error (code + stage + evidence). The user sees the short message for its
    // code; everything needed to diagnose it — exit code, worker stderr tail, stage, input shape — goes to the diagnostics log.
    // Cancelled / stalled / busy keep their long-standing, specific messages (see userMessageFor).
    const failure = classifyTranscriptionError(err, stage);
    const cancelled = err instanceof TranscriptionCancelledError;
    const stalled = err instanceof TranscriptionStalledError;
    // The sidecar only ever transcribes one request at a time (python/whisper_worker.py deliberately rejects a second
    // overlapping "transcribe" rather than silently interleaving two decodes) and reports a clear reason for it.
    const busy = err instanceof Error && isSidecarBusyMessage(err.message);
    console.error(`[pipeline] project ${projectId} ${cancelled ? "cancelled" : stalled ? "stalled" : busy ? "rejected (sidecar busy)" : "failed"} [${failure.code}/${failure.stage ?? stage}]:`, err);
    logDiagnostic({
      event: "transcription-failed",
      projectId,
      code: failure.code,
      stage: failure.stage ?? stage,
      message: sanitize(failure.message),
      exitCode: failure.details.exitCode,
      signal: failure.details.signal,
      systemCode: failure.details.systemCode,
      stderrTail: sanitizeTail(failure.details.stderrTail),
      language: languageForLog,
      input: inputInfo,
      durationMs: Date.now() - startedAt,
    });
    track(cancelled ? "transcription_cancelled" : stalled ? "transcription_stalled" : "transcription_failed", { projectId, code: failure.code });
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: "ERROR",
        errorMessage: userMessageFor(failure.code),
        progress: 0,
        processingStartedAt: null,
      },
    });
  } finally {
    if (requestId) activeTranscriptions.delete(projectId);
  }
}
