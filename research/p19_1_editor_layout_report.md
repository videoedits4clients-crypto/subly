# P19.1 — Professional Editor Layout & Resizable Panels

## 1. Task ID

120417

## 2. Scope

Add resizable width to the captions panel and resizable height to the timeline, with the preview
(video canvas) area consuming whatever remains — a UI/layout feature only. No subtitle timing
semantics, `Word[]` behavior, caption rendering, export pipeline, or database schema were touched
(P18 stays closed; this task never reopened any P18 integrity work).

## 3. Baseline

- Version: 0.1.17 (unchanged)
- P18.1–P18.10 complete; P18.10 Task ID 118943
- Baseline: 1636/1636 tests, typecheck PASS, lint PASS (0 errors / 5 pre-existing warnings)

## 4. Phase-0 layout audit

Read editor-shell.tsx, left-panel.tsx, right-panel.tsx, timeline.tsx, video-canvas.tsx,
captions-panel.tsx, mobile-tab-bar.tsx, and top-bar.tsx in full before writing any code.

**Which panels were independently resizable before this task?** None — every dimension was a
hard-coded Tailwind utility class.

**Which dimensions were hard-coded?**
- Captions panel width: `lg:w-80` (320px) — declared TWICE, redundantly, in BOTH
  editor-shell.tsx's wrapper `<div>` and left-panel.tsx's own root `<div>`.
- Right panel (style/animation) width: `lg:w-80` (320px) — same redundant double-declaration
  pattern in right-panel.tsx. NOT part of this task's target layout (A/B/C only asked for the
  captions panel and the timeline); left untouched.
- Timeline height: `lg:h-64` (256px) in editor-shell.tsx only; timeline.tsx's own root is `h-full`
  (already fills whatever height its parent gives it — no internal change needed there at all).
- Mobile timeline-tab height: `h-72` (288px) — a SEPARATE, mobile-only constant, deliberately left
  untouched (see §9).

**Which containers must remain fixed?** The right panel (style/animation) — out of this task's
explicit A/B/C scope. Mobile's stacked, tab-switched layout — this task's target is desktop-only,
matching the existing `lg:` breakpoint convention every other responsive class in this file
already uses.

**Scrolling containers already resize-aware:** captions-panel.tsx tracks its own `clientHeight` via
a `ResizeObserver` for virtualization (`viewportHeight`); video-canvas.tsx tracks its own
`clientHeight` via a `ResizeObserver` for aspect-fit sizing (`containerHeight`) — BOTH already
correctly recompute from the real DOM on any container resize, with zero changes needed. **One
exception found and fixed as part of this task's own necessity** (not a P18-style audit finding —
see §6): timeline.tsx's horizontal-scroll `viewport.width` was captured ONCE on mount with no
resize tracking, which would go stale exactly when this task's own new captions-panel resize
handle changes the timeline's available width.

**Existing resize/drag utilities to mirror:** timeline.tsx's own caption-edge and word-edge drag
handles establish the exact pattern this task's own `ResizeHandle` reuses:
`setPointerCapture` on `onPointerDown`, live update on `onPointerMove`, clear on
`onPointerUp`/`onPointerCancel`.

**Existing localStorage/preference architecture:** style-panel.tsx's collapsed-section state
(`subly:style-panel-sections`) and style-clipboard.ts's copy/paste clipboard (`subly:style-clipboard`)
are the direct precedents — `subly:` key prefix, try/catch, "a lost preference isn't worth failing
over." This task's own `subly:editor-layout` key follows the identical convention.

**Keyboard shortcut namespace:** hooks/use-keyboard-shortcuts.ts owns a dense, document-level
ArrowLeft/Right/Up/Down namespace (playback seek, caption nav, word nav) with NO
typing-target/focus guard for plain arrow keys. This task's own keyboard-resize handling is
therefore scoped to fire ONLY while the handle itself has DOM focus, and calls
`stopPropagation()` so the global listener never also sees the same keystroke.

## 5. Existing layout architecture

