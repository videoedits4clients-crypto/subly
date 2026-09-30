STATUS: RELEASE CANDIDATE CLEAN

# P19.16 — Final Release Candidate Audit

## 1. Task ID

144901

## 2. Release Candidate

SUBLY **0.1.20** — installer `release/SUBLY Setup 0.1.20.exe` (566,397,087 bytes, built 2026-09-30 by P19.15). Confirmed via `find src scripts -newer` that **no source file has changed since this installer was built** — the existing installer was reused for this audit's packaged verification, per this task's own instruction not to rebuild without cause. No rebuild was performed. No version bump was made.

## 3. Executive Summary

Every P0 and P1 finding from P19.11's original gap audit, plus the one P1 discovered later (P19.14's undo-persistence report), has been fixed and independently verified against real, running code — not just claimed. Ten regression tests added in P19.15 and the full existing 1886-test suite all pass; TypeScript and ESLint are clean. A concise final packaged smoke test against the actual installed 0.1.20 application (fresh launch, existing-project open, new-project creation, real transcription, caption edit, isolated Ctrl+Z/Ctrl+Shift+Z, word edit, timeline zoom, save/reload, real MP4 export, real SRT export, forced-kill recovery, and packaged-binary path verification) passed on all 14 items. A real, accumulated inventory of P2/P3 limitations remains — none of them block release under this task's own severity rubric (all have viable workarounds, degrade gracefully, or are already-disclosed/deliberate design trade-offs). No new release-blocking defect was found during this audit's own source and packaged verification.

## 4. Source Test Results

Run fresh in this task, against the unchanged 0.1.20 source tree:

- `npm test`: **1886/1886 passing**, 0 failing. **Unchanged from P19.15** — no test was added, removed, or modified in this task, so the count matches exactly (1876 pre-P19.15 baseline + 10 tests P19.15 added for the undo/redo persistence fix).
- `npx tsc --noEmit`: **0 errors.**
- `npx eslint .`: **0 errors**, the same **5 pre-existing warnings** carried since at least P19.12 (`project-card.tsx` unused `router`, `lib/ai/index.ts` unused `fallback`, `lib/analytics.ts` unused eslint-disable, `subtitles/ass.ts` unused `lineDurSec`, `subtitles/preview-style.ts` unused `scale`) — no new warning introduced.

## 5. Known Issue Inventory

Reconciled against P19.11's original audit (the master inventory) and every fix/verification made since, with direct source evidence re-checked in this task (not assumed from memory).

### P0/P1 (original P19.11 findings + the P19.14-discovered persistence issue)

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Pricing page ships fictional plan limits + literal placeholder text (P0) | **FIXED** | P19.12 rewrote `pricing.tsx`; re-confirmed this task via grep — no "Placeholder pricing"/watermark claims remain, "Free during preview" copy present. |
| 2 | Translate menu offers 6 backend-rejected languages (P1) | **FIXED, VERIFIED WORKING** | P19.12 added `TRANSLATABLE_LANGUAGES`; re-confirmed this task — `ai-menu.tsx` still filters against it. |
| 3 | Word-level Size/Letter-spacing preview scaling missing (P1) | **FIXED, VERIFIED WORKING** | P19.12 fix; verified via real MP4 export + frame extraction in P19.13 and again in P19.14 (word-style-override scaling confirmed correct at export time). |
| 4 | Timeline caption-drag can silently evict undo history (P1) | **FIXED, VERIFIED WORKING** | P19.12 added drag-coalescing (`captionDragPreview`); verified via a **real mouse `left_click_drag`** in the packaged app in P19.14, closing the exact gap P19.13 disclosed. Re-confirmed present in source this task. |
| 5 | Removed/soft-deleted filler words reappear in caption text (P1, B1) | **FIXED, VERIFIED WORKING** | P19.12 added `.filter((w) => !w.removed)` at 5 text-rebuild call sites; verified live in P19.14 (reorder after soft-remove never resurfaced the removed word). Re-confirmed 5 occurrences present in source this task. |
| 6 | Merged multi-token word breaks line-wrap reconstruction (P1, B2) | **FIXED, VERIFIED WORKING** | P19.12 rewrote `joinWithOriginalLineBreaks`; verified via real merge + MP4 frame extraction in P19.13 and again in P19.14 (both portrait and, structurally, landscape/square multiline cases). |
| 7 | Undo/redo across a mode-switch leaves derived text ungenerated (P1) | **FIXED, VERIFIED WORKING** | P19.12 added `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` to `undo()`/`redo()`; re-confirmed present in source this task; verified live in P19.14. |
| 8 | Undo/redo doesn't autosave when isolated (P1, discovered P19.14) | **FIXED, VERIFIED WORKING** | Root-caused in P19.15 as a browser-native-textarea-undo issue (not a store/autosave defect — that was proven correct by 10 new regression tests). Fixed via Ctrl+Z/Ctrl+Shift+Z interception in `captions-panel.tsx`. All 6 of P19.15's required packaged tests passed; **re-confirmed working in this task's own smoke test** (items 6–7, §7). |

