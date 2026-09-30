# P19.14 — Final Packaged Release Closure

**Task ID:** 141673
**Date:** 2026-09-30 (IST)
**Scope:** (1) fix the two P19.13 packaging-hygiene defects, (2) build a fresh 0.1.19 installer via the real, unmodified `npm run electron:pack` pipeline, (3) complete the packaged-app regression matrix P19.13 explicitly left incomplete — every item below is labeled by how it was actually verified, and no item is marked done on the strength of a unit test or dev-mode QA alone.

---

## STATUS: **PASS WITH LIMITATION**

A genuine, high-confidence **P1 defect was found and is NOT fixed** (out of this task's authorized scope — see §"New defect found"). Everything else required by this task passed, verified against the real installed 0.1.19 Electron application.

---

## VERSION

`0.1.18` → **`0.1.19`** (`package.json`, this task's version bump).

## INSTALLER

`release/SUBLY Setup 0.1.19.exe` — **566,401,287 bytes**, built 2026-09-30 10:51 IST. Distinct filename/size from both `0.1.17` and `0.1.18`. `whisper-worker.exe` genuinely rebuilt fresh by this run's `worker:build` step (PyInstaller freeze of the unchanged `whisper_worker.py`). Source baseline: git HEAD `93d49ec` (P1–P19.13 work remains untracked/pre-existing repo state, unrelated to this task).

## BUILD

Ran the real, complete `npm run electron:pack` pipeline (`clean && worker:build && build && electron-builder --win`) twice:
- **1st attempt failed** with a Rust/Turbopack out-of-memory crash (`memory allocation of 774731149 bytes failed`) during `next build`. Root cause: **Adobe After Effects (`AfterFX.exe`) was independently consuming ~13GB of this shared machine's 31.77GB RAM** at the time — confirmed via `Get-Process | Sort-Object WorkingSet64`, not a SUBLY code or packaging regression. Not touched (someone else's real, unrelated work) and not the pipeline's fault.
- **2nd attempt succeeded outright**, exit code 0, no manual substitution of any pipeline step (worker build, Next build, and electron-builder all ran for real, unmodified, exactly as `npm run electron:pack` defines them).

Verified: whisper-worker.exe freshly rebuilt (build log's own `Build complete!` timestamp matches this run), Next standalone build succeeded, electron-builder succeeded (`perMachine=false`, `oneClick=false` confirmed from the build log), installer produced.

## PACKAGING HYGIENE (Part 1 — fixed this task)

**Fix**: `scripts/postbuild-standalone.js` — added `AGENTS.md`, `CLAUDE.md`, `README.md` to `STRAY_ENTRY_NAMES`, and added a new pattern-matched sweep (`STRAY_FILE_PATTERNS = [/\.db\.bak/i]`) that removes any stray `*.db.bak*` file by pattern rather than exact name (matching the existing pattern-based philosophy already used for `STRAY_DIR_NAMES`, and robust to a *different* future QA snapshot filename, not just the one P19.13 happened to find). The sweep logic was pulled out into an exported, directly-testable `sweepStrayEntries(standaloneDir)` function.

**Test added**: `scripts/__tests__/postbuild-standalone.test.js` (4 tests) — exercises the real sweep function (not a reimplementation) against a throwaway directory: confirms `AGENTS.md`/`CLAUDE.md`/`README.md` are removed, confirms a `.db.bak-*` file is removed *regardless of its exact name* (a second, differently-named fixture proves this), confirms unrelated same-substring files are never touched, and confirms the pre-existing `release*/research/python` directory sweep still works after the refactor. Registered in both `package.json`'s `test` and `test:reliability` scripts.

**Verified fixed, directly in the real packaged build's `resources/app-server/`** (filesystem inspection, not the build log's own claim):
```
OK: AGENTS.md absent
OK: CLAUDE.md absent
OK: README.md absent
OK: UsersUserAppDataRoamingsubssubly.db.bak-pre-p8-multi-caption-qa absent
```
All previously-required resources still present and unaffected: `server.js`, `prisma/template.db`, `python/dist/whisper-worker.exe`, `node_modules/ffmpeg-static/ffmpeg.exe`, `node_modules/@ffprobe-installer/win32-x64/ffprobe.exe`, `assets/fonts-cache-seed/`.

No changes were made to `extraResources`, `process.resourcesPath` resolution, ffmpeg/ffprobe/whisper-worker packaging, Prisma template DB packaging, electron-builder config, or the Next standalone architecture — confirmed by diff scope (only `scripts/postbuild-standalone.js`, one new test file, and two `package.json` script-list edits + the version bump).

## FRESH INSTALL

Silent install (`/S`) into a brand-new isolated userData directory (`C:\SublyQA0119-userdata`, launched via Electron's own `--user-data-dir` switch — never touching this machine's real accumulated `%APPDATA%\subs` development data). Verified directly:
- Install succeeded, exit code 0, **no admin elevation**.
- App launched; packaged Next.js server booted on a real local port.
- Fresh `subly.db` created from `template.db` (byte-identical size, 106,496 bytes) — **0 projects** on first query.
- `fonts-cache/` seeded with all 16 built-in fonts on first run.
- Installed exe's own version metadata: `FileVersion 0.1.19`, `ProductVersion 0.1.19.0`.
- `/api/system/status` reported `storagePath`/`databasePath` exclusively under the isolated userData dir — no source-tree or dev-directory dependency.
- Packaged worker confirmed launching from `resources\app-server\python\dist\whisper-worker.exe` (process path inspection), never from the source tree or a system Python.

## PACKAGED REGRESSION MATRIX (Part 5 — the primary purpose of this task)

### A. Output modes
Tested in the real installed app, real UI: created a Hindi project, ran **real** Hindi transcription (packaged worker), switched Original → Hinglish via the actual Settings-tab toggle. Verified: mode switched correctly; every caption's `hinglishText` and every word's `hinglishText` populated immediately; mode field (`captionOutputMode: "hinglish"`) survived a full page reload. **Gujarati Script**: no legacy Gujarati-language fixture existed on this machine to exercise "legacy projects usable" — not independently re-verified this session (same disclosed gap as P19.13; no new Gujarati ASR was added, per instruction).

### B. Word editing
All 8 items exercised via **real UI clicks** in the installed app (word-timing-popover buttons, not synthetic events), each confirmed via a direct DB read after the action:
1. **Reorder** — moved "a" later in "This is a test"; text correctly recomposed.
2. **Insertion** — inserted "INSERTED" between "recording" and "for" (had to first open a timing gap via the popover's real Earlier/Later steppers, since Whisper's word timings are back-to-back by default); new word object created with correct timing.
3. **Deletion** (hard delete) — removed "te" (from a prior split) via the popover's Delete button; word fully removed, text recomposed.
4. **Split** — split "test" into "te"/"st" via the real split-form UI; two word objects created.
5. **Merge** — merged "HELLO"+"WORLD" into a seeded two-line caption; DB confirms **one** word object `{"text":"HELLO WORLD", ...}` — never split back into two.
6. **Soft-removed word stays excluded** — marked "is" `removed:true`, then performed a real UI reorder of neighboring words; the recomputed `.text` never resurfaced "is" (`"This st a"` → after reorder → `"This a st"`, "is" absent throughout, present in `words[]` with `removed:true`).
7. **Merged multi-token word remains one word object** — confirmed in the same merge as #5, both immediately in the DB and via a **real MP4 export + frame extraction**: the rendered frame shows "HELLO WORLD" highlighted as a single active-word unit, "TESTING MERGE" in base style.
8. **Multiline caption remains correctly structured** — the seeded 2-line caption ("HELLO WORLD\nTESTING MERGE") correctly re-wrapped to a single line after the merge edit (expected `breakIntoLines` behavior for a caption that now fits on one line — not a corruption), confirmed coherent and non-garbled via the exported frame.

### C. P19.12 timeline undo (real mouse drag)
Performed exactly as specified, via **real `left_click_drag`** (not synthetic pointer events) in the installed app:
1. Two independent edits first (`EDITED1`, `EDITED2` appended to two different captions' text).
2. Real drag moved a caption block in the timeline: `2.0–3.7` → `2.9–4.6` (clamped correctly against its neighbor).
3. **Ctrl+Z once** → entire drag undone in a single step (`2.9–4.6` → back to `2.0–3.7`) — proves the P19.12 drag-coalescing fix.
4. **Ctrl+Z again** → `EDITED2` undone.
5. **Ctrl+Shift+Z** → `EDITED2` restored.
6. **Ctrl+Shift+Z again** → drag restored (`2.9–4.6`).
All 4 steps confirmed via direct DB reads at each step. **This closes the exact packaged-verification gap P19.13 disclosed.**

### D. Timeline
Verified in the real installed app: **zoom in** (visibly re-scaled the timeline), **fit to project** (re-fit after zoom), **timecode navigation** (typed `00:05.00` into the "Go to time" field, playhead and video preview jumped correctly), **ruler** (tick labels visible throughout), **ripple delete** (deleted a caption, confirmed all later captions shifted earlier by exactly its duration, then undone — full caption set restored), **word timing handles** (exercised via the popover's start/end Earlier/Later steppers in section B). **Snapping** and **fit-to-selection** were not explicitly isolated as separate checks this session — a real coverage gap, disclosed rather than assumed passing.

### E. Word preview scaling + export
Applied a real word-style override (fontSize 110, letterSpacing 10, fontWeight 900, color `#FF3355`) to the merged "HELLO WORLD" word. At a small (500×700) resized preview, DOM inspection showed proportional font-size scaling relative to the base caption's own scaled size, consistent with the P19.12 `scaleWordStyleValue` fix being active — though isolating the *active-word* state's exact computed values via ad-hoc DOM queries proved ambiguous (the active-word highlight and manual override interact in ways this session's quick inspection couldn't cleanly disambiguate). **The definitive, ground-truth check — a real MP4 export + frame extraction — is unambiguous**: the frame shows "HELLO WORLD" rendered dramatically larger, in the override color, with visible letter-spacing, correctly *independent of whether the word is the currently-active one* (checked at t=8.6, when "TESTING" — not "HELLO WORLD" — was the active/highlighted word). Export-time styling is confirmed correct.

### F. Derived-mode undo/redo — **led to a new P1 finding**
Followed the exact prescribed sequence (Original → Hinglish → edit → undo across the boundary → redo) in the real Hindi project via real UI interactions. The mode-switch/coverage-generation behavior itself (the actual subject of P19.12's fix) worked correctly — `ensureHinglishCoverage` correctly back-fills every caption's derived text after an undo crosses a mode-switch boundary, exactly as designed. **However, in the course of this exact test, a separate, more serious, previously-undetected defect was found — see "New defect found" below.**

### G. Landscape export
Real 16:9 project, real MP4 export via the packaged pipeline. Verified with the **packaged** `ffprobe.exe`: 1920×1080, duration 9.06s (matches source). Frame extracted with the **packaged** `ffmpeg.exe` at the seeded multiline caption's timestamp: "LANDSCAPE MULTILINE" / "CHECK HERE" renders correctly, centered, no clipping, active word highlighted correctly.

### H. Square export
Real 1:1 project, real MP4 export. Packaged `ffprobe.exe`: 1080×1080, duration 9.06s. Packaged-`ffmpeg.exe` frame: "SQUARE MULTILINE" / "CHECK HERE" renders correctly, no clipping.

### I. Persistence
One project carrying word edits (split/insert/delete/reorder), a word style override, a multiline merged caption, and a real timeline timing change (the drag from Part C) was taken through save → **full app close (`Stop-Process -Force` on all `SUBLY.exe`)** → relaunch → reopen project. Every caption's text/timing and the word-level style override were confirmed byte-identical via the real API on the relaunched instance (fresh port, fresh process). No data loss.

### J. Crash recovery
Repeated the P19.13 forced-kill test once, on the isolated QA userData directory only (real developer data never touched): started a real transcription, force-killed the whole app mid-flight, relaunched. The project correctly surfaced `ERROR` / `"Previous processing was interrupted. You can retry this project."` (not stuck); retry afterward started a fresh transcription normally.

## SOURCE TESTS

`npm test`: **1876/1876 passing** (1872 baseline + 4 new hygiene-fix tests), 0 failing.

## TYPECHECK

`npx tsc --noEmit`: **0 errors.**

## LINT

`npx eslint .`: **0 errors**, exactly the same **5 pre-existing warnings** as P19.12/P19.13 (`project-card.tsx`, `lib/ai/index.ts`, `lib/analytics.ts`, `subtitles/ass.ts`, `subtitles/preview-style.ts`) — no new warnings introduced.

## DEFECTS

| ID | Severity | Release-blocking? | Status |
|---|---|---|---|
| DEFECT-1 (P19.13) | P2 | No | **Fixed this task** — `AGENTS.md`/`CLAUDE.md`/`README.md` no longer ship in `resources/app-server/`. Verified + regression-tested. |
| DEFECT-2 (P19.13) | P2 | No | **Fixed this task** — stray `.db.bak-*` marker no longer ships; fix is pattern-based, covers any future differently-named stray too. Verified + regression-tested. |
| **DEFECT-3 (NEW)** | **P1** | **Yes — see below** | **Found, not fixed** (out of this task's authorized scope). |

### New defect found: undo()/redo() do not trigger autosave persistence by themselves

**Summary**: Calling `undo()` (Ctrl+Z) or `redo()` (Ctrl+Shift+Z) alone — with no subsequent edit — updates the editor's visible/in-memory state correctly but **does not persist that change to the server**. The change is silently lost if the app is closed (or crashes) before another ordinary edit happens to occur afterward.

**How this was found**: while executing Part F's exact prescribed steps (edit → switch to Hinglish → edit → undo across the boundary → redo, then "if possible, verify the persisted DB state after reopen" — an explicit instruction in this task), a reload-based check surfaced a discrepancy between the visibly-undone client state and the still-un-undone server state.

**Reproduction (clean, isolated, repeated 3 times for certainty)**:
1. Made a real text edit in the installed app; confirmed via direct DB read that it saved (server value matches).
2. Pressed **Ctrl+Z alone** — nothing else. The UI textbox visibly reverted immediately.
3. Waited a clean **8 seconds** with zero other interaction, then re-read the DB directly: **the server still held the pre-undo value** — the undo was never persisted.
4. A full page reload then reverted the *visible* UI back to the pre-undo value too (since the reload reads from the server, which still has the old value) — from the user's perspective, their undo simply "didn't stick."
5. Repeated on a **second, independent project in a different caption-output-mode** (Original mode, not just Hinglish) with the same result — **this is a general defect affecting undo/redo everywhere, not specific to derived display modes**.
6. Confirmed the defect is masked by normal usage: making **any subsequent ordinary edit** after an undo correctly flushes the *current* (already-undone) state to the server along with the new edit — which is why this was easy to miss in earlier dev-mode/unit testing (unit tests exercise the Zustand store directly, never the React `useAutosave` hook's subscription wiring; and typical manual QA rarely stops testing immediately after an undo with no follow-up action).

**Failure scenario**: a user makes an edit, decides to undo it, and then closes the app (or it crashes) without making any further edit — the undo is silently lost, and the pre-undo (undesired) edit reappears next time they open the project. This is a genuine **undo/data-integrity failure**, matching this task's own explicit P1 rubric ("undo/data-integrity failure").

**Why not fixed in this task**: this task's authorized scope was explicitly limited to "(1) fix the two small packaging-hygiene defects, (2) build a fresh installer and complete the missing packaged-app regression matrix" and explicitly said not to fix unrelated issues found along the way. Per the standing instruction across this whole task series ("if any causes an actual packaged-app release failure, document and stop rather than silently fixing/expanding scope"), this is documented here in full, with a clean reproduction, rather than patched.

**Suggested next step** (not undertaken): compare `useAutosave`'s Zustand `subscribe` callback against exactly what `undo()`/`redo()` change relative to what `commit()` changes — the debounced-save subscription in `src/hooks/use-autosave.ts` is the first place to look.

## RELEASE-BLOCKING ISSUES

**DEFECT-3 (undo/redo autosave gap) is a real P1 finding** per this task's own severity rubric. Whether it is *release-blocking* for this specific installer is a product decision for the user/team to make — this report surfaces it with full reproduction rather than making that call unilaterally. Everything else in this task's own required scope (packaging hygiene, fresh install, the regression matrix items A–J, source regression) is clean.

## REMAINING KNOWN LIMITATIONS

- No legacy Gujarati-language project existed on this machine to re-verify "legacy Gujarati projects usable" — not independently tested this session (Gujarati ASR remains correctly deferred, unchanged).
- Timeline **snapping** and **fit-to-selection** were not explicitly isolated as their own checks this session.
- Word-style scaling at a small preview canvas was verified unambiguously **at export time** (ground truth); the live in-editor DOM inspection at a small canvas was inconclusive for the *active*-word case specifically, due to ambiguous DOM-node matching in this session's ad-hoc script, not a demonstrated product defect.
- File associations: still absent, unimplemented — recorded per instruction, not a defect.
- No in-app version/About UI — pre-existing, cosmetic.
- The silent-install `/D=<custom dir>` flag was not exercised this task (not required); a plain `/S` silent install was used throughout, landing at electron-builder's standard per-user default (`%LOCALAPPDATA%\Programs\SUBLY`).

## FINAL PACKAGED RELEASE ASSESSMENT

The packaging-hygiene defects P19.13 found are genuinely fixed and regression-tested. The fresh 0.1.19 installer is a real, complete, unmodified pipeline build. The specific packaged-verification gap P19.13 disclosed — the P19.12 timeline-drag undo/redo test — is now closed with a real mouse-drag proof. The broader regression matrix (output modes, word editing, timeline, export in three aspect ratios, persistence, crash recovery) was directly exercised against the real installed application with concrete evidence (DB reads, real exported frames verified with the packaged ffmpeg/ffprobe) rather than assumed from unit tests or prior dev-mode QA.

The one significant new finding — undo/redo not autosaving by themselves — is real, reproducible, and worth a dedicated follow-up task to fix; it does not appear to have been introduced by anything in this task (P19.14 changed only `scripts/postbuild-standalone.js`, one new test file, and the version bump) and most likely predates P19.14, simply never surfaced by prior testing because prior testing never isolated "undo alone, then wait, then check" as its own scenario.

**Explicit list of what was actually tested against the installed 0.1.19 Electron application** (as opposed to unit tests or dev-mode-only): packaging-hygiene fix (filesystem inspection of the real packaged output), fresh silent install, version metadata, empty-DB-from-template, font-cache seeding, packaged-resource path resolution, output-mode switch + derived-text generation (real Hindi transcription), word reorder/insert/delete/split/merge/soft-remove-exclusion (real UI interactions, DB-verified), merged-word MP4 export + frame, the full P19.12 drag-undo/redo sequence (real mouse drag), timeline zoom/fit/timecode-nav/ruler/ripple-delete, word-style-override MP4 export + frame, derived-mode undo/redo (which is how DEFECT-3 was found), landscape MP4 export + frame, square MP4 export + frame, full persistence cycle across a real app close/relaunch, and forced-kill crash recovery. Source-level regression (tests/typecheck/lint) was run against the packaged build's source tree after packaging completed.
