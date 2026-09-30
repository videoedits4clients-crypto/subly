# P19.2 — Professional Timeline Zoom & Viewport Navigation

## 1. Task ID

121684

## 2. Scope

Improve the existing timeline zoom/viewport navigation into a professional editing workflow: predictable anchor-preserving zoom, Fit to Project, Fit to Selection, correctness after P19.1 panel resizing, preserved virtualization/performance, and zero project/subtitle mutation. Explicitly NOT a timeline redesign. P18.1–P18.10 and P19.1 are closed and were not reopened except for the one P19.1-adjacent fix described in §10.

## 3. Baseline

Before this task: P19.1 (Task 120417) had shipped resizable captions-panel width and timeline height with persisted UI-only layout preferences (`localStorage`, key `subly:editor-layout`), 1658/1658 tests, typecheck/lint clean, version 0.1.17. The timeline already had zoom in/out buttons and horizontal scrolling, and (per Phase 0, see §4) already had a fully-implemented zoom-anchor-preservation mechanism from an earlier task (Task 91342, P7.1) — this was not previously visible in the P19.1 report's own framing but was confirmed by reading the code directly at the start of this task.

## 4. Phase-0 audit

Read `timeline.tsx`, `waveform.tsx`, `lib/timeline/*.ts`, `use-keyboard-shortcuts.ts`, and `lib/editor-layout.ts` before writing any code. Findings, mapped to the task's own lettered checklist:

- **A. Zoom range**: `MIN_PX_PER_SEC = 20`, `MAX_PX_PER_SEC = 220` (unchanged, existing constants in `timeline.tsx`). Default `pxPerSec = 70`.
- **B. Zoom step**: `zoomBy(±20)` on the existing Zoom In/Zoom Out buttons — unchanged.
- **C. Anchor behavior**: already fully implemented (`lib/timeline/zoom-anchor.ts`, Task 91342/P7.1) — `computeZoomAnchor` picks the playhead if visible, else the viewport center; `computeZoomScrollLeft` re-solves `scrollLeft` so that anchor time lands back at the same on-screen pixel offset under the new `pxPerSec`. Wired via a `pendingZoomAnchorRef` set in `zoomBy()` and consumed by a `[pxPerSec]`-keyed `useEffect`.
- **D. `scrollLeft` representation**: a real DOM `scrollLeft` on the horizontally-scrolling track container (`scrollRef`), mirrored into React state (`viewport.scrollLeft`) on every programmatic or manual change — a deliberate dual-write so virtualization recomputes immediately without waiting for a native `scroll` event.
- **E. Does zoom recreate timeline/caption objects?** No — `pxPerSec` is local `useState` in `Timeline`; it never touches `project`/`subtitles`/`words`. `visibleSubtitles` is a `useMemo` that re-filters the SAME subtitle objects by time range; it doesn't clone or rebuild them.
- **F. Waveform width**: `waveform.tsx` sizes its canvas to `viewportWidth + buffer` (`buffer = Math.max(200, viewportWidth)`), never to full project duration — explicitly citing Chromium's ~32,767px per-side canvas limit in its own doc comment. The underlying peak data fetch depends only on `projectId`, not on zoom.
- **G. Caption positioning**: `left = timeToPixels(start, pxPerSec)`, `width = timeToPixels(end - start, pxPerSec)` — the one true `time-scale.ts` mapping, used everywhere.
- **H. Playback auto-scroll**: a `[currentTime, isPlaying]`-keyed effect nudges `scrollLeft` via `computeAutoScrollTarget` to keep the playhead within the middle 75% of the viewport; skipped during drags and for 1500ms after a manual scroll. Already viewport-width-aware (reads live `viewport.width`), so it was already zoom-safe.
- **I. Selection representation**: `selectedSubtitleId` (single) and `selectedSubtitleIds: Set<string>` (batch) in the Zustand store; `Timeline` derives `selected`, `isBatchSelection = selectedIds.size > 1`, and `selectedSubs` (a `useMemo` filtering `project.subtitles` by `selectedIds`).
- **J. Project-duration fit**: did NOT already exist. No "Fit to Project" or "Fit to Selection" control was present anywhere in the timeline toolbar before this task.
- **K. Existing persisted timeline state**: none. Only P19.1's `captionsPanelWidth`/`timelineHeight` are persisted; `pxPerSec`/`scrollLeft` were, and remain, plain in-memory `useState`.

