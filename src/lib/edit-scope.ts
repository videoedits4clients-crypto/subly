import type { Subtitle } from "../types/subtitle.ts";

/**
 * Pure rules shared by the Templates, Presets, Style and Animation panels (P23) so they agree on WHAT they act on.
 *
 * Model (see also docs/STYLE-FAMILIES.md, "Template + styling workflow"):
 *   - project look   = project.globalStyle + project.animation (what every caption without an override uses);
 *   - caption look   = project look overlaid by the caption's own `style` / `animation` override, if any;
 *   - edit scope     = "all"      → the panels change the project look (a template additionally replaces every override);
 *                      "selected" → the panels change the selected captions' own overrides.
 * The scope is one value in the store, so choosing "This caption" in the Templates tab means the Style and Animation
 * tabs then edit that caption too — instead of silently editing the project look while the caption (which now carries
 * its own complete override) does not change.
 */

export type EditScope = "all" | "selected";

/** A scope the user chose, remembered together with the selection it was chosen for. */
export interface StoredEditScope {
  scope: EditScope;
  selectionKey: string;
}

/** Identifies a selection (the focused caption plus the multi-selection) so a remembered scope can tell whether it still applies. */
export function selectionKeyOf(focusedId: string | null, selectedIds: Iterable<string>): string {
  const ids = new Set(selectedIds);
  if (focusedId) ids.add(focusedId);
  return Array.from(ids).sort().join(",");
}

/**
 * The scope a panel acts on.
 *  - With nothing selected there is nothing to scope to: always the project.
 *  - A scope the user chose belongs to the selection it was chosen for. The moment the selection changes it lapses and
 *    each panel returns to its own default — so "apply to all captions", chosen earlier, can never turn the next click on
 *    a freshly selected caption into a project-wide replacement.
 *  - Unchosen / lapsed: each panel's long-standing default (Style, Animation, Presets: All captions; Templates: the selection).
 */
export function resolveEditScope(stored: StoredEditScope | null, currentSelectionKey: string, hasSelection: boolean, defaultWhenUnset: EditScope): EditScope {
  if (!hasSelection) return "all";
  return stored && stored.selectionKey === currentSelectionKey ? stored.scope : defaultWhenUnset;
}

export interface OverrideSummary {
  /** Captions with their own style override. */
  style: string[];
  /** Captions with their own animation override. */
  animation: string[];
  /** Captions with either (each once). */
  any: string[];
}

/** Which captions carry their own look (style and/or animation override). Word-level styling is not a caption look and is never counted. */
export function summarizeOverrides(subtitles: Pick<Subtitle, "id" | "style" | "animation">[]): OverrideSummary {
  const style: string[] = [];
  const animation: string[] = [];
  const any: string[] = [];
  for (const s of subtitles) {
    const hasStyle = s.style !== undefined;
    const hasAnimation = s.animation !== undefined;
    if (hasStyle) style.push(s.id);
    if (hasAnimation) animation.push(s.id);
    if (hasStyle || hasAnimation) any.push(s.id);
  }
  return { style, animation, any };
}

/** True when a caption has its own look. */
export const hasOwnLook = (s: Pick<Subtitle, "style" | "animation">) => s.style !== undefined || s.animation !== undefined;

/**
 * The word index a panel may show for the caption it currently has focused. A word index belongs to ONE caption: it
 * is dropped when the focus moves to another caption, and when the caption no longer has that many words (a shorter
 * caption used to make the word editor read `words[5]` of a 3-word caption and crash the panel).
 */
export function validWordIndex(
  remembered: { subtitleId: string; index: number } | null,
  focusedSubtitle: Pick<Subtitle, "id" | "words"> | undefined,
): number | null {
  if (!remembered || !focusedSubtitle || remembered.subtitleId !== focusedSubtitle.id) return null;
  return remembered.index >= 0 && remembered.index < focusedSubtitle.words.length ? remembered.index : null;
}

/** Words for a scope notice: "1 caption has its own style", "3 captions have their own style and animation". */
export function describeOverrides(summary: OverrideSummary, kind: "style" | "animation" | "look"): string | null {
  const ids = kind === "style" ? summary.style : kind === "animation" ? summary.animation : summary.any;
  if (ids.length === 0) return null;
  const noun = kind === "look" ? "style or animation" : kind;
  return `${ids.length} ${ids.length === 1 ? "caption has its own" : "captions have their own"} ${noun}`;
}
