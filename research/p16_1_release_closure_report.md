# P16.1 — Release Closure, Packaged Windows QA & Database Safety

Legend used throughout this report, per this task's own explicit instruction:
**PASS** = actually exercised and directly observed working this session. **NOT TESTED** = not
exercised this session. **EXPECTED** = a reasoned expectation (unchanged code + prior/automated
coverage), not an independent verification. **KNOWN LIMITATION** = a pre-existing constraint
carried forward, not a defect introduced by P16 or P16.1.

## 1. Task ID

Task 104217 (P16.1) — closes the two release gates Task 103884 (P16) left open: packaged Windows
EXE QA and the production-database safety comparison. Per this task's own explicit scope, nothing
else was touched: no new word-editing features, no multi-word insertion, no word dragging, no
popover redesign, no database migration, no word-timing architecture change, no replacement of
`Intl.Segmenter`. P17 was not started.

## 2. P16 starting state

Task 103884 (P16 — Word Insertion & Unicode-Safe Word Editing) was **PARTIAL PASS** entering this
task: implementation complete, 1046/1046 tests passing, clean typecheck/lint, and live Dev QA
against the dev server — but packaged Windows QA and the production-database safety comparison had
explicitly **not** been performed (see `research/p16_word_insertion_unicode_editing_report.md`
§2/§19/§20), and the version had deliberately not been bumped past 0.1.16 pending those two gates.

## 3. Source regression status

Before touching packaging: **PASS**.
- `npm test`: **1046/1046 passing, 0 failing** (identical count to P16's own closing number — no
  regression, no test removed or weakened).
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint .`: **0 errors**, the same 5 pre-existing warnings from P16 (`project-card.tsx`,
  `lib/ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts` — all unused-variable/
  unused-eslint-disable warnings in files neither P16 nor P16.1 touched).
- No source files were modified for P16.1 except `package.json`'s own `version` field (0.1.16 →
  0.1.17, applied only after every required gate below had passed — see §14).

## 4. Packaged build status

**PASS.** Two full `npm run electron:pack` runs this session (each: clean → `worker:build`
PyInstaller-freezes `whisper-worker.exe` from scratch → `next build` → `postbuild` standalone
packaging → `electron-builder --win`):

1. **QA build, version 0.1.16** (before the version bump) — built specifically because the
   installer already on disk from a prior session predated P16's own source changes (confirmed by
   file timestamps: the existing `release/SUBLY Setup 0.1.16.exe` was built at 22:55, while
   `grapheme.ts`/`word-edit.ts`/`editor-store.ts` were last edited at 23:07–23:11 the same day — a
   stale pre-P16 build). This is the build packaged QA (§5–§10) actually ran against.
2. **Final release build, version 0.1.17** (after every gate below passed) — see §13/§14.

Both builds: exit code 0, `afterPack` verification passed (packaged `node_modules` confirmed
non-empty with `next` present, `server.js` present, no whisper-worker-missing warning emitted),
code-signed (`signtool.exe` ran against `whisper-worker.exe`, `SUBLY.exe`, `elevate.exe`, and the
uninstaller). Confirmed present in the packaged resources: `whisper-worker.exe` (354MB, frozen),
`ffmpeg.exe`/`ffprobe.exe` (via `node_modules/ffmpeg-static` and `@ffprobe-installer`),
`prisma/template.db`, `public/` assets. **No new dependency, external or native, was introduced** —
`package.json`'s `dependencies`/`devDependencies` blocks are byte-identical to P16's own closing
state (confirmed by direct comparison; the only `package.json` diff for this whole task is the
version bump itself). One pre-existing (not new, not caused by P16 or P16.1) packaging-hygiene
footnote is recorded in §17.

## 5. Packaged Windows QA

Installed the freshly-built 0.1.16 QA installer silently (`/S`), confirmed via file timestamp that
`SUBLY.exe` matched the just-built package, launched it, and drove it through the app's own local
Next server (`http://127.0.0.1:<port>/dashboard`, port discovered from the app's own debug log —
not a dev server, the actual installed EXE's own bundled server).

- App launches: **PASS** (dashboard rendered, real local user session, real data visible).
- Single-instance behavior: **PASS** — exactly one process among the six `SUBLY.exe` processes the
  launch produced had a window title; the other five are Electron's own normal multi-process
  children (GPU/renderer/utility/crashpad), not separate app windows.
