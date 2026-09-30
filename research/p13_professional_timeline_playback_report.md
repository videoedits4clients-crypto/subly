# P13 — Professional Timeline & Playback Editing Workflow — Final Report

## 1. Status

**PASS.**

## 2. Task ID

100742

## 3. Version

0.1.13 → **0.1.14** (bumped only after the full test suite, typecheck, lint, dev QA, and packaged Windows QA all passed).

## 4. Phase 0 audit

Read in full before any code change: `timeline.tsx`, `waveform.tsx`, `video-canvas.tsx`, `subtitle-overlay.tsx`, `captions-panel.tsx`, `editor-store.ts` (playback state, `updateSubtitleTiming`, `nudgeSubtitleTiming`, `nudgeSubtitles`, `seek`, `selectWord`), `use-keyboard-shortcuts.ts`, `keyboard-shortcuts-reference.ts`, and every `lib/timeline/*.ts` module plus their existing test files.

**Already worked correctly (confirmed by reading + re-running existing tests; reused unchanged):**
- **Time↔pixel mapping**: `lib/timeline/time-scale.ts`'s `timeToPixels`/`pixelsToTime` is already the ONE formula the ruler, waveform, and scrub/click-to-seek all share (`timeFromClientX` in timeline.tsx). No second coordinate system existed or was needed.
- **Snapping**: `lib/timeline/snapping.ts`'s `computeSnappedTiming` — magnetic-snap-in-pixels-converted-to-seconds against the previous/next caption and the playhead — already wired into every drag (`onPointerMove`), always passed through the existing overlap clamp afterward. Untouched.
- **Auto-scroll**: `lib/timeline/auto-scroll.ts`'s `computeAutoScrollTarget` — the existing 75%-safe-zone, minimal-nudge (never re-center), manual-scroll-suppression (1.5s) behavior — already correct per its own P7.1 doc comments and tests. Untouched, regression-tested (8/8 passing).
- **Zoom-anchor preservation**: `lib/timeline/zoom-anchor.ts` — playhead-if-visible-else-viewport-center anchor, preserved across a zoom level change. Untouched, regression-tested (8/8 passing).
- **Virtualization**: both the timeline's own `filterVisibleSubtitles` (horizontal, time-based) and the captions panel's `computeVisibleRange` (vertical, row-based) already existed and already worked. Confirmed LIVE at 1,800 and 5,400 captions that only ~12–17 DOM nodes are ever mounted in either panel regardless of total caption count.
- **Waveform caching**: `waveform.tsx` fetches peak data once per project and draws a canvas capped to viewport+buffer width (never the full track) — already correct, untouched.
- **Caption timing mutation**: `updateSubtitleTiming` is already the SINGLE mutation path every drag, `nudgeSubtitleTiming` (Alt+←/→), and `nudgeSubtitles` (batch) funnel through — overlap clamp, `MIN_CAPTION_DURATION_SEC` floor, word-shift-on-move vs. word-clamp-on-resize (P7.3's `clampWordsToCaptionBounds`) were all already correct and already the one true implementation.
- **Playback non-per-frame updates**: `video-canvas.tsx`'s `onTimeUpdate` already drives `currentTime` from the native `<video>` `timeupdate` event (browser-throttled, not a `requestAnimationFrame` loop) — the "do not update React state every 16ms" requirement was already satisfied architecturally before this task.
- **Multi-selection**: Ctrl/Shift-click, Ctrl+A, and selection pruning on delete were already correct (Task 94820/P8) and already shared between the captions panel and the timeline via the same `selectedSubtitleIds`.

**Already existed but as THREE independent, duplicate inline copies of the identical logic (consolidated, not rewritten):**
- "Active caption" (`currentTime >= s.start && currentTime < s.end`) existed independently in `video-canvas.tsx` (picking the preview's overlay subtitle) and `timeline.tsx` (the per-block `isActive` flag).
- "Active word" (`currentTime >= w.start && currentTime < w.end`) existed only in `subtitle-overlay.tsx`'s karaoke word-highlight, with no equivalent anywhere in the actual EDITING UI (captions panel, timeline).

**Genuinely missing (the real P13 work):**
1. No active-word indicator anywhere in the editing UI (captions panel word chips, timeline word ticks) — only the read-only preview overlay had one.
2. No compact START/END/DURATION display — every caption row showed start→end, but never duration.
3. No way to move a caption's own start/end to the current playhead ("set in"/"set out") — objective 8's entire feature.
4. No "jump to the SELECTED caption's own start/end" shortcut. **Audited J/K first, per the task's own explicit instruction**: J/K/L are already bound to standard NLE transport (J = jump to the nearest caption edge BEFORE the current playhead among ALL captions / rewind 5s if none; K = pause; L = play, or jump to the nearest edge AFTER the playhead) — a related but genuinely different operation from "seek to exactly the caption I have selected" (e.g. after a Ctrl/Shift-click multi-select, which deliberately never moves the playhead). J/K were correctly NOT repurposed; **Home/End** (completely unused, confirmed by reading the whole hook) were used instead.

## 5. Existing infrastructure reused

`updateSubtitleTiming` (the only place caption timing is ever actually written), `MIN_CAPTION_DURATION_SEC`, `clampWordsToCaptionBounds`, the shared time↔pixel mapping, `computeSnappedTiming`, `computeAutoScrollTarget`, `computeZoomAnchor`/`computeZoomScrollLeft`, both virtualization modules, the existing `isTypingTarget`/`isAnyDialogOpen` keyboard guards (in their existing position in the guard chain), and the existing `keyboard-shortcuts-reference.ts`/its cross-check test. No new coordinate system, no new nudge implementation, no new selection system, no new word-redistribution logic, no database schema change.

## 6. Playback behavior

Unchanged: playback is still driven entirely by the native `<video>` element's own `play()`/`pause()`/`timeupdate` events (Space, K, L all dispatch to the same imperative handlers already in `video-canvas.tsx`, preserving the user-gesture chain exactly as before). No new playback loop, no new state machine.

## 7. Active caption behavior

New shared pure module `lib/subtitles/playback-context.ts`: `isTimeWithinCaption`/`findActiveCaption`, an exact extraction of the two pre-existing, independent, identical inline checks — behavior unchanged, now one canonical definition. `video-canvas.tsx` and `timeline.tsx` both refactored to call it (one-line changes, zero behavior change, confirmed by the full test suite still passing). Overlap tie-break (malformed/legacy data) is `Array.prototype.find`'s "first in array order," which — since `editor-store.ts` always keeps `subtitles` sorted by `start` after any mutation — is "earliest-starting caption wins," the exact same rule the app already had. Verified live (dev + packaged) against real production data: the timeline block for whichever caption the playhead is inside gets a distinct cyan border/dot; no other caption does.

## 8. Active word behavior

Same module's `findActiveWordIndex` — an exact extraction of `subtitle-overlay.tsx`'s pre-existing karaoke-highlight formula, now reusable. Wired into two places:
- **Captions panel**: the word-chip row was extracted into its own small component, `WordChips`, which subscribes to `currentTime`/`isPlaying` DIRECTLY from the store (bypassing props) — this confines the "re-render on every `timeupdate`" cost to exactly the one row that can ever show it (the selected caption's own row; every other row already receives `words: null` and never renders this block at all), not the whole panel.
- **Timeline**: the existing selected-word highlight block (already gated on `isSelected`) gained a second, cyan highlight box for the active-playback word, drawn only when it differs from the selected word (no double-drawing when they coincide).

**Selected vs. playing are genuinely separate, verified live**: selected a word (accent/purple), then played through a DIFFERENT word (cyan) — both visible simultaneously, in both the captions panel and the timeline. Paused: the cyan active-word highlight disappeared immediately; the purple selected-word highlight stayed exactly as it was — matching the task's explicit "pausing preserves selected word; active playback word can disappear" requirement, confirmed by direct DOM inspection at each step (not just visually).

## 9. Timeline seeking

Click-to-seek, scrub-drag, and the ruler all still funnel through the one `timeFromClientX`/`pixelsToTime` path — unchanged. Verified live: a click at a specific screen pixel produced a `currentTime` matching the visible ruler labels at that position. The underlying formula itself remains covered by `time-scale.test.ts` (7/7 passing) for the beginning/middle/end/zoomed/scrolled/long-duration cases the task calls out — no behavior change meant no new tests were needed for the mapping itself.

## 10. Timing adjustments

**New**: `setSubtitleBoundaryToPlayhead(id, edge)` (editor-store.ts) — "set in"/"set out." A new pure validator, `lib/timeline/boundary-to-playhead.ts`'s `resolveBoundaryToPlayhead`, decides UP FRONT whether the request is legal (negative time, would overlap the previous/next caption, would violate the minimum duration, or the playhead is already exactly at that boundary — all four reject outright, no clamping to some other value the user didn't ask for). Only when valid does the store action call the EXISTING `updateSubtitleTiming` — so the actual mutation (overlap clamp, min-duration floor, word-bounds clamping) is never re-implemented, only gated. An invalid request makes **zero** calls to `commit()` — no history entry, no partial mutation, verified by a dedicated store test asserting `past.length` is unchanged on rejection.

Exposed via two new timeline toolbar buttons ("Set selected caption's start/end to playhead"), disabled without a selection, with a toast on rejection. Verified live in both dev QA (synthetic fixture) and packaged QA (real production Gujarati captions, moving the LAST caption's end into the video's own trailing runway) — including the reject path (playhead inside the previous caption → no-op, toast shown, timing genuinely unchanged) and undo/redo round-tripping the change exactly.

**Regression-verified unchanged**: Alt+←/→ single-caption nudge (frame-accurate, duration-preserving) and batch nudge (non-contiguous multi-selection, shared delta, relative spacing/zero-gap preserved) — both exercised live with real drag/keyboard input, both producing exactly the expected before/after timing, both a single undo step.

## 11. Snapping

Unchanged (`computeSnappedTiming`, still only ever applied inside `timeline.tsx`'s own drag handler, per this task's own "do not create a second nudge implementation" — `setSubtitleBoundaryToPlayhead` deliberately does NOT invoke it: the boundary value there is already an exact `currentTime`, not a fuzzy mouse pixel position, so there is no continuous-drag imprecision to correct — see the store action's own doc comment). Regression-verified live: a real `PointerEvent`-driven resize-drag on a timeline block's edge handle produced the exact expected `start`/`end`, confirming the drag→snap→clamp→commit pipeline still executes correctly end to end.

## 12. Multi-selection

Unchanged. Verified live: Ctrl+click across two contiguous captions plus one separate (non-contiguous) caption produced identical "3 selected" state in both the captions panel header and the timeline's own per-block styling; a batch Alt+← nudge moved all three together by the same delta in one commit, preserving the zero-gap adjacency between the two contiguous ones exactly; one `undo` reverted the whole batch.

## 13. Zoom/auto-scroll

Both unchanged, both regression-tested (8/8 zoom-anchor, 8/8 auto-scroll passing) and spot-checked live (Zoom In/Out buttons grow/shrink the track width correctly; a 30-minute-duration project renders a proportionally wide track — `1,800s × 70px/s = 126,000px`, confirmed exactly via live DOM measurement — while virtualization keeps only ~17 rows mounted).

## 14. Performance measurements

- **5,400 captions**: only 17 captions-panel rows and 12 timeline blocks mounted at any time (virtualization intact). 1 second of real playback advanced `currentTime` by ~0.96s of wall-clock video time with no observed stutter/freeze; DOM mount count stayed constant throughout.
- **1,800 captions / 30-minute duration**: same virtualization result; timeline track width verified to be exactly `duration × pxPerSec` with no cap defeat.
- **Automated**: the existing 5,400-caption performance tests across `duplicate-timing`, `batch-text-ops`, `text-cleanup`, and the P12 quality-navigation suite all continue to pass well under their time budgets (unaffected by this task, confirming no incidental regression).
- No new per-frame React state was introduced: the only new store field read every `timeupdate` (`currentTime`) is the same field `video-canvas.tsx`, `timeline.tsx`, and now the new `WordChips` subcomponent already needed — and `WordChips` is deliberately the ONLY new subscriber, scoped to a single row.

## 15. Tests added

- `lib/subtitles/__tests__/playback-context.test.ts` — **13** tests (`isTimeWithinCaption`/`findActiveCaption`/`findActiveWordIndex`: inclusive/exclusive boundaries, gaps, empty lists, overlap tie-break, the `null`-not-`-1` convention).
- `lib/timeline/__tests__/boundary-to-playhead.test.ts` — **17** tests (both edges: valid move, no-op rejection, negative-time rejection, previous/next-overlap rejection including the exact-flush-is-OK boundary, minimum-duration rejection including its own exact boundary, and the no-neighbor case).
- `store/__tests__/editor-store-undo-redo.test.ts` — **10** new tests (177–186): valid start/end moves, overlap rejection (both directions) with **zero history entries**, minimum-duration rejection, true-no-op rejection, nonexistent-id safety, the word-bounds-clamp interaction (reusing the exact existing P7.3 clamp, verified word-by-word), and undo/redo round-tripping.
- `lib/keyboard-shortcuts-reference.ts` + its own cross-check test — Home/End added to both, keeping the "every real hook shortcut has exactly one reference entry, and vice versa" invariant intact.

## 16. Full test count

**866 / 866** passing (826 baseline + 40 new: 13 + 17 + 10).

## 17. Typecheck

`tsc --noEmit` — clean, 0 errors.

## 18. Lint

`eslint` — **0 errors**, the same 5 pre-existing, unrelated warnings as before this task.

## 19. Dev QA

Against an isolated `prisma/dev.db`, a disposable project reusing a REAL playable video file (copied into a fresh project's own upload directory so the file-serving route's ownership check resolves correctly) with short captions, a gap, zero-gap adjacent captions, word-level timing, a multi-line caption, and room-to-maneuver captions was created and exercised live:

- Play/Pause: confirmed via direct `<video>` state and wall-clock-matching `currentTime` advancement.
- Active caption: cyan highlight tracked the playhead correctly through a gap (no caption highlighted) and into the next caption.
- Active word vs. selected word: verified as two independently-visible states (captions panel AND timeline), and that pausing clears only the active one.
- Click-to-seek: a specific pixel click produced the expected `currentTime`.
- Nudge (single + batch, non-contiguous): exact frame-accurate deltas, duration/adjacency preserved, one undo step each.
- Resize via a real `PointerEvent` drag on the timeline's edge handle: exact expected new duration.
- `setSubtitleBoundaryToPlayhead`: both the accept path (Duration display updates correctly) and the reject path (overlap with the previous caption → no mutation) verified.
- Home/End: seek to the selected caption's own start/end confirmed exact; BOTH correctly blocked while a caption's textarea is focused (typing-target guard).
- Multi-selection consistency between the captions panel and timeline; zoom in/out; a 5,400-caption AND a 1,800-caption (30-minute) project both confirmed virtualized and responsive.
- Undo/redo, autosave ("Saved" indicator), and a full page reload all confirmed to persist a boundary-to-playhead edit exactly.
- Export dialog opens without crashing; no dialog-overlay click-blocking regression after closing it.

## 20. Packaged Windows QA

Built, installed (silent `/S`), and launched **0.1.13** first (pre-bump validation build), then rebuilt/reinstalled/relaunched **0.1.14** (the final, shipped build) after all QA passed.

Used a **disposable duplicate of a real production project** (`rishab guj` → `rishab guj (copy)`, created via the app's own "Duplicate" action — 43 real Gujarati captions):
- Spacebar guard: confirmed blocked while a caption textarea is focused (dispatched directly on the focused element, matching how a real keydown bubbles); confirmed working (play toggled) when nothing is focused.
- Alt+← guard: confirmed blocked while typing (this real transcript's captions are all flush/zero-gap with each other, so a positive "moved" nudge assertion wasn't demonstrable here, but the guard itself — the thing this packaged pass specifically needed to re-verify — was).
- Active-caption highlight: confirmed live against real captions (the cyan-highlighted timeline block matched the playhead's actual position).
- `setSubtitleBoundaryToPlayhead`: moved the LAST real caption's end from 58.11s to 60.00s (into the video's own trailing runway) — accept path; undo/redo round-tripped it exactly.
- Home/End: confirmed present in the Keyboard Shortcuts reference dialog.
- No dialog-overlay click-blocking regression after closing the Keyboard Shortcuts dialog.
- Autosave + full reload: the boundary edit persisted exactly.
- Export dialog opens without crashing.
- Cleaned up: moved the duplicate to Trash, then permanently deleted it via the existing type-to-confirm flow.
- Final 0.1.14 launch smoke test: opened the real, unmodified `rishab guj` project and confirmed its captions still load correctly.

## 21. Production DB comparison

Backed up `subly.db` to `subly.db.bak-pre-p13-timeline-playback-qa` before QA. After the duplicate-edit-undo-redo-delete cycle, a row-level JSON comparison (Project, Subtitle, VideoAsset, ExportJob, SubtitlePreset — excluding only `updatedAt`) showed:

```
Project: before=19 after=19 diffs=0
Subtitle: before=2266 after=2266 diffs=0
VideoAsset: before=19 after=19 diffs=0
ExportJob: before=46 after=46 diffs=0
SubtitlePreset: before=0 after=0 diffs=0
TOTAL_DIFFS 0
```

Byte-identical. Backup file and the comparison script were deleted after use.

## 22. Installer size/path

`release/SUBLY Setup 0.1.14.exe` — **566,401,081 bytes** (~540 MB), with `SUBLY Setup 0.1.14.exe.blockmap` at 572,018 bytes. EXE `FileVersion`/`ProductVersion` and the installer's own `FileVersion`/`ProductVersion` both confirmed `0.1.14`; the compiled JS bundle contains the literal baked-in string `"SUBLY Desktop v0.1.14"`.

## 23. Known limitations

- `setSubtitleBoundaryToPlayhead` does not apply the drag-style magnetic snap to the playhead-derived value (see §11) — a deliberate design choice (the value is already exact, not a fuzzy pixel position), documented in the store action's own doc comment, not an oversight.
- The active-word/active-caption highlight is purely visual; it does not scroll either panel to keep the active caption/word in view during playback (only SELECTION already does that, unchanged from before this task) — the spec's own objective 1 explicitly said "do NOT necessarily change editor selection... avoid causing selection churn during playback," which this respects by construction.
- Home/End seek to the selected caption's exact start/end; they do not wrap or clamp to a "nearest" caption the way J/L do — a deliberate difference (see §4) since they answer a different question ("where does MY selection start/end" vs. "what's the next edit point from here").

## 24. Deferred / non-goals (explicitly out of scope per the task spec, confirmed untouched)

A full DAW/NLE timeline, a second timeline coordinate system, a second nudge/resize implementation, a second selection system, disabling virtualization, per-animation-frame React state updates, fabricated word timings, silent content changes, any new keyboard shortcut beyond the two genuinely-missing ones (Home/End) audited and justified above, and any database schema change (none was needed).
