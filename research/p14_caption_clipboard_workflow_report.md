# P14 — Professional Caption Text Editing & Clipboard Workflow

## 1. Status

**PASS.** Task 101584 (P14 QA closure) completed all required release gates: the packaged Windows installer was built and installed, the full P14 QA checklist (A–L) was exercised against the actual installed EXE with real caption content, a genuine database-level before/after comparison was performed against this machine's real accumulated packaged-app data (see section 5 for exactly what that means and doesn't mean), the automated suite is 904/904, typecheck and lint are clean, and no P14-caused regression was found. Version is now **0.1.15**.

## 2. Task ID

Task 101584 — P14 QA Closure & Release Gate (closes out Task 101583's PARTIAL PASS).

## 3. P14 implementation status

Unchanged from Task 101583 — no redesign, no extension. As a reminder, the shipped surface is: `src/lib/subtitles/caption-clipboard.ts` (pure data model + mapping logic), one new ephemeral `captionClipboard` store field, Ctrl/Cmd+C/X/V in `use-keyboard-shortcuts.ts`, the mismatch confirmation dialog (`paste-captions-dialog.tsx`), and every mutation routed through the pre-existing `applyTextMap`/`updateSubtitleText` → `remapWordsToText` path. See `git log`/the P14 diff for the exact file list — nothing in it changed during this closure task except the version bump in `package.json`.

## 4. Packaged Windows QA results — PASS

**Build (Phase 1).** `npm run electron:pack` (the same `clean && worker:build && build && electron-builder --win` pipeline used by every prior release phase) completed successfully twice in this session: once at 0.1.14 (for QA) and once at 0.1.15 (the final release build, after all gates passed). Verified:
1. Next standalone build: succeeded (`next build`, 5 Turbopack tracing warnings, all pre-existing/unrelated to P14 — dynamic `spawnSync`/`spawn` calls in the transcription sidecar code, not touched by this task).
2. Electron packaging: succeeded; `afterPack` hook's own hard assertions passed (`node_modules` copied with 19 top-level entries including `next`, `server.js` present).
3. Whisper sidecar: `whisper-worker.exe` (354MB, PyInstaller-frozen with faster-whisper/torch/ctranslate2) built and packaged at `resources/app-server/python/dist/whisper-worker.exe`, present and signed in the final installer.
4. FFmpeg/ffprobe: `node_modules/ffmpeg-static/ffmpeg.exe` and `node_modules/@ffprobe-installer/win32-x64/ffprobe.exe` both present in the packaged `app-server/node_modules`, and a real export (section 4/K below) exercised `ffmpeg.exe` successfully end to end.
5. **Developer/test-only assets — one PRE-EXISTING issue found, not caused by P14** (see section 16).
6. Installer generated both times: `SUBLY Setup 0.1.14.exe` (QA build) and the final `SUBLY Setup 0.1.15.exe`.
7. Version stayed 0.1.14 throughout Phases 1–7 of this closure task; bumped to 0.1.15 only in Phase 8, after every gate had passed (section 8/17).

**Install (Phase 2).** This machine already had a prior P13 QA installation (`C:\Users\User\AppData\Local\SUBLY-P13-QA-Final\`) and substantial real accumulated `subly.db` data from every prior release phase (P4 through P13) — not a blank machine. Silent install (`/S`) correctly updated that existing install in place (standard NSIS upgrade behavior). To still get a genuine, uncontaminated **first-run** test without touching any of that real data, the existing `%APPDATA%\subs` userData directory was reversibly moved aside (not deleted), the app was launched fresh, and then:
- A brand-new `subly.db` was correctly copied from the bundled `template.db` (byte-identical size, 106,496 bytes) — `ensureDatabase`'s copy-on-first-run logic worked correctly.
- The app launched straight to an empty dashboard ("0 projects") with **no login required** — confirmed this is by design: desktop builds use a fixed `DESKTOP_USER_ID = "local-user"` (`src/lib/api-auth.ts`), pre-seeded into `template.db` itself (`scripts/build-db-template.js`), so there is no first-run auth flow to regress.
- A disposable project was created directly against this fresh DB and opened in the editor with zero console errors, confirming the packaged server, Prisma, and file storage all initialize correctly on a genuine first run.
- The disposable first-run project/DB was discarded and the real userData directory was moved back into place, byte-for-byte as it was (verified by project/subtitle/video/exportJob counts matching exactly, before vs. after, later in Phase 4).
- Sidebar/version: `NEXT_PUBLIC_APP_VERSION` is baked into the Next build at build time from `package.json`'s own `version` field (`next.config.ts`) — confirmed correct by construction (the installer filename itself, `SUBLY Setup 0.1.14.exe`/`0.1.15.exe`, is generated from the same `package.json` field by electron-builder). The actual in-app sidebar text render depends on `window.subly.isDesktop`, a preload-injected global only present inside the real Electron `BrowserWindow` — this session's browser tooling controls its own separate Chromium pane, not that native window, so the sidebar's exact pixels were not visually screenshotted; the underlying version value and the server-side behavior it gates were confirmed by every other means available (build config, installer filename, and every API/DB check throughout QA reflecting the correct build).
- No login regression: confirmed above (desktop mode has none by design).
- Runtime dependencies resolve: confirmed by the successful first-run launch, the successful real project edit, and the successful real video export (section K).
- No console/runtime errors: confirmed via `read_console_messages` at every stage (only one, unrelated, pre-existing "Uncaught... getComputedStyle" tooling artifact appeared once during dev QA in the prior session's report, never during this session's packaged QA).

## 5. Production DB comparison results — PASS (see important caveat)

**This is NOT paying-customer production data — there are no paying customers.** What this environment actually has is a genuine, non-trivial, persistent packaged-app SQLite database (`%APPDATA%\subs\subly.db`, 6.8MB) that has accumulated real project/subtitle/video/export rows across every prior release-QA phase on this machine (P4, P5, P5.1, P6, gujarati-script, export-verification, export-delivery-qa, installer-hardening-qa, P13-multi-caption-qa, perf-qa, persistence-qa, polish-qa, recovery-qa, release-polish-qa, styling-qa, workflow-qa — all visible as `.bak` filenames already sitting in that directory from those phases' own backups). This is the closest thing to "genuine production data" that exists in this sandboxed environment, and it is treated with the same care Phase 4 specifies for real production data — not fabricated, not touched except through the app's own safe duplicate feature.

Procedure actually followed, matching Phase 4's own steps exactly:
1. **Backup**: `subly.db` copied byte-for-byte before any QA (`Get-FileHash` recorded: `5142CE79...`).
2. **Duplicate ONE real project**: called the app's own existing, already-shipped `POST /api/projects/[id]/duplicate` endpoint (never a hand-rolled copy) against the real "Hindi/hinglish test" project (28 captions, real Hindi/Hinglish transcript content, its own video file) — this endpoint creates an independent project with its own copied video/audio files, never sharing storage with the original.
3. **QA only the duplicate**: every single check in section 4/6 below (A through L) was run against ONLY the duplicate project's id. The original three non-deleted projects and all 16 trashed/soft-deleted ones were never opened, selected, or written to.
4. **Diff before/after**: a script compared every `Project`, `Subtitle`, `VideoAsset`, and `ExportJob` row present in the backup against the same rows in the live DB after QA, field-by-field, excluding `updatedAt`.

**Diff result: zero content differences in any of the 19 pre-existing `Project` rows or their 2,266 `Subtitle` rows.** The only new rows were exactly the ones this session's own QA created: 1 new `Project` (the disposable duplicate), 1 new `VideoAsset` (its copied video), 1 new `ExportJob` (the test export run against it) — all three were then deleted (cascade) after QA, and a second diff pass confirmed the database was restored to an exact match against the pre-QA backup (project/subtitle/video/exportJob counts: 19/2266/19/46 before, identically 19/2266/19/46 after cleanup). No new persistent clipboard field or table was created anywhere (`captionClipboard` remains purely in-memory, as designed).

## 6. Packaged QA checklist (Phase 3) — full results, all PASS

All of the following were run against the actual installed `SUBLY.exe` (via its own embedded Next server on a real localhost port, e.g. `127.0.0.1:64455` — not `npm run dev`), against the real duplicated Hindi/Hinglish project described above.

**A. Single caption copy** — PASS. Plain-clicking a caption (which focuses its own textarea) then Ctrl+C correctly copies the caption ("Copied caption" toast); confirmed via the undo stack that copy creates zero history entries (pressing Undo once after a copy undid the *previous real mutation*, proving copy itself was never on the stack).

**B. Single caption cut** — PASS, all 8 sub-checks: text emptied; caption row/timing (`start`/`end`) unchanged; `words` array left with its original 5 entries untouched (never deleted/fabricated); the analyzer flagged it under "Empty caption (1)" after Analyze; Ctrl+Z (toolbar) restored the exact original text; Ctrl+Shift+Z (toolbar) re-applied the cut.

**C. Single caption paste** — PASS, all 7 sub-checks. Same-token-count paste ("Hi world"-style substitution) preserved every word's real timestamp AND real transcription confidence value exactly (`0.9`, `0.784`, etc. — not fabricated), while remapping only the word text — direct, real-data confirmation of `remapWordsToText`'s "same count → keep timestamps" contract. A different-token-count paste (2-word clipboard into a 4-word caption) correctly left `words` untouched and surfaced the pre-existing "Text changed the number of words" stale banner. Destination timing/only-the-target-caption-changes both confirmed via the live API.

**D. Multi-caption copy** — PASS. Selected two NON-adjacent captions in reverse click order (later-timeline one clicked first); copy still produced a clipboard in TIMELINE order, confirmed by the subsequent paste (section E); zero undo entries (same undo-skip proof as test A).

**E. Multi-caption matched paste (N→N)** — PASS, all 8 sub-checks. Two copied captions pasted onto two selected captions mapped strictly by position in TIMELINE order (not click order) on both the source and destination sides; exactly one undo step reverted (and one redo re-applied) both captions together; destination timing was the destination's own original `start`/`end`, never the source's; `style`/`animation` stayed absent (never written — matches the code path, which never touches those fields); word-timing semantics identical to test C.

**F. Multi-caption count mismatch, both directions** — PASS, both directions, every sub-check: dialog appeared with the exact copied/selected counts and a numbered preview of the captions that would actually be pasted; nothing changed in the project before confirming; confirming applied only `min(copied, selected)` pairs; no copied caption's text was ever repeated across two destinations; the destination(s) beyond `pasteCount` were verified byte-for-byte untouched via the live API; exactly one undo step reverted the whole (truncated) batch together, in both the 2-into-3 and 3-into-2 direction.

**G. Native textarea clipboard priority** — PASS. With an actual character range selected inside a caption's textarea, Ctrl+C produced **no** caption-level toast at all (native selection-copy silently won). Typing-target guards independently confirmed on: the project name `<input>`, the Find & Replace dialog's search `<input>`, and a word-timing popover's numeric `<input>` — Ctrl+C fired no caption-level action in any of the three.

**H. Dialog safety** — PASS. While the paste-mismatch dialog was open: Ctrl+Z had zero effect on the editor (captions unchanged) and did not close the dialog; Ctrl+C did not leak a caption-level copy; the dialog's own Cancel/Paste-N buttons remained fully clickable throughout (used dozens of times across test F); after closing (both via Cancel and via successful Paste-N), Ctrl+C/Z resumed working normally on the editor. One real (mid-session, non-P14) lesson: a mismatch dialog that's opened and then not explicitly closed correctly continues blocking every other shortcut via `isAnyDialogOpen()` — this session lost track of one such dialog partway through manual testing and briefly misread the resulting "no toast" as a possible regression; a page reload plus a clean re-test confirmed it was the guard working exactly as designed, not a bug.

**I. Undo/redo** — PASS. Copy = no history entry (A, D). Cut = one entry (B). Exact-match paste = one entry (C, E). Mismatch-confirmed paste = one entry, both directions (F). Undo/redo were confirmed to restore/reapply multi-caption batches atomically (E, F) — one press affects every caption in that one logical operation together, never partially.

**J. Autosave/reload** — PASS. Cut a caption, waited for the top bar's "Saved" indicator, then did a full page reload against the packaged server (equivalent to closing and reopening the project). The persisted text, `start`/`end`, and `words` count all matched exactly what was set before reload.

**K. Export** — PASS. Ran a real export (1080p, 30fps, high quality) against the packaged FFmpeg binary from inside the edited (post-cut/paste) project: `ExportJob` reached `status: "DONE"`, `stage: "complete"`, `progress: 100`, `errorMessage: null`; the output file (`.../exports/<id>.mp4`) exists, returns HTTP 200, `content-type: video/mp4`, and is a real ~3.0MB file — not an empty/corrupt stub. No clipboard-specific regression: the export pipeline reads `project.subtitles` exactly as P14 leaves it (P14 never touches export code at all).

**L. Offline behavior** — PASS by construction, confirmed by code inspection (not separately re-verified live beyond what sections A–K already exercised over `127.0.0.1`, never any external host): `buildCaptionClipboard`/`resolvePasteMapping`/`applyTextMap` are pure, synchronous, local-only functions; the only network-shaped API used anywhere in the P14 code path is the browser's own `navigator.clipboard` (an OS-level API, not a network call) for the best-effort OS-clipboard read/write, and its failure path is already handled gracefully (section 15). Every check in A–K above ran against the packaged app's own local server with no external network access available in this sandboxed environment, which is itself a live demonstration of offline operation.

## 7. Full test count

**904/904 passing** — unchanged from Task 101583 (no new P14 bugs were found during packaged QA that required a new regression test).

## 8. Typecheck result

`npm run typecheck` — clean, 0 errors (confirmed at both 0.1.14 and the final 0.1.15).

## 9. Lint result

`npm run lint` — 0 errors, the same 5 pre-existing warnings as Task 101583's report, all in files this task never touched (`project-card.tsx`, `lib/ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`).

## 10. Autosave/reload result

PASS — see section 6, item J.

## 11. Export result

PASS — see section 6, item K.

## 12. Native clipboard priority result

PASS — see section 6, item G.

## 13. Dialog guard result

PASS — see section 6, item H.

## 14. Undo/redo result

PASS — see section 6, item I.

## 15. Known mid-edit limitation

Re-tested explicitly in the packaged app (Phase 5), not just in dev: focused a caption's textarea, typed additional text WITHOUT blurring (caret active, no selection), pressed Ctrl+X. Result: identical to the dev-QA finding in Task 101583 — the uncommitted keystrokes are silently discarded (the store's committed pre-edit text is what gets cut), and the cut itself is a normal, single, fully undo-recoverable commit (confirmed: Undo restored the exact pre-cut committed text). No new or worse behavior was found in the packaged build. This remains an accepted, documented tradeoff — see Task 101583's report section 8/19 for the full reasoning on why it wasn't architecturally "fixed" (doing so would either turn one user action into two undo steps, or require reaching into `CaptionRow`'s local React state from outside React).

## 16. Newly discovered issues

**One packaging hygiene issue found, pre-existing and NOT caused or exposed by P14** — per this task's own explicit "fix ONLY issues introduced or exposed by P14; do not make unrelated cleanup changes" instruction, this was documented, not fixed:

The packaged `resources/app-server/` directory contains a few stray files that Next's file-tracing swept up from the repo root and `scripts/postbuild-standalone.js`'s own stray-file cleanup list doesn't know about: `AGENTS.md` (678 bytes), `CLAUDE.md` (11 bytes), `README.md` (1,450 bytes), and — more notably — an **empty (0-byte) leftover QA backup filename**, `UsersUserAppDataRoamingsubssubly.db.bak-pre-p8-multi-caption-qa`, sitting untracked in the repo root since at least Task P8, long before P14. (`THIRD_PARTY_NOTICES.txt`, also present, is arguably fine/intentional to ship — it's a legitimate open-source license notice, not a dev-only artifact.) Total size impact is negligible (under 8KB combined, and the `.bak` file is 0 bytes), so this is a hygiene/scope issue, not a size or security one — but it would affect every future release build regardless of P14, and belongs in `postbuild-standalone.js`'s own stray-file list as a small, separate follow-up task.

No other issues were found. No P14-specific bug was discovered during this closure task's extensive packaged QA.

## 17. Version

**0.1.15.** Every required release gate genuinely passed in this session (packaged build ×2, packaged install, full Phase 3 checklist A–L, a genuine database-level before/after comparison per section 5, full regression suite, typecheck, lint) — per Phase 8's own instruction, the version was bumped only after all of that, and the installer was rebuilt one final time at the new version number.

Verified version sources:
- `package.json`: `"version": "0.1.15"`.
- Electron app version: derived automatically from `package.json` (no separate file) — confirmed via the final installer's own generated filename.
- Sidebar/version UI: `NEXT_PUBLIC_APP_VERSION` baked in at Next build time from the same `package.json` field (`next.config.ts`) — directly confirmed in the final smoke test by fetching the packaged app's own served JS chunk (`/_next/static/chunks/25k8v9itsmwt3.js`) and finding the literal string `"0.1.15"` inlined in it. See section 4's install notes for why the literal in-window sidebar pixels weren't screenshotted (a Claude Code sandbox limitation, not a functional gap) — this direct bundle check closes that gap.
- Installer metadata / generated filename: `release\SUBLY Setup 0.1.15.exe` (566,407,222 bytes ≈ 540MB — matching the 0.1.14 build's size almost exactly, as expected since nothing but the version string changed), `release\SUBLY Setup 0.1.15.exe.blockmap`.
- A final install-and-launch smoke test of this exact 0.1.15 installer was performed as the closing step of this task.
