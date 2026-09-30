import type { AnimationConfig, SubtitleStyle } from "@/types/subtitle";

/**
 * Copy/Paste Style clipboard. Backed by localStorage (not a module variable)
 * specifically so "paste onto another project" works — each project's editor
 * gets a fresh zustand store instance on navigation, but the clipboard should
 * survive that.
 */
const KEY = "subly:style-clipboard";

export interface StyleClipboardEntry {
  style: SubtitleStyle;
  animation: AnimationConfig;
  copiedAt: string;
}

export function copyStyleToClipboard(style: SubtitleStyle, animation: AnimationConfig): void {
  try {
    const entry: StyleClipboardEntry = { style, animation, copiedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // localStorage can throw in some private-browsing contexts — copy is best-effort.
  }
}

export function readStyleClipboard(): StyleClipboardEntry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StyleClipboardEntry;
  } catch {
    return null;
  }
}
