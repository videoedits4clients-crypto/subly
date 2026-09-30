/**
 * Task 120417 (P19.1) — the resizable editor layout's constants and pure geometry/persistence
 * helpers. No React, no store — consumed by editor-shell.tsx (the actual resize UI) and directly
 * unit-tested.
 *
 * UI-ONLY PREFERENCE, NEVER PROJECT CONTENT — this module never touches editor-store.ts (no
 * import, no reference) and is never routed through commit()/autosave/undo-redo. It is
 * per-browser, exactly like style-panel.tsx's own collapsed-section state
 * (`subly:style-panel-sections`) or style-clipboard.ts's copy/paste clipboard — same
 * `localStorage`, try/catch, "a lost preference isn't worth failing over" convention, not a new
 * one invented for this task.
 *
 * DEFAULTS (Phase 0 audit — derived from the pre-P19.1 hard-coded layout, not an arbitrary
 * redesign): editor-shell.tsx's captions-panel wrapper and left-panel.tsx's own root both used
 * `lg:w-80` (320px); the timeline row used `lg:h-64` (256px). Those become the DEFAULT_* constants
 * below unchanged.
 */

/** Matches the pre-existing `lg:w-80` (320px) both editor-shell.tsx's wrapper and
 * left-panel.tsx's own root used before this task. */
export const DEFAULT_CAPTIONS_PANEL_WIDTH = 320;
/** Narrow enough to still show a caption's own text/word-timing controls without excessive
 * wrapping, per Phase 0's inspection of captions-panel.tsx's row layout. */
export const MIN_CAPTIONS_PANEL_WIDTH = 240;
/** Generous enough for long captions/word chips without letting the panel dominate the editor —
 * see clampCaptionsPanelWidth below for how this is ALSO bounded by the live viewport so the
 * preview area can never be squeezed out, even at this constant's own nominal maximum. */
export const MAX_CAPTIONS_PANEL_WIDTH = 560;

/** Matches the pre-existing `lg:h-64` (256px) editor-shell.tsx's timeline row used before this
 * task. */
export const DEFAULT_TIMELINE_HEIGHT = 256;
/** Phase 0 measured timeline.tsx's own fixed rows: the ruler (`h-5`, 20px) + the video/trim track
 * (`h-8`, 32px) + the waveform row (`h-16`, 64px) = 116px, plus room for at least one caption
 * block row (`h-12`, 48px) to still be "usable" per this task's own requirement — rounded up to
 * 180px. */
export const MIN_TIMELINE_HEIGHT = 180;
/** Generous enough to show many caption rows at once without leaving the preview too short — see
 * clampTimelineHeight below for the live-viewport bound. */
export const MAX_TIMELINE_HEIGHT = 480;

/** The preview (video canvas) column/row must never collapse to zero/negative size — these two
 * floors are subtracted from the live viewport when computing each resizable dimension's
 * EFFECTIVE (viewport-aware) maximum, never written to localStorage themselves. */
export const MIN_PREVIEW_WIDTH = 240;
export const MIN_PREVIEW_HEIGHT = 160;
/** The OTHER fixed-width panel (style/animation) — unchanged by this task, not resizable; needed
 * here only to reserve its own space when computing the captions panel's effective max width. */
export const RIGHT_PANEL_WIDTH = 320;
/** top-bar.tsx's own fixed `h-14` (56px) — needed only to reserve its own space when computing
 * the timeline's effective max height. */
