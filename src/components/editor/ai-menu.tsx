"use client";

import { useState } from "react";
import { Sparkles, Loader2, Wand2, Eraser, Scissors, MessageSquareText, Languages, FileText, Highlighter, FlaskConical, Volume1 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { api } from "@/lib/api-client";
import { LANGUAGES, TRANSLATABLE_LANGUAGES, type SupportedLanguage } from "@/types/subtitle";
import { markFillerWords } from "@/lib/subtitles/fillers";
import { toast } from "sonner";

const SILENCE_THRESHOLDS = [0.5, 1, 1.5, 2];

export function AiMenu() {
  const project = useEditorStore((s) => s.project);
  const applyTextMap = useEditorStore((s) => s.applyTextMap);
  const replaceAllSubtitles = useEditorStore((s) => s.replaceAllSubtitles);
  const setGlobalStyle = useEditorStore((s) => s.setGlobalStyle);
  const aiToolsDemo = useEditorStore((s) => s.aiToolsDemo);
  const load = useEditorStore((s) => s.load);
  const addCutRanges = useEditorStore((s) => s.addCutRanges);
  const [busy, setBusy] = useState<string | null>(null);
  const [silenceDialogOpen, setSilenceDialogOpen] = useState(false);
  const [detectingSilence, setDetectingSilence] = useState(false);

  if (!project) return null;
  const currentProject = project;
  const textPayload = currentProject.subtitles.map((s) => ({ id: s.id, text: s.text.replace(/\n/g, " ") }));

  const DEMO_NOTICE =
    "This needs a real AI connection — no OPENAI_API_KEY is configured, so it would make no actual changes. Set OPENAI_API_KEY to enable it.";

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      toast.success("Done.");
    } catch {
      // Never lose the project over a flaky AI call — nothing here has
      // mutated local state yet (fn() throws before any store write), so
      // "Retry" just re-runs the exact same action.
      toast.error("AI service temporarily unavailable.", {
        description: "Your project is unaffected — nothing was changed.",
        action: { label: "Retry", onClick: () => run(key, fn) },
      });
    } finally {
      setBusy(null);
    }
  }

  // Fix/rephrase/translate/meta all call an OpenAI chat completion server-side
  // and, with no API key configured, the server silently returns the input
  // unchanged (see lib/ai/index.ts's chatJSON fallback) — calling them in that
  // state and saying "Done." would be a straight-up lie about what happened.
  function runOrExplainDemo(key: string, fn: () => Promise<void>) {
    if (aiToolsDemo) {
      toast.info(DEMO_NOTICE);
      return;
    }
    void run(key, fn);
  }

  async function fixPunctuation() {
    const { texts } = await api.aiFixPunctuation(textPayload);
    applyTextMap(texts);
  }

  async function rephrase(mode: "shorten" | "rephrase") {
    const { texts } = await api.aiRephrase(textPayload, mode);
    applyTextMap(texts);
  }

  async function removeFillers() {
    const words = currentProject.subtitles.flatMap((s) => s.words);
    const { subtitles, removedCount } = await api.aiRemoveFillers(words, currentProject.timingRules);
    replaceAllSubtitles(subtitles);
    if (removedCount === 0) toast.info("No filler words found.");
    else toast.success(`Removed ${removedCount} filler word${removedCount === 1 ? "" : "s"}.`);
  }

  /** Same detection as the captions-only version, but ALSO turns each filler word's own timestamp into a video CutRange — see lib/timeline/edit-model.ts. The source video is never touched; the cuts only take effect in preview playback and at export. */
  async function removeFillersFromVideo() {
    const words = currentProject.subtitles.flatMap((s) => s.words);
    const marked = markFillerWords(words);
    const fillerRanges = marked.filter((w) => w.removed).map((w) => ({ start: w.start, end: w.end, reason: "filler" as const }));
    if (fillerRanges.length === 0) {
      toast.info("No filler words found.");
      return;
    }
    const { subtitles, removedCount } = await api.aiRemoveFillers(words, currentProject.timingRules);
    addCutRanges(fillerRanges);
    replaceAllSubtitles(subtitles);
    toast.success(`Cut ${removedCount} filler word${removedCount === 1 ? "" : "s"} from the video and captions.`);
  }

  async function detectAndCutSilence(minDuration: number) {
    setDetectingSilence(true);
    try {
      const { ranges } = await api.detectSilence(currentProject.id, minDuration);
      if (ranges.length === 0) {
        toast.info(`No silence longer than ${minDuration}s found.`);
        return;
      }
      addCutRanges(ranges.map((r) => ({ ...r, reason: "silence" as const })));
      toast.success(`Cut ${ranges.length} silent range${ranges.length === 1 ? "" : "s"}.`);
      setSilenceDialogOpen(false);
    } catch {
      toast.error("Couldn't analyze the audio for silence.");
    } finally {
      setDetectingSilence(false);
    }
  }

  async function translate(lang: SupportedLanguage) {
    // Project-aware endpoint: archives the current transcript as its own
    // SubtitleTrack instead of overwriting it, so switching back later (the
    // language switcher in the Settings tab) restores it losslessly.
    const { project: updated } = await api.translateProject(currentProject.id, lang);
    load(updated);
  }

  async function generateMeta() {
    const fullText = currentProject.subtitles.map((s) => s.text.replace(/\n/g, " ")).join(" ");
    const meta = await api.aiMeta(fullText);
    toast.success(meta.title, { description: meta.description });
  }

  function autoHighlight() {
    setGlobalStyle({ wordHighlight: true, highlightColor: "#FACC15", activeWordScale: 1.15 });
    toast.success("Auto highlight enabled — active words now pop in yellow.");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy !== null}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          AI
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {aiToolsDemo && (
          <>
            <div className="flex items-start gap-2 px-2 py-2 text-xs text-warning">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
              <span>Demo mode — items marked (Demo) need OPENAI_API_KEY to actually change anything.</span>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Clean up transcript</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => runOrExplainDemo("fix", fixPunctuation)}>
          <Wand2 className="size-3.5" /> Fix punctuation & grammar {aiToolsDemo && "(Demo)"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("fillers", removeFillers)}>
          <Eraser className="size-3.5" /> Remove filler words (captions only)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("fillers-video", removeFillersFromVideo)}>
          <Scissors className="size-3.5" /> Remove filler words (also cut video)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setSilenceDialogOpen(true)}>
          <Volume1 className="size-3.5" /> Remove silence…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Rewrite</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => runOrExplainDemo("shorten", () => rephrase("shorten"))}>
          <Scissors className="size-3.5" /> Shorten captions {aiToolsDemo && "(Demo)"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runOrExplainDemo("rephrase", () => rephrase("rephrase"))}>
          <MessageSquareText className="size-3.5" /> Rephrase captions {aiToolsDemo && "(Demo)"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Style</DropdownMenuLabel>
        <DropdownMenuItem onSelect={autoHighlight}>
          <Highlighter className="size-3.5" /> Auto highlight
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Translate {aiToolsDemo && "(Demo)"}</DropdownMenuLabel>
        {LANGUAGES.filter((l) => l.code !== currentProject.language && (TRANSLATABLE_LANGUAGES as readonly string[]).includes(l.code)).map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => runOrExplainDemo(`translate-${l.code}`, () => translate(l.code))}>
            <Languages className="size-3.5" /> {l.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => runOrExplainDemo("meta", generateMeta)}>
          <FileText className="size-3.5" /> Generate title & description {aiToolsDemo && "(Demo)"}
        </DropdownMenuItem>
      </DropdownMenuContent>

      <Dialog open={silenceDialogOpen} onOpenChange={setSilenceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove silence</DialogTitle>
            <DialogDescription>
              Cuts stretches of silence at least this long from the video (and shifts captions to close the gaps). The original video is never modified — revert anytime from the timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {SILENCE_THRESHOLDS.map((t) => (
              <Button key={t} variant="outline" disabled={detectingSilence} onClick={() => detectAndCutSilence(t)}>
                {detectingSilence && <Loader2 className="size-3.5 animate-spin" />}
                {t}s+
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSilenceDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DropdownMenu>
  );
}