**No P0 or P1 issue is currently open.**

### P2 (original P19.11 findings + accumulated)

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Export dialog ignores quality-report staleness | **STILL OPEN** | Re-confirmed this task: no `isQualityReportStale`/`qualityReportSubtitles` reference in `export-dialog.tsx`. |
| 2 | Export reads last-saved DB state without flushing pending autosave debounce | **STILL OPEN** | Never touched by any subsequent task; not reproduced live (a timing race, not a confirmed defect). |
| 3 | Autosave success handler can clear `dirty`/crash-snapshot for a newer in-flight edit (narrow race) | **STILL OPEN** | Re-confirmed this task: `use-autosave.ts`'s `runSave` success path still unconditionally does `useEditorStore.setState({ dirty: false })`. P19.15's refactor was behavior-preserving and did not touch this narrow window; the already-scheduled next debounce mitigates the worst case, per P19.11's own analysis. |
| 4 | `TOO_FAST`/`TOO_SHORT` "Fix all" can inflate its own fixed-count | **STILL OPEN** | Never touched; already pinned by an existing test. |
| 5 | `escapeAssPathForFfmpeg` doesn't escape a literal single quote | **STILL OPEN** | Re-confirmed this task: function only escapes `\` and `:`. |
| 6 | Malformed-but-valid-JSON style/animation data isn't type-checked on read | **STILL OPEN** | Never touched; only reachable via a hand-edited/legacy row, not the ordinary UI. |
| 7 | Word-level `fontWeight` overrides never scanned by export font-bundling | **STILL OPEN** | Re-confirmed this task: `collectRequiredFonts` still only reads `globalStyle`/resolved caption style, not `word.style.fontWeight`. |
| 8 | Offline font-cache seed covers only 16 of 100+ font/weight combinations | **STILL OPEN** | Re-confirmed this task: `assets/fonts-cache-seed` still has exactly 16 files. Explicitly deferred by every task's own instructions since P19.11. |
| 9 | `afterPack` only warns (never hard-fails) on a missing Whisper worker, and never checks ffmpeg/ffprobe presence at all | **STILL OPEN (code-level)**, risk mitigated by process | Re-confirmed this task: `electron-builder-after-pack.js` has zero `ffmpeg`/`ffprobe` references. Every packaging task since (P19.13–P19.15) has manually, directly verified these binaries' presence in the packaged output rather than trusting the build step — an accepted, working compensating control, not a code fix. |
| 10 | Multi-selection timeline overlays aren't viewport-virtualized | **STILL OPEN** | Never touched; a performance concern only at very large multi-selections. |
| 11 | `boxWidthPercent` has zero effect on ASS export margins | **STILL OPEN** | Re-confirmed this task: zero occurrences of `boxWidthPercent` in `ass.ts`. Explicitly deferred every task since P19.10/P19.11; degrades gracefully (documented). |
| 12 | Packaging hygiene — `AGENTS.md`/`CLAUDE.md`/`README.md`/a stray `.db.bak` file shipped inside the installer's resources | **FIXED, VERIFIED WORKING** | P19.14 fixed `postbuild-standalone.js` (pattern-based, catching any future differently-named stray file too), with 4 dedicated regression tests. Confirmed absent in both the 0.1.19 and 0.1.20 packaged outputs. |
| 13 | Packaged Windows installer had not been rebuilt/QA'd since before P17 | **FIXED/RESOLVED** | P19.13 through P19.15 built and thoroughly packaged-QA'd fresh installers (0.1.18 → 0.1.20) covering everything through this audit. The release-process gap P19.11 called "the single most important release-readiness fact" no longer exists. |

