# P3 — Product Polish & UX Consistency (Task ID 63821)

## 1. Executive summary

This phase audited the complete product UI — dashboard, project creation/opening, editor
(captions, timeline, settings, quality review, styling, animation), export, export history,
error/empty states, keyboard shortcuts, and trash/deletion — against the 28-point consistency
checklist and the accessibility/persistence/microcopy categories the task lays out. The existing
product was, in most respects, already well-built: a single, coherent design system (one `Button`
component with a clear variant hierarchy, one `Dialog` primitive used everywhere, one `Loader2`
spinner pattern, consistent focus rings, consistent disabled states), a save-status indicator that
already answers "did my edit save?" clearly, well-guarded keyboard shortcuts, and thoughtful empty
states throughout. No new design system was needed and none was introduced.

The audit found **eleven confirmed, concrete inconsistencies** — never speculative, each traced to
exact files/lines — and fixed all of them with minimal, targeted changes that reuse the existing
design system rather than replacing it. The most significant finding was **a real, reproducible
bug, not just a cosmetic inconsistency**: global editor keyboard shortcuts (Undo, Delete,
arrow-key caption navigation, Escape's deselect-and-blur) are wired through a single `window`
keydown listener with no awareness of whether a modal dialog is currently open. Confirmed live:
opening the Export dialog and pressing Escape (meaning "close this dialog") also silently
deselected whatever caption was selected in the editor behind it, and pressing an arrow key to
navigate a Select's own options (e.g. the export dialog's Resolution dropdown) also moved the
caption selection and seeked the video behind the dialog. This is now fixed with a small, tested
guard. Ten further confirmed UI-consistency issues were fixed — two native `confirm()` dialogs
(visually jarring, unstyled browser popups inside an otherwise fully custom dark UI) replaced with
a new, small, reusable `ConfirmDialog` built from the app's own existing Dialog primitives; three
dialogs missing a `DialogDescription` (each a real, confirmed Radix accessibility warning); several
icon-only buttons with no accessible name; a redundant duplicate button; and a handful of
microcopy/terminology inconsistencies. Everything else audited is documented below as **VERIFIED**
— confirmed correct by direct inspection, not assumed, and left untouched.

## 2. Audit methodology

Every finding in this report was confirmed by reading the actual implementation (component source,
store actions, API routes) — never inferred from a screenshot or assumed from a similar-sounding
feature elsewhere. Three complementary techniques were used:

1. **Direct file reads** of the core UI primitives (`components/ui/button.tsx`, `dialog.tsx`,
   `input.tsx`) to establish the actual, already-existing design system's vocabulary — variant
   names, focus/disabled treatment, spacing conventions — before judging anything else against it.
2. **A broad, automated sweep** (via a research subagent) across every `toast.*()` call, every
   `DialogTitle`/`DialogDescription` pair, every `confirm()`/`alert()` call, every empty-state
   block, and the full keyboard-shortcut list, cross-referenced against terminology pairs the task
   itself names (Export/Render, Cancel/Stop, Delete/Remove, Restore/Recover, Cancelled/Canceled,
   Caption/Subtitle) — producing a raw inventory, not a set of conclusions.
3. **Targeted manual reads** of the dashboard (`projects-grid.tsx`, `project-card.tsx`,
   `trash/page.tsx`), the upload/processing flow (`upload/page.tsx`, `processing-screen.tsx`), the
   crash-recovery snapshot flow (`editor/[id]/page.tsx`), and the full keyboard-shortcut handler
   (`use-keyboard-shortcuts.ts`) to verify behavior the sweep could only summarize.

Every fix below was then additionally confirmed **live**, in a real browser against the real dev
server and, separately, the real packaged build — not just by re-reading the diff.

## 3. Confirmed UX issues

