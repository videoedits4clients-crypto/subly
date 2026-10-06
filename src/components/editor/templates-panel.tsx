"use client";

import { memo, useMemo, useState } from "react";
import { Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/store/editor-store";
import { resolveAnimation, resolveStyle } from "@/types/subtitle";
import { FAMILY_INFO, STYLE_FAMILIES, type StyleFamily } from "@/lib/presets";
import {
  CAPTION_TEMPLATES,
  filterTemplates,
  resolveTemplate,
  templateFamilies,
  templateMatches,
  type CaptionTemplate,
  type ResolvedTemplate,
  type TemplateTarget,
} from "@/lib/caption-templates";
import { resolveEditScope, selectionKeyOf, summarizeOverrides } from "@/lib/edit-scope";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { PresetPreview, describeMotion } from "./presets-panel";
import { ScopeToggle } from "./scope-controls";

/** Resolved once at module load: a template is plain data, so selecting, filtering or typing in the search box never re-resolves (or re-renders) a card. */
const RESOLVED = new Map<string, ResolvedTemplate>(CAPTION_TEMPLATES.map((t) => [t.id, resolveTemplate(t)]));
const FAMILY_CHIPS = templateFamilies(STYLE_FAMILIES);

const TemplateCard = memo(function TemplateCard({ template, isActive, onApply }: { template: CaptionTemplate; isActive: boolean; onApply: (t: CaptionTemplate) => void }) {
  const resolved = RESOLVED.get(template.id)!;
  return (
    <button
      onClick={() => onApply(template)}
      title={template.purpose}
      aria-pressed={isActive}
      data-template-id={template.id}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-colors",
        isActive ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border-strong bg-surface-2 hover:bg-surface-3",
      )}
    >
      <PresetPreview style={resolved.style} animation={resolved.animation} />
      <span className={cn("text-xs font-medium", isActive && "text-accent")}>{template.name}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-2">{FAMILY_INFO[template.family].label}</span>
      <span className="text-[10px] leading-tight text-muted-2">{describeMotion(resolved.animation)}</span>
    </button>
  );
});

/**
 * Caption templates: a curated set of complete treatments (typography + container + position + emphasis + motion).
 * A template resolves into the ordinary style + animation (lib/caption-templates.ts), is applied to the chosen
 * captions as ONE undoable step, and changes nothing but styling. Cards reuse the Presets tab's real-CSS preview.
 */
export function TemplatesPanel() {
  const project = useEditorStore((s) => s.project);
  const selectedId = useEditorStore((s) => s.selectedSubtitleId);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const applyTemplate = useEditorStore((s) => s.applyTemplate);
  const undo = useEditorStore((s) => s.undo);
  // Shared with the Presets / Style / Animation tabs. Unchosen: Templates apply to the selection when there is one.
  const editScope = useEditorStore((s) => s.editScope);
  const setEditScope = useEditorStore((s) => s.setEditScope);
  const [family, setFamily] = useState<StyleFamily | "all">("all");
  const [search, setSearch] = useState("");

  const targetIds = useMemo(() => {
    const ids = new Set(selectedIds);
    if (selectedId) ids.add(selectedId);
    return Array.from(ids);
  }, [selectedId, selectedIds]);
  const hasSelection = targetIds.length > 0;
  // With nothing selected "Selected" has no meaning, so the panel falls back to "All captions" (the toggle shows it).
  const scope = resolveEditScope(editScope, selectionKeyOf(selectedId, selectedIds), hasSelection, "selected");

  const subtitles = project?.subtitles;
  const effective = useMemo(() => {
    if (!project) return null;
    if (scope === "all") return { style: project.globalStyle, animation: project.animation };
    const sub = project.subtitles.find((s) => s.id === (selectedId ?? targetIds[0]));
    return sub ? { style: resolveStyle(project, sub), animation: resolveAnimation(project, sub) } : null;
  }, [project, scope, selectedId, targetIds]);

  const templates = useMemo(() => filterTemplates(family, search), [family, search]);
  const activeId = useMemo(() => (effective ? (CAPTION_TEMPLATES.find((t) => templateMatches(t, effective))?.id ?? null) : null), [effective]);

  function apply(template: CaptionTemplate) {
    const target: TemplateTarget = scope === "all" ? { all: true } : { ids: targetIds };
    const replaced = scope === "all" && project ? summarizeOverrides(project.subtitles).any.length : 0;
    const count = applyTemplate(target, RESOLVED.get(template.id)!);
    // the scope just used becomes the scope of the Style / Animation / Presets tabs, so they edit what the template just styled
    setEditScope(scope);
    const what = scope === "all" ? "all captions" : count === 1 ? "1 caption" : `${count} captions`;
    if (count === 0) {
      toast.message(`"${template.name}" is already applied to ${what}.`);
      return;
    }
    toast.success(`Applied "${template.name}" to ${what}${replaced > 0 ? ` — replaced ${replaced} custom ${replaced === 1 ? "look" : "looks"}` : ""}.`, {
      action: { label: "Undo", onClick: () => undo() },
      icon: <Undo2 className="size-3.5" />,
    });
  }

  if (!project || !subtitles) return null;
  const count = subtitles.length;
  const overridden = summarizeOverrides(subtitles).any.length;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="space-y-3 border-b border-border p-4">
        <div>
          <h3 className="text-sm font-semibold">Caption Templates</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-2">
            A complete look in one click — style, position, emphasis and motion. Only styling changes; text and timing are never touched.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Apply to:</span>
          <ScopeToggle scope={scope} hasSelection={hasSelection} selectedCount={targetIds.length} captionCount={count} onChange={setEditScope} />
        </div>
        {scope === "all" && (
          <p className="text-[11px] leading-snug text-muted-2">
            Replaces the project style and {overridden > 0 ? `the ${overridden} caption${overridden === 1 ? "" : "s"} with their own style or animation` : "any per-caption style or animation overrides"}. One Undo restores everything.
          </p>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates..." className="h-8 pl-8 text-xs" aria-label="Search caption templates" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Template family">
          {(["all", ...FAMILY_CHIPS] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFamily(f)}
              aria-pressed={family === f}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                family === f ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground",
              )}
            >
              {f === "all" ? "All" : FAMILY_INFO[f].label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {templates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong p-3 text-center text-xs text-muted-2">No templates match &quot;{search}&quot;.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} isActive={activeId === t.id} onApply={apply} />
            ))}
          </div>
        )}
        <p className="text-[10px] leading-snug text-muted-2">
          Previews show typography, position, container and the active-word treatment — they are still images. Entrance/exit motion is listed under each name and plays in the editor preview as soon as you apply a template.
        </p>
      </div>
    </div>
  );
}