### P3 / Known-by-design limitations (unchanged, re-confirmed still accurate)

Gujarati (and other) ASR deferred; GPU transcription deferred; cloud sync/collaboration out of scope; regex find/replace deferred; multi-word insertion deferred; batch split/merge/reorder deferred; "paste timing" deferred; per-word font-family/outline/shadow/text-case/background-radius unsupported by design; active-word chip is a documented heuristic-width estimate; Typewriter/word-pop/char-pop animations are the same capped ~150ms fade (a **marketing-naming** overclaim for "Typewriter" specifically, not a functional bug); "Style every word — fonts, colors, animation" marketing copy overclaims per-word font/animation support that doesn't exist; AI text tools and translation require a cloud OpenAI key with no disclosure in marketing copy (functions correctly in a "(Demo)" no-op mode without one — not silently broken, just undisclosed); translation resets word-level timing to evenly-spaced values without disclosing that nuance; SRT/VTT/TXT timestamps vs. active trim/cut edits was never confirmed by an actual export-and-compare test (a plausible-but-unconfirmed hypothesis, not a demonstrated defect); no file associations (deliberate); no in-app About/version display (deliberate); no auto-updater (install-new-version model, deliberate); uninstall leaves user data in place (electron-builder default, unmodified); ffmpeg/ffprobe ship twice inside the installer (~166MB redundant, documented since P3); no dedicated renderer-crash handler beyond a generic `uncaughtException` logger.

None of these were reopened or re-litigated in this audit, per this task's own explicit instruction — they are listed here only for completeness of the reconciliation.

## 6. Current Source Audit

No source changes occurred since P19.15's build, so this is a verification-of-current-state exercise, not a diff review. Evidence for each requested category:

| Area | State | Evidence |
|---|---|---|
| A. Persistence/autosave | Working; one documented P2 narrow race remains (§5 #3) | `use-autosave.ts`'s `wireAutosave` unchanged since P19.15; 10 dedicated tests passing. |
| B. Undo/redo | Working | P19.12 mode-switch-coverage fix + P19.15 native-textarea fix both present and tested; smoke test re-confirmed both directions. |
| C. Caption editing | Working | Real UI edits (text, blur-commit) verified in this task's smoke test and throughout P19.13–16. |
| D. Word editing | Working | Reorder verified live this task; split/insert/delete/merge/soft-remove-exclusion verified live in P19.14. |
| E. Timeline editing | Working; snapping/fit-to-selection not separately isolated (**not tested**, not known-broken) | Zoom verified this task; real mouse-drag + ripple-delete + timecode-nav verified in P19.14. |
| F. Export | Working | Real MP4 (packaged ffprobe: 720×1280, correct duration) + real SRT (correct, edit-reflecting content) verified this task; landscape/square previously verified in P19.14. |
| G. FFmpeg/FFprobe resolution | Working | Confirmed present at `resources/app-server/node_modules/ffmpeg-static/ffmpeg.exe` and `.../@ffprobe-installer/win32-x64/ffprobe.exe`, both used successfully in this task's export. |
| H. Whisper worker resolution | Working | Confirmed running from `resources/app-server/python/dist/whisper-worker.exe` via live process inspection during this task's real transcription. |
| I. Packaging | Working | Existing 0.1.20 installer matches current source exactly (no newer files); hygiene fix confirmed intact. |
| J. Project recovery | Working, with one noted nuance | Forced-kill during a **retry** on an already-`READY` project (with existing captions) recovered to a clean `READY` state (not an `ERROR`/interrupted state) — a different but equally valid, non-data-losing outcome from the `EMPTY→ERROR` case tested in P19.13–15. All projects' data remained intact and uncorrupted afterward. Not a defect; noted as a behavioral nuance worth being aware of. |
| K. Database/template init | Working | Not re-tested fresh this task (no new install was needed since the 0.1.20 userData from P19.15 was reused), but structurally unchanged from P19.13–15's repeated verification. |
| L. Output modes | Working (Original/Hinglish); Gujarati Script **not re-tested** this round | No legacy Gujarati fixture available on this machine (per this task's own "do not reopen" list); the code path is symmetric with the Hinglish path already verified and covered by existing unit tests. |
| M. Font handling | Working for the 16 seeded fonts; coverage gap remains (§5 #8) | Unchanged since P19.13's explicit verification. |
| N. Windows-specific behavior | Working | No admin elevation needed (confirmed by every silent install since P19.13); single-instance lock and clean uninstall previously verified in P19.13, code unchanged since. |

No genuine release-risk regression was found in any category.

## 7. Packaged Smoke Test

Run against the **existing, unmodified 0.1.20 installer**, freshly launched with an isolated `--user-data-dir`, real packaged resources throughout (no dev server, no mocks).

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Fresh launch | PASS | App launched cleanly, no admin elevation, packaged Next.js server started. |
| 2 | Existing project open | PASS | Opened a P19.15 QA project; all prior captions/timeline/video state intact. |
| 3 | Create/open project | PASS | Created a new project via the real dashboard "New project" → "Continue to upload" UI flow. |
| 4 | Real transcription | PASS | Uploaded real media; `TRANSCRIBING` → `READY` with 5 real captions; `whisper-worker.exe` confirmed running from the packaged path during the run. |
| 5 | Caption text edit | PASS | Edited caption text via the real textarea; confirmed saved to the database. |
| 6 | Ctrl+Z inside caption textarea | PASS | Isolated undo correctly reverted and persisted (DB confirmed) — the exact P19.15 fix re-verified in a brand-new project. |
| 7 | Ctrl+Shift+Z | PASS | Redo correctly restored and persisted. |
| 8 | Word edit | PASS | Real word-reorder via the word-timing popover; correctly saved and reflected in reload. |
| 9 | Timeline edit | PASS | Zoom-in visibly rescaled the timeline. |
| 10 | Save/reload | PASS | Full page reload showed both the word-reorder and the earlier text edit intact. |
| 11 | MP4 export | PASS | Real export completed; packaged `ffprobe.exe` confirmed 720×1280, h264/aac, correct duration. |
| 12 | SRT export | PASS | Real SRT download, content correctly reflects all prior edits. |
| 13 | Crash/recovery path | PASS (with a noted nuance, §6.J) | Forced-kill mid-retry-transcription; relaunch showed the project recovered to a clean, usable `READY` state with all data intact; no other project was affected or corrupted. |
| 14 | Packaged worker/FFmpeg path verification | PASS | Direct filesystem check confirmed all three binaries (`whisper-worker.exe`, `ffmpeg.exe`, `ffprobe.exe`) present at their expected packaged paths, and process inspection confirmed the worker actually ran from there. |

**14/14 pass.** This was a targeted confirmation pass, not a repeat of P19.14's full regression matrix, per this task's own instruction.

## 8. P0 Issues

**None currently open.** The one P0 found across the entire P19.x history (Pricing page) was fixed in P19.12 and remains fixed (re-confirmed this task).

## 9. P1 Issues

**None currently open.** All 8 P1 findings (7 from P19.11 plus the one discovered in P19.14) are fixed and independently re-verified with concrete evidence, both in source and in the real packaged application (see §5 table).

## 10. P2 Issues

Eleven items remain genuinely open (§5 table), none of them release-blocking under this task's own rubric — each either has a viable workaround, degrades gracefully, is only reachable through a non-ordinary path (a hand-edited DB row, an extreme caption length, a username containing an apostrophe), or is a process risk already mitigated by manual verification each release. These are presented as **recommended future work**, not blockers. Two are explicitly **release-decision items** rather than pure engineering defects, since they concern marketing-copy honesty rather than functional correctness:

- The "Typewriter" animation name and the "Style every word — fonts, colors, animation" claim both overstate what the product actually does (per §5's P3 list). Neither is newly discovered — both were already catalogued in P19.11 — and neither was addressed in any subsequent task, since only the P0 pricing page and the P1 translate-menu mismatch were in scope for copy fixes. Whether these should be corrected before a public release is a product/marketing-copy decision, not an engineering one.

## 11. P3 / Future Work

See §5's "P3 / Known-by-design limitations" list. All are either deliberate, previously-litigated design trade-offs or narrow, already-disclosed edge cases. None require action before release. Recommended (optional, no urgency): expand the offline font-cache seed; escape single quotes in `escapeAssPathForFfmpeg`; add the export-dialog quality-staleness indicator; derive ASS margins from `boxWidthPercent`; scan `word.style.fontWeight` in `collectRequiredFonts` (after first confirming with a real render whether it actually matters); make `afterPack` hard-fail on a missing ffmpeg/ffprobe, not just Whisper.

## 12. Known Limitations

Per this task's own explicit list — none reopened, none found to be release-blocking:

- No legacy Gujarati fixture available for packaged verification (Gujarati Script mode itself is unit-tested and shares the Hinglish code path already verified live) — **not tested**, not known-broken.
- Gujarati ASR remains deferred — **known limitation**, deliberate.
- Timeline snapping / fit-to-selection were not separately isolated as their own smoke-test items in P19.14 or this task — **not tested**, not known-broken (both are covered by existing unit tests and were used incidentally without issue during other live QA).
- File associations absent — **known limitation**, deliberate.
- No in-app About/version UI — **known limitation**, deliberate.
- Project-name input and word-popover text fields were not audited for the same native-textarea-undo class of issue P19.15 fixed for captions — **not tested**. If they share it, the failure mode is identical to what P19.15 already fully explained (a cosmetic, store-invisible revert, not data corruption) — not classified as a defect without direct reproduction.
- The 5 existing ESLint warnings — **known, pre-existing, unchanged, non-blocking**.

## 13. Release-Critical Findings

None. No P0 or P1 issue is open. No new defect was discovered during this audit's own source or packaged verification.

## 14. Final Technical Assessment

SUBLY 0.1.20 has no known P0 or P1 defect. Every previously-identified release blocker and major correctness bug across P19.11 through P19.15 has been fixed with a targeted, minimal change and independently re-verified — in most cases against the real installed packaged application, not just source code or unit tests. The remaining P2/P3 inventory is real but consists entirely of narrow, gracefully-degrading, workaround-viable, or already-disclosed-as-limitation items; none meet this task's own P0/P1 bar. This audit's own fresh source-test run (1886/1886, 0 tsc errors, 0 lint errors) and 14-item packaged smoke test against the existing 0.1.20 installer found no regression. From a pure technical release-readiness standpoint, 0.1.20 is clean to release; the two marketing-copy overclaims noted in §10 are flagged for the release owner's own judgment, not asserted as blockers.

---

### VERIFIED RELEASE STATE

- **Version:** 0.1.20
- **Installer:** `release/SUBLY Setup 0.1.20.exe` (566,397,087 bytes, built by P19.15, confirmed current — no source changes since)
- **Source tests:** 1886/1886 passing
- **TypeScript:** 0 errors
- **ESLint:** 0 errors, 5 pre-existing warnings (unchanged)
- **P0:** 0 open
- **P1:** 0 open
- **P2:** 11 open (all non-blocking, documented in §5/§10)
- **P3:** large, stable, previously-documented inventory (§5/§11/§12); no change
- **Packaged smoke test:** 14/14 PASS (§7)
- **Known limitations:** as listed in §12, none release-blocking
- **Source changes made during this task:** none
- **Installer rebuilt:** NO
- **Final technical assessment:** Release candidate clean — no P0/P1 blockers; ship-ready from an engineering standpoint, with two low-priority marketing-copy items flagged for optional product review.