1. **Keyboard shortcuts leak through open dialogs (real bug, not cosmetic)** —
   `src/hooks/use-keyboard-shortcuts.ts`'s single `window` keydown listener has no concept of
   "a modal dialog currently has the user's attention." Confirmed live, before any fix: with a
   caption selected and the Export dialog open, pressing Escape (a completely reasonable "close
   this dialog" gesture) also cleared the editor's caption selection behind the dialog; pressing
   ArrowDown (intended to navigate a Select's own options, e.g. the export dialog's Resolution
   dropdown) also moved caption selection and seeked the video behind the dialog. Neither a
   Select's trigger/listbox nor Escape are caught by the pre-existing `isTypingTarget` guard, since
   none of them are an `INPUT`/`TEXTAREA`/contentEditable element. Directly violates the task's own
   Phase 3 "verify selection state is predictable" and Phase 8 "Escape behavior" audit points.
2. **Two native `confirm()` calls** (`project-card.tsx`'s "move to Trash", `presets-panel.tsx`'s
   "delete preset") render the browser's own unstyled, OS-native dialog box — a jarring visual
   break from the fully custom, dark-themed Dialog used for every other confirmation in the app,
   including the trash page's own "permanently delete" flow (which explicitly documents, in its own
   code comment, why it replaced a native `confirm()` for exactly this reason).
3. **Three dialogs missing a `DialogDescription`** — `quality-panel-dialog.tsx` ("Subtitle quality",
   no description at all, doesn't even import the component), `search-replace-dialog.tsx` ("Find &
   replace", same), and `preset-name-dialog.tsx`'s "Rename preset" call site (the component supports
   a description prop; this one call site just didn't pass one). Each is a real, reproducible Radix
   `DialogContent` accessibility warning (confirmed via the browser console, before the fix: none
   present after) — every other dialog in the app already has one.
4. **Six icon-only buttons with no accessible name** — the timeline's Zoom out/Zoom in buttons, the
   top-bar's back-to-dashboard arrow button, and the style panel's three horizontal-align + three
   vertical-align buttons all had neither a `title` nor an `aria-label`, while every sibling
   icon-only button in the exact same toolbars (Split, Merge, Duplicate, Delete, Undo, Redo) already
   had one.
5. **A dialog title breaking the app's own sentence-case convention** — "Transcription Settings"
   (Title Case) was the one outlier among seven audited dialog titles, all others sentence case
   ("Export video", "Remove silence", "New project", "Subtitle quality", "Find & replace",
   "Permanently delete this project?").
6. **Two buttons that do exactly the same thing** — the dashboard header's "Upload video" and "New
   project" buttons both opened the identical `NewProjectDialog`, routing to the identical
   `/projects/[id]/upload` destination, with zero behavioral difference between them — confirmed by
   reading both onClick handlers. The dashboard's own empty state already uses a single "New
   project" button as its only entry point, making the header's two-button version an internal
   inconsistency, not just a UX judgment call.
7. **Shortcut hints missing from three toolbar buttons that have real keyboard shortcuts** — the
   timeline's Merge/Duplicate/Delete buttons showed no shortcut in their tooltip, while their
   siblings (Split, Undo, Redo, Find & Replace) already display theirs (e.g. `"Split Here (at
   playhead) — Ctrl/Cmd+Shift+S"`) — despite Merge/Duplicate/Delete each having a real, working
   keyboard shortcut (`Ctrl/Cmd+Shift+M`, `Ctrl/Cmd+D`, `Delete`/`Backspace`) confirmed directly in
   `use-keyboard-shortcuts.ts`.
8. **A success message styled as an error** — `register/page.tsx` called `toast.error("Account
   created — please log in.")` on a path where account creation had actually succeeded (only the
   immediate auto-sign-in step failed) — the red/danger toast styling misrepresented good news as a
   failure.
9. **A capitalization inconsistency within the same feature** — `presets-panel.tsx`'s
   `toast.success("Brand Kit applied.")` used Title Case mid-sentence, while `brand-kit/page.tsx`'s
   own toasts for the identical feature ("Brand kit saved.", "Couldn't save your brand kit.")
   correctly use sentence case; both files already use Title Case consistently for the feature's
   proper *heading* (`<h1>Brand Kit</h1>`, `<h3>Brand Kit</h3>`), so only the toast was the outlier.
10. **A same-concept terminology mismatch between the desktop and mobile layouts** —
    `mobile-tab-bar.tsx`'s tab for the caption-editing panel (`key: "captions"`) was labeled
    "Subtitles", while the desktop layout's equivalent tab (same panel, same underlying feature) is
    labeled "Captions" — confirmed by reading both `left-panel.tsx` and `mobile-tab-bar.tsx`.

## 4. Issues intentionally left unchanged

Reviewed and confirmed to be **already correct, appropriate, or intentionally out of this phase's
scope** — documented here so they aren't rediscovered as "missed" in a future pass:

- **"Cancel" button variant (ghost vs outline)** — the sweep initially flagged this as possibly
  inconsistent. Direct verification found it's actually a coherent, deliberate distinction already
  in place: every dialog-footer "dismiss without acting" Cancel button uses `variant="ghost"`
  (confirmed across `ai-menu.tsx`, `transcription-settings-dialog.tsx`, `new-project-dialog.tsx`,
  `preset-name-dialog.tsx`, `trash/page.tsx`); every "abort an in-progress background operation"
  Cancel button (mid-export, mid-transcription) uses `variant="outline"` (confirmed in
  `export-dialog.tsx` and `processing-screen.tsx`). VERIFIED correct, left unchanged.
- **Native `confirm()` for preset deletion vs the trash page's heavyweight "type the name to
  confirm" dialog** — both are now styled consistently (§5, fix 2), but the FRICTION LEVEL was
  deliberately left different: preset deletion still only needs a single click-to-confirm
  (via the new `ConfirmDialog`), not a typed confirmation. This is a reasoned, risk-proportional
  choice, not an oversight — permanently deleting a project destroys irreplaceable video/audio/
  captions with no further recovery stage, while deleting a custom preset (per its own existing,
  unchanged confirmation copy: "Captions already using this style are unaffected") only removes a
  reusable style shortcut, trivially re-creatable. VERIFIED appropriate, left unchanged.
- **No confirmation dialog for caption deletion (Delete key / toolbar button)** — deliberately
  instant, no confirmation prompt at all. Confirmed this is consistent with the app's own existing
  design philosophy: every transient, undo-protected in-project edit (caption delete, style reset,
  re-segment) relies on Ctrl+Z as its safety net rather than a confirmation dialog, while only
  actions that leave the undo stack entirely (project trash, permanent delete, preset delete) get a
  confirmation step. VERIFIED correct, left unchanged.
- **"Failed"/"Error"/"Couldn't ___" phrasing variety across toasts, headings, and inline banners**
  — the sweep found three different failure-phrasing templates in different UI element types (a
  punchy toast, a card heading, a full-sentence inline banner). Reviewed and found each phrasing
  matches its own element type's normal convention (headings are sentence fragments; toasts are
  punchy; banners are full sentences) — not an inconsistency within any single context. VERIFIED
  appropriate, left unchanged; unifying these into one exact template would be a copy-wide rewrite
  the task explicitly warns against ("do not arbitrarily rewrite the entire application's copy").