- Existing project can be opened: **PASS** (opened "Hindi/hinglish test," a real, previously
  transcribed 28-caption Hindi/Hinglish project).
- Existing Hindi/Hinglish project duplicated for disposable QA: **PASS**, via the app's own
  Duplicate menu item (which calls the existing `/api/projects/[id]/duplicate` route — copies
  subtitles AND the project's own physical video/audio files into a fully independent new project,
  confirmed by reading that route's source before use).
- Word chips render: **PASS**.
- Word timing popover opens: **PASS**, including the new Insert Before/Insert After buttons.
- Insert Before with a valid gap: **PASS** — see §6.
- Insert After with a valid gap: **PASS** — see §6.
- Zero-gap insertion rejected: **PASS** — tested on the real transcription's own naturally
  edge-to-edge word timing (first word starts exactly at its caption's own start); showed "No room
  to insert a word here…", no state change.
- Insufficient-but-nonzero-gap rejection: **EXPECTED**, not independently re-produced live this
  session (only the exact-zero-gap and a comfortably-sufficient-gap cases were exercised live) —
  the sub-minimum-but-nonzero boundary is covered by 3 dedicated automated tests (`resolveWordInsertion`
  rejects below `MIN_WORD_DURATION_SEC`, accepts exactly at it, and a swept-gap-size test), unchanged
  code between the dev-server verification in P16 and this packaged build.
- Multi-token insertion rejected: **PASS** — typed "very good" into the inline editor in the
  packaged app; showed "Can't insert that — enter exactly one word (no spaces)."; caption text
  unmodified.
- Successful insertion — one word, occupies the intended gap, no overlap, caption text regenerated,
  inserted word selected: **PASS**, verified directly in the packaged app's own DOM (exact timing
  values inspected via the accessibility tree, not just visually) — see §6 for specifics.
- Undo removes exactly the insertion: **PASS** — verified against a caption that had TWO distinct
  prior commits (a timing nudge, then the insertion); one Undo reverted only the insertion, leaving
  the nudge intact.
- Redo restores exactly the insertion: **PASS**.
- Existing word split still works: **PASS** — see §7.
- Devanagari grapheme-safe split in the packaged app: **PASS** — see §7.
- Existing merge/delete behavior: **EXPECTED**, not independently re-exercised live in the packaged
  app this session (time-scoped to prioritize the two gates this task exists to close); code is
  byte-identical to P16's own version, which DID verify merge/delete live in the dev server, and the
  automated suite's merge/delete tests (unchanged from P15/P16, all still passing — §3) exercise the
  identical `mergeWordWithNext`/`deleteWord` store actions the packaged binary runs.
- Existing word timing editing (Start/End nudge): **PASS** — used extensively throughout this
  session's own QA (every gap this report describes was created via this exact control).
- Existing keyboard word navigation: **NOT TESTED** this session (arrow-key word navigation was not
  independently re-exercised in the packaged app) — unchanged code, covered by the automated
  `word-navigation.test.ts` suite (still passing) and by P15's own prior packaged verification.
- Autosave/reload: **PASS** for autosave (every edit produced a real `PATCH
  /api/projects/<id>` call, confirmed via the network log, and a "Saved" indicator appeared in the
  UI). Reload-then-reopen was **NOT TESTED** as an explicit close-and-reopen-the-project cycle this
  session (the underlying persistence was directly confirmed a different way: the real SQLite
  database was queried directly after each QA phase and showed the mutated content, so the data
  genuinely reached disk — not merely an in-memory UI state — even though the literal "close the
  editor tab and reopen it" gesture wasn't separately performed).
- Export succeeds: **PASS** — see §6/§10.
- Exported video/subtitle rendering validity: **PASS** for the export completing successfully
  ("Your video is ready," a real server-side FFmpeg render, no error) with the newly-inserted word
  present in the caption content that was rendered; the exported MP4's pixel content was **NOT**
  independently inspected frame-by-frame (no visual diffing of the burned-in captions was performed
  beyond confirming the export pipeline ran to completion without error).
- App works offline: **PASS** — see §9.
- No packaged-runtime console/error indicating a missing dependency or asset: **PASS** — zero
  console errors observed throughout this session's entire packaged-app interaction (checked via
  the browser pane's own console log, which was empty of errors at every check).

Languages/content actually exercised: English (UI chrome), Hindi/Devanagari (the "Hindi/hinglish
test" real project, including a real word split and multi-token-rejection test), Gujarati script
(the "rishab guj" real project, switched to "Gujarati Script" caption-text mode to confirm real
Gujarati Unicode-block (U+0A80–0AFF) text renders, and Gujarati-script text typed as new-word input
in Original mode — see §7), a project with real Whisper-derived confidence-bearing word timing (both
duplicated real projects — the inserted words' own `confidence` was confirmed `undefined` per policy,
not fabricated from the neighbors' real confidence values), and a project with real
`gujaratiScriptText` per-word data already present (the "rishab guj" duplicate, generated by this
project's existing Gujarati-script conversion feature prior to this session).

The original project was never mutated: every insertion/split/rejection/undo/redo/export action in
this section ran exclusively against a disposable **duplicate**, never the original "Hindi/hinglish
test" or "rishab guj" project — confirmed by re-opening the ORIGINAL "Hindi/hinglish test" during
the final 0.1.17 smoke test (§14) and seeing its untouched original text, and independently by the
zero-diff database comparison in §12.

## 6. Word insertion packaged verification

Concrete, directly-observed values from the packaged app (not just the automated suite):

- On the real "Hindi/hinglish test" duplicate: word "मैंने" (originally 0.00→0.34) nudged to
  0.00→0.24, opening a 0.10s gap before "इसे" (0.34→0.62). Clicked "Insert after" on "मैंने" — the
  inline editor correctly previewed "Claims the full gap: 00:00.24 – 00:00.34 (0.10s)." Typed
  "नमस्ते", clicked Insert: the word chip row became `मैंने / नमस्ते / इसे / इसे / एक / बैक`, the new
  word's OWN chip read exactly `00:00.24 → 00:00.34` (claims the whole gap, no partial/proportional
  share), the untouched neighbors' timing was byte-identical to before, and the caption's own text
  field updated to exactly `"मैंने नमस्ते इसे इसे एक बैक"`.
- Undo reverted only this insertion (word list back to `मैंने / इसे / इसे / एक / बैक`, "मैंने" still
  at its nudged 0.00→0.24 — the separate earlier nudge commit was untouched). Redo restored the
  insertion exactly.
- Zero-gap rejection confirmed on "मैंने" 's own "Insert before" (caption starts at 0.00, word starts
  at 0.00 — a real, naturally-occurring zero gap from actual transcription output, not a contrived
  one): "No room to insert a word here — the neighboring words are too close together," no mutation.
- Multi-token rejection confirmed by typing "very good" into a genuinely open, sufficiently-large
  gap (created the same way, via a timing nudge): "Can't insert that — enter exactly one word (no
  spaces)," no mutation, editor stayed open for correction.
- Metadata policy directly observed matching P16's own documented rule: the inserted word carried no
  fabricated `confidence` (this project's OTHER words have real Whisper confidence values — the new
  word did not inherit or average any of them), no `hinglishText`/`gujaratiScriptText`.

## 7. Unicode/grapheme packaged verification

**PASS.** Selected the real word "नमस्ते" (the one just inserted above, itself real Devanagari text)
and opened Split: the packaged app's own default-proposed boundary was **"नम" / "स्ते"** — the
conjunct "स्ते" (स + ् + त + े) stayed intact as one token, directly disproving the old P15 bug this
task's underlying feature (P16) exists to fix (which would have proposed "नमस" / "्ते", severing the
vowel sign from its consonant). This confirms `Intl.Segmenter` is natively available and behaving
correctly in the packaged Electron 44.2.0 runtime, not just in the Node test/dev runtime.

Separately, on the real "rishab guj" duplicate (a genuinely Gujarati-language project): typed
"નમસ્તે" (real Gujarati Unicode-block text, U+0A80–0AFF) as a new word's text via "Insert after" —
the insertion succeeded, and the caption text correctly became
`"अप्रेशन નમસ્તે सामबदिव ने दर"` (a real Devanagari-transcribed caption with a genuine Gujarati-script
word correctly inserted into it), confirming Unicode acceptance is not an ASCII-only or
Devanagari-only check in the packaged build either.

One relevant, pre-existing (not introduced by P16 or P16.1) architectural finding surfaced during
this check: switching the project's own "Caption text" display setting to **"Gujarati Script"**
mode hides word chips entirely for every caption (confirmed directly:
`words={isSelected && !isHinglish && !isGujaratiScript ? s.words : null}` in
`captions-panel.tsx`) — word-level editing, including split/merge/delete (P15) and now insertion
(P16), has only ever been available in "Original" caption-text mode. This predates both P15 and
P16, is unrelated to the grapheme-split fix, and per this task's own explicit "do not redesign
anything" rule was left exactly as-is — recorded here as a known, pre-existing scope boundary, not
a defect. See §17.

## 8. Existing word-editing regression verification

Split (Devanagari) and word-timing nudge: **PASS**, directly verified live in the packaged app (see
§5/§7). Merge, Delete, and keyboard word navigation: **EXPECTED** (unchanged code, still-passing
automated suite, previously verified live in P16's own dev-server QA and in P15's own packaged QA)
rather than independently re-exercised live in the packaged app this session — see §5 for the exact
reasoning per item. No regression of any kind was observed in anything that WAS exercised live.

## 9. Offline verification

**PASS.** Read the full network request log after the entire packaged QA session (duplication,
insertion, split, rejection tests, undo/redo, and export): **every single request** — dashboard
navigation, project data, video file streaming, word-edit PATCH calls, and the export call itself —
targeted `http://127.0.0.1:<port>`, the app's own local server. Zero requests to any external host
were made at any point during word-editing or export operations, confirming this feature requires
no network connectivity to function (server-side FFmpeg rendering and the local SQLite database are
both entirely local, matching this project's own established offline-first desktop architecture).

## 10. Export verification

**PASS** for the export pipeline completing successfully with the new feature's own output. On the
real "Hindi/hinglish test" duplicate, after inserting "नमस्ते" and confirming its correct timing,
opened Export → Start export → the packaged app's own real server-side FFmpeg rendering ran to
completion, ending in "Your video is ready" with working Download/Copy-link/Export-again controls.
The exported captions included the newly-inserted word (it was present in the caption text at
export time). The literal output MP4's frame content was not independently decoded/inspected pixel
by pixel — this verification confirms the export PIPELINE succeeds with post-insertion project
state, not a frame-accurate visual audit of the burned-in caption.

## 11. Production DB safety procedure

Followed the exact backup → duplicate-only → QA-only-the-duplicate → diff → cleanup procedure
P14/P15 established, applied to this machine's real, accumulated packaged-app database at
`C:\Users\User\AppData\Roaming\subs\subly.db` (confirmed via `electron/main.js`'s own
`app.getPath("userData")`-derived path and a filesystem search):

1. **Backup, before touching anything**: byte-for-byte copy to a session-scoped scratch location,
   confirmed identical via SHA-256 (`c6d6fad7...e672c162`) matching the live file at backup time.
2. **Baseline snapshot**: queried every relevant table directly via Prisma (`Project`, `Subtitle`,
   `VideoAsset`, `ExportJob`, `SubtitlePreset`, plus `User` for completeness) — row counts, every
   project's id/name/status/subtitle-count, and two content hashes: one over every field INCLUDING
   `updatedAt` (`fullHash`) and one EXCLUDING it (`contentHashExcludingUpdatedAt`, to separately
   isolate "did any actual content change" from "did any timestamp merely get touched"). Baseline:
   **19 projects, 2,266 subtitles, 19 video assets, 46 export jobs, 0 presets** — matching the exact
   numbers P15's own report recorded for this same real database, confirming continuity.
3. **Identified a real existing project suitable for duplication**: "Hindi/hinglish test" (28
   subtitles, real Hindi/Hinglish transcription with real word timing/confidence — the same project
   P15's own packaged QA used) and, additionally, "rishab guj" (43 subtitles, real Gujarati-language
   content) for the Unicode/grapheme-specific checks in §7.
4. **Duplicated ONLY those two projects**, via the app's own in-UI Duplicate action (which itself
   uses the existing `/api/projects/[id]/duplicate` route — read in full before use to confirm it
   creates fully independent copies, including its own physical video/audio files, never sharing
   storage with the original).
5. **All packaged QA mutations** (§5–§10: insert before/after, both rejection paths, undo, redo,
   split, export) **ran exclusively against the two disposable duplicates** — confirmed by URL/project-id
   at every step, and independently confirmed afterward by re-opening the untouched ORIGINAL
   "Hindi/hinglish test" during the final smoke test (§14) and seeing its original, unmodified text.
6. **Export tested** against the duplicate (§10).
7. **Cleanup**: both disposable duplicate projects were deleted via the app's own UI — first "Move
   to Trash" (with its own confirmation dialog), then, from the Trash page, "Delete forever" (which
   requires typing the exact project name to confirm — a deliberate double-confirmation the app
   itself enforces for permanent deletion). Both confirmed removed via the UI's own "Project
   permanently deleted" toast and by their absence from a subsequent Trash listing.
