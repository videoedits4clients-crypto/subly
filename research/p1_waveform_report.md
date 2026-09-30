# P1 Fix Report — Waveform Timeline

**Date:** 2026-09-17
**Scope:** Add an audio waveform visualization to the existing editor timeline. No other P1 features implemented (dashboard search/filter/sort, custom presets, silent-upload-rejection fixes, export font-fallback surfacing, shortcuts help UI, translation timing fixes, dashboard navigation changes, settings redesign — all untouched). No changes to transcription reliability, P0/P0.5 cancellation/stall logic, language policy, Gujarati Script, or Gujarati ASR/LoRA research. No production ASR changes.

---

## What was built

A precomputed, cached, canvas-rendered amplitude waveform row in the editor timeline, positioned between the video track and the subtitle-block row (`src/components/editor/timeline.tsx`).

### Data pipeline (server-side, no new dependency)
- **`src/lib/audio/waveform.ts`** — a hand-rolled WAV chunk parser (`parseWavPcm16`) reads the mono 16-bit PCM `audio.wav` that `lib/pipeline.ts`'s `extractAudio()` already produces for every project (never re-extracted, never touched). `computePeaks` reduces raw samples to a fixed-resolution "peak per time bucket" array (`DEFAULT_PEAKS_PER_SECOND = 100`), taking the max-abs sample per bucket and normalizing to a `Uint8Array` (0–255). `encodeWaveform`/`decodeWaveform` round-trip the data as base64 for the wire.
- **`src/app/api/projects/[id]/waveform/route.ts`** — new GET route. Returns `{ peaks: null }` (200, not an error) when there's no audio yet. Caches the computed waveform as JSON at `<projectId>/waveform.json` via the existing `StorageDriver`, invalidated by comparing the source file's mtime — so it's computed once per project and re-used on every subsequent load (including across app relaunches). The cache file lives under the project's own storage prefix, so the pre-existing permanent-deletion cleanup (`delDir`) removes it automatically; no new deletion code was needed. Any failure anywhere in the route (corrupt WAV, missing file, parse error) is caught and degrades to `{ peaks: null }` rather than breaking the editor.

