/**
 * A single-flight, coalescing async runner: at most one call to `task` is ever in flight at a
 * time. Calling the returned `run()` while a call is already in flight doesn't start a second,
 * overlapping one — it just flags that `task` should run exactly once more, immediately after
 * the current call settles (success or failure), reading whatever is current AT THAT POINT.
 *
 * WHY THIS EXISTS: two independent in-flight network requests can complete in either order —
 * nothing about `fetch`/HTTP guarantees a request started earlier finishes first. Without this,
 * a debounced autosave that fires a fresh save() on every edit (see hooks/use-autosave.ts) can
 * end up with two PATCH requests in flight at once; if the OLDER one (built from stale state)
 * happens to reach the server and get applied AFTER the NEWER one, the newer edit is silently
 * overwritten in the database even though the UI already reported "Saved". Serializing every
 * call through this queue makes that ordering bug structurally impossible: there is never more
 * than one request in flight, so there is nothing left to race.
 *
 * Deliberately generic/tiny (no debounce, no retry, no knowledge of what `task` does) so it can
 * be unit-tested in complete isolation from React/Zustand/fetch — see
 * lib/__tests__/save-queue.test.ts.
 */
export function createSingleFlightQueue(task: () => Promise<void>): () => void {
  let running = false;
  let queued = false;

  async function runLoop(): Promise<void> {
    running = true;
    try {
      await task();
    } catch {
      // A rejecting task must never wedge the queue or produce an unhandled rejection here —
      // callers that care about failures handle them inside `task` itself (see
      // hooks/use-autosave.ts's own try/catch around the PATCH call).
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void runLoop();
      }
    }
  }

  return function run(): void {
    if (running) {
      queued = true;
      return;
    }
    void runLoop();
  };
}