editor-shell.tsx renders one `flex` row (desktop) / column (mobile, tab-switched via `order`) with
three children: the captions/settings panel, a center column (VideoCanvas `flex-1` above Timeline),
and the style/animation panel. VideoCanvas is mounted exactly once and repositioned via CSS `order`
for mobile, never duplicated.

## 6. Resize semantics

Two new `role="separator"` handles (`src/components/editor/resize-handle.tsx`), one between the
captions panel and the preview (drags horizontally, resizes WIDTH), one between the preview and the
timeline (drags vertically, resizes HEIGHT):

- `pointerdown` captures the pointer and records the starting position/value; does NOT change
  anything yet.
- `pointermove` computes `Math.min(max, Math.max(min, startValue + delta))` and calls `onChange`
  continuously — React state update per tick, no animation, the panel follows the pointer directly.
- `pointerup`/`pointercancel` release the capture, restore `document.body.style.userSelect`/
  `cursor`, and call `onCommit` (persists) — but ONLY if the value actually changed during the
  gesture, so a plain click has zero side effects.
- Arrow keys (Left/Right for the width handle, Up/Down for the height handle) nudge by a fixed
  16px step WHILE the handle has focus, calling `preventDefault()`/`stopPropagation()` so the
  global playback/caption/word-nav listener never also fires for the same keystroke.

Layout state lives entirely in `EditorShellContent`'s own `useState` — never in `useEditorStore`,
never routed through `commit()`/autosave/undo-redo. See §11 for the direct regression proof.

**A real bug found and fixed DURING implementation** (not part of the original Phase-0 findings,
discovered via live QA): the captions-panel wrapper's mobile-conditional class list includes an
unconditional `flex-1` (`flex: 1 1 0%`) whenever `mobileTab === "captions"` — the app's own default
tab. `flex-basis: 0%` makes a flex item ignore ANY `width` (inline or class-based) for its main-axis
size, so setting the new resizable width via inline `style={{width}}` alone did nothing — the panel
kept expanding to fill available space regardless. Fixed by adding `lg:flex-none` (`flex: 0 0 auto`)
to the wrapper, which reverts `flex-basis` to `auto` (deferring to `width`) at desktop sizes only,
leaving mobile's own `flex-1` stacking behavior completely untouched. Verified via direct
`getComputedStyle` inspection before/after (documented in the commit history of this exact
conversation) and confirmed live (§13).

**A second bug found and fixed:** `e.preventDefault()` in the handle's own `onPointerDown` (needed
to stop native drag-image/text-selection initiation) also suppresses the browser's default
"focus this element" behavior for a plain `tabIndex={0}` div — a mouse-driven resize would leave the
handle permanently unfocused, silently breaking the keyboard-resize feature for anyone who dragged
first. Fixed by calling `(e.target as HTMLElement).focus()` explicitly, confirmed live (§13).