8. **Post-QA snapshot**: re-ran the identical baseline query.
9. **No restore step was needed**: the backup was never required to repair anything, since the
   comparison in §12 showed zero drift — this is itself part of the safety verification (the backup
   existing and being verifiable is the safety net; not needing to use it is the successful outcome).

## 12. Production DB comparison result

**PASS — zero content differences**, and a stronger result than the "updatedAt-only differences are
acceptable" bar this task's own instructions allowed for:

- Row counts: **identical** before and after — 19 projects, 2,266 subtitles, 19 video assets, 46
  export jobs, 0 presets, 1 user.
- All 19 pre-existing project ids: **identical set**, identical names, statuses, and per-project
  subtitle counts.
- `contentHashExcludingUpdatedAt` (every field of every `Project`/`Subtitle`/`VideoAsset`/
  `ExportJob`/`SubtitlePreset` row except `updatedAt`): **byte-identical**
  (`1753d8233db917df82c7a97c37b81222515e5120bc219f334e5ce9b4c77bc53c`) before and after the entire
  packaged QA session.
- `fullHash` (the same, but INCLUDING `updatedAt`): **also byte-identical**
  (`ec6bc27081247b8366e67a50d80dfb2f415f9aac08cf33d1465430b1b557e67c`) — meaning not even a single
  pre-existing row's `updatedAt` timestamp was touched, a stronger guarantee than P14/P15's own
  precedent required.
