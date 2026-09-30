# SUBLY Product Audit — Pre-P1 Read-Only Review

**Date:** 2026-09-17
**Scope:** Read-only inspection of the current production application (editor, dashboard, upload, processing, timeline, captions, style, export, shortcuts, presets, fonts, multilingual/Hinglish/Gujarati Script, composition, undo/redo, autosave, project management). No code was changed to produce this document.
**Context:** P0 (reliability) and P0.5 (cancellation latency, .ass cleanup) are both complete and verified on a packaged Windows build. This audit is the required step before any P1 feature work begins.

---

## 1. Existing functionality that is already production-ready

- **Undo/redo** (`src/store/editor-store.ts`) — a single `commit()` chokepoint funnels essentially every content mutation (text, timing, style, animation overrides at global/caption/word scope, timing rules, composition, trim, cut ranges) through one snapshot-based history stack, capped at 60 steps, both directions bounded. This is one of the more cleanly engineered subsystems in the app.
- **Style panel** (`src/components/editor/style-panel.tsx`) — collapsible sections (already resolved a prior "too many controls" complaint per its own code comment), per-caption and per-*word* style overrides, copy/paste style across captions or the whole project. Comprehensive: font, size, weight, spacing, case, color, highlight, background, outline, shadow, position.
- **Autosave & crash recovery** (`src/hooks/use-autosave.ts`, `src/lib/local-snapshot.ts`) — 900ms debounce, exponential-backoff retry, a `beforeunload` flush via `fetch(..., {keepalive:true})`, and a local-storage snapshot compared against the server's `updatedAt` on reload with an explicit Restore/Discard prompt if the local copy is newer. Save state (unsaved/saving/saved/error) is visibly surfaced in the top bar with an explanatory tooltip on error.
- **Project duplication** (`src/app/api/projects/[id]/duplicate/route.ts`) — a genuine deep copy, including physically copying video/audio files to new storage keys rather than sharing references.
- **Presets** (`src/lib/presets.ts`, `src/components/editor/presets-panel.tsx`) — 13 curated presets across 4 categories, each with a real live WYSIWYG preview using the same CSS-generation function the editor/export use.
- **Fonts** (`src/lib/fonts/*`, `src/components/editor/font-picker.tsx`) — real SFNT-table parsing of installed Windows fonts (not CSS-guessing), each font name previewed in its own actual typeface, clean bundled-vs-system separation, and export-side font-file resolution (`server-font-cache.ts`, `system-font-export.ts`) with fallback rather than a hard export failure.
- **Hinglish conversion** (`src/lib/subtitles/hinglish.ts`) — deterministic, fully local (no cloud call), dictionary-first with a rule-based fallback engine; idempotent generation that never overwrites a user's manual edit.
- **Export text-format consistency** (`export-formats.ts`, `subtitles/route.ts`, `export-pipeline.ts`) — SRT/VTT/TXT downloads, the burned-in MP4, and the live preview all route through the same `applyOutputMode()` function, so Original/Hinglish/Gujarati-Script selection can never drift between what's shown and what's exported.
- **Timeline** (`src/components/editor/timeline.tsx`) — drag to move/resize captions, trim handles, mark-in/mark-out manual cut ranges (revertible), zoom, virtualized rendering for long recordings.
- **P0/P0.5 reliability work** (verified this session on a packaged build) — real transcription, cancellation (~3.6s), model-loading cancellation (~3.57s), export cancel/stall/failure recovery, `.ass` cleanup, relaunch/persistence.

## 2. Existing functionality that is technically implemented but has UX gaps

