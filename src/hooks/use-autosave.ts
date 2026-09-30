import { useEffect } from "react";
import { useEditorStore } from "../store/editor-store.ts";
import { api } from "../lib/api-client.ts";
import { saveLocalSnapshot, clearLocalSnapshot } from "../lib/local-snapshot.ts";
import { createSingleFlightQueue } from "../lib/save-queue.ts";
import type { ProjectData } from "../types/subtitle.ts";

const BASE_RETRY_MS = 3000;
const MAX_RETRY_MS = 30000;

export type SavePayload = Pick<
  ProjectData,
  | "subtitles"
  | "globalStyle"
  | "animation"
  | "timingRules"
  | "composition"
  | "name"
  | "trimStart"
  | "trimEnd"
  | "cutRanges"
  | "captionOutputMode"
>;

/** Single source of truth for "what autosave persists" — used by both the debounced save and the beforeunload flush (and the crash-recovery snapshot in lib/local-snapshot.ts), so they can never silently drift apart. */
function buildSavePayload(project: ProjectData): SavePayload {
  return {
    subtitles: project.subtitles,
    globalStyle: project.globalStyle,
    animation: project.animation,
    timingRules: project.timingRules,
    composition: project.composition,
    name: project.name,
    trimStart: project.trimStart,
    trimEnd: project.trimEnd,
    cutRanges: project.cutRanges,
    captionOutputMode: project.captionOutputMode,
  };
}

/**
 * Debounced autosave: watches the editor store's `dirty` flag and PATCHes the
 * project ~900ms after the last edit. On failure it keeps retrying with
 * exponential backoff (capped at 30s) for as long as changes remain unsaved —
 * a save failure must never just sit there silently losing edits, and it
 * must not require the user to make another edit to notice / retry.
 *
 * The actual wiring lives in `wireAutosave`/`wireBeforeUnloadFlush` below — plain functions with
 * no React dependency, pulled out of these `useEffect` bodies so a test can exercise the REAL
 * subscribe/debounce/save-queue logic directly against the real editor store (mocking only
 * `fetch`), instead of re-implementing it or only testing the Zustand store in isolation. See
 * src/store/__tests__/editor-store-undo-redo-persistence.test.ts (Task 143208, P19.15) — written
 * after P19.14 reported that an isolated undo()/redo() (no subsequent edit) doesn't autosave.
 * That specific claim did NOT reproduce here: wireAutosave's own subscribe callback treats
 * commit()/undo()/redo() identically (all three produce a fresh `project` object and set
 * `dirty: true`, which is all this subscription's gate condition — `state.dirty &&
 * state.project !== prevState.project` — checks), confirmed by the regression tests below, which
 * exercise undo()/redo() in isolation against this exact function and pass without any change to
 * the logic itself. The real root cause (see captions-panel.tsx's Textarea `onKeyDown`) was that
 * Ctrl+Z/Ctrl+Shift+Z pressed while focus was still inside (or had returned to) the caption
 * textarea just edited triggered the BROWSER'S OWN NATIVE per-field text undo instead of ever
 * reaching this store's `undo()` — a real, reproducible, user-visible symptom, but not a defect
 * in this file. This file is otherwise UNCHANGED from before P19.15; it is refactored for
 * testability only.
 */
export function wireAutosave(projectId: string): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = BASE_RETRY_MS;

  // Every call to `runSave()` reads whatever is CURRENT in the store at the moment it
  // actually executes (never a snapshot captured when it was scheduled) — but that alone
  // isn't enough: two independent in-flight PATCH requests can still complete out of order,
  // letting an older one silently overwrite a newer one in the database (see save-queue.ts's
  // own doc comment). Routing every save through this single-flight queue guarantees at most
  // one PATCH is ever in flight, so there is nothing left to race — a save requested while
  // one is already running just runs again immediately after, with fresh state.
  const runSave = createSingleFlightQueue(async () => {
    const project = useEditorStore.getState().project;
    if (!project) return;
    useEditorStore.getState().setSaveState("saving");
    try {
      await api.patchProject(projectId, buildSavePayload(project));
      useEditorStore.setState({ dirty: false });
      useEditorStore.getState().setSaveState("saved");
      retryDelay = BASE_RETRY_MS;
      clearLocalSnapshot(projectId); // server has it now — the local crash-safety copy is redundant
    } catch {
      useEditorStore.getState().setSaveState("error");
      // Keep retrying on a backoff as long as the edit is still unsaved —
      // covers "I made an edit, my wifi dropped, and then did nothing else".
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (useEditorStore.getState().dirty) runSave();
      }, retryDelay);
      retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2);
    }
  });

  const unsubscribe = useEditorStore.subscribe((state, prevState) => {
    if (!state.dirty || state.project === prevState.project) return;
    // Reflect "there are changes not yet persisted" the instant they
    // happen, not just once the debounce timer gets around to saving —
    // otherwise a stale "Saved" checkmark sits there lying for ~900ms+
    // after every single edit.
    if (state.saveState !== "saving") useEditorStore.getState().setSaveState("unsaved");

    // Crash-safety copy, written synchronously (no debounce) so a browser
    // crash or tab close a moment after an edit still has something to
    // recover from, independent of whether the network save ever lands.
    if (state.project) saveLocalSnapshot(projectId, buildSavePayload(state.project));

    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
    retryDelay = BASE_RETRY_MS;
    debounceTimer = setTimeout(runSave, 900);
  });

  return () => {
    unsubscribe();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
  };
}

/** Flush on unload so a quick navigation doesn't drop the last edit. Separated out alongside
 * `wireAutosave` for the same testability reason (see that function's doc comment). */
export function wireBeforeUnloadFlush(projectId: string): () => void {
  function flush() {
    const state = useEditorStore.getState();
    if (!state.dirty || !state.project) return;
    const payload = JSON.stringify(buildSavePayload(state.project));
    // `keepalive` lets this PATCH survive the page unload, unlike sendBeacon
    // (which is POST-only and wouldn't hit this route).
    fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
  window.addEventListener("beforeunload", flush);
  return () => {
    window.removeEventListener("beforeunload", flush);
    flush();
  };
}

export function useAutosave(projectId: string) {
  useEffect(() => wireAutosave(projectId), [projectId]);
  useEffect(() => wireBeforeUnloadFlush(projectId), [projectId]);
}
