"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { resolveStyle } from "@/types/subtitle";
import type { SubtitleStyle, HAlign, VAlign, TextCase } from "@/types/subtitle";
import { isWordStylePropertyOverridden, mergeWordStyleOverride } from "@/lib/subtitles/word-style-capabilities";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FontPicker } from "./font-picker";
import { FONT_REGISTRY } from "@/lib/fonts";
import { useSystemFonts } from "@/hooks/use-system-fonts";
import { AlignLeft, AlignCenter, AlignRight, ArrowUp, Minus, ArrowDown, Copy, ClipboardPaste, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Collapsible sections (section 8 of the desktop UX pass) — too many controls
// exposed continuously was the complaint; collapsing everything but Font by
// default keeps the panel scannable while still reaching advanced controls in
// one click. Remembered per browser via localStorage, not project data (it's
// a personal editing-panel preference, not something that should sync/export).
const SECTION_STATE_KEY = "subly:style-panel-sections";
const DEFAULT_OPEN = new Set(["Font"]);

function readSectionState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTION_STATE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => readSectionState()[title] ?? DEFAULT_OPEN.has(title));

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      const state = readSectionState();
      state[title] = next;
      localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(state));
    } catch {
      // best-effort — a lost preference isn't worth failing over
    }
  }

  return (
    <div className="border-b border-border">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-2 hover:text-foreground"
        aria-expanded={open}
      >
        {title}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="shrink-0">{label}</Label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumberSlider({ value, onChange, min, max, step = 1, suffix = "" }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <span className="w-12 shrink-0 text-right font-mono text-xs text-muted">
        {value}
        {suffix}
      </span>
    </div>
  );
}

/** Available weights for a font, whichever source it came from — the bundled registry's
 * own list, or the distinct weights this Windows system font's installed files actually
 * provide. Falls back to a generic list so the Weight select never ends up empty for a
 * font we don't have weight data for (e.g. one that's gone missing). */
function weightsForFamily(systemFamilies: { name: string; faces: { weight: number; italic: boolean }[] }[], fontFamily: string): number[] {
  const bundled = FONT_REGISTRY.find((f) => f.name === fontFamily)?.weights;
  if (bundled) return bundled;
  const system = systemFamilies.find((f) => f.name === fontFamily);
  if (system) {
    const nonItalic = system.faces.filter((f) => !f.italic);
    const weights = Array.from(new Set((nonItalic.length ? nonItalic : system.faces).map((f) => f.weight))).sort((a, b) => a - b);
    if (weights.length) return weights;
  }
  return [400, 500, 600, 700, 800, 900];
}

