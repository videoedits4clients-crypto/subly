# P19.15 — Undo/Redo Persistence Integrity

**Task ID:** 143208
**Date:** 2026-09-30 (IST)

## STATUS: **PASS**

All 6 required packaged manual tests pass against the real installed 0.1.20 Electron application, using the exact original P19.14 reproduction steps. Source regression is clean. Read §3 before anything else — the root cause is **not** where P19.14 pointed, and proving that (per this task's own explicit "do not assume, prove it" instruction) is most of this report's value.

---

## 1. TASK ID

143208 — P19.15, Undo/Redo Persistence Integrity.

## 2. VERSION

`0.1.19` → **`0.1.20`**.

## 3. ROOT CAUSE

**Investigation finding: `commit()`, `undo()`, and `redo()` in `src/store/editor-store.ts`, and the debounced-save subscription in `src/hooks/use-autosave.ts`, have no defect.** Extensive re-investigation — both a real regression-test harness exercising the actual persistence boundary, and live testing in the real installed 0.1.19 packaged app — could not reproduce "an isolated `undo()`/`redo()` doesn't autosave" as a defect in that code. All three store actions are wired to the autosave subscription identically: each produces a fresh `project` object reference and sets `dirty: true`, which is the entirety of the subscription's gate condition (`state.dirty && state.project !== prevState.project`). Ten new regression tests (§5, Tests A–J) exercise this exact real code path — including isolated undo, isolated redo, both output modes, and a rapid undo/undo/redo/undo sequence — and **all ten pass against the original, unmodified code**, before any fix was applied.

**What P19.14 actually observed, reproduced and explained:** live re-testing in the real packaged 0.1.19 app, with careful tracking of `document.activeElement` and the raw DOM `<textarea>.value` (not just the accessibility-tree text, which can look consistent with either explanation), showed the following:

1. Caption text is edited via `captions-panel.tsx`'s `<Textarea>`, a **controlled** input with **commit-on-blur** semantics (`onBlur={() => value !== text && onChange(id, value)}`) — this is by design, so autosave doesn't PATCH on every keystroke.
2. Editing a caption and pressing **Tab** (the app's own documented "Tab to move while editing" convention) commits the edit correctly (confirmed: the store, and the server, both update right away) — but leaves DOM focus on **another `<textarea>`** (a sibling caption, or in some observed sequences, back on the very field just edited).
3. `src/hooks/use-keyboard-shortcuts.ts`'s global keydown handler has a pre-existing, intentional guard: `if (isTypingTarget(e.target)) return;` (line 333), which runs **before** the Ctrl+Z/Ctrl+Shift+Z handling (lines 342–350) — added, per its own comment, specifically to stop the global undo from silently clobbering a caption the user is mid-typing in.
4. When focus is on a sibling caption's textarea that hasn't been touched, this guard correctly makes Ctrl+Z a complete no-op — confirmed directly: neither the DOM value, the store, nor the database changes at all.
5. When focus remains on (or returns to) the **just-edited** field, pressing Ctrl+Z instead triggers the **browser's own native, per-field text undo** — reverting that `<textarea>`'s raw, uncommitted DOM value by one keystroke, **without** going through React's `onChange`/the app's `onBlur`-commit path, and therefore never touching the Zustand store, `dirty`, or autosave at all. This is a standard, textbook "native browser undo bypasses a controlled input's own change tracking" scenario, not specific to this app. **Confirmed directly**, side-by-side, in the real running app: after this Ctrl+Z, the focused `<textarea>`'s raw DOM `.value` showed the reverted text, while `useEditorStore`'s real, persisted database state (read directly) still held the pre-undo value — the "undo" was 100% cosmetic and local to that one DOM node.

In short: **the visible revert P19.14 saw was real, but it was never the application's own undo** — `store.undo()` was never called in that reproduction. The app's actual undo/redo/autosave pipeline was proven correct, both by new automated tests and by live testing once the true mechanism was isolated (see the "toolbar Undo button" and "focus deliberately moved to `<body>`" checks in this session's transcript, both of which correctly triggered `store.undo()` and correctly persisted).

## 4. EXACT CODE CHANGE

Two changes, both minimal and additive — no autosave architecture, undo/redo history model, `MAX_HISTORY`, display-mode architecture, packaging, export, or caption data structure was touched.

**(a) `src/hooks/use-autosave.ts` — refactored for testability only, zero behavior change.** The debounce/retry state moved from `useRef` to plain closure variables, and the two `useEffect` bodies were extracted into two new exported plain functions (`wireAutosave`, `wireBeforeUnloadFlush`), which `useAutosave` now just calls from `useEffect`. This makes the real subscribe/debounce/save-queue logic callable directly from a Node test (see §5) instead of only reachable via a full React render. Also converted its `@/`-aliased imports to relative `.ts` imports (matching `editor-store.ts`'s own existing convention), which is what makes it importable by Node's native test runner at all.

**(b) `src/components/editor/captions-panel.tsx` — the actual product fix**, in the caption `<Textarea>`'s `onKeyDown`:
```tsx
onKeyDown={(e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    (e.target as HTMLTextAreaElement).blur();
  }
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (value !== text) onChange(id, value);
    if (e.shiftKey) useEditorStore.getState().redo();
    else useEditorStore.getState().undo();
  }
}}
```
This makes Ctrl+Z/Ctrl+Shift+Z **inside any caption textarea** always: (1) `preventDefault()` so the browser's native per-field undo never fires at all, (2) commit any pending uncommitted edit first (reusing the exact same `onBlur` commit path), then (3) call the real, global `store.undo()`/`store.redo()` directly — bypassing `use-keyboard-shortcuts.ts`'s `isTypingTarget` guard entirely for this one case, the same established pattern that file already uses for Ctrl+C/Ctrl+X/Ctrl+V (see its own comment on why those are special-cased ahead of the blanket typing-target guard). Committing the pending edit first (rather than discarding it) preserves the original guard's own safety goal: undo never silently reaches past what the user just saw change.

**Not changed** (deliberately, per this task's own scope limits): the project-name input (`top-bar.tsx`) and the word-split/insert popover's own small text fields were not audited or touched — they may share the same class of native-undo quirk, but this was not confirmed, and fixing them wasn't required to close the reported defect (caption text editing is where it was reported and reproduced).

## 5. REGRESSION TESTS

New file: `src/hooks/__tests__/use-autosave-undo-redo-persistence.test.ts` (10 tests), exercising the real `wireAutosave` (§4a) against the real `editor-store.ts`, mocking only `global.fetch`.

| Test | What it proves | Result |
|---|---|---|
| A | edit → save → undo → save → persisted = undone state | ✔ pass |
| B | edit → save → undo → redo → save → persisted = redone state | ✔ pass |
| C | undo alone (no further interaction) still persists after the debounce | ✔ pass |
| D | redo alone (no further interaction) still persists after the debounce | ✔ pass |
| E | Original output mode — isolated undo persists | ✔ pass |
| F | Hinglish (derived) output mode — isolated undo persists | ✔ pass |
| G | undo followed by another edit still persists correctly | ✔ pass |
| H | redo followed by another edit still persists correctly | ✔ pass |
| I | rapid undo/undo/redo/undo with no waits in between — persisted state matches the FINAL state, not a stale intermediate one | ✔ pass |
| J | ordinary edit autosave behavior is unchanged (dirty timing, save-state transitions, payload shape) | ✔ pass |

All 10 pass against the code **before** the captions-panel.tsx fix too (proving the store/autosave layer was never the defect) and continue to pass after it (proving the refactor didn't regress anything). No existing test was weakened or removed.

Also registered: `scripts/postbuild-standalone.test.js` and the other P19.14 hygiene test remain untouched and passing (not part of this task's scope, checked only as part of the full suite run below).

## 6. SOURCE TEST RESULT

- Before this task: 1876 tests passing (P19.14 baseline).
- After this task: **1886 tests passing** (1876 + 10 new), **0 failing**.

## 7. TYPECHECK

`npx tsc --noEmit`: **0 errors.**

## 8. LINT

`npx eslint .`: **0 errors**, exactly the same **5 pre-existing warnings** as P19.12/P19.13/P19.14 (`project-card.tsx`, `lib/ai/index.ts`, `lib/analytics.ts`, `subtitles/ass.ts`, `subtitles/preview-style.ts`) — no new warnings introduced.

## 9. PACKAGED BUILD RESULT

Ran the real, complete, unmodified `npm run electron:pack` pipeline (clean → worker:build → build → electron-builder --win) — no step substituted. Succeeded on the first attempt this time (12.89GB free RAM available; P19.14's OOM was caused by an unrelated Adobe After Effects process on this shared machine, not present this run). Result: `release/SUBLY Setup 0.1.20.exe`, 566,397,087 bytes. Installed silently (`/S`), no admin elevation, into a fresh isolated `--user-data-dir` (never touching this machine's real accumulated development data). Confirmed via installed exe file-version metadata: `0.1.20`.

## 10. PACKAGED MANUAL TEST RESULTS

All 6 run against the **real installed 0.1.20 Electron application** (not a dev server, not a unit test), each using the exact original P19.14 reproduction pattern (type into a caption, press Tab so focus lands on a sibling textarea — deliberately reproducing the exact reported conditions, not a friendlier variant).

| Test | Steps | Result |
|---|---|---|
| **1** | Edit → wait, confirmed saved via DB → Ctrl+Z alone → clean 8s wait → reload | **PASS** — DB and reloaded UI both show the undone state (`"This is a test"`, not `"…PACKAGEDTEST1"`) |
| **2** | Edit → save → Ctrl+Z → Ctrl+Shift+Z → nothing else → wait → reload | **PASS** — redone state (`"…PACKAGEDTEST2"`) persisted and survived reload |
| **3** | Repeat in Original mode | **PASS** — tests 1 and 2 above were run in the Original-mode project |
| **4** | Repeat in Hinglish mode | **PASS** — isolated undo of a Hinglish-text edit persisted (`"100 rupees de de"`, not `"…PACKAGEDTEST4"`), confirmed via DB and reload |
| **5** | Undo → force-terminate the app ~2s later (after the 900ms debounce had its opportunity) → relaunch | **PASS** — DB showed the undone state (`"100 rupees de de"`) immediately after the kill, and the relaunched app displayed it correctly |
| **6** | Rapid undo/undo/redo/undo (no waits between them) on a caption with 3 sequential edits (V1, V2, V3) → wait → reload | **PASS** — final state (`"…V1"`, matching the exact sequence's expected result) persisted and survived reload, no stale/out-of-order overwrite |

Ordinary edit autosave was verified working throughout (every test's own "confirmed saved" step is itself this check, repeated ~10 times across both projects/modes).

## 11. BEFORE/AFTER PERSISTENCE BEHAVIOR

**Before:** Ctrl+Z/Ctrl+Shift+Z pressed while focus remained inside a caption textarea (the normal state immediately after editing and tabbing away) either did nothing (focus on an untouched sibling field) or triggered a native, store-invisible, per-field text revert (focus on/returned to the just-edited field) — in both cases, the application's real undo/redo history and the database were completely unaffected, while the screen could show something that looked like an undo.

**After:** Ctrl+Z/Ctrl+Shift+Z inside any caption textarea always and only means "commit anything pending, then really undo/redo" — deterministically reaching the same `store.undo()`/`store.redo()` that the toolbar buttons call, with the exact same autosave persistence guarantee, regardless of focus history.

## 12. REMAINING LIMITATIONS

- The project-name input and the word-split/insert popover's small text fields were not audited for the same native-undo-vs-controlled-input class of issue; if they share it, it wasn't in scope for this task's reported defect and wasn't touched.
- Timeline drag-based undo (P19.12/P19.14's own separate coverage) was not re-tested here — it was not implicated in this defect (it doesn't go through a text `<textarea>`) and this task's scope explicitly excluded touching timeline drag coalescing.
- No other known limitation from P19.14 (Gujarati legacy fixture, timeline snapping/fit-to-selection, in-app version display, file associations, etc.) was revisited — out of this task's scope by its own explicit instruction.

---

**Source-level verification:** §5–8 (regression tests against the real store/autosave code, typecheck, lint).
**Unit/integration test verification:** §5 (10 new tests, all passing against real, unmocked `editor-store.ts` and `use-autosave.ts` logic, with only `fetch` mocked).
**Real installed Electron verification:** §10 (6 packaged manual tests against the actual installed 0.1.20 application, silently installed with no admin elevation, using an isolated userData directory).

No claim in this report about the packaged app rests on a unit test alone.
