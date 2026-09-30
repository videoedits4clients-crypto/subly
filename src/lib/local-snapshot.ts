/**
 * Crash-safety net: a copy of the editor's unsaved changes (subtitles, style,
 * animation, timing rules, trim/cuts) mirrored into localStorage alongside
 * every autosave attempt. If the browser crashes or a save keeps failing,
 * reloading the project can offer to restore from this local copy instead of
 * silently losing the edit.
 *
 * Deliberately NEVER holds the video file itself — only the same small JSON
 * payload the PATCH /api/projects/:id route accepts.
 */
const KEY_PREFIX = "subly:snapshot:";

export interface LocalSnapshot<T> {
  savedAt: string;
  payload: T;
}

export function saveLocalSnapshot<T>(projectId: string, payload: T): void {
  try {
    const snapshot: LocalSnapshot<T> = { savedAt: new Date().toISOString(), payload };
    localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(snapshot));
  } catch {
    // Best-effort — private browsing / storage-full shouldn't break editing.
  }
}

export function readLocalSnapshot<T>(projectId: string): LocalSnapshot<T> | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw) as LocalSnapshot<T>;
  } catch {
    return null;
  }
}

export function clearLocalSnapshot(projectId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + projectId);
  } catch {
    // ignore
  }
}
