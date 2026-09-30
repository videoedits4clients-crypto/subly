"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BUILT_IN_PRESETS } from "@/lib/presets";
import { slugFont } from "@/lib/fonts";
import { api } from "@/lib/api-client";
import type { AspectRatio } from "@/types/subtitle";
import { toast } from "sonner";

const PROJECT_TEMPLATES: { id: string; name: string; description: string; aspectRatio: AspectRatio; presetId: string }[] = [
  { id: "reels", name: "Reels template", description: "Vertical, bold word highlighting — ready for Instagram.", aspectRatio: "9:16", presetId: "reels" },
  { id: "podcast", name: "Podcast template", description: "Understated captions for long-form talking-head video.", aspectRatio: "16:9", presetId: "podcast" },
  { id: "gaming", name: "Gaming template", description: "Neon highlight with aggressive scale-pop for clips.", aspectRatio: "9:16", presetId: "gaming" },
  { id: "educational", name: "Educational template", description: "Clean, readable captions for tutorials and explainers.", aspectRatio: "16:9", presetId: "clean" },
];

export default function TemplatesPage() {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function applyTemplate(tpl: (typeof PROJECT_TEMPLATES)[number]) {
    setLoadingId(tpl.id);
    try {
      const { id } = await api.createProject({ name: tpl.name, aspectRatio: tpl.aspectRatio, presetId: tpl.presetId });
      router.push(`/projects/${id}/upload`);
    } catch {
      toast.error("Couldn't create a project from this template.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Templates</h1>
      <p className="mt-1 text-sm text-muted">Start a new project pre-configured with a caption style and aspect ratio.</p>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PROJECT_TEMPLATES.map((tpl) => {
          const preset = BUILT_IN_PRESETS.find((p) => p.id === tpl.presetId)!;
          return (
            <Card key={tpl.id} className="overflow-hidden">
              <div className="flex aspect-4/5 items-center justify-center bg-gradient-to-br from-surface-2 to-surface-3 p-6">
                <p
                  className="text-center leading-tight"
                  style={{
                    fontFamily: `var(--font-${slugFont(preset.style.fontFamily)})`,
                    fontWeight: preset.style.fontWeight,
                    fontSize: "1.5rem",
                    color: preset.style.color,
                    textTransform: preset.style.textCase === "uppercase" ? "uppercase" : "none",
                  }}
                >
                  <span style={{ color: preset.style.highlightColor }}>Sample</span> caption
                </p>
              </div>
              <div className="p-4">
                <h3 className="text-sm font-semibold">{tpl.name}</h3>
                <p className="mt-1 text-xs text-muted">{tpl.description}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  disabled={loadingId === tpl.id}
                  onClick={() => applyTemplate(tpl)}
                >
                  {loadingId === tpl.id && <Loader2 className="size-3.5 animate-spin" />}
                  Use template
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
