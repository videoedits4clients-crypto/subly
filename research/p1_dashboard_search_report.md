# P1 Fix Report — Dashboard Project Search / Filter / Sort

**Date:** 2026-09-17
**Scope:** Add search, filter, and sort to the Dashboard project grid only. No other P1 feature implemented (custom presets, silent-upload-rejection fixes, export font-fallback surfacing, shortcuts help UI, translation timing fixes, dashboard navigation changes, settings redesign — all untouched). Waveform Timeline (previous P1 phase) was not modified. No changes to Whisper/ASR, Gujarati Script, language policy, P0/P0.5 cancellation/stall logic, transcription segmentation, or export rendering. No new database migration.

---

## Investigation (before writing code)

- **Dashboard implementation:** [src/components/dashboard/projects-grid.tsx](src/components/dashboard/projects-grid.tsx) is the single component behind both `/dashboard` and `/dashboard/projects` ([src/app/dashboard/page.tsx](src/app/dashboard/page.tsx), [src/app/dashboard/projects/page.tsx](src/app/dashboard/projects/page.tsx)). It calls `api.listProjects()` once on mount and renders a grid of `ProjectCard`s.
- **Data source:** `GET /api/projects` ([src/app/api/projects/route.ts](src/app/api/projects/route.ts)) already loads the **complete** non-deleted project list in one query (`where: { ownerId, deletedAt: null }`) — no pagination, no server-side filtering already in place. This confirmed client-side search/filter/sort was the right (and only reasonably necessary) approach, per the task's performance guidance.
- **Project data model** (`prisma/schema.prisma`'s `Project` model) already has everything needed:
  - `name` (String) — search target.
  - `createdAt` / `updatedAt` (DateTime, both already `@default(now())` / `@updatedAt`) — sort targets. `createdAt` existed in the schema and the database already, but was **not** being returned by the list API or present in the `ProjectSummary` TypeScript type — this was the one small gap, fixed by adding one field to an existing response, not a schema change.
  - `status` (String) — filter target; real values written by `lib/pipeline.ts` and `lib/export-pipeline.ts` are `EMPTY | LOADING | TRANSCRIBING | READY | EXPORTED | ERROR` (`EDITING`/`EXPORTING` appear in `project-card.tsx`'s badge map for forward-compatibility but are never actually written).
  - `deletedAt` (DateTime?) — already excluded at the database level by the existing route; Trash has its own separate page/API (`/dashboard/trash`, `api.listTrash()`) that was not touched.
  - `language` — present but not required by this phase's spec (search is name-only; filters are status-only).
- **Conclusion:** no new migration, no new API endpoint, no change to how the Trash page or trash API work — confirmed by inspection before writing any code.

---

## What was built

### New pure logic module
- **[src/lib/dashboard/project-filters.ts](src/lib/dashboard/project-filters.ts)** — dependency-free search/filter/sort composition, structurally typed (`FilterableProject` interface, not an import of `ProjectSummary`) so it's directly unit-testable with no React/DOM:
  - `searchProjectsByName` — case-insensitive substring match on `name` only (not transcript text, per the task's explicit scope limit). Empty/whitespace query matches everything.
  - `matchesStatusFilter` / `filterProjectsByStatus` — four buckets: `all`, `processing` (`EMPTY | LOADING | TRANSCRIBING | EXPORTING`), `ready` (`READY | EDITING | EXPORTED`), `failed` (`ERROR`).
  - `sortProjects` — five orders: `updated-desc` (default), `created-desc`, `created-asc`, `name-asc`, `name-desc` (case-insensitive `localeCompare`). Does not mutate its input.
  - `applyProjectQuery` — the one function the UI calls; composes search → filter → sort, and defensively excludes any project with `deletedAt` set (belt-and-suspenders on top of the API's own `deletedAt: null` filter — makes "trashed projects never appear" independently testable at this layer too, without needing a DB in the test).

### Dashboard UI
- **[src/components/dashboard/projects-grid.tsx](src/components/dashboard/projects-grid.tsx)** (modified) — added a compact toolbar row (search `Input` with a left-aligned icon, a status `Select`, a sort `Select`, all existing UI primitives from `src/components/ui/`) shown only when there is at least one project. Filtering/sorting is `useMemo`'d over the already-fetched list — pure in-memory recomputation on every keystroke, no extra network request, no page reload. Two distinct empty states:
  - No projects at all → existing "No projects yet" state (unchanged).
  - Projects exist but none match the current search/filter → new "No projects match your search" state with a "Clear search & filter" button.
- **[src/lib/api-client.ts](src/lib/api-client.ts)** (modified) — added `createdAt: string` to the `ProjectSummary` interface.
- **[src/app/api/projects/route.ts](src/app/api/projects/route.ts)** (modified) — added `createdAt: p.createdAt.toISOString()` to the mapped JSON response (the field was already being fetched from the database; this just started returning it).

No changes to `ProjectCard` (rename/duplicate/delete/open), the Trash page, the Trash API, or any pipeline/transcription/export code.

---

## Testing

11 new tests in `src/lib/dashboard/__tests__/project-filters.test.ts`, covering all 9 required categories plus extras:

1. Search matches project name; case-insensitive.
2. (combined with #1 in one test, per the module's own numbering)
3. Search returns zero results on no match; empty/whitespace query matches everything.
4. Each status filter (`all`/`processing`/`ready`/`failed`) produces the exact correct subset; a cross-check (`matchesStatusFilter` agrees with `filterProjectsByStatus`) for every known status value.
5. Each of the five sort orders produces the correct order; `sortProjects` does not mutate its input array.
6. Search + filter + sort compose correctly together (a realistic "client" + "ready" + "recently updated" scenario).
7. Trashed (`deletedAt`-set) projects never appear in results, even under an exact-name search that would otherwise match.
8. Empty-state behavior: a non-empty list with no matches produces `[]`, distinguishable from an empty input list.
9. Existing project actions (rename/duplicate/delete/open) — **not** covered by a new unit test, since this repository has no React-component test harness (all existing tests, in every prior phase, are `node --test` against pure logic modules) and `ProjectCard`/`project-card.tsx` was not modified at all. Verified instead by direct inspection (no diff to that file) and live interaction in the packaged app (see below).

### Full verification suite (all green)
- `npm run test` — **169/169 tests pass** (158 pre-existing + 11 new).
- `npx tsc --noEmit` — clean, no errors.
- `npm run lint` — **0 errors** (5 pre-existing warnings, all in files untouched by this phase — including the pre-existing `project-card.tsx` unused-`router` warning, which was already there before this phase and was left alone per "do not refactor unrelated dashboard code").

`package.json` gained a `test:dashboard` convenience script and the new test file was appended to the main `test` script, matching the repo's existing per-feature script convention.

---

## Packaged Windows build & QA

Built via `npm run electron:pack`, producing a fresh `release/SUBLY Setup 0.1.0.exe`. Installed to `%LOCALAPPDATA%\Programs\SUBLY` and run against the real per-user database — same methodology as the prior waveform phase. Several test projects with varied names and statuses were created directly against the running packaged app's own local server (`Client Launch Video`, `client recap draft`, `Weekly Update`, `Apple Trailer`, with two of them set to `TRANSCRIBING`/`ERROR` for filter coverage), verified, then fully cleaned up (trashed and permanently deleted) afterward — the dashboard ended the session with exactly the same 3 real projects it started with.

Checklist:

- [x] **Search** — typing "CLIENT" live-filtered to the two matching projects with no page reload; case-insensitivity confirmed.
- [x] **Filter: All** — shows all 7 test-time projects.
- [x] **Filter: In Progress** — correctly showed the `TRANSCRIBING` project plus the two no-video (`EMPTY`) projects.
- [x] **Filter: Ready** — correctly showed the `READY` and `EXPORTED` projects.
- [x] **Filter: Failed** — correctly showed only the `ERROR` project.
- [x] **Sort: Recently Updated** (default) — verified on initial load.
- [x] **Sort: Recently Created** — the 4 freshly-created test projects appeared first, in exact reverse creation order.
- [x] **Sort: Oldest First** — exact reverse of Recently Created.
- [x] **Sort: Name A–Z** / **Name Z–A** — both verified correct and exact mirrors of each other, case-insensitive.
- [x] **Combinations** — search "CLIENT" + filter "Failed" correctly produced the zero-match empty state with a working "Clear search & filter" button; search "a" + filter "All" + sort "Name A–Z" (tested in dev-server pass) produced the correct composed subset and order.
- [x] **Refresh/relaunch does not corrupt project state** — force-quit and relaunched the packaged app; all 7 test-time projects reappeared with correct names/statuses/timestamps, no migration errors, no crash.
- [x] **Opening a project still works** — opened "Hindi/hinglish test" from a sorted/filtered grid view; editor loaded normally, including the previous phase's waveform, captions, and timeline — no regression.
- [x] **Existing trash behavior still works** — Trash page rendered correctly with all pre-existing entries from earlier phases; trash/restore/permanently-delete API calls used for QA cleanup all succeeded (`{"ok":true}` / `{"ok":true,"trashed":true}`).
- [x] **No regression to transcription/editor/export** — verified by opening a fully-transcribed project's editor (waveform, captions, timeline all intact); no pipeline, export, or ASR code was touched by this phase.

**Note on automation:** the native `confirm()` dialog behind the existing "Delete" project action isn't reliably drivable through this session's browser automation (it either auto-dismisses or blocks screenshot rendering), so the Delete/Restore/permanently-delete flows used for test-data cleanup were exercised via direct calls to the same `DELETE /api/projects/:id` and `DELETE /api/projects/:id/trash` endpoints the UI itself calls, rather than by clicking through the native dialog. Rename (no native dialog) was verified directly through the UI and confirmed working. `project-card.tsx` — which owns all of rename/duplicate/delete — was not modified in this phase.

**Bugs found:** none. No regressions found in existing dashboard, project, trash, editor, or export behavior.

---

## Final status: **P1 DASHBOARD SEARCH/FILTER/SORT PASS**

Search, filter, and sort work correctly individually and in every tested combination, update live without a page reload, preserve the existing visual design language and all existing project card actions, and correctly leave Trash as a separate, untouched flow. No other P1 feature was started.
