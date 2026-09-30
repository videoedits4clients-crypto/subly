"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Shared "type a preset name" dialog — used for both "Save as Preset" (new) and "Rename"
 * (existing), since the two only differ in title/initial value/submit handler. Validation
 * (empty/duplicate names) is server-authoritative (see api/presets routes, which reuse the
 * exact same lib/custom-presets.ts functions) — this dialog just surfaces whatever error the
 * server returns, so there is only ever one source of truth for "is this name allowed." */
export function PresetNameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName = "",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  initialName?: string;
  onSubmit: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Reset the form fields whenever the dialog transitions to open (or to a different preset's
  // initial name) — adjusted synchronously during render rather than in an effect, the same
  // "previous value in state, compare during render" pattern trash/page.tsx's own
  // DeleteForeverDialog uses, so opening for a second preset never shows the first one's stale
  // typed name or leftover error.
  const [lastKey, setLastKey] = useState({ open, initialName });
  if (lastKey.open !== open || lastKey.initialName !== initialName) {
    setLastKey({ open, initialName });
    if (open) {
      setName(initialName);
      setError(null);
      setLoading(false);
    }
  }

  async function submit() {
    if (!name.trim() || loading) return;
    setLoading(true);
    setError(null);
    const result = await onSubmit(name);
    setLoading(false);
    if (result.ok) onOpenChange(false);
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="preset-name">Preset name</Label>
          <Input
            id="preset-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
            autoComplete="off"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="accent" onClick={submit} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
