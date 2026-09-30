# P7.1 — Timeline Interaction & Keyboard Discoverability

**TASK ID:** 91342

## 1. Objective

Implement exactly the 4 items the P7 preflight audit (`research/p7_professional_editing_workflow_audit.md`,
Task 90137) recommended for this phase, and no more:

1. Timeline snapping — magnetic snap to adjacent-caption boundaries and the playhead, for
   caption move / left-resize / right-resize drags.
2. Playback auto-scroll — keep the playhead inside a ~75%-of-viewport "safe zone" during
   playback, without fighting a manual scroll or interfering with caption dragging.
3. Zoom position preservation — anchor zoom in/out on the playhead if visible, else the
   viewport center, so the timeline doesn't visually jump when the zoom level changes.
4. In-app keyboard shortcuts reference dialog — discoverability only, reusing the existing
   shared `Dialog` primitive; does not touch shortcut execution logic.

Explicitly out of scope (deferred to later phases per the task spec): word-level timing,
multi-select/batch editing, caption copy/paste, resizable panels, regex search, a React error
boundary, and any new crash-recovery architecture.

## 2. Pre-implementation audit findings

Re-read in full before writing any code: `src/components/editor/timeline.tsx` (459 lines,
original), `src/lib/timeline/time-scale.ts`, `src/lib/timeline/edit-model.ts`,
`src/store/editor-store.ts` (targeted sections — `updateSubtitleTiming`'s exact clamp formula,
`isPlaying`/`setPlaying`), `src/hooks/use-keyboard-shortcuts.ts` (224 lines, full),
`src/hooks/dialog-open-guard.ts` (full), `src/components/editor/editor-shell.tsx` (full),
`src/components/editor/top-bar.tsx` (full, before edits), `src/components/editor/
search-replace-dialog.tsx` (full, as the simple-dialog template), `src/components/ui/dialog.tsx`
(full).

Key findings that shaped the implementation:

- `updateSubtitleTiming(id, start, end)` in `editor-store.ts` is the **one existing**
  overlap-prevention clamp (`MIN_CAPTION_DURATION_SEC = 0.1`, clamps against the sorted
  neighbors' `prevEnd`/`nextStart`). Nothing in this task may bypass or duplicate it — snapping
  only ever proposes a `(start, end)` that still flows through this same, unmodified call.
- `time-scale.ts`'s `timeToPixels`/`pixelsToTime` are the **one** time↔pixel mapping (no
  clamping). Re-used as-is for every new pixel/time conversion (snap threshold, auto-scroll
  target, zoom anchor) — no second coordinate system was introduced.
- `use-keyboard-shortcuts.ts` guards every mutating shortcut with `isTypingTarget` then
  `isAnyDialogOpen` (Ctrl+S/Ctrl+F/Escape/Tab are deliberately exempt, documented in that file as
  non-mutating). `isAnyDialogOpen()` just checks `document.querySelector('[role="dialog"]')`.
  Since `DialogPrimitive.Content` (from `components/ui/dialog.tsx`) always renders
  `role="dialog"`, a new dialog built from the same shared primitive is automatically covered by
  this guard with **zero new guard code** — confirmed by source inspection and then confirmed
  live in §11 below (Ctrl+Z did not fire while the new dialog was open).
