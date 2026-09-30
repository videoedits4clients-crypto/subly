# P2 — Professional Export & Delivery Workflow (Task ID 91463)

## 1. Executive summary

The export pipeline — export dialog, export settings, FFmpeg invocation, ASS generation, font
preparation, output verification, job state, history, retry, cancellation, crash recovery — was
already extensively hardened by prior P1/P2 phases: font preflight blocks a silent substitution,
output verification is a real gate between "ffmpeg exited" and "safe to hand to the user", stale
job recovery correctly cleans up after a crash mid-export, and cancellation is cooperative and
safe. This phase's audit traced the complete flow from the export dialog's UI down to the exact
bytes FFmpeg writes, verified every claim in that chain against the real, running system (not
assumed from file/function names), and found five confirmed gaps — one of them a genuine
correctness bug in the actual rendered video, not just a UX rough edge.

**The most significant finding**: exported video at several composition dimensions — including a
perfectly square 1080×1080 canvas, which is structurally incapable of being anything but 1:1 —
carried a slightly-off sample aspect ratio (`1216:1215` instead of exactly `1:1`) in its container
metadata. Confirmed via direct `ffprobe` on real rendered output, not assumed. The actual pixel
data was never stretched or distorted (`width`/`height`/`coded_width`/`coded_height` all matched
the request exactly), but the aspect-ratio *metadata* a player reads was measurably wrong — a
real, if narrowly-scoped, violation of Phase 4's explicit "aspect ratio does not unexpectedly
stretch the video" requirement. Fixed with a one-line, standard `setsar=1` addition to the FFmpeg
filter chain, confirmed by both a new deterministic unit test and a second real-ffmpeg render
after the fix.

Four further confirmed workflow gaps were fixed: a downloaded exported video had no meaningful
filename (the browser fell back to the raw output URL's opaque job-id basename, e.g.
`cm1a2b3c4d5e.mp4`, while the SRT/VTT/TXT sidecar downloads already correctly used the project's
own name); a failed or cancelled export didn't refresh the in-dialog "Export history" list
(so "what did I export?" could show stale data until the dialog was closed and reopened); a
cancelled export was indistinguishable from a genuinely failed one in that history list (both just
showed the literal string "error"); and a stale, actively-misleading Prisma schema comment
described aspect-ratio behavior that hadn't been true since an earlier refactor. Everything else
audited — export settings actually reaching FFmpeg, the composition/aspect-ratio pipeline,
subtitle sidecar correctness, filename uniqueness, export-history completeness, retry,
cancellation, crash recovery, output verification, styling/animation export fidelity, and
quality-readiness integration — was confirmed correct through direct testing (not assumed) and
is documented below as verified, not modified.

## 2. Existing export architecture

Traced end-to-end, file by file, with the exact data path each stage hands to the next:

- **`components/editor/export-dialog.tsx`** — the UI: resolution/FPS/quality selects, a read-only
  composition display (canvas dimensions are set in the editor's Settings tab, not per-export —
  see §4), video-layer toggle, background color, subtitle-sidecar download links, export history,
  progress/cancel UI, and the success/failure panels. Polls `GET /api/projects/[id]/export/[jobId]`
  every 1.5s while a job is in flight.
- **`app/api/projects/[id]/export/route.ts`** (`POST`) — validates the request (zod schema),
  rate-limits (8 exports / 10 min), creates an `ExportJob` row (`status: QUEUED`), flips
  `Project.status` to `EXPORTING`, and fires `runExportJob` in-process, fire-and-forget (the same
  "runs in-process, no queue/worker-pool" architecture `pipeline.ts` uses for transcription).
  `GET` on the same route lists the last 10 jobs for the project (export history).
- **`lib/export-pipeline.ts`**'s `runExportJob` — the actual orchestration: loads the project,
  remaps subtitles onto the edited (trim/cut-collapsed) timeline, applies the active caption output
  mode (Original/Hinglish/Gujarati-script — the SAME function the live preview and SRT/VTT/TXT
  routes use), builds the ASS document, collects every font the export actually needs, runs the
  font preflight (blocks on a genuinely unresolvable font unless the user explicitly opted into a
  substitute), stages font files into a temp directory, renders via FFmpeg, verifies the real
  output file, and updates job/project state — with a `finally`-guaranteed cleanup of the
  temporary `.ass` file and, on ANY failure, the partial output.
- **`lib/subtitles/ass.ts`**'s `buildAssDocument`/`collectRequiredFonts` — converts the project's
  style/animation model into an ASS document, one deduplicated `[V4+ Styles]` line per distinct
  resolved caption style, word-level override tags inline.
- **`lib/fonts/font-preflight.ts`** + **`lib/fonts/system-font-export.ts`** — the font-preflight
  gate (already built and tested in P1) and the actual font-file staging for FFmpeg's `fontsdir`.
- **`lib/ffmpeg/index.ts`**'s `computeExportDimensions`/`planExportRender`/`renderExport` — the
  ONE source of truth for output pixel size (§4), the actual FFmpeg filter-chain construction, and
  the process-spawn/cancel/stall-detection logic.
- **`lib/export-output-verification.ts`**'s `verifyExportOutput` — the gate between "FFmpeg exited
  without error" and "safe to call this export DONE": file exists, non-empty, ffprobe-readable
  within a bounded timeout, real video stream, sane duration. Never throws.
- **`lib/export-output-key.ts`** — the filename convention (`{projectId}/exports/{jobId}.mp4`),
  shared by the pipeline and stale-job recovery so the two can never drift.