- **Keyboard shortcuts exist but are undiscoverable.** `src/hooks/use-keyboard-shortcuts.ts` implements a genuinely solid set (undo/redo, split, find, Tab/Shift+Tab caption walking, J/K/L transport, frame-step, delete) but there is **no shortcuts help/cheatsheet UI anywhere in the app** — only the Undo/Redo buttons show their binding as a tooltip. Ctrl+S is explicitly captured and made a silent no-op with zero feedback.
- **No custom presets.** `applyPreset` only ever reads from the fixed built-in array — there is no "Save as preset," no persistence, no rename/delete. A user who dials in a look has to reproduce it manually next time.
- **Font-fallback failures are silent.** If a chosen system font is missing at export time, `system-font-export.ts` logs to the server console only — the user gets a video with a substituted font and no on-screen warning that their choice didn't apply.
- **Save-state after an error has no time/severity context.** "Unable to save changes" doesn't say how long ago the last successful save was, so the user can't judge how much work is genuinely at risk.
- **Upload rejects fail silently.** `src/app/projects/[id]/upload/page.tsx` never wires `useDropzone`'s `fileRejections`/`onDropRejected` — dropping an unsupported format or oversized file produces no toast, no inline error; the static guidance text is the only thing standing between the user and confusion.
- **Dashboard status badges under-differentiate.** LOADING, TRANSCRIBING, and EXPORTING all render the identical amber "warning" badge, distinguished only by text a user has to read.
- **`/dashboard` and `/dashboard/projects` are functionally identical pages** (same `ProjectsGrid`, different title only), and the "Upload video" / "New project" toolbar buttons both just open the same project-creation dialog — two redundant navigation paths presented as if distinct.
- **`captionOutputMode` isn't reset on language change/translation** — if a Hindi project is in Hinglish mode and gets translated to English, the toggle disappears from the UI but the stale mode value stays in the stored project, a latent inconsistency.
- **Word-level timing is lost on every AI translation** — `remapWordsEvenly` in `translate/route.ts` evenly redistributes timestamps across the new word count with no UI disclosure that karaoke-style word-highlight accuracy degrades on a translated track.
- **Brand Kit and Presets overlap with no explained interaction** — applying one silently overwrites the other's font/color choice.
- **Settings page is almost entirely read-only** (disabled Name/Email fields, static "Free" plan badge) — it reads as unfinished rather than intentionally minimal.

## 3. Important missing capabilities for a professional desktop subtitle editor

