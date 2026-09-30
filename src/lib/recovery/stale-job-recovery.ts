import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db.ts";
import { getStorage } from "../storage/index.ts";
import { exportOutputKey, exportAssKey } from "../export-output-key.ts";

/**
 * Recovers persisted, non-terminal job state left behind by a process that died mid-job
 * (Electron force-quit, Next server killed, Windows restart, OS crash) — see
 * research/p1_project_recovery_crash_resilience_report.md for the full design writeup.
 *
 * WHY THIS CAN NEVER MISCLASSIFY A GENUINELY LIVE JOB AS STALE: this function is called
 * exactly once, synchronously, from instrumentation-node.ts's module-level top-level await —
 * which Next.js's instrumentation `register()` hook guarantees completes before the server
 * accepts its first HTTP request (see instrumentation.ts). Every job-starting code path in this
 * app (upload → processVideo, retry → processVideo, export route → runExportJob) is only
 * reachable via an HTTP request. Since no request can be served until this function has already
 * finished, it is structurally impossible for a "genuinely active" job to exist in the database
 * at the moment this runs — every row this query matches was left non-terminal by a PREVIOUS
 * process that no longer exists. This holds because the app is single-process/in-process-only
 * by design (see pipeline.ts's and export-pipeline.ts's own "runs in-process, fire-and-forget"
 * doc comments — there is no queue/worker-pool architecture where a second live process could
 * be the true owner of a row this one didn't start).
 *
 * No new schema/columns were needed: `Project.status`/`ExportJob.status` themselves are the
 * ownership signal — a non-terminal status querried at this exact boundary IS the definition of
 * "stale". This is idempotent by construction: a second run finds nothing left to match (every
 * previously-stale row is now ERROR), so repeated startups, startups with no stale work, and
 * startups after a clean shutdown are all safe no-ops.
 */

const TRANSCRIPTION_RECOVERY_MESSAGE = "Previous processing was interrupted. You can retry this project.";
const EXPORT_RECOVERY_MESSAGE = "Previous export was interrupted. The incomplete output was removed.";

/** The minimal slice of PrismaClient this module actually touches — lets tests supply a real,
 * temporary SQLite-backed PrismaClient (see the test file) instead of the app's shared
 * singleton, without needing a hand-rolled mock of Prisma's query builder. */
export type RecoveryDb = Pick<PrismaClient, "project" | "exportJob">;

/** The minimal slice of StorageDriver this module needs — just enough to remove a stale
 * export's partial output file. Defaults to the real storage driver; tests inject a small
 * recording fake so the unit suite never touches the real filesystem. */
export interface RecoveryStorage {
  del(key: string): Promise<void>;
}

export interface StaleJobRecoveryResult {
  /** Projects moved out of a stale non-terminal status (LOADING/TRANSCRIBING → ERROR, or
   * EXPORTING → READY). */
  recoveredProjects: number;
  /** ExportJob rows moved from QUEUED/RUNNING → ERROR. */
  recoveredExportJobs: number;
}

export async function recoverStaleJobs(db: RecoveryDb = defaultPrisma, storage: RecoveryStorage = getStorage()): Promise<StaleJobRecoveryResult> {
  // 1. Stale export jobs — found first (before flipping status) so the partial output file can
  // still be located via the same {projectId, jobId} convention runExportJob itself uses.
  const staleExportJobs = await db.exportJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, projectId: true },
  });

  for (const job of staleExportJobs) {
    // Best-effort: a QUEUED job never got as far as writing anything, so there's nothing to
    // remove — del() on a non-existent key is a no-op, not an error, per StorageDriver's
    // contract. A failure here must never block marking the job ERROR below. Removes both the
    // partial .mp4 output AND the .ass caption sidecar — a process that dies mid-render never
    // gets to run withTempFile's own cleanup (see lib/ffmpeg/index.ts), so both can be left
    // behind by a genuine crash.
    await storage.del(exportOutputKey(job.projectId, job.id)).catch(() => {});
    await storage.del(exportAssKey(job.projectId, job.id)).catch(() => {});
  }

  const exportResult = staleExportJobs.length
    ? await db.exportJob.updateMany({
        where: { id: { in: staleExportJobs.map((j) => j.id) } },
        data: { status: "ERROR", errorMessage: EXPORT_RECOVERY_MESSAGE, outputUrl: null },
      })
    : { count: 0 };

  // 2. Stale transcription-in-progress projects — no partial Subtitle rows can exist from the
  // interrupted attempt (pipeline.ts only ever writes them inside the single $transaction that
  // also flips status to READY, so a crash before that commits leaves nothing partial to hide).
  const transcriptionResult = await db.project.updateMany({
    where: { status: { in: ["LOADING", "TRANSCRIBING"] } },
    data: { status: "ERROR", errorMessage: TRANSCRIPTION_RECOVERY_MESSAGE, progress: 0, processingStartedAt: null },
  });

  // 3. Stale EXPORTING projects — the export route sets this right before creating the
  // ExportJob; runExportJob's own success/failure paths are the only other code that ever
  // clears it (to EXPORTED or READY respectively). Observing it still set at startup means the
  // attempt never reached either — reset to READY, exactly like every other export failure
  // already does (see export-pipeline.ts's catch block), so retry works identically.
  const exportingResult = await db.project.updateMany({
    where: { status: "EXPORTING" },
    data: { status: "READY" },
  });

  return {
    recoveredProjects: transcriptionResult.count + exportingResult.count,
    recoveredExportJobs: exportResult.count,
  };
}