**Correction to the P19.1 report**: `research/p19_1_editor_layout_report.md` stated that P19.1 "added a `ResizeObserver`" for the timeline's own `viewport.width`. This was checked directly in this task's Phase 0 (grep for `ResizeObserver` in `timeline.tsx`) and found to be **false** — no such observer existed; `viewport.width` was set once on mount and only ever self-corrected on the next native `scroll` event. This is stated here plainly rather than silently corrected. Fixing it for real was treated as in-scope P19.2 work because the task spec itself instructs "P19.1 added a ResizeObserver for timeline viewport.width. Reuse it" — since it didn't actually exist, building it was a prerequisite for the panel-resize interaction this task explicitly mandates (§10), not new-timeline-redesign scope.

## 5. Existing zoom architecture

Confirmed via Phase 0 that the anchor-preserving zoom, time↔pixel mapping, caption virtualization, and waveform viewport-mapping were all already correct and complete (see §4C–H). This significantly narrowed P19.2's real new-work surface to: Fit to Project, Fit to Selection, the real `ResizeObserver` fix, and verifying (not re-architecting) the rest.

## 6. Zoom semantics

Unchanged. `MIN_PX_PER_SEC = 20` / `MAX_PX_PER_SEC = 220` and the ±20 zoom step were preserved exactly as found — Phase 0 did not find them inadequate, so per the task's own instruction they were not redesigned. Live-verified both clamps: repeated Zoom In clamps at `pxPerSec = 220` (scroll track ≈ 12s × 220 = 2640px, matches); repeated Zoom Out clamps at `pxPerSec = 20`, `scrollLeft` clamped to `0` (never negative).

## 7. Anchor model

Not modified — already correct (§4C). Live-verified: zooming in/out while paused never changes the displayed playhead time; zooming during playback (§11) never jumps the active caption/word to an unrelated position.