- **`lib/recovery/stale-job-recovery.ts`** — runs once, synchronously, before the server accepts
  its first request (via `instrumentation-node.ts`'s top-level await), cleaning up any
  `QUEUED`/`RUNNING` export job and `EXPORTING` project left behind by a process that died mid-job.
- **`app/api/projects/[id]/subtitles/route.ts`** — the SRT/VTT/TXT sidecar download route, wholly
  independent of the `ExportJob` system (generated fresh from the database on every request, not
  tied to any burned-in export).
- **`app/api/files/[...key]/route.ts`** — the one file-serving route behind every `outputUrl`,
  every subtitle download, and video playback; range-request aware (needed for `<video>` seeking).

Every UI control in the export dialog was traced to confirm it actually changes what FFmpeg
receives — see §3 for the full settings-by-settings audit.

## 3. Export settings audit

| Setting | UI says | Project/job stores | FFmpeg actually receives | Verified |
|---|---|---|---|---|
| Resolution (720p/1080p/4K) | Dropdown, 3 tiers | `ExportJob.resolution` | `computeExportDimensions` scales the canvas by the tier's shorter-edge target, feeding `-vf scale=W:H...` | ✅ real-render tests, §11 |
| FPS (24/30/60) | Dropdown | `ExportJob.fps` | `.fps(opts.fps)` directly | ✅ real-render test confirms encoded output's own frame rate |
| Quality (low/medium/high/maximum) | Dropdown | `ExportJob.quality` | Mapped to a CRF value (`30/24/19/15`) via `QUALITY_CRF` | ✅ confirmed by code read; CRF is a real libx264 quality control |
| Codec | Not exposed (by design) | n/a | Always `libx264` | Correct — no reason to expose this |
| Container | Not exposed (by design) | `ExportJob.format` (always "mp4", never read) | Always `.mp4` | Correct — SUBLY only ever produces one deliverable format |
| Bitrate/CRF | Not exposed directly — "Quality" IS the CRF control | see Quality above | see Quality above | Correct — CRF is the standard "quality" knob for x264; a raw bitrate control would be redundant |
| Subtitle burn-in | Always on (by design — "Captions are burned directly into the video" per the dialog's own copy) | n/a | `subtitles=` filter, always present | Correct — this is SUBLY's one video-export mode |
| Audio | Not exposed (by design) | n/a | `aac`/192k when video is visible; no audio stream when video is off (a solid-color canvas has no audio source) | Correct |
| Output format | Not exposed (by design) | `ExportJob.format` (vestigial) | Always mp4 | Correct — see below |
| Destination | Not exposed as a picker — fixed to the project's own storage | n/a | `{projectId}/exports/{jobId}.mp4`, always | Correct, and this is exactly what prevents the filename-collision class of bug (§6) |
| Filename | Read-only, no control | n/a | Job-id-based on disk; **was** the same opaque id on download, **now** the project name (fixed, §6) | Fixed this phase |

**Confirmed dead/vestigial settings, not a UI mismatch**: `ExportJob.aspectRatio` and
`ExportJob.format` are real Prisma columns that are never read by any part of the render pipeline
(confirmed by grep — zero occurrences of `job.aspectRatio` or `job.format` anywhere in
`lib/export-pipeline.ts` or `lib/ffmpeg/index.ts`) and are never set by the export-creation route's
zod schema either (they simply take their schema default on every insert). This is **not** a "UI
says X, FFmpeg does Y" mismatch — no UI control ever claims to set either field, so there is
nothing for a user to be misled by. Documented in §19 as a confirmed-but-harmless finding rather
than a schema migration (no user-visible effect, and the task's own "do not add DB fields unless
absolutely necessary" instruction cuts the other way for removing them too, absent a real need).

**Composition (canvasWidth/canvasHeight)** is the actual, confirmed source of truth for output
aspect ratio in BOTH the video-on and video-off render paths (§4) — this was already correctly
implemented before this phase; the only issue found in this whole area was the SAR bug (§4, §6, a
render-fidelity bug, not a settings-propagation bug — the REQUESTED dimensions always reached
FFmpeg and always appeared correctly in the output's pixel data; only a metadata tag was off).

## 4. Composition/aspect-ratio audit

Traced `PROJECT COMPOSITION → VIDEO CANVAS → SUBTITLE POSITION → EXPORT RESOLUTION → FFMPEG OUTPUT`
exactly as the task's own diagram describes:

- **Composition is the one source of truth**, confirmed unchanged from a prior phase's own
  refactor: `computeExportDimensions(job.canvasWidth, job.canvasHeight, job.resolution)` computes
  the actual output pixel size in BOTH `videoVisible` branches; the same function sizes the ASS
  document's `PlayResX`/`PlayResY` so captions map 1:1 onto pixels regardless of which branch
  renders.
- **Subtitle positioning remains correct across aspect ratios**: `SubtitleStyle.x`/`y` are
  percentage-of-canvas values (0–100), resolution-independent by construction — confirmed by live
  export at all three required ratios (§16) with a caption-level and word-level style override
  both landing in the expected place and at the expected relative size in every case.
- **Background remains correct**: `toFfmpegColor` + the `pad=` filter's `color=` argument use the
  exact same `backgroundColor` the live preview's own `object-contain` framing uses — confirmed via
  frame-grab of real exported output (§16).
- **Video crop/fit behavior remains correct**: `scale=...force_original_aspect_ratio=decrease` +
  `pad=...` — the source is fit (never cropped, never stretched) inside the canvas and padded to
  fill it, exactly matching the live preview's own `object-contain` behavior — confirmed by direct
  code read (unchanged from before this phase) and by frame-grab.
- **Aspect ratio does NOT unexpectedly stretch the video** — this is where the SAR bug (§6, Fix 1)
  was found: the confirmed issue was a metadata-level pixel-aspect-ratio inaccuracy, not an actual
  stretch of the video's pixel content. Now fixed and covered by both a unit test and a real-render
  regression test.
- **Export dimensions match the selected configuration** — confirmed via real `ffprobe` on actual
  rendered output at all three required ratios (§16), not just the pure `computeExportDimensions`
  function (§18's new tests cover both layers).

Tested live at all three required ratios plus two more the codebase's own composition presets
support (4:5, and the project's native/original size) — see §16.

## 5. Subtitle-format audit

| Format | Filename | Extension | Encoding | Timestamps | Text | Ordering | Line breaks | Word-level info | Styling |
|---|---|---|---|---|---|---|---|---|---|
| SRT | `{ProjectName}.srt` (sanitized) | `.srt` | UTF-8 | `HH:MM:SS,mmm` | Plain transcript (`text`, never the styled/cased display) | Subtitles sorted by `index` on load (confirmed, §3's table) | Preserved verbatim (`\n` in `text`) | Not supported by SRT — not attempted | Not representable in SRT — correctly not attempted |
| VTT | `{ProjectName}.vtt` | `.vtt` | UTF-8, `WEBVTT` header | `HH:MM:SS.mmm` | Same as SRT | Same | Same | VTT format CAN carry per-word cue timing (`<c>`/timestamp tags, used by e.g. YouTube auto-captions) — **not implemented**; documented as a scope limitation (§19), not a defect, since SUBLY's real word-level/animated experience is the burned MP4, and a plain-text VTT sidecar is standard interchange format, not a second animation renderer | Not representable beyond VTT's own (unused) cue-styling tags — correctly not attempted |
| TXT | `{ProjectName}.txt` | `.txt` | UTF-8 | n/a | Same text, `\n` replaced with a space (one line per caption) | Same | Collapsed to spaces (by design — plain transcript) | n/a | n/a |
| ASS | Never exposed to the user | n/a | n/a | n/a | n/a | n/a | n/a | Full fidelity (word-level color/scale/highlight tags) | Full fidelity — this IS the styled render, consumed internally by FFmpeg/libass only |

**Confirmed correct, deliberate behavior (not a bug)**: SRT/VTT/TXT never apply `textCase`
(upper/lower/sentence case) — that's a purely visual/rendering property, applied only inside the
two renderers (live preview, ASS/burned export) via `applyTextCase`. The sidecar files always carry
the real transcript text, so a "TikTok"-preset project (which displays UPPERCASE) still produces a
normally-cased SRT — confirmed live (§16): the burned video showed "HELLO THERE FRIEND" while the
SRT sidecar for the same project correctly read "Hello there friend". This is the right behavior
for an interchange/transcript file, not a missed styling feature.

**Caption output mode (Original/Hinglish/Gujarati-script) is correctly honored by every sidecar
format** — confirmed live (§14): switching a project to Hinglish mode and re-downloading the SRT
produced the Romanized text ("Namaste dost"), not the original Devanagari, using the exact same
`applyOutputMode` function the burned export and live preview both use.

## 6. Filename/destination audit

- **No duplicate-filename class of bug exists** — every export's on-disk filename is
  `{projectId}/exports/{jobId}.mp4`, and `jobId` is a fresh cuid per export attempt (confirmed via
  `lib/export-output-key.ts`), so two exports of the same project can never collide or silently
  overwrite each other. Confirmed live: repeated exports of the same fixture (§16, steps 4/6/10/16)
  each produced their own independent file, all still present afterward.
- **Retry after failure and re-export after success both create a brand-new job/file** — neither
  path attempts to reuse or overwrite a prior attempt's output. Confirmed live (§16, step 12: a
  failed font-preflight export followed by a successful `allowFontFallback` retry produced two
  separate job rows, the failed one with `outputUrl: null`).
  **Output path persistence**: `outputUrl` is only ever set once, atomically, alongside
  `status: "DONE"` — never speculatively set earlier and never left dangling after a failure
  (confirmed by reading `runExportJob`'s catch block, which never sets `outputUrl` on error, and by
  live-checking a cancelled job's row, §16 step 13, which correctly showed `outputUrl: null`).
- **No "UI still points to A after exporting B" staleness** — `startExport()` in
  `export-dialog.tsx` resets `outputUrl`/`errorMessage`/`progress`/`status` to fresh values BEFORE
  the new job's id is even known, so the success/failure panels can never show a stale prior
  result while a new export is in flight. Confirmed by code read; the component itself never
  unmounts across dialog open/close (rendered unconditionally by `top-bar.tsx`, visibility only
  controlled by Radix Dialog's own `open` prop), so this reset logic is the only thing keeping
  `outputUrl` from going stale, and it does so correctly on every `startExport()` call.
- **Confirmed gap, now fixed (Fix 2, §20)**: a downloaded export video previously had NO
  meaningful filename — clicking "Download video" (or a history row's "Download" link) saved the
  file under the browser's own fallback, the raw output URL's last path segment
  (`{jobId}.mp4` — an opaque cuid like `cm1a2b3c4d5e.mp4`). Meanwhile, the SRT/VTT/TXT sidecar
  downloads (a completely separate route) already correctly set
  `Content-Disposition: attachment; filename="{ProjectName}.{ext}"`. Fixed by adding an explicit
  `download="{ProjectName}_{resolution}.mp4"` attribute to both the main "Download video" button
  and every export-history row's "Download" link — a purely client-side, zero-server-risk fix (the
  HTML5 `download` attribute lets the browser choose the local filename without any server
  cooperation, so it can't affect the shared file-serving route's video-streaming behavior used
  elsewhere in the app). Confirmed live (§16, steps 5/7/11) that every download link's `download`
  attribute now reads e.g. `Packaged_Export_QA_91463_1080p.mp4`.

## 7. Export-history audit

- **Successful, failed, and cancelled entries are all captured** — every `ExportJob` row persists
  regardless of outcome; `GET /api/projects/[id]/export` returns the last 10, newest first.
- **Confirmed gap, now fixed (Fix 3, §20)**: the export dialog's polling `useEffect` refreshed the
  in-dialog history list on a `DONE` transition but NOT on an `ERROR` transition — so a failed or
  cancelled export wouldn't appear in "Export history" until the dialog was closed and reopened
  (the only other place history gets fetched). Fixed by adding the same `api.listExportJobs(...)`
  refresh call to the `ERROR` branch. Confirmed live (§16): a deliberately-triggered failure showed
  up in the history list immediately, without closing the dialog.
- **Confirmed gap, now fixed (Fix 4, §20)**: a cancelled export and a genuinely failed export were
  both just `ExportJob.status === "ERROR"` (there is no separate status value for "the user chose
  to cancel this"), and the compact history row only ever rendered the raw lowercased status —
  so both looked identical ("error") to the user. Fixed with a small, testable
  `historyStatusLabel()` helper that recognizes the exact `"Export cancelled."` message
  `export-pipeline.ts` already produces for a deliberate cancel and renders "cancelled" instead.
  Confirmed live (§16, step 13): after force-killing the app mid-export (recovered as a genuine
  interruption, correctly distinct from a user-initiated cancel) AND, separately, an
  explicitly-cancelled export via the Cancel button, the history list correctly showed "cancelled"
  for the deliberate cancel and the plain recovery message (not mislabeled "cancelled") for the
  crash-recovered one.
- **"What did I export?" and "where is the file?" are both answerable** with these fixes in place:
  every row shows resolution/fps/relative time/outcome, and every successful row's Download link
  now carries a name that identifies which project it came from.

## 8. Retry/cancellation audit

- **Retry** (clicking "Retry export" after a failure, or "Export with a substitute font" after a
  font-preflight block) always creates a brand-new `ExportJob` with a fresh id — never attempts to
  resume or mutate the failed job's own row. Confirmed live (§16, step 12).
- **Cancellation is cooperative and safe**: `cancelActiveExport(jobId)` looks up the job's
  in-memory `AbortController` (scoped to the running Node process — same "process-lifetime only"
  pattern as `pipeline.ts`'s transcription cancellation) and aborts it; `renderExport`'s `onAbort`
  handler sends `SIGKILL` to the actual ffmpeg child process and rejects with
  `ExportCancelledError`, which the pipeline's catch block turns into a clean `ERROR` status with
  the exact `"Export cancelled."` message (never a raw process-kill error leaking to the user).
  Confirmed live (§16): a cancelled 4K/60fps export left `outputUrl: null`, the correct error
  message, and **no orphan output or `.ass` file on disk** — `runExportJob`'s catch block removes
  the partial output unconditionally, and `withTempFile`'s own `finally` removes the `.ass`
  regardless of how the render settled.
- **A stall (ffmpeg hangs with no progress for the configured timeout) is distinguished from both
  a cancel and a genuine error** — its own `ExportStalledError`/message, confirmed by the
  pre-existing test suite (`export-cancellation.test.ts`, unchanged this phase, still passing).

## 9. Recovery audit

Not rewritten — `lib/recovery/stale-job-recovery.ts` was audited and live-tested, not modified.
Runs exactly once, synchronously, before the server accepts its first request (via
`instrumentation-node.ts`), which structurally guarantees every `QUEUED`/`RUNNING` `ExportJob` and
every `EXPORTING` `Project` it finds was left behind by a PREVIOUS process that no longer exists
(no queue/worker-pool architecture exists where a second live process could be the true owner of
such a row).

Live-tested the exact scenario the task's Phase 8/16 both ask for (§16, step 13): started a large
(4K/60fps) export, confirmed it was genuinely `RUNNING` at 32% progress via the API, force-killed
every `SUBLY.exe` process (`taskkill /F /IM SUBLY.exe`), confirmed via direct DB read (before
relaunch) that the job was left stuck `RUNNING` and the project stuck `EXPORTING`, and that a
partial `.mp4` (524KB) and the render-time `.ass` sidecar were both still on disk — then relaunched
and confirmed: the job flipped to `ERROR` with the exact recovery message ("Previous export was
interrupted. The incomplete output was removed."), `outputUrl` was `null`, the project flipped back
to `READY` (not stuck, not `ERROR` at the project level), and **both orphan files were gone**. No
stale `DONE` jobs, no stale `RUNNING` jobs, no orphan MP4s, no orphan ASS files, no incorrect
`outputUrl`, no duplicate history entries, no incorrect project state — every one of the task's
explicit Phase 8 checks passed.

## 10. Progress UX audit

- **Stages are real, not fake percentages**: `preparing` (font preflight/staging) → `rendering`
  (the actual FFmpeg encode, with real `onProgress` percentages from FFmpeg's own progress events,
  capped at 99% until verification completes) → `finalizing` (progress ≥95%, still rendering) →
  `complete`. No stage or percentage is synthesized independent of a real signal — confirmed by
  reading `export-pipeline.ts`'s `onProgress` callback and the stage-transition logic, unchanged
  this phase.
- **Cancellation stays available and responsive throughout** — the "Cancel" button is shown for
  the entire `busy` (QUEUED/RUNNING) window, and (§9) confirmed live to actually stop the
  underlying ffmpeg process, not just the UI polling.
- **No change was needed here** — the existing stage/progress model already satisfies "expose
  accurate stage/progress information, don't invent fake percentages," confirmed by both code read
  and live observation of real progress numbers advancing during the 4K test export (1% → 32% →
  57%, tracked directly against ffmpeg's own reported percent).

## 11. Output-verification audit

Not rewritten. `verifyExportOutput` (`lib/export-output-verification.ts`) already had 13 tests
before this phase (file exists / non-empty / ffprobe-readable within a bounded timeout / real video
stream / sane non-zero duration / never throws / every failure message is user-readable), all
still passing unchanged. This phase's audit confirmed its INTEGRATION with the pipeline, not just
the function in isolation:

- A failed verification throws `ExportVerificationError`, caught by `runExportJob`'s catch block,
  which: does NOT mark the job `DONE` (the `DONE` update is only reached after `verifyExportOutput`
  returns `ok: true`), does NOT expose `outputUrl` (never set before that point), cleans the
  invalid output file (`outputAbsPath` cleanup runs unconditionally in the catch block), and
  returns the project to `READY` (not stuck in `EXPORTING` or `ERROR`) — confirmed by direct code
  read of the exact control flow, cross-checked against the recovery test in §9, which exercises
  the same code paths from the "process died before verification" angle.
- **Phase 11's explicit "requested resolution → actual resolution" check** was tested with REAL,
  non-mocked verification: new tests (§18) render real output at 16:9/9:16/1:1 and 720p/1080p tiers
  using the bundled ffmpeg-static binary, then call the exact production `verifyExportOutput`
  function against the real file and assert the returned metadata's `width`/`height` match the
  request precisely, and `fps` matches within a technically-correct (not exact-equality) tolerance
  — per the task's own explicit "do not require exact FPS equality if the pipeline legitimately
  represents it differently" instruction.

## 12. Styling/animation integration

Verified end-to-end (editor → export → playable video) for every category the task lists, live,
using a fixture combining ALL of them in one project (§16):

- **Global style** (Poppins font, uppercase, cyan word-highlight, outline+shadow): burned correctly.
- **Caption-level override** (a distinct font size on one caption): burned correctly, only on that
  caption.
- **Word-level color**: burned correctly (confirmed via frame-grab, §16's dev-QA screenshot —
  "THERE" rendered in the exact override color, distinct from its caption's own color).
- **Word-level size**: burned correctly (same frame-grab — the overridden word visibly larger).
- **Word highlighting** (karaoke-style active-word color): burned correctly, confirmed the active
  word at the sampled timestamp matched the highlight color.
- **Entrance animation**: unaffected by this phase (no animation-timing code was touched); the
  prior phase's own preview/export parity fixes remain intact and unexercised-but-unbroken by any
  export-pipeline change here (confirmed — `lib/subtitles/ass.ts`'s `entranceOverride` function is
  untouched except for the SAR-adjacent filter-chain comment cross-reference, §20).
- **Exit animation**: same — unaffected, confirmed untouched.
- **System font**: unaffected — `system-font-export.ts`/`font-preflight.ts` are untouched this
  phase; a system-font export path was exercised indirectly via the font-preflight failure/retry
  test (§16, step 12), which uses `fontSource: "bundled"` for the specific missing-font case but
  exercises the exact same preflight/staging code path a missing system font would.
- **Bundled font**: the entire fixture used a bundled font (Poppins) throughout, confirmed working.
- **Custom preset**: applying a built-in preset ("TikTok", which also carries the `word-pop`
  entrance animation the prior phase specifically fixed preview/export parity for) and exporting
  produced correct, expected output — confirmed live (§16 dev QA).

No styling-system code was modified this phase — the only styling-adjacent change is the SAR fix
(§6), which lives entirely in the FFmpeg filter-chain construction (`lib/ffmpeg/index.ts`), not in
any styling/animation logic.

## 13. Quality-review integration

`QualityReadinessRow` (in `export-dialog.tsx`) was read, not modified. Confirmed it still correctly:

- Shows **"Subtitle quality hasn't been checked yet"** with a "Check now" shortcut when no report
  has been run yet (`NOT_ANALYZED`) — confirmed live, every fixture opened in this phase's export
  dialog showed this exact state on first open.
- Would show **"✓ No quality issues detected"** for a clean report, **"⚠ Structural issues
  remain (N)"** for error-severity issues, or **"N warnings · M require manual review"** otherwise
  — unchanged logic from the prior P2 Subtitle Review & Publish Readiness phase, not touched here.
- **Never blocks export** — confirmed by code read (no `disabled` binding on "Start export"
  references quality state anywhere in the file) and live: every export this phase ran succeeded
  regardless of whether quality had been checked.
- **No arbitrary quality score exists anywhere in this component or the underlying analyzer** —
  confirmed unchanged.

No change was made here — the task's own explicit instruction ("do not introduce an arbitrary
quality score... do not block export... the user must retain control") was already fully
satisfied by the prior phase's work, and this phase found no export-specific integration gap to fix.

## 14. Language QA

- **English**: the primary fixture for most of this phase's dev and packaged QA.
- **Hindi**: a Devanagari fixture ("नमस्ते दोस्त" / "आप कैसे हैं") — SRT sidecar correctly
  preserved the Devanagari text with correct timestamps; export succeeded.
- **Hinglish**: switched the same fixture's caption output mode to Hinglish via the UI (confirmed
  via API that `captionOutputMode` flipped to `"hinglish"`); re-downloaded the SRT and confirmed it
  now read the Romanized transcript ("Namaste dost" / "Aap kaise hain") — the exact same
  `applyOutputMode` function the burned export and preview use, confirming the sidecar and the
  video export can never disagree on which text mode is active.
- **Legacy Gujarati Script**: not re-tested with a fresh live fixture this phase — the code path
  (`applyOutputMode` reading `gujaratiScriptText` instead of `hinglishText`) is structurally
  identical to the Hinglish path just verified, and was already confirmed at the mechanism level in
  the prior P2 Styling phase; per this multi-phase project's own established precedent, verified by
  code-path equivalence rather than a duplicate live fixture.
- **Word-level timestamps**: unaffected by output mode (confirmed by code read of
  `applyOutputMode`, which only ever swaps which text field is read, never touching `start`/`end`)
  — karaoke/word-highlight timing in an export stays correct regardless of language/output mode.
- **No changes** were made to Whisper, transcription, language policy, or ASR models — this phase's
  diff touches only export/delivery code.

## 15. Large-project QA

Tested export specifically (not general editor performance, already covered by prior phases) at
1,800 captions (a synthetic fixture, real copied media, 20ms-per-caption spacing to keep the whole
project short):

- **Export job creation** (the synchronous part of the API request — project load, cut/remap
  computation, ASS document generation over all 1,800 captions, font collection) completed and
  returned a job id in **83ms**.
- **The full render** (async, including the ASS-building work) completed to `DONE` in well under
  the poller's first 2-second tick — no perceptible slowdown from caption count at this scale.
- **No O(n²) processing was introduced or found**: `buildAssDocument`, `collectRequiredFonts`,
  `applyOutputMode`, and `remapSubtitlesToEdited` are all confirmed single-pass (`O(n)`) over the
  subtitle list by direct code read; none of this phase's five fixes touch any of these functions'
  iteration structure.
- **The export dialog itself never loads unnecessary full-project UI structures for its own
  controls** — confirmed by code read: it reads `project.composition`, `project.globalStyle`
  indirectly via the quality report (already computed elsewhere, not recomputed by the dialog), and
  the bounded (`take: 10`) export-history list; nothing in the dialog iterates the full subtitle
  array.
- The resulting 1,800-caption export file was confirmed valid (non-trivial size, on disk) after
  completion.

## 16. Dev QA

Performed against the real dev server and real `%APPDATA%\subs\subly.db`, disposable fixtures, all
deleted afterward (§18):

- **"Export Delivery QA 91463"** (3 English captions, global style + caption-level override +
  word-level color/size override, `word-pop` entrance via the TikTok preset): exported at 9:16
  (1080×1920, confirmed via `ffprobe`), then 16:9 (1920×1080), then 1:1 (1080×1080) — all three
  confirmed via real `ffprobe` to match the requested dimensions exactly. The 9:16 and 1:1 exports
  were the ones that first surfaced the SAR bug (§6); after the fix, a fresh 1:1 re-export via the
  live dev server confirmed `SAR: 1:1, DAR: 1:1` (previously `1216:1215`). Frame-grabbed the export
  at t=0.8s and visually confirmed the word-level color/size override, the caption-level font-size
  override, and correct fit+pad framing inside the square canvas. Downloaded all three subtitle
  sidecar formats and confirmed correct timestamps/text/filenames. Triggered a deliberate
  cancellation of a large (4K/60fps) export and confirmed: `status: ERROR`,
  `errorMessage: "Export cancelled."`, no orphan output file, and the export-history list correctly
  labeled it "cancelled" (not the generic "error") once the two history-related fixes (§7) were in
  place.
- **"Export Large QA 91463"** (1,800 captions): see §15.
- **"Export Lang QA 91463"** (Hindi/Hinglish): see §14.
- All three fixtures and their uploaded media were permanently deleted after use.

## 17. Packaged Windows QA

Built a fresh `npm run electron:pack` (exit code 0, confirmed via the definitive `blockmap`
completion marker in the build log — a looser "process appears gone" heuristic was tried first,
falsely reported completion mid-build, and was corrected before proceeding, matching a
lesson learned in an earlier phase of this same multi-phase project). Uninstalled the prior
packaged install silently (`Uninstall SUBLY.exe /S`), confirmed the install directory was gone,
then installed the new build silently (`SUBLY Setup 0.1.0.exe /S`) — confirmed as a genuine fresh
install (not an in-place upgrade) via the installed `SUBLY.exe`'s file timestamp matching the fresh
build exactly.

Walked the task's own 17-step checklist against the packaged app (steps renumbered here to match
the task's exact list):

1. **Launch app** — launched, embedded server responded on `/api/system/status`.
2. **Open project** — a disposable fixture ("Packaged Export QA 91463", 2 English captions, global
   style set) opened correctly.
3. **Confirm export settings** — the export dialog correctly showed Composition 1080×1920, 1080p,
   30fps, High quality (the project's actual stored defaults).
4. **Export 16:9** — succeeded.
5. **Verify output** — `ffprobe` confirmed `1920×1080`, `SAR: 1:1`.
6. **Export 9:16** — succeeded.
7. **Verify output** — `ffprobe` confirmed `1080×1920`, `SAR: 1:1`.
8. **Export subtitle sidecar format(s)** — SRT/VTT/TXT all downloaded successfully.
9. **Verify files** — all three carried the correct `Content-Disposition` filename
   (`Packaged_Export_QA_91463.{srt,vtt,txt}`).
10. **Re-export same project** — succeeded, its own independent job/file, no collision with the
    prior two exports.
11. **Test export history** — the dialog's history list correctly showed all three exports (16:9,
    9:16, re-export), each with a working, correctly-named Download link
    (`Packaged_Export_QA_91463_1080p.mp4`).
12. **Test failed export/retry** — set the project's font to a name guaranteed not to exist
    ("Subly Packaged QA Missing Font 91463"), confirmed the export genuinely failed with the
    expected `"Font unavailable: ..."` message, then retried with `allowFontFallback: true` and
    confirmed it succeeded. Reset the font back to a valid one afterward.
13. **Force-kill during an export** — started a large (4K/60fps) export, confirmed via the API it
    was genuinely `RUNNING` at 32% progress, force-killed every `SUBLY.exe` process, and confirmed
    (before relaunch) the job was left stuck `RUNNING`, the project stuck `EXPORTING`, and a
    partial `.mp4` + `.ass` were both left on disk.
14. **Relaunch** — launched the packaged app again, embedded server responded on its new
    (randomly-assigned) port.
15. **Reopen project** — confirmed via the browser that the fixture reopened correctly, captions
    intact.
16. **Export again** — succeeded.
17. **Verify final output** — `ffprobe` confirmed `1080×1920`, `SAR: 1:1`, `30fps`, valid duration;
    a frame-grab at t=0.8s visually confirmed the burned caption ("HELLO THERE FRIEND", active word
    "HELLO" correctly cyan-highlighted) rendered correctly.

Separately verified between steps 13 and 14 (recovery, matching §9's own detailed account): after
relaunch, the stale job correctly flipped to `ERROR` with the exact recovery message, `outputUrl`
was `null`, the project correctly returned to `READY`, and both orphan files were gone.

**All 17 steps passed.** No application bug was found during packaged QA beyond what was already
found and fixed during dev QA (the SAR bug, confirmed present and then confirmed fixed identically
in both the dev server and the packaged build).

## 18. Production data integrity

Before any QA this phase, took a fresh backup (`subly.db.bak-pre-export-delivery-qa`) of the real
`%APPDATA%\subs\subly.db` and captured an explicit baseline: **18 projects, 46 ExportJob rows total
(including the real font-preflight failure/retry history from an earlier phase's own QA), 0 custom
subtitle presets**, plus the full export-history rows for all three well-known real production
projects (`Untitled project`, `rishab guj`, `Hindi/hinglish test`).

After all dev QA and packaged QA completed and every disposable fixture (`Export Delivery QA
91463`, `Export Large QA 91463`, `Export Lang QA 91463`, `Packaged Export QA 91463`) and their
uploaded media were permanently deleted, re-compared against that baseline: **all three production
projects' full data — subtitle content, video asset, composition, language, caption output mode,
AND their complete export-job history (resolution/fps/quality/status/outputUrl/errorMessage/
timestamps) — are byte-for-byte identical** (excluding only the `updatedAt` timestamp column).
Project count: 18/18 matched. ExportJob count: 46/46 matched. Custom preset count: 0/0 matched. All
temporary `scripts-qa-*.mjs` helper scripts were deleted after use.

## 19. Remaining limitations

- **VTT sidecar exports don't use per-word cue timing tags** — VTT's format CAN carry this (the
  same mechanism YouTube's auto-captions use), SUBLY's doesn't. Documented, not implemented: the
  task's own Phase 5 instruction is to document format limitations accurately rather than assume
  capability, and SUBLY's actual word-level/animated experience already lives in the burned MP4 —
  adding a second, parallel word-timing renderer for VTT specifically would be a new feature, not a
  confirmed defect fix, and risks scope creep the task explicitly warns against ("do not add
  arbitrary export settings").
- **`ExportJob.aspectRatio`/`format` are vestigial, unread columns** (§3) — harmless (no UI ever
  claims to set them, so there's no user-visible mismatch), left in place rather than migrated out,
  per the task's own "do not add/remove DB fields without a demonstrated need" guidance.
- **Legacy Gujarati Script export was verified by code-path equivalence to the live-tested Hinglish
  path**, not a fresh live export fixture this phase — consistent with this multi-phase project's
  own established precedent for this specific, structurally-identical code path.
- **The SAR bug's root cause inside libx264's own internal VUI computation was not fully
  reverse-engineered** — the fix (`setsar=1`) is the standard, well-established way to guarantee
  correct pixel-aspect-ratio metadata regardless of why an encoder's own default might compute one
  slightly off, and was confirmed to fully resolve the observed issue at every tested dimension
  (including the clearest case, a perfectly square canvas). Understanding the exact internal
  encoder mechanism that produced `1216:1215` specifically was not pursued further, since it isn't
  necessary to trust or verify the fix (both the pure filter-chain plan and real rendered output
  were directly tested before and after).

## 20. Exact files changed

- `src/lib/ffmpeg/index.ts` — **the confirmed correctness bug fix**: added `setsar=1` to both the
  video-on (`scale`+`pad`) and video-off (lavfi solid-color) filter chains, forcing an exact 1:1
  pixel aspect ratio instead of leaving it to libx264's own slightly-off default for several
  composition dimensions.
- `src/lib/export-pipeline.ts` — the cancellation error message now reads from the new shared
  `EXPORT_CANCELLED_MESSAGE` constant instead of an inline string literal, so the export-history
  UI's cancelled-vs-failed detection (below) can never drift out of sync with the string the
  pipeline actually produces.
- `src/lib/export-status-message.ts` — **new file**: `EXPORT_CANCELLED_MESSAGE`,
  `isExportCancelledMessage` — the one shared source of truth for recognizing a deliberate
  cancellation's error message, mirroring the existing `font-preflight-message.ts` pattern.
- `src/lib/export-history-format.ts` — **new file**: `exportDownloadFilename` (Fix: friendly
  download filenames) and `historyStatusLabel` (Fix: cancelled-vs-failed distinction) — pulled out
  of the "use client" `export-dialog.tsx` into a plain module so both have direct unit tests
  (mirroring the prior P2 Styling phase's `animation-render.ts` precedent for the same JSX/testing
  constraint).
- `src/lib/utils.ts` — added `sanitizeFilename` (shared filename-sanitization helper, extracted
  from what was previously inline-duplicated logic in the subtitles route).
- `src/app/api/projects/[id]/subtitles/route.ts` — now calls the shared `sanitizeFilename` instead
  of its own inline regex (behavior unchanged, removes duplication with the new export-video
  filename logic).
- `src/lib/api-client.ts` — `listExportJobs`'s return type now includes `errorMessage` (the backend
  API already returned it; the frontend type just didn't declare it, so `export-dialog.tsx` couldn't
  read it type-safely until this).
- `src/components/editor/export-dialog.tsx` — Fix: the polling effect's `ERROR` branch now refreshes
  export history (previously only `DONE` did); Fix: the main "Download video" button and every
  history row's "Download" link now carry a friendly `download="{ProjectName}_{resolution}.mp4"`
  filename; Fix: history rows use the new `historyStatusLabel` to show "cancelled" instead of the
  generic "error" for a deliberate cancellation.
- `prisma/schema.prisma` — **comment-only fix** (no schema/migration change): corrected a stale,
  actively-misleading comment on `ExportJob.canvasWidth`/`canvasHeight` that described pre-refactor
  behavior ("only used when videoVisible is false") contradicting what the actual code has done
  since an earlier phase's own composition-canvas refactor (they're the source of truth in BOTH
  render paths); also documented `aspectRatio`'s vestigial/unread status inline.
- `src/lib/ffmpeg/__tests__/export-dimensions.test.ts` — **new file**, 17 tests: pure-function
  coverage of `computeExportDimensions`/`planExportRender` (resolution scaling at 16:9/9:16/1:1/4:5,
  videoVisible on/off, fontsDir, keepRanges/cut-filter ordering, and — critically — the new
  `setsar=1` regression tests, one for each render branch).
- `src/lib/ffmpeg/__tests__/export-settings-output.test.ts` — **new file**, 6 tests: real,
  non-mocked FFmpeg renders (extending the established pattern from `export-cancellation.test.ts`)
  probed with the real production `verifyExportOutput`/`probeVideo` functions — confirms requested
  resolution/aspect-ratio/FPS actually reach the real encoded file, and includes the definitive
  real-render SAR regression test for the confirmed bug.
- `src/lib/__tests__/export-history-format.test.ts` — **new file**, 7 tests: the friendly-filename
  and cancelled/failed-label helpers.
- `package.json` — registered the three new test files in a new `test:export-workflow` script and
  the main `test` script.
- `research/p2_professional_export_delivery_workflow_report.md` — this report (new file).

No other files were modified. `export-output-verification.ts`, `stale-job-recovery.ts`,
`export-output-key.ts`, `subtitles/export-formats.ts`, `fonts/font-preflight.ts`,
`fonts/system-font-export.ts`, and the export API routes themselves were all read/audited but
required no changes — confirmed correct by this phase's own tests and live QA (including a real
crash/recovery cycle and a real font-preflight failure/retry cycle), not merely assumed.

## 21. Final PASS/FAIL

- Automated tests: **421/421 passing** (30 new this phase: 17 in `export-dimensions.test.ts`, 6 in
  `export-settings-output.test.ts`, 7 in `export-history-format.test.ts`).
- Typecheck: **0 errors**.
- Lint: **0 new warnings** (same 5 pre-existing, unrelated warnings as before this phase).
- Confirmed defects: **all 5 fixed** — the SAR aspect-ratio metadata bug (the one genuine
  render-correctness bug), missing friendly download filenames, failed exports not refreshing
  history, cancelled/failed exports being indistinguishable in history, and a stale/misleading
  schema comment.
- Export settings actually control the resulting output — confirmed via real, non-mocked
  render+probe tests for resolution, aspect ratio, and FPS.
- Aspect ratios export correctly — confirmed at 16:9/9:16/1:1/4:5, now including exactly correct
  pixel-aspect-ratio metadata at every tested dimension (the fixed bug).
- Subtitle sidecar files are correct — SRT/VTT/TXT all verified for timestamps, text, ordering,
  filenames, and correct caption-output-mode (Original/Hinglish) behavior.
- Repeated exports behave predictably — no collisions, no stale UI state, confirmed live at every
  QA stage.
- Export history remains correct and now more informative (failed/cancelled entries visible
  immediately, cancelled distinguishable from failed).
- Retry works — confirmed for both a plain failure and the font-preflight-specific fallback path.
- Cancellation remains safe — confirmed cooperative, no orphan files, correct error state.
- Crash recovery works — confirmed via a real force-kill-mid-export cycle in both dev and packaged
  environments, unchanged/unmodified recovery system.
- Output verification remains authoritative — unmodified, its integration with every failure path
  re-confirmed by code read and live testing.
- Styling/animation export remains intact — confirmed via a fixture exercising global/caption/word
  style, word highlighting, a built-in preset, and its associated entrance animation, all burned
  correctly.
- Quality readiness remains informational/non-blocking — confirmed unchanged.
- English/Hindi/Hinglish confirmed live; legacy Gujarati Script confirmed by code-path equivalence.
- Large projects (1,800 captions) remain functional and fast — export job creation in 83ms, full
  render near-instant, no O(n²) behavior found or introduced.
- Fresh packaged Windows QA passes — all 17 steps of the task's own checklist, including a genuine
  crash/recovery cycle.
- Production data remains unchanged — all 3 real projects' full data, including complete export
  history, confirmed byte-for-byte identical before and after every QA stage.

**P2 PROFESSIONAL EXPORT & DELIVERY WORKFLOW — PASS**
