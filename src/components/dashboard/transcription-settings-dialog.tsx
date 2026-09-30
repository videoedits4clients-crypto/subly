"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  MAX_WORDS_PER_CAPTION_OPTIONS,
  SEGMENTATION_PRESETS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLanguage,
} from "@/types/subtitle";
import { cn } from "@/lib/utils";

export interface TranscriptionSettings {
  language: SupportedLanguage;
  maxWordsPerCaption: number;
  linesPerCaption: 1 | 2;
  smartSegmentation: boolean;
}

const DEFAULT_SETTINGS: TranscriptionSettings = {
  language: "auto",
  maxWordsPerCaption: 4,
  linesPerCaption: 2,
  smartSegmentation: true,
};

/** Shown after a video is selected but BEFORE local Whisper transcription starts (see
 * app/projects/[id]/upload/page.tsx) — transcription never begins until this is confirmed.
 * Language only affects what SUBLY asks the local Whisper worker to transcribe; max
 * words/lines/smart segmentation only affect how the resulting word-level transcript gets
 * grouped into captions afterward (lib/subtitles/segment.ts) — changing those later never
 * requires re-running Whisper (see editor-store.ts resegmentAll). */
export function TranscriptionSettingsDialog({
  open,
  onOpenChange,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (settings: TranscriptionSettings) => void;
  confirming?: boolean;
}) {
  const [settings, setSettings] = useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  const [activePreset, setActivePreset] = useState<string | null>("social");
  const [customWords, setCustomWords] = useState(false);

  function applyPreset(id: string) {
    const preset = SEGMENTATION_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setActivePreset(id);
    setCustomWords(!MAX_WORDS_PER_CAPTION_OPTIONS.includes(preset.patch.maxWordsPerCaption as (typeof MAX_WORDS_PER_CAPTION_OPTIONS)[number]));
    setSettings((s) => ({ ...s, ...preset.patch }));
  }

  function patch(p: Partial<TranscriptionSettings>) {
    setActivePreset(null);
    setSettings((s) => ({ ...s, ...p }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transcription settings</DialogTitle>
          <DialogDescription>Choose how SUBLY should generate your captions.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Presets</Label>
            <div className="grid grid-cols-4 gap-2">
              {SEGMENTATION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  title={p.description}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors",
                    activePreset === p.id ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-surface-2 hover:bg-surface-3",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={settings.language} onValueChange={(v) => patch({ language: v as SupportedLanguage })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSCRIPTION_LANGUAGE_OPTIONS.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-2">
              {settings.language === "auto"
                ? "Whisper detects the spoken language automatically."
                : "Whisper transcribes directly in this language (no translation)."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Maximum words per caption</Label>
            <div className="flex flex-wrap gap-1.5">
              {MAX_WORDS_PER_CAPTION_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setCustomWords(false);
                    patch({ maxWordsPerCaption: n });
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    !customWords && settings.maxWordsPerCaption === n
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border-strong bg-surface-2 hover:bg-surface-3",
                  )}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomWords(true)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  customWords ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-surface-2 hover:bg-surface-3",
                )}
              >
                Custom
              </button>
              {customWords && (
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.maxWordsPerCaption}
                  onChange={(e) => patch({ maxWordsPerCaption: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                  className="w-16"
                />
              )}
            </div>
            <p className="text-xs text-muted-2">A hard upper bound — SUBLY still prefers a natural pause or sentence end below this.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Lines per caption</Label>
            <Select value={String(settings.linesPerCaption)} onValueChange={(v) => patch({ linesPerCaption: Number(v) as 1 | 2 })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 line</SelectItem>
                <SelectItem value="2">2 lines</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="cursor-default">Smart Segmentation</Label>
              <p className="text-xs text-muted-2">Automatically split captions at natural speech and sentence boundaries.</p>
            </div>
            <Switch checked={settings.smartSegmentation} onCheckedChange={(v) => patch({ smartSegmentation: v })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => onConfirm(settings)} disabled={confirming}>
            {confirming && <Loader2 className="size-4 animate-spin" />}
            Start transcription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
