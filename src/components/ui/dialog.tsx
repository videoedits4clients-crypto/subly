"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        // Task 97025 (P10) — discovered live: this overlay is a full-screen `fixed inset-0`
        // backdrop that Radix's own exit ANIMATION is supposed to unmount once `animationend`
        // fires (via its Presence wrapper) — but, exactly like the word-timing Popover bug
        // Task 93471/P7.3 found and fixed (see hooks/dialog-open-guard.ts's own doc comment:
        // "the animation never actually completes... in at least this environment"), that event
        // apparently doesn't reliably fire here either, so a "closed" dialog's overlay can stay
        // mounted indefinitely — and because it's full-screen (unlike the Popover, which has no
        // backdrop at all), a stuck one silently blocks EVERY mouse click anywhere in the app,
        // not just keyboard shortcuts. Confirmed live via getComputedStyle/elementFromPoint that
        // Radix's OWN modality machinery sets an INLINE `pointer-events: auto` on this exact
        // element (to keep the modal itself interactive while a global body-level pointer-events
        // lock is active) — inline styles always beat a plain class-based override, which is why
        // a bare `data-[state=closed]:pointer-events-none` alone did NOT fix this (verified — it
        // computed to "none" as a class rule but "auto" won via the inline style). The `!`
        // important-modifier (Tailwind v4) generates `pointer-events: none !important`, which DOES
        // beat a plain (non-!important) inline style per the CSS cascade — confirmed live this
        // actually stops the stuck overlay from intercepting clicks.
        "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none!",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-6 shadow-2xl",
          // Same "stuck after close" defense as DialogOverlay above, for the content box itself
          // — same `!` important-modifier reasoning (Radix sets this one's pointer-events
          // inline too).
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:pointer-events-none!",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted opacity-70 transition-opacity hover:opacity-100 hover:bg-surface-2 focus:outline-none">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1.5", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold text-foreground", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};
