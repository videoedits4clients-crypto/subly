/**
 * Task 111026 (P18.4) — pure helpers for formatting whatever a React error boundary's
 * `componentDidCatch`/`getDerivedStateFromError` receives. React itself only guarantees the
 * caught value is "the thrown thing" — not necessarily an `Error` instance (a component can
 * `throw "a string"` or `throw someObject`) — so every helper here treats its input as
 * `unknown` and never assumes a shape.
 */

const MAX_MESSAGE_LENGTH = 500;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A short, display-safe summary of an unknown thrown value: never a full stack trace, never
 * unbounded length (a caption's own text — or anything else project-specific — could in theory
 * end up interpolated into a thrown message; this bounds how much of it could ever reach the
 * screen, though it cannot detect and strip project content specifically). */
export interface FormattedReactError {
  /** One line, safe to show directly in the recovery UI. */
  message: string;
  /** Optional extra diagnostic (the error's `name`, or the first line of its stack) — still
   * short, still safe for local/dev display, never the full multi-line stack. */
  detail?: string;
}

export function formatReactError(error: unknown): FormattedReactError {
  if (error instanceof Error) {
    const message = truncate(error.message || error.name || "An unknown error occurred.", MAX_MESSAGE_LENGTH);
    const firstStackLine = typeof error.stack === "string" ? error.stack.split("\n")[1]?.trim() : undefined;
    const detail = firstStackLine ? truncate(firstStackLine, MAX_MESSAGE_LENGTH) : undefined;
    return { message, detail };
  }
  if (typeof error === "string") {
    return { message: truncate(error || "An unknown error occurred.", MAX_MESSAGE_LENGTH) };
  }
  if (error === null || error === undefined) {
    return { message: "An unknown error occurred." };
  }
  // A thrown object/number/etc — best-effort, bounded stringification. Never risk throwing
  // again while formatting a thrown value (a circular object would make JSON.stringify throw).
  try {
    const asString = JSON.stringify(error);
    return { message: truncate(asString ?? String(error), MAX_MESSAGE_LENGTH) };
  } catch {
    return { message: "An unknown error occurred." };
  }
}

/** True when retrying (remounting the failed subtree in place) is a reasonable first move; false
 * when the error is a known class that a plain remount can't fix, and a full reload is the more
 * honest next step. Conservative and narrow on purpose — defaults to recoverable (true) for
 * anything it doesn't specifically recognize, since a needless "Try Again" attempt is cheap and
 * harmless (it's just a remount, see mergeWordStyleOverride-style "never worse than a no-op"
 * precedent elsewhere in this codebase), while wrongly labeling a genuinely-retryable error as
 * unrecoverable would hide a working recovery path. */
export function isRecoverableRenderError(error: unknown): boolean {
  if (error instanceof Error) {
    // Next.js's own name for "a lazily-loaded JS chunk failed to fetch" — typically because the
    // app was redeployed and the browser's old chunk manifest no longer matches. Remounting the
    // same subtree will try to load the exact same (now-missing) chunk again and fail the same
    // way; only a full reload (which re-fetches the current manifest) can actually recover.
    if (error.name === "ChunkLoadError") return false;
    if (/Loading chunk [\w-]+ failed/i.test(error.message)) return false;
    // Runaway recursion — the call stack that just overflowed is gone, but whatever local state
    // caused the recursion is still there; a bare remount tends to just recurse again.
    if (error instanceof RangeError && /call stack/i.test(error.message)) return false;
  }
  return true;
}
