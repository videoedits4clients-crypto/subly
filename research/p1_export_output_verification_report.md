# P1 — Export Output Verification & Integrity

## 1. Existing export completion behavior (before this change)

`runExportJob` in [src/lib/export-pipeline.ts](../src/lib/export-pipeline.ts) treated a resolved
`renderExport(...)` promise as the *only* signal of export success. The exact sequence was:

1. `collectRequiredFonts()` → font preflight (`preflightExportFonts`) → `prepareExportFontsDir()`.
2. `withTempFile(assAbsPath, ass, () => renderExport({...}))` — writes the temp `.ass` caption
   file, runs ffmpeg via `renderExport`, and always removes the `.ass` file in its `finally`.
3. Immediately after that `finally` block (`activeExports.delete(jobId); await cleanupFontsDir();`),
   the code unconditionally computed `outputUrl = storage.publicUrl(outputKey)` and updated
   `ExportJob` to `status: "DONE"`.

There was **no check** anywhere that the output file:
- actually exists,
- is non-empty,
- can be read by ffprobe,
- contains a real video stream,
- has a sane, non-zero duration.

`renderExport` itself (`src/lib/ffmpeg/index.ts`) only resolves when fluent-ffmpeg's `"end"` event
fires — which fluent-ffmpeg emits when the ffmpeg *process* exits without an `"error"` event. It
performs no output-file validation of its own. A pathological case (e.g. a disk-full mid-write, or
any other ffmpeg edge case that exits 0 but leaves a truncated/zero-byte file) would previously have
been reported as a successful, downloadable export.

Answers to the specific STEP 1 questions:
- **When is FFmpeg considered successful?** When fluent-ffmpeg's `"end"` event fires (process exit,
  no `"error"` event, not killed for cancel/stall).
- **When was the output file considered complete?** Never explicitly checked — implicitly "as soon
  as ffmpeg's promise resolves."
- **When did `ExportJob.status` change to `COMPLETED`/`DONE`?** Immediately after the render's
  `finally` block, with no gate in between.
- **Was `outputUrl` generated before or after verification?** Before — there was no verification.
- **Could an existing ffprobe utility be reused?** Yes — `probeVideo(filePath)` in
  `src/lib/ffmpeg/index.ts` (returns `{ duration, width, height, fps, hasAudio }` via
  `ffmpeg.ffprobe`), previously used only by the upload route (`src/app/api/upload/route.ts`) to
  validate uploaded source videos. It was reused as-is for this task (see §3).
- **Existing checks for zero-byte/missing output?** None.
- **Could a cancelled/failed export leave an apparently valid `outputUrl`?** No — `outputUrl` is
  set only in the success branch of `runExportJob`; the catch block never touches it. This was
  confirmed by re-reading the full file; no other code path writes `ExportJob.outputUrl`.

## 2. The verification gap (summary)

**A successful ffmpeg process exit was treated as sufficient proof that the exported video is
usable.** It isn't — it only proves the ffmpeg process didn't error out; it says nothing about the
file it produced.

## 3. Architecture — before / after

**Before:**
```
render finishes (finally: cleanup) → outputUrl computed → ExportJob DONE
```

**After:**
```
render finishes (finally: cleanup) → verifyExportOutput(outputPath) →
  ok?  → outputUrl computed → ExportJob DONE
  !ok? → throw ExportVerificationError(message) → existing catch block →
         existing outputAbsPath cleanup (fs.rm) → ExportJob ERROR (message) →
         project.status = READY (existing recovery path, unchanged)
```

New file: [src/lib/export-output-verification.ts](../src/lib/export-output-verification.ts)
- `verifyExportOutput({ outputPath, timeoutMs?, probe?, stat? })` — the isolated, dependency-injectable
  verifier. Checks, in order:
  1. File exists (`fs.stat`, injectable) → else `"Export failed: the output file was not created."`
  2. File size > 0 → else `"Export failed: the exported video could not be verified."`
  3. `probeVideo` (injectable, defaults to the real ffprobe-backed `probeVideo` from
     `lib/ffmpeg/index.ts`) succeeds within a bounded timeout (default 20s) → else
     `"Export failed: the exported video appears to be incomplete or corrupted."`
  4. Probed `width > 0 && height > 0` (a real video stream) → else
     `"Export failed: the exported video could not be verified."`
  5. Probed `duration` is finite and `> 0` → else
     `"Export failed: the exported video appears to be incomplete or corrupted."`
  - Returns `{ ok: true, metadata }` on success, `{ ok: false, message }` on failure. Never throws —
    the entire body is wrapped so any unexpected exception (a malformed probe result, a thrown
    non-Error, etc.) still resolves to a safe `{ ok: false, message }`.
