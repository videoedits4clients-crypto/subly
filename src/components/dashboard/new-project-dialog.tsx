"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Smartphone, MonitorPlay, Square, RectangleVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import type { AspectRatio } from "@/types/subtitle";
import { toast } from "sonner";

const RATIOS: { value: AspectRatio; label: string; icon: typeof Smartphone }[] = [
  { value: "9:16", label: "Reels / Shorts / TikTok", icon: Smartphone },
  { value: "16:9", label: "YouTube / Landscape", icon: MonitorPlay },
  { value: "1:1", label: "Square", icon: Square },
  { value: "4:5", label: "Portrait post", icon: RectangleVertical },
];

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("Untitled project");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);
    try {
      const { id } = await api.createProject({ name: name.trim() || "Untitled project", aspectRatio });
      onOpenChange(false);
      router.push(`/projects/${id}/upload`);
    } catch {
      toast.error("Couldn't create the project.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Name it and choose the aspect ratio you&apos;re editing for — you can change this later.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label>Aspect ratio</Label>
            <div className="grid grid-cols-2 gap-2">
              {RATIOS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setAspectRatio(r.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors",
                    aspectRatio === r.value ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-2 hover:bg-surface-3",
                  )}
                >
                  <r.icon className="size-5" />
                  <span className="text-xs font-medium">{r.value}</span>
                  <span className="text-[10px] text-muted-2">{r.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" onClick={create} disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Continue to upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
