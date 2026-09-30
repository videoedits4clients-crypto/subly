/**
 * Cross-checks src/lib/keyboard-shortcuts-reference.ts (the help dialog's DISPLAY-ONLY data,
 * Task 91342/P7.1) against a manually-verified list of the real key combinations actually
 * handled by src/hooks/use-keyboard-shortcuts.ts's own `if` chain (re-read in full for this
 * test, current as of this task). This does NOT execute the hook or the dialog — it exists
 * purely to catch drift: if a future edit adds/removes/renames a shortcut in the hook without
 * updating the reference data (or vice versa), this test fails instead of the docs silently
 * going stale.
 *
 * Run with: node --test src/lib/__tests__/keyboard-shortcuts-reference.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { KEYBOARD_SHORTCUTS, KEYBOARD_SHORTCUT_GROUPS } from "../keyboard-shortcuts-reference.ts";

// Hand-verified against use-keyboard-shortcuts.ts's actual `if` branches, one entry per distinct
// key combination the hook checks (Shift-variants of a shared Arrow branch counted separately,
// matching how the reference displays them). NOT sourced from the reference file itself.
const REAL_HOOK_SHORTCUTS: { keys: string[] }[] = [
  { keys: ["Ctrl", "S"] },
  { keys: ["Ctrl", "F"] },
  { keys: ["Ctrl", "H"] },
  { keys: ["Escape"] },
  { keys: ["Tab"] },
  { keys: ["Shift", "Tab"] },
  { keys: ["Ctrl", "Shift", "Z"] },
  { keys: ["Ctrl", "Z"] },
  { keys: ["Ctrl", "A"] },
  { keys: ["Ctrl", "C"] },
  { keys: ["Ctrl", "X"] },
  { keys: ["Ctrl", "V"] },
  { keys: ["Ctrl", "Shift", "S"] },
  { keys: ["Ctrl", "Shift", "M"] },
  { keys: ["Ctrl", "D"] },
  { keys: ["Alt", "←"] },
  { keys: ["Alt", "→"] },
  { keys: ["↑"] },
  { keys: ["↓"] },
  { keys: ["Home"] },
  { keys: ["End"] },
  { keys: ["Alt", "↑"] },
  { keys: ["Alt", "↓"] },
  { keys: ["["] },
  { keys: ["]"] },
  { keys: ["Shift", "["] },
  { keys: ["Shift", "]"] },
  { keys: ["Space"] },
  { keys: ["←"] },
  { keys: ["→"] },
  { keys: ["Shift", "←"] },
  { keys: ["Shift", "→"] },
  { keys: ["Delete"] },
  { keys: ["Enter"] },
  { keys: ["J"] },
  { keys: ["K"] },
  { keys: ["L"] },
];

function keySig(keys: string[]) {
  return [...keys].sort().join("+");
}

test("every real hook shortcut has exactly one matching entry in the reference data", () => {
  const referenceSigs = new Set(KEYBOARD_SHORTCUTS.map((s) => keySig(s.keys)));
  for (const real of REAL_HOOK_SHORTCUTS) {
    assert.ok(
      referenceSigs.has(keySig(real.keys)),
      `hook shortcut ${JSON.stringify(real.keys)} is missing from keyboard-shortcuts-reference.ts`
    );
  }
});

test("every reference entry corresponds to a real hook shortcut (no fabricated/stale entries)", () => {
  const realSigs = new Set(REAL_HOOK_SHORTCUTS.map((s) => keySig(s.keys)));
  for (const entry of KEYBOARD_SHORTCUTS) {
    assert.ok(
      realSigs.has(keySig(entry.keys)),
      `reference entry ${JSON.stringify(entry.keys)} (${entry.description}) does not correspond to any real shortcut in use-keyboard-shortcuts.ts`
    );
  }
});

test("the reference has exactly as many entries as the hook has real shortcuts (no accidental duplicates)", () => {
  assert.equal(KEYBOARD_SHORTCUTS.length, REAL_HOOK_SHORTCUTS.length);
});

test("every group has at least one shortcut and every shortcut has a non-empty description", () => {
  for (const group of KEYBOARD_SHORTCUT_GROUPS) {
    assert.ok(group.shortcuts.length > 0, `group "${group.title}" has no shortcuts`);
    for (const s of group.shortcuts) {
      assert.ok(s.description.trim().length > 0, `shortcut ${JSON.stringify(s.keys)} has an empty description`);
      assert.ok(s.keys.length > 0, `a shortcut in group "${group.title}" has no keys`);
    }
  }
});

test("KEYBOARD_SHORTCUTS is exactly the flattening of KEYBOARD_SHORTCUT_GROUPS (no drift between the two exports)", () => {
  const flattened = KEYBOARD_SHORTCUT_GROUPS.flatMap((g) => g.shortcuts);
  assert.deepEqual(KEYBOARD_SHORTCUTS, flattened);
});
