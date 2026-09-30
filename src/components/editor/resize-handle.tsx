"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/** Task 120417 (P19.1) — the keyboard-nudge step, small and bounded per this task's own
 * accessibility requirement ("use small bounded increments"). */
const KEYBOARD_STEP = 16;

/**
 * A small, reusable drag-to-resize handle — the SAME pointer-capture/pointermove/pointerup shape
 * timeline.tsx's own caption-edge and word-edge drag handles already use (`setPointerCapture` on
 * `onPointerDown`, live-update on `onPointerMove`, clear on `onPointerUp`/`onPointerCancel`), just
 * self-contained (this component owns all four handlers itself, since a resize handle — unlike a
 * caption block's drag, which can start from either of two separate edge handles feeding one
 * shared parent-level move/up listener — never needs a wider hit area than its own element).
 *
 * Deliberately dumb: reports a proposed VALUE via `onChange` on every pointermove tick (clamped to
 * `[min, max]`) and never decides anything about layout, persistence, or project state itself —
 * matching this codebase's established "propose, don't decide" split (lib/timeline/snapping.ts's
 * own doc comment: "this module NEVER decides whether a resulting value is valid"). The caller
 * (editor-shell.tsx) owns the actual width/height state and persists it on its own schedule.
 *
 * `direction` says which way the pointer must move to INCREASE `value`: `1` when dragging toward
 * larger client X/Y increases the dimension (e.g. the captions-panel handle, dragging right makes
 * it wider), `-1` when the opposite edge is being dragged (e.g. the timeline's own top handle,
 * dragging UP — smaller clientY — makes it taller).
 */
export function ResizeHandle({
  orientation,
  direction,
  value,
  min,
  max,
  onChange,
  onCommit,
  label,
  className,
}: {
  /** `"vertical"` = a vertical bar the user drags horizontally (resizes a WIDTH). `"horizontal"` =
   * a horizontal bar the user drags vertically (resizes a HEIGHT). Named after the handle's own
   * visual orientation, matching the ARIA `separator` role's own `aria-orientation` convention. */
  orientation: "vertical" | "horizontal";
  direction: 1 | -1;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Called once when a drag gesture ends (pointerup/cancel) or after a keyboard nudge — NEVER on
   * every pointermove tick. The caller uses this to persist the final value (debounced or not),
   * not to drive the live visual update, which `onChange` alone already handles. Omitted (not
   * called at all) for a click that never actually moved the value — see `startDrag`'s own
   * `moved` tracking. */
  onCommit?: () => void;
  /** Accessible name for the `role="separator"` handle — e.g. "Resize captions panel". */
  label: string;
  className?: string;
}) {
  const dragRef = useRef<{ startPos: number; startValue: number; moved: boolean } | null>(null);

  function startDrag(e: React.PointerEvent) {
    // Task 120417 (P19.1): only the primary mouse button / a single touch/pen contact starts a
    // resize — mirrors timeline.tsx's own drag handles, which never gate on `e.button` explicitly
    // because pointerdown's default target is already the intended one; guarded here anyway since
    // this handle, unlike those, sits on a shared editor-wide boundary a stray secondary click
    // could otherwise catch.
    if (e.button !== 0) return;
    e.preventDefault();
    // `preventDefault()` above (needed to stop native drag-image/text-selection initiation) also
    // suppresses the browser's own default "focus this element on pointerdown" behavior for a
    // plain `tabIndex={0}` div — restored explicitly so the handle keeps keyboard focus after a
    // mouse-driven resize, exactly as a real `<input type="range">`-style control would (this
    // task's own explicit "keyboard focus must not be broken" requirement).
    (e.target as HTMLElement).focus();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startPos: orientation === "vertical" ? e.clientX : e.clientY, startValue: value, moved: false };
    // Prevent text selection while dragging across sibling panels (this task's own explicit
    // requirement) — no existing convention in this codebase for a CROSS-ELEMENT drag like this
    // one (timeline.tsx's own drags stay within one `select-none` track), so set/restore directly.
    document.body.style.userSelect = "none";
    document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = orientation === "vertical" ? e.clientX : e.clientY;
    const delta = (pos - drag.startPos) * direction;
    if (delta !== 0) drag.moved = true;
    const clamped = Math.min(max, Math.max(min, drag.startValue + delta));
    onChange(clamped);
  }

  function endDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    // A plain click (pointerdown -> pointerup with no movement in between) must have no side
    // effects — this task's own explicit requirement — so `onCommit` (which the caller uses to
    // persist) only fires when the value genuinely changed during this gesture.
    if (drag.moved) onCommit?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const isDecrease = orientation === "vertical" ? e.key === "ArrowLeft" : e.key === "ArrowUp";
    const isIncrease = orientation === "vertical" ? e.key === "ArrowRight" : e.key === "ArrowDown";
    if (!isDecrease && !isIncrease) return;
    // Stops this from ALSO reaching hooks/use-keyboard-shortcuts.ts's own global arrow-key
    // handling (playback seek / caption nav / word nav) — this handle only owns Arrow keys while
    // it itself has DOM focus, so there is no conflict with that document-level listener for any
    // other element on the page.
    e.preventDefault();
    e.stopPropagation();
    const delta = (isIncrease ? 1 : -1) * direction * KEYBOARD_STEP;
    onChange(Math.min(max, Math.max(min, value + delta)));
    onCommit?.();
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={startDrag}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        "shrink-0 touch-none bg-transparent transition-colors hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none",
        orientation === "vertical" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        className,
      )}
    />
  );
}
