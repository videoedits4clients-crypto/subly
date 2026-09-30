# P19.4 — Professional Playback & Timeline Scrubbing

## 1. Task ID

124572

## 2. Scope

Audit and, only where necessary, implement a professional playback/scrubbing workflow: play/pause, timeline click-to-seek, playhead scrubbing, exact time sync, playback auto-scroll, zoom interaction, selection safety, performance, and state isolation. Explicitly bounded — no timeline redesign, no video-player redesign, no new playback state machine. P18.1–P18.10 and P19.1–P19.3 are closed and were not reopened.

## 3. Baseline

Before this task: P19.3 (Task 123041) had shipped exact-time navigation (timecode display, "Go to time," Go to Start/End, caption/word jump navigation, non-monotonic-safe), 1714/1714 tests, typecheck/lint clean, version 0.1.17.

## 4. Phase-0 audit

Read `timeline.tsx`, `video-canvas.tsx`, `editor-shell.tsx`, `editor-store.ts`, `time-scale.ts`, `zoom-anchor.ts`, `auto-scroll.ts`, `visible-range.ts`, `waveform.tsx`, `use-keyboard-shortcuts.ts`, `keyboard-shortcuts-reference.ts`, `dialog-open-guard.ts`, plus the P19.1/P19.2/P19.3 reports, before writing any code, and grepped the full tree for every term the task listed. Findings, mapped to the task's own lettered checklist — this task's Phase 0 found the playback/scrub architecture was ALREADY substantially built:

