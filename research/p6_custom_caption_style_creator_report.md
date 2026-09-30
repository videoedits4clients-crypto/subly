# P6 — Custom Caption Style Creator Report

## 1. Task ID

87426 — "P6: Custom Caption Style Creator," plus a follow-up preset-design correction carried over
from Task 86317/85241's P5.1 QA ("Highlight" preset's black `highlightColor`).

## 2. Existing custom preset architecture (audit findings)

Before writing any code, the existing system was audited end to end. The finding: **SUBLY already
had almost the entire Style Creator workflow** — this task's job was mostly to find and fill the
genuine gaps, not build a new system (exactly as the task's own "IMPORTANT PRODUCT PRINCIPLE"
demands).

**Already fully working (verified, not just read):**
- `SubtitlePreset` Prisma model ([prisma/schema.prisma](prisma/schema.prisma)) — `ownerId`,
  `name`, `isBuiltIn` (always `false` in practice), `style`/`animation` (JSON strings).
- Full custom-preset CRUD API: `GET/POST /api/presets`, `PATCH/DELETE /api/presets/:id`
  ([src/app/api/presets/](src/app/api/presets/route.ts)) — list, create, rename, update
  (overwrite style/animation), delete. Name validation (empty/duplicate, case-insensitive) via
  [src/lib/custom-presets.ts](src/lib/custom-presets.ts), shared client + server side.
- A real, tabbed side panel (`Style | Animation | Presets` —
  [src/components/editor/right-panel.tsx](src/components/editor/right-panel.tsx)) — exactly the
  "side panel / inspector" pattern the task recommends over a full-screen modal.
- [StylePanel](src/components/editor/style-panel.tsx): Font (family/size/weight/letter-spacing/
  line-height/case), Colors (text/highlight/opacity), Word highlight (enable/scale), Background
  (color/opacity/radius/padding/box-width), Outline (enable/color/width), Shadow (enable/color/
  blur/offset/opacity), Position (x/y/align/vAlign) — essentially every control Part 3 asks for,
  already implemented, already live-bound to `project.globalStyle`.
- [AnimationPanel](src/components/editor/animation-panel.tsx): entrance/exit/word animations +
  duration, live-bound to `project.animation`. `word: "bg-highlight"` already IS "active word
  background."
- [PresetsPanel](src/components/editor/presets-panel.tsx): built-in preset browser (search,
  8-category filter chips), a real miniature preview per card using the SAME renderer as the
  live editor preview (`styleToTextCss`/`activeWordCss`), a separate "My Styles" section with a
  "Custom" badge, "Save as preset," and (for custom cards) Rename/Delete/"Update preset" (shown
  only once the applied custom preset has actually drifted — this **already was** Part 8's
  "Save Changes vs. Save as New" distinction, just named "Update preset").
- Preset-vs-modification separation (Part 5): applying a preset (`applyPreset` in
  [editor-store.ts](src/store/editor-store.ts)) deep-copies the preset's style/animation into
  `project.globalStyle`/`animation` — built-ins are a hardcoded, module-level TS array
  ([src/lib/presets.ts](src/lib/presets.ts)) that no code path anywhere reads FROM the database
  or writes TO — so "built-ins stay immutable" was already true **by construction**, not by a
  runtime guard.
- Word-level overrides (`sub.words[i].style`) already live completely outside
  `globalStyle`/`animation` and were never touched by save/apply — isolation already correct.
- Export parity: `buildAssDocument()` (the ASS/FFmpeg renderer) takes only
  `globalStyle`/`animation` values — it has no concept of "which preset produced this," so there
  was structurally never a second, custom-style-specific export path.

**Genuinely missing (the actual new work this task did):**
1. **Duplicate** a custom style — no such action existed anywhere.
2. **"Reset changes"** (Part 10) — revert the live editing session back to whatever was applied,
   distinct from the pre-existing per-caption "Reset to default" override-clearing.
3. **Duplicate-name "Replace existing"** offer (Part 6) — a name collision only ever rejected the
   save; there was no path to replace the existing preset instead of picking a new name.
4. The **"Highlight" preset's `highlightColor: #000000`** bug carried over from the P5.1 QA
   finding — invisible on the default black canvas, still unfixed.

## 3. New Style Creator workflow