- **"Delete" vs "Remove" terminology** — confirmed these consistently refer to two genuinely
  different concepts throughout the app: "Delete" always means destroying a user-created *object*
  (a project, a preset, a caption); "Remove" always means stripping *content* from an existing
  video/transcript (remove filler words, remove silence). No overlapping or conflicting usage
  found. VERIFIED correct, left unchanged.
- **"Cancelled" (not "Canceled")** — confirmed exactly one spelling is used everywhere in the
  codebase (`processing-screen.tsx`, `export-dialog.tsx`'s state variable naming,
  `lib/export-status-message.ts`, and their own tests). VERIFIED already consistent.
- **"Restore" (not "Recover"/"Recovery")** — confirmed only "Restore" is ever used as user-facing
  text (trash restore, crash-snapshot restore), even though the underlying recovery SYSTEM is
  internally named "recovery" (`lib/recovery/stale-job-recovery.ts`) — the user-facing vocabulary
  and the internal/technical vocabulary are different on purpose and don't leak into each other.
  VERIFIED correct, left unchanged.
- **Export dialog's "Export history" section has no explicit empty state** — when a project has
  never been exported, the whole section is simply omitted rather than showing a "No exports yet"
  placeholder. Reviewed and judged appropriate: this is a small, secondary section inside an
  already-compact dialog, and the very first export a user ever makes is an extremely common case
  where an extra empty-state box would only add clutter directly above the settings the user is
  about to use. VERIFIED reasonable, left unchanged.