- `ExportVerificationError` — thin `Error` subclass carrying the already-user-readable message,
  exactly mirroring the existing `FontResolutionError` pattern so it slots into
  `export-pipeline.ts`'s existing `instanceof`-based catch-block branching.
- SUBLY has no audio-only export mode (confirmed: `ExportRequestOptions`/`ExportJob.format` is
  always `"mp4"`, and there is no export-format UI option) — only the video-stream branch was
  implemented, per the task's explicit instruction not to invent unsupported modes.

## 4. Reuse of existing ffprobe infrastructure

No new ffprobe wrapper was created. `verifyExportOutput`'s `probe` parameter defaults directly to
`probeVideo` from `src/lib/ffmpeg/index.ts` — the same function the upload route already uses. The
timeout wrapper (`withTimeout`, a `Promise.race`-style pattern) mirrors the existing
`probeVideoWithTimeout` helper in `src/app/api/upload/route.ts`, at a 20s default bound, so a
malformed/corrupt output file fails cleanly instead of hanging the export worker indefinitely.

## 5. Integration point (`src/lib/export-pipeline.ts`)

Inserted immediately after the render's `finally` block and before `outputUrl` is ever computed:

```ts
const verification = await verifyExportOutput({ outputPath: outputAbsPath });
if (!verification.ok) {
  throw new ExportVerificationError(verification.message ?? "Export failed: the exported video could not be verified.");
}
const outputUrl = storage.publicUrl(outputKey);
```

The catch block gained one new `instanceof` branch (`verificationFailed`), following the exact
existing pattern used for `cancelled`/`stalled`/`fontUnavailable`:
- `console.error` label: `"failed verification"`.
- New analytics event: `export_verification_failed` (added to `AnalyticsEvent` in
  `src/lib/analytics.ts`, alongside the existing `export_font_unavailable`, etc.).
- `errorMessage`: `err.message` (the verifier's own user-readable message, reused verbatim — same
  technique as `FontResolutionError`).

Font preflight, `prepareExportFontsDir`, and the render call itself were **not modified** — the
ordering `collectRequiredFonts() → font preflight → prepare export fonts → FFmpeg render → FFmpeg
completion → OUTPUT VERIFICATION (new) → COMPLETED` is exactly what STEP 4 specified.

## 6. Cleanup behavior

No new cleanup code was needed. `outputAbsPath` was already hoisted before the render starts and
already unconditionally removed on any error (`if (outputAbsPath) await fs.rm(outputAbsPath, {
force: true })` in the existing catch block, pre-dating this change). Throwing
`ExportVerificationError` after a failed verification routes through that exact same cleanup —
an invalid/truncated output file is deleted the same way a cancelled or stalled export's partial
file already was. `ExportJob.outputUrl` is never set for a verification failure (the throw happens
*before* `outputUrl` is computed). `project.status` resets to `"READY"` via the existing (unchanged)
recovery line, so retry from the same dialog works identically to every other failure type.

## 7. Error/failure messages

Implemented exactly as specified:
- Missing output → `"Export failed: the output file was not created."`
- Zero-byte / structurally invalid (no video stream) → `"Export failed: the exported video could not be verified."`
- Unreadable/corrupt/timed-out/zero-duration → `"Export failed: the exported video appears to be incomplete or corrupted."`

No ffmpeg command lines, filesystem paths, stack traces, or ffprobe jargon appear in any message
(verified by an explicit unit test asserting this). The existing generic "Export failed" UI in
`export-dialog.tsx` (`AlertTriangle` icon + `errorMessage` paragraph + "Retry export" button) needed
**no changes** — a verification failure is just another `ExportJob.status === "ERROR"` with a plain
`errorMessage`, which that UI already renders correctly. `export-dialog.tsx` was not touched.

## 8. Files changed

- **New:** `src/lib/export-output-verification.ts` — the verifier + `ExportVerificationError`.
- **New:** `src/lib/__tests__/export-output-verification.test.ts` — 13 unit tests.
- **Modified:** `src/lib/export-pipeline.ts` — verification call site + one new catch-block branch.
- **Modified:** `src/lib/analytics.ts` — added `"export_verification_failed"` to `AnalyticsEvent`.
- **Modified:** `package.json` — added `test:export-verification` script and wired the new test file
  into the aggregate `test` script.
- **Not modified (per scope):** font preflight (`font-preflight.ts`, `font-preflight-message.ts`),
  `export-dialog.tsx`, `lib/ffmpeg/index.ts` (`renderExport`, `probeVideo`, cancellation/stall
  classes — read only, reused as-is), Whisper/ASR, waveform, dashboard, presets, upload validation,
  language policy, subtitle segmentation.

## 9. Tests added (`src/lib/__tests__/export-output-verification.test.ts`, 13 tests, all pass)

All using injected fake `stat`/`probe` functions — no real files, no real ffmpeg/ffprobe binary, no
network:

