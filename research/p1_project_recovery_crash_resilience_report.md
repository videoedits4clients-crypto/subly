# P1 — Project Recovery & Crash Resilience

## 1. Current state machine (as found, before this change)

**`Project.status`** (`prisma/schema.prisma`): `EMPTY | LOADING | TRANSCRIBING | READY | EDITING | EXPORTING | EXPORTED | ERROR`.

Transitions, traced through the actual code (not assumed):
- Upload (`POST /api/upload`) → `LOADING`, fires `processVideo()` (`lib/pipeline.ts`).
- `processVideo`: `LOADING` (audio extraction) → `TRANSCRIBING` (`processingStartedAt` set) → on success, a single `$transaction` writes all `Subtitle` rows **and** flips to `READY` atomically → on any error/cancel/stall, catch block sets `ERROR` with a specific message and clears `progress`/`processingStartedAt`.
- Export start (`POST /api/projects/:id/export`) → `Project.status = "EXPORTING"` (set by the route itself, *before* the job is even queued), then fires `runExportJob()` (`lib/export-pipeline.ts`).
- `runExportJob`: on success (after the P1 Export Output Verification phase's ffprobe check) → `EXPORTED`. On any error/cancel/stall/verification-failure → `READY` (never `ERROR` — "only this one export attempt failed, not the project/editor itself").
- Retry (`POST /api/projects/:id/retry`) → unconditionally sets `LOADING` and re-fires `processVideo` — it does **not** check the project's current status first.

**`ExportJob.status`**: `QUEUED | RUNNING | DONE | ERROR`. Created `QUEUED` by the export route, flipped to `RUNNING` by `runExportJob` right before the ffmpeg call, `DONE` only after the P1 output-verification step passes, `ERROR` on any failure. `outputUrl` is set **only** in the success branch — confirmed by re-reading the whole file that no other code path ever writes it, so a failed/interrupted job cannot already present a working-looking `outputUrl` today.

**In-memory-only "ownership" state**, confirmed in both `pipeline.ts` and `export-pipeline.ts`: `activeTranscriptions`/`activeExports` are plain `Map`s, explicitly documented as "process lifetime only" — a fresh process always starts with these empty. There is no queue, no worker pool, no cross-process job handoff anywhere in this codebase (both files' own doc comments say so).

**Existing crash-adjacent timestamps already on the schema** (added in earlier phases, reused here — no new ones needed): `Project.updatedAt` (`@updatedAt`, auto-bumped by Prisma on every write, including the progress writes both pipelines already make while a job runs), `Project.processingStartedAt` (set at `LOADING` start, cleared on completion/error), `ExportJob.updatedAt` (same auto-bump, refreshed on every `stage`/`progress` write during rendering).

**Existing startup boundary, already used for something else**: `src/instrumentation.ts`'s `register()` — a Next.js lifecycle hook that runs once per server process start and is *awaited before the server accepts its first request*. Already used to register a `process.on("exit"/"SIGTERM"/"SIGINT")` shutdown hook (`instrumentation-node.ts`) that kills the Whisper sidecar. This turned out to be exactly the boundary this task needed.

**Existing in-process crash/stall handling** (P0/P0.5, confirmed unmodified and untouched by this phase): `local-whisper-sidecar.ts`'s stall watchdog (5 min no-progress → kill + `TranscriptionStalledError`) and its `proc.on("exit", ...)` handler (worker dies while the *server process itself* is alive → every pending request rejects with "Local transcription process exited unexpectedly.", caught by `pipeline.ts`'s existing catch block → `ERROR`). `renderExport`'s own stall watchdog and cancellation are equally untouched. **These already work correctly** — the gap is specifically when the *entire server process* (not just the worker) dies, since then no catch block ever runs at all; only the DB row survives.

**Existing electron-side migration mechanism** (`electron/db-migrations.js`): additive `ALTER TABLE ... ADD COLUMN` migrations, run on every launch, schema-inspection-based (never a version ledger), idempotent by construction. Reused conceptually (see §7) but **not extended** — no new column was needed.

## 2. Exact recovery gap discovered

**A `Project`/`ExportJob` row left in a non-terminal status by a process that no longer exists stays that way forever.** Specifically:

- If the whole server/Electron process dies while `Project.status` is `LOADING` or `TRANSCRIBING`, the editor's `ProcessingScreen` re-opens on relaunch, polls `GET /status`, and sees the same stale `TRANSCRIBING`/`LOADING` forever. The **Cancel button is broken** in this exact state: it calls `cancelActiveTranscription(id)`, which looks up the (now-empty, fresh-process) `activeTranscriptions` map, finds nothing, and silently no-ops — nothing ever transitions the row to `ERROR`, so the user has no way to reach the Retry UI (`ProcessingScreen` only renders Retry when `status === "ERROR"`). **This was the most user-visible form of the bug: a project a user can open but never escape from.**
- If the process dies while `Project.status` is `EXPORTING`, the dashboard shows that project's badge as "Exporting" (warning color) forever, and it's grouped under the "In Progress" filter forever (`lib/dashboard/project-filters.ts`'s `PROCESSING_STATUSES`) — even though `EXPORTING` doesn't block the editor UI itself.
- If the process dies while an `ExportJob` is `QUEUED` or `RUNNING`, export history shows that entry as literally "queued"/"running" forever (`export-dialog.tsx`'s history list only special-cases `DONE` and `ERROR`).
- **Confirmed live and reproduced exactly as described**, with a genuine `taskkill` mid-transcription and mid-export (see §11) — before this change, on relaunch the project sat in `TRANSCRIBING` with a broken Cancel button and no way back, exactly as this gap predicts.
- A killed ffmpeg process also leaves a **partial output file on disk** (confirmed: a 9.4MB truncated `.mp4` from a real killed 4K render) *and* a leftover `.ass` caption sidecar (the temp file `withTempFile` normally always cleans up in its `finally`, which never runs if the process itself dies) — neither is ever removed without this change.

## 3. Recovery architecture

```
Next.js server process starts
        ↓
instrumentation.ts's register() — Next.js guarantees this resolves
before the server accepts its FIRST request
        ↓
instrumentation-node.ts's initNodeRuntime()
        ↓
recoverStaleJobs()  (src/lib/recovery/stale-job-recovery.ts)
   1. find ExportJob rows in {QUEUED, RUNNING}
        → best-effort delete their .mp4 output + .ass sidecar (storage.del, idempotent)
        → updateMany → ERROR, "Previous export was interrupted. The incomplete
          output was removed.", outputUrl stays null
   2. find Project rows in {LOADING, TRANSCRIBING}
        → updateMany → ERROR, "Previous processing was interrupted. You can
          retry this project.", progress: 0, processingStartedAt: null
   3. find Project rows in EXPORTING
        → updateMany → READY  (exactly what a normal export failure already
          does — see export-pipeline.ts's own catch block)
        ↓
server starts accepting requests — dashboard/editor never see the stale state
```

## 4. Stale-job definition — how stale vs. active is distinguished, and why a live job can never be misclassified

**No new "ownership" column (PID, session id, heartbeat timestamp) was added.** The definition of "stale" is: *a `Project`/`ExportJob` row whose status is non-terminal at the exact moment `recoverStaleJobs()` runs.*

This is safe — not because of anything computed from the row itself, but because of **when and how often this function is ever called**:

- `recoverStaleJobs()` has **exactly one call site in the entire codebase** — `instrumentation-node.ts`'s `initNodeRuntime()`, itself called exactly once by `instrumentation.ts`'s `register()`. This is enforced by an explicit unit test (`stale-job-recovery.test.ts`'s last test) that walks the whole `src/` tree and fails if a second call site ever appears — a regression here would be caught immediately, not discovered in production.
- Next.js's own `register()` contract guarantees this resolves **before the server accepts its first HTTP request**.
- Every single job-starting code path in this app — `POST /api/upload` → `processVideo`, `POST /api/projects/:id/retry` → `processVideo`, `POST /api/projects/:id/export` → `runExportJob` — is only reachable via an HTTP request.
- Therefore: at the exact instant `recoverStaleJobs()` runs, **no request has been served yet, so no job can possibly have been dispatched yet in this process.** Every non-terminal row it finds was, by construction, written by a *previous* process that no longer exists. There is no time window, no race, and no heuristic involved — it is a structural guarantee, not a probabilistic one.
- This also depends on the app's actual architecture being single-process/in-process (confirmed, not assumed — both `pipeline.ts` and `export-pipeline.ts` explicitly document "runs in-process, fire-and-forget" with a comment that a real queue would be needed for a multi-process deployment). If this architecture ever changes to a real multi-worker queue, this exact mechanism would need to change too — flagged explicitly as a limitation in §14.

**A first design draft used a time-based "no update in N seconds" heuristic instead** (reusing `updatedAt`). It was rejected: a crash-then-immediate-relaunch (very plausible — "it crashed, let me reopen it") could put the relaunch's recovery pass *inside* that window, silently leaving the user still stuck on the very relaunch meant to fix it — the opposite of the goal. The call-site guarantee above has no such window.

One consequence worth being explicit about (and tested — see `stale-job-recovery.test.ts` test 2): `recoverStaleJobs()` itself makes **no per-row freshness distinction** — if it were ever called from anywhere else, a genuinely fresh row would be swept identically to a genuinely stale one. The safety is entirely architectural (one call site, before the first request), not a property of the row-matching query. This is a deliberate, documented trade-off (see §14).

## 5. What happens to transcription state

A stale `LOADING`/`TRANSCRIBING` project → `ERROR`, `errorMessage: "Previous processing was interrupted. You can retry this project."`, `progress: 0`, `processingStartedAt: null`. No partial `Subtitle` rows can ever exist from the interrupted attempt in the first place — `pipeline.ts` only ever writes them inside the single `$transaction` that *also* flips status to `READY`, so a crash before that commits leaves nothing partial to hide; there is nothing to clean up beyond the status/message themselves. Any `Subtitle` rows from a *previous, actually-successful* transcription are untouched (confirmed live: the disposable test project's 33 subtitles from an earlier successful run survived the crash-and-recover cycle unchanged).

## 6. What happens to export state

A stale `QUEUED`/`RUNNING` `ExportJob` → `ERROR`, `errorMessage: "Previous export was interrupted. The incomplete output was removed."`, `outputUrl` stays `null` (it was already null; the success path is the only one that ever sets it). The associated `Project.status`, if still `EXPORTING`, resets to `READY` — identical to what a normal (non-crash) export failure already does.

## 7. What happens to partial output

Both the partial `.mp4` (the export's actual output-in-progress) **and** the `.ass` caption sidecar (a render-time temp file `withTempFile` normally always removes, but can't if the process dies before its `finally` runs) are deleted via `storage.del()` — best-effort, `catch(() => {})`'d, since a `QUEUED` job never got as far as writing anything and `del()` on a missing key is defined as a no-op, not an error. **Confirmed live twice** (dev and packaged): a genuine killed 4K render left a real 9.4MB truncated `.mp4` + a 12KB `.ass` file on disk; after relaunch, both were gone and the `ExportJob` was `ERROR` with the message above.

## 8. What happens after retry

Retry uses the **existing, unmodified** flows: `POST /api/projects/:id/retry` (transcription) and a fresh `POST /api/projects/:id/export` (export — there is no separate "retry export" endpoint; the dialog's "Retry export" button just starts a new job). Neither route was changed by this phase, and neither checks any new field this phase introduces — recovery leaves the project in exactly the state these routes already expect (an `ERROR`/`READY` project with its `VideoAsset` and prior successful data untouched). **Confirmed live four separate times** (dev transcription, dev export, packaged transcription, packaged export): every retry after a recovered stale job completed successfully and reached the same terminal state a normal, uninterrupted attempt would.

## 9. Startup ordering

Exactly as prescribed by STEP 7: idempotent (a second run's `updateMany` queries simply match zero rows — proven by an explicit idempotency test, and live by relaunching a third time with nothing left to recover), safe with zero stale jobs (a no-op — proven by a live relaunch of the packaged app with all 3 real projects already `EXPORTED`), safe with multiple stale jobs and multiple projects at once (proven by a unit test creating 3 stale projects + 2 stale export jobs simultaneously), safe after a normal clean shutdown (nothing to recover — the whole point of the terminal-status check).

## 10. Database changes

**None.** No migration was added to `electron/db-migrations.js`, and `prisma/schema.prisma` is unchanged. Every field the recovery module reads or writes (`Project.status`, `.errorMessage`, `.progress`, `.processingStartedAt`; `ExportJob.status`, `.errorMessage`, `.outputUrl`) already existed before this phase. This was verified fresh-install-safe and upgrade-safe by construction (no schema touched at all) and additionally by installing the freshly packaged build directly over the real, populated `%APPDATA%\subs\subly.db` twice during this phase's QA with zero migration activity logged.

## 11. Files changed

- **New:** `src/lib/recovery/stale-job-recovery.ts` — `recoverStaleJobs(db?, storage?)`, dependency-injectable for testing.
- **New:** `src/lib/recovery/__tests__/stale-job-recovery.test.ts` — 15 tests (see §12).
- **New:** `src/lib/export-output-key.ts` — extracted `exportOutputKey`/`exportAssKey` (the `<projectId>/exports/<jobId>.{mp4,ass}` convention), so `export-pipeline.ts` and the new recovery module share one definition instead of duplicating it. Dependency-free (no `@/` aliases) specifically so it — and anything that imports it — stays importable by plain `node --test`.
- **Modified:** `src/lib/export-pipeline.ts` — now imports `exportOutputKey`/`exportAssKey` instead of inlining the path expressions twice. No behavioral change to the render/verification pipeline itself.
- **Modified:** `src/instrumentation-node.ts` — exports `initNodeRuntime()`, which now also awaits `recoverStaleJobs()` (best-effort, logged-not-thrown) alongside the pre-existing sidecar-shutdown-hook registration.
- **Modified:** `src/instrumentation.ts` — `register()` now explicitly calls and awaits `initNodeRuntime()` (previously just imported the module for its side effects); doc comment updated to describe both responsibilities and why the "awaited before first request" guarantee matters.
- **Modified:** `src/lib/storage/index.ts` — its own two internal imports (`./local`, `./types`) given explicit `.ts` extensions, matching this codebase's established convention for any file that needs to be importable by plain `node --test` (font-preflight.ts, export-output-verification.ts, etc. already do this) — required because the recovery module's default `storage` parameter imports `getStorage` from here.
- **Modified:** `package.json` — added `test:recovery` and wired the new test file into the aggregate `test` script.
- **Not modified:** Prisma schema, `electron/db-migrations.js`, `local-whisper-sidecar.ts` (P0/P0.5 watchdog/cancellation — untouched, its own tests still pass unchanged), `export-dialog.tsx`, `processing-screen.tsx` (both already render the recovered `ERROR` state correctly with zero changes — see §13), font preflight, output verification's own logic, Whisper/ASR, language policy, subtitle segmentation, Gujarati/Hinglish logic, waveform, dashboard search/filter/sort, custom presets, upload validation, trash.

## 12. Tests added (`stale-job-recovery.test.ts`, 15 tests, all pass)

Run against a **real, temporary SQLite database** (a throwaway copy of `prisma/template.db`) through a **real `PrismaClient`**, so `updateMany`/`findMany` semantics are exercised exactly as production uses them — not a hand-rolled mock of Prisma's query builder. A small recording fake stands in for `StorageDriver`, so the unit suite never touches the real filesystem. No network, no real Windows install.

1. No active jobs → no changes
2. A project mid-dispatch (status just set) is swept the same as any other non-terminal row — documents that safety comes from the call site, not row inspection (see §4)
3. Stale transcription job (both `LOADING` and `TRANSCRIBING`) → recovered
4. Stale export job → recovered, **and** both the partial `.mp4` and the `.ass` sidecar are removed via `storage.del`
5. Multiple stale jobs (3 projects + 2 export jobs) → all recovered
6. Multiple projects → only the actually non-terminal ones are touched; `READY`/`EDITING`/`EXPORTED`/`EMPTY`/`ERROR` all left exactly as-is
7. Already-`ERROR` export job → unchanged, message not overwritten
8. Already-`DONE` export job → unchanged, `outputUrl` preserved, no cleanup attempted
9. Already-`READY` project → unchanged, `updatedAt` untouched
10. Idempotent — a second (and third) run finds nothing left to do, no duplicate/re-written messages
11. Recovery messages persisted exactly, and are plain/non-technical (regex-asserted: no PIDs, paths, `.exe`, stack traces)
12. A fully successful, already-completed project (`EXPORTED` + a real `DONE` job with a real `outputUrl`) remains completely untouched
13. After recovery, the project is in exactly the state the existing retry flow needs (video asset untouched, status `ERROR` so the UI's retry button renders, unrelated fields like `language` undisturbed)
14. A realistic mix of terminal-state projects with no stale work is a complete no-op (deep-equality on the whole `Project` table before/after)
15. `recoverStaleJobs` has exactly one call site in the whole codebase — enforced structurally (see §4)

## 13. Full test results

```
npm test
ℹ tests 241
ℹ pass 241
ℹ fail 0
```
(226 pre-existing + 15 new — all green, including P0/P0.5 cancellation, stall recovery, font preflight, export output verification, waveform, dashboard search/filter/sort, custom presets, upload validation, language policy, Hinglish, Gujarati Script, and every existing export test.)

```
npx tsc --noEmit
(no output — clean)
```

```
npm run lint
✖ 5 problems (0 errors, 5 warnings)
```
Same 5 pre-existing warnings as before this phase, in files this phase never touched. **Zero new errors, zero new warnings.**

## 14. Live QA — real force-kill tests, not just fixtures

All of the following were tested **live**, using a genuine `taskkill` against the actual running dev-server / packaged-app process (not a simulated DB fixture) — using a disposable project created and fully deleted for this purpose, never the 3 real production projects. The real database was backed up (`subly.db.bak-pre-recovery-qa`) before any of this began.

| # | Scenario | Method | Result |
|---|---|---|---|
| A | Normal project open | live | ✅ |
| B | Normal transcription | live | ✅ 33 subtitles generated |
| C | Normal export | live | ✅ DONE, real playable output |
| D | Force-quit during transcription | live `taskkill` mid-`TRANSCRIBING` | ✅ reproduced: project genuinely stuck at `TRANSCRIBING`/progress 0, Cancel would have been a no-op |
| E | Relaunch → stale transcription recovered | live relaunch | ✅ `ERROR`, exact recovery message, prior 33 subtitles untouched |
| F | Retry recovered transcription | live | ✅ `READY`, 33 subtitles again |
| G | Force-quit during export | live `taskkill` mid-render (4K/60fps/maximum, genuinely at 40-45% `RUNNING`) | ✅ reproduced: `ExportJob` stuck `RUNNING`, real 9.4MB truncated `.mp4` + `.ass` left on disk |
| H | Relaunch → stale export recovered | live relaunch | ✅ `ERROR`, exact message, partial `.mp4` **and** `.ass` both deleted, project back to `READY` |
| I | Retry recovered export | live | ✅ `DONE`, real playable output |
| J | Existing completed projects remain intact | live, checked after every relaunch | ✅ all 3 real projects, exact subtitle counts (12/43/28), unchanged throughout |
| K | Existing export history remains intact | live | ✅ every `DONE` row still has its `outputUrl`; no stray `QUEUED`/`RUNNING` entries anywhere |
| L | Dashboard does not show permanently stuck jobs | live, browser | ✅ all badges read "Exported", no "Processing"/"Transcribing"/"Exporting" stuck states |
| M | Trash remains intact | live | ✅ all 15 pre-existing trashed projects, unchanged |

**Every crash scenario in this table was reproduced with a real process kill, not a database fixture** — D/G were confirmed via direct SQLite inspection immediately after the kill (before relaunching) to prove the "before" state was genuinely stale, not assumed. The only thing this phase used a *fixture* for was the unit-test suite itself (§12), which is deliberately isolated from any real file/process/Windows dependency per the task's own instruction.

## 15. Packaged Windows QA

Built via `npm run electron:pack` (exit 0; log clean of new errors — the one pre-existing PyInstaller `tensorboard` submodule warning is unrelated and present before this change too). Installed fresh (`SUBLY Setup 0.1.0.exe /S`) directly over the existing, populated install. Confirmed the packaged app bundles the new recovery module (`resources/app-server/src/lib/recovery/stale-job-recovery.ts`).

| # | Scenario | Result |
|---|---|---|
| 1 | Normal launch | ✅ |
| 2 | Normal transcription | ✅ |
| 3 | Normal export | ✅ |
| 4 | Relaunch with no stale jobs | ✅ no-op, all 3 real projects load correctly |
| 5 | Real crash + relaunch (transcription) | ✅ genuine `taskkill /IM SUBLY.exe /F` mid-`TRANSCRIBING`, confirmed stale via direct DB read, relaunched, recovered with exact message |
| 5b | Real crash + relaunch (export) | ✅ genuine `taskkill` mid-4K-render at 80% `RUNNING`, relaunched, recovered, partial `.mp4`+`.ass` removed |
| 6 | Recovered project is retryable | ✅ both transcription and export retried successfully after packaged recovery |
| 7 | Existing projects survive relaunch | ✅ all 3 real projects, exact subtitle counts, across two full crash-relaunch cycles |
| 8 | Existing exports remain playable | ✅ file sizes/presence confirmed on disk after relaunch |
| 9 | Font preflight still works | ✅ (implicitly exercised — every export used the bundled Inter font successfully) |
| 10 | Output verification still works | ✅ every successful export in this phase reached `DONE` only via the P1 output-verification path (unmodified) |

The packaged app uses its own real bundled server/database/ffmpeg/ffprobe architecture throughout — confirmed by the `[electron] local server ready on 127.0.0.1:<port> (db: ...\subly.db)` log line and by directly inspecting the real `%APPDATA%\subs\subly.db` file between kills and relaunches.

## 16. Data integrity check (final)

- All 3 original real projects exist, unchanged: "Untitled project" (12 subtitles), "rishab guj" (43 subtitles, `language: "gu"`, `captionOutputMode: "gujarati-script"` — Gujarati legacy intact), "Hindi/hinglish test" (28 subtitles, `language: "hi"`).
- No project was accidentally deleted.
- Completed captions remain intact (subtitle counts match the pre-task baseline exactly).
- Successful exports remain intact and playable (file sizes confirmed on disk; every `DONE` `ExportJob` still has a working `outputUrl`).
- Export history remains intact (8/5/10 entries respectively across the 3 real projects, no corruption).
- Custom presets remain intact (none existed before or after this phase — this phase created none).
- Waveform endpoint still responds correctly.
- Trash remains intact (15 pre-existing entries, byte-for-byte the same list before and after).
- Language metadata remains intact (`en`/`gu`/`hi` unchanged).
- Gujarati legacy project remains fully intact.
- Every disposable fixture created during this phase's QA (2 throwaway projects, one dev-mode and one packaged-mode) was fully trashed and permanently deleted, including their storage files, by the end of the session.

## 17. Limitations

- The "cannot misclassify a live job" guarantee (§4) rests on this app's actual current architecture being single-process/in-process, which is true today (confirmed, not assumed) but is explicitly called out in the existing code's own doc comments as a "for now" design. If this app ever grows a real multi-worker/queue architecture, `recoverStaleJobs()`'s "exactly one call site, before the first request" invariant would need to be re-examined — it would no longer be sufficient on its own, since a *different* process could then legitimately own a row this one didn't start.
- `recoverStaleJobs()` makes no per-row freshness distinction by design (§4) — if it were ever accidentally invoked from a second call site, it would sweep genuinely active jobs too. This is mitigated by the structural single-call-site test (§12, test 15), not by any runtime check inside the function itself.
- The `.ass` sidecar cleanup was added mid-phase after live testing surfaced it as a real (if minor) orphan-file gap beyond the original design sketch — not present in the very first crash reproduction, fixed before packaged QA, and confirmed working in both live dev and packaged crash tests afterward (§14 row H, §15 row 5b).

## 18. Unrelated observations

None beyond what prior phases already recorded.

---

**Summary:** interrupted persisted work (transcription or export) can no longer remain permanently stuck after a crash and relaunch. This was demonstrated with genuine `taskkill`-based crash reproductions — not just fixtures — in both the dev server and the actual packaged Windows installer, confirming the project reaches a clear `ERROR` state with an actionable, non-technical message, any partial/misleading output is removed, retry works identically to a normal failure, and all existing projects/exports/history/trash/presets/waveform data survive completely untouched across multiple real crash-and-relaunch cycles. Unit tests (15/15), the full regression suite (241/241), typecheck, and lint (0 errors) all pass.

P1 PROJECT RECOVERY & CRASH RESILIENCE — PASS
