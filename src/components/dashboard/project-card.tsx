"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreVertical, Copy, Pencil, Trash2, Play, Clock, Captions } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDuration, relativeTime } from "@/lib/utils";
import { api, type ProjectSummary } from "@/lib/api-client";
import { toast } from "sonner";

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "accent" | "success" | "warning" | "danger" }> = {
  EMPTY: { label: "No video", variant: "default" },
  LOADING: { label: "Processing", variant: "warning" },
  TRANSCRIBING: { label: "Transcribing", variant: "warning" },
  READY: { label: "Ready to edit", variant: "accent" },
  EDITING: { label: "Editing", variant: "accent" },
  EXPORTING: { label: "Exporting", variant: "warning" },
  EXPORTED: { label: "Exported", variant: "success" },
  ERROR: { label: "Error", variant: "danger" },
};

export function ProjectCard({ project, onChanged }: { project: ProjectSummary; onChanged: () => void }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [confirmingTrash, setConfirmingTrash] = useState(false);
  const status = STATUS_LABEL[project.status] ?? STATUS_LABEL.EMPTY;

  const href = project.status === "EMPTY" ? `/projects/${project.id}/upload` : `/editor/${project.id}`;

  async function rename() {
    setRenaming(false);
    if (name.trim() && name !== project.name) {
      await api.patchProject(project.id, { name: name.trim() });
      onChanged();
    }
  }

  async function duplicate() {
    try {
      await api.duplicateProject(project.id);
      toast.success("Project duplicated.");
      onChanged();
    } catch {
      toast.error("Couldn't duplicate this project.");
    }
  }

  async function remove() {
    try {
      await api.deleteProject(project.id);
      toast.success("Moved to Trash.");
      onChanged();
    } catch {
      toast.error("Couldn't delete this project.");
    }
  }

  return (
    <Card className="group overflow-hidden transition-colors hover:border-border-strong">
      <Link href={href} className="block">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-surface-2 to-surface-3">
          {project.thumbnailUrl ? (
            <video src={project.thumbnailUrl} className="h-full w-full object-cover" muted preload="metadata" />
          ) : (
            <Captions className="size-8 text-muted-2" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
            <div className="flex size-11 items-center justify-center rounded-full bg-white/90 text-black">
              <Play className="ml-0.5 size-5" fill="currentColor" />
            </div>
          </div>
          <Badge variant={status.variant} className="absolute left-2 top-2">
            {status.label}
          </Badge>
          <Badge className="absolute right-2 top-2 bg-black/50">{project.aspectRatio}</Badge>
        </div>
      </Link>

      <div className="flex items-start justify-between gap-2 p-4">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === "Enter" && rename()}
              className="h-7 text-sm"
            />
          ) : (
            <Link href={href} className="truncate text-sm font-medium hover:text-accent">
              {project.name}
            </Link>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-2">
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> {project.duration ? formatDuration(project.duration) : "—"}
            </span>
            <span>{project.subtitleCount} subtitles</span>
            <span>{relativeTime(project.updatedAt)}</span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" onClick={(e) => e.stopPropagation()}>
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil className="size-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={duplicate}>
              <Copy className="size-3.5" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setConfirmingTrash(true)} className="text-danger focus:bg-danger/10">
              <Trash2 className="size-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirmingTrash}
        onOpenChange={setConfirmingTrash}
        title="Move to Trash?"
        description={`"${project.name}" will be moved to Trash. You can restore it later from Trash, or delete it permanently from there.`}
        confirmLabel="Move to Trash"
        onConfirm={remove}
      />
    </Card>
  );
}
