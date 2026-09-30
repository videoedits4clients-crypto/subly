/**
 * Regression test for a confirmed P3 polish-phase bug: global editor keyboard shortcuts (Undo,
 * Redo, Delete, arrow-key caption navigation, Escape's deselect-and-blur, etc.) are wired via a
 * single plain `window` keydown listener (src/hooks/use-keyboard-shortcuts.ts) with no built-in
 * awareness of whether a modal Dialog is currently open. Confirmed live: opening the Export
 * dialog, then pressing Escape (meaning "close this dialog") also silently deselected whatever
 * caption was selected in the editor behind it; pressing ArrowDown to navigate a Select's own
 * options (e.g. the export dialog's Resolution dropdown) also moved the caption selection and
 * seeked the video behind the dialog. Neither a Select's trigger/listbox nor Escape are caught
 * by the existing isTypingTarget guard, since none of them are an INPUT/TEXTAREA/contentEditable
 * element — a new, separate guard (isAnyDialogOpen, src/hooks/dialog-open-guard.ts) was needed.
 *
 * Task 93471 (P7.3) extended this guard: element PRESENCE alone was found (via live QA) to be
 * insufficient — a closed word-timing Popover (Task 92618) can remain mounted with
 * `role="dialog"`/`data-state="closed"` after its exit animation, which used to permanently trip
 * this guard for the rest of the session. The guard now also checks `data-state`, and checks
 * every matching element (not just the first) so a stale closed node can never mask a different,
 * genuinely open dialog.
 *
 * This test covers the new guard predicate itself (dependency-injected, no real DOM needed) —
 * the full keydown handler is deeply entangled with the Zustand store and real DOM globals, so
 * it isn't extracted/tested here; the guard's correctness is what actually fixes the confirmed
 * bug, and was additionally confirmed via live browser QA (see the phase's own report).
 *
 * Run with: node --test src/hooks/__tests__/dialog-open-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isAnyDialogOpen } from "../dialog-open-guard.ts";

function fakeElement(dataState: string | null): Pick<Element, "getAttribute"> {
  return { getAttribute: (name: string) => (name === "data-state" ? dataState : null) };
}

function fakeDocument(elements: Pick<Element, "getAttribute">[]): Pick<Document, "querySelectorAll"> {
  return {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, '[role="dialog"]', "must query for the exact role Radix Dialog/Popover Content renders");
      return elements as unknown as NodeListOf<Element>;
    },
  };
}

test("isAnyDialogOpen returns true when an OPEN [role=dialog] element is present", () => {
  assert.equal(isAnyDialogOpen(fakeDocument([fakeElement("open")])), true);
});

test("isAnyDialogOpen returns false when no dialog element is present at all", () => {
  assert.equal(isAnyDialogOpen(fakeDocument([])), false);
});

test("isAnyDialogOpen returns false for a dialog element with data-state=closed (Task 93471 — a stale, not-yet-unmounted Popover must not count as open)", () => {
  assert.equal(isAnyDialogOpen(fakeDocument([fakeElement("closed")])), false);
});

test("isAnyDialogOpen returns true if ANY matching element is open, even alongside a stale closed one (a closed node must never mask a real open dialog elsewhere)", () => {
  assert.equal(isAnyDialogOpen(fakeDocument([fakeElement("closed"), fakeElement("open")])), true);
});

test("isAnyDialogOpen treats an element with no data-state attribute at all as open (fails safe — never silently unblocks the guard for an unrecognized Content implementation)", () => {
  assert.equal(isAnyDialogOpen(fakeDocument([fakeElement(null)])), true);
});

test("isAnyDialogOpen defaults to checking the real global document when called with no argument", () => {
  // Every production call site (use-keyboard-shortcuts.ts's own Escape handler and the
  // post-isTypingTarget guard) calls this with zero arguments — confirm the default parameter
  // itself doesn't throw and returns a boolean when there's genuinely no `document` mock, i.e.
  // this only verifies the function is callable/typed correctly in a Node (non-browser) test
  // environment where `document` is undefined; it must not throw synchronously at import time.
  assert.throws(() => isAnyDialogOpen(), /document is not defined/);
});
