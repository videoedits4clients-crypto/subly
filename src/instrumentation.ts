/**
 * Next.js server-lifecycle hook (runs once when the server process starts, and is fully
 * awaited before the server accepts its first request). Two jobs, both in instrumentation-node:
 *  1. Make sure the local Whisper sidecar (and, on Windows, its PyInstaller-onefile inner
 *     process — see stopSidecar's own comment) is killed when this server process exits, rather
 *     than leaking an orphaned whisper-worker.exe. Defense-in-depth alongside electron/main.js's
 *     own tree-kill of the server process — either one alone should be enough, but a graceful
 *     SIGTERM here reaches paths a hard process-tree kill might race.
 *  2. Recover any project/export job left stuck in a non-terminal status by a previous process
 *     that died mid-job (see lib/recovery/stale-job-recovery.ts) — run here, and only here,
 *     specifically because this hook's "awaited before the first request" guarantee is what
 *     makes it safe: no job can possibly be genuinely active yet at this point.
 *
 * Both live in a SEPARATE module (./instrumentation-node),
 * imported dynamically, only once we already know we're in the nodejs runtime.
 * This file also gets compiled for the Edge runtime (Next.js instruments both),
 * and Turbopack statically rejects `process.on` in anything that MIGHT end up in
 * an edge bundle — the dynamic-import boundary keeps that code out of this
 * file's own bundle regardless of which runtime is asking. Confirmed by
 * actually running `next dev`: without this split, every request 500'd with a
 * "Jest worker encountered ... exceptions" crash, not just a lint warning.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initNodeRuntime } = await import("./instrumentation-node");
  await initNodeRuntime();
}
