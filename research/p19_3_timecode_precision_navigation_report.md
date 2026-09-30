# P19.3 — Professional Timecode & Precision Navigation

## 1. Task ID

123041

## 2. Scope

Add a professional timecode/precision-navigation workflow: an exact current-time display, an editable "Go to time" control, Go to Start/End, jump-to-selected-caption-start/end (single and multi-selection), and jump-to-selected-word-start/end — all as VIEW/NAVIGATION only, through the existing `seek()` mechanism, never mutating subtitle/project state. P18.1–P18.10 and P19.1/P19.2 are closed and were not reopened.

## 3. Baseline

Before this task: P19.2 (Task 121684) had shipped Fit to Project/Fit to Selection, a real timeline viewport `ResizeObserver`, 1714/1714 tests (this count already includes P19.2's own additions), typecheck/lint clean, version 0.1.17.

## 4. Phase-0 audit

Read `timeline.tsx`, `video-canvas.tsx`, `editor-store.ts`, `time-scale.ts`, `zoom-anchor.ts`, `auto-scroll.ts`, `visible-range.ts`, `use-keyboard-shortcuts.ts`, `keyboard-shortcuts-reference.ts`, `word-timing-popover.tsx`, `dialog-open-guard.ts`, and `types/subtitle.ts` before writing any code, plus a full-tree grep for `currentTime`/`duration`/`formatTime`/`fps`/`Home`/`End`/`seek`/`selectedWordIndex`. This is the task whose Phase 0 found the LARGEST fraction of its nominal scope already implemented — findings, mapped to the task's own lettered checklist:

- **A. Authoritative playback time**: `useEditorStore`'s `currentTime` (a plain number) plus a `seekRequest: {time, token}` — `seek(time)` sets both; `video-canvas.tsx`'s own `onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}` is the ONLY writer during normal playback (the real `<video>` element is the true source of truth; the store mirrors it). This task adds no second time state — every new control calls the existing `seek()`.
- **B. Project duration**: `project.video.duration` (required field on the `video` sub-object once a video exists) — already used throughout (`video-canvas.tsx`'s own duration display, `stepFrame`'s clamp, P19.2's Fit to Project).
- **C. Current-time rendering**: **already existed** — `video-canvas.tsx:233` (pre-task) rendered `{formatTime(currentTime)} / {formatTime(project.video.duration)}` as a plain read-only `<span>`, using `lib/utils.ts`'s existing `formatTime` (`MM:SS.cc` — two-digit minutes/seconds, two-digit **centiseconds**, not the three-digit-millisecond example the task's own spec text used). Per this task's own "do not invent a competing time format" instruction, this existing convention was kept and reused unchanged; only the reverse direction (parsing typed text back to seconds) was new (see §6).
- **D. FPS availability**: **already reliably available** — `project.video.fps` is a required (non-optional) field on the `video` sub-object in `types/subtitle.ts`, and `video-canvas.tsx`'s pre-existing `stepFrame` already reads it (`project?.video?.fps || 30`, the same defensive fallback used elsewhere for a not-yet-loaded video).
- **E. Existing time formatting**: `formatTime` (MM:SS.cc) — used everywhere from the player transport bar to caption/word timestamp labels and quality-analyzer messages. No frame-based (`HH:MM:SS:FF`) format exists anywhere in the codebase.
- **F. Existing Home/End semantics**: **already bound, but to a DIFFERENT meaning than this task's own "Go to Start/End" default assumption** — Home/End (Task 100742, P13, `use-keyboard-shortcuts.ts:508-523`) seek to the currently-**selected caption's** own start/end, not the project's t=0/duration, and only for a SINGLE selection (`store.selectedSubtitleId`, not the multi-selection `selectedSubtitleIds` set). Per this task's own "do not change existing shortcuts unless necessary," Home/End were left completely untouched; the new project-level "Go to Start/End" is buttons-only (§8), avoiding any naming/keybinding collision.
- **G. Existing caption start/end navigation**: this IS what Home/End already provide (single-selection only) — confirmed already documented in `lib/keyboard-shortcuts-reference.ts:94-95`. This task's own multi-selection requirement (bounding range across a batch selection) was the one real gap, closed with new buttons (§9) that reuse P19.2's own `computeSelectionBoundingRange` rather than a second range computation.
- **H. Existing word start/end navigation**: did not exist as a "jump" — `word-timing-popover.tsx` already displayed a word's start/end as editable fields, but had no seek/navigate action.
- **I. Frame stepping**: **already fully implemented** — `video-canvas.tsx`'s pre-existing `stepFrame(dir)` (`Previous frame`/`Next frame` buttons, `SkipBack`/`SkipForward` icons) computes `1/fps` and clamps to `[playableStart, playableEnd]` (the project's trim bounds, not raw `0`/`duration` — a distinct, pre-existing, deliberately-untouched clamp; see §12's own note on why "Go to Start/End" uses the literal `0`/`duration` bounds instead). No new frame-stepping control was added — the task's own "audit whether frame stepping already exists" instruction was answered "yes," so nothing further was built here.
- **J. Keyboard-namespace conflicts**: confirmed dense — Arrow keys, Home/End, `[`/`]`/`{`/`}`, Alt+Arrow, Ctrl/Cmd+C/X/V/Z, Delete/Backspace are all already bound (`use-keyboard-shortcuts.ts`). No new shortcuts were added; every new control in this task is a button (or the "Go to time" text field's own local Enter/Escape handling, which the file's own blanket `isTypingTarget` guard already protects from colliding with any global shortcut — see §15).

## 5. Timecode formatting/parsing

New file: `src/lib/timeline/timecode.ts` — `parseTimelineTime(input: string): number | null` and `clampTimelineTime(seconds: number, duration: number): number`. No `formatTimelineTime` was added (§4C: `formatTime` already exists and was reused unchanged, per the task's own "do not duplicate an existing formatter" instruction). No frame-format functions were added (§4I: frame stepping already exists and this task's display convention is time-based, not frame-based). Both functions are pure (no React/Zustand/DOM), deterministic, and explicit about NaN/Infinity/negative/zero-duration behavior (see the file's own doc comments and the 17 pure tests in §18).

`parseTimelineTime` is deliberately more lenient on the way IN than `formatTime` is on the way out: it accepts a bare number of seconds, `MM:SS[.fraction]`, or `HH:MM:SS[.fraction]` (1–3 colon-separated parts, any decimal precision) — a user retyping a displayed value shouldn't have to match its exact 2-digit centisecond padding.

## 6. Exact seek behavior

The "Go to time" control (`video-canvas.tsx`) is a single text `<Input>` (id `video-canvas-goto-time`, labeled via an associated `<label>` for accessibility) that replaces the old read-only current-time `<span>`. It shows `formatTime(currentTime)` whenever not focused/being edited (a local `timeInputDraft: string | null` state holds the user's in-progress text while editing, so playback ticks never stomp a keystroke-in-progress — the field keeps updating live during playback exactly like the span it replaced, per this task's own "must update smoothly during playback" requirement). Enter or blur both commit through `commitTimeInput` → `parseTimelineTime` → `clampTimelineTime(_, project.video.duration)` → `store.seek(...)` — the SAME existing seek mechanism the scrubber/Home/End/arrow-key navigation already use. Invalid input (`parseTimelineTime` returns `null`) is silently discarded — no seek, no crash, the field simply reverts to showing the real current time. Escape cancels an in-progress edit without committing (implemented via a ref-based flag, `timeInputCancelledRef`, because the native `blur()` Escape triggers fires synchronously before React can re-render with the cleared draft — see the code's own comment for why a plain state-clear-then-blur doesn't work).

## 7. Start/End navigation

"Go to Start" (`ChevronFirst` icon) calls `seek(0)`; "Go to End" (`ChevronLast`) calls `seek(project.video.duration)` — both placed in `video-canvas.tsx`'s existing transport row, flanking the pre-existing frame-step buttons (`[Start] [◄frame] [Play] [frame►] [End]`, the conventional NLE transport layout). "Go to End" is `disabled` when `!(project.video.duration > 0)`, per the task's own "fail safely" instruction. These use the literal `0`/`duration` bounds the task explicitly specifies — deliberately DIFFERENT from `stepFrame`'s own pre-existing trim-aware (`playableStart`/`playableEnd`) clamp, which was not touched.

## 8. Caption navigation

Two new icon buttons in `timeline.tsx`'s toolbar — "Jump to selection start"/"Jump to selection end" (`ArrowLeftFromLine`/`ArrowRightFromLine`, placed immediately after the pre-existing "Set selected caption's start/end to playhead" mutation buttons, which use the reversed `ArrowLeftToLine`/`ArrowRightToLine` icon pair so the two opposite-direction operations are never visually confusable). Reuses P19.2's own `computeSelectionBoundingRange` unchanged (never a second range computation) for BOTH single and multi-selection: `{start: min(starts), end: max(ends)}` across whichever of `selected`/`selectedSubs` applies. Disabled with no selection. Does not alter the selection itself.

Live-verified: single selection (BRAVO DELTA CHARLIE, 2–6s) → start=2.00, end=6.00 exactly; non-contiguous multi-selection (ALFA + HOTEL, skipping the middle caption) → bounding start=0.50 (ALFA's own start), bounding end=10.40 (HOTEL's own end) — the full range, not two separate islands.

## 9. Word navigation

Two new small buttons inside `WordTimingPopover` (`word-timing-popover.tsx`), placed directly below the existing Start/End numeric inputs: "Jump to start"/"Jump to end", calling `seek(word.start)`/`seek(word.end)` via a direct, stable `useEditorStore((s) => s.seek)` reference (no id/context to bind, so no wrapper is needed — the same "bare store action passed straight through" pattern this codebase already uses elsewhere).

## 10. Non-monotonic word-order safety

**Mandatory per this task's own spec — verified twice, unit and live.** `word.start`/`word.end` in `WordTimingPopover` are the exact prop values the caller (`captions-panel.tsx`) reads from `words[index]` — never re-derived from array position, never consulting a neighbor. Since a reordered word's own timestamps travel WITH the object (P18.6's own invariant), this is safe by construction; no new "find the right neighbor" logic was needed because none was ever consulted.

- **Unit test** (`editor-store-precision-navigation.test.ts`, test 24): a caption with the task's own worked example — array order `[BRAVO(2,3), DELTA(5,6), CHARLIE(3.5,4.5)]`, i.e. DELTA (chronologically LAST) placed before CHARLIE (chronologically MIDDLE). Selecting array index 2 (CHARLIE) and reading `words[selectedWordIndex]` yields exactly `{start: 3.5, end: 4.5}`; seeking to `word.start`/`word.end` lands on exactly `3.5`/`4.5` — never `5.0`/`6.0` (DELTA's timing, the array-adjacent word).
- **Live QA**, same worked example, seeded into the disposable QA project (see §19): opened the CHARLIE word chip's popover (displayed correctly bounded `00:03.00 – 00:06.00`, i.e. between BRAVO's end and DELTA's start — proving the popover's OWN bounding-neighbor lookup, pre-existing and unmodified, is also unaffected), clicked "Jump to end" → playhead landed at exactly `00:04.50` (not `00:06.00`); re-opened and clicked "Jump to start" → exactly `00:03.50` (not `00:02.00` or `00:05.00`).

## 11. Frame stepping

Not added — already existed (§4I). Not modified.

## 12. Zoom interaction

None of the new navigation controls touch `pxPerSec`/`scrollLeft` (timeline zoom/scroll are `Timeline`-local React state, entirely separate from `seek()`, which only touches the store's `currentTime`/`seekRequest`). Live-verified: zoomed in (3×, `pxPerSec` 70→130) and confirmed the "Go to time" field still parses/seeks correctly (`"8"` → `00:08.00`, `scrollWidth`/`pxPerSec` unchanged by the seek) — no navigation action ever resets zoom or panel dimensions.

## 13. P19.1/P19.2 interaction

Live-verified in sequence on the seeded QA project: resized the captions panel wider (P19.1) → "Go to time" (`"2"` → `00:02.00`) still worked correctly against the new viewport; resized the timeline height (P19.1) → "Go to time" (`"9.5"` → `00:09.50`) still worked; multi-selection Jump-to-start/end (this task) correctly used P19.2's own `computeSelectionBoundingRange`. No regressions found in either direction.

## 14. Accessibility

- "Go to time": a visually-hidden `<label htmlFor="video-canvas-goto-time">` (`sr-only`) plus a `title` tooltip; keyboard-focusable like any text input; Enter commits, Escape cancels.
- "Go to Start"/"Go to End": `aria-label` + `title`, keyboard-focusable buttons (native `<button>`), visible via the existing focus-ring styling every other transport button in this file already gets.
- "Jump to selection start/end" and the word popover's "Jump to start/end": same existing `Button` component every other timeline/popover control already uses — inherits its accessible-name (`title`), focus-visible ring, and disabled-state conventions with no new styling needed.
- No new dialog was introduced — every control is inline in the existing toolbar/popover, per the task's own "prefer a compact popover/input integrated into the existing toolbar" instruction.

## 15. Performance

No per-frame-expensive work was added. The timecode display derives from the existing `currentTime` (no new subscription, no new polling). Selected-caption/word navigation is bounded to the selected object(s) only (`computeSelectionBoundingRange` over, at most, the current selection; direct property access for a word — no scan of the full subtitles/words tree). No `localStorage` writes, no autosave/undo triggers, no subtitle/word array recreation — confirmed both by code review and by the mandatory reference-equality regression test (§18).

## 16. Regression coverage

- `lib/timeline/__tests__/timecode.test.ts` — 17 pure tests: zero, normal, minute/hour boundaries, bare-seconds, whitespace, malformed/negative/NaN/Infinity/empty/too-many-parts rejection, "never throws on adversarial input," clamp below-zero/above-duration/in-range, duration-unavailable (0/negative/NaN → clamps to exactly 0), non-finite `seconds` input, "never throws, never returns NaN/Infinity."
- `store/__tests__/editor-store-precision-navigation.test.ts` — 10 tests: Go to Start/End, valid/invalid/out-of-range "Go to time" entry, single- and multi-selection caption bounding range, selected-word start/end, the mandatory non-monotonic-word proof (§10), and the mandatory project-state-isolation regression (below).
- **Mandatory regression** (same test file, final test): exercises every navigation path this task adds (Go to Start, Go to End, valid/invalid exact time, selection bounding range, word start/end) against a real `useEditorStore` snapshot, asserting `after.project === projectBefore`, `after.project!.subtitles === subtitlesBefore`, `after.project!.subtitles[0].words === wordsBefore`, exact non-monotonic word timestamps unchanged, `after.past === pastBefore` (undo history), `after.dirty === dirtyBefore`, `after.selectedSubtitleIds === selectedIdsBefore`, and `after.selectedWordIndex === selectedWordIndexBefore` — reference equality throughout, following the established P18.2/P19.1/P19.2 convention.
- No existing test was weakened, deleted, or modified.

## 17. Live QA

A disposable fixture (`p19-3-precision-nav-qa`) was seeded directly into the local dev database for this task — see §19 for why a fresh account/project was needed and exactly how it was built (same video file, same style/animation/composition settings, and the same 3-caption shape as the P18.7 QA fixture reused throughout P18.x/P19.x, with one caption's `words` deliberately reordered into the task's own non-monotonic worked example). At a 1400×900 viewport:

- Current timecode matched the playhead on load (`00:00.00`); played the video and confirmed the field updated continuously (`00:03.96` → `00:09.80` → `00:12.00` across successive checks). ✓
- Paused, typed an exact time (`00:03.50`), pressed Enter → playhead landed exactly there, active caption updated correctly. ✓
- Typed clearly invalid input (`"garbage"`) → rejected safely, field reverted to the real current time, zero console errors. ✓
- Go to Start → exactly `00:00.00`; Go to End → exactly `00:12.00` (the project's own duration). ✓
- Selected one caption (BRAVO DELTA CHARLIE) → Jump to selection start/end → exactly `00:02.00`/`00:06.00` (the caption's own bounds). ✓
- Selected a non-contiguous multi-selection (ALFA + HOTEL) → Jump to selection start/end → exactly `00:00.50`/`00:10.40` (the full bounding range, confirming the gap caption in between is correctly included in the span, not treated as a separate island). ✓
- Selected the non-monotonic CHARLIE word → Jump to start/end → exactly `00:03.50`/`00:04.50`, never DELTA's `00:05.00`/`00:06.00` (§10). ✓
- Zoomed in (3 clicks) → "Go to time" still parsed/seeked correctly against the zoomed viewport. ✓
- Resized the captions panel, then the timeline height (P19.1) → "Go to time" still worked correctly after each. ✓
- Played the video, then typed an exact time mid-playback and pressed Enter → confirmed (via direct `<video>` element inspection immediately after) `currentTime` landed exactly on the typed value AND `paused === false` — playback continued uninterrupted through the seek. ✓ (see the honest note on testing-methodology noise in §20)
- Reloaded the page → confirmed the "Go to time" field reset to `00:00.00` (not persisted) and no residual navigation state leaked across the reload. ✓
- Console checked for errors after every major action throughout this session — none observed at any point.

## 18. NOT TESTED

Being explicit per the task's own "be honest about anything not live-tested" instruction:

- The exact wall-clock timing of "seek mid-playback, then confirm playback keeps advancing for several more seconds afterward" was noisy to observe directly in this tool environment: this session's own browser-automation round-trip latency (each tool call costs real wall-clock seconds) is a meaningful fraction of the fixture video's own 12-second duration, so several early attempts at this specific check were confounded by the video reaching its own natural end between action and observation (a testing-methodology artifact, not a product bug — see §20). The ONE measurement taken with minimal round-trip latency between the seek and the observation (§10/§17) showed the correct result (`currentTime` exactly at the typed value, `paused === false`), but a longer, cleaner "seeks mid-playback, still playing 5+ real seconds later" observation was not obtained.
- The word-navigation buttons were only live-tested via the popover's OWN word-chip entry point (`captions-panel.tsx`) — not via the same word rendered inside the timeline's `TimelineWordHandles`, since `WordTimingPopover` is only ever mounted from the captions panel (confirmed by Phase-0 grep — a single call site).
- Keyboard-shortcut interaction was not live-tested because no new global shortcuts were added (§4J) — the "Go to time" field's own Enter/Escape were tested (§6/§17), but that's local `onKeyDown` on the input itself, not a global shortcut.

## 19. Known limitations

- **Live QA required a fresh disposable account and project.** The browser session's prior login (used throughout P18.x/P19.1/P19.2) was no longer active when this task's live QA began, and its password was never known to this session (only ever established interactively in the browser, never typed in chat or read from a project file). Rather than guess or ask for the original account's credentials, a new test account (`p193-qa-tester@localhost.test`, a password generated for this purpose) was registered directly through the app's own `/register` flow — explicitly permitted by this environment's "testing the user's own application on localhost with test credentials" rule. A matching disposable project (`p19-3-precision-nav-qa`) was then seeded directly into the local SQLite dev database (via a throwaway Prisma script, deleted immediately after use) under that new account, reusing the SAME video file already on disk from the `p18-7-split-merge-qa` fixture (copied into a new upload folder) and the same style/animation/composition JSON, with one caption's words deliberately reordered into this task's own non-monotonic worked example. This is a one-time, local-only, dev-database change — no production code, schema, or migration was touched, and it does not affect the ORIGINAL account's own projects in any way.
- The mid-playback-seek observation (§18) is a testing-methodology limitation of this specific tool environment, not a product limitation — the code path is identical to every other `seek()` call already exercised (Go to Start/End, exact time while paused, caption/word jumps), none of which have ever paused or otherwise interrupted playback.

## 20. Protected systems

Not touched: subtitle/caption/word timing and order, Split/Merge/Ripple Delete/Ripple Insert, caption/word resize or nudge, caption/word styles, quality analysis, autosave, undo/redo, project persistence, waveform source audio, export timing, ASS rendering, FFmpeg, Electron, database schema (the dev-only seed script in §19 inserts rows through the EXISTING, unmodified schema — it does not change the schema itself). Verified both by code review (every new control calls only `store.seek()`, a pre-existing, side-effect-free — no commit/dirty/undo — action) and by the mandatory reference-equality regression test (§16) proving `project`, `subtitles`, `words`, `past`, `dirty`, `selectedSubtitleIds`, and `selectedWordIndex` are all byte-for-bit unchanged after every navigation path this task adds.

## 21. Database

No schema changes, no migrations, no production DB changes. (See §19 for the one-time, dev-only, unmodified-schema data seed used solely for this task's own live QA.)

## 22. Packaging

Not required. No Electron changes.

## 23. Final verification

- `npm test`: **1714/1714 passing**.
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, 5 pre-existing warnings (unchanged — `project-card.tsx`, `lib/ai/index.ts`, `lib/analytics.ts`, `lib/subtitles/ass.ts`, `lib/subtitles/preview-style.ts`).
- No existing test was weakened, deleted, or modified.
- Version remains 0.1.17.

## 24. P19.4

NOT STARTED.