No new workflow/architecture was introduced — the existing "pick a preset → it becomes the live
style → tweak it in Style/Animation → Save as preset" flow already matched the task's own
five-step goal (choose → customize → preview → save → reuse). The three additions above were
layered directly onto that existing flow:

- **Duplicate**: `CustomPresetCard`'s overflow menu gets a "Duplicate" item. Computes the next
  free "X Copy" / "X Copy 2" / ... name (new `duplicatePresetName()` helper) and calls the
  existing `createCustomPreset` API with a deep copy of the source's style/animation — a real,
  independent new database row, not a client-side alias.
- **Reset changes**: a small "↺ Reset changes" link next to the "Caption Styles" heading, shown
  only when the live style/animation has drifted from whatever was last applied (built-in or
  custom). Clicking it calls the new `resetToLastApplied()` store action, which just re-applies
  the same snapshot `applyPreset` already recorded — so it is itself a normal, undoable
  `commit()`-based action, not a special code path.
- **Replace existing**: when "Save as preset" hits a duplicate name, the dialog still shows the
  inline error (so editing the name remains the default path), and a `sonner` toast additionally
  offers a "Replace" action button that calls the existing "Update preset" logic on the
  conflicting preset instead of creating a new row.

## 4. UI changes

- [src/components/editor/presets-panel.tsx](src/components/editor/presets-panel.tsx):
  - `CustomPresetCard` gained an `onDuplicate` prop and a "Duplicate" menu item (between Rename
    and the Delete separator).
  - A "Reset changes" affordance next to the "Caption Styles" heading, visible only when
    `hasUnappliedChanges` is true.
  - `handleSaveNew` now surfaces a "Replace" toast action on a duplicate-name conflict.
  - New `handleDuplicate` handler.
- No other component was touched — Style/Animation panels, the preset preview renderer, the
  save/rename dialogs, and the "My Styles" section's visual hierarchy were all already correct
  and were left exactly as they were (Part 19: reuse, don't duplicate controls).

## 5. Files changed

- [src/store/editor-store.ts](src/store/editor-store.ts) — `lastAppliedStyleSnapshot` state,
  `resetToLastApplied()` action, `applyPreset()` now records the snapshot, `load()` clears it.
- [src/lib/custom-presets.ts](src/lib/custom-presets.ts) — new `duplicatePresetName()`; error
  message wording aligned to the task's own example (`"X" already exists.`).
- [src/components/editor/presets-panel.tsx](src/components/editor/presets-panel.tsx) — Duplicate
  action, Reset-changes UI, Replace-existing toast flow (see §3/§4).
- [src/lib/presets.ts](src/lib/presets.ts) — "Highlight" preset's `highlightColor` corrected from
  `#000000` to `#FB923C` (see §10).
- Tests: [src/lib/__tests__/custom-presets.test.ts](src/lib/__tests__/custom-presets.test.ts)
  (+8 tests), [src/lib/__tests__/custom-preset-persistence.test.ts](src/lib/__tests__/custom-preset-persistence.test.ts)
  (new, 8 tests, real SQLite), [src/store/__tests__/editor-store-undo-redo.test.ts](src/store/__tests__/editor-store-undo-redo.test.ts)
  (+5 tests).
- [package.json](package.json) — new test scripts, version bump `0.1.4` → `0.1.5`.

No changes to: Whisper, transcription, language policy, segmentation, waveform, project recovery,
SQLite schema/architecture, Electron startup, installer architecture, FFmpeg architecture, upload
validation, dashboard filtering, or the P5.1 caption-rendering (ASS/vector-chip) implementation
itself.

## 6. Controls exposed

No new controls were added — see §2's "already fully working" list. The Style/Animation panels
already exposed every control the existing renderer supports; none were invented, none were
duplicated.

## 7. Save workflow

Unchanged mechanism (`POST /api/presets`), with two additions layered on top: the "Replace"
toast on a name conflict (§3), and `resetToLastApplied` for discarding unsaved tweaks before
deciding whether to save at all.

## 8. Duplicate workflow

`duplicatePresetName()` (pure function, unit-tested) computes a safe, always-non-colliding name;
`handleDuplicate` in the panel calls the existing create API with a deep copy of the source
style/animation. Verified live (dev mode): duplicating "My Yellow Marker" produced "My Yellow
Marker Copy" as an independent database row — confirmed via a direct API listing showing 2
distinct rows with distinct ids, and via the DB-level isolation test in
custom-preset-persistence.test.ts (test 5).

## 9. Rename/delete workflow

Both already existed and were verified working, live, unmodified: renamed a custom preset via
the UI (confirmed via API listing that only the target row's name changed) and deleted a custom
preset via the UI's confirm dialog (confirmed via API listing that the row was gone and the
other custom preset was untouched).

## 10. Built-in immutability

Structural, not just tested: `BUILT_IN_PRESETS` ([src/lib/presets.ts](src/lib/presets.ts)) is a
plain, module-level, hardcoded TypeScript array. No API route, no store action, and no component
in this codebase has a code path that writes into it or reads a `SubtitlePreset` DB row as a
substitute for it — "built-ins are immutable" is true because there is no mechanism that could
violate it, not because of a runtime check that could have a bug. This was proven directly (not
assumed) by tests 8 and 23 in custom-presets.test.ts: apply a built-in, patch the applied copy the
same way `setGlobalStyle` does on every edit, then re-fetch the SAME built-in definition and
assert it's byte-identical (`JSON.stringify` before/after).

**"Highlight" preset color correction** (the P5.1 QA follow-up): `highlightColor` was `#000000`
— literally invisible against SUBLY's default black composition background, so the preset's own
described effect ("Background box sweeps behind the active word") never actually appeared for
anyone using the default canvas. Changed to `#FB923C` (vivid orange), chosen to not collide with
any other Highlight-category preset's `highlightColor` (verified by test 22, which asserts no two
Highlight-category presets share a color). This is a **preset-definition change only** — the
P5.1 ASS/vector background-chip renderer ([src/lib/subtitles/ass.ts](src/lib/subtitles/ass.ts))
was not touched. Verified in all three required places:
- **Editor live preview**: applying "Highlight" now shows a real orange chip behind the active
  word (screenshot-confirmed live in the browser — previously showed nothing, matching the
  original bug report).