- **No audio waveform in the timeline.** Every caption-timing edit is done against a blank track with no visual reference to where speech actually is — a near-universal feature in comparable tools (CapCut, Descript, Premiere's caption track) and probably the single most-requested capability once users start fine-tuning caption timing by hand.
- **No project search/filter/sort on the dashboard.** Projects render in whatever order the API returns them, with no way to find one by name or status once a user accumulates more than a handful.
- **No re-transcription in a different language.** If a user picks the wrong language at upload, the only recovery is AI *text* translation of the (possibly wrong-language, garbled) transcript — there's no "redo ASR with the correct language on the same audio."
- **No shortcuts reference.** (Also listed under §2 — repeated here because "an in-app cheat sheet" is a capability gap, not just a discoverability nit.)
- **No logo upload in Brand Kit**, despite colors and font already being supported — a natural, expected extension that's simply absent.

## 4. Places where the UI is confusing, redundant, or unnecessarily complex

- **Language exposure vs. stated product policy (see §5/P0 below for full detail).** The transcription-language picker offers 16 languages; only English/Hindi have been benchmarked and frozen into policy this session.
- **Settings tab in the Left Panel is one long undifferentiated scroll** — Canvas, Background, Layers, Language, Hinglish, four separate caption-timing controls, and a "Re-segment" action all sit in a flat list with no sub-grouping, unlike the Right Panel's already-solved collapsible-section pattern.
- **Two visually distinct "stop playback" bindings (Space toggles, K always pauses)** — standard NLE convention, but never explained anywhere in the app.
- **Preset "active" highlighting is a brittle deep-equality check** (`presets-panel.tsx`) against the live style object — will silently stop matching if the style shape ever grows without the preset definitions growing with it.

## 5. Remaining regressions / policy conflicts found in this audit (ranked)

Ranking key: **P0** = reliability/blocking (breaks trust, contradicts an explicit product decision, or risks irreversible loss) · **P1** = important for product usability · **P2** = polish/future.

### P0 — reliability / blocking

1. **Marketing copy directly contradicts the frozen V1 language policy.**
   `src/components/landing/features.tsx:11` reads: *"transcribe and translate into 10 languages, including Hindi, Gujarati, Arabic and Japanese."*
   **Concrete user problem:** A user reads this, uploads a Gujarati video expecting a supported, production-quality feature, and gets a transcription path this project's own prior research already benchmarked and classified as failing quality standards. This is a direct, public-facing contradiction of an explicit decision made earlier in this engagement ("Gujarati → DEFERRED... do not integrate the experimental Gujarati LoRA model... into the production application").

2. **The pre-transcription language picker exposes 13+ languages that have never been validated, alongside the explicitly-deferred Gujarati.**
   `src/types/subtitle.ts:319–345` (`LANGUAGES`) lists English, Hindi, Gujarati, Marathi, Bengali, Tamil, Telugu, Punjabi, Urdu, Spanish, French, German, Portuguese, Arabic, Japanese, Korean — all presented identically in `TranscriptionSettingsDialog`, with no indication that only English/Hindi/Hinglish have been through this project's rigorous benchmarking process.
   **Concrete user problem:** A user selecting, say, Tamil or German has no way to know they are the very first real test of that language in this product — no per-language quality validation, no Hinglish-equivalent code-switch handling, no warning. This re-creates, at product scope, the exact quality risk that the Gujarati investigation was run specifically to catch and prevent for Gujarati alone.

3. **The "Gujarati Script" caption-output mode is fully live in production with zero gating.**
   `src/components/editor/hinglish-toggle.tsx:18–55` shows a working 3-way selector (Original / Gujarati Script / Hinglish) the instant `project.language === "gu"`, and `local-provider.ts` still carries a documented `gu → medium` model override reachable from the normal upload flow. A repo-wide search for "deferred"/"research-only"/"beta"/"experimental" turns up no gating anywhere in this path.
   **Concrete user problem:** Gujarati is supposed to be deferred and research-only, but a user hits a fully-functional-looking Gujarati feature through completely ordinary use of the app, with no signal that they've wandered into unsupported territory.

4. **Destructive project deletion relies on a native browser `confirm()` with no typed confirmation, and permanent deletion's storage cleanup is unverified.**
   `src/app/dashboard/trash/page.tsx:40` and `project-card.tsx:59` both gate irreversible actions behind a reflexively-dismissible native dialog. Separately, `trash/route.ts`'s permanent-delete path calls `prisma.project.delete` with no confirmed call to `storage.delete(...)` for the project's video/export files in the reviewed code — this needs direct verification (not confirmed as a bug, flagged as an open risk) since an orphaned-file leak would silently consume disk space forever on a desktop app where the user has no other cleanup mechanism.
   **Concrete user problem:** One reflexive click loses a project forever with no safety net beyond the Trash stage itself; separately, disk space may quietly disappear with no way for the user to reclaim it.

### P1 — important for product usability

5. No audio waveform in the timeline (§3).
6. No project search/filter/sort on the dashboard (§3).
7. No custom/saved presets (§2).
8. Silent upload-rejection (unsupported format/oversized file produces no feedback) (§2).
9. Silent export-time font-fallback (no user-facing warning when a chosen font isn't available) (§2).
10. No shortcuts help/cheatsheet UI (§2/§3).
11. `captionOutputMode` not reset on language change/translation, leaving stale state (§2).
12. Word-level timing precision silently lost on AI translation, undisclosed (§2).
13. Redundant dashboard navigation (`/dashboard` vs `/dashboard/projects`, duplicate "Upload"/"New project" entry points) (§4).

### P2 — polish / future

14. Left Panel's Settings tab needs the same collapsible-section treatment the Right Panel already has (§4).
15. No in-app explanation of Space-vs-K playback semantics (§4).
16. Preset preview thumbnails don't reflect a preset's actual vertical position (always centered).
17. Brand Kit has no logo upload (§3).
18. Settings page is mostly read-only/informational — fine for now, but should either gain real functionality or be relabeled to set correct expectations.
19. SRT/VTT export omits a UTF-8 BOM — worth a compatibility check against SUBLY's actual target players for non-Latin scripts, but not urgent (modern players handle bare UTF-8 fine).

---

## Proposed P1 implementation roadmap

*Not implemented — proposal only, per instructions. Ordered roughly by how directly each item resolves a P0/P1 finding above.*

### P1-A: Restrict the language picker to the frozen V1 policy and fix the marketing claim

- **User problem:** Users can select 13+ unvalidated languages and the explicitly-deferred Gujarati as if they were equally supported, and public marketing copy actively promises Gujarati support that contradicts internal policy.
- **Current behavior:** `TRANSCRIPTION_LANGUAGE_OPTIONS` exposes all 16 `LANGUAGES` entries with no distinction; `features.tsx` advertises Gujarati/Arabic/Japanese.
- **Proposed behavior:** Restrict `TranscriptionSettingsDialog`'s picker to Auto Detect / English / Hindi for V1 (with the underlying `LANGUAGES`/`SupportedLanguage` type and any already-built Gujarati-Script/other-language code left intact but not reachable from normal UI — matching the "preserve research artifacts without integrating them" instruction already given for Gujarati specifically, generalized to the rest of the untested set). Update `features.tsx`'s copy to reflect only what's actually shipped and validated.
- **Files/components likely affected:** `src/types/subtitle.ts` (`TRANSCRIPTION_LANGUAGE_OPTIONS`), `src/components/dashboard/transcription-settings-dialog.tsx`, `src/components/editor/hinglish-toggle.tsx` (gate the Gujarati-Script branch), `src/components/landing/features.tsx`, `src/lib/transcription/local-provider.ts` (decide whether to keep or remove the now-unreachable `gu → medium` override), `src/components/editor/ai-menu.tsx` (translate-language list, if it should also be scoped).
- **Testing required:** Unit tests confirming the picker only offers the V1 set; a regression test that `hinglish-toggle.tsx` no longer renders the Gujarati-Script selector for a `language: "gu"` project (or renders it only behind an explicit flag, if the decision is to keep it reachable but labeled experimental); existing Hinglish/Gujarati-Script unit tests must keep passing since the underlying conversion code should NOT be deleted, only made unreachable from normal flow.
- **Packaged QA required:** Yes — this changes user-facing upload flow; needs a real click-through in the packaged app to confirm the picker and marketing page both reflect the restricted set, and that an existing Gujarati project (if any exist from before this change) still opens without crashing.

### P1-B: Typed/harder confirmation for permanent project deletion, and verify storage cleanup

- **User problem:** A single reflexive click on a native `confirm()` permanently and irreversibly destroys a project; it's unverified whether its files are actually removed from disk.
- **Current behavior:** `trash/page.tsx` uses `window.confirm()`; `trash/route.ts` DELETE calls `prisma.project.delete` only.
- **Proposed behavior:** Replace the native confirm with an in-app styled dialog requiring the user to type the project name (or an equivalent explicit second step) before permanent deletion proceeds; audit and, if missing, add `storage.delete(...)` calls for the project's video/export files in the same route.
- **Files/components likely affected:** `src/app/dashboard/trash/page.tsx`, `src/app/api/projects/[id]/trash/route.ts`, `src/lib/storage/*`.
- **Testing required:** A new test verifying the DELETE route actually removes associated storage keys (mock or real local-storage driver); manual/automated UI test that the new confirmation dialog blocks deletion until the typed match succeeds.
- **Packaged QA required:** Yes, for the storage-cleanup half specifically — confirm on a real packaged install that permanently deleting a project actually frees the corresponding files under `%APPDATA%\subs\uploads`.

### P1-C: Audio waveform in the timeline

- **User problem:** Users fine-tuning caption timing have no visual reference to where speech actually occurs and must rely entirely on playback scrubbing.
- **Current behavior:** The timeline's video track is a plain colored bar with trim handles and cut markers; no waveform.
- **Proposed behavior:** Render a waveform (likely pre-computed server-side from the already-extracted `audio.wav` via ffmpeg, cached alongside it) underneath the caption blocks in `timeline.tsx`, respecting the existing zoom/virtualization model.
- **Files/components likely affected:** `src/components/editor/timeline.tsx`, a new server route or pipeline step to generate waveform peak data from `audio.wav` (likely near `src/lib/pipeline.ts` / `src/lib/ffmpeg/index.ts`), `src/lib/storage/*` for caching the peak data.
- **Testing required:** Unit tests for the peak-data generation function (given a known audio buffer, produces expected peak values); rendering tests/manual check that the waveform aligns correctly with caption timing at multiple zoom levels.
- **Packaged QA required:** Yes — this touches the ffmpeg pipeline (already a P0/P0.5-sensitive area) and needs verification the packaged app can generate and cache waveform data without adding meaningful processing latency.

### P1-D: Save-as-preset (custom presets)

- **User problem:** Users who dial in a specific look have no way to save and reuse it; they must manually reproduce every slider/color choice on the next project.
- **Current behavior:** `applyPreset` only reads from the fixed `BUILT_IN_PRESETS` array in `src/lib/presets.ts`; no persistence layer exists for user-defined presets.
- **Proposed behavior:** Add a "Save current style as preset" action in `presets-panel.tsx` that persists a user preset (name + style + animation) locally (per the existing local-first, no-cloud-dependency architecture — likely a new SQLite table via Prisma, mirroring how Brand Kit is already stored) and lists it alongside the built-ins with rename/delete.
- **Files/components likely affected:** `prisma/schema.prisma` (new `UserPreset` model + migration, following the existing `electron/db-migrations.js` additive-migration pattern), a new API route under `src/app/api/presets/`, `src/components/editor/presets-panel.tsx`, `src/store/editor-store.ts` (`applyPreset` already exists and needs no change; just a new source list).
- **Testing required:** New `node:test` coverage for the presets API route (create/list/delete) and the DB migration (following the existing `db-migrations.test.js` pattern); a UI test that saving, applying, and deleting a custom preset round-trips correctly.
- **Packaged QA required:** Yes for the migration specifically (same class of change as the P0.5 `Project.progress` migration — must be verified against a real pre-existing `subly.db` on relaunch), otherwise standard.

### P1-E: Surface upload rejections and export-time font-fallback warnings

- **User problem:** Two silent-failure modes: dropping an unsupported/oversized file during upload produces no feedback, and an export that had to substitute a missing font gives no on-screen indication.
- **Current behavior:** `useDropzone`'s `fileRejections`/`onDropRejected` are unused in `upload/page.tsx`; `system-font-export.ts`'s fallback path only `console.error`s server-side.
- **Proposed behavior:** Wire `onDropRejected` to a toast explaining the specific reason (wrong format vs. too large); thread a "font substituted" flag from `system-font-export.ts` through the export pipeline into the `ExportJob` record (or a toast on completion) so the user knows.
- **Files/components likely affected:** `src/app/projects/[id]/upload/page.tsx`, `src/lib/fonts/system-font-export.ts`, `src/lib/export-pipeline.ts`, `src/components/editor/export-dialog.tsx` (to surface the warning).
- **Testing required:** Unit test for the upload page's rejection handler (given a rejected file, the right toast copy fires); unit test that a missing-font export attempt correctly propagates a "substituted" signal to the job record.
- **Packaged QA required:** Yes for the font-fallback half (needs a real export with a genuinely-missing system font to confirm the warning surfaces); the upload-rejection half can be verified without packaging since it's pure client-side dropzone behavior.

---

**Stopping here per instructions — audit only, no implementation.**