export const TOP_BAR_HEIGHT = 56;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  // `Math.max(min, max)` guards the (never actually reachable within this app's own `lg:`
  // breakpoint — see this module's own test suite) case where a tiny viewport would otherwise
  // compute an effective max BELOW min; flooring at `min` here is a last-resort safety net, not
  // the primary defense.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Clamps a requested captions-panel width to `[MIN_CAPTIONS_PANEL_WIDTH,
 * MAX_CAPTIONS_PANEL_WIDTH]`, additionally bounded by the live viewport (when provided) so the
 * preview area — and the OTHER fixed-width panel — can never be squeezed to nothing. Pure,
 * side-effect-free; safe to call on every render. */
export function clampCaptionsPanelWidth(width: number, viewportWidth?: number): number {
  let max = MAX_CAPTIONS_PANEL_WIDTH;
  if (typeof viewportWidth === "number" && Number.isFinite(viewportWidth)) {
    max = Math.min(max, viewportWidth - RIGHT_PANEL_WIDTH - MIN_PREVIEW_WIDTH);
  }
  return clamp(width, MIN_CAPTIONS_PANEL_WIDTH, max);
}

/** Clamps a requested timeline height to `[MIN_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT]`,
 * additionally bounded by the live viewport (when provided) so the preview area above it can
 * never be squeezed to nothing. Pure, side-effect-free; safe to call on every render. */
export function clampTimelineHeight(height: number, viewportHeight?: number): number {
  let max = MAX_TIMELINE_HEIGHT;
  if (typeof viewportHeight === "number" && Number.isFinite(viewportHeight)) {
    max = Math.min(max, viewportHeight - TOP_BAR_HEIGHT - MIN_PREVIEW_HEIGHT);
  }
  return clamp(height, MIN_TIMELINE_HEIGHT, max);
}

export interface EditorLayoutPreferences {
  captionsPanelWidth: number;
  timelineHeight: number;
}

export function defaultEditorLayoutPreferences(): EditorLayoutPreferences {
  return { captionsPanelWidth: DEFAULT_CAPTIONS_PANEL_WIDTH, timelineHeight: DEFAULT_TIMELINE_HEIGHT };
}

/** Exported so tests can read/write the exact same key without duplicating the literal string. */
export const EDITOR_LAYOUT_STORAGE_KEY = "subly:editor-layout";
const STORAGE_KEY = EDITOR_LAYOUT_STORAGE_KEY;

/** Reads the persisted layout preference, validating and clamping every field independently — a
 * missing key, malformed JSON, a non-object, a non-numeric field, or an out-of-range value (e.g.
 * from an older version of this app with different MIN/MAX constants, or hand-edited storage) all
 * fall back to that ONE field's own default rather than discarding the whole preference. Never
 * throws — a corrupt/missing preference must never prevent the editor from loading (this task's
 * own explicit requirement), matching this codebase's established localStorage try/catch
 * convention (style-clipboard.ts, style-panel.tsx). */
export function loadEditorLayoutPreferences(): EditorLayoutPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultEditorLayoutPreferences();
    const parsed = JSON.parse(raw) as Partial<Record<keyof EditorLayoutPreferences, unknown>> | null;
    const rawWidth = parsed && typeof parsed === "object" ? parsed.captionsPanelWidth : undefined;
    const rawHeight = parsed && typeof parsed === "object" ? parsed.timelineHeight : undefined;
    const width = typeof rawWidth === "number" && Number.isFinite(rawWidth) ? rawWidth : DEFAULT_CAPTIONS_PANEL_WIDTH;
    const height = typeof rawHeight === "number" && Number.isFinite(rawHeight) ? rawHeight : DEFAULT_TIMELINE_HEIGHT;
    return { captionsPanelWidth: clampCaptionsPanelWidth(width), timelineHeight: clampTimelineHeight(height) };
  } catch {
    return defaultEditorLayoutPreferences();
  }
}

/** Best-effort write — see loadEditorLayoutPreferences's own doc comment for why this can never
 * throw out to the caller. Callers are expected to debounce/only call this once a resize gesture
 * settles (see editor-shell.tsx), not on every pointermove tick. */
export function saveEditorLayoutPreferences(prefs: EditorLayoutPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage can throw in some private-browsing contexts — a lost layout preference isn't
    // worth failing over.
  }
}