- **Active-word highlighting**: the chip tracks the active word exactly as before (same
  `wordHighlight`/`bg-highlight` mechanism, untouched).
- **Exported MP4**: a real export of the corrected preset was extracted frame-by-frame and shows
  the identical orange chip the live preview shows — preview/export parity confirmed, not assumed.
- **Immutability after the fix**: test 23 re-proves byte-identical built-in definition
  before/after an applied-and-edited copy, specifically for "Highlight" post-correction.
- **Existing-project compatibility**: projects that already have `highlightColor: "#000000"`
  baked into their own `globalStyle` (from having applied the OLD "Highlight" preset before this
  fix) are completely unaffected — `applyPreset` always deep-copies at the moment of application,
  so a project's stored style has never held a live reference to `BUILT_IN_PRESETS`. Changing the
  preset's definition going forward changes nothing about styles ALREADY applied and saved; a user
  would simply see the new orange chip only if they re-apply "Highlight" from the picker.

## 11. Custom style isolation

Verified two ways: the pure-function suite (custom-presets.test.ts tests 9/10/20) and a REAL,
temporary-SQLite-backed suite (custom-preset-persistence.test.ts tests 3/4/5/8) — updating,
deleting, or duplicating one custom preset's row never touches another's, two different owners'
custom presets never leak into each other's list, and duplicating-then-editing the copy never
mutates the source. Also verified live: creating "My Yellow Marker" and "My Yellow Marker Copy,"
renaming one, deleting the other, and confirming (via direct API listing after each step) that
only the intended row ever changed.

## 12. Animation behavior

Untouched — `AnimationPanel` already wrote directly to `project.animation` / per-caption
animation overrides, already flows through the same `applyPreset`/save/apply mechanism as style,
and is captured by "Save as preset" exactly like style is (`{ name, style: project.globalStyle,
animation: project.animation }`). Test 12/13 in custom-presets.test.ts and the export-parity test
(§14) both exercise a custom `AnimationConfig` (including `word: "bg-highlight"`) round-tripping
and rendering correctly.

## 13. Preview/export parity

