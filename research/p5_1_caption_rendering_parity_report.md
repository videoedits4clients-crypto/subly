# P5.1 — Caption Rendering Parity Report

## 1. Task ID

86317 — "P5.1: Caption Rendering Parity" (follow-up to Task 85241's P5 style-library QA finding).

## 2. Existing rendering limitation

The `bg-highlight` word animation (used by the pre-existing "Highlight" preset and the P5-era
"Active Highlight" and "Marker" presets) renders a real background chip behind the active word in
the live editor preview, but the exported MP4 fell back to color-only highlighting — no background
box at all. This is a genuine EDITOR PREVIEW ≠ EXPORTED VIDEO gap: what a creator sees while
editing is not what they get when they export and post the video.

## 3. Root cause

- **Preview** (`activeWordCss` in [preview-style.ts](src/lib/subtitles/preview-style.ts)): the
  active word gets `backgroundColor: style.highlightColor`, `borderRadius: "0.25em"`, and a
  `boxShadow: '0 0 0 0.15em ${highlightColor}'` used as a padding trick — a real CSS box, browser-
  rendered.
- **Export** ([ass.ts](src/lib/subtitles/ass.ts) → FFmpeg's `subtitles` filter → libass): ASS/SSA
  has no native "background box behind one word within a line of text" primitive. The pre-fix
  `wordOverride()` fell back to a `\c` (PrimaryColour) override for `bg-highlight`, i.e. recolored
  the word's text instead of drawing a box — the closest thing ASS's per-run override tags support,
  but visually a completely different effect.
- Deeper cause: ASS script generation runs in Node at export time, before the video is ever
  rendered. It has no way to ask libass "how wide will this word actually render" — real glyph
  metrics only exist inside libass/FreeType at burn-in time, using the real font file. Drawing an
  accurately-positioned/sized rectangle requires knowing that width ahead of time.

## 4. Chosen implementation

A real ASS **vector-drawing (`\p1…\p0`) rectangle**, emitted as its own `Dialogue` event on
**Layer 0** (behind), immediately before the caption's own text `Dialogue` event on **Layer 1**
(in front), for each interval where a word is active. This uses the exact same FFmpeg `subtitles`
filter / libass pipeline already used for every other caption — **no second rendering system**.

Considered and rejected:
- Multiple overlapping `BorderStyle: 3` (opaque-box) style lines — box-per-style covers the whole
  line's bounding box, not a single word; not expressible per-word without per-word Style lines,
  which don't compose with per-word active-state changes cleanly.
- FFmpeg filter-graph composition (`drawbox`, overlay filters) — would require frame-accurate,
  per-word-timed filter expressions generated per project; far more complex than one extra ASS
  event per interval, and duplicates logic the ASS pipeline already owns (word timing, positioning).
- A second, purpose-built text-layout/rendering pass — explicitly forbidden by the task.

Rounded corners: **real**, not faked — ASS drawing mode supports cubic Bézier curves, so the chip
is a true rounded rectangle (straight edges + 4 Bézier corner arcs), matching the preview's
`border-radius: 0.25em` closely (same 0.25×fontSize corner radius constant is reused).

Word width, since real glyph metrics aren't queryable at generation time, is estimated via a
per-character metrics table (see §8) calibrated against real exports of this app's actual fonts —
not a font-rendering dependency (no `canvas`, no external library).

## 5. Files changed

- [src/lib/subtitles/ass.ts](src/lib/subtitles/ass.ts) — the only production file changed:
  - `wordOverride()`: `bg-highlight` no longer recolors the active word's text (now returns `""`,
    matching the preview's `activeWordCss`, which also leaves `color` unchanged for this case).
  - New: `CHAR_WIDTH_PER_1000` (Helvetica-Bold AFM-derived per-character glyph width table),
    `charWidthEm`, `estimateTextWidthPx`, `wordsByLine`, `roundedRectPath`,
    `FONT_WIDTH_CALIBRATION` + `fontWidthCalibration` (per-font-family width correction —
    see §8), `ActiveWordChipGeometry`, `computeActiveWordChip`.
  - `buildAssDocument()`: text `Dialogue` events moved to Layer 1; a Layer-0 background-chip
    `Dialogue` event is emitted immediately before the text event for any interval where
    `anim.word === "bg-highlight" && style.wordHighlight && interval.activeWordIndex !== null`.
- [src/lib/subtitles/__tests__/bg-highlight-export.test.ts](src/lib/subtitles/__tests__/bg-highlight-export.test.ts) — new, 18 tests (see §12).
- [package.json](package.json) — added `test:bg-highlight-export` script, included the new test
  file in the aggregate `test` script, version bump `0.1.3` → `0.1.4` (see §16).

No changes to: Whisper/transcription, word timestamps, segmentation, project persistence,
autosave, Electron main process, installer config, dashboard, language policy, or any of the 45
preset *definitions* (only the renderer's interpretation of `bg-highlight` changed).

## 6. Preview behavior

Unchanged. The live editor preview already rendered the background chip correctly (that was never
the bug) — `preview-style.ts`'s `activeWordCss` was not touched.

## 7. Export behavior

**BEFORE**: exported MP4 for any `bg-highlight` preset showed the active word recolored to
`highlightColor` (a plain `\c` override) — no background box.

**AFTER**: exported MP4 shows a real filled, rounded-rectangle background chip drawn behind the
active word, in `highlightColor` at `style.opacity`, sized to the word plus ~0.15em padding on
each side, with ~0.25em corner radius — closely matching what the live preview shows. Confirmed via
real ffmpeg exports, frame extraction, and pixel-level measurement (not source-inspection-only —
see §16).

## 8. ASS implementation

Each active-word interval (from the existing `buildIntervals()`) that uses `bg-highlight` now
produces two `Dialogue` events instead of one:

```
Dialogue: 0,<start>,<end>,<style>,,0,0,0,,{\an7\pos(left,top)\bord0\shad0\1c<colorWithAlpha>\p1}<roundedRectPath>{\p0}
Dialogue: 1,<start>,<end>,<style>,,0,0,0,,{\pos(x,y)<entrance/exit fx>}<line text, unchanged>
```

- Layer 0 (chip) always precedes Layer 1 (text) for the same interval, guaranteeing correct
  z-order (chip behind text) regardless of event order in the file — libass composites strictly by
  `Layer`, not file order, but keeping them in this order also makes the `.ass` file readable.
- `\an7\pos(left,top)` anchors the drawing at its own top-left, giving the code full manual control
  over absolute placement rather than relying on ASS's line-alignment semantics for a raw shape.
- Fill color reuses the existing `assColorWithAlpha()` helper (`\1c` combined-alpha-color format) —
  the same helper the rest of the file already uses for every other color override.
- **Word-width estimation**: `estimateTextWidthPx()` sums a per-character width (as a fraction of
  em) from a `CHAR_WIDTH_PER_1000` table derived from the standard Helvetica-Bold AFM metrics
  (public per-character advance-width reference data, not copyrighted code), since ASS/libass gives
  script generation no way to query the real font's glyph widths ahead of burn-in.
- **Font calibration (the actual bug fix — see below)**: that Helvetica-Bold-derived baseline was
  measured, via an isolated ffmpeg burn-in + pixel-bounding-box test against this app's own cached
  font files, to be significantly too wide for this app's real fonts — and by a different amount
  per font family:
  - Poppins-Bold: real width ≈ **0.50×** the Helvetica-Bold estimate (confirmed at two font sizes).
  - DM Sans-Bold: real width ≈ **0.71×**.
  - Montserrat-Bold: real width ≈ **0.66×**.
  `FONT_WIDTH_CALIBRATION` applies these three measured factors by family name; any other font
  family uses `DEFAULT_FONT_WIDTH_CALIBRATION = 0.62` (the average of the three measured points)
  rather than the uncorrected 1.0 baseline, which is now known to be too wide for every font
  actually tested.
- **How this bug was actually found**: after the first implementation pass, a live-QA export of
  "Active Highlight" (Poppins) showed the chip floating in empty space well past the actual word —
  not merely imprecise, but completely disconnected. Rather than accept that as a "known
  limitation," it was root-caused with an isolated single-word ffmpeg burn-in (bypassing the whole
  app) + a `sharp`-based pixel-bounding-box measurement script, which is what surfaced the
  per-font ~0.5–0.7× discrepancy above. This is exactly the kind of thing Part 9's "must actually
  export and inspect, not just source-inspect" requirement exists to catch.

## 9. Word timing verification

The chip reuses the existing `buildIntervals(sub)` mechanism verbatim — no changes to interval
computation, word timestamp reading, or active-word-index logic. Each chip `Dialogue` event's
Start/End are exactly the interval's own `[start, end)`, so chip timing is byte-identical to the
existing (already-correct) active-word text-color-override timing. Verified by unit test 3 (exact
interval-boundary match) and live export (chip transitions land on the same word boundaries as the
karaoke-style text highlighting in unaffected presets).

## 10. Multi-line verification

`wordsByLine()` groups words per rendered line using the same word-count-per-line technique
`joinWithOriginalLineBreaks` already uses, so it can never disagree with how the line's text is
actually split. Verified two ways:
- Unit tests 5/5b: a 2-line, 7-word caption produces exactly one chip per word (7 total), and the
  chip for the last word of line 1 vs. the first word of line 2 land at distinct, correctly-ordered
  vertical positions.
- Live export: a real `buildAssDocument()` output for a 2-line caption (Poppins) was burned via
  ffmpeg and the two line-break-adjacent frames inspected — the chip for line 1's last word lands
  on line 1 over the correct word, and the chip for line 2's first word lands on line 2 over the
  correct word, both with correct horizontal alignment.

## 11. Existing preset compatibility

All 45 built-in presets across all 8 categories (Creator, Dynamic, Highlight, Clean, Cinematic,
Fun, Effects, Retro) still generate valid ASS — verified by the pre-existing
`preset-library.test.ts` tests 13/13b (one-per-category + all-45 crash guard), unmodified and
still passing. No preset *definitions* were changed; only the renderer's handling of the
`word: "bg-highlight"` animation type changed, which is used by exactly 3 presets (Highlight,
Active Highlight, Marker) — all 3 were live-exported and inspected (§16).

## 12. Tests

New file `src/lib/subtitles/__tests__/bg-highlight-export.test.ts`, 18 data-driven tests, covering
all 9 of Part 8's minimum items:
1. Valid ASS structure for `bg-highlight`.
2. Chip events coexist with (don't corrupt) normal text events; gated correctly on `wordHighlight`
   and on `anim.word === "bg-highlight"` specifically (tests 2, 2b, 2c).
3. Chip timing exactly matches the active-word interval, not the whole caption span (test 3).
4. First/middle/last active word, and a single-word caption, each produce exactly one chip
   (tests 4, 4b).
5. Multi-line captions remain valid, one chip per word, correct line-break behavior (tests 5, 5b).
6. Existing `highlight` (plain color) animation is unchanged; `bg-highlight` no longer recolors
   text (tests 6, 6b).
7. `scale`/`bounce`/`underline` word animations are unaffected — no chips emitted (test 7).
8. Punctuation/apostrophes/commas, Unicode (Devanagari), and a very long word all produce valid,
   NaN-free geometry (tests 8, 8b, 8c); a dedicated regression test (8d) pins the exact bug found
   during live QA — the last word's chip in a center-aligned Poppins line must stay near the
   caption's own horizontal center, not drift toward the canvas edge.
9. All 3 `bg-highlight`-driven presets (Highlight/Active Highlight/Marker style variants) produce
   valid, chip-bearing, NaN-free documents across several style variants (fonts, colors,
   positions, alignments) — test 9, plus test 10 for every align/vAlign combination.

Existing suites (`preset-library.test.ts`, `global-style-robustness.test.ts`,
`animation-render.test.ts`, and the full aggregate suite) all still pass — **469/469 tests pass**
(451 pre-existing + 18 new), 0 failures.

## 13. Typecheck

`npm run typecheck` — clean, 0 errors, before and after every change in this task.

## 14. Lint

`npm run lint` — 0 errors, 5 warnings, identical to the pre-existing baseline (no new warnings
introduced).

## 15. Production build

`next build` (invoked as a step of `npm run electron:pack`) completed successfully: compiled in
12.9s, `tsc` finished with 0 errors, page-data collection and optimization completed cleanly, and
`postbuild-standalone.js` correctly assembled the standalone server output (bundled worker exe,
`.next/static`, `public/`, `prisma/template.db`). See §16 for the full packaged-build outcome.

## 16. Packaged Windows QA

Built the real installer via `npm run electron:pack` (clean → PyInstaller worker build → `next
build` → electron-builder/NSIS) — succeeded end to end, producing `release\SUBLY Setup 0.1.4.exe`
(560,523,611 bytes) and its `.blockmap`. Verified EXE metadata directly on the built file (not
source config): `FileVersion 0.1.4`, `ProductVersion 0.1.4`, `ProductName SUBLY`, `CompanyName
Akshay Creations` — consistent with `package.json`'s `0.1.4` and the installer filename.

Silent-installed to a disposable directory (`%LOCALAPPDATA%\SUBLY-P5-1-QA`) and launched the real
packaged `SUBLY.exe` (confirmed via its own startup log line pointing at the real production DB
path, `C:\Users\User\AppData\Roaming\subs\subly.db` — exactly what `electron/main.js` wires up).
Full flow executed against the running packaged app:

1. **Launch** → dashboard loaded the real existing production projects correctly.
2. **Create project** → new disposable QA project created via the UI ("P5.1 Packaged QA
   (disposable)").
3. **Transcribe** → uploaded the QA fixture video; **real local Whisper transcription** ran (not
   mock/demo mode) and reached `READY` with 48 real captions.
4. **Apply Marker → preview → export** → applied the Marker preset, exported at 720p, export
   reached `DONE`. Downloaded and inspected the resulting MP4: four sampled frames all show the
   real yellow background chip correctly positioned over the active word ("GAVE", "FOR" ×2,
   "FROM") — the packaged build's real bundled ffmpeg/libass renders identically to the dev-mode
   verification in §7/§8.
5. **Highlight, Active Highlight** → both also applied, exported, and reached `DONE` successfully
   in the same packaged app (no export errors).
6. **Reopen project** → all 3 processes for `SUBLY.exe` force-stopped (simulating a full app
   restart), then `SUBLY.exe` relaunched fresh. Re-fetched the same project via its still-running
   local server: **all 48 subtitles intact**, `animation.word: "bg-highlight"` and
   `highlightColor: "#7C3AED"` (the last-applied Active Highlight preset) both persisted correctly
   across the restart — project state survived intact, exactly as required.

Cleanup: the disposable QA project was removed via the app's own two-step Trash flow (`DELETE
/api/projects/:id` → moves to Trash, then `DELETE /api/projects/:id/trash` → permanent delete) —
never a direct database edit. The QA install directory, its Desktop/Start-Menu shortcuts were
removed afterward; the built installer itself (`release/`, gitignored) was left in place as the
task's own deliverable.

## 17. Production data comparison

Baseline captured **before** any QA activity in this task, from the real production database
(`%APPDATA%\subs\subly.db`, backed up to `subly.db.bak-pre-p5-1-caption-parity-qa`):

| Table | Before | After (dev QA) | After (packaged QA) |
|---|---|---|---|
| Project | 18 | 18 | 18 |
| ExportJob | 46 | 46 | 46 |
| Subtitle | 2250 | 2250 | 2250 |
| VideoAsset | 18 | 18 | 18 |
| SubtitlePreset | 0 | 0 | 0 |

A full row-level comparison (every column except `updatedAt`) confirms the production database is
**byte-for-byte identical** before this task's work and after the packaged-app QA (§16) — the
live-export QA (Part 9) ran against the Next.js dev server in `SUBLY_DESKTOP=1` mode with its own
isolated `prisma/dev.db` (a disposable, gitignored SQLite file, completely separate from the real
desktop app's `%APPDATA%\subs\subly.db`) and never touched production data at all; the
packaged-app QA (§16) necessarily *did* run against the real production database path, so its
disposable QA project (and its Subtitle/ExportJob/VideoAsset rows) were created and then fully,
permanently removed via the app's own Trash flow — the final row-level comparison after that
cleanup shows zero net change.

## 18. Known limitations

- **Word-width estimation is a calibrated approximation, not exact glyph metrics.** ASS script
  generation cannot query libass's real font rendering ahead of burn-in without adding a
  font-rendering dependency (explicitly out of scope). The per-character table + per-font
  calibration (§8) was tuned against 3 real fonts (Poppins, DM Sans, Montserrat) via actual
  ffmpeg exports; other registered fonts use a reasonable default calibration and may show mild
  (not severe) width imprecision.
- **Vertical centering has a modest, measured offset for some configurations.** In one live-export
  measurement (Poppins, `vAlign: bottom`), the chip's vertical center sat ~6-8px above the real
  glyph's vertical center (out of a ~45px line height, roughly 15%) — the chip still clearly
  covers and identifies the correct word, but isn't pixel-perfectly centered on it. This traces to
  libass's real internal line-height/leading not being fully queryable at generation time either
  (a smaller instance of the same fundamental constraint as word-width). Not corrected further in
  this pass to avoid a low-confidence, single-data-point vertical calibration; flagged here
  honestly per the task's own instruction to document rather than fake unsupported precision.
- **True glyph-perfect rounded corners on the TEXT itself remain out of scope** — the corners in
  question here are the chip's own (real, Bézier-drawn) corners, not a claim about font hinting.
- The `highlight` preset's `highlightColor` is `#000000` — the chip is real and correctly emitted,
  but visually invisible against a black composition background (confirmed by direct pixel
  inspection). This is a pre-existing preset color choice, unrelated to this fix, and matches what
  the live preview would also show against the same background.