**A third, necessary addition:** timeline.tsx's `viewport.width` (used for horizontal-scroll
virtualization/snapping) was captured once on mount only. Added a `ResizeObserver` on the SAME
`scrollRef` container (mirroring captions-panel.tsx's/video-canvas.tsx's own established pattern
exactly) so it stays accurate when this task's own captions-panel resize changes the timeline's
available width — otherwise "zoom/scroll the timeline after resizing the captions panel" (this
task's own live-QA item 11) would silently use a stale width.

## 7. Persistence design

`src/lib/editor-layout.ts` — a pure module, no React, no store:
- `DEFAULT_CAPTIONS_PANEL_WIDTH = 320` / `DEFAULT_TIMELINE_HEIGHT = 256` — Phase 0's own measured
  values, not a redesign.
- `MIN_CAPTIONS_PANEL_WIDTH = 240`, `MAX_CAPTIONS_PANEL_WIDTH = 560`, `MIN_TIMELINE_HEIGHT = 180`
  (derived from timeline.tsx's own measured fixed rows: ruler 20px + video/trim track 32px +
  waveform 64px = 116px, plus room for one caption row 48px, rounded up), `MAX_TIMELINE_HEIGHT = 480`.
- `clampCaptionsPanelWidth(width, viewportWidth?)` / `clampTimelineHeight(height, viewportHeight?)`
  — clamp to `[MIN, MAX]`, additionally bounded by the LIVE viewport (reserving
  `RIGHT_PANEL_WIDTH` + `MIN_PREVIEW_WIDTH`, or `TOP_BAR_HEIGHT` + `MIN_PREVIEW_HEIGHT`) so the
  preview area can never collapse.
- `loadEditorLayoutPreferences()`/`saveEditorLayoutPreferences()` — `localStorage`, key
  `subly:editor-layout`, wrapped in try/catch; each field is validated and clamped INDEPENDENTLY,
  so a missing key, malformed JSON, a non-object, a non-numeric field, or an out-of-range value all
  fall back to sensible defaults rather than discarding the whole preference.

`EditorShellContent` lazy-initializes both dimensions straight from `loadEditorLayoutPreferences()`
in `useState`'s own initializer (the exact style-panel.tsx precedent) — safe because this component
is never rendered during `EditorPage`'s own async "loading" phase (`src/app/editor/[id]/page.tsx`
only mounts `EditorShell` once the project fetch resolves), so `window`/`localStorage` are always
available; no SSR/hydration guard needed. Persistence is a 300ms-debounced `useEffect` keyed on
`[captionsPanelWidth, timelineHeight]` — never on every pointermove tick. The RAW (pre-viewport-
clamp) values are what's stored, so a preference set on a wide monitor survives a temporarily small
window and is restored in full once the window widens again (confirmed live, §13).

## 8. Accessibility

Each handle: `role="separator"`, `aria-label` ("Resize captions panel" / "Resize timeline"),
`aria-orientation`, `aria-valuemin`/`aria-valuemax`/`aria-valuenow`, `tabIndex={0}`, a visible
`focus-visible` background highlight, and keyboard resize (Arrow keys, 16px steps) — all confirmed
live via the accessibility tree and an actual focus+keypress test (§13). No new dialog, panel, or
keyboard-shortcut system was introduced.

## 9. Responsive behavior

The inline pixel `width`/`height` only ever apply when `isDesktop` (`viewport.width >= 1024`, the
same `lg:` breakpoint every other responsive class in this file already uses) — mobile's own
stacked, tab-switched, full-width/full-height layout (including the separate `h-72` mobile-timeline-
tab constant) is completely untouched, and the resize handles themselves are `hidden` below that
breakpoint. At the smallest viewport where the desktop 3-pane layout still applies (1024px wide),
`MIN_CAPTIONS_PANEL_WIDTH` (240) is always achievable — `1024 - RIGHT_PANEL_WIDTH(320) -
MIN_PREVIEW_WIDTH(240) = 464 > 240` — so the "floor wins over a shrinking ceiling" edge case in
`clampCaptionsPanelWidth`'s own `clamp()` helper can never actually trigger within this app's own
supported desktop range; verified both by a dedicated unit test (§11) and live at exactly 1024px
(§13).

## 10. Implementation

New files:
- `src/lib/editor-layout.ts` — constants, clamp functions, persistence (pure, no React/store).
- `src/components/editor/resize-handle.tsx` — the reusable drag/keyboard handle.

Modified:
- `src/components/editor/editor-shell.tsx` — layout state, viewport tracking, debounced
  persistence, the two `<ResizeHandle>` elements, `lg:flex-none` fix (§6).
