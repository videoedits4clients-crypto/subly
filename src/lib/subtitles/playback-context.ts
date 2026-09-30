/**
 * Task 100742 (P13) — the ONE definition of "active caption" / "active word" during playback,
 * factored out of two places that already computed this inline and independently:
 *   - components/editor/video-canvas.tsx's `activeSubtitleRaw` (`currentTime >= s.start &&
 *     currentTime < s.end`), used to pick which caption the preview overlay renders.
 *   - components/editor/subtitle-overlay.tsx's karaoke `activeIndex`
 *     (`currentTime >= w.start && currentTime < w.end`), used for the word-highlight style.
 * Both were already correct and already exactly match this task's own required definitions —
 * this module does not change their behavior, it gives the SAME definitions a single, reusable,
 * directly-testable home so the new timeline/captions-panel playback indicators (this task) use
 * the exact same rule instead of a third, independently-drifting copy. See "do not create new
 * overlap behavior" in this task's own spec: if malformed/legacy data has two overlapping
 * captions, `Array.prototype.find` returns the FIRST one in array order — the subtitles array is
 * always kept sorted by `start` (see editor-store.ts's own `.sort()` after any timing mutation),
 * so this is the same "earliest-starting caption wins" rule the app already had, not a new one.
 */
import type { Subtitle, Word } from "../../types/subtitle.ts";

/** `[start, end)` — end is exclusive, matching every other timing check in this codebase
 * (quality-analyzer.ts's OVERLAP check, clampWordTiming, etc.). */
export function isTimeWithinCaption(caption: Pick<Subtitle, "start" | "end">, time: number): boolean {
  return time >= caption.start && time < caption.end;
}

/** The caption the playhead is currently "inside," or `undefined` if it's in a gap between
 * captions (or before the first / after the last). See this module's own doc comment for the
 * overlap tie-break rule (first in array order). */
export function findActiveCaption<T extends Pick<Subtitle, "start" | "end">>(subtitles: T[], time: number): T | undefined {
  return subtitles.find((s) => isTimeWithinCaption(s, time));
}

/** The index into `words` whose own `[start, end)` contains `time`, or `null` if none does (a
 * gap between words, or `time` is outside every word — e.g. the playhead is in this caption's
 * own leading/trailing silence). `null`, not `-1`, to match this codebase's existing
 * "no selection" convention for word indices (`selectedWordIndex: number | null` in
 * editor-store.ts) — callers that need the two to compare directly (is the active word the same
 * as the selected word?) can do so without an off-by-one-convention translation. */
export function findActiveWordIndex(words: Pick<Word, "start" | "end">[], time: number): number | null {
  const index = words.findIndex((w) => time >= w.start && time < w.end);
  return index === -1 ? null : index;
}