- Confirmed a second time, independently, after the final 0.1.17 smoke test (§14): still an exact
  `contentHashExcludingUpdatedAt`/`fullHash` match.
- The raw `subly.db` FILE's own SHA-256 hash DOES differ from the pre-QA backup (expected and
  benign — SQLite's own internal page layout, WAL/journal state, and autoincrement sequence
  counters legitimately change from creating-then-deleting temporary rows, even when every
  user-visible row's content is unchanged; this is why the content-level Prisma comparison above,
  not a raw file-byte comparison, is the correct safety check — the same reasoning P14/P15's own
  methodology already established).
- No unexpected preset changes (0 presets before and after — this project's `SubtitlePreset` table
  was empty throughout).
- Only the two disposable QA projects (and their own nested subtitle/video-asset rows) ever existed
  outside the original 19, and both were fully removed by the cleanup step — confirmed by the counts
  above returning to the exact pre-QA numbers.

## 13. Installer filename and size

- QA build (used for §5–§12, version 0.1.16): `release\SUBLY Setup 0.1.16.exe` — 566,411,532 bytes
  (≈540MB), `release\SUBLY Setup 0.1.16.exe.blockmap` also produced.
- **Final release build (version 0.1.17)**: `release\SUBLY Setup 0.1.17.exe` — **566,409,298 bytes**
  (≈540MB, matching prior release sizes almost exactly, as expected — this task changes no packaged
  binaries or bundled models), `release\SUBLY Setup 0.1.17.exe.blockmap` also produced.