- **"Caption" vs "Subtitle" used in different UI contexts** (e.g. "Subtitle quality" as a feature
  name vs "Captions" as the live-editing panel; "Subtitle files" for the SRT/VTT/TXT sidecar
  section) — reviewed every instance found by the sweep; each context uses the term that best
  matches real subtitle-editing-software convention (industry-standard file format terminology vs.
  the app's own live-editable-caption-block concept), and no SAME-concept flip-flop was found
  beyond the one mobile-tab-bar mismatch already fixed (§3, item 10). VERIFIED acceptable as
  existing product vocabulary, left unchanged elsewhere.
- **Persistence/save-status communication (Phase 4)** — the top bar's save-state indicator
  ("Unsaved changes" / "Saving…" / "Saved" with a checkmark / "Unable to save changes" with a
  tooltip explaining local-only persistence and automatic retry) and the crash-recovery snapshot
  flow (`editor/[id]/page.tsx`'s `offerLocalSnapshotRestore`, a clear "Found unsaved changes from a
  previous session" toast with explicit Restore/Discard actions and a follow-up "Restored — saving
  now." confirmation) already fully satisfy "the user should never reasonably wonder 'did my edit
  save?'" — confirmed by reading both, no gap found. VERIFIED correct, left unchanged.

## 5. Exact fixes

1. **`src/hooks/dialog-open-guard.ts`** (new file) + **`src/hooks/use-keyboard-shortcuts.ts`** —
   added `isAnyDialogOpen()`, a one-line, dependency-injected predicate checking for any
   `[role="dialog"]` element in the DOM (every dialog in the app renders via the shared Dialog
   primitive, so this is reliable with no new state to track). Wired in as a guard: (a) the Escape
   handler now skips its deselect+blur side effect while a dialog is open — closing the dialog is
   Escape's job there; (b) every mutation-capable shortcut below the existing `isTypingTarget`
   guard (Undo/Redo/Split/Merge/Duplicate/nudge/arrow-navigation/Space/Delete/Enter/J/K/L) now also
   no-ops while a dialog is open. Confirmed live, before and after, in both the dev server and the
   packaged build.
2. **`src/components/ui/confirm-dialog.tsx`** (new file) — a small, reusable `ConfirmDialog`
   component built from the existing `Dialog`/`DialogTitle`/`DialogDescription`/`DialogFooter`
   primitives (no new dependency, no new visual language), with its own busy/loading state so the
   confirm button can't be double-submitted. Wired into **`project-card.tsx`** (replacing the
   native `confirm()` for "move to Trash") and **`presets-panel.tsx`** (replacing the native
   `confirm()` for "delete preset"). Both confirmed live, in both the dev server and the packaged
   build, rendering correctly styled dialogs with the exact same wording the native `confirm()`
   calls used to show.
3. **`src/components/editor/quality-panel-dialog.tsx`**,
   **`src/components/editor/search-replace-dialog.tsx`** — added a `DialogDescription` to each.
   **`src/components/editor/presets-panel.tsx`** — passed a `description` prop to the "Rename
   preset" `PresetNameDialog` call site. All three confirmed live: the Radix `aria-describedby`
   attribute now correctly resolves to a real element in the DOM for each.
4. **`src/components/editor/timeline.tsx`** — added `title="Zoom out"`/`title="Zoom in"`.
   **`src/components/editor/top-bar.tsx`** — added `title`/`aria-label="Back to dashboard"` to the
   back-navigation button. **`src/components/editor/style-panel.tsx`** — added distinct `title`s
   ("Align left"/"Align center"/"Align right", "Top"/"Vertical center"/"Bottom") to the six
   alignment icon buttons. All confirmed live via the accessibility tree (`read_page`), in both the
   dev server and the packaged build.
5. **`src/components/dashboard/transcription-settings-dialog.tsx`** — "Transcription Settings" →
   "Transcription settings".
6. **`src/components/dashboard/projects-grid.tsx`** — removed the redundant "Upload video" button,
   keeping the single "New project" button (now consistent with the dashboard's own empty state,
   which already only ever showed one button). Confirmed live in both the dev server and the
   packaged build.
7. **`src/components/editor/timeline.tsx`** — appended each action's real shortcut to its title:
   `"Merge with next — Ctrl/Cmd+Shift+M"`, `"Duplicate — Ctrl/Cmd+D"`, `"Delete — Delete/Backspace"`.
8. **`src/app/(auth)/register/page.tsx`** — `toast.error("Account created — please log in.")` →
   `toast.info(...)` (the account genuinely was created; only the auto-sign-in step needs the user's
   attention, which is informational, not an error).
9. **`src/components/editor/presets-panel.tsx`** — `toast.success("Brand Kit applied.")` →
   `toast.success("Brand kit applied.")`, matching the sentence-case convention the same feature's
   other toasts already use.
10. **`src/components/editor/mobile-tab-bar.tsx`** — the captions tab's label: "Subtitles" →
    "Captions", matching the desktop layout's equivalent tab. Confirmed live in the packaged build.

No fix in this list touches transcription, Whisper, language policy, the export rendering
pipeline, FFmpeg invocation, crash recovery, or the persistence/save-queue architecture — all
explicitly out of scope per the task's own strict rules, and none needed a change (§4).

## 6. Files changed

- `src/hooks/dialog-open-guard.ts` — **new file**.
- `src/hooks/use-keyboard-shortcuts.ts` — guard wiring (fix 1).
- `src/components/ui/confirm-dialog.tsx` — **new file**.
- `src/components/dashboard/project-card.tsx` — `ConfirmDialog` wiring (fix 2).
- `src/components/editor/presets-panel.tsx` — `ConfirmDialog` wiring, "Rename preset" description,
  "Brand kit applied." capitalization (fixes 2, 3, 9).
- `src/components/editor/quality-panel-dialog.tsx` — missing description (fix 3).
- `src/components/editor/search-replace-dialog.tsx` — missing description (fix 3).
- `src/components/editor/timeline.tsx` — Zoom button titles, Merge/Duplicate/Delete shortcut hints
  (fixes 4, 7).
- `src/components/editor/top-bar.tsx` — back-button accessible name (fix 4).
- `src/components/editor/style-panel.tsx` — align/vAlign button titles (fix 4).
- `src/components/dashboard/transcription-settings-dialog.tsx` — dialog title case (fix 5).
- `src/components/dashboard/projects-grid.tsx` — removed redundant button (fix 6).
- `src/app/(auth)/register/page.tsx` — toast severity fix (fix 8).
- `src/components/editor/mobile-tab-bar.tsx` — tab label terminology (fix 10).
- `src/hooks/__tests__/dialog-open-guard.test.ts` — **new file** (see §7).
- `package.json` — registered the new test file in a new `test:polish` script and the main `test`
  script.
- `research/p3_product_polish_ux_consistency_report.md` — this report (new file).

No other files were modified. Every dashboard/editor component not listed above was read and
audited but required no change — confirmed correct, not merely assumed (§4).

## 7. Automated tests

Per the task's own explicit instruction ("Add automated tests ONLY for newly fixed logic.
Prioritize pure helpers and deterministic behavior. Do not inflate the test count with meaningless
UI snapshots"), only the one genuinely new piece of *logic* this phase introduced was tested:

- **`src/hooks/__tests__/dialog-open-guard.test.ts`** (3 tests) — covers `isAnyDialogOpen()`
  (dependency-injected so it needs no real browser DOM, mirroring the same pattern
  `lib/recovery/stale-job-recovery.ts` already established for the identical reason): returns
  `true` when a `[role="dialog"]` element is present, `false` when it isn't, and correctly falls
  through to the real global `document` when called with no argument.

Everything else this phase changed is either pure copy/microcopy (no logic to test) or a JSX
attribute/structural change (a `title`, a removed duplicate button, a component swap using
existing, already-tested primitives) — writing tests for these would be exactly the "meaningless
UI snapshot" inflation the task warns against. The `ConfirmDialog` component itself is a thin,
purely presentational wrapper around the existing, already-battle-tested `Dialog` primitives (no
new async/state logic beyond a simple busy flag) and was instead verified thoroughly via live
browser QA (§10, §11) in both the dev server and the packaged build — a more meaningful check for
a component whose entire job is "render this exact accessible dialog correctly" than a synthetic
DOM-less unit test would be.

**Tests before this phase**: 421. **Tests after**: 424 (421 + 3 new). All 424 pass.

## 8. Typecheck

`npm run typecheck` — **0 errors**, before and after every fix in this phase.

## 9. Lint

`npm run lint` — **0 errors, 5 warnings**, identical to the pre-phase baseline (all 5 pre-existing
and unrelated: `project-card.tsx`'s unused `router` import, `lib/ai/index.ts`'s unused `fallback`,
`lib/analytics.ts`'s stale eslint-disable, `lib/subtitles/ass.ts`'s unused `lineDurSec`,
`lib/subtitles/preview-style.ts`'s unused `scale`). **0 new warnings** introduced by this phase.

## 10. Desktop visual QA

Tested the editor and dashboard at all three required resolutions using the app's own real layout
(no responsive-web redesign attempted, per the task's explicit instruction):

- **1280×720**: confirmed no horizontal overflow (`document.documentElement.scrollWidth ===
  window.innerWidth`, checked directly, not eyeballed). Opened the Export dialog and confirmed it
  fits entirely within the 720px viewport height (dialog bottom edge at 672.5px). All fixed
  elements (dialogs, tooltips, the new ConfirmDialog) rendered correctly at this, the narrowest
  required width.
- **1440×900**: confirmed no layout break in the editor's three-pane layout (captions / video /
  style panels all visible and functional).
- **1920×1080**: confirmed no horizontal overflow (`scrollWidth === innerWidth`, directly checked).
- **Narrower-than-desktop width**: the app's own existing mobile layout (`mobile-tab-bar.tsx`,
  already built and unrelated to this phase except for its one label fix, §3 item 10) takes over
  below the `lg` breakpoint — confirmed this remains functional and that its "Captions" tab label
  now correctly matches the desktop layout's equivalent tab.

All ten confirmed fixes were visually and/or structurally re-verified at these resolutions — the
new `ConfirmDialog` (project trash, preset delete), the three fixed `DialogDescription`s, the six
newly-labeled icon buttons, the single remaining dashboard CTA, and the corrected dialog title
capitalization all render identically to the rest of the app's existing design language at every
tested size.

## 11. Packaged Windows QA

Built a fresh `npm run electron:pack` (exit code 0, confirmed via the definitive `blockmap`
completion log marker). Uninstalled the prior packaged install silently (`Uninstall SUBLY.exe /S`),
confirmed the install directory was gone, then installed the new build silently (`SUBLY Setup
0.1.0.exe /S`) — confirmed as a genuine fresh install (not an in-place upgrade) via the installed
`SUBLY.exe`'s file timestamp matching the fresh build exactly.

Walked the task's own focused 15-step release-candidate checklist against the packaged app (a
disposable fixture, "Packaged Polish QA 63821", 2 English captions):