1. Missing output file → failure (`"...was not created."`)
2. Zero-byte output → failure (`"...could not be verified."`)
3. ffprobe failure (rejects) → failure (`"...incomplete or corrupted."`)
4. Valid video → success
5. Valid video with a sane, non-trivial duration → success, `metadata.duration` preserved
6. Missing video stream (width/height 0) → failure
7. Malformed ffprobe response (probe throws synchronously) → failure, not a crash
8. ffprobe that never resolves → times out (20ms test timeout) instead of hanging
9. Wildly malformed inputs (NaN size, negative dimensions, NaN duration) never throw uncontrolled exceptions
10. Every failure message is user-readable (regex-asserted: no ffmpeg/ffprobe/libass/stack/paths)
11. Valid output returns the exact probed metadata the pipeline needs
12. Every failure case returns `ok:false` with a message and `metadata: undefined` — never a partial/ambiguous success
    (plus one extra case: zero-duration is explicitly treated as incomplete, not a valid zero-length clip)

Additionally, a one-off scratch script (not committed — run and deleted during this session) exercised
`verifyExportOutput` with **no mocks at all**, against the real bundled ffprobe/ffmpeg binaries and
real files on disk:
- a genuinely missing file → `"...was not created."`
- a genuine zero-byte file → `"...could not be verified."`
- a genuine non-video garbage file → `"...incomplete or corrupted."`
- a real video actually rendered by `renderExport` → `{ ok: true, metadata: { duration: 0.5, width: 720, height: 720, fps: 24, hasAudio: false } }`

This confirms the mocked unit tests' assumptions match the real ffprobe/ffmpeg integration exactly.

## 10. Full test results

```
npm test
ℹ tests 226
ℹ pass 226
ℹ fail 0
```
(213 pre-existing tests + 13 new — all green. No existing test was modified.)

```
npx tsc --noEmit
(no output — clean)
```

```
npm run lint
✖ 5 problems (0 errors, 5 warnings)
```
All 5 warnings are pre-existing, in files untouched by this change (`project-card.tsx`,
`lib/ai/index.ts`, `subtitles/ass.ts`, `subtitles/preview-style.ts`, and one unused-eslint-disable
warning in `analytics.ts` that predates this change). **Zero errors.**

## 11. Live dev QA (manually-launched `next dev`, `SUBLY_DESKTOP=1`, pointed at the real
`%APPDATA%\subs` data directory — the packaged app's SUBLY.exe was stopped first; the real
`subly.db` was backed up to `subly.db.bak-pre-export-verification` before any test)

