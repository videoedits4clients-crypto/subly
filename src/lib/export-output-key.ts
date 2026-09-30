import path from "path";

/** The one, single source of truth for where a given export job's output file lives — used by
 * both the export pipeline (lib/export-pipeline.ts) and stale-job recovery
 * (lib/recovery/stale-job-recovery.ts) so the two never drift on this convention. Kept in its
 * own dependency-free module (no `@/` aliases) so it can be imported by plain `node --test`
 * files without dragging in export-pipeline.ts's whole Next-bundled import graph. */
export function exportOutputKey(projectId: string, jobId: string): string {
  return path.posix.join(projectId, "exports", `${jobId}.mp4`);
}

/** Where a given export job's temporary .ass caption sidecar lives during rendering — normally
 * removed by withTempFile's own cleanup (see lib/ffmpeg/index.ts) the instant the render
 * finishes, cancels, or fails, but a process that dies mid-render never gets to run that
 * cleanup, leaving this file behind. Used by stale-job recovery to remove it too. */
export function exportAssKey(projectId: string, jobId: string): string {
  return path.posix.join(projectId, "exports", `${jobId}.ass`);
}
