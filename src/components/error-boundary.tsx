"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatReactError, isRecoverableRenderError } from "@/lib/errors/react-error";

/**
 * Task 111026 (P18.4) — the app's only React error boundary. A render-time exception in any
 * descendant is caught here instead of unmounting the whole React tree to a blank white page
 * (confirmed absent anywhere in this codebase before this task — no `componentDidCatch`,
 * `getDerivedStateFromError`, or Next.js `error.tsx` existed).
 *
 * Deliberately just TWO instances of this one component exist in the app (see providers.tsx for
 * the app-wide one, editor-shell.tsx for the editor-scoped one) — not one per panel/dialog/row.
 * Placement matters for two reasons this component itself does NOT need to know about:
 *
 * 1. Persistence safety (Task 111026 §G): editor-shell.tsx's `useAutosave`/`useKeyboardShortcuts`
 *    are hook calls in EditorShell's OWN body, not JSX inside this boundary's `children` — a
 *    render error in anything this boundary wraps unmounts only ITS subtree, never EditorShell
 *    itself, so those hooks (and the Zustand store subscription autosave runs on) keep working
 *    completely undisturbed while the fallback is shown. This component never touches the store,
 *    Prisma, autosave, or undo/redo — a render error stays a UI failure, not a data one.
 * 2. P18.2 compatibility (Task 111026 §H): sitting ABOVE CaptionRow/TimelineCaptionBlock (once,
 *    around the whole editor shell) rather than wrapping each one means this adds one class
 *    component to the tree total, not one per row — P18.2's memoization/virtualization
 *    architecture is completely unaffected.
 *
 * This does NOT catch (React error boundaries never do): event-handler exceptions, async/Promise
 * rejections, or errors in server/API code — those already have their own handling (toasts,
 * setSaveState("error"), ProcessingScreen's own ERROR status UI, export/transcription error UI)
 * and this boundary must never intercept or reinterpret them.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** "editor" adds a "Return to dashboard" action and editor-specific copy — safe to offer only
   * because this instance is known to be mounted inside the editor route. "app" is the app-wide,
   * last-resort instance (dashboard, auth, upload, and anything else not already inside the
   * editor's own boundary) — no "return to dashboard" (may already be there, or nowhere
   * authenticated to return to). */
  scope: "app" | "editor";
  /** Supplied by the exported `ErrorBoundary` function-component wrapper below, via
   * `useRouter().push()` — "normal navigation" (Task 111026 §D), not a raw `location.href`
   * assignment (which Next's own lint rule flags for internal routes). Kept as a prop rather than
   * called directly from this class component because `useRouter` is a hook. */
  onReturnToDashboard: () => void;
}

interface ErrorBoundaryState {
  error: unknown;
  /** Bumped by "Try again" so the Fragment below gets a new `key` — the standard React pattern
   * for forcing a full remount of `children` (fresh component instances, not just a re-render of
   * the same ones) without adding a wrapper DOM node that could disturb surrounding flex/grid
   * layout (a Fragment's `key` remounts its contents with zero DOM footprint of its own). */
  resetKey: number;
}

class ErrorBoundaryImpl extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Matches this codebase's existing `console.error("[tag] ...", err)` convention (see e.g.
    // lib/pipeline.ts, lib/fonts/server-font-cache.ts) rather than a new logging abstraction —
    // analytics.ts's track() is a product-analytics event log (project_created, export_completed,
    // ...), not a diagnostic error log, and repurposing it here would be scope creep beyond a UI
    // resilience task. No telemetry, no external service — console only.
    console.error("[error-boundary]", error, info.componentStack);
  }

  private handleTryAgain = () => {
    // Deliberately NOT a call to any editor-store action — this only ever touches this
    // component's own local state. The project, undo/redo history, and autosave's `dirty` flag
    // are completely untouched by a "Try again" click.
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  private handleReload = () => {
    // A genuine full reload via the browser's own navigation — re-runs the editor route's normal
    // fetch-and-load flow from scratch (see app/editor/[id]/page.tsx), same as the user hitting
    // F5. Never manually reconstructs or rewrites project data.
    window.location.reload();
  };

  render() {
    if (this.state.error !== null) {
      const { message, detail } = formatReactError(this.state.error);
      const recoverable = isRecoverableRenderError(this.state.error);
      const isEditor = this.props.scope === "editor";
      return (
        // role="dialog" (no data-state="closed") is exactly what dialog-open-guard.ts's
        // isAnyDialogOpen() already looks for — reusing that existing contract, not inventing a
        // new one, is what keeps Ctrl+Z/Ctrl+A/split/delete/etc. from silently firing against a
        // crashed (or about-to-remount) editor tree behind this screen. Zero changes needed to
        // use-keyboard-shortcuts.ts itself.
        <div
          role="dialog"
          aria-modal="true"
          data-state="open"
          aria-label="Application error"
          className="flex min-h-screen flex-col items-center justify-center gap-4 bg-grid px-6 text-center"
        >
          <div className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="max-w-sm text-sm text-muted">
            {isEditor
              ? "The editor ran into a problem and couldn't continue rendering. Your project hasn't been changed — try again, or come back to it from the dashboard."
              : "SUBLY ran into a problem and couldn't continue rendering this page."}
          </p>
          <p className="max-w-sm truncate text-xs text-muted-2" title={message}>
            {message}
          </p>
          {detail && (
            <p className="max-w-sm truncate font-mono text-[11px] text-muted-2/70" title={detail}>
              {detail}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {/* Hidden only for the narrow class of errors a bare remount is known not to fix
                (stale-deploy chunk-load failures, stack overflow — see isRecoverableRenderError) —
                "Reload" below always remains available as the one guaranteed-to-work action. */}
            {recoverable && (
              <Button variant="outline" onClick={this.handleTryAgain}>
                Try again
              </Button>
            )}
            <Button variant="accent" onClick={this.handleReload}>
              {isEditor ? "Reload editor" : "Reload"}
            </Button>
            {isEditor && (
              <Button variant="outline" onClick={this.props.onReturnToDashboard}>
                Return to dashboard
              </Button>
            )}
          </div>
        </div>
      );
    }
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

/** Thin function-component wrapper — the only reason this isn't just the class above: `useRouter`
 * is a hook, and `onReturnToDashboard` needs it. Every other prop/behavior is the class's own. */
export function ErrorBoundary({ children, scope }: { children: ReactNode; scope: "app" | "editor" }) {
  const router = useRouter();
  return (
    <ErrorBoundaryImpl scope={scope} onReturnToDashboard={() => router.push("/dashboard")}>
      {children}
    </ErrorBoundaryImpl>
  );
}
