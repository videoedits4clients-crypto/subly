"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./dialog";
import { Button, type ButtonProps } from "./button";

/**
 * A single, reusable confirmation dialog for actions that need a deliberate yes/no from the
 * user but don't warrant the trash page's heavier "type the name to confirm" pattern (see
 * app/dashboard/trash/page.tsx's DeleteForeverDialog, reserved for the one truly irreversible
 * permanent-delete action). Built from the same Dialog primitives every other dialog in the app
 * already uses, so a confirmation looks like part of SUBLY instead of the browser's own native
 * `confirm()` — which has no title/description structure, can't be styled, and (unlike this)
 * doesn't tell the user what's actually about to happen beyond one plain-text line.
 *
 * Stateless from the caller's point of view: pass `open`/`onOpenChange` like any other Dialog,
 * and an `onConfirm` that may be async — the dialog shows its own loading state and closes
 * itself only after `onConfirm` resolves, the same "don't let the user double-submit or think
 * nothing happened" behavior the trash page's own confirm dialog already has.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonProps["variant"];
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={handleConfirm} disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