The preset-card preview (`PresetPreview` in presets-panel.tsx) already used the exact same
`styleToTextCss`/`activeWordCss` functions the live main editor preview uses — no separate/fake
thumbnail renderer exists for custom styles, satisfying Part 13 by construction. Export parity
(Part 14) is proven both structurally (`buildAssDocument()` has no preset-origin parameter at
all — see §2) and empirically: a new test (custom-presets.test.ts test 24) builds a genuinely
custom `SubtitleStyle`/`AnimationConfig` combination (cyan text, glow-style shadow, Archivo font,
`bg-highlight` word animation) that matches no built-in preset, runs it through the real
`buildAssDocument()`, and asserts a valid ASS document with the custom font and a real background-
chip drawing event — i.e. the exact same renderer, producing the exact same primitives, for a
combination that was never one of the 45 built-ins.

## 14. Persistence

- **Real SQLite, not mocked**: custom-preset-persistence.test.ts runs every scenario against a
  temporary copy of the real `prisma/template.db` through a real `PrismaClient` — including test
  2, which explicitly disconnects and opens a FRESH `PrismaClient` against the same file, standing
  in for a full app restart.
- **Live, in the browser**: saved a custom preset, reloaded the editor page, and confirmed (via
  direct API fetch) the preset and its exact style/animation were still there.
- **Packaged Windows app**: see §19 — the mandatory real-restart verification.

## 15. Tests

490 tests pass in total (469 pre-existing baseline + 21 new):
- `editor-store-undo-redo.test.ts` (+5): `resetToLastApplied` no-op before any apply; exact
  revert of a tweaked style/animation; itself undoable via the normal undo stack; always targets
  the MOST recently applied preset; cleared on `load()`.
- `custom-presets.test.ts` (+8): `duplicatePresetName` — base case, incrementing suffix, never
  produces a name that would itself collide, deep-copy isolation; "Highlight" preset no longer
  black, doesn't collide with sibling Highlight-category presets, remains immutable post-fix;
  custom-style export parity (§13).
- `custom-preset-persistence.test.ts` (new, 8 tests, real temp SQLite): create+read round-trip,
  restart persistence (fresh PrismaClient/same file), isolation on update, isolation on delete,
  duplicate-workflow-against-real-rows, duplicate-name-validation-against-real-DB-state,
  `isBuiltIn` filtering, cross-owner isolation.

Maps directly onto Part 22's 15-item list: 1 (built-in immutability — tests 8/23 custom-presets +
structural argument §10), 2 (creation — test 1 persistence), 3 (persistence — test 2 persistence),
4 (rename — live QA §9 + existing test 5 custom-presets), 5 (delete — live QA §9 + existing test
6/10), 6 (duplication — tests 17-20 custom-presets + test 5 persistence + live QA §8), 7
(duplicate-name validation — test 15/19 custom-presets + test 6 persistence + live QA Replace
flow), 8 (deep-copy isolation — test 20 custom-presets + test 5 persistence), 9 (reset — tests
29-33 editor-store), 10 (animation persistence — test 12 custom-presets), 11 (word-level override
isolation — structural, §2/§12; never captured by save), 12 (custom style export — test 24
custom-presets), 13 (restart persistence — test 2 persistence + §19 packaged), 14 (apply doesn't
mutate stored definition — test 4 custom-presets + `extractStyleForApply`'s own deep-copy
contract), 15 (all 45 built-ins remain valid — pre-existing preset-library.test.ts, unmodified,
still passing).

## 16. Typecheck

`npm run typecheck` — clean, 0 errors, at every step of this task.

## 17. Lint

`npm run lint` — 0 errors, 5 warnings, identical to the pre-existing baseline (no new warnings).

## 18. Production build

`next build` (as a step of `npm run electron:pack`) completed successfully — see §19 for the full
packaged-build outcome.

## 19. Packaged Windows QA

Built via `npm run electron:pack` (clean → PyInstaller worker build → `next build` →
electron-builder/NSIS) — succeeded end to end, producing `release\SUBLY Setup 0.1.5.exe`
(560,519,832 bytes) and its `.blockmap`. Verified on the built file itself (not source config):
`FileVersion 0.1.5`, `ProductVersion 0.1.5`, `ProductName SUBLY`, `CompanyName Akshay Creations`.

Silent-installed to a disposable directory, launched the real packaged `SUBLY.exe` (confirmed via
its own startup log pointing at the real production DB, `C:\Users\User\AppData\Roaming\subs\
subly.db`). Full flow executed against the running packaged app:

1. **Create project** → disposable QA project created, video uploaded, **real local Whisper
   transcription** ran (not mock) and reached `READY`.
2. **Apply built-in "Highlight" preset** → confirmed the packaged build's own bundled
   `presets.ts` already has the corrected `highlightColor: "#FB923C"` (read directly from the
   running app, not assumed).
3. **Customize** → changed to a cyan chip + yellow text combination.
4. **Save as custom style** → "My Creator Style" created via `POST /api/presets`, confirmed
   `200` with the correct id/name.
5. **Export** → succeeded (`DONE`, 655,926 bytes). The exported MP4 was extracted frame-by-frame
   and shows the exact cyan-chip/yellow-text customization that was applied — preview/export
   parity confirmed in the packaged build, not assumed from the dev-mode result.
6. **Duplicate** → "My Creator Style Copy" created as an independent second row (distinct id).
7. **Rename** → the original renamed to "My Renamed Creator Style"; confirmed via a fresh list
   that only the intended row's name changed.
8. **Delete** → the duplicate deleted; confirmed only 1 custom preset (the renamed original)
   remained.
9. **Restart** → all `SUBLY.exe` processes force-stopped (simulating a full app close) and
   `SUBLY.exe` relaunched fresh (new local server port, same on-disk database). Re-fetched
   `/api/presets`: **"My Renamed Creator Style" was still there**, with its exact
   `highlightColor`/`color` intact, and was successfully **re-applied** to the project
   (`PATCH` → `200`, confirmed the project's `globalStyle` now matched the custom preset exactly)
   — the mandatory "apply → restart → still exists → reapply" contract, verified live.
10. **Built-in immutability, post-restart** → re-read `presets.ts`'s "Highlight" definition after
    all of the above: still `highlightColor: "#FB923C"`, `color: "#FFFFFF"` — completely
    unaffected by every custom-preset operation performed against it.

Cleanup: the remaining custom preset and the disposable QA project were both removed via the
app's own delete/Trash flow (never a direct database edit) — confirmed via a final `/api/presets`
listing showing 0 custom presets. The app was fully stopped; the QA install directory and its
Desktop/Start-Menu shortcuts were removed afterward. The built installer itself (`release/`,
gitignored) was left in place as the task's own deliverable.

## 20. Production data integrity

Baseline captured **before** packaged QA from the real production database
(`%APPDATA%\subs\subly.db`, backed up to `subly.db.bak-pre-p6-style-creator-qa`): Project 18,
ExportJob 46, Subtitle 2250, VideoAsset 18, SubtitlePreset 0. All dev-mode QA in this task (§8/§9/
§10/§11/§14) ran against the isolated `prisma/dev.db` in `SUBLY_DESKTOP=1` mode — never touched
production. The packaged-app QA (§19) necessarily used the real production DB path; a full
row-level comparison (every column except `updatedAt`) after cleanup shows the production database
is **byte-for-byte identical** to the pre-QA baseline:

| Table | Before | After |
|---|---|---|
| Project | 18 | 18 |
| ExportJob | 46 | 46 |
| Subtitle | 2250 | 2250 |
| VideoAsset | 18 | 18 |
| SubtitlePreset | 0 | 0 |

## 21. Known limitations

- The "Replace existing" duplicate-name flow surfaces as a toast action (using the app's existing
  `sonner` toast system, per Part 19's "reuse existing controls") rather than a second modal
  dialog stacked on top of the save dialog — a deliberate simplification, not a missing capability;
  both paths (edit the name, or replace) are available at all times the conflict is shown.
- "Reset changes" reverts to the most recently *applied* preset (built-in or custom), not to an
  arbitrary earlier point in the edit history — for finer-grained undo, the existing Ctrl+Z/Ctrl+
  Shift+Z undo stack (unmodified by this task) remains available and composes correctly with Reset
  changes (test 31 proves Reset changes is itself one ordinary undo step).
- No new "duplicate" REST endpoint was added — duplication is composed client-side from the
  existing create endpoint (deep-copied style/animation + a computed unique name), consistent
  with the task's "reuse existing systems" instruction and verified to produce a fully independent
  server-side row (§8, §11).
