"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/ui/color-picker";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { CaptionsPanel } from "./captions-panel";
import { LanguageSwitcher } from "./language-switcher";
import { HinglishToggle } from "./hinglish-toggle";
import { QualityPanelDialog } from "./quality-panel-dialog";
import { useEditorStore } from "@/store/editor-store";
import { MAX_WORDS_PER_CAPTION_OPTIONS, ASPECT_RATIO_DIMS, type AspectRatio } from "@/types/subtitle";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CANVAS_PRESETS = Object.entries(ASPECT_RATIO_DIMS) as [AspectRatio, { w: number; h: number }][];

export function LeftPanel() {
  const project = useEditorStore((s) => s.project);
  const setTimingRules = useEditorStore((s) => s.setTimingRules);
  const setComposition = useEditorStore((s) => s.setComposition);
  const resegmentAll = useEditorStore((s) => s.resegmentAll);
  const [qualityOpen, setQualityOpen] = useState(false);
  // Controlled (not defaultValue) so the quality panel's "Go to caption" can switch here to
  // "captions" itself — the captions list only renders while this tab is active (Radix Tabs
  // unmounts inactive TabsContent), so without this, selecting a caption from the quality
  // dialog (which lives inside the "settings" tab tree) would update the underlying store state
  // correctly but have nowhere visible to show the highlight/scroll until the user manually
  // switched tabs. The timeline (a sibling of this whole panel, not inside these tabs) already
  // shows the selection regardless — this only fixes the captions LIST specifically.
  const [activeTab, setActiveTab] = useState("captions");

  return (
    <div className="flex h-full w-full flex-col bg-surface lg:border-r lg:border-border">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
        <div className="border-b border-border p-2">
          <TabsList className="w-full">
            <TabsTrigger value="captions" className="flex-1">
              Captions
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="captions" className="min-h-0 flex-1 overflow-hidden">
          <CaptionsPanel />
        </TabsContent>
        <TabsContent value="settings" className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {project && (
            <>
              <div>
                <Label>Canvas</Label>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {CANVAS_PRESETS.map(([ratio, dims]) => {
                    const active = project.composition.canvasWidth === dims.w && project.composition.canvasHeight === dims.h;
                    return (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setComposition({ canvasWidth: dims.w, canvasHeight: dims.h })}
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                          active ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-surface-2 text-muted hover:text-foreground",
                        )}
                      >
                        {ratio}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    min={2}
                    max={7680}
                    value={project.composition.canvasWidth}
                    onChange={(e) => setComposition({ canvasWidth: Math.max(2, Math.round(Number(e.target.value) || 2)) })}
                    className="h-8"
                  />
                  <span className="text-xs text-muted-2">×</span>
                  <Input
                    type="number"
                    min={2}
                    max={7680}
                    value={project.composition.canvasHeight}
                    onChange={(e) => setComposition({ canvasHeight: Math.max(2, Math.round(Number(e.target.value) || 2)) })}
                    className="h-8"
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-2">
                  {CANVAS_PRESETS.find(([, d]) => d.w === project.composition.canvasWidth && d.h === project.composition.canvasHeight)?.[0] ??
                    "Custom"}{" "}
                  · {project.composition.canvasWidth} × {project.composition.canvasHeight}
                </p>
              </div>

              <div>
                <Label>Background</Label>
                <div className="mt-2">
                  <ColorPicker
                    value={project.composition.backgroundColor}
                    onChange={(v) => setComposition({ backgroundColor: v })}
                  />
                </div>
              </div>

              <div>
                <Label>Layers</Label>
                <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2 p-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">Video</span>
                    <Switch
                      checked={project.composition.videoVisible}
                      onCheckedChange={(v) => setComposition({ videoVisible: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted">Captions</span>
                    <span className="text-xs text-muted-2">Always on</span>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted-2">
                  Turning Video off doesn&apos;t delete the source file — it&apos;s a composition/export choice. Captions stay independent
                  either way.
                </p>
              </div>

              <div>
                <Label>Language</Label>
                <div className="mt-2">
                  <LanguageSwitcher />
                </div>
              </div>

              <div>
                <HinglishToggle />
              </div>

              <div>
                <Label>Max characters per line</Label>
                <div className="mt-2 flex items-center gap-2">
                  <Slider
                    value={[project.timingRules.maxCharsPerLine]}
                    min={20}
                    max={60}
                    step={1}
                    onValueChange={([v]) => setTimingRules({ maxCharsPerLine: v })}
                    className="flex-1"
                  />
                  <span className="w-8 text-right font-mono text-xs">{project.timingRules.maxCharsPerLine}</span>
                </div>
              </div>

              <div>
                <Label>Max lines</Label>
                <Select
                  value={String(project.timingRules.maxLines)}
                  onValueChange={(v) => setTimingRules({ maxLines: Number(v) })}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 line</SelectItem>
                    <SelectItem value="2">2 lines</SelectItem>
                    <SelectItem value="3">3 lines</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Maximum words per caption</Label>
                <Select
                  value={String(project.timingRules.maxWordsPerCaption)}
                  onValueChange={(v) => setTimingRules({ maxWordsPerCaption: Number(v) })}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAX_WORDS_PER_CAPTION_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} words
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="cursor-default">Smart Segmentation</Label>
                  <p className="text-xs text-muted-2">Split at natural speech and sentence boundaries.</p>
                </div>
                <Switch
                  checked={project.timingRules.smartSegmentation}
                  onCheckedChange={(v) => setTimingRules({ smartSegmentation: v })}
                />
              </div>

              <div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    resegmentAll();
                    toast.success("Captions re-segmented from the original word timestamps.");
                  }}
                >
                  Re-segment captions
                </Button>
                <p className="mt-1.5 text-xs text-muted-2">
                  Rebuilds captions from the settings above without re-running transcription. Per-caption style overrides and manual edits
                  to caption boundaries are rebuilt from scratch — undo if you didn&apos;t mean to.
                </p>
              </div>

              <div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setQualityOpen(true)}>
                  <ShieldCheck className="size-3.5" /> Subtitle quality
                </Button>
                <p className="mt-1.5 text-xs text-muted-2">
                  Check every caption for overlaps, invalid timing, and readability problems (too fast, too many words,
                  poor line breaks), with safe automatic fixes where the correction is unambiguous.
                </p>
              </div>

              <div>
                <Label>Minimum duration</Label>
                <div className="mt-2 flex items-center gap-2">
                  <Slider
                    value={[project.timingRules.minDuration]}
                    min={0.3}
                    max={2}
                    step={0.1}
                    onValueChange={([v]) => setTimingRules({ minDuration: v })}
                    className="flex-1"
                  />
                  <span className="w-8 text-right font-mono text-xs">{project.timingRules.minDuration.toFixed(1)}s</span>
                </div>
              </div>

              <div>
                <Label>Maximum duration</Label>
                <div className="mt-2 flex items-center gap-2">
                  <Slider
                    value={[project.timingRules.maxDuration]}
                    min={2}
                    max={10}
                    step={0.5}
                    onValueChange={([v]) => setTimingRules({ maxDuration: v })}
                    className="flex-1"
                  />
                  <span className="w-8 text-right font-mono text-xs">{project.timingRules.maxDuration.toFixed(1)}s</span>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
      <QualityPanelDialog open={qualityOpen} onOpenChange={setQualityOpen} onNavigateToCaption={() => setActiveTab("captions")} />
    </div>
  );
}