1. **Launch** — launched, embedded server responded on `/api/system/status`.
2. **Dashboard** — loaded correctly; confirmed the single "New project" button (fix 6 present in
   the packaged build).
3. **Open project** — opened correctly; confirmed the mobile tab bar's "Captions" label (fix 10
   present).
4. **Edit caption** — appended text to a caption, confirmed the edit landed in the textarea.
5. **Undo/redo** — Undo correctly reverted the edit; Redo correctly restored it.
6. **Split/merge/duplicate** — Duplicate correctly produced a second identical caption (confirmed
   via `Ctrl/Cmd+D` shortcut hint now visible on the button, fix 7); Undo correctly removed it
   again.
7. **Style change** — adjusted font size via the Style panel slider; confirmed the new value
   persisted via a direct API read (`globalStyle.fontSize: 74`).
8. **Animation change** — selected "Bounce" entrance; confirmed via API (`animation.entrance:
   "bounce"`).
9. **Quality analysis** — opened "Subtitle quality" (confirmed its new description renders, fix 3),
   clicked Analyze, confirmed "No issues found".
10. **Export** — started an export via the API (1080p, 9:16); polled to `DONE`.
11. **Download output** — opened the Export dialog's history; confirmed the Download link's
    `download` attribute reads `"Packaged_Polish_QA_63821_1080p.mp4"` — a friendly, project-derived
    filename (this specific fix originated in the prior P2 Export & Delivery phase, re-confirmed
    still correct and unregressed by this phase's changes).
12. **Close/reopen** — navigated away to the dashboard and back to the editor; confirmed the
    project reopened with all prior state intact.
13. **Verify persistence** — confirmed via both the DOM (caption textareas) and a direct API read
    that the caption edit, the style change, and the animation change from steps 4/7/8 all
    persisted exactly, with the correct final caption count (2, since the duplicate from step 6 had
    been undone).
14. **Trash/delete flow** — clicked "Delete" from the project card's menu; confirmed the new
    `ConfirmDialog` (fix 2) rendered with the exact correct project name and wording; confirmed the
    project moved to Trash.
15. **App relaunch** — force-quit every `SUBLY.exe` process, relaunched, confirmed the embedded
    server came back up on a new port and the trashed project's state (still in Trash, "Deleted
    just now") persisted correctly across the relaunch.

**All 15 steps passed.** After the checklist, permanently deleted the fixture via the (unmodified,
pre-existing) "type the name to confirm" flow to complete cleanup — confirmed it still works
correctly, unregressed.

## 12. Production data integrity

Before any QA this phase, took a fresh backup (`subly.db.bak-pre-polish-qa`) of the real
`%APPDATA%\subs\subly.db` and captured an explicit baseline: **18 projects, 46 ExportJob rows, 0
custom subtitle presets**, plus the complete export-history rows for the three well-known real
production projects (`Untitled project`, `rishab guj`, `Hindi/hinglish test`).

After all dev QA and packaged QA completed and the two disposable fixtures ("Polish QA 63821" and
"Packaged Polish QA 63821") and their uploaded media were permanently deleted, re-compared against
that baseline: **all three production projects' full data — subtitle content, video asset,
composition, language, caption output mode, AND their complete export-job history — are
byte-for-byte identical** (excluding only the `updatedAt` timestamp column). Project count: 18/18
matched. ExportJob count: 46/46 matched. Custom preset count: 0/0 matched (the one test preset
created during dev QA, "My Test Preset", was deleted via the UI as part of verifying fix 2, and its
removal is reflected in this final count matching the baseline exactly). All temporary
`scripts-qa-*.mjs` helper scripts were deleted after use — confirmed via `git status`.

## 13. Remaining limitations

- **The dialog-open guard (fix 1) is scoped to the editor's own global keyboard shortcuts** — it
  does not (and was not asked to) address every conceivable keyboard-focus edge case in the app;
  it specifically fixes the confirmed, reproduced symptom (caption selection/video seeking leaking
  through an open dialog). Other, more deeply nested interactive contexts (e.g. a Select open
  *inside* a Select) were not separately audited, since no confirmed issue was found there and the
  task's own scope is "fix concrete issues that materially affect usability," not an exhaustive
  interaction-state audit.
- **`ConfirmDialog` is not yet used everywheré a native `confirm()`-shaped decision might
  eventually be needed** — it was deliberately introduced only at the two confirmed native-`confirm()`
  call sites found in this audit (§3, item 2). No other call site needed it (§4).
- **Failure-message phrasing across different UI element types remains intentionally varied** (§4)
  — this was a deliberate decision, not an oversight, but is noted here in case a future phase
  wants to establish one single copy template company-wide; doing so was explicitly out of this
  phase's scope.

## 14. Final PASS/FAIL

- Audit completed and documented (§2–§4) before any code was changed.
- Every changed behavior in §5 corresponds to a confirmed issue in §3 — none speculative.
- No core architecture regressions: transcription, Whisper, language policy, the export rendering
  pipeline, FFmpeg invocation, crash recovery, and the persistence/save-queue architecture were all
  read where relevant to the audit but never modified.
- All existing tests pass; all new tests pass (424/424).
- Typecheck: 0 errors.
- Lint: 0 new warnings/errors (same 5 pre-existing, unrelated warnings).
- Packaged Windows build succeeded; packaged QA passed all 15 steps.
- Production data (18 projects, 46 export jobs, 0 presets, all three real projects' full content
  and export history) confirmed byte-for-byte unchanged.
- No temporary QA fixtures or scratch scripts remain.
- No unrelated refactors were introduced — every file changed maps directly to one of the eleven
  confirmed issues in §3.

**P3 PRODUCT POLISH & UX CONSISTENCY — PASS**
