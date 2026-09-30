"use client";

import { useEditorStore } from "@/store/editor-store";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { projectHasDevanagari, projectSupportsGujaratiScript } from "@/lib/subtitles/output-mode";
import type { CaptionOutputMode } from "@/types/subtitle";

/** Lets the user switch a Hindi project's captions between the original Devanagari
 * transcript and a Romanized ("Hinglish") rendering — see lib/subtitles/hinglish.ts
 * and lib/subtitles/output-mode.ts. Only shown when the transcript actually contains
 * Devanagari text, so it doesn't clutter Settings for every other project. Purely a
 * display/export toggle: switching it never touches the original transcript, and
 * switching back loses nothing.
 *
 * A Gujarati-language project gets a third option — "Gujarati Script" (native Gujarati
 * Unicode rendering of the Devanagari Whisper output, see lib/subtitles/gujarati-script.ts)
 * — so it needs a 3-way picker instead of a boolean switch; every other project keeps the
 * exact same two-state Switch as before. */
export function HinglishToggle() {
  const project = useEditorStore((s) => s.project);
  const setCaptionOutputMode = useEditorStore((s) => s.setCaptionOutputMode);

  if (!project) return null;
  const hasHinglish = projectHasDevanagari(project.subtitles);
  const hasGujaratiScript = projectSupportsGujaratiScript(project);
  if (!hasHinglish && !hasGujaratiScript) return null;

  if (hasGujaratiScript) {
    const mode = project.captionOutputMode;
    return (
      <div className="flex items-center justify-between gap-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Label className="cursor-default">Caption text</Label>
            </TooltipTrigger>
            <TooltipContent>Choose what script/rendering captions display and export as</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Select value={mode} onValueChange={(v) => setCaptionOutputMode(v as CaptionOutputMode)}>
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="original">Original</SelectItem>
            <SelectItem value="gujarati-script">Gujarati Script</SelectItem>
            {hasHinglish && <SelectItem value="hinglish">Hinglish</SelectItem>}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const enabled = project.captionOutputMode === "hinglish";

  return (
    <div className="flex items-center justify-between gap-3">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Label className="cursor-default">Hinglish</Label>
          </TooltipTrigger>
          <TooltipContent>Convert Hindi captions to Roman script</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Switch checked={enabled} onCheckedChange={(v) => setCaptionOutputMode(v ? "hinglish" : "original")} />
    </div>
  );
}