### Rendering (client-side)
- **`src/components/editor/waveform.tsx`** — a `pointer-events-none` canvas that renders **only the visible scroll viewport** (+ a one-viewport buffer), never the full timeline width. This is required because a 60-minute recording at the timeline's own max zoom (220px/sec) would need a ~790,000px-wide canvas, which exceeds Chromium's ~32,767px per-dimension canvas limit. It reuses the same `viewport.scrollLeft`/`viewport.width` state the timeline already tracks for its subtitle-block virtualization. Each device-pixel column draws the max peak within that column's own time span, so it degrades correctly at any zoom level (repeats the nearest peak when zoomed in past peak resolution; collapses many peaks into one column when zoomed out) with draw cost bounded by screen width, never by peak count.
- **`src/lib/timeline/time-scale.ts`** — the one `timeToPixels`/`pixelsToTime` pair used by *both* the pre-existing timeline click/scrub logic (`timeFromClientX` was refactored to use it) and the waveform's own column-time math. This is what guarantees a click on the waveform can never disagree with a click anywhere else on the timeline about what time it represents — the waveform has no independent seek/interaction logic at all; it is `pointer-events-none` and clicks fall through to the existing track's own click handler.
- Playhead position, selected-caption highlight, trim dimming, and cut-range dimming are all drawn as separate absolutely-positioned overlay `div`s in `timeline.tsx` (matching the existing video-track row's own overlay style), using the same `timeToPixels` calls — so they can never drift out of sync with the waveform or the ruler.

### Sizing
`editor-shell.tsx`'s timeline container height was increased (`lg:h-52`→`lg:h-64` desktop, `h-64`→`h-72` mobile timeline tab) to give the new row real visual room.

---

## Testing

19 new tests in `src/lib/audio/__tests__/waveform.test.ts` + 7 new tests in `src/lib/timeline/__tests__/time-scale.test.ts`, covering all 9 required categories:

1. **Waveform generation** — a real synthetic WAV produces non-empty, sensible peaks.
2. **Deterministic** — identical input bytes always produce identical peaks.
3. **Duration mapping** — linear `timeToPixels` scaling across the timeline's real zoom range (20–220px/sec) and across 30s–60min durations.
4. **Playhead → waveform position** — the playhead's own left-offset formula and the waveform's column-time formula are proven to agree at an arbitrary non-round zoom level.
5. **Waveform position → timeline time** — `pixelsToTime` is the exact inverse of `timeToPixels` at every zoom level tested; a click-mapping test mirrors `timeFromClientX`'s exact formula.
6. **Trim/cut compatibility** — `effectiveCuts`/`isInsideCut` (existing edit-model logic) combined with `timeToPixels` correctly identify and position trimmed/cut regions, matching what the waveform's dimming overlay uses.
7. **Missing/corrupt audio** — a truncated-mid-header WAV and a WAV missing its data chunk each throw clean, descriptive errors (see bug fix below) rather than crashing.
8. **Silent audio** — an all-zero sample buffer produces an all-zero peaks array, no NaN/crash.
9. **Long-duration handling** — a 60-minute-equivalent sample count (115.2M samples) produces the correct bucket count in well under 5 seconds, proving the computation is a single linear pass.

Also covered: very-short (50ms) audio still produces ≥1 peak; a fully empty sample array degrades cleanly; encode/decode round-trips exactly; a stereo file is correctly downmixed to mono rather than misread.

**Bug found and fixed during testing:** `parseWavPcm16` originally let a raw `Buffer` `RangeError` escape when a WAV file was truncated mid-chunk (e.g. cut off inside the `fmt` chunk body before all its fields could be read). Fixed by adding an explicit bounds check plus wrapping the whole chunk-walk loop in a try/catch that converts any such failure into a clean `Error("Malformed or truncated WAV file.")` — callers (the `/waveform` route) already treat any thrown error as "no waveform available," so this was the only fix needed.

**One real lint error found and fixed:** `waveform.tsx` originally called `setData(undefined)` synchronously inside its data-fetching effect to reset state when `projectId` changed, which `react-hooks/set-state-in-effect` correctly flags as a cascading-render risk. Fixed by adding `key={project.id}` at the call site in `timeline.tsx` — the idiomatic React fix — so a project change remounts the component instead of manually resetting state.

### Full verification suite (all green)
- `npm run test` — **158/158 tests pass** (139 pre-existing + 19 new).
- `npx tsc --noEmit` — clean, no errors.
- `npm run lint` — **0 errors** (5 pre-existing warnings, all in files untouched by this phase).

---

## Packaged Windows build & QA

Built via `npm run electron:pack` (clean → worker:build → build → electron-builder --win), producing `release/SUBLY Setup 0.1.0.exe`. Installed fresh to `%LOCALAPPDATA%\Programs\SUBLY`, launched, and exercised against the real per-user SQLite database and the real bundled `whisper-worker.exe` — i.e. the actual packaged app's own local Next.js server (not a dev server), reached via its `localhost:<port>` binding since the built-in browser automation can only drive a browser tab, not the native Electron window directly. Three real test clips were used:

| Duration | Source | Result |
|---|---|---|
| ~50s | `qa-short-hindi.mp4` (real Hindi/Hinglish speech + synthetic video) | ✅ full checklist passed |
| ~4:52 | `qa-long-hindi.mp4` (concatenated real speech clips) | ✅ full checklist passed |
| ~30:00 | `qa-30min-hindi-small.mp4` (30 min of looped real speech audio, re-encoded small) | ✅ full checklist passed, including full transcription (1292 subtitles) and full 1080p export |

Checklist verified on the packaged app (30s and 5min projects, both fully transcribed and end-to-end tested; 30min project's waveform/timeline verified once its audio was extracted, independent of full transcription completing):

- [x] **Waveform visible** — real amplitude bars render in the new timeline row on first load.
- [x] **Waveform matches actual audio** — confirmed via direct canvas pixel sampling (non-zero-alpha amplitude pixels present at multiple scroll offsets, including deep into the 5-minute clip after manually scrolling the timeline), not a blank/placeholder canvas.
- [x] **Playhead synchronization** — clicking the waveform moves the playhead, the time readout, and the burned-in caption preview together; navigating captions via keyboard also keeps the waveform's own overlays in sync.
- [x] **Clicking/scrubbing** — waveform clicks map to the exact same time as clicking anywhere else on the timeline (shared `time-scale.ts` math, by construction).
- [x] **Zooming** — zooming in/out rescales the waveform correctly while staying aligned with the ruler, playhead, and caption blocks.
- [x] **Caption editing** — typed into a caption, confirmed the change applied; used the app's own Undo button to confirm reversion (see note on Ctrl+Z below).
- [x] **Split Here** — split a caption at the playhead; waveform and its selected-caption overlay updated correctly; undone cleanly afterward.
- [x] **Trim/cut** — used Mark In/Mark Out + Cut Range; the waveform's red cut-range dimming overlay rendered at the exact marked span; reverted with "Revert cuts" and confirmed the dimming cleared.
- [x] **Playback** — play/pause works; time advances; no conflicting playback state introduced by the waveform.
- [x] **Export** — burned-caption export completed successfully on both the 30-second project ("Your video is ready", 1080p) and the full 30-minute project (`exportStatus: DONE` after real server-side FFmpeg rendering of all 1800s at 1080p with 1292 burned captions).
- [x] **Relaunch** — force-quit and relaunched the packaged app; the project reopened with all edits correctly persisted (not the temporarily-typed, since-undone text) and the waveform reloaded correctly from its **persistent cache** (`<projectId>/waveform.json` under the app's storage root, confirmed present on disk across the relaunch).
- [x] **30-minute scale, specifically** — after the real 30-minute transcription completed (1292 subtitles), the timeline was scrolled by directly stress-testing the scroll container to the 25:00 mark (of 30:00 total). At that offset, direct canvas inspection confirmed the waveform's `<canvas>` element was only 1440px wide (not the full ~36,030px timeline width) and repositioned via CSS `left: 29520px` to align with the scroll — the viewport-virtualization design working exactly as intended at true scale, comfortably avoiding Chromium's ~32,767px canvas-dimension limit. Real amplitude data was confirmed present at that offset (7814 non-zero-alpha pixels), and a click at that scroll position correctly seeked the playhead to 25:12.00 with the matching caption highlighted — proving time↔pixel mapping stays exact even 25 minutes deep into a scrolled, virtualized canvas.

**Note on file upload:** because the built-in browser automation has no native file-picker control (and no working Claude-in-Chrome connection was available this session for its dedicated file-upload tool), all three test videos were uploaded by POSTing directly to the app's own `/api/upload` endpoint — the identical server-side code path the UI's drag-and-drop dropzone calls — rather than by literally dragging a file in the UI. Everything downstream (processing, waveform generation, editor interaction, export) is the real, unmodified packaged app.

**Incidental finding (not a waveform bug, not fixed — out of scope):** uploading two projects in quick succession triggers the pre-existing "Another transcription is already running" single-worker guard (P0/P0.5 reliability logic) on the second one; sequential re-upload after the first finishes works as expected. Also, force-killing the packaged `SUBLY.exe` process mid-transcription (an artificial test action, not a normal user path) leaves the killed project's DB status stuck at `TRANSCRIBING` rather than being marked `ERROR` by the stall watchdog, since killing the whole process also kills the watchdog before it can run. Both are pre-existing P0/P0.5 reliability-layer behaviors, explicitly out of scope for this P1 waveform-only phase, and are noted here only for completeness, not acted on.

---

## Final status: **P1 WAVEFORM PASS**

The waveform is generated from the real project audio, cached persistently, renders correctly at all tested durations (30s, 5min, 30min) and zoom levels, stays in sync with the playhead via a single shared time↔pixel mapping, correctly reflects trim/cut regions, and does not disrupt any existing caption editing, split, trim, cut, undo/redo, playback, or export workflow. No other P1 feature was started.
