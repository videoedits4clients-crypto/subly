"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useEditorStore } from "@/store/editor-store";
import { getPreset } from "@/lib/presets";
import { DEFAULT_SUBTITLE_STYLE } from "@/types/subtitle";

// Curated subset of BUILT_IN_PRESETS surfaced as one-click recommendations
// right when a project is fresh — spec's "upload a video, immediately see
// recommended styles" flow. Emoji labels per spec section "CRITICAL PRODUCT
// FEATURE — ONE CLICK STYLE".
const RECOMMENDATIONS = [
  { emoji: "🔥", label: "Bold Viral", presetId: "mrbeast" },
  { emoji: "🎤", label: "Podcast", presetId: "podcast" },
  { emoji: "✨", label: "Clean", presetId: "clean" },
  { emoji: "⚡", label: "Dynamic", presetId: "tiktok" },
  { emoji: "🎬", label: "Cinematic", presetId: "elegant" },
];

function isDefaultStyle(style: unknown): boolean {
  return JSON.stringify(style) === JSON.stringify(DEFAULT_SUBTITLE_STYLE);
}

/** Shown once, over the video canvas, only while the project still has the untouched default style — disappears the moment the user picks anything (a recommendation here, or any preset/manual style edit elsewhere). */
export function RecommendedStyles() {
  const project = useEditorStore((s) => s.project);
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const [dismissed, setDismissed] = useState(false);

  if (!project || dismissed || !isDefaultStyle(project.globalStyle)) return null;

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-30 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">Recommended styles</p>
        <button onClick={() => setDismissed(true)} className="rounded p-0.5 text-muted-2 hover:text-foreground" aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {RECOMMENDATIONS.map((r) => (
          <button
            key={r.presetId}
            onClick={() => {
              const preset = getPreset(r.presetId);
              if (preset) applyPreset(preset.style, preset.animation);
              setDismissed(true);
            }}
            className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <span>{r.emoji}</span> {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