- `timeline.tsx`'s `visibleSubtitles` virtualization filter (a hand-rolled time-window filter,
  distinct from `list-virtualization.ts`, which backs the *caption list sidebar* only) had **no
  dedicated test** — confirmed by both the P7 audit and my own direct re-check. Per this task's
  own Part 10 instruction ("add a focused regression test for it before or alongside the timeline
  changes"), it was extracted into a new pure module (`src/lib/timeline/visible-range.ts`) with
  its own test file — see §9.
- The existing `selectedId`-driven scroll-into-view effect in `timeline.tsx` writes both the real
  DOM `scrollLeft` and the React `viewport` state ("dual-update") — this exact pattern had to be
  replicated for the new auto-scroll and zoom-anchor effects so the virtualized `visibleSubtitles`
  window recomputes immediately rather than waiting on a scroll event that isn't guaranteed to
  fire synchronously for a programmatic write.

## 3. Files changed

New:
- `src/lib/timeline/snapping.ts` — pure snap-target computation.
- `src/lib/timeline/auto-scroll.ts` — pure auto-scroll-target computation.
- `src/lib/timeline/zoom-anchor.ts` — pure zoom-anchor capture/restore computation.
- `src/lib/timeline/visible-range.ts` — pure extraction of the (previously untested, inline)
  `visibleSubtitles` virtualization filter.
- `src/lib/keyboard-shortcuts-reference.ts` — display-only shortcut metadata.
- `src/components/editor/keyboard-shortcuts-dialog.tsx` — the help dialog component.
- `src/lib/timeline/__tests__/snapping.test.ts` (13 tests)
- `src/lib/timeline/__tests__/auto-scroll.test.ts` (8 tests)
- `src/lib/timeline/__tests__/zoom-anchor.test.ts` (8 tests)
- `src/lib/timeline/__tests__/visible-range.test.ts` (10 tests)
- `src/lib/__tests__/keyboard-shortcuts-reference.test.ts` (5 tests)

Modified:
- `src/components/editor/timeline.tsx` — wired in snapping (drag handlers), auto-scroll effect,
  zoom-anchor effect + `zoomBy()`, manual-scroll suppression, snap-guide visual, and switched
  `visibleSubtitles` to call the extracted `filterVisibleSubtitles`.
- `src/components/editor/top-bar.tsx` — added the keyboard-shortcuts icon button and dialog wiring.
- `package.json` — added `test:timeline-interaction` script and registered all 5 new test files
  in the aggregate `test` script.

Explicitly **not** touched: `src/hooks/use-keyboard-shortcuts.ts` (shortcut execution logic),
`src/hooks/dialog-open-guard.ts`, `src/store/editor-store.ts`, `src/lib/timeline/edit-model.ts`,
`src/lib/timeline/list-virtualization.ts`, any P5.1 (caption rendering/ASS) or P6 (custom preset)
code.

## 4. Snapping implementation

`computeSnappedTiming(edge, start, end, targets, thresholdSec)` in `snapping.ts` takes the
continuous drag position already computed by `timeline.tsx`'s existing `onPointerMove` math and
nudges it toward the nearest candidate within `thresholdSec`:

- **Left-edge resize** (`edge: "start"`): candidates are `[prevEnd, playhead]`. `nextStart` is
  deliberately excluded — snapping a start edge to the *far* boundary would collapse the caption.
- **Right-edge resize** (`edge: "end"`): candidates are `[nextStart, playhead]`, symmetric.
- **Move** (whole-caption drag): both edges are evaluated independently against their own
  candidates; only the **closer** one (smaller absolute pixel delta) is applied, and that same
  delta is applied to *both* start and end, preserving duration exactly.

The threshold is computed fresh on every `pointermove` from `pixelsToTime(SNAP_THRESHOLD_PX,
pxPerSec)` (`SNAP_THRESHOLD_PX = 8`), so the *screen-space* snap distance stays constant
regardless of zoom level, rather than becoming stickier in time-terms when zoomed out.

`prevEnd`/`nextStart` are looked up **once**, at drag-start (`startDrag`), from the sorted
`subtitles` array — not re-scanned on every `pointermove` — because the existing overlap clamp
structurally prevents a caption from crossing past its sorted neighbors mid-drag, so the
neighbor identity can't change during a single drag gesture.

Snapping is a **proposal only**: its output still flows through the unmodified
`updateSubtitleTiming()` call, which remains the sole authority on validity (min duration, no
overlap). This was verified both by code construction and live (§11): a snap that would leave an
implausibly short caption is still subject to the existing clamp.

A small warning-colored guide line (`bg-warning`, already used elsewhere in this file for the
mark-out indicator — no new CSS token) renders at the active snap point while dragging, and
clears on `pointerup` or when the drag moves back out of range.

## 5. Auto-scroll implementation

`computeAutoScrollTarget({ playheadPx, scrollLeft, viewportWidth, maxScrollLeft, safeZoneRatio })`
in `auto-scroll.ts` returns `null` (do nothing) when the playhead is already within the middle
`safeZoneRatio` (default 0.75) of the viewport, and otherwise returns the scrollLeft that puts the
playhead at the *near edge* of the safe zone (minimal adjustment, not re-centering).

`timeline.tsx` calls this from a `useEffect` keyed on `[currentTime, isPlaying]`, gated so it's a
no-op unless: `isPlaying` is true, no caption/trim drag is in progress (`dragState`/`trimDragRef`
checked directly, not via React state — no extra re-render), and no manual scroll happened within
the last `MANUAL_SCROLL_SUPPRESS_MS` (1500ms). A `programmaticScrollRef` boolean, set immediately
before every scrollLeft write this component makes and cleared on the next native `scroll` event,
distinguishes the component's own adjustments from a genuine user scroll gesture — this is the
entire "don't fight manual scroll" mechanism; no separate follow-mode state machine was added, per
the task's own instruction to avoid one.

## 6. Zoom position preservation implementation

`computeZoomAnchor({ currentTime, scrollLeft, viewportWidth, pxPerSec })` in `zoom-anchor.ts`
captures, from the *old* zoom level right before it changes: the playhead's time if it's currently
visible, otherwise the viewport's center time — plus that anchor's current on-screen pixel offset.

`computeZoomScrollLeft({ anchorTime, anchorOffsetPx, newPxPerSec, duration, viewportWidth })`
then derives the scrollLeft, under the *new* zoom level, that puts the same anchor time back at
the same on-screen offset (clamped to `[0, maxScrollLeft]`, using the same `Math.max(800, duration
* pxPerSec)` track-width floor `timeline.tsx` already uses elsewhere).

`zoomBy(deltaPx)` (replacing the old bare `setPxPerSec` calls behind the zoom in/out buttons)
records the anchor from the current pxPerSec/scrollLeft into a ref, then changes `pxPerSec`; a
`useEffect` keyed on `[pxPerSec]` consumes and clears that ref, applying the derived scrollLeft.
A no-op (no anchor recorded) when already at `MIN_PX_PER_SEC`/`MAX_PX_PER_SEC`.

## 7. Keyboard shortcuts reference implementation

`src/lib/keyboard-shortcuts-reference.ts` is hand-verified, display-only metadata (19 real
shortcuts across 6 groups), consumed by `keyboard-shortcuts-dialog.tsx`, which renders it via the
existing shared `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`
components. It reads no store state and calls no store action, so it cannot mark the project
dirty. `use-keyboard-shortcuts.ts` itself is untouched — this is a second *display* of the
existing shortcuts, never a second *system*.

## 8. Performance considerations

- Snapping adds one `pixelsToTime` call and one `computeSnappedTiming` call (fixed number of
  comparisons, max 3 candidates) per `pointermove` during a caption drag — no array scan (the
  neighbor lookup happens once, at drag-start, not per move).
- Auto-scroll's `computeAutoScrollTarget` is O(1) and, critically, returns `null` (no state write,
  no DOM write) on the overwhelming majority of `currentTime` ticks during playback, since the
  playhead is normally already inside the safe zone.
