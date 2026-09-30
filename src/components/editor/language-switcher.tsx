"use client";

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { useEditorStore } from "@/store/editor-store";
import { api } from "@/lib/api-client";
import { LANGUAGES } from "@/types/subtitle";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TrackInfo {
  language: string;
  label: string;
  subtitleCount: number;
  isActive: boolean;
}

/** Lists every saved language version of this project (see SubtitleTrack) and lets the user switch between them without re-translating or losing any version. */
export function LanguageSwitcher() {
  const project = useEditorStore((s) => s.project);
  const load = useEditorStore((s) => s.load);
  const [tracks, setTracks] = useState<TrackInfo[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    api.listTracks(project.id).then(setTracks).catch(() => setTracks([]));
    // Only re-fetch when the project identity or its language changes (a
    // successful translate/switch already updates project.language), not on
    // every unrelated store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.language]);

  if (!project) return null;
  const currentLabel = LANGUAGES.find((l) => l.code === project.language)?.label ?? project.language;

  async function switchTo(language: string) {
    if (language === project?.language || !project) return;
    setSwitching(language);
    try {
      const updated = await api.switchTrack(project.id, language);
      load(updated);
    } catch {
      toast.error("Couldn't switch language version.");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div>
      <p className="text-sm font-medium">{currentLabel}</p>
      {tracks && tracks.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tracks.map((t) => {
            const label = LANGUAGES.find((l) => l.code === t.language)?.label ?? t.label;
            return (
              <button
                key={t.language}
                onClick={() => switchTo(t.language)}
                disabled={switching !== null}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  t.isActive ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-surface-2 text-muted hover:text-foreground",
                )}
              >
                {switching === t.language ? <Loader2 className="size-3 animate-spin" /> : t.isActive ? <Check className="size-3" /> : null}
                {label}
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-1 text-xs text-muted-2">
        {tracks && tracks.length > 1
          ? "Every translated version is saved — switch anytime without losing one."
          : "Use the Translate tool (AI menu) to add another language."}
      </p>
    </div>
  );
}
