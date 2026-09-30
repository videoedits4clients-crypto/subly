# P19.6 — Timeline Ruler Virtualization & Extreme-Duration Performance

## 1. Task ID

127416

## 2. Scope

Harden the timeline ruler for very long projects: make ruler tick rendering viewport-aware (render only ticks that can affect the visible viewport + a small overscan) while preserving exact existing visual/interaction behavior — tick spacing, labels, scroll, zoom, Fit Project/Selection, click-to-seek/scrubbing, playback auto-scroll, resize, and caption virtualization. Tightly bounded — no timeline/playback redesign, no ripple/subtitle-timing changes, no schema changes. P19.4 and P19.5 are closed and were not reopened.

## 3. Phase-0 audit

Read `timeline.tsx`, `time-scale.ts`, `zoom-anchor.ts`, `fit-view.ts`, `auto-scroll.ts`, `visible-range.ts`, `waveform.tsx`, and the P19.1–P19.5 reports before writing any code. Found the exact ruler implementation and answered every Phase-0 question:

1. **Tick interval selection**: `pxPerSec > 100 ? 1 : pxPerSec > 40 ? 2 : 5` — a single inline ternary, unchanged by this task (see §5).
2. **Tick time generation**: `for (let t = 0; t < duration; t += step) marks.push(t)` — an unconditional loop from `0` to the project's own full `duration`, regardless of scroll position or viewport.
3. **Tick position calculation**: `left: t * pxPerSec` inline (mathematically identical to, but not written through, the canonical `timeToPixels` helper).
4. **Labels generated separately from tick marks?** No — one `<div>` per tick combines the mark (a `border-left`) and its label (`formatTime(t).slice(0, 5)`) in the same node.
5. **Major/minor tick tiers?** No — every tick is identical (single-tier, always labeled). No classification exists to preserve beyond "there is none."
6. **Ruler's own scroll container?** No — the ruler is `sticky top-0` (vertically pinned only) inside the SAME horizontally-scrolling track (`trackRef`) as everything else; it shares the timeline's one scroll position, it doesn't have an independent one.
7. **Absolutely positioned or normal layout?** Absolutely positioned (`className="absolute top-0 h-full ..."`).
8. **One DOM node per tick?** Yes, confirmed — exactly the P19.5 audit finding: ~1800 nodes for a 60-minute project at the 2s step, unconditionally, regardless of scroll position.
9. **Existing visible-range helper?** Yes — `lib/timeline/visible-range.ts`'s `computeVisibleTimeRange` (already computing a `[viewStart, viewEnd]` TIME range with a one-viewport-width overscan buffer on each side, for caption virtualization) is the exact right building block, reused directly rather than duplicated.
10. **Reusable?** Yes, directly — see §7.

## 4. Existing ruler architecture

Confirmed unchanged by this task except for tick generation itself (§7): the ruler's own DOM structure, styling, sticky positioning, drag-to-scrub wiring (`onPointerDown={startScrub}`), and label format are all untouched.

## 5. Tick-generation model

Extracted the pre-existing inline step-selection ternary, VERBATIM (same thresholds, same values), into a new named pure function — `computeRulerTickStep(pxPerSec)` — so it can be tested directly rather than only exercised as inline component arithmetic. This satisfies this task's own explicit "tick interval selection remains unchanged" invariant by construction: it is the same expression, just given a name.

## 6. Visible-range model

New pure function `computeVisibleTicks({ scrollLeft, viewportWidth, pxPerSec, step, duration })` in `lib/timeline/visible-range.ts` (alongside, and reusing, the existing `computeVisibleTimeRange`):

