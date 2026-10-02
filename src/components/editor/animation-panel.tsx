"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { resolveAnimation } from "@/types/subtitle";
import type { EntranceAnimation, ExitAnimation, WordAnimation } from "@/types/subtitle";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export const ENTRANCE: { value: EntranceAnimation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide-up", label: "Slide Up" },
  { value: "slide-down", label: "Slide Down" },
  { value: "slide-left", label: "Slide Left" },
  { value: "slide-right", label: "Slide Right" },
  { value: "bounce", label: "Bounce" },
  // Task 146220 (P19.17): labeled "Word Fade", not "Typewriter" — the underlying entrance
  // animation (see lib/subtitles/animation-render.ts's APPROXIMATED_FADE_ENTRANCES) is the
  // same capped ~150ms fade used for word-pop/char-pop, not a true character-by-character
  // reveal; the old label implied behavior that doesn't exist. The stored value stays
  // "typewriter" (existing projects/presets reference it) — only the user-facing label changed.
  { value: "typewriter", label: "Word Fade" },
  { value: "word-pop", label: "Word Pop" },
  { value: "char-pop", label: "Char Pop" },
];

export const EXIT: { value: ExitAnimation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide Up" },
  { value: "slide-down", label: "Slide Down" },
  { value: "slide-left", label: "Slide Left" },
  { value: "slide-right", label: "Slide Right" },
  { value: "pop", label: "Pop" },
];

export const WORD: { value: WordAnimation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "highlight", label: "Highlight" },
  { value: "scale", label: "Scale" },
  { value: "bounce", label: "Bounce" },
  { value: "color", label: "Color Change" },
  { value: "underline", label: "Underline" },
  { value: "bg-highlight", label: "Background" },
];

const DURATIONS = [0.1, 0.2, 0.3, 0.5, 1];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-2">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs transition-colors",
        active ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-surface-2 text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function AnimationPanel() {
  const project = useEditorStore((s) => s.project);
  const selectedId = useEditorStore((s) => s.selectedSubtitleId);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const setGlobalAnimation = useEditorStore((s) => s.setGlobalAnimation);
  const setSubtitleAnimationOverride = useEditorStore((s) => s.setSubtitleAnimationOverride);
  const applyAnimationToSubtitles = useEditorStore((s) => s.applyAnimationToSubtitles);
  const [scopeSelected, setScopeSelected] = useState(false);

  if (!project) return null;
  const selectedSub = project.subtitles.find((s) => s.id === selectedId);
  const editingOverride = scopeSelected && selectedSub;
  // Task 94820 (P8): same batch-aware "This caption" scope as style-panel.tsx — see that file's
  // own doc comment on the "display the focused caption, write to the whole selection" convention.
  const isBatchSelection = selectedIds.size > 1;
  const animation = editingOverride ? resolveAnimation(project, selectedSub) : project.animation;

  function patch(p: Partial<typeof animation>) {
    if (editingOverride && isBatchSelection) applyAnimationToSubtitles(Array.from(selectedIds), p);
    else if (editingOverride && selectedSub) setSubtitleAnimationOverride(selectedSub.id, p);
    else setGlobalAnimation(p);
  }

  function resetOverride() {
    if (isBatchSelection) applyAnimationToSubtitles(Array.from(selectedIds), null);
    else if (selectedSub) setSubtitleAnimationOverride(selectedSub.id, null);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {selectedSub && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3">
          <span className="text-xs text-muted">Editing:</span>
          <div className="flex items-center gap-2">
            {scopeSelected && (isBatchSelection || selectedSub.animation) && (
              <button className="text-xs text-muted-2 underline-offset-2 hover:text-danger hover:underline" onClick={resetOverride}>
                Reset
              </button>
            )}
            <div className="flex rounded-md border border-border-strong bg-surface p-0.5 text-xs">
              <button
                className={cn("rounded px-2 py-1", !scopeSelected ? "bg-accent text-white" : "text-muted")}
                onClick={() => setScopeSelected(false)}
              >
                All captions
              </button>
              <button
                className={cn("rounded px-2 py-1", scopeSelected ? "bg-accent text-white" : "text-muted")}
                onClick={() => setScopeSelected(true)}
              >
                {isBatchSelection ? `${selectedIds.size} captions` : "This caption"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Section title="Entrance animation">
        {ENTRANCE.map((e) => (
          <Chip key={e.value} active={animation.entrance === e.value} onClick={() => patch({ entrance: e.value })}>
            {e.label}
          </Chip>
        ))}
      </Section>

      <Section title="Exit animation">
        {EXIT.map((e) => (
          <Chip key={e.value} active={animation.exit === e.value || (e.value === "slide-up" && animation.exit === "slide")} onClick={() => patch({ exit: e.value })}>
            {e.label}
          </Chip>
        ))}
      </Section>

      <Section title="Word animation">
        {WORD.map((w) => (
          <Chip key={w.value} active={animation.word === w.value} onClick={() => patch({ word: w.value })}>
            {w.label}
          </Chip>
        ))}
      </Section>

      <div className="p-4">
        <Label>Animation duration</Label>
        <div className="mt-3 flex items-center gap-2">
          <Slider
            value={[animation.durationSec]}
            min={0.1}
            max={1}
            step={0.05}
            onValueChange={([v]) => patch({ durationSec: v })}
            className="flex-1"
          />
          <span className="w-12 shrink-0 text-right font-mono text-xs text-muted">{animation.durationSec.toFixed(2)}s</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {DURATIONS.map((d) => (
            <Chip key={d} active={animation.durationSec === d} onClick={() => patch({ durationSec: d })}>
              {d}s
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
