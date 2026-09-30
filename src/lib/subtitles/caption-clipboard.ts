// Task 101583 (P14) — the internal, structured caption-text clipboard. Pure, DOM-free module:
// no React, no store, no navigator.clipboard — so it's unit-testable under Node's own test
// runner exactly like every other lib/subtitles module. The store (editor-store.ts) holds the
// live `captionClipboard` value; hooks/use-keyboard-shortcuts.ts and
// components/editor/paste-captions-dialog.tsx call these functions and apply the result through
// the EXISTING `applyTextMap`/`updateSubtitleText` mutation paths — this module never mutates
// anything itself, never calls commit(), and never touches word timing directly (that stays
// entirely inside remapWordsToText, applied by the store when the resulting map is committed).
import type { AnimationConfig, Subtitle, SubtitleStyle, Word } from "../../types/subtitle.ts";

/** One caption's captured text-editing state — copied by VALUE at copy-time (see
 * buildCaptionClipboard), never a live reference into `project.subtitles`, so a later edit to the
 * source caption can never retroactively change what a subsequent paste applies. `start`/`end`
 * are the ORIGINAL caption's own timing, kept only for possible future extensibility (P14 spec
 * §16 — a future "paste timing" feature); nothing in this module or in P14's own paste behavior
 * ever reads them back onto a destination caption — destination timing always stays untouched.
 * `style`/`animation` are likewise carried for the same future-extensibility reason and are never
 * applied by this phase's plain text paste (P14 spec §8: paste is text-only by default). */
export interface ClipboardCaptionRecord {
  text: string;
  words: Word[];
  style?: Partial<SubtitleStyle>;
  animation?: Partial<AnimationConfig>;
  start: number;
  end: number;
}

/** The internal SUBLY clipboard (Task 101583, P14) — kept in the editor store's own ephemeral
 * `captionClipboard` field (never persisted, no new DB table — see editor-store.ts). `captions` is
 * always in TIMELINE order (the order captions appear in the start-sorted `project.subtitles`
 * array), regardless of the order they were clicked/Ctrl-clicked/Shift-clicked into the
 * selection. */
export interface CaptionClipboard {
  captions: ClipboardCaptionRecord[];
}

/** Builds the internal clipboard from a set of caption ids, in TIMELINE order — a single
 * filter+map pass over `subtitles`, O(n) in the project's total caption count regardless of how
 * many ids are selected (P14 spec §17: copying must stay O(n), never serialize video/waveform/
 * quality-report data). `subtitles` is expected pre-sorted by `start` (the store's own existing
 * invariant — see updateSubtitleTiming's trailing `.sort()`), so filtering it directly already
 * yields timeline order with no separate sort needed. */
export function buildCaptionClipboard(subtitles: Subtitle[], ids: Set<string> | string[]): CaptionClipboard {
  const idSet = ids instanceof Set ? ids : new Set(ids);
  if (idSet.size === 0) return { captions: [] };
  return {
    captions: subtitles
      .filter((s) => idSet.has(s.id))
      .map((s) => ({ text: s.text, words: s.words, style: s.style, animation: s.animation, start: s.start, end: s.end })),
  };
}

/** Renders the clipboard as plain text for the OS clipboard (`navigator.clipboard.writeText`) —
 * one caption per line, in the same timeline order as `captions`. A caption's own internal line
 * breaks are preserved verbatim, never stripped or escaped: this string is a one-way, best-effort
 * representation for pasting into OTHER applications (Notepad, a chat app, etc.) and is NEVER
 * re-parsed as SUBLY's own source of truth for an internal paste — an internal paste always reads
 * the structured `CaptionClipboard` object itself (see resolvePasteMapping), so a multi-line
 * caption's own internal breaks being visually indistinguishable here from the between-caption
 * separator is never actually ambiguous in practice. */
export function formatClipboardAsPlainText(clipboard: CaptionClipboard): string {
  return clipboard.captions.map((c) => c.text).join("\n");
}