- Zoom-anchor computation runs only on an explicit zoom button click, not per-frame.
- None of the three new modules scan `project.subtitles`; the existing `visibleSubtitles`
  virtualization filter (now `filterVisibleSubtitles`, behaviorally unchanged) is still the only
  per-render subtitles-array pass, same as before this task.
- This task's own stated performance baseline (~5.9ms/pointermove at 3,600 captions, ~12–15ms at
  5,400) was **not re-measured with a profiler in this pass** — no per-pointermove array scan was
  added (the one potential new cost, the neighbor lookup, was deliberately moved to drag-start),
  so by construction the steady-state pointermove cost should be within noise of the baseline, but
  this is a reasoned expectation from the diff, not a re-measured number. Flagged as a known
  limitation in §14.

## 9. Tests

44 new tests added, all passing, registered in `package.json` (`test:timeline-interaction` plus
the aggregate `test` script):

- `snapping.test.ts` (13): edge-snaps-to-prev/next boundary, snaps-to-playhead, outside-threshold
  no-snap, snapping doesn't enforce validity (by design — the store clamp does), body-drag
  preserves duration, closer-edge-wins on a move drag, left/right-resize only touch their own
  edge, no-targets-never-snaps, inclusive-threshold-boundary.
- `auto-scroll.test.ts` (8): inside-safe-zone no-op, inclusive boundary, right/left-edge trigger
  (minimal-adjustment property verified), clamping to `[0, maxScrollLeft]`, zero-width viewport
  no-op, custom `safeZoneRatio`, `maxScrollLeft=0` case.