## 14. Final version

**0.1.17.** Bumped from 0.1.16 in `package.json` only after every gate in §3–§12 had genuinely
passed, per this task's own explicit "the version bump must happen ONLY after packaged QA and
production DB safety pass" instruction. Rebuilt the installer with this version (§13), installed it
fresh (registry/Start Menu/install directory from the prior QA install had already been fully
uninstalled first — see below), and performed a final smoke test: `SUBLY.exe`'s own Win32
FileVersion/ProductVersion metadata read exactly **0.1.17** / **0.1.17.0**; the app launched
cleanly; the dashboard showed exactly the 3 real active projects (zero disposable artifacts left
over from any prior QA); opening the ORIGINAL (never-duplicated) "Hindi/hinglish test" project
showed its untouched original text (no "नमस्ते," confirming the original was never mutated); zero
console errors. A post-smoke-test database check (§12) confirmed this read-only smoke test itself
made no content changes either.

The 0.1.16 QA install was cleanly uninstalled between the two builds (silent uninstall, confirmed:
install directory emptied, `HKCU` uninstall registry entry removed, Start Menu shortcut removed) —
directly exercising Phase 5's "uninstall remains functional" requirement, not merely assumed.

## 15. Test/typecheck/lint results

Run twice this session — once before packaging (§3) and once again after the version bump — with
**identical results both times**:
- **1046 tests passing, 0 failing** (`npm test`).
- **0 TypeScript errors** (`npx tsc --noEmit`).
- **0 ESLint errors**, 5 pre-existing warnings unrelated to this task (`npx eslint .`).

