"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { relativeTime } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

interface TrashedProject {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  deletedAt: string;
}

export default function TrashPage() {
  const [projects, setProjects] = useState<TrashedProject[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrashedProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    api.listTrash().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function restore(id: string) {
    try {
      await api.restoreProject(id);
      toast.success("Project restored.");
      load();
    } catch {
      toast.error("Couldn't restore this project.");
    }
  }

  async function confirmDeleteForever() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteProjectForever(deleteTarget.id);
      toast.success("Project permanently deleted.");
      setDeleteTarget(null);
      load();
    } catch {
      toast.error("Couldn't delete this project.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Trash</h1>
      <p className="mt-1 text-sm text-muted">Deleted projects stay here until you permanently delete or restore them.</p>

      {!projects ? (
        <div className="flex h-64 items-center justify-center text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-24 text-center">
          <Trash2 className="size-8 text-muted-2" />
          <p className="font-medium">Trash is empty</p>
          <p className="max-w-xs text-sm text-muted">Deleted projects will show up here before they&apos;re gone for good.</p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id} className="p-4">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="mt-1 text-xs text-muted-2">Deleted {relativeTime(p.deletedAt)}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => restore(p.id)}>
                  <RotateCcw className="size-3.5" /> Restore
                </Button>
                <Button variant="destructive" size="sm" className="flex-1" onClick={() => setDeleteTarget(p)}>
                  <Trash2 className="size-3.5" /> Delete forever
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <DeleteForeverDialog
        project={deleteTarget}
        deleting={deleting}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
        onConfirm={confirmDeleteForever}
      />
    </div>
  );
}

/** Replaces a native `confirm()` (trivially, reflexively dismissible with zero information
 * about what's actually being destroyed) with an in-app dialog that requires the user to type
 * the exact project name before the destructive action becomes available — the same
 * "type the name to confirm" pattern used by other tools for irreversible actions. Everything
 * this deletes (video, audio, exports, captions) is spelled out explicitly rather than a bare
 * "this cannot be undone." */
function DeleteForeverDialog({
  project,
  deleting,
  onOpenChange,
  onConfirm,
}: {
  project: { id: string; name: string } | null;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const currentId = project?.id ?? null;
  const [typed, setTyped] = useState("");
  const [lastProjectId, setLastProjectId] = useState<string | null>(currentId);
  // Reset the typed confirmation whenever a different project (or none) becomes the target —
  // typing "yes" for project A must never accidentally arm the button for project B. Both
  // sides are normalized to `string | null` before comparing — `project?.id` alone is
  // `string | undefined`, and comparing that directly against a `string | null` state would
  // never converge (undefined !== null is always true), causing an infinite render loop.
  if (currentId !== lastProjectId) {
    setLastProjectId(currentId);
    setTyped("");
  }

  const matches = project !== null && typed.trim() === project.name;

  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-danger">
            <AlertTriangle className="size-5" /> Permanently delete this project?
          </DialogTitle>
          <DialogDescription>
            This cannot be undone. Deleting <span className="font-medium text-foreground">&quot;{project?.name}&quot;</span> permanently
            removes its video, audio, exported files, and all captions — there is no further Trash stage after this.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-delete-name">
            Type <span className="font-medium text-foreground">{project?.name}</span> to confirm
          </Label>
          <Input
            id="confirm-delete-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!matches || deleting}>
            {deleting && <Loader2 className="size-3.5 animate-spin" />}
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