- Converts the current scroll/viewport into a time range using `computeVisibleTimeRange` — the SAME one-viewport-width overscan buffer already established for caption virtualization, not a second buffer convention.
- Clamps that range to `[0, duration]`.
- Computes the **first and last relevant tick INDEX directly** (`Math.ceil(rangeStart / step)`, `Math.floor(rangeEnd / step)`) and only then builds the small `[firstIndex..lastIndex]` array of `index * step` values — never a `0 → duration` loop, never a full-range loop followed by `.filter()`. The loop bound is proportional to the VIEWPORT (plus overscan) width in time, never to the project's own total duration.
- Tick times are produced by index multiplication (`i * step`), not by repeated addition — for the small positive integer steps this ruler always uses (1, 2, or 5), this produces bit-for-bit the same sequence of values a `t += step` accumulation loop would (confirmed by a dedicated regression test, §9), so there is no behavioral difference, only a performance one.
- Returns an empty array for a non-positive `step` or `duration` (this task's own explicit "zero/invalid duration safety" requirement) rather than guessing.

## 7. Implementation

`timeline.tsx`'s `rulerMarks` `useMemo` now depends on `[viewport, pxPerSec, rulerStep, duration]` (previously only `[duration, pxPerSec]`) and calls `computeVisibleTicks` instead of the old unconditional loop — the exact same dependency shape (`viewport`, `pxPerSec`) `visibleSubtitles` (the already-existing, already-proven caption virtualization a few lines below) already uses, not a new or second virtualization convention. The tick position JSX now goes through the canonical `timeToPixels(t, pxPerSec)` helper instead of the inline `t * pxPerSec` (mathematically identical, now visibly using the "one true" mapping every other timeline coordinate already goes through). No other part of the ruler — its DOM structure, styling, sticky behavior, or scrub wiring — was touched.

## 8. Scroll behavior

Verified (live, §14, and by test, §9): scroll at the beginning (first tick is exactly `0`), in the middle (first/last visible tick computed directly from the scrolled position, not by walking from `0`), near the end (ticks stop strictly before `duration`, never past it), and at a very deep scroll offset (150,000px into a 60-minute project) — in every case the ruler shows a small, contiguous, gap-free, duplicate-free run of ticks that exactly tracks the current viewport, with the same overscan margin `computeVisibleTimeRange` already establishes (so there is no visible "blank ruler" edge case any different from the pre-existing caption-virtualization behavior at the same boundary).

## 9. Zoom behavior

Verified at minimum zoom (`MIN_PX_PER_SEC=20` → 5s step), maximum zoom (`MAX_PX_PER_SEC=220` → 1s step), Fit Project, and Fit Selection — tick timestamps, labels, and pixel positions are exact at every level (matching P19.2/P19.3's own established reference behavior), and `currentTime` is never touched by any zoom/fit action (unchanged — ruler virtualization reads `viewport`/`pxPerSec`/`duration` only, never `currentTime`).

## 10. Resize behavior

Verified: a captions-panel resize (real drag) correctly shrank the viewport width and the ruler's own visible tick count shrank proportionally, with no stale width and no blank region. A timeline-HEIGHT resize left the horizontal tick set completely unchanged (correct — a height-only resize doesn't change viewport WIDTH, so no ruler recomputation is expected or observed).

## 11. Playback/scrub regression

P19.4 was not reopened — no playback/scrub mechanism was touched. Verified only that ruler virtualization doesn't interfere: real playback (`play()`) continued advancing `currentTime` normally with the ruler tracking a small, correct tick set throughout; a real click-to-seek and a real playhead-ruler drag (scrub) both landed on the exact expected time, unaffected by the new tick-rendering path (which reads viewport/zoom state, never `currentTime`/`seekRequest`).

## 12. Performance measurements

Live, on the exact P19.5 fixture (1800 captions, 60-minute nominal duration): ruler DOM node count went from **1800 (before this task, matching P19.5's own audit finding) to 9** on initial load, staying in the 5–12 range through every subsequent scroll/zoom/resize/playback action performed during live QA — never proportional to the full duration. Pure-function timing (`computeVisibleTicks`, automated test): sub-millisecond at 30s, 5min, 30min, 60min, and a 10-hour "extreme" synthetic duration, each returning fewer than 50 ticks regardless of scale.

## 13. Tests

`lib/timeline/__tests__/visible-range.test.ts` — 20 new tests added (existing 10 caption-virtualization tests untouched): tick-interval-step boundary values (item 1), first/last visible tick at the beginning/middle/end of a project (items 2–6), overscan (item 7), no duplicate ticks (item 8), no missing/contiguous ticks (item 9), exact timestamp preservation against the ORIGINAL accumulation-loop's own output (items 10/11), an explicit N/A note for major/minor classification (item 12, documented rather than silently skipped — no such tiering exists), minimum/maximum zoom (items 13/14), Fit Project/Fit Selection composition (items 15/16), 30s/5min/30min/60min/10h duration scaling with both a tick-count bound and a sub-5ms timing assertion (items 17–21), and zero/invalid duration+step safety (item 22). No existing test was weakened, deleted, or bypassed. Full suite: **1759/1759 passing**.

## 14. Live QA

Performed in the Claude Browser pane, entirely with REAL browser interactions (no synthetic pointer events were used anywhere in this task's own live QA — click-to-seek and scrubbing were both real mouse actions through the actual automation tool), against the existing disposable `P19.4 Long Timeline Scrub QA` fixture (1800 captions, 60-minute nominal duration, the same fixture P19.5's own audit finding was based on):

- Initial ruler: 9 DOM nodes (down from 1800), correct labels/positions (`00:00` at `0px` through `00:16` at `1120px`, exactly `t * 70`).
- Deep scroll (150,000px in): 12 ticks, contiguous, no duplicates, labels `35:36`→`35:58`.
- Zoom in (real button click): anchor preserved, tick count stayed small, step unchanged (still 2s at the resulting pxPerSec).
- Fit to Project (real button click): jumped to project start, step recalculated to 5s (hit the zoom floor for a 60-minute project), 12 ticks spanning `00:00`–`00:55`.
- Fit to Selection on a selected caption (real button click): zoomed in to 1s step, 6 ticks spanning `00:00`–`00:05`.
- Captions-panel resize (real drag): tick count shrank proportionally with the narrowed viewport, no stale width.
- Timeline-height resize (real drag): horizontal ticks completely unchanged, as expected.
- Real click-to-seek and a real playhead-ruler drag (scrub): both landed on the exact expected time.
- Real playback (`Play` button): `currentTime` advanced normally, ruler tick count stayed small (7) throughout.
- Console checked after every action: zero errors at any point in this task's own live QA session.

## 15. Limitations / NOT TESTED

- A live capture at the absolute upper end of the 10-hour "extreme duration" scale used in the automated performance tests was not performed in the browser (no such video/fixture exists); the 60-minute nominal-duration fixture was the largest live-tested scale, consistent with every prior P19.x task's own established precedent for extreme-scale verification (automated tests for the theoretical ceiling, live QA for the realistic ceiling).
- Browser/window WIDTH changes (as distinct from the in-app captions-panel/timeline-height resize handles) were not separately live-tested — the captions-panel resize already exercises the identical "viewport width changed, ruler must respond" code path (the same `ResizeObserver`-driven `viewport.width` state P19.2 already wired up), so this is considered adequately covered by that test rather than a true gap.

## 16. Protected systems

Not touched: transcription/Whisper/language handling, Gujarati ASR research, subtitle text, word timing, split/merge, ripple insert/delete, caption timing edits, caption styles, quality system, autosave, undo/redo, export/FFmpeg, Electron, database schema, and the P19.4 playback/scrubbing architecture (no change touches `seek()`, pointer-capture wiring, or `currentTime`/`isPlaying` at all). Only `lib/timeline/visible-range.ts` (two new pure functions, additive) and `timeline.tsx`'s ruler-tick rendering (one `useMemo`, one JSX line) changed.

## 17. Database

No schema changes, no migrations, no production DB modifications.

## 18. Packaging

Not required — no dependency or build-affecting change was made.

## 19. Final verification

- `npm test`: **1759/1759 passing**.
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, 5 pre-existing warnings (unchanged).
- No existing test was weakened, deleted, or bypassed.
- Version remains 0.1.17.

## 20. P19.7 recommendation

The ruler is now fully virtualized and performance-hardened; no further work is recommended on it specifically. No other performance gap was identified during this task's own Phase-0 audit. P19.7 is NOT STARTED and no assumption should be made about its scope until a real task specification is issued.