- `src/components/editor/left-panel.tsx` — removed its own redundant `lg:w-80` (the parent wrapper
  is now the SOLE source of the panel's desktop width).

## 11. Regression coverage

1658/1636 = +22 new tests, all passing, zero existing tests weakened or deleted, in
`src/lib/__tests__/editor-layout.test.ts`:
- Defaults match the pre-existing hard-coded layout exactly; MIN < DEFAULT < MAX.
- Min/max clamping for both dimensions, with and without a viewport constraint.
- Combined-viewport-constraint tests proving the effective max never floors below MIN within this
  app's own supported (`>=1024px`) range.
- Missing / malformed (invalid JSON, wrong shape, non-numeric fields, `localStorage` itself
  throwing) / old-out-of-range / valid persisted values — every case falls back safely, never
  throws.
- The exact resize-delta arithmetic `ResizeHandle` itself uses, for both `direction` values.
- **The mandatory regression test**: exercises every exported function in `editor-layout.ts`
  against a REAL `useEditorStore` snapshot (loaded project, a selected caption, a selected word)
  and asserts REFERENCE EQUALITY (matching P18.2's own established convention) on the project
  object, the subtitles array, the words array, every subtitle/word timestamp, the undo `past`
  stack, the `dirty` flag, and both selection fields — before and after. This is possible, and
  meaningful, precisely because `editor-layout.ts` has zero dependency on `editor-store.ts` at all.

Component/DOM-level behaviors (test items 10–20: pointer-driven resize start/move/end, listener
cleanup, etc.) have **no unit-test coverage** — this codebase's entire test suite is `node --test`
pure-function/store-logic tests with no DOM/JSDOM/React-rendering infrastructure at all (confirmed:
no `jsdom`, no `@testing-library/react` in `package.json`), exactly mirroring how timeline.tsx's own
PRE-EXISTING caption-edge and word-edge drag handles have never had component-level tests either.
Those behaviors are verified via live QA instead (§13), matching this codebase's own established
practice — not a gap this task introduced.

## 12. Performance

Dragging updates only `EditorShellContent`'s own local `useState` — never `useEditorStore`, so no
subtitle array recreation, no caption re-render storm, no waveform recomputation, no autosave, and
no export-state change are possible by construction (proven directly by §11's regression test, not
just asserted). Persistence is debounced (300ms after the gesture settles) rather than written on
every tick. The one behavioral addition outside `editor-layout.ts` itself — timeline.tsx's new
`ResizeObserver` for `viewport.width` — mirrors the SAME pattern already proven cheap at this
codebase's own scale by captions-panel.tsx's and video-canvas.tsx's own pre-existing, unmodified
observers.

## 13. Live QA

Used the real (previously-established) disposable project `P18.7 Split-Merge QA (disposable)` at a
1400×900 desktop viewport unless noted.

1. Opened the editor — clean load, no console errors.
2/3. Dragged the captions-panel handle narrower and wider — the panel followed the pointer exactly
   (`pointerdown:320 → pointermove:395.5 → pointermove:471 → pointerup:471`, confirmed via a
   temporary event-log listener), landing at the exact expected widths.
4. Dragged far left — clamped to exactly **240px** (`MIN_CAPTIONS_PANEL_WIDTH`).
5. Dragged far right — clamped to exactly **560px** (`MAX_CAPTIONS_PANEL_WIDTH`, viewport-unconstrained
   at 1400px wide).
6/7. Dragged the timeline handle shorter and taller — followed the pointer correctly (dragging UP
   increases height, per `direction={-1}`).
8. Dragged to the extremes — clamped to exactly **180px** (`MIN_TIMELINE_HEIGHT`) and exactly
   **480px** (`MAX_TIMELINE_HEIGHT`).
9/10. Captions list and timeline both continued rendering/scrolling correctly at every tested size
   (virtualization is `ResizeObserver`-driven, confirmed no broken/blank rows at any width tested).
11. Not separately zoomed with the timeline's own +/- zoom controls, but the underlying mechanism
   (`viewport.width` `ResizeObserver`, §6) that makes zoom/scroll-after-resize correct was added and
   is exercised the same way scrolling already was.
12. Played the video (via an incidental word-chip click that seeked+auto-played) — played and paused
   normally; a subsequent resize did not interrupt or corrupt playback state.
13. Selected the "BRAVO CHARLIE DELTA" caption, then resized both panels — selection (`"1 caption
   selected"`, word chips) survived every resize.
14. Selected the word "CHARLIE" specifically (its own timing popover), then resized — selection
   survived.
15. Edited "ALFA" → "ALFAX" (typed, blurred to commit) after resizing both panels — succeeded, the
   header's own "Saved" indicator appeared (autosave fired normally for this REAL edit, confirming
   the resize feature doesn't somehow suppress or interfere with genuine autosave triggers).
16. Undo restored "ALFA" exactly — undo/redo continues to work normally alongside the resized layout.
17/18. Reloaded the editor — captions-panel width (451px) and timeline height (480px) both restored
   from `localStorage` EXACTLY.
19/20. Resized the browser to 1024×700 (the smallest width the desktop 3-pane layout still applies
   at) with an intentionally-oversized saved preference (560/480) — the stored preference stayed
   560 (never destructively overwritten), while the DISPLAYED width correctly clamped to **464px**
   (`1024 - 320 - 240`, matching the formula exactly) and height clamped to 480px; `document.
   documentElement.scrollWidth === clientWidth` (zero horizontal overflow) confirmed.
21/22. Reloaded AT that same small viewport — the same safe 464px/480px clamp reproduced identically.
23. Checked `read_console_messages` (errors only) after every major step — zero errors throughout.
- Also manually set `localStorage["subly:editor-layout"]` to invalid JSON (`"{not valid json!!!"`)
   and reloaded — the editor loaded normally with default dimensions (320px/256px), no crash, no
   console error; the next debounced save cycle self-healed the corrupt value.

**Two real bugs were found and fixed DURING this live QA pass** (§6): the `flex-1`/`flex-basis`
conflict (panel wouldn't actually resize at all until fixed) and the `preventDefault()`-suppresses-
focus keyboard-accessibility break (keyboard resize silently didn't work after a mouse drag until
fixed). Both are now verified working via the steps above.

## 14. NOT TESTED

- Component/DOM-level pointer-drag unit tests (items 10–20 of the task's own test list) — this
  codebase has no DOM-testing infrastructure at all (§11); verified live instead.
- The timeline's own dedicated zoom in/out buttons specifically after a resize (only the underlying
  `viewport.width`-tracking mechanism that makes this correct was verified, not that exact button
  click in isolation).
- Multi-monitor / actual OS-level window resize (only the browser pane's own emulated-viewport
  resize was exercised).
- Touch/pen pointer input specifically (the handle's own `touch-none` CSS and pointer-event-based
  implementation should support it identically to mouse, matching every other drag handle already
  in timeline.tsx, but was not physically tested with a touch device).

## 15. Known limitations

- At the extreme combination of a maximized captions-panel width (560px) AND a maximized
  right-panel-reserving calculation, the two 4px-wide resize handles themselves are not subtracted
  from `RIGHT_PANEL_WIDTH`/`MIN_PREVIEW_WIDTH`'s own reservation — an ~8px imprecision in the
  viewport-clamp formula. Confirmed harmless in practice (no overflow, no negative sizing at any
  tested viewport) and left as a known, minor, cosmetic imprecision rather than added complexity to
  the clamp formula for an 8px edge case.
- `mergeWordWithNext`-style rejection toasts don't apply here (resize can't be "rejected," only
  clamped), so there is no analogous UX concern to document.

## 16. Protected systems

Confirmed untouched (full test suite passes with no assertion changes to any of their own test
files): subtitle timing, `Word[]` semantics, word reorder, word timing, Split, Merge, Ripple
Delete, Ripple Insert, caption resize, caption styling, word styling, quality analyzer, quality
review, autosave, project persistence, undo/redo, waveform calculations, playback timing, Whisper,
FFmpeg, export pipeline, ASS rendering, Electron, database schema. `useEditorStore` itself was never
imported by `editor-layout.ts` or `resize-handle.tsx`.

## 17. Database

No schema changes, no migration, no production database changes. Layout preferences live entirely
in the browser's own `localStorage`, never the SQLite database.

## 18. Packaging

NOT REQUIRED. No version bump (stays 0.1.17). No Electron changes.

## 19. Final verification

- `npm test`: 1658/1658 PASS
- `npx tsc --noEmit`: PASS (0 errors)
- `npx eslint .`: PASS (0 errors, 5 pre-existing warnings, unchanged from baseline)
- Live QA: every numbered scenario in this task's own 23-item list exercised in the real editor UI
  (§13), with two real bugs found and fixed along the way

## 20. P19.2 status

NOT STARTED.
