// Only ever imported from instrumentation.ts's nodejs-runtime branch — see
// that file for why this is a separate module rather than inline.
import { stopSidecar } from "@/lib/transcription/local-whisper-sidecar";
import { recoverStaleJobs } from "@/lib/recovery/stale-job-recovery";

const shutdown = () => {
  try {
    stopSidecar();
  } catch {
    // best-effort — the process is exiting either way
  }
};
process.on("exit", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

/** Called (and awaited) by instrumentation.ts's register() — which Next.js guarantees resolves
 * before the server accepts its first request (see stale-job-recovery.ts's own doc comment for
 * why that ordering is what makes this safe: nothing can have started a new job yet, so every
 * non-terminal row this finds is provably left over from a previous process, not a live one).
 * Best-effort: a failure here must never stop the server from starting — a user stuck with one
 * stale project is far better than a user who can't open the app at all. */
export async function initNodeRuntime(): Promise<void> {
  await recoverStaleJobs().catch((err) => {
    console.error("[recovery] stale-job recovery failed:", err);
  });
}