export function StylePanel() {
  const project = useEditorStore((s) => s.project);
  const selectedId = useEditorStore((s) => s.selectedSubtitleId);
  const selectedIds = useEditorStore((s) => s.selectedSubtitleIds);
  const setGlobalStyle = useEditorStore((s) => s.setGlobalStyle);
  const setSubtitleStyleOverride = useEditorStore((s) => s.setSubtitleStyleOverride);
  const applyStyleToSubtitles = useEditorStore((s) => s.applyStyleToSubtitles);
  const setWordStyleOverride = useEditorStore((s) => s.setWordStyleOverride);
  const copyStyle = useEditorStore((s) => s.copyStyle);
  const pasteStyle = useEditorStore((s) => s.pasteStyle);
  const [scopeSelected, setScopeSelected] = useState(false);
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null);
  const { families: systemFamilies } = useSystemFonts();

  if (!project) return null;
  const selectedSub = project.subtitles.find((s) => s.id === selectedId);
  const editingOverride = scopeSelected && selectedSub;
  // Task 94820 (P8): "This caption" becomes a BATCH edit once more than one caption is selected —
  // same scope toggle, same patch() call sites, just fanned out to applyStyleToSubtitles for the
  // whole selectedSubtitleIds set in one commit instead of setSubtitleStyleOverride for one id.
  // Displayed values still come from the FOCUSED caption alone (selectedSub/resolveStyle below) —
  // reading N possibly-different resolved styles and reconciling them has no single right answer,
  // so this panel shows "what the focused caption looks like" while writes apply to everyone
  // selected, the same convention most batch-editing tools use for a multi-value property panel.
  const isBatchSelection = selectedIds.size > 1;

  const style = editingOverride ? resolveStyle(project, selectedSub) : project.globalStyle;

  function patch(p: Partial<SubtitleStyle>) {
    if (editingOverride && isBatchSelection) applyStyleToSubtitles(Array.from(selectedIds), p);
    else if (editingOverride && selectedSub) setSubtitleStyleOverride(selectedSub.id, p);
    else setGlobalStyle(p);
  }

  function onCopyStyle() {
    copyStyle(editingOverride && selectedSub ? selectedSub.id : undefined);
    toast.success("Style copied.");
  }

  function onPasteStyle(target: "this" | "all") {
    const ok = pasteStyle(target === "this" && selectedSub ? { subtitleId: selectedSub.id } : { all: true });
    toast[ok ? "success" : "error"](ok ? "Style pasted." : "Nothing copied yet.");
  }

  function onResetOverride() {
    if (!selectedSub) return;
    if (isBatchSelection) {
      applyStyleToSubtitles(Array.from(selectedIds), null);
      toast.success(`${selectedIds.size} captions' style reset to the global style.`);
      return;
    }
    setSubtitleStyleOverride(selectedSub.id, null);
    toast.success("Caption style reset to the global style.");
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCopyStyle}>
          <Copy className="size-3.5" /> Copy style
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onPasteStyle(editingOverride ? "this" : "all")}>
          <ClipboardPaste className="size-3.5" /> Paste style
        </Button>
      </div>

      {selectedSub && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3">
          <span className="text-xs text-muted">Editing:</span>
          <div className="flex items-center gap-2">
            {scopeSelected && (isBatchSelection || selectedSub.style) && (
              <button className="text-xs text-muted-2 underline-offset-2 hover:text-danger hover:underline" onClick={onResetOverride}>
                Reset
              </button>
            )}
            <div className="flex rounded-md border border-border-strong bg-surface p-0.5 text-xs">
              <button
                className={cn("rounded px-2 py-1", !scopeSelected ? "bg-accent text-white" : "text-muted")}
                onClick={() => {
                  setScopeSelected(false);
                  setSelectedWordIndex(null);
                }}
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

      {editingOverride && selectedSub && !isBatchSelection && (
        <Section title="Word overrides">
          <div className="flex flex-wrap gap-1.5">
            {selectedSub.words.map((w, i) => (
              <button
                key={i}
                onClick={() => setSelectedWordIndex(selectedWordIndex === i ? null : i)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  selectedWordIndex === i ? "border-accent bg-accent-soft text-accent" : "border-border-strong bg-surface-2 text-muted hover:text-foreground",
                  w.style && "underline decoration-accent decoration-2 underline-offset-2",
                )}
              >
                {w.text}
              </button>
            ))}
          </div>
          {selectedWordIndex !== null && (
            <div className="space-y-3 rounded-lg border border-border-strong bg-surface-2 p-3">
              <Row label="Color">
                <ColorPicker
                  value={selectedSub.words[selectedWordIndex].style?.color ?? style.color}
                  onChange={(v) => setWordStyleOverride(selectedSub.id, selectedWordIndex, { color: v })}
                />
              </Row>
              <Row label="Size">
                <NumberSlider
                  value={selectedSub.words[selectedWordIndex].style?.fontSize ?? style.fontSize}
                  onChange={(v) => setWordStyleOverride(selectedSub.id, selectedWordIndex, { fontSize: v })}
                  min={20}
                  max={160}
                  suffix="px"
                />
              </Row>
              <Row label="Background">
                <ColorPicker
                  value={selectedSub.words[selectedWordIndex].style?.backgroundColor ?? "#000000"}
                  onChange={(v) => setWordStyleOverride(selectedSub.id, selectedWordIndex, { backgroundColor: v, backgroundOpacity: 0.8 })}
                />
              </Row>
              <Row label="Letter spacing">
                <div className="flex items-center gap-1.5">
                  <NumberSlider
                    value={selectedSub.words[selectedWordIndex].style?.letterSpacing ?? style.letterSpacing}
                    onChange={(v) => setWordStyleOverride(selectedSub.id, selectedWordIndex, { letterSpacing: v })}
                    min={-2}
                    max={12}
                    step={0.5}
                    suffix="px"
                  />
                  {isWordStylePropertyOverridden(selectedSub.words[selectedWordIndex].style, "letterSpacing") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] text-muted-2"
                      onClick={() =>
                        setWordStyleOverride(
                          selectedSub.id,
                          selectedWordIndex,
                          mergeWordStyleOverride(selectedSub.words[selectedWordIndex].style, { letterSpacing: undefined }),
                        )
                      }
                      title="Remove this word's letter-spacing override — follow the caption style again"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </Row>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-danger"
                onClick={() => setWordStyleOverride(selectedSub.id, selectedWordIndex, null)}
              >
                Clear override
              </Button>
            </div>
          )}
        </Section>
      )}

      <Section title="Font">
        <Row label="Family">
          <FontPicker
            value={style.fontFamily}
            fontSource={style.fontSource}
            onChange={(v, source) => {
              // Switching to a font that doesn't publish the current weight (e.g.
              // Anton only ships 400, or a system font installed as Regular-only) left
              // the Weight dropdown showing blank — found by actually testing this
              // exact switch — so clamp to the nearest weight the new font really has,
              // same as the export-side font cache already does for the fetched file.
              const weights = weightsForFamily(systemFamilies, v);
              const fontWeight = weights.includes(style.fontWeight)
                ? style.fontWeight
                : (weights.reduce((best, w) => (Math.abs(w - style.fontWeight) < Math.abs(best - style.fontWeight) ? w : best), weights[0]) as SubtitleStyle["fontWeight"]);
              patch({ fontFamily: v, fontSource: source, fontWeight });
            }}
          />
        </Row>
        <Row label="Size">
          <NumberSlider value={style.fontSize} onChange={(v) => patch({ fontSize: v })} min={20} max={140} suffix="px" />
        </Row>
        <Row label="Weight">
          <Select value={String(style.fontWeight)} onValueChange={(v) => patch({ fontWeight: Number(v) as SubtitleStyle["fontWeight"] })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weightsForFamily(systemFamilies, style.fontFamily).map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Letter spacing">
          <NumberSlider value={style.letterSpacing} onChange={(v) => patch({ letterSpacing: v })} min={-2} max={12} step={0.5} suffix="px" />
        </Row>
        <Row label="Line height">
          <NumberSlider value={style.lineHeight} onChange={(v) => patch({ lineHeight: v })} min={0.9} max={2} step={0.05} />
        </Row>
        <Row label="Case">
          <Select value={style.textCase} onValueChange={(v) => patch({ textCase: v as TextCase })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Normal</SelectItem>
              <SelectItem value="uppercase">UPPERCASE</SelectItem>
              <SelectItem value="lowercase">lowercase</SelectItem>
              <SelectItem value="sentence">Sentence case</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section title="Colors">
        <Row label="Text color">
          <ColorPicker value={style.color} onChange={(v) => patch({ color: v })} />
        </Row>
        <Row label="Highlight color">
          <ColorPicker value={style.highlightColor} onChange={(v) => patch({ highlightColor: v })} />
        </Row>
        <Row label="Opacity">
          <NumberSlider value={Math.round(style.opacity * 100)} onChange={(v) => patch({ opacity: v / 100 })} min={0} max={100} suffix="%" />
        </Row>
      </Section>

      <Section title="Word highlight">
        <Row label="Enable">
          <Switch checked={style.wordHighlight} onCheckedChange={(v) => patch({ wordHighlight: v })} />
        </Row>
        {style.wordHighlight && (
          <Row label="Active word scale">
            <NumberSlider value={Math.round(style.activeWordScale * 100)} onChange={(v) => patch({ activeWordScale: v / 100 })} min={100} max={160} suffix="%" />
          </Row>
        )}
      </Section>

      <Section title="Background">
        <Row label="Color">
          <ColorPicker value={style.backgroundColor} onChange={(v) => patch({ backgroundColor: v })} />
        </Row>
        <Row label="Opacity">
          <NumberSlider value={Math.round(style.backgroundOpacity * 100)} onChange={(v) => patch({ backgroundOpacity: v / 100 })} min={0} max={100} suffix="%" />
        </Row>
        <Row label="Rounded corners">
          <NumberSlider value={style.backgroundRadius} onChange={(v) => patch({ backgroundRadius: v })} min={0} max={48} suffix="px" />
        </Row>
        <Row label="Padding X">
          <NumberSlider value={style.backgroundPaddingX} onChange={(v) => patch({ backgroundPaddingX: v })} min={0} max={60} suffix="px" />
        </Row>
        <Row label="Padding Y">
          <NumberSlider value={style.backgroundPaddingY} onChange={(v) => patch({ backgroundPaddingY: v })} min={0} max={60} suffix="px" />
        </Row>
        <Row label="Box width">
          <NumberSlider value={style.boxWidthPercent} onChange={(v) => patch({ boxWidthPercent: v })} min={30} max={100} suffix="%" />
        </Row>
      </Section>

      <Section title="Outline">
        <Row label="Enabled">
          <Switch checked={style.outlineEnabled} onCheckedChange={(v) => patch({ outlineEnabled: v })} />
        </Row>
        {style.outlineEnabled && (
          <>
            <Row label="Color">
              <ColorPicker value={style.outlineColor} onChange={(v) => patch({ outlineColor: v })} />
            </Row>
            <Row label="Width">
              <NumberSlider value={style.outlineWidth} onChange={(v) => patch({ outlineWidth: v })} min={1} max={16} suffix="px" />
            </Row>
          </>
        )}
      </Section>

      <Section title="Shadow">
        <Row label="Enabled">
          <Switch checked={style.shadowEnabled} onCheckedChange={(v) => patch({ shadowEnabled: v })} />
        </Row>
        {style.shadowEnabled && (
          <>
            <Row label="Color">
              <ColorPicker value={style.shadowColor} onChange={(v) => patch({ shadowColor: v })} />
            </Row>
            <Row label="Blur">
              <NumberSlider value={style.shadowBlur} onChange={(v) => patch({ shadowBlur: v })} min={0} max={40} suffix="px" />
            </Row>
            <Row label="Offset X">
              <NumberSlider value={style.shadowOffsetX} onChange={(v) => patch({ shadowOffsetX: v })} min={-20} max={20} suffix="px" />
            </Row>
            <Row label="Offset Y">
              <NumberSlider value={style.shadowOffsetY} onChange={(v) => patch({ shadowOffsetY: v })} min={-20} max={20} suffix="px" />
            </Row>
            <Row label="Opacity">
              <NumberSlider value={Math.round(style.shadowOpacity * 100)} onChange={(v) => patch({ shadowOpacity: v / 100 })} min={0} max={100} suffix="%" />
            </Row>
          </>
        )}
      </Section>

      <Section title="Position">
        <Row label="Horizontal">
          <NumberSlider value={style.x} onChange={(v) => patch({ x: v })} min={0} max={100} suffix="%" />
        </Row>
        <Row label="Vertical">
          <NumberSlider value={style.y} onChange={(v) => patch({ y: v })} min={0} max={100} suffix="%" />
        </Row>
        <Row label="Align">
          <div className="flex gap-1">
            {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as [HAlign, typeof AlignLeft][]).map(([val, Icon]) => (
              <Button
                key={val}
                variant={style.align === val ? "accent" : "outline"}
                size="icon-sm"
                onClick={() => patch({ align: val })}
                title={`Align ${val}`}
              >
                <Icon className="size-3.5" />
              </Button>
            ))}
          </div>
        </Row>
        <Row label="Preset">
          <div className="flex gap-1">
            {([["top", ArrowUp, 12], ["center", Minus, 50], ["bottom", ArrowDown, 82]] as [VAlign, typeof ArrowUp, number][]).map(([val, Icon, y]) => (
              <Button
                key={val}
                variant={style.vAlign === val ? "accent" : "outline"}
                size="icon-sm"
                onClick={() => patch({ vAlign: val, y })}
                title={val === "top" ? "Top" : val === "bottom" ? "Bottom" : "Vertical center"}
              >
                <Icon className="size-3.5" />
              </Button>
            ))}
          </div>
        </Row>
      </Section>
    </div>
  );
}
