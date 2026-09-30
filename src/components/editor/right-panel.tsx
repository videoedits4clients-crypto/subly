"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StylePanel } from "./style-panel";
import { AnimationPanel } from "./animation-panel";
import { PresetsPanel } from "./presets-panel";

/** `forceTab` lets the mobile tab bar jump straight to Style or Animation (e.g. tapping "Animate" should open that tab, not whichever the user last had open). Desktop ignores it and manages its own tab state. */
export function RightPanel({ forceTab }: { forceTab?: "style" | "animation" }) {
  const [tab, setTab] = useState(forceTab ?? "style");
  const [lastForceTab, setLastForceTab] = useState(forceTab);
  if (forceTab && forceTab !== lastForceTab) {
    setLastForceTab(forceTab);
    setTab(forceTab);
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface lg:w-80 lg:border-l lg:border-border">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex h-full flex-col">
        <div className="border-b border-border p-2">
          <TabsList className="w-full">
            <TabsTrigger value="style" className="flex-1">
              Style
            </TabsTrigger>
            <TabsTrigger value="animation" className="flex-1">
              Animation
            </TabsTrigger>
            <TabsTrigger value="presets" className="flex-1">
              Presets
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="style" className="min-h-0 flex-1 overflow-hidden">
          <StylePanel />
        </TabsContent>
        <TabsContent value="animation" className="min-h-0 flex-1 overflow-hidden">
          <AnimationPanel />
        </TabsContent>
        <TabsContent value="presets" className="min-h-0 flex-1 overflow-hidden">
          <PresetsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