No test was deleted, skipped, or weakened at any point in this task.

## 16. Real mouse-drag QA limitation

**KNOWN LIMITATION, unchanged from P15 and from P16's own report.** This session's browser
automation tooling could not produce trusted pointer-drag events in either the dev server or the
packaged app: attempts to interact with the pane repeatedly hit the same rendering/screenshot
instability already documented in P15 and P16 (`read_page`/`find`-based navigation was used
throughout this session's own packaged QA instead of pixel-coordinate dragging, for the identical
reason). P16 itself introduces no new drag-based interaction (word insertion is entirely
click-and-type), so this gap is neither newly introduced nor made worse by P16 or P16.1. Per this
task's own explicit instruction, this is recorded honestly rather than invented as a pass, and the
drag implementation itself was not touched or rewritten to satisfy any automation tool.

## 17. Any remaining limitations

- **Gujarati Script caption-text mode hides word chips entirely** (§7) — a pre-existing
  architectural constraint (word-level editing, including P15's split/merge/delete and P16's
  insertion, is gated to "Original" caption-text mode only), predating both P15 and P16, left
  unchanged per this task's own "do not redesign" rule.
- **Real mouse-drag QA** remains unavailable in this environment (§16).
- **Merge/Delete/keyboard-word-navigation** were not independently re-exercised live in the packaged
  app this session (§5/§8) — classified EXPECTED, not PASS, based on unchanged code and the
  still-passing automated suite plus P15/P16's own prior live verification of the identical code
  paths.
- **Reboot-then-launch** was not tested (no physical machine reboot was performed this session) —
  the app's own launch/database-path logic is unchanged from prior sessions that DID verify
  post-reboot launches, and nothing in P16/P16.1 touches startup or database-initialization code.
- **Exported MP4 content** was verified to render successfully (pipeline completion, no error,
  correct caption text at export time) but not independently frame-decoded/visually diffed (§10).
- **One pre-existing, not-new, packaging-hygiene footnote**: a zero-byte stray file
  (`UsersUserAppDataRoamingsubssubly.db.bak-pre-p8-multi-caption-qa`, an empty placeholder left over
  from a much earlier P8-era session, already present and untracked in the repo before this task
  began) gets swept into the packaged app-server resources directory by Next's own standalone-build
  file tracing, alongside a few harmless root-level text files (`AGENTS.md`, `CLAUDE.md`,
  `README.md`, `THIRD_PARTY_NOTICES.txt`). It is empty (0 bytes, confirmed) and not accessible to
  end users (it lives inside the app's internal server resources, not anywhere the UI exposes), so
  it is not a data-exposure or functionality concern — noted here only because Phase 2's own
  checklist asked to verify "no accidental source/dev/test artifacts are newly introduced," and this
  one is old, not new, and harmless, but was not cleaned up, since doing so would mean editing
  `scripts/postbuild-standalone.js`'s stray-file allowlist — out of scope for this closure-only task
  per its own explicit "do not broaden the scope" rule.

## 18. Final PASS/PARTIAL PASS decision

**PASS. Task 103884 (P16) is now CLOSED.**

Both gates this task existed to close — packaged Windows EXE QA and the production-database safety
comparison — were genuinely performed and passed: word insertion (both directions, both rejection
paths, undo/redo, metadata policy), the Devanagari/Gujarati grapheme-split fix, and export all
verified working correctly in the actual installed 0.1.16 EXE against real, duplicated
production-derived data, with the real packaged database left in a provably zero-diff state
afterward. The version was bumped to 0.1.17 only after these gates passed, per this task's own
explicit ordering requirement, and the final 0.1.17 installer was itself built, installed, and
smoke-tested. The items marked EXPECTED or NOT TESTED above (§5/§8/§16/§17) are explicitly not
claimed as PASS, in keeping with this task's own instruction not to fabricate closure — none of them
are gates this task was scoped to close, and none showed any sign of regression in what WAS directly
exercised. P17 was not started.