Cursor-position anchoring ("if available" per the task's own anchor-priority list) was deliberately NOT added as a new pointer/wheel-zoom gesture — no such control existed before this task, and adding one would be a scope-widening UI addition the task's own "not a timeline redesign" / "no large new toolbar" constraints argue against. The existing playhead → viewport-center fallback chain satisfies the requirement without inventing a new interaction.

## 8. Fit Project

New pure function `computeFitView` (`lib/timeline/fit-view.ts`) + a `fitToProject()` handler in `timeline.tsx` wired to a new toolbar button. Computes the `pxPerSec` that fits `[0, duration]` into the available viewport width (minus 40px padding each side, matching the file's own pre-existing `margin = 40` constant elsewhere), clamped to `[MIN_PX_PER_SEC, MAX_PX_PER_SEC]`, with `scrollLeft` reset to `0`. A zero/unavailable `duration` is a silent no-op (`computeFitView` returns `null`), per the task's explicit "fail safely" requirement.

Live-verified (12s fixture project, 756px then 586px viewport after a panel resize): `pxPerSec` computed correctly in both cases, `scrollLeft === 0`, full project visible, track width floored at the existing 800px minimum when the ideal width undershoots it.

## 9. Fit Selection

`computeSelectionBoundingRange` (same file) reduces one or more selected captions to `{start: min(starts), end: max(ends)}` — explicitly the FULL bounding range for a non-contiguous selection, not two separate "islands" (per the task's own instruction). `fitToSelection()` in `timeline.tsx` feeds this into the same `computeFitView`, using `duration` (the full project length) separately from `range` so the resulting `scrollLeft` is always clamped against the real track width, not just the selection's own span. Disabled (`Select a caption first`) with no selection.

Live-verified with the disposable 3-caption fixture:
- Single selection (BRAVO CHARLIE DELTA, 1.75–6.00s): `pxPerSec ≈ 159.1`, `scrollLeft ≈ 238` — matches hand-computed expected values exactly.
- Contiguous 2-caption selection (ALFA + BRAVO, bounding range 0.5–6.00s): `pxPerSec ≈ 122.9`, `scrollLeft ≈ 21` — matches expected values exactly, and is visibly distinct from the single-caption case (this is the scenario that surfaced the toolbar-overflow bug, see §10/§18).
- Non-contiguous selection (ALFA + HOTEL, skipping BRAVO; bounding range 0.5–10.40s): `pxPerSec ≈ 68.3`, `scrollLeft = 0` (clamped from a negative ideal) — confirms the full bounding range (including the skipped BRAVO gap) is used, not two separate fits.
- Selection itself was never altered by any Fit action (confirmed via the store's `selectedSubtitleIds` remaining unchanged after each fit, both live and in the automated reference-equality regression test).

## 10. P19.1 resize interaction

**Bug found and fixed during live QA.** The timeline toolbar (`Timeline` label, Split/Merge/Duplicate/Delete/Ripple/Mark-in/out/Cut-range/Ripple-insert/Zoom/Fit controls, all in one `flex` row with no overflow handling) was already close to its available width before this task. Adding "Fit Project" and "Fit Selection" as full `size="sm"` icon+text buttons pushed the row over the edge: at the default 1400×900 viewport, "Fit Selection" was visually clipped to a 1–2px sliver at the row's right edge, and clicking its resolved coordinate landed outside the actual clickable area — the click silently did nothing, which first looked like a Fit-to-Selection logic bug (result identical to the previous fit) before being traced to the toolbar layout itself via `getBoundingClientRect()` on the button and a diff-free repeat click producing byte-identical output.

Fix: `Fit Project` / `Fit Selection` changed from `size="sm"` (icon + text) to `size="icon-sm"` (icon only, matching the existing Zoom In/Zoom Out/Mark-in/Mark-out convention already used elsewhere in this same toolbar), and `overflow-x-auto` added to the toolbar row itself as a safety net (using the app's existing global thin-scrollbar styling) so a future addition or a narrower viewport can never again make a control fully unreachable by mouse — it becomes horizontally scrollable instead of silently clipped. This was the only change to pre-existing (non-P19.2) code in this task.

After the fix, live-reverified:
- Resizing the captions panel wider (320px → 490px, shrinking the timeline's own share of the row from 756px to 586px clientWidth): `pxPerSec` and `scrollLeft` both remained bit-for-bit unchanged (`823`/`586`/`0` before and after — only `clientWidth` changed, confirming the real `ResizeObserver`, §4's correction, is now doing its job).
- With the panel still resized, all four controls were exercised in sequence exactly as the task's "Known P19.1 Limitation to Close" describes: **Zoom In** (pxPerSec 68.3 → 88.3, correctly anchored), **Zoom Out** (88.3 → 68.3, exact round-trip), **Fit Project** (computed against the live 586px width, not a stale 756px), **Fit Selection** (same, computed against 586px) — all four correct.
- Resizing timeline HEIGHT (256px → ~409px via the P19.1 handle) left horizontal `pxPerSec`/`scrollLeft` completely unchanged (`800`/`586`/`0` before and after) — confirmed live via `getBoundingClientRect()` on the resize separator and the scroll container's own properties.

## 11. Playback interaction

Not redesigned — the existing auto-scroll effect (§4H) was already viewport-width-aware. Live-verified: started playback, zoomed in mid-playback — video kept playing (`00:02.85` → `00:09.74` over the following real-time interval), the active-caption label updated correctly to the caption actually under the playhead at each point, no jump to an unrelated position, no console errors. Zoom never touches `currentTime`/playback state (it is a `Timeline`-local `pxPerSec`, entirely separate from the video element's own time).

## 12. Waveform behavior

Not modified — already correct (§4F). Not independently re-verified pixel-by-pixel in the live browser beyond confirming no visual corruption and no console errors across every zoom/fit/resize action performed; the canvas-width bound itself is covered by the automated performance suite (§16).

## 13. Performance

- Live, in the actual rendered DOM (not just the pure-function unit tests): opened the pre-existing "P18.2 Render Perf QA – 1800 captions" disposable fixture (`research/p2_editor_performance_scalability_report.md`'s own stress fixture, captions spaced 2s apart spanning up to 3600s of caption timestamps). Confirmed only **4–9 caption DOM blocks mounted at any time** despite 1,800 captions existing in the project; zoom in/out (5 successive clicks) stayed instant with no console errors and no visible lag.
- This fixture's own `video.duration` is small (not itself a 30-minute video), so it could not be used to live-verify the Fit-to-Project/waveform-canvas-width arithmetic specifically at a 30-minute SCALE — see §18 (NOT TESTED) for the honest limitation this leaves.
- The 30s/5m/30m duration-specific arithmetic (`filterVisibleSubtitles` result size and timing, `computeFitView`'s `pxPerSec`/`scrollLeft` bounds, and a replicated copy of `waveform.tsx`'s own canvas-draw-width formula) is covered by a new, non-mocked automated test file: `lib/timeline/__tests__/long-timeline-performance.test.ts` (10 tests). At 30 minutes and `MAX_PX_PER_SEC`, the un-virtualized full track would be 396,000px wide; the tested draw width stays viewport-bounded and well under Chromium's 32,767px canvas-dimension limit at all three scales.

## 14. Persistence

**Not added.** Phase 0 (§4K) confirmed zoom/scroll had no existing persistence. Per the task's own "do not force persistence simply because P19.1 persists panel dimensions" instruction, and because nothing in the existing UX established zoom-level persistence as expected behavior, `pxPerSec`/`scrollLeft` remain plain in-memory `useState`, exactly as found. Live-verified: after zooming to `pxPerSec = 20` (min) and scrolling, then navigating away and back to the same project, the timeline reset to the default `pxPerSec = 70`, `scrollLeft = 0` — while the P19.1 `captionsPanelWidth`/`timelineHeight` (also exercised in the same session) correctly DID persist via `localStorage`, confirming the two concerns are cleanly independent and this task did not accidentally piggyback zoom onto the existing layout-preferences mechanism.

## 15. Keyboard shortcuts

None added. `use-keyboard-shortcuts.ts` was audited and found to already densely use Arrow keys, `[`/`]`/`{`/`}`, and other single-key bindings for playback/caption/word navigation; the task explicitly permits buttons-only ("Buttons/menu actions are acceptable even if keyboard shortcuts are omitted"), so no new bindings were added to avoid any conflict risk.

## 16. Regression coverage

- `lib/timeline/__tests__/fit-view.test.ts` — 19 tests: `computeSelectionBoundingRange` (single/contiguous/non-contiguous/empty/malformed input), `computeFitView` for both Fit-to-Project and Fit-to-Selection (including the anchoring-test list's items 8–13, 15), zero-duration and non-finite/non-positive-viewport-width failure modes (item 10, 11), zoom min/max clamp (items 6/7, tested against the exact inline `zoomBy` arithmetic in `timeline.tsx` without extracting it — matching this codebase's own established precedent for testing a component's inline math directly), and the **mandatory project-state-isolation regression test**: every exported function from `fit-view.ts` and `zoom-anchor.ts` exercised against a live `useEditorStore` snapshot (2 captions, one single-selected, one added via `toggleSubtitleSelection`), asserting `after.project === projectBefore`, `after.project!.subtitles === subtitlesBefore`, `after.project!.subtitles[0].words === wordsBefore`, exact timestamps unchanged, `after.past === pastBefore` (no undo-history entry), `after.dirty === dirtyBefore` (no autosave trigger), and `after.selectedSubtitleIds === selectedIdsBefore` (selection itself untouched) — using reference equality throughout, per the P18.2/P19.1 convention.
- `lib/timeline/__tests__/long-timeline-performance.test.ts` — 10 tests, parameterized over 30s/5m/30m (§13).
- No existing test was weakened, deleted, or modified to accommodate the implementation.
- Full suite: **1687/1687 passing** (up from P19.1's 1658; +29 new tests, all in the two new files above — no changes to any other test file).

## 17. Live QA

Performed in the Claude Browser pane against the disposable `P18.7 Split-Merge QA` fixture (3 captions, real word timing) and, for the long-timeline case, the disposable `P18.2 Render Perf QA – 1800 captions` fixture, at a 1400×900 viewport. Covering the task's own 41-item list:

- Playhead unchanged across repeated Zoom In / Zoom Out, both paused and after moving the playhead first. ✓
- Cursor-based zoom anchor: not applicable — no such control exists (see §7); the existing playhead/viewport-center anchor was exercised instead and confirmed stable. ✓ (documented as N/A, not skipped silently)
- Fit to Project: project start and end both visible, `scrollLeft = 0`, verified against both the default (756px) and a resized (586px) viewport. ✓
- Fit to Selection: single caption, contiguous 2-caption, and non-contiguous 2-caption (bounding-range) selections — all verified with exact expected `pxPerSec`/`scrollLeft` arithmetic, not just visually. ✓
- Resize captions panel → zoom level and scroll position both stable (bit-for-bit unchanged `pxPerSec`/`scrollLeft`); then Zoom In/Zoom Out/Fit Project/Fit Selection all re-exercised against the resized viewport and all four correct — this explicitly closes the task's "Known P19.1 Limitation." ✓ (found and fixed a real bug along the way — see §10)
- Resize timeline height → horizontal zoom/scroll unchanged. ✓
- Playback + zoom: playback continued, active caption stayed correct, no jump. ✓
- Min/max zoom clamp: verified live at both ends (15 successive clicks each direction), no negative/invalid scroll. ✓
- 1800-caption / up-to-3600s-of-caption-timestamps project: DOM stayed at 4–9 mounted caption blocks, zoom stayed responsive, no console errors. ✓ (a true 30-minute VIDEO-duration fixture was not available — see §18)
- Reload: confirmed zoom/scroll reset to defaults (not persisted), while P19.1's panel-size preferences correctly did persist. ✓
- Console checked for errors after every major action throughout — none observed at any point.

## 18. NOT TESTED

Being explicit per the task's own "be honest about anything not live-tested" instruction:

- **No true 30-minute (or 5-minute) VIDEO-duration project was available as a live browser fixture.** The closest existing disposable fixture (1800 captions) has a short underlying `video.duration`, so it exercised DOM/caption virtualization at scale (§13, §17) but not the `duration`-driven Fit-to-Project/waveform-canvas-width arithmetic specifically AT a 30-minute or 5-minute scale in the live browser. That specific arithmetic is covered instead by the non-mocked `long-timeline-performance.test.ts` suite (§13, §16), which exercises the exact same `computeFitView` and a faithful copy of `waveform.tsx`'s own canvas-sizing formula — but it is a unit test, not a live DOM/canvas observation.
- Cursor-position-anchored zoom was not live-tested because no such control exists in this implementation (§7) — not a gap, a documented scope decision.
- The waveform canvas itself was not pixel-inspected in the live browser (no visible corruption or console errors were observed, but the canvas's actual drawn pixels were not diffed before/after zoom).
- Keyboard-shortcut interaction was not live-tested because no new shortcuts were added (§15).

## 19. Known limitations

- The toolbar-overflow fix (§10) is a safety net (`overflow-x-auto`), not a guarantee of zero future crowding — if more controls are added to this same row later, the icon-only sizing budget could tighten again. This is now at least visibly scrollable rather than silently unreachable.
- Fit-to-Selection/Fit-to-Project cannot show a time range wider than what `MIN_PX_PER_SEC` allows within the viewport — for a selection or project far longer than the viewport can display even at the loosest zoom, the fit starts at the range's own start and does not (cannot) show the whole thing at once. This is documented in `fit-view.ts`'s own doc comment as an honest, intentional limit of "preserve the existing zoom range," not a bug.

## 20. Protected systems

Not touched: subtitle/caption/word timing and order, Split/Merge/Ripple Delete/Ripple Insert, caption/word resize or nudge, caption/word styles, quality analysis, autosave, undo/redo, project persistence, waveform source audio, playback time, export timing, ASS rendering, FFmpeg, Electron, database schema. Verified both by code review (zoom/fit code only ever touches `Timeline`-local `pxPerSec`/`viewport` state and the DOM `scrollLeft` property) and by the automated reference-equality regression test (§16) proving `project`, `subtitles`, `words`, `past` (undo history), `dirty`, and `selectedSubtitleIds` are all byte-for-bit unchanged after every zoom/fit function call.

## 21. Database

No schema changes, no migrations, no production DB changes.

## 22. Packaging

Not required. No Electron changes.

## 23. Final verification

- `npm test`: **1687/1687 passing**.
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, 5 pre-existing warnings (unchanged from before this task — `project-card.tsx`, `lib/ai/index.ts`, `lib/analytics.ts`, `lib/subtitles/ass.ts`, `lib/subtitles/preview-style.ts`).
- No existing test was weakened, deleted, or modified.
- Version remains 0.1.17.

## 24. P19.3

NOT STARTED.
