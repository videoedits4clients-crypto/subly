"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Palette, Plus, MoreVertical, Pencil, Trash2, Save, Search, Copy, RotateCcw } from "lucide-react";
import { useEditorStore } from "@/store/editor-store";
import { BUILT_IN_PRESETS, PRESET_CATEGORIES, type SubtitlePresetDef, type PresetCategory } from "@/lib/presets";
import { FONT_NAMES } from "@/lib/fonts";
import { styleToTextCss, activeWordCss } from "@/lib/subtitles/preview-style";
import { extractStyleForApply, validateNewPresetName, findPresetByName, duplicatePresetName, type CustomPresetRecord } from "@/lib/custom-presets";
import { api } from "@/lib/api-client";
import { applyTextCase, type AnimationConfig, type SubtitleStyle } from "@/types/subtitle";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PresetNameDialog } from "./preset-name-dialog";
import { toast } from "sonner";

interface BrandKit {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
}

/** "My Styles" (custom presets) is treated as one more entry in the same category filter chip
 * row as the 8 built-in categories (section 9's own recommended structure lists it right after
 * Retro) — it isn't a real PresetCategory value (custom presets aren't categorized, they're the
 * user's own flat list), just a UI-only label for the filter/search affordance. */
const MY_STYLES_FILTER = "My Styles" as const;
type CategoryFilter = PresetCategory | typeof MY_STYLES_FILTER | "All";
const CATEGORY_FILTERS: CategoryFilter[] = ["All", ...PRESET_CATEGORIES, MY_STYLES_FILTER];

const SAMPLE_WORDS = ["This", "is", "amazing"];

/** A real miniature render of the preset — same styleToTextCss + activeWordCss the live editor
 * preview and export both build from (see lib/subtitles/preview-style.ts and ass.ts's own
 * wordOverride, its ASS-syntax counterpart), not a hand-approximated look-alike, so "what you
 * see is what you get" starts at the preset picker itself. Position is simplified to
 * always-centered (a preset's actual y is often near the bottom safe area, which doesn't read
 * well shrunk into a small card) — everything else (font, weight, color, case, outline, shadow,
 * background, and — since P5 — the REAL active-word treatment: color change, scale, underline,
 * or background chip, whichever the preset's own word animation actually produces) is the real
 * thing. The middle word of the 3-word sample always stands in for "the word currently being
 * spoken" so every style with word emphasis shows it at a glance, exactly like the task's own
 * "JUST LIKE THIS"-style card brief asks for. */
function PresetPreview({ style, animation }: { style: SubtitleStyle; animation: AnimationConfig }) {
  const textCss = styleToTextCss(style, 260, SAMPLE_WORDS.join(" "));
  const activeCss = style.wordHighlight ? activeWordCss(style, animation) : undefined;
  return (
    <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-[#15151f] px-2">
      <div style={{ ...textCss, display: "flex", flexWrap: "wrap", justifyContent: "center", maxWidth: "100%", gap: "0.3em" }}>
        {SAMPLE_WORDS.map((w, i) => (
          <span key={i} style={i === 1 ? activeCss : undefined}>
            {applyTextCase(w, style.textCase)}
          </span>
        ))}
      </div>
    </div>
  );
}

function PresetCard({ preset, isActive, onApply }: { preset: SubtitlePresetDef; isActive: boolean; onApply: () => void }) {
  return (
    <button
      onClick={onApply}
      title={preset.description}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border p-2.5 text-center transition-colors",
        isActive ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border-strong bg-surface-2 hover:bg-surface-3",
      )}
    >
      <PresetPreview style={preset.style} animation={preset.animation} />
      <span className={cn("text-xs font-medium", isActive && "text-accent")}>{preset.name}</span>
    </button>
  );
}

/** Custom (user-saved) preset card — same PresetPreview as a built-in card (identical render
 * path, so "what you see is what you get" holds here too), but with a small overflow menu for
 * the operations only custom presets support (update/rename/delete). Visually distinguished
 * from a built-in card by a "Custom" tag, never presented as if it were built-in. */
