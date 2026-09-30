import type { AnimationConfig, SubtitleStyle } from "../types/subtitle.ts";

/**
 * Pure logic for user-created ("custom") caption presets — no React, no Prisma, no fetch.
 * Persisted via the ALREADY-EXISTING `SubtitlePreset` Prisma model (see prisma/schema.prisma
 * and src/app/api/presets/route.ts) — that table was declared in the schema but never wired
 * up to any app code, so persisting custom presets here required zero new migration. Built-in
 * presets (src/lib/presets.ts) are a completely separate, hardcoded array and are never
 * inserted into this table — this module has no operation that can read, write, or delete a
 * built-in preset definition, which is what makes "built-ins are immutable/undeletable" true
 * by construction rather than by a runtime check.
 */

export interface CustomPresetRecord {
  id: string;
  name: string;
  style: SubtitleStyle;
  animation: AnimationConfig;
  createdAt: string;
}

// --- name validation ---------------------------------------------------------------------

export function normalizePresetName(name: string): string {
  return name.trim();
}

export function findPresetByName(
  existing: Pick<CustomPresetRecord, "id" | "name">[],
  name: string,
  excludeId?: string,
): Pick<CustomPresetRecord, "id" | "name"> | undefined {
  const normalized = normalizePresetName(name).toLowerCase();
  return existing.find((p) => p.id !== excludeId && p.name.trim().toLowerCase() === normalized);
}

export type PresetNameValidation = { ok: true; name: string } | { ok: false; error: string };

/** Validates a name for a brand-new custom preset — non-empty after trimming, and not a
 * case-insensitive duplicate of an existing custom preset's name. Deliberately does NOT check
 * against built-in preset names: naming a custom preset "Classic" is allowed (the two are
 * already visually and structurally distinct — see the "My Presets" vs built-in categories in
 * presets-panel.tsx), so this only prevents the one genuinely confusing case: silently having
 * two of the user's OWN presets with the same name. */
export function validateNewPresetName(existing: Pick<CustomPresetRecord, "id" | "name">[], rawName: string): PresetNameValidation {
  const name = normalizePresetName(rawName);
  if (!name) return { ok: false, error: "Preset name can't be empty." };
  if (findPresetByName(existing, name)) return { ok: false, error: `"${name}" already exists.` };
  return { ok: true, name };
}

/** Same rule as validateNewPresetName, but excludes the preset being renamed from the
 * duplicate check — renaming "My Style" to "My Style" (a no-op) or to a name only that preset
 * currently holds must not be rejected as a collision with itself. */
export function validateRenamedPresetName(
  existing: Pick<CustomPresetRecord, "id" | "name">[],
  id: string,
  rawName: string,
): PresetNameValidation {
  const name = normalizePresetName(rawName);
  if (!name) return { ok: false, error: "Preset name can't be empty." };
  if (findPresetByName(existing, name, id)) return { ok: false, error: `"${name}" already exists.` };
  return { ok: true, name };
}

/** Computes the name for a new "Duplicate" of a custom preset (Task 87426 Part 9): "X" ->
 * "X Copy", and if that's already taken too, "X Copy 2", "X Copy 3", ... — the same
 * find-the-next-free-suffix approach duplicateSubtitle-style features commonly use, kept here
 * as a pure function so the panel component doesn't need its own name-collision loop. Always
 * returns a name validateNewPresetName would accept against `existing` (never empty, never a
 * collision), so callers can create the duplicate directly without a second round-trip. */
export function duplicatePresetName(existing: Pick<CustomPresetRecord, "id" | "name">[], sourceName: string): string {
  const base = `${normalizePresetName(sourceName)} Copy`;
  if (!findPresetByName(existing, base)) return base;
  let n = 2;
  while (findPresetByName(existing, `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// --- parsing (DB row -> record) ----------------------------------------------------------

/** Shape a raw SubtitlePreset row is expected to have — style/animation are JSON-encoded
 * strings, the same convention as Project.globalStyle/animation (see lib/db-json.ts). */
export interface RawPresetRow {
  id: string;
  name: string;
  style: string | null;
  animation: string | null;
  createdAt: Date | string;
}

function safeParseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Turns raw (possibly malformed) DB rows into clean records — a row with corrupt/missing
 * style or animation JSON is dropped rather than thrown, so one bad row (e.g. from a future
 * app version, or a partially-written save) never breaks loading every OTHER saved preset.
 * A missing/undefined/null row list degrades to an empty array, never an error. */
export function parsePresetRows(rows: RawPresetRow[] | null | undefined): CustomPresetRecord[] {
  if (!rows) return [];
  const out: CustomPresetRecord[] = [];
  for (const row of rows) {
    const style = safeParseJson<SubtitleStyle>(row.style);
    const animation = safeParseJson<AnimationConfig>(row.animation);
    if (!style || !animation) continue;
    out.push({
      id: row.id,
      name: row.name,
      style,
      animation,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
    });
  }
  return out;
}

// --- apply / list-reducer helpers --------------------------------------------------------

/** What "applying" a custom preset actually hands the editor: a deep, independent copy of its
 * style/animation, never a live reference to the preset object itself. This is the guarantee
 * behind "deleting a custom preset must not break a project that already applied it" — once
 * applied, a project's own globalStyle/animation is a fully separate value (and, in the real
 * app, ends up its own independent JSON column via lib/db-json.ts), with no path back to the
 * SubtitlePreset row it originally came from. */
export function extractStyleForApply(preset: Pick<CustomPresetRecord, "style" | "animation">): {
  style: SubtitleStyle;
  animation: AnimationConfig;
} {
  return JSON.parse(JSON.stringify({ style: preset.style, animation: preset.animation }));
}

export function removePresetFromList(list: CustomPresetRecord[], id: string): CustomPresetRecord[] {
  return list.filter((p) => p.id !== id);
}

export function updatePresetInList(
  list: CustomPresetRecord[],
  id: string,
  patch: Partial<Pick<CustomPresetRecord, "name" | "style" | "animation">>,
): CustomPresetRecord[] {
  return list.map((p) => (p.id === id ? { ...p, ...patch } : p));
}