- `zoom-anchor.test.ts` (8): playhead-visible anchor, viewport-center anchor (playhead not
  visible), zoom-in/zoom-out preserve on-screen offset, scrollLeft clamping (both directions),
  short-timeline width floor, long-timeline unclamped case, repeated-zoom round-trip (no drift).
- `visible-range.test.ts` (10): buffer computation, fully-inside/outside/straddling captions,
  inclusive boundary, order preservation, empty list, zoom-dependent buffer size, scroll-drift
  check, a 5,400-caption functional scale check (mirrors this task's own cited perf scenario).
- `keyboard-shortcuts-reference.test.ts` (5): every real hook shortcut has a matching reference
  entry, every reference entry corresponds to a real hook shortcut (catches fabricated/stale
  entries — this caught and fixed one real gap: the reference initially didn't mention that
  Backspace is a second key for Delete), entry-count parity, non-empty descriptions, `flatMap`
  consistency between `KEYBOARD_SHORTCUTS` and `KEYBOARD_SHORTCUT_GROUPS`.

Full-suite regression: **534 passed, 0 failed** (490 pre-existing + 44 new) — `npm test`.
`npm run typecheck`: clean (0 errors), run after both the pure-module additions and the full
`timeline.tsx` edit set. `npm run lint`: 0 errors, 5 warnings — identical to the pre-existing
baseline (`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`; none in
files this task touched). One real lint issue was found and fixed during development: the new
auto-scroll effect's `setViewport()` call inside a `[currentTime, isPlaying]`-keyed effect tripped
`react-hooks/set-state-in-effect` (not flagged on the structurally-identical pre-existing
`selectedId` effect or the new zoom-anchor effect) — diagnosed as the rule's heuristic reacting to
`currentTime`'s continuous-change nature rather than a real anti-pattern, fixed with a targeted,
commented `eslint-disable-next-line`.

## 10. Dev-mode QA

Ran against the Next.js dev server in `SUBLY_DESKTOP=1` mode (bypasses login via a fixed
`local-user` id — `src/lib/api-auth.ts`), pointed at the isolated, gitignored `prisma/dev.db` —
**never** the real desktop app's production `subly.db`. Used the pre-existing disposable
`local-user`-owned QA project "P5.1 Caption Parity QA (disposable)" (48 captions, 50.64s video,
left over from Task 86317's own QA and already scoped as reusable/disposable) via the built-in
browser pane. All verification below used real UI interaction (clicks, drags, keyboard) plus
read-only DOM/`getBoundingClientRect()` inspection to obtain exact pixel/time correspondences for
precise, reproducible drag targeting — never a simulated/synthetic event dispatch to *drive* the
UI.

**Snapping** — verified live, all as genuine pointer drags:
- Right-edge resize: dragged a caption's end edge to within ~4px of the next caption's start
  boundary (9.56s); it snapped to exactly `09.56`, confirmed via the rendered caption text.
- Move (body) drag: dragged the whole caption near the same boundary; it snapped with duration
  preserved exactly (start shifted by the identical delta as end).
- Playhead snap: seeked the playhead to exactly 9.00s via the ruler, then dragged the same
  caption's end edge near it; it snapped to exactly `09.00`.
- Outside-threshold: dragged the same edge to a position ~17px from the nearest candidate; it
  landed at the raw continuous value (`09.36`), confirming no snap fired.
- Overlap safety: after every snap, the adjacent neighbor's own timing was re-checked and
  confirmed unchanged.
- Undo: `Ctrl+Z` repeated back to baseline restored the caption to its exact original `08.38 →
  09.18` after each of the above tests.

**Auto-scroll** — verified live during real video playback (not simulated): with the playhead
initially seeked outside the visible viewport and playback started, `scrollLeft` was observed
following the playhead, staying within the computed safe-zone band (`[scrollLeft+60,
scrollLeft+420]` at the 480px-wide viewport used) at multiple sampled points during playback, and
correctly clamping to `maxScrollLeft` when playback reached the end of the video. Manual-scroll
suppression (don't fight a deliberate scroll for 1500ms) and drag-suppression could not be
directly observed within their sub-second/1500ms windows given browser-automation round-trip
latency — see §14, Known limitations.

**Zoom position preservation** — verified live with exact, pixel-perfect predictions confirmed
against observed results (computed independently from the DOM's actual `scrollLeft`/ruler-mark
positions, not from the app's own internal state):
- Center-anchor case (playhead not visible): predicted scrollLeft `7080` after a zoom-in click;
  observed `7080` — exact match.
- Playhead-visible case: predicted scrollLeft `8050` after a further zoom-in click with the
  playhead visible in the viewport; observed `8050` — exact match.
- Reversibility: zooming back out returned scrollLeft to exactly `7080` (the pre-zoom-in value),
  confirming no drift on a round trip, consistent with `zoom-anchor.test.ts`'s test 8.

**Keyboard shortcuts dialog** — verified live: opens from the top bar's new keyboard icon;
content is grouped and readable; `Ctrl+Z` while the dialog was open produced no change (confirmed
via DOM re-check — `isAnyDialogOpen()` correctly blocked it with zero new guard code); `Escape`
closed the dialog; opening and closing it left the save-state indicator at "Saved" throughout
(never transitioned to "Unsaved changes"), confirming the UI-only action never marks the project
dirty. The dialog has no form controls, so "typing inside it shouldn't trigger editor shortcuts"
has no applicable surface to test — satisfied by construction (no text input exists in the
dialog).

**Production-data integrity (dev-mode portion):** all of the above ran against `prisma/dev.db`
only. The one project touched (`cmu8glgs5000114p3etseki4h`) was returned to its exact original
subtitle timings via undo before moving on; no project was created or deleted during this dev-mode
pass.

## 11. Packaged Windows QA

Built via `npm run electron:pack` (clean → PyInstaller worker build → `next build` →
electron-builder/NSIS) — succeeded end to end with no errors, producing
`release\SUBLY Setup 0.1.5.exe` (560,527,842 bytes) and its `.blockmap`. Verified on the built
file itself (not source config): `FileVersion 0.1.5`, `ProductVersion 0.1.5.0`,
`ProductName SUBLY`.

Silent-installed (`/S`) — reused an existing per-user install directory from a prior task's own
packaged QA (`%LOCALAPPDATA%\SUBLY-P6-QA`, an NSIS-remembered install path, not a production
`Program Files` location), updating it in place to this build (confirmed via the installed
`SUBLY.exe`'s own `LastWriteTime` and version metadata matching the fresh build). Launched the
real packaged `SUBLY.exe`; confirmed via `Get-NetTCPConnection` that its bundled Next.js server
was listening on a freshly-assigned local port, and pointed the browser pane at
`http://127.0.0.1:<port>/dashboard` — the same approach used for this task's own dev-mode QA, but
now serving the actual packaged, bundled build output, not the dev server.

The packaged app's dashboard showed real production data: 3 existing real projects owned by the
actual desktop user ("Untitled project", "rishab guj", "Hindi/hinglish test" — genuine prior
usage, not QA fixtures). To avoid touching this real content, a **disposable copy** was made via
the app's own real "Duplicate" action on "rishab guj" (43 captions, 1:01 real Hindi-language
video) — the same "duplicate via real API/UI action" pattern this session's prior tasks (P5.1, P6)
established for packaged-app QA fixtures.

Verified against the running packaged app, on the disposable copy:

- **Snapping**: seeked the playhead to exactly 2.00s, then dragged a caption's end edge near it;
  it snapped to exactly `02.00` (confirmed via the rendered caption boundary). `Ctrl+Z` ×5
  restored the caption to its exact original boundary.
- **Auto-scroll**: started real playback; while playing, the playhead was observed hovering right
  at the safe-zone's edge (continuously re-engaging the minimal-nudge auto-scroll as designed,
  matching the dev-mode observation), confirming the mechanism is active in the packaged build.
- **Zoom position preservation**: zoom in/out changed `pxPerSec` (confirmed via ruler-mark
  spacing) and adjusted `scrollLeft` sensibly (not a jump/reset), confirming the anchor logic
  executes correctly in the packaged bundle. (One early zoom-button click landed on the adjacent
  style panel instead of the intended button — an artifact of a too-narrow test-harness browser
  window overlapping the timeline toolbar with the right style panel at that width, not an app
  bug; resolved by widening the viewport for this check, and not indicative of any real product
  issue at normal window widths.)
- **Keyboard shortcuts dialog**: opened from the top bar, rendered identically to dev mode
  (including the "Backspace also works" context note), `Ctrl+Z` while open produced no DOM change
  (`isAnyDialogOpen()` guard confirmed active in the packaged build), `Escape` closed it.

**Existing-feature regression smoke check**: the disposable copy's real transcription/captions,
export badge ("Exported"), and style panel all rendered and behaved normally throughout the
above; no console errors were observed during any of this packaged-app interaction.

Cleanup: the disposable "rishab guj (copy)" project was moved to Trash and then permanently
deleted via the app's own real UI flow (typed-name confirmation), leaving the 3 real production
projects untouched. The packaged app was then closed.

## 12. Production-data integrity

Baseline captured **before** packaged QA from the real production database
(`%APPDATA%\subs\subly.db`, backed up to `subly.db.bak-pre-p7-1-timeline-interaction-qa` prior to
any packaged-app interaction): Project 18, Subtitle 2250, ExportJob 46, VideoAsset 18,
SubtitlePreset 0 — identical counts to this same database's state recorded in the P6 report,
confirming a stable baseline across sessions. All of this task's dev-mode QA (§10) ran against the
isolated `prisma/dev.db` in `SUBLY_DESKTOP=1` mode and never touched this file. The packaged-app
QA (§11) necessarily used the real production DB path; a full row-level comparison (every column
except `updatedAt`) after cleanup shows the production database is **byte-for-byte identical** to
the pre-QA baseline: counts unchanged (18/2250/46/18/0) and a full JSON-string equality check
(excluding `updatedAt` on every row) returned `true`. The pre-QA backup file was deleted after
this comparison confirmed no diff, per the same pattern used at the end of prior tasks' packaged
QA.

## 13. Known limitations

- **Long/large-scale live QA not performed.** The dev-mode QA above used a 50.64s/48-caption
  project — enough to genuinely exercise scrolling, zooming, and snapping (the track already
  exceeds one viewport width at the default zoom), but this task's own Part 11 also asked for a
  5-minute, 30-minute-scale, and large-caption-count project. Reassigning one of the existing
  `dev.db` performance fixtures (e.g. "Perf 30min", 63 captions, owned by a different seed user)
  to the desktop-mode user was blocked by this session's own safety tooling (classified as
  "Irreversible Local Destruction" on a raw Prisma `update`, even against the disposable, isolated
  dev database) and was not pursued further via a workaround. The underlying scale-sensitive
  logic (virtualization filter) is covered functionally up to 5,400 captions in
  `visible-range.test.ts`, and none of the three new interaction modules scan the subtitles array,
  so there's no new large-N cost by construction — but this is reasoned from the diff, not
  re-measured live at that scale.
- **Sub-second timing behaviors not directly observed live.** The manual-scroll suppression
  window (1500ms) and the drag-in-progress auto-scroll suppression are implemented as simple,
  reviewed boolean/timestamp gates, but browser-automation round-trip latency in this session
  exceeded 1500ms per check, so the "doesn't immediately fight a manual scroll" behavior was not
  captured mid-window live — only its two endpoints (a manual scroll happened; auto-scroll
  resumed following at some later point) were observed.
- **No profiler run this pass.** See §8 — the pointermove-cost claim is by-construction reasoning
  (no new array scan added to the hot path), not a re-measured number against the task's own
  baseline.

## 14. Version decision

Bumped **0.1.5 → 0.1.6** in `package.json`, only after §9 (tests), §10 (dev-mode QA), §11
(packaged QA), and §12 (production-data integrity) all passed — per this task's own explicit
instruction not to bump during development, and only if the work is determined to be a release
feature. All 4 in-scope items are implemented, fully tested (44 new tests, 534/534 passing overall),
and verified live in both a dev-mode and a packaged build with zero regressions and zero production
data impact, so this qualifies.

After bumping, `npm run electron:pack` was re-run to produce a build whose artifact metadata
actually reflects the new version (electron-builder reads `version` directly from `package.json`
— there is no separate Electron metadata file to keep in sync in this project). The rebuild
succeeded cleanly (no errors) and was verified on the built file itself:
`release\SUBLY Setup 0.1.6.exe` (560,528,166 bytes), `FileVersion 0.1.6`,
`ProductVersion 0.1.6.0`, `ProductName SUBLY`. This rebuild changed only the version string
(no source files changed between the 0.1.5 build tested in §11 and this 0.1.6 rebuild) — it was
**not** re-installed or re-walked through the full interactive QA pass a second time, since doing
so would re-verify identical code against a purely cosmetic version-string change; §11's findings
apply unchanged to this artifact. This is a deliberate scope decision, noted here rather than
silently: the 0.1.6 installer's *version metadata* was verified directly; its *behavior* was
verified via the byte-identical-except-version 0.1.5 build in §11, not re-run at 0.1.6.

## 15. Final assessment

All 4 in-scope P7.1 items — timeline snapping, playback auto-scroll, zoom position preservation,
and the keyboard shortcuts reference dialog — are implemented per the P7 audit's recommendation,
built on the existing store/keyboard/dialog systems without introducing a second timing system, a
second keyboard-shortcut system, or a second scroll/zoom coordinate system. All new mutating
snapping behavior flows through the existing, unmodified `updateSubtitleTiming` overlap clamp and
`commit()` undo/redo stack — confirmed both by code construction and by live undo tests. The
keyboard-shortcuts dialog is UI-only and confirmed live to never mark the project dirty and to be
automatically covered by the existing dialog-open shortcut guard. 534/534 tests pass (44 new, 0
regressions), typecheck and lint are clean at the pre-existing baseline, and both a dev-mode and a
packaged-Windows QA pass — each using real UI interaction, not simulated events — confirmed all 4
behaviors work, including several checks (zoom-anchor scrollLeft) verified as **exact, independently
computed pixel-perfect matches** against the live app's own DOM state. Production data was
confirmed byte-for-byte unchanged (excluding `updatedAt`) across the entire packaged QA pass.

The known limitations in §13 — no live QA at 5-30-minute/thousands-of-captions scale (blocked by
this session's own safety tooling on a raw dev-database mutation, not pursued via a workaround),
and the sub-1500ms manual-scroll-suppression window not directly observable given browser-automation
round-trip latency — are real gaps in *live* verification, not known defects; the underlying logic
for both is simple, reviewed, and (for the scale case) unit-tested up to 5,400 captions.

**STATUS: PASS**