function CustomPresetCard({
  preset,
  isActive,
  isDirty,
  onApply,
  onUpdate,
  onRename,
  onDuplicate,
  onDelete,
}: {
  preset: CustomPresetRecord;
  isActive: boolean;
  isDirty: boolean;
  onApply: () => void;
  onUpdate: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-xl border p-2.5 text-center transition-colors",
        isActive ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border-strong bg-surface-2 hover:bg-surface-3",
      )}
    >
      <button onClick={onApply} className="flex w-full flex-col items-center gap-2">
        <div className="relative w-full">
          <PresetPreview style={preset.style} animation={preset.animation} />
          <span className="absolute left-1.5 top-1.5 rounded-full border border-border-strong bg-surface/90 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide text-muted-2">
            Custom
          </span>
        </div>
        <span className={cn("w-full truncate text-xs font-medium", isActive && "text-accent")}>{preset.name}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted opacity-0 transition-opacity hover:bg-surface hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {isDirty && (
            <DropdownMenuItem onSelect={onUpdate}>
              <Save className="size-3.5" /> Update preset
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="size-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy className="size-3.5" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} className="text-danger focus:bg-danger/10">
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PresetsPanel() {
  const project = useEditorStore((s) => s.project);
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const setGlobalStyle = useEditorStore((s) => s.setGlobalStyle);
  const lastAppliedStyleSnapshot = useEditorStore((s) => s.lastAppliedStyleSnapshot);
  const resetToLastApplied = useEditorStore((s) => s.resetToLastApplied);
  const [brandKit, setBrandKit] = useState<BrandKit | null | undefined>(undefined);

  const [customPresets, setCustomPresets] = useState<CustomPresetRecord[] | null>(null);
  const lastAppliedCustomId = useEditorStore((s) => s.lastAppliedCustomPresetId);
  const setLastAppliedCustomId = useEditorStore((s) => s.setLastAppliedCustomPresetId);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CustomPresetRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomPresetRecord | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All");

  const loadCustomPresets = useCallback(() => {
    api.listCustomPresets().then(setCustomPresets).catch(() => setCustomPresets([]));
  }, []);

  useEffect(() => {
    loadCustomPresets();
  }, [loadCustomPresets]);

  useEffect(() => {
    fetch("/api/brand-kit")
      .then((r) => r.json())
      .then(setBrandKit)
      .catch(() => setBrandKit(null));
  }, []);

  // Recomputed from the project's actual current style, not just "the last preset clicked" —
  // so it stays honest if the user tweaks a slider afterward (no preset should look selected
  // once the style no longer matches it). Checked against both built-in and custom presets.
  const activeBuiltInId = project ? (BUILT_IN_PRESETS.find((p) => JSON.stringify(p.style) === JSON.stringify(project.globalStyle))?.id ?? null) : null;
  const activeCustomId =
    project && customPresets ? (customPresets.find((p) => JSON.stringify(p.style) === JSON.stringify(project.globalStyle))?.id ?? null) : null;

  // "Update preset" only makes sense for the custom preset the user most recently applied in
  // this session, and only once they've actually changed something since — otherwise there's
  // nothing to update, and showing the action anyway would just be clutter.
  const dirtyCustomId =
    lastAppliedCustomId && lastAppliedCustomId !== activeCustomId && customPresets?.some((p) => p.id === lastAppliedCustomId)
      ? lastAppliedCustomId
      : null;

  // "RESET CHANGES" (Task 87426 Part 10): true once the live style/animation has drifted from
  // whatever was applied last (built-in or custom) — same "compare against the snapshot"
  // approach dirtyCustomId already uses one line up, just against lastAppliedStyleSnapshot
  // instead of a specific custom preset's stored row.
  const hasUnappliedChanges =
    !!project &&
    !!lastAppliedStyleSnapshot &&
    (JSON.stringify(project.globalStyle) !== JSON.stringify(lastAppliedStyleSnapshot.style) ||
      JSON.stringify(project.animation) !== JSON.stringify(lastAppliedStyleSnapshot.animation));

  // Search matches by name (case-insensitive substring) across BOTH built-in and custom
  // presets; the category chip row additionally narrows which section(s) are shown at all.
  // Kept as plain array filtering, not a virtualized list — even the full ~45-built-in +
  // however-many-custom library is a small enough DOM (see the P5 report's performance note)
  // that this stays responsive without extra machinery.
  const searchTerm = search.trim().toLowerCase();
  const matchesSearch = useCallback((name: string) => !searchTerm || name.toLowerCase().includes(searchTerm), [searchTerm]);

  const visibleCategories = useMemo(
    () => (categoryFilter === "All" ? PRESET_CATEGORIES : categoryFilter === MY_STYLES_FILTER ? [] : [categoryFilter]),
    [categoryFilter],
  );
  const showCustomSection = categoryFilter === "All" || categoryFilter === MY_STYLES_FILTER;

  function applyBuiltIn(preset: SubtitlePresetDef) {
    applyPreset(preset.style, preset.animation);
    setLastAppliedCustomId(null);
  }

  function applyCustom(preset: CustomPresetRecord) {
    const { style, animation } = extractStyleForApply(preset);
    applyPreset(style, animation);
    setLastAppliedCustomId(preset.id);
  }

  async function handleSaveNew(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!project) return { ok: false, error: "No project loaded." };
    // Instant client-side feedback using the exact same validation the server applies —
    // avoids a round trip for the common case, but the server call below is still the
    // authoritative check (protects against a stale local list).
    const localCheck = validateNewPresetName(customPresets ?? [], name);
    if (!localCheck.ok) {
      // Task 87426 Part 6: a duplicate NAME is not a dead end — offer "Replace" as an
      // alternative to picking a different name, without silently overwriting anything.
      // The name dialog itself stays open (showing localCheck.error) so editing the name is
      // still the default path; this toast is the second, explicit option.
      const conflict = findPresetByName(customPresets ?? [], name);
      if (conflict) {
        toast.error(localCheck.error, {
          action: {
            label: "Replace",
            onClick: () => {
              const target = (customPresets ?? []).find((p) => p.id === conflict.id);
              if (target) handleUpdate(target);
            },
          },
        });
      }
      return localCheck;
    }
    try {
      const created = await api.createCustomPreset({ name: localCheck.name, style: project.globalStyle, animation: project.animation });
      setCustomPresets((prev) => [created, ...(prev ?? [])]);
      setLastAppliedCustomId(created.id);
      toast.success(`Saved as "${created.name}".`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't save this preset." };
    }
  }

  async function handleDuplicate(preset: CustomPresetRecord) {
    // A real server round-trip (not a local-only clone) so the duplicate is independently
    // persisted from the moment it's created — createCustomPreset already deep-copies via
    // JSON over HTTP, the same isolation guarantee extractStyleForApply documents for apply.
    const name = duplicatePresetName(customPresets ?? [], preset.name);
    try {
      const created = await api.createCustomPreset({ name, style: preset.style, animation: preset.animation });
      setCustomPresets((prev) => [created, ...(prev ?? [])]);
      toast.success(`Duplicated as "${created.name}".`);
    } catch {
      toast.error("Couldn't duplicate this style.");
    }
  }

  async function handleRename(id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const updated = await api.updateCustomPreset(id, { name });
      setCustomPresets((prev) => (prev ?? []).map((p) => (p.id === id ? updated : p)));
      toast.success("Preset renamed.");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't rename this preset." };
    }
  }

  async function handleUpdate(preset: CustomPresetRecord) {
    if (!project) return;
    try {
      const updated = await api.updateCustomPreset(preset.id, { style: project.globalStyle, animation: project.animation });
      setCustomPresets((prev) => (prev ?? []).map((p) => (p.id === preset.id ? updated : p)));
      toast.success(`Updated "${updated.name}".`);
    } catch {
      toast.error("Couldn't update this preset.");
    }
  }

  async function handleDelete(preset: CustomPresetRecord) {
    try {
      await api.deleteCustomPreset(preset.id);
      setCustomPresets((prev) => (prev ?? []).filter((p) => p.id !== preset.id));
      if (lastAppliedCustomId === preset.id) setLastAppliedCustomId(null);
      toast.success("Preset deleted.");
    } catch {
      toast.error("Couldn't delete this preset.");
    }
  }

  function applyBrandKit() {
    if (!brandKit) return;
    setGlobalStyle({
      fontFamily: FONT_NAMES.includes(brandKit.fontFamily) ? brandKit.fontFamily : "Inter",
      color: brandKit.primaryColor,
      highlightColor: brandKit.accentColor,
    });
    toast.success("Brand kit applied.");
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-2">Brand Kit</h3>
        {brandKit === undefined ? null : brandKit === null ? (
          <div className="rounded-lg border border-dashed border-border-strong p-3 text-center">
            <p className="text-xs text-muted-2">No brand kit yet.</p>
            <Link href="/dashboard/brand-kit" className="mt-2 inline-block text-xs text-accent hover:underline">
              Create one
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-border-strong bg-surface-2 p-3">
            <div className="flex gap-1">
              {[brandKit.primaryColor, brandKit.secondaryColor, brandKit.accentColor].map((c) => (
                <span key={c} className="size-4 rounded-full border border-border-strong" style={{ background: c }} />
              ))}
            </div>
            <span className="flex-1 truncate text-xs text-muted">{brandKit.name}</span>
            <Button size="sm" variant="outline" onClick={applyBrandKit}>
              <Palette className="size-3.5" /> Apply
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-5 overflow-y-auto p-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Caption Styles</h3>
            {hasUnappliedChanges && (
              <button
                onClick={() => {
                  resetToLastApplied();
                  toast.success("Changes reset.");
                }}
                className="flex items-center gap-1 text-xs text-muted-2 underline-offset-2 hover:text-danger hover:underline"
                title="Revert to the style as it was when last applied, discarding changes made since"
              >
                <RotateCcw className="size-3" /> Reset changes
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search styles..."
              className="h-8 pl-8 text-xs"
              aria-label="Search caption styles"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CATEGORY_FILTERS.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  categoryFilter === cat
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border-strong bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {visibleCategories.map((category) => {
          const presets = BUILT_IN_PRESETS.filter((p) => p.category === category && matchesSearch(p.name));
          if (presets.length === 0) return null;
          return (
            <div key={category}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">{category}</h4>
              <div className="grid grid-cols-2 gap-3">
                {presets.map((p) => (
                  <PresetCard key={p.id} preset={p} isActive={activeBuiltInId === p.id} onApply={() => applyBuiltIn(p)} />
                ))}
              </div>
            </div>
          );
        })}

        {showCustomSection && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">My Styles</h4>
              <Button size="sm" variant="outline" onClick={() => setSaveDialogOpen(true)} disabled={!project}>
                <Plus className="size-3.5" /> Save as preset
              </Button>
            </div>
            {customPresets === null ? null : customPresets.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong p-3 text-center text-xs text-muted-2">
                Customize a style, then click &quot;Save as preset&quot; to reuse it on future projects.
              </p>
            ) : (
              (() => {
                const filteredCustom = customPresets.filter((p) => matchesSearch(p.name));
                return filteredCustom.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border-strong p-3 text-center text-xs text-muted-2">
                    No saved styles match &quot;{search}&quot;.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredCustom.map((p) => (
                      <CustomPresetCard
                        key={p.id}
                        preset={p}
                        isActive={activeCustomId === p.id}
                        isDirty={dirtyCustomId === p.id}
                        onApply={() => applyCustom(p)}
                        onUpdate={() => handleUpdate(p)}
                        onRename={() => setRenameTarget(p)}
                        onDuplicate={() => handleDuplicate(p)}
                        onDelete={() => setDeleteTarget(p)}
                      />
                    ))}
                  </div>
                );
              })()
            )}
          </div>
        )}
      </div>

      <PresetNameDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        title="Save as preset"
        description="Save the current caption style, animation, and word highlighting as a reusable preset."
        submitLabel="Save"
        onSubmit={handleSaveNew}
      />
      <PresetNameDialog
        open={renameTarget !== null}
        onOpenChange={(v) => !v && setRenameTarget(null)}
        title="Rename preset"
        description="Choose a new name for this preset — its saved style is unaffected."
        submitLabel="Rename"
        initialName={renameTarget?.name ?? ""}
        onSubmit={(name) => handleRename(renameTarget!.id, name)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Delete this preset?"
        description={`"${deleteTarget?.name}" will be deleted. Captions already using this style are unaffected.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) return handleDelete(deleteTarget);
        }}
      />
    </div>
  );
}
