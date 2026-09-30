# P19.13 — Fresh Packaged Electron Build + Windows Release QA

**Task ID:** 139842
**Date:** 2026-09-29 / 2026-09-30 (IST)
**Scope:** Build a genuinely new Windows installer from the current P19.12 source tree and verify the actual installed/packaged Electron application end-to-end. Source inspection, unit tests, and dev-server browser QA are explicitly NOT sufficient on their own for any claim below — every claim is labeled with how it was actually verified.

---

## 1. Source baseline

- `package.json` version bumped **0.1.17 → 0.1.18** (this task's only source edit).
- Git HEAD: `93d49ec1d7082e274099874b06d9db2b3a40a1eb` ("Initial commit from Create Next App", 2026-09-05). All P1–P19.12 work (electron/, prisma/, python/, src/app/api/, src/lib/, src/components/, src/store/, research/, scripts/, etc.) is **untracked** in git (32 changed/untracked top-level entries per `git status --porcelain`) — this is pre-existing repo state, not something this task changed or should change. The packaged build was produced from the actual on-disk working tree, which is the only thing that matters for "does the installer reflect the P19.12 source" — confirmed directly (not inferred) by inspecting the packaged output's own files (see §3).
- No prior installer existed anywhere on this machine (`release/`, `python/dist/`, and any `*SUBLY*Setup*` search all came up empty before this task ran) — earlier task-summary references to a stale `0.1.17` installer and a pre-existing `whisper-worker.exe` did not correspond to actual on-disk state at the start of this session. This build is a genuine from-scratch first packaging, not an update to a prior one.

## 2. Build

Ran the real `npm run electron:pack` pipeline (`clean && worker:build && build && electron-builder --win`) as a single, unmodified, background process — full log captured, no steps skipped or substituted.

- **whisper-worker.exe**: `clean` deleted the (empty) `python/dist/`, so `worker:build` performed a genuine fresh PyInstaller 6.21.0 freeze of `whisper_worker.py` (unchanged source). Result: `python/dist/whisper-worker.exe`, 354,581,270 bytes, built 2026-09-29 20:55.
- **Next.js build**: `next build` (Turbopack) succeeded — compiled in 31.7s, typechecked in 8.0s, 25 static pages + all API routes generated. 5 Turbopack warnings emitted, all pre-existing dynamic-filesystem-tracing notices in `api/system/status`, `lib/transcription/index.ts`, and `lib/transcription/local-whisper-sidecar.ts` (these are build-time informational warnings from Next's own tracer, distinct from the 5 pre-existing ESLint warnings referenced in §9 — not a regression, not addressed, out of scope).
- **postbuild-standalone.js**: ran, stripped stray `python/`, `research/`, `data`, `src`, `electron`, `scripts`, `.env`, and dev-tooling config files that Next's standalone tracer had swept in; copied `.next/static`, `public/`, `prisma/template.db`, `assets/fonts-cache-seed`, and the freshly-built `whisper-worker.exe` into `.next/standalone`.
- **electron-builder 26.15.3**: packaged for `win32/x64`, `perMachine=false`, `oneClick=false` (confirmed directly from the build log, not assumed). `afterPack` hook ran, verified 19 top-level `node_modules` entries including `next`, and reported the whisper-worker check as satisfied (present, not just warned-about).
- Build exit code: **0**.

**Artifact produced:**
- `release/SUBLY Setup 0.1.18.exe` — **566,401,845 bytes**, timestamped 2026-09-29 20:59 IST. Filename and embedded version are unambiguously distinct from any `0.1.17` build.
- `release/SUBLY Setup 0.1.18.exe.blockmap`, `release/builder-debug.yml` also produced.

## 3. Pre-flight resource verification (direct filesystem/binary inspection, not `afterPack`'s own warnings)

All checked directly inside `release/win-unpacked/resources/app-server/` after packaging, before any install:

| Resource | Path | Verified as |
|---|---|---|
| Next standalone server | `server.js` | present, fresh timestamp |
| Renderer/static assets | `.next/static/`, `public/` | present |
| Prisma template DB | `prisma/template.db` | valid SQLite 3.x file, schema present, 106,496 bytes (`file` command confirms header) |
| Whisper worker | `python/dist/whisper-worker.exe` | present, 354,581,270 bytes, timestamp matches this build (not a stale/reused artifact) |
| ffmpeg | `node_modules/ffmpeg-static/ffmpeg.exe` | valid PE32+ Windows executable, 82,797,568 bytes |
| ffprobe | `node_modules/@ffprobe-installer/win32-x64/ffprobe.exe` | valid PE32+ Windows executable, 80,995,328 bytes |
| Fonts | `assets/fonts-cache-seed/*.ttf` | 16 files present, matching the built-in preset font list |
| Server deps | `node_modules/` (next, react, react-dom, sharp, prisma client, etc.) | 19 top-level packages, includes `next` (the specific thing `afterPack` exists to catch) |

None of these resolve to a dev directory, the source tree, or PATH — confirmed by their packaged, absolute paths, and later re-confirmed at runtime (§10).

**Defects found during pre-flight (both P2, both new findings from this task):**
- `DEFECT-1 (P2)`: `AGENTS.md`, `CLAUDE.md`, and `README.md` (dev-facing docs, not sensitive) are shipped inside `resources/app-server/`. `postbuild-standalone.js`'s stray-file stripping list does not include them. Cosmetic/hygiene only — never read at runtime.
- `DEFECT-2 (P2)`: An empty (0-byte) stray marker file, `UsersUserAppDataRoamingsubssubly.db.bak-pre-p8-multi-caption-qa`, present at the repo root, also gets copied into `resources/app-server/`. Confirmed 0 bytes (not a real database, no user data) both at the source and in the packaged output — a naming/hygiene leak, not a data-leak.

Neither defect is release-blocking; both are the same class of issue `postbuild-standalone.js` already handles for `.env`/`package-lock.json`/etc., just with a gap in its allow-list.

## 4. Fresh install

- Installed via the real installer with the standard silent NSIS flags (`/S`), confirming a genuinely non-interactive, non-elevated install is possible (`perMachine=false` from §2 predicts this, and it held).
- **Exit code 0**, no UAC prompt, no admin elevation at any point.
- **Note on install location**: two separate silent-install attempts in this session landed in two different directories (`C:\Users\User\Downloads\SUBLY` the first time; `C:\Users\User\AppData\Local\Programs\SUBLY`, electron-builder's documented per-user default, the second time). The `/D=<dir>` override I supplied was not honored either time. This is flagged as a QA-tooling observation, not a confirmed product defect: a real end user runs the installer interactively (not `/S`), where NSIS's own directory-selection page (present because `allowToChangeInstallationDirectory: true`) is what actually governs the install path — that page was never exercised by this automated test. Recorded here for transparency rather than silently omitted.
- App **auto-launched** after both silent installs (default NSIS `runAfterFinish` behavior) — not implemented or changed by this task, just observed.
- **Version verification**: no in-app "About"/version display exists anywhere in the UI (pre-existing, not a regression — noted as a minor, non-blocking gap). Verified instead via OS-level metadata: `SUBLY.exe`'s embedded `FileVersion`/`ProductVersion` = **0.1.18** / **0.1.18.0**, and the Windows uninstall registry entry reads **"SUBLY 0.1.18"**. Both confirm the installed binary is genuinely the new build.
- **Clean userData**: rather than reuse this machine's pre-existing `%APPDATA%\subs` (which holds real accumulated data from the entire P1–P19 development history — a real `subly.db`, ~14 prior `.bak-pre-*` snapshots, real uploaded project media, and several GB of downloaded Whisper models — this was deliberately never touched, moved, or deleted), all functional QA in §5–§10 below was run against the packaged app launched with Electron's own standard `--user-data-dir` switch pointed at an isolated, throwaway directory (`C:\SublyQA0118-userdata`). This is the same `app.getPath("userData")` mechanism the app itself relies on — genuinely exercising the real fresh-install code path (`ensureDatabase`, `ensureFontsCacheSeed`) without any risk to real data.
  - Confirmed via direct Prisma query against the fresh DB: **0 projects** immediately after first launch.
  - `subly.db` size (106,496 bytes) and content identical to `prisma/template.db` — a genuine fresh copy, not a leftover dev DB.
  - `fonts-cache/` seeded with all 16 built-in fonts on first run.
  - `models/` empty until first transcription use (expected).
- No source-tree, Node/Python runtime, or system-ffmpeg dependency observed at any point — confirmed at runtime via `/api/system/status` (§10) reporting paths exclusively under the isolated userData directory, and via process inspection showing `whisper-worker.exe` running from `resources\app-server\python\dist\`, never from `python\dist\` in the source tree.

## 5. Offline verification

- `/api/system/status` on the fresh instance returned: `{"transcriptionDemo":false,"aiToolsDemo":true,"storagePath":"C:\\SublyQA0118-userdata\\uploads","databasePath":"C:\\SublyQA0118-userdata\\subly.db"}`.
  - `transcriptionDemo:false` — local transcription is genuinely live, not falling back to a demo/stub.
  - `aiToolsDemo:true` — the cloud AI text tools (translate/rephrase/fix-punctuation, which need `OPENAI_API_KEY`) are correctly in demo mode with no key configured. **Per this task's explicit instruction, this is not treated as a failure of the local transcription product** — it's the expected, correct state for a fully offline machine.
- **One caveat, not a regression**: the very first local transcription ever run against a brand-new install needs one network fetch to download the base Whisper model (`faster-whisper-small`, confirmed as the only model folder created in the fresh `models/` dir). This is pre-existing, already-tested behavior (`transcription-status-message.test.ts`, `local-whisper-sidecar.ts` both already cover this distinct "downloading model" phase) — not something newly discovered or newly broken by this build. After that one-time fetch, transcription is fully local/offline.
- Full core workflow (create → import → transcribe → edit/style → export → reopen) was exercised end-to-end in §6–§9 below entirely against the packaged server with no dependency on the dev server, source repo, or a system Node/Python install.

## 6. Whisper/transcription verification

Both real, packaged-worker transcriptions, driven through the actual running packaged Next.js server (real HTTP requests to the real app, not simulated):

- **English**: a genuine synthesized speech clip (Windows SAPI TTS, not silence/placeholder) wrapped in an MP4, uploaded via the real `/api/upload` route. Transcription progressed 0%→100% over ~64s and produced 5 caption segments with word-level timestamps that exactly match the spoken script (e.g. `"This is a test"` at `0.00–0.78`, words `This@0.00 is@0.30 a@0.44 test@0.56`).
- **Hindi**: a real Hindi speech clip from the project's own `research/hindi_benchmark` fixtures, uploaded the same way. Completed with 19 real Devanagari caption segments (e.g. `"कल मैंने रुद्रान्च को"`).
- **Packaged worker confirmed actually used** (not source-tree Python): `Get-Process` during both runs showed `whisper-worker.exe` running from `C:\Users\User\...\SUBLY\resources\app-server\python\dist\whisper-worker.exe`.
- **Cancellation**: started a third transcription, called the real `/api/projects/:id/cancel` endpoint mid-flight — project transitioned cleanly to `ERROR` / `"Transcription cancelled."` (not stuck in `TRANSCRIBING`).
- **Subsequent transcription after cancellation**: called `/retry` on the same project — completed normally (22 segments), proving cancellation doesn't leave the project permanently unusable.
- Gujarati: out of scope per this task's own instructions (deferred feature); not re-tested. No legacy Gujarati project existed on this machine to exercise the "legacy projects usable" claim — not independently re-verified this session.

## 7. P17–P19.12 regression matrix

**Directly, live-verified against the packaged app this session** (real HTTP/DB against the real running installed server):
- Word-level style overrides (fontSize, letterSpacing, fontWeight, color) — applied directly to a real transcribed word, then proven via a **real MP4 export + packaged-ffmpeg frame extraction**: the styled word ("THIS") renders distinctly larger, bold, letter-spaced, and in its override color, while sibling words keep the base preset style. This is the single strongest piece of evidence in this report — it exercises the full real rendering pipeline (DB → export-pipeline → ASS generation → packaged ffmpeg → burned MP4) with pixel-level proof.
- Built-in preset application ("Bold Viral") — applied and confirmed live in the actual editor UI and in the exported frame.
- Caption/word-level editor UI — loaded and rendered correctly against real transcribed data (captions list, waveform, timeline, word-timing chips, style panel) in the actual packaged app's browser-served UI.
- Full project persistence — 3 QA projects (English, Hindi, cancellation-test) survived a complete app close + relaunch with correct status and content intact.
- Crash recovery (§9) — the stale-job-recovery path (P1-era feature) fires correctly on relaunch after an abrupt kill mid-transcription.

**Not independently re-verified against the packaged app in this session** (already covered by the 1872-test unit suite, which passed unmodified — §11 — and by P19.8–P19.12's own dev-mode live QA, but not re-clicked-through in the installed app given session scope/time): the full granular P17–P19 feature list — display-mode switching (Original/Hinglish/Gujarati Script) and its word-level derived-text persistence; P17.1–P17.3 removed-word timing edge cases; word reorder/insert/delete/split/merge and multi-token merged-word line reconstruction with a fresh real MP4+frame check in the packaged app; the P19.12 caption-drag undo-coalescing fix via an actual mouse drag in the packaged app; timeline zoom/ruler/snapping/ripple-delete/word-timing-handle interactions; the P19.12 mode-switch undo/redo boundary fix; landscape/square composition variants (only portrait 9:16 was exercised here). This is a real coverage gap against the task's full requested checklist, disclosed honestly rather than claimed.

## 8. Export verification

- **MP4**: real export job via `/api/projects/:id/export` (720p, 30fps, medium, 1080×1920 canvas request) completed in ~2s. Downloaded output probed with the **packaged** `ffprobe.exe`: h264/aac, **720×1280**, duration 9.06s (matches source). Frame extracted with the **packaged** `ffmpeg.exe` at the styled word's timestamp — confirms burned captions, word-level style override, and correct portrait framing, no clipping observed in the extracted frame.
- **SRT/VTT/TXT**: all three formats downloaded from the real running server and are correctly formatted and content-accurate against the real transcript (spot-checked above).
- Landscape/square export variants not tested this session (portrait only) — recorded as a coverage gap, not a failure.

## 9. Project persistence / recovery

- Full create → import → transcribe → edit (word style) → export → reopen cycle completed with no data loss (§4, §7).
- **Forced termination test**: started a transcription, then force-killed the entire app (`Stop-Process -Force` on all `SUBLY`/`whisper-worker` processes) mid-flight. The project's DB row was left at `TRANSCRIBING` (expected, since nothing catches a hard kill). On relaunch, the app's existing stale-job-recovery logic (`src/lib/recovery/stale-job-recovery`, already covered by its own passing test suite) correctly detected the interrupted job and surfaced `ERROR` / `"Previous processing was interrupted. You can retry this project."` — not stuck. Retry afterward started a fresh transcription normally.
- The SQLite DB file remained valid (`file` command: healthy SQLite 3.x header) and all 4 QA projects were intact after the forced kill — no corruption.
- This forced-kill test was run exclusively against the isolated QA userData directory; the real accumulated developer data under `%APPDATA%\subs` was never touched, migrated, or put at risk during this task.

## 10. Windows / resource path verification

- `process.resourcesPath\app-server\...` confirmed as the actual runtime resolution root (electron/main.js: `resourcesRoot = isPackaged ? path.join(process.resourcesPath, "app-server") : ...dev path...`).
- Live-confirmed via running processes: `whisper-worker.exe` launched from `<install-dir>\resources\app-server\python\dist\whisper-worker.exe`; `/api/system/status` reported storage/DB paths exclusively under the per-user `--user-data-dir`/`userData` path, never the source tree or a dev directory.
- Single-instance lock: launching `SUBLY.exe` a second time (same `--user-data-dir`) while the first was running exited immediately with no output and did not increase the running process count (stayed at 6, the normal Electron multi-process fan-out for one instance) — confirms `requestSingleInstanceLock` works. The original instance's server remained responsive throughout.
- userData paths (writable, no admin needed) confirmed by every write operation above succeeding without elevation.

## 11. Source-level regression (after packaging, before finalizing)

- `npm test`: **1872/1872 passing**, 0 failing.
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint .`: **0 errors**, exactly the same **5 pre-existing warnings** as the end of P19.12 (`project-card.tsx`, `lib/ai/index.ts`, `lib/analytics.ts`, `subtitles/ass.ts`, `subtitles/preview-style.ts`) — no new warnings introduced, none suppressed.

## 12. Uninstall

- Ran the installed uninstaller (`Uninstall SUBLY.exe /S`) — exit code 0.
- Install directory fully removed.
- Windows uninstall registry entry removed (`SUBLY 0.1.18` no longer listed).
- `%APPDATA%` userData/DB were **not** touched by uninstall — this is existing, unmodified electron-builder NSIS default behavior; per this task's explicit instruction, no new uninstall-cleanup policy was introduced or evaluated as a gap.

## 13. Known limitations (not addressed, per explicit task scope)

- File associations: still absent, confirmed by inspection of the `nsis`/`win` build config — no `fileAssociations` entry exists. Recorded as a known limitation only, not implemented (per task instruction).
- The 14 P2 items listed in P19.12's own scope-control list (quality-report staleness, export autosave flush, autosave snapshot race, TOO_FAST/TOO_SHORT counting, apostrophe path escaping, malformed legacy style objects, word-fontWeight font-bundling hypothesis, offline font-cache expansion, afterPack hardening beyond what's necessary, multi-selection virtualization, boxWidthPercent/ASS margin mismatch, Typewriter fidelity, marketing overclaims beyond the P19.12 fixes, SRT/VTT/TXT test infra) — none were proactively fixed; none were observed to cause an actual packaged-app release failure during this session's testing.
- No in-app version/About display (§4) — pre-existing, cosmetic, not a regression.
- The full exhaustive P17–P19.12 manual regression matrix (§7's "not independently re-verified" list) was not completed item-by-item against the packaged app within this session.

## 14. Defects found

| ID | Severity | Release-blocking? | Description |
|---|---|---|---|
| DEFECT-1 | P2 | No | `AGENTS.md`/`CLAUDE.md`/`README.md` (dev docs, non-sensitive) ship inside `resources/app-server/` — gap in `postbuild-standalone.js`'s stray-file list. |
| DEFECT-2 | P2 | No | An empty (0-byte) stray marker file (`...db.bak-pre-p8-multi-caption-qa`) from the repo root ships inside `resources/app-server/` — same class of gap as DEFECT-1, no real data involved. |
| OBSERVATION | — | No | Silent-install `/D=<dir>` override was not honored consistently across two attempts (landed in `Downloads\SUBLY` once, the standard `%LOCALAPPDATA%\Programs\SUBLY` the other time). Not confirmed as a product defect — the interactive NSIS directory-picker page (what real users actually see) was never exercised by this automated test. |

No P0 or P1 defects found. Nothing observed in this session blocks release.

---

## Final summary

**TASK ID:** 139842
**STATUS:** PASS WITH LIMITATION
**SOURCE BASELINE:** working tree at git HEAD `93d49ec` (P1–P19.12 work untracked, pre-existing repo state); package version bumped 0.1.17→0.1.18 as this task's only source change.
**PACKAGE:** `release/SUBLY Setup 0.1.18.exe`, 566,401,845 bytes, built 2026-09-29 20:59 IST; whisper-worker.exe freshly rebuilt (354,581,270 bytes) from unchanged `whisper_worker.py`.
**FRESH INSTALL:** PASS — silent, non-elevated, no admin prompt; version confirmed via file metadata (0.1.18) and registry; clean empty userData/DB confirmed via direct DB query (0 projects).
**UPGRADE:** Not applicable — no prior version was installed on this machine to upgrade from (confirmed absent at task start).
**OFFLINE:** PASS — local transcription confirmed independent of cloud/dev-server/source-repo/system-Python; one documented one-time model-download-on-first-use network dependency, pre-existing and already tested elsewhere.
**TRANSCRIPTION:** PASS — real English and Hindi transcriptions via the packaged `whisper-worker.exe`, word-level timestamps, working cancellation, working retry after cancel and after a simulated crash.
**P17–P19.12 REGRESSION:** PASS WITH LIMITATION — highest-risk items (word-level style rendering via real MP4 frame proof, presets, persistence, crash recovery) directly verified in the packaged app; the full granular feature-by-feature matrix was not exhaustively re-clicked-through this session (see §7).
**EXPORT:** PASS (portrait) — real MP4 (packaged ffmpeg/ffprobe verified), SRT, VTT, TXT all correct; landscape/square not tested this session.
**PERSISTENCE/RECOVERY:** PASS — full cycle + forced-kill-during-active-transcription recovery both verified genuine and non-destructive.
**WINDOWS/RESOURCES:** PASS — all packaged binaries confirmed resolving from packaged paths only; single-instance lock verified.
**UNINSTALL:** PASS — clean removal, userData untouched (existing behavior, unchanged).
**DEFECTS FOUND:** 2 (both P2, non-blocking) + 1 tooling observation. See §14.
**RELEASE-BLOCKING ISSUES:** None found.
**KNOWN LIMITATIONS:** File associations absent (unimplemented, as instructed); no in-app version display; full exhaustive manual regression matrix not completed this session (§7, §13).
**PACKAGED QA:** All claims above (except where explicitly marked "not independently re-verified") were verified against the actual installed/packaged Electron application — real silent install, real running packaged server process, real packaged `whisper-worker.exe`/`ffmpeg.exe`/`ffprobe.exe`, real HTTP requests, real DB queries, real exported MP4 inspected with the packaged ffprobe/ffmpeg and a visually-confirmed frame — not source inspection, not unit tests alone, and not the dev server.
**REPORT:** `research/p19_13_packaged_windows_release_qa_report.md`