export type PasteResolution =
  | { kind: "empty" }
  | { kind: "match"; mapping: { targetId: string; text: string }[] }
  | { kind: "mismatch"; copiedCount: number; selectedCount: number; pasteCount: number; preview: string[] };

/** Decides how a structured internal paste maps copied caption text onto selected destination
 * captions (P14 spec §4/§5). `targetIds` must already be in the caller's intended destination
 * order — the keyboard hook and the paste-mismatch dialog both pass them in TIMELINE order,
 * matching how copy orders its own source captions (buildCaptionClipboard above), so "3rd copied
 * caption -> 3rd selected caption" always means the same thing on both ends.
 *
 *  - Equal counts ("match"): a plain, deterministic 1:1 mapping by position — copied[0] onto
 *    targetIds[0], copied[1] onto targetIds[1], etc. Safe to apply immediately, no confirmation
 *    needed (the 1-copied-into-1-selected case is the overwhelmingly common one).
 *  - Unequal counts ("mismatch") — in EITHER direction, more copied than selected OR more
 *    selected than copied (including 1 copied into many selected): never silently truncated and
 *    never silently repeated (P14's own explicit "do not silently truncate a mismatched multi-
 *    caption paste... never repeat pasted captions" requirement). Returns a preview of the first
 *    `pasteCount` (= min(copiedCount, selectedCount)) copied captions' text for a confirmation
 *    dialog; the caller applies nothing until the user explicitly confirms (see
 *    resolveMismatchPasteMapping).
 *  - Zero copied captions ("empty"): nothing to paste — e.g. Ctrl+V with no internal clipboard,
 *    or a clipboard populated from an empty selection.
 *
 * Never reads/returns `start`/`end`/`style`/`animation` from the clipboard records — this phase's
 * paste is TEXT ONLY (P14 §8/§16); no resolution this function returns can carry timing or style
 * onto a destination caption. */
export function resolvePasteMapping(clipboard: CaptionClipboard, targetIds: string[]): PasteResolution {
  const copiedCount = clipboard.captions.length;
  const selectedCount = targetIds.length;
  if (copiedCount === 0) return { kind: "empty" };
  if (copiedCount === selectedCount) {
    return { kind: "match", mapping: targetIds.map((targetId, i) => ({ targetId, text: clipboard.captions[i].text })) };
  }
  const pasteCount = Math.min(copiedCount, selectedCount);
  return {
    kind: "mismatch",
    copiedCount,
    selectedCount,
    pasteCount,
    preview: clipboard.captions.slice(0, pasteCount).map((c) => c.text),
  };
}

/** Builds the actual mapping for a CONFIRMED mismatch paste (P14 §5's "Paste first N"
 * confirmation) — the first `pasteCount` copied captions' text onto the first `pasteCount` target
 * ids, in order. Any caption beyond `pasteCount` on either side (a remaining selected destination
 * when selectedCount > copiedCount, or a remaining copied caption when copiedCount >
 * selectedCount) is left out of the mapping entirely — never repeated, never partially applied to
 * a caption it wasn't explicitly matched to. */
export function resolveMismatchPasteMapping(clipboard: CaptionClipboard, targetIds: string[]): { targetId: string; text: string }[] {
  const pasteCount = Math.min(clipboard.captions.length, targetIds.length);
  return targetIds.slice(0, pasteCount).map((targetId, i) => ({ targetId, text: clipboard.captions[i].text }));
}

/** Converts a resolved mapping (from resolvePasteMapping's "match" case, or
 * resolveMismatchPasteMapping) into the `Record<string, string>` shape the existing
 * `applyTextMap` store action already takes — the ONE reused commit path for every multi-caption
 * text mutation in this app (see editor-store.ts), never a new one. */
export function mappingToTextRecord(mapping: { targetId: string; text: string }[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { targetId, text } of mapping) record[targetId] = text;
  return record;
}
