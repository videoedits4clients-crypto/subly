# P1 Fix Report — Custom Caption Presets

**Date:** 2026-09-18
**Scope:** Let a user customize a caption style and save/reuse it as their own preset. No changes to the waveform, dashboard search/filter/sort, Whisper/ASR, Gujarati Script, language policy, transcription segmentation, cancellation/stall logic, or export rendering pipeline.

---

## 1. Architecture chosen

Before writing any code, the existing preset/style architecture was inspected end-to-end:

- **Built-in presets** ([src/lib/presets.ts](src/lib/presets.ts)) — a hardcoded `BUILT_IN_PRESETS: SubtitlePresetDef[]` array (14 presets), each just a `{ id, name, description, style: SubtitleStyle, animation: AnimationConfig }`. Applied via `applyPreset(style, animation)` in the editor store — a single store action that sets `project.globalStyle`/`project.animation` and is fully undoable.
- **Style/animation schema** ([src/types/subtitle.ts](src/types/subtitle.ts)) — `SubtitleStyle` and `AnimationConfig` already cover every property in the task's list (font family/source/weight/size, color, background+opacity, outline, shadow, alignment/position, casing, letter/line spacing, word highlight + highlight color + active-word scale, entrance/exit/word animation + duration). `fontSource: "bundled" | "system"` already exists specifically so a system font's identity survives serialization without ever storing a font binary.
- **Persistence architecture** — this is the key finding. The Prisma schema already declares a `SubtitlePreset` model (`id, ownerId?, name, isBuiltIn, style, animation, createdAt`) — but it was **never referenced anywhere in application code** (confirmed by a full-repo grep) and had **zero rows** in the real packaged app's live database. The table itself, however, already physically exists in that database (confirmed directly against `%APPDATA%\subs\subly.db`). This is exactly the "existing local storage / JSON / database architecture" the task asked to check for first — it meant **no Prisma migration was needed at all**, just wiring up routes and app code to a table that was already there, unused.
- Everything else needed (Copy/Paste Style's `localStorage`-clipboard pattern, `lib/db-json.ts`'s JSON-string-column convention, the brand-kit API route's `requireUserId`/zod/Prisma shape) already had a close, directly-reusable precedent.

**Decision:** persist custom presets as rows in the pre-existing `SubtitlePreset` table, via new thin API routes that mirror the brand-kit route's exact pattern. Built-in presets stay 100% where they are — a separate, hardcoded, untouched array — and are never read from or written to this table. Applying a custom preset reuses the **exact same** `applyPreset(style, animation)` store action built-in presets already use — there is no second/parallel style-application path.

---

## 2. Exact files changed

**New:**
- `src/lib/custom-presets.ts` — pure logic: name validation/duplicate-detection, DB-row parsing (malformed-safe), an `extractStyleForApply` helper, and list reducers (`removePresetFromList`, `updatePresetInList`).
- `src/lib/__tests__/custom-presets.test.ts` — 16 tests (see below).
- `src/app/api/presets/route.ts` — `GET` (list current user's custom presets) / `POST` (create).
- `src/app/api/presets/[id]/route.ts` — `PATCH` (rename and/or update style+animation) / `DELETE`.
- `src/components/editor/preset-name-dialog.tsx` — the shared "type a preset name" dialog, used for both Save-as-new and Rename.

**Modified:**
- `src/components/editor/presets-panel.tsx` — added a "My Presets" section (above the built-in categories) with "Save as preset", and a `CustomPresetCard` with an overflow menu (Update preset / Rename / Delete). Built-in `PresetCard` rendering is untouched.
- `src/store/editor-store.ts` — added one ephemeral field, `lastAppliedCustomPresetId` (+ setter), tracked the same way `selectedSubtitleId` already is (plain `set()`, not `commit()` — never part of undo/redo, never persisted to the project). This is what lets "Update preset" work correctly even after the user switches to the Style tab to tweak the just-applied preset and back (Radix `Tabs` unmounts inactive `TabsContent` by default, which would otherwise reset any local component state tracking "which preset is this").
- `src/lib/api-client.ts` — added `listCustomPresets` / `createCustomPreset` / `updateCustomPreset` / `deleteCustomPreset`, plus a `createdAt` re-export of the new type.
- `src/lib/presets.ts` — **import-path fix only** (`@/types/subtitle` → relative `.ts` import), the same fix needed in every prior phase to make a `lib/` module directly testable under Node's native test runner. No logic changed; verified via the new test's own "built-in preset count/content unchanged" assertions.
- `package.json` — added `test:presets` script and appended the new test file to `test`.

---

## 3. Whether a DB migration was required

**No.** The `SubtitlePreset` table already existed in `prisma/schema.prisma` and in the real, live packaged-app database (verified directly — `prisma.subtitlePreset.count()` succeeded against `%APPDATA%\subs\subly.db` before any code changes, returning 0). This phase only added application code that reads/writes that pre-existing, previously-dormant table.

---

## 4. Custom preset persistence mechanism

Rows in the `SubtitlePreset` table (`ownerId` = the desktop app's fixed local user id, same as every other owned resource in this app), with `style`/`animation` stored as JSON strings — identical convention to `Project.globalStyle`/`Project.animation`. This is genuinely local (the same SQLite file every other project/export/brand-kit record lives in), survives dashboard navigation, editor close/reopen, and full app relaunch, with no API/cloud/login/external service involved beyond the app's own local Next.js server (which is how *every* feature in this desktop app — including ones already shipped and QA'd in prior phases — talks to its own local database).

One real architecture pitfall was found and avoided along the way: this app's Electron main process binds its local server to a **fresh random port on every launch** (`findFreePort()` in `electron/main.js`), which means browser `localStorage` — already used elsewhere in this app for the style clipboard and crash-recovery snapshots — is **not** actually origin-stable across a relaunch (port is part of the origin). Custom presets therefore deliberately do **not** use `localStorage`; the Prisma-backed table sidesteps this entirely, since it's server-side file storage, not browser storage.

---

## 5. Built-in preset protection

- Built-in presets are never written to the `SubtitlePreset` table by any code path — `POST /api/presets` only ever inserts rows with `isBuiltIn` left at its schema default (`false`).
- `PATCH`/`DELETE /api/presets/[id]` both defensively refuse any row where `isBuiltIn` is true (in addition to the ownership check) — belt-and-suspenders, since nothing in this app can currently produce such a row, but it means "built-ins can't be renamed/deleted" holds even if that ever changed.
- Applying a built-in preset still goes through the same `applyPreset(style, animation)` action that always did — subsequent edits go through `setGlobalStyle`, which spreads (`{...current, ...patch}`) rather than mutating, so the original `BUILT_IN_PRESETS` array entry is never touched. Verified live in the packaged app: applied "Classic," dragged font size to 140px, re-applied "Classic" — it came back at the original 58px.

---

## 6. Tests added

16 new tests in `src/lib/__tests__/custom-presets.test.ts`, covering every item in the task's list:

1. Create custom preset from a style (name validated/trimmed).
2. Custom preset persists — `SubtitleStyle`/`AnimationConfig` round-trip exactly through the same JSON encoding used for DB storage.
3. Load custom presets — `parsePresetRows` turns raw DB rows into clean records, in order.
4. Apply custom preset — `extractStyleForApply` hands back an independent copy of the exact style/animation.
5. Rename custom preset — new unique name accepted; renaming to its own current name allowed (self-exclusion).
6. Delete custom preset — removes only the targeted preset.
7. Built-in presets cannot be deleted — this module has no operation that even accepts `BUILT_IN_PRESETS`; the real `getPreset('classic')` is proven unaffected by an unrelated custom-list delete.
8. Built-in presets cannot be mutated — applying a built-in's style then patching it (the same spread-merge `setGlobalStyle` performs) never touches the original definition.
9. Updating a custom preset changes only that custom preset.
10. Deleting a custom preset does not affect an already-applied caption style (simulated apply → delete → assert the "applied" copy is untouched).
11. System-font metadata (`fontFamily` + `fontSource: "system"`) survives save/load.
12. Animation configuration survives save/load.
13. Word-highlight configuration (`wordHighlight`/`highlightColor`/`activeWordScale`) survives save/load.
14. Malformed/missing preset storage fails safely — `null`/`undefined`/`[]` all degrade to `[]`; a row with corrupt style or animation JSON is dropped while sibling well-formed rows still load.
15. Duplicate preset name behavior is deterministic — case-insensitive collisions always rejected, unique names always accepted, empty/whitespace names always rejected.
16. Existing built-in preset count/content remains unchanged — asserts all 14 ids and a couple of specific fields, a regression guard against ever accidentally editing `presets.ts`.

---

## 7. Full test result

`npm run test` — **185/185 pass** (169 pre-existing + 16 new). Zero regressions.

## 8. Typecheck result

`npx tsc --noEmit` — clean, no errors.

## 9. Lint result

`npm run lint` — **0 errors** (5 pre-existing warnings, all in files this phase never touched).

## 10. Fresh installer result

`npm run electron:pack` completed successfully, producing a fresh `release/SUBLY Setup 0.1.0.exe`. Installed cleanly to `%LOCALAPPDATA%\Programs\SUBLY`; startup log shows `db migrations: applied=[]` — confirming, as expected, that no migration was needed or ran.

## 11. Packaged QA checklist

All performed against the real packaged app (fresh install), using the real "Hindi/hinglish test" project (restored to its original default style afterward):

**Custom preset**
- [x] Create preset — customized font/size/highlight color, saved as "My Reels Style" / "Yellow Pop" / "System Font Test" across test passes; appeared immediately in "My Presets".
- [x] Close/reopen editor — preset remained.
- [x] Apply preset — preview, style controls, and word-highlight color all updated together.
- [x] Modify caption style after applying — preset itself did **not** silently change (re-opening/re-checking the preset's own stored style showed it unchanged).
- [x] Explicitly update preset — "Update preset" only appears once the current style has actually drifted from what's saved (verified it stays hidden immediately after applying, and appears only after a real edit, including **across a Style-tab round trip**, which required moving the tracking state into the editor store — see §2).
- [x] Verify updated version — re-applying after update reflected the new values.
- [x] Rename preset — via the shared name dialog; new name appeared immediately, toast confirmed.
- [x] Delete preset — removed from the list; verified via direct API calls (see note below) that the project's own `globalStyle` was byte-identical before and after deletion.

**Built-in**
- [x] Apply built-in preset ("Classic") — applied correctly.
- [x] Modify style (dragged font size to 140px) — current caption style changed.
- [x] Verify built-in remains unchanged — re-applied "Classic," got back the original 58px/700-weight/sentence-case definition.

**Persistence**
- [x] Quit app (force-killed `SUBLY.exe`), relaunch — custom preset ("System Font Test") still existed and still showed as the active style.

**Project safety**
- [x] Applied a custom preset, deleted it, reopened the project — captions rendered with the exact same style as before deletion (confirmed both visually and via the API: `globalStyle.fontSize`/`highlightColor` identical pre- and post-delete).

**Export**
- [x] Applied "System Font Test" (Segoe UI, a real Windows system font) and exported an MP4 — export completed (`status: DONE`). Extracted a frame from the actual output file and confirmed the burned-in caption uses the preset's color, outline, word-highlight color, and UPPERCASE casing.

**System font**
- [x] Created a preset from an installed Windows system font (Segoe UI, via the existing System Fonts category in the font picker) — `fontSource: "system"` preserved.
- [x] Restarted the app — reapplied correctly, `Family` still showed "Segoe UI" with no fallback.
- [x] Exported and verified rendering — see Export above; same export exercised this.

**Also verified:**
- [x] Undo/redo — applying "Classic" over the system-font style, then Ctrl+Z (via the toolbar Undo button), correctly restored the exact pre-apply style. Preset application is a normal undoable store commit, same as any built-in preset.
- [x] Waveform — untouched; visible and functioning in every editor screenshot taken this phase.
- [x] Dashboard search/filter/sort — untouched; toolbar and all 3 real projects rendered correctly.
- [x] Trash — untouched; full historical trash list rendered correctly, unaffected by anything in this phase.

**Note on automation:** the native `confirm()` dialog behind "Delete preset" (and the pre-existing "Delete project" elsewhere in the app) isn't reliably drivable through this session's browser automation — it auto-dismisses rather than confirming. The delete code path itself (`DELETE /api/presets/[id]`) was instead verified directly via the same endpoint the UI calls, and the UI's own confirm-then-call wiring was verified by inspection (unchanged pattern from `project-card.tsx`'s existing "Delete" action).

## 12. Bugs found and fixed

1. **"Update preset" never appeared after switching tabs.** Root cause: `lastAppliedCustomId` was originally local `useState` inside `PresetsPanel`, but Radix `Tabs` unmounts inactive `TabsContent` by default — switching to the Style tab to tweak a just-applied preset and back reset that state to `null`. Fixed by moving it into the editor store (`lastAppliedCustomPresetId`, ephemeral/non-undo, same pattern as `selectedSubtitleId`), which persists for the life of the editor session regardless of which tab is active. Caught by live UI testing, not by the unit tests (this is exactly the kind of bug pure logic tests can't catch — the tests for the underlying decision logic were already correct).
2. **Lint error in the new save/rename dialog**: `react-hooks/set-state-in-effect` flagged resetting form state inside a `useEffect` keyed on `open`. Fixed using the same "adjust state during render" pattern the pre-existing `DeleteForeverDialog` (trash page) already uses, rather than an effect.
3. **Custom preset card layout**: the "Custom" tag inline next to a longer preset name (e.g. "My Reels Style") wrapped awkwardly across 3 lines. Fixed by moving the "Custom" tag onto the preview thumbnail as a corner badge (matching `ProjectCard`'s existing top-left status-badge convention) and truncating the name to one line.
4. **`src/lib/presets.ts` untestable under `node --test`**: bare `@/types/subtitle` import doesn't resolve under Node's native TS-stripping test runner. Fixed with the same relative+`.ts`-extensioned import fix applied to several other `lib/` files in prior phases — no logic changed, verified by the new tests' exact-match assertions against `BUILT_IN_PRESETS`.

No bugs found in: existing Copy Style, Paste Style, Recommended Styles, Brand Kit, undo/redo, autosave, or export — all explicitly re-verified working, unmodified.

## 13. Limitations

- The task's item 9 called out testing compatibility with "Gujarati legacy projects" and "Hinglish" — custom presets only ever touch `globalStyle`/`animation` (via the exact same `applyPreset` path built-in presets use), never `text`/`hinglishText`/`gujaratiScriptText` or the caption-output-mode logic, so there is no code-level interaction surface between this feature and those systems at all. This was confirmed by inspection (no new code path touches `output-mode.ts`, `hinglish.ts`, or `gujarati-script.ts`) rather than by a live Gujarati/Hinglish project test, since exercising those would mean touching real transcript-language projects for a feature that provably cannot affect them.
- "Update preset" visibility is powered by an exact `JSON.stringify` equality check (same technique the pre-existing "is a built-in preset currently active" highlighting already used) — a per-word style override on an individual caption is intentionally excluded from that comparison (only `globalStyle`/`animation` are preset-derived), which matches how built-in presets already work.

## 14. Final status: **P1 CUSTOM PRESETS PASS**

Custom presets can be created, applied (through the identical path built-in presets use), updated, renamed, and deleted; built-in presets remain immutable and undeletable; persistence survives dashboard navigation, editor reopen, and full packaged-app relaunch with zero database migration; deleting a preset never affects a project that already applied it; system-font metadata and export rendering both verified end-to-end. No other P1 feature was started.
