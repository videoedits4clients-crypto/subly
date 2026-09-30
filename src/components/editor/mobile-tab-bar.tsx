"use client";

import { Captions, Paintbrush, Sparkles as SparklesIcon, ListVideo } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileTab = "captions" | "style" | "animation" | "timeline";

const TABS: { key: MobileTab; label: string; icon: typeof Captions }[] = [
  { key: "captions", label: "Captions", icon: Captions },
  { key: "style", label: "Style", icon: Paintbrush },
  { key: "animation", label: "Animate", icon: SparklesIcon },
  { key: "timeline", label: "Timeline", icon: ListVideo },
];

/** Bottom tab bar for the mobile editor layout (spec §34: Video → Subtitle → Style → Timeline). Desktop hides this entirely — the 3-pane layout shows everything at once. */
export function MobileTabBar({ active, onChange }: { active: MobileTab; onChange: (tab: MobileTab) => void }) {
  return (
    <div className="flex shrink-0 border-t border-border bg-surface lg:hidden">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors",
            active === tab.key ? "text-accent" : "text-muted-2",
          )}
        >
          <tab.icon className="size-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