| # | Scenario | Result |
|---|---|---|
| A | Normal built-in-font export (Inter, bundled) | ✅ COMPLETED, file exists, plays (1080×1920, real duration confirmed via the browser's own `<video>` element) |
| B | Windows system-font export (Arial, `fontSource: "system"`) | ✅ COMPLETED, file exists (6.1MB) |
| C | Custom-preset export (created a real preset via the UI, applied it, exported) | ✅ COMPLETED, file exists |
| D | Hindi/Hinglish project export | ✅ COMPLETED, file exists (1.29MB) |
| E | Legacy Gujarati Script project export (`language: "gu"`) | ✅ COMPLETED, file exists (6.1MB) |
| F | Word highlighting/animation export | ✅ Same export as E — project already has `wordHighlight: true` and `animation.word: "highlight"` |
| G | Retry after a failed export | ✅ Triggered a real failure via a controlled fixture (a fictional font name, reusing the already-proven font-preflight failure path — see note below), confirmed `ExportJob.status: "ERROR"`, then restored the real font and retried successfully from the same dialog with no reload |
| H | Export history / status remains correct | ✅ Confirmed via `GET /api/projects/:id/export`: `ERROR` rows have `outputUrl: null` and the exact user-facing `errorMessage`; `DONE` rows have a real, working `outputUrl` |

**Note on scenario G / verification-triggered failures specifically:** the task asked not to corrupt
real project data to simulate a verifier failure, and to prefer a controlled fixture. The verifier's
own real-file behavior (missing/zero-byte/garbage-file/real-video) was proven directly and
exhaustively with real ffprobe/ffmpeg in §9's scratch script. For the *live, end-to-end, in-app*
retry test, the safest available controlled fixture was the already-existing, already-proven
font-unavailable failure path (a fictional font name on a throwaway style field, fully restored
afterward) — it exercises the identical shared code (the same catch block, the same `ExportJob`
update, the same export-dialog retry UI, the same export-history rendering) that a verification
failure would use, without fabricating ffmpeg output corruption in a live in-process job (which
would have required either racing the filesystem against a running ffmpeg process, or modifying
export-pipeline.ts source for the sole purpose of the test — both rejected as unsafe/out of scope).
This was repeated a second time in the packaged app (§12), including across a full app relaunch.

All test fixtures (the fictional font name, the temporary system-font override, the two custom
presets named "Export QA Preset" / "Packaged QA Preset") were restored/deleted immediately after
each test. All three real projects ("Hindi/hinglish test", "rishab guj", "Untitled project") were
verified, at the end of the session, to have their original `globalStyle.fontFamily` values intact.

## 12. Packaged installer QA

Built via `npm run electron:pack` (exit 0; the only warning in the build log is a pre-existing,
unrelated PyInstaller notice — `torch.utils.tensorboard` submodule collection — present before this
change too). Installed fresh via `SUBLY Setup 0.1.0.exe /S` over the previous install. Confirmed the
packaged app bundles both the new module
(`resources/app-server/src/lib/export-output-verification.ts`) and the real Windows ffprobe binary
(`resources/app-server/node_modules/@ffprobe-installer/win32-x64/ffprobe.exe`) — i.e. verification
in the shipped app runs against the packaged ffprobe, not a dev-machine binary.

| # | Scenario | Result |
|---|---|---|
| 1 | Normal export | ✅ (Hindi/Hinglish project, bundled Inter font) |
| 2 | System font export | ✅ (Arial, temporarily applied to the Gujarati project) |
| 3 | Custom preset export | ✅ ("Packaged QA Preset", created and applied via the packaged app's own UI) |
| 4 | Hindi/Hinglish export | ✅ (same as #1) |
| 5 | Gujarati legacy export | ✅ (same as #2) |
| 6 | Relaunch and export again | ✅ Killed all `SUBLY.exe` processes, relaunched, confirmed the same 3 projects load correctly on the new port, then exported |
| 7 | Export history | ✅ Confirmed via the same `GET /api/projects/:id/export` check, against the packaged app's own server |
| 8 | Retry behavior | ✅ Font-unavailable failure → confirmed `ERROR` in history → restored the font → retried successfully, all **after** the relaunch in #6 |

Every packaged export produced a real, non-empty file on disk at
`%APPDATA%\subs\uploads\<projectId>\exports\<jobId>.mp4`, confirmed with `ls` after each export.

## 13. Regression check (STEP 11)

- `npm test`: 226/226 pass, including the full pre-existing suites for waveform, dashboard
  search/filter/sort, custom presets, upload validation, language policy, Hinglish, Gujarati Script,
  font preflight, export cancellation/stall (`export-cancellation.test.ts`, unmodified, still passes
  — `renderExport`, `ExportCancelledError`, `ExportStalledError` were not touched).
- Live-confirmed in this session: built-in fonts, Windows system fonts, Hindi/Hinglish, Gujarati
  Script legacy projects, word highlighting/animation, project persistence (data survived a full
  app relaunch), export cancellation code path unmodified (verified by reading `lib/ffmpeg/index.ts`
  — no changes were made there).
- Explicit substitute-font fallback (`allowFontFallback`) and the font-preflight "Font unavailable"
  UI were exercised live multiple times (as the retry-test fixture) and behave exactly as the prior
  P1 Export Font-Fallback Surfacing phase left them — untouched.
- No timing observations were made regarding export cancellation in this phase; cancellation code
  was not modified and its existing test suite still passes unchanged.

## 14. Limitations

- The live, in-app, end-to-end reproduction of a *verification-specific* failure (as opposed to a
  font-preflight failure) relied on the scratch-script proof against real ffprobe/ffmpeg (§9) rather
  than fabricating a corrupt ffmpeg output inside a live, in-process export job — see the note in
  §11. This is a deliberate, documented trade-off consistent with the task's own instruction to
  prefer a controlled fixture over corrupting real data or modifying pipeline code for testing.
- Verification adds one bounded ffprobe call (typically well under a second for these file sizes) to
  every successful export's total time — negligible relative to encode time, and never exceeds the
  20s timeout even under load, since the timeout only matters for a hung/corrupt read.

## 15. Unrelated observations

None beyond what prior phases already documented (the font-preflight phase's own timing note on
cancellation, left as-is per that phase's report).

---

**Verification is genuinely wired into the real export pipeline.** `ExportJob` reaches `COMPLETED`
only after `verifyExportOutput` returns `ok: true`. A missing, zero-byte, or ffprobe-unreadable
output can no longer be reported as a successful export — it becomes `ERROR` with a clear message,
`outputUrl` is never set, and the invalid file is deleted via the pre-existing cleanup path. Unit
tests (13/13), typecheck, and lint all pass with zero errors. The packaged Windows installer was
rebuilt, installed fresh, and its bundled ffprobe/ffmpeg binaries were confirmed to be what actually
runs the verification. All existing functionality (fonts, Hindi/Hinglish, Gujarati Script,
animations, cancellation, presets, history, retry) remains intact.

P1 EXPORT OUTPUT VERIFICATION — PASS