- **A. Authoritative playback time**: the real `<video>` element (`video-canvas.tsx`). `currentTime` (store) mirrors it via `onTimeUpdate`; `isPlaying` mirrors `onPlay`/`onPause`. Already working — not touched.
- **B. Play/pause representation**: `isPlaying: boolean` in the store, a pure read-model updated only from the video element's own events; `setPlaying`/`togglePlay` (imperative, called synchronously inside the click/keydown handler itself so Chrome's user-gesture requirement for `.play()` is preserved — an existing, deliberate P8-era design). Already working — not touched.
- **C. `seek()`**: `set({ currentTime: time, seekRequest: { time, token: ...+1 } })` — a token-based request consumed by an effect that imperatively sets `v.currentTime`. Already working, and already the ONE mechanism every existing and new navigation control (P19.3's timecode/Start/End/caption/word jumps, and now click-to-seek/scrubbing) goes through. No second playback-time state was created.
- **D. Timeline click-to-seek**: **already existed** — `onTrackClick` (bound to the track's own `onClick`) calls `seek(timeFromClientX(e.clientX))`. `timeFromClientX` uses the canonical `pixelsToTime` (`lib/timeline/time-scale.ts`).
- **E. Playhead drag**: **already existed** — `startScrub`/`onScrubMove`/`endScrub`, using pointer capture (`setPointerCapture`), bound to BOTH the ruler (drag-anywhere-to-scrub) and a small dedicated playhead handle, sharing the identical `timeFromClientX` → `seek()` path as click-to-seek.
- **F. Waveform interactions**: the waveform (`waveform.tsx`) is a pure rendering canvas with no pointer handling of its own — clicks bubble up to the track's own `onClick`, an already-existing, explicitly-documented design ("the waveform can never disagree with the rest of the timeline about where a click landed or create a second, competing seek path").
- **G. Auto-scroll**: **already existed** — `computeAutoScrollTarget` (`lib/timeline/auto-scroll.ts`), an effect keyed on `[currentTime, isPlaying]` that nudges `scrollLeft` to keep the playhead in the middle safe zone while playing.
- **H. Manual-scroll suppression**: **already existed** — `manualScrollUntilRef` + `MANUAL_SCROLL_SUPPRESS_MS` (1500ms) + `programmaticScrollRef` (distinguishes the effect's own writes from a real user scroll), set in the scroll container's `onScroll` handler.
- **I. Zoom's effect on playback/scroll**: already fully isolated — `pxPerSec`/`viewport` are `Timeline`-local React state, entirely separate from `currentTime`/`seekRequest` (already proven in P19.2/P19.3).
- **J. Selection representation**: `selectedSubtitleId`, `selectedSubtitleIds: Set<string>`, `selectedWordIndex` — unchanged by this task.
- **K. Pointer/drag gesture conflicts — two genuine gaps found**:
  1. **Missing `onPointerCancel`** on the main track/scroll container. Caption-edge drags, trim drags, and the ruler/playhead scrub all clean up via `onPointerUp`, but none of them handled `pointercancel` (a pointer ending via a browser/OS-level interruption rather than a normal release) — this could leave `scrubbingRef`/`dragState`/`trimDragRef` stuck "active" forever, this task's own explicitly-named "no stuck dragging state" failure mode. `TimelineWordHandles` (a different drag layer in the same file) already had `onPointerCancel={onPointerUp}` — the main container simply hadn't been brought up to that same standard.
  2. **Auto-scroll's drag guard didn't know about scrubbing.** The `[currentTime, isPlaying]` effect already skipped itself during a caption-edge or trim drag (`dragState.current || trimDragRef.current`) but NOT during an active ruler/playhead scrub (`scrubbingRef.current`) — since scrubbing calls `seek()` on every pointermove (changing `currentTime`, the effect's own dependency) while the video might happen to be playing, this could let auto-scroll fight the user's own drag mid-gesture, exactly the failure mode this task's own "automatic playback scrolling must not fight the user's pointer" requirement calls out.
  3. **A genuine boundary gap**: `timeFromClientX` clamped only the LOWER bound (`Math.max(0, ...)`), never the upper one. The track's own rendered width floors at 800px (`Math.max(800, duration * pxPerSec)`) — for a short project at a low zoom, that floor extends well past the project's actual duration, so a click/scrub in that empty trailing region previously produced a time beyond `duration`, violating this task's own explicit "clamp to `[0, project.video.duration]`" requirement.
- **L. Keyboard conflicts**: Space already toggles play/pause (`use-keyboard-shortcuts.ts`, dispatching a `subly:toggle-play` custom event), already correctly guarded by the file's blanket `isTypingTarget`/`isAnyDialogOpen` checks (covers caption textareas, the P19.3 timecode input, and any other input/dialog). Not modified — already correct.
- **M. React state vs. DOM video state**: the real DOM `<video>` element is authoritative; React/store state is a read-model mirror. No dual clock.
- **N. `requestAnimationFrame`**: not used anywhere for playback (confirmed by a full-tree grep — the three matches found are all unrelated: an autosave/focus-scheduling comment and a Tab-focus mechanism). Playback is purely event-driven (`onTimeUpdate`), matching this task's own critical architecture rule exactly as it already stood.
- **O. Partial/duplicated scrubbing**: none found — one single `startScrub`/`onScrubMove`/`endScrub` implementation, shared by the ruler and the playhead handle, both driving the one canonical `timeFromClientX` → `seek()` path.

**Classification**: click-to-seek, playhead scrubbing, waveform delegation, auto-scroll, and manual-scroll suppression were all **already working**. The pointercancel gap and the auto-scroll/scrub interaction were **genuinely missing/unsafe**. The upper-bound clamp was a **genuinely missing** boundary case. Nothing required a redesign.

## 5. Playback architecture

Unchanged. The real `<video>` element remains the sole playback clock; `seek()` remains the one mutation path into it; no new state machine, no RAF-based simulation, no second `currentTime`.

## 6. Click-to-seek

Not redesigned — already fully correct in its core mapping. One fix applied: `timeFromClientX` now clamps its result to `[0, duration]` via P19.3's own `clampTimelineTime` (reused, not duplicated) rather than only clamping the lower bound. `duration` is read fresh via `useEditorStore.getState()` inside the callback (not closed over), so `timeFromClientX`'s own memoized identity — and everything that depends on it — doesn't need to change just because duration became a second input.

Live-verified: click-to-seek exact at default zoom (4.00s exact click landed at exactly 4.000000...), at min zoom (20px/s), at max zoom (220px/s), after Fit Project, after Fit Selection, after a P19.1 captions-panel resize, after a P19.1 timeline-height resize, and at the exact `t=0` and `t=duration` boundaries (a click far past the visual track — deliberately probing the newly-fixed upper clamp — landed on exactly `00:12.00`, never beyond).

## 7. Playhead scrubbing

Not redesigned — already fully correct (pointer capture, ruler-wide drag target, dedicated playhead handle, shared `seek()` path). One fix applied: `onPointerCancel={onPointerUp}` added to the main track/scroll container (mirroring `TimelineWordHandles`' own already-established convention), so a pointer that ends via `pointercancel` cleans up identically to one that ends via `pointerup` — no stuck scrub state.

Live-verified (both via real mouse drags through the browser and, for the long-timeline/deep-scroll scenarios where real pointer coordinates were impractical, via dispatched `PointerEvent` sequences): a normal scrub-then-release leaves zero residual "scrubbing" visual/ref state; a scrub interrupted by `pointercancel` (no `pointerup` at all) — directly reproducing the pre-fix failure mode — was confirmed to leave `scrubbingRef` correctly cleared (a subsequent bare `pointermove` with no drag in progress produced no seek at all, proving the flag wasn't stuck "on").

## 8. Scrub/playback semantics

Phase 0 found NO existing convention for "pause on scrub start, resume on release" — `startScrub`/`endScrub` never touched `isPlaying` before this task, and nothing elsewhere in the codebase implied that convention. Per the task's own explicit "do NOT implement this automatically if existing behavior clearly establishes a different convention" instruction, this was deliberately NOT added: scrubbing while the video is playing simply re-seeks it on every pointermove, and playback continues uninterrupted from wherever the drag leaves it — tested and confirmed both while paused and while actively playing (a real "Go to time" commit mid-playback, reused from P19.3's own established pattern, landed exactly on the typed target with `paused === false` immediately after).

## 9. Auto-scroll

Not redesigned — reused verbatim. One fix applied: `scrubbingRef.current` added to the effect's existing "skip while a drag is active" guard, alongside the pre-existing `dragState.current || trimDragRef.current`. Live-verified on the seeded long-timeline fixture (§15): with the video playing and `scrollLeft` deliberately mismatched from the playhead's real position, auto-scroll was confirmed to actively correct `scrollLeft` once the pre-existing manual-scroll-suppression window (1500ms) elapsed — proving the mechanism is genuinely live in this environment — and, separately, a real ruler drag while the video was NOT actively fighting for scroll position confirmed selection/scroll stability. A fully clean, isolated live capture of "auto-scroll reaching for the exact same tick a scrub is also mutating currentTime" was difficult to pin down through this session's browser-automation tooling (see §20) — the fix's correctness rests primarily on exact structural parity with the already-proven `dragState`/`trimDragRef` guard this same effect already relied on for the caption-edge/trim-drag case, not on a from-scratch mechanism.

## 10. Zoom interaction

Verified at MIN_PX_PER_SEC (20), MAX_PX_PER_SEC (220), after Fit to Project, and after Fit to Selection: `currentTime` never changes as a result of a zoom action alone (unchanged from P19.2); click-to-seek's x→time mapping stays exactly correct at every one of these zoom levels (§6); `scrollLeft` remains within `[0, maxScrollLeft]` throughout.

## 11. P19.1 resize interaction

Verified: captions-panel resize wider, and timeline-height resize, each followed immediately by a click-to-seek — both landed on the exact expected time against the NEW (post-resize) viewport width, with zero drift. Persisted panel-size preferences were not touched by any playback/scrub action (confirmed via `localStorage` reads before/after).

## 12. Selection behavior

Click-to-seek and scrubbing were confirmed, by direct code reading, to call ONLY `seek()` — no `selectSubtitle`/`toggleSubtitleSelection`/`selectWord` call exists anywhere in `onTrackClick`/`startScrub`/`onScrubMove`/`endScrub`. This is pre-existing, correct behavior; this task did not need to invent or change any selection semantics. Live-verified: a single caption selection, a multi-selection (including a non-contiguous one), and a selected word (CHARLIE, from the non-monotonic fixture, with its own popover left open) all survived a click-to-seek and a scrub drag unchanged. (Escape's own pre-existing, separately-documented "clear selection" shortcut is unrelated to click-to-seek/scrubbing and was not touched.)

## 13. Non-monotonic word safety

Playback/scrubbing never reads word data at all (`seek()` takes a plain number; `timeFromClientX` never consults `words`), so there is no code path that could ever confuse array position with chronological order here — verified both by code review and by a dedicated regression test (`editor-store-playback-scrub.test.ts`, test 12) that scrubs across every boundary of the task's own worked example (`BRAVO[2,3]`, `DELTA[5,6]`, `CHARLIE[3.5,4.5]`, non-monotonic array order) and asserts each word's own timestamp is exactly unchanged afterward.

## 14. Boundary behavior

Live-verified exact values (no NaN, no negative, no >duration, no stuck state) at: `t=0` (click at the track's own left edge), the project's own duration boundary (click far past the visual track, both at the exact 800px-floor edge and further beyond), a caption start/end (1.75/6.00), and a word start/end (3.5/4.5, the non-monotonic CHARLIE). Pure tests (`click-to-seek.test.ts`) cover the same boundaries plus adversarial (`NaN`/`±Infinity`/huge) offsets, asserting the result is always finite and within `[0, duration]`.

## 15. Performance

No React-tree-expensive work was added; the fixes are a one-line JSX prop, a one-line guard addition, and a swap to an existing clamp helper. Verified on a seeded 1800-caption, metadata-declared-60-minute fixture (`p19-4-long-timeline-qa` — see §19 for why a fresh fixture was needed and its one honest limitation): only 9–13 caption DOM blocks mounted at any time despite 1800 captions and a 252,000px-wide (later scrolled to a much larger offset) virtual track; a single click-to-seek at a deep-scrolled position (150,000px in) resolved in 0.4ms; a simulated 60-pointermove scrub sequence at that same depth completed in 4.4ms total (~0.07ms/move) with zero visible lag and the DOM block count staying small throughout.

## 16. Accessibility

No new interactive controls were added by this task (the click-to-seek/scrub gestures already existed and are pointer-only, matching the task's own "pointer-only scrubbing does not require inventing a keyboard alternative" allowance — P19.3's timecode/Start-End/caption/word controls already provide the keyboard-accessible precise-navigation alternative). No redundant shortcuts were added.

## 17. Persistence

Nothing new persisted. Playback position, scrub state, and zoom remain ephemeral (matching P19.2/P19.3's own established decisions) — confirmed via reload: a fresh load always starts at `00:00.00`, never a leftover scrub/playback position.

## 18. Regression coverage

- `lib/timeline/__tests__/click-to-seek.test.ts` — 10 tests: click-to-seek mapping, t=0 clamp, duration clamp (the fixed bug, reproduced against the exact 800px-floor scenario), fractional-time seek, min-zoom/max-zoom mapping, caption-boundary and word-boundary (non-monotonic) exact values, adversarial-input safety (no NaN/negative/stuck), and duration-unavailable fallback.
- `store/__tests__/editor-store-playback-scrub.test.ts` — 6 tests: play/pause doesn't mutate project; a simulated scrub gesture (14 rapid `seek()` calls sweeping every caption/word boundary) creates zero undo entries and never dirties the project; single/multi/word selection all survive a play→scrub→pause sequence; the non-monotonic word fixture's exact timestamps survive scrubbing across every one of its own boundaries; and the mandatory full regression exercising a realistic play/scrub/pause/click-seek sequence against `project`, `subtitles`, `words`, `past`, `dirty`, `selectedSubtitleId`, and `selectedWordIndex` — all asserted reference-identical (or, for word/caption timestamps, byte-for-bit-equal) before and after.
- No existing test was weakened, deleted, or modified.
- Full suite: **1730/1730 passing** (+16 new tests over P19.3's 1714).

## 19. Live QA

Performed in the Claude Browser pane against the disposable `P19.3 Precision Navigation QA` fixture (3 captions including the non-monotonic BRAVO/DELTA/CHARLIE caption) and, for scale testing, a newly-seeded `P19.4 Long Timeline Scrub QA` fixture:

- Initial playhead/timecode matched on load; play/pause both worked and stayed synchronized with the P19.3 timecode display.
- Click-to-seek at a known coordinate landed on the exact predicted time (repeated at default/min/max zoom, after Fit Project, after Fit Selection, after both P19.1 resizes).
- Playhead drag (real mouse) while paused, and while playing (via a real "Go to time" commit mid-playback, since dragging a *real* mouse precisely mid-real-time-playback on a 12s clip proved awkward to time reliably through this tool — see §20): both landed exactly on target, with playback continuing uninterrupted in the mid-playback case.
- `pointercancel` cleanup: directly reproduced (pointerdown + pointermove, then a `pointercancel` with NO `pointerup` at all) and confirmed the scrub state cleared correctly — the fix's exact target scenario.
- `t=0`, project end, caption start/end, word start/end (non-monotonic CHARLIE: 3.5/4.5, never DELTA's 5.0/6.0), all exact.
- Zoom minimum/maximum, Fit Project, Fit Selection: click-to-seek stayed exact at every one.
- Captions-panel resize and timeline-height resize: click-to-seek stayed exact after each.
- Long-timeline fixture (1800 captions, metadata-declared 60-minute duration): DOM stayed virtualized (9–13 blocks) at a 150,000px scroll depth; click-to-seek and a 60-move scrub sequence both completed in single-digit milliseconds with zero lag; the duration-clamp fix confirmed live (a click at a real, viewport-relative position mapping to ~2147s correctly computed and clamped within `[0, 3600]` before the real, short underlying video file's own native duration further clamped actual playback — an honest fixture limitation, not a mapping bug, see §20).
- Auto-scroll: confirmed actively correcting a deliberately-mismatched `scrollLeft` during real playback once the manual-scroll-suppression window elapsed (proving the mechanism live); a held scrub sequence spanning past that same suppression window kept `scrollLeft` from being pulled away from the scrub's own target for as long as the scrub was held.
- Manual-scroll suppression itself (the pre-existing 1500ms window, unrelated to this task's own scrub-specific fix): observed behaving as already established.
- Single selection, multi-selection (including non-contiguous), and a selected word (CHARLIE, popover open) all survived click-to-seek and scrub drags unchanged.
- Console checked after every major action: the only errors observed were confirmed (by exact stack-trace line/column match to my own `javascript_exec` scripts) to be self-induced artifacts of dispatching untrusted, synthetic `PointerEvent`s for the deep-scroll/long-timeline tests — `setPointerCapture` legitimately rejects a pointer id that was never established by a real, trusted pointerdown. No error was ever produced by a real, computer-tool-driven mouse interaction, at any point in this session.
- Reload: confirmed a fresh load always starts at `00:00.00` with no leftover scrub/playback/zoom state.

## 20. NOT TESTED

Being explicit per this task's own "be honest about anything not live-tested" instruction:

- **A fully clean, isolated live capture of auto-scroll actively reaching for a correction at the EXACT same instant a scrub is also mutating `currentTime`, while the video is genuinely playing**, was not obtained. Two contributing factors: (1) this session's own browser-automation round-trip latency is a meaningful fraction of the 12-second disposable fixture's own real duration, repeatedly causing the video to reach its natural end between an action and the next observation before a scrub-while-playing window could be reliably held open (the same testing-methodology limitation P19.3's own report already noted for its "seek mid-playback" check); (2) dispatching synthetic, untrusted `PointerEvent` sequences to simulate a longer held scrub does not reliably reproduce a real pointer-capture gesture's exact timing (see the `setPointerCapture` `NotFoundError`s in §19). What WAS directly confirmed: auto-scroll is genuinely live and corrects a real mismatch during real, unassisted playback (no scrub in progress); and a real, briefly-held scrub does not fight against a stale `scrollLeft`. The fix's correctness for the exact interleaved case rests on structural parity with the codebase's own already-proven `dragState`/`trimDragRef` guard, not on an isolated reproduction of the race itself.
- The long-timeline fixture's own actual video PLAYBACK beyond its real ~12 seconds of decodable content always clamps to that real duration, even though its declared metadata duration is 3600s (60 minutes) — this is a deliberate, honest limitation of the disposable fixture (reusing an existing short video file with an extended duration ONLY in its database metadata, the same approach P19.2's own report used for its 30-minute-scale testing), not a gap in the seek/clamp math itself, which was separately verified to compute and clamp correctly against the full declared 3600s range.
- No true, dedicated 30+ real-minute VIDEO file was available or created for this task (consistent with the same limitation P19.2/P19.3 already documented) — long-timeline DOM/scroll/click/scrub performance was verified at the equivalent DECLARED scale (1800 captions, a 60-minute nominal duration, deep scroll offsets in the hundreds of thousands of pixels), not against real multi-hour video decode.

## 21. Known limitations

- The `onPointerCancel`/auto-scroll-guard fixes are narrow, targeted additions to existing, already-battle-tested drag machinery — they do not change any drag's core behavior, only its edge-case robustness.
- The click-to-seek upper-duration-clamp fix changes observable behavior only in the previously-broken case (clicking in the empty trailing region of a short, low-zoom project) — every other click position is unaffected, confirmed by the full existing test suite passing unchanged.

## 22. Protected systems

Not touched: subtitle/caption/word timing and order, Split/Merge/Ripple Delete/Ripple Insert, caption/word resize or nudge, caption/word styles, quality analysis, autosave, undo/redo, project persistence, waveform source audio, export timing, ASS rendering, FFmpeg, Electron, database schema (the dev-only fixture seeding in §19 inserts rows through the existing, unmodified schema). Verified both by code review (every fix touches only `Timeline`-local pointer-event wiring, an auto-scroll guard condition, and a clamp call — never `project`/`subtitles`/`words`) and by the mandatory reference-equality regression test (§18) proving `project`, `subtitles`, `words`, `past`, `dirty`, `selectedSubtitleId`, `selectedSubtitleIds`, and `selectedWordIndex` are all unchanged after every playback/scrub path this task touches.

## 23. Database

No schema changes, no migrations, no production DB changes. (A second dev-only disposable fixture, `p19-4-long-timeline-qa`, was seeded under the same test account established in P19.3, through the existing, unmodified schema, solely for this task's own long-timeline live QA.)

## 24. Packaging

Not required. No Electron changes.

## 25. Final verification

- `npm test`: **1730/1730 passing**.
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, 5 pre-existing warnings (unchanged).
- No existing test was weakened, deleted, or modified.
- Version remains 0.1.17.

## 26. P19.5

NOT STARTED.
