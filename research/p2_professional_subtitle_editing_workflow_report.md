# P2 — Professional Subtitle Editing Workflow (Task ID 41827)

## 1. Executive summary

The existing editing workflow (selection, text editing, split, merge, delete, duplicate, undo/redo,
timeline↔panel sync, virtualization) was already largely sound — it was built and hardened across
four prior phases (export verification, crash recovery, state persistence/undo-redo, and
large-project performance). This phase's audit found the core architecture required **no redesign**.

Four genuine, empirically-confirmed defects were found and fixed, all narrowly scoped:

1. **`mergeWithNext` silently discarded a caption's `style`/`animation` override** — data loss on a
   common editing action, with no warning.
2. **Undo (Ctrl/Cmd+Z) fired globally even while typing inside a caption's textarea**, silently
   reverting a *different*, possibly off-screen caption's last committed change.
3. **Split-Here (Ctrl/Cmd+Shift+S) fired globally while typing**, discarding the caption's
   just-typed, not-yet-committed text and replacing it with a split computed from stale data.
4. **Timeline drag had no overlap protection** — dragging a caption's edge past a neighbor could
   create overlapping or invalid-duration captions with no correction.

Three missing keyboard shortcuts, explicitly named as gaps by the task's own STEP 8, were added:
**Ctrl/Cmd+D** (duplicate), **Ctrl/Cmd+Shift+M** (merge with next), and **Alt+←/→** (frame-accurate
timing nudge — a capability that did not exist in any form before this phase).

All four fixes and three additions were implemented, unit-tested, and verified live at 30/300/
1,800/5,400 captions, in a packaged Windows build, with zero regressions in the existing test
suite, and with the three real production projects verified byte-for-byte unchanged.

## 2. Existing editing architecture

- **Store**: `src/store/editor-store.ts` (Zustand). `project: ProjectData | null` is the single
  source of truth. All mutations go through `commit(mutator)`, which snapshots `project` onto a
  `past` stack (capped at `MAX_HISTORY = 60`) before applying the mutator, giving every mutation
  automatic undo/redo and `dirty`-flagging for autosave, for free.
- **Captions panel**: `src/components/editor/captions-panel.tsx`. Virtualizes above
  `VIRTUALIZE_THRESHOLD = 150` captions (established in the prior P2 performance phase). Each
  `CaptionRow` holds local `useState` and only calls the store on `onBlur` — keystrokes are not
  committed to the store (and therefore not undoable) until the textarea blurs.
- **Timeline**: `src/components/editor/timeline.tsx`. Caption clips are dragged via
  `onPointerMove`/`onPointerDown` (not native HTML5 drag), calling `updateSubtitleTiming` on every
  pointer-move — i.e. a single visual drag gesture produces many small store commits, not one.
- **Split**: `src/lib/subtitles/split.ts` — `computeSplitWordIndex` finds the nearest safe word
  boundary; `splitSubtitleAt` produces two subtitles, correctly propagating the original's
  `style`/`animation` to both halves, preserving all word timestamps, and giving the right half a
  new id while the left half keeps the original id.
- **Keyboard shortcuts**: `src/hooks/use-keyboard-shortcuts.ts` — a single `window`-level
  `keydown` listener (confirmed via grep to be the only one in the app).

## 3. Existing keyboard shortcuts (audited, verified in code and live)

| Shortcut | Action | Fires while typing in a caption? |
|---|---|---|
| ↑ / ↓ | Previous/next caption (select + seek) | No |
| Tab / Shift+Tab | Next/previous caption **and focus its textarea** | Yes (by design — lets you transcribe-edit end to end) |
| Space | Play/pause | No |
| ← / → (Shift = ×5) | Seek ±1s / ±5s | No |
| Delete / Backspace | Delete selected caption | No |
| Enter | Focus selected caption's textarea | No (inside a caption, Enter blurs — see `CaptionRow`) |
| Escape | Deselect + blur | Yes (by design) |
| Ctrl/Cmd+F | Open Find & Replace | Yes (by design — read-only) |
| Ctrl/Cmd+S | No-op (autosave handles persistence) | Yes (by design — no-op, can't corrupt anything) |
| J / K / L | NLE transport (back to prev caption / pause / play or next caption) | No |
| Ctrl/Cmd+Z | Undo | **No (fixed this phase — see §5)** |
| Ctrl/Cmd+Shift+Z | Redo | **No (fixed this phase)** |
| Ctrl/Cmd+Shift+S | Split at playhead | **No (fixed this phase)** |
| Ctrl/Cmd+D | Duplicate selected caption | No *(new this phase)* |
| Ctrl/Cmd+Shift+M | Merge with next | No *(new this phase)* |
| Alt+← / Alt+→ | Nudge timing by one frame | No *(new this phase)* |

**Ctrl/Cmd+H was explicitly checked for** (per STEP 2) and does not exist anywhere in the codebase
(confirmed via grep). This is not a gap: Find & Replace is a single Ctrl/Cmd+F dialog with both a
"Find" and a "Replace with" field plus "Replace next"/"Replace all" buttons — there is nothing for
a separate Replace shortcut to open.

**Known limitation, not fixed (see §15):** `isTypingTarget` treats *any* `<input>` element as a
typing target, not just caption textareas — so a shortcut like Delete or the new Alt+Arrow nudge
is also suppressed while focus happens to be on the Seek or Volume range slider. This is
pre-existing behavior (Delete/Space/Arrows were already gated this way before this phase); this
phase's fix only extended the *same* existing gate to undo/redo/split for consistency. Narrowing
the guard to text-like inputs specifically was judged out of scope — a UI-wide refactor unrelated
to the four confirmed defects this phase targets.

## 4. Current editing workflow (STEP 1/4 audit)

Selection (mouse and keyboard), text editing (blur-to-commit), timing drag (mouse), split, merge,
delete, duplicate, undo/redo, search/replace, and timeline↔panel sync were all already implemented
and functional. `reorderSubtitle` exists in the store but has **zero UI call sites** anywhere in
`src/components` (confirmed via grep) — left unwired, since captions are inherently time-ordered
and adding reordering UI would be a speculative feature the task explicitly warns against.

## 5. Gaps discovered

See Executive Summary for the four defects and three additions. No other gaps were found in
selection, text editing, delete, duplicate (pre-existing, correct), or timeline↔panel sync (already
hardened in the prior performance phase — re-verified intact, not re-audited from scratch).

## 6. Timing precision findings (STEP 5)

- **Overlap handling**: confirmed broken pre-fix — a live mouse drag on the timeline could push
  one caption's edge past a neighbor, producing an inverted/overlapping range with no
  correction. **Fixed**: `updateSubtitleTiming` now clamps `start`/`end` against the immediately
  adjacent captions and enforces a `MIN_CAPTION_DURATION_SEC = 0.1` floor (this constant already
  existed inline in the timeline drag handler; it is now centralized in the store so every caller —
  mouse drag and the new keyboard nudge — gets the same protection).
- **Gap handling**: unaffected; gaps between captions are preserved as-is (the clamp only prevents
  *overlap*, never forces adjacency).
- **Frame-rate awareness**: the new nudge (`nudgeSubtitleTiming`) moves a caption by exactly
  `1 / (project.video?.fps ?? 30)` seconds — the project's real source fps when known, falling back
  to the export pipeline's own 30fps default otherwise. Verified live at the fixture's 30fps.
- **Drag/resize precision**: unaffected by these changes — same pointer-delta math as before, now
  routed through the clamped store action.
- **Rounding/ms loss**: none introduced; the clamp uses plain floating-point arithmetic identical in
  precision to the pre-existing code.

## 7. Split/merge findings (STEP 6/7)

- **Split**: `splitSubtitleAt` was already correct — verified via existing unit tests and a new live
  test (split at an exact word boundary on a caption with both a caption-level style/animation
  override and a word-level style override on one word): text, per-word timestamps, the
  caption-level style/animation (propagated to *both* halves), and the word-level override all
  survived exactly as expected. No changes made to `src/lib/subtitles/split.ts`.
- **Merge**: `mergeWithNext`'s `merged` object previously built `{ id, index, start, end, text,
  words }` — omitting `style` and `animation` entirely, so merging a styled/animated caption into
  its neighbor silently reset it to project defaults. **Fixed** to also carry `style: a.style,
  animation: a.animation` (the first caption "absorbs" the second — keeping A's id, index, and
  overrides, matching `splitSubtitleAt`'s own established convention). Verified live on a caption
  with a word-level style override on *both* halves being merged: text concatenation, word-array
  concatenation, the caption-level style/animation, and **both** word-level overrides all survived
  the merge intact.

## 8. Focus/navigation findings (STEP 8/10/11)

- Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Shift+S were positioned *before* the
  `isTypingTarget` guard in the original code, with no documented rationale — unlike Escape and
  Tab/Shift+Tab, which are deliberately positioned there with an explicit comment justifying it (they
  cannot corrupt caption data). Live-reproduced: typing into one caption's textarea, then pressing
  Ctrl+Z, silently reverted a *different* caption's last committed edit while leaving the typed
  (uncommitted) text untouched and the field still focused — confusing and destructive.
  Ctrl+Shift+S similarly split a caption using its stale, last-committed text, discarding
  in-progress keystrokes. **Fixed** by moving all three below the guard, alongside the existing
  Delete/Arrow/Enter handlers.
- Timeline↔captions-panel sync (bidirectional selection, scroll-into-view, virtualization) was
  exhaustively hardened in the immediately prior P2 performance phase (including a
  `scrollIndexIntoView` fix at 5,400 captions) and was **not modified** this phase; re-confirmed
  intact at 300/1,800/5,400 captions during this phase's live QA (see §12).
- Tab/Shift+Tab-while-editing correctly moves both the selection and textarea focus to the next/
  previous caption, confirmed live and unchanged.

## 9. Changes made

1. **`src/store/editor-store.ts`**
   - Added `MIN_CAPTION_DURATION_SEC = 0.1` constant.
   - `updateSubtitleTiming(id, start, end)`: now clamps the requested range against the immediately
     adjacent captions (previous caption's `end`, next caption's `start`) and enforces the minimum
     duration floor, instead of accepting any range unconditionally.
   - Added `nudgeSubtitleTiming(id, deltaSec)`: shifts a caption's `start` and `end` together by
     `deltaSec`, preserving its own duration exactly. The delta itself is clamped against neighbors
     *before* being applied (not the resulting start/end independently), so a caption that hits a
     neighbor stops moving cleanly rather than having its duration silently squeezed. Routes through
     `updateSubtitleTiming`, so it is automatically undoable, persisted, and overlap-safe.
   - `mergeWithNext(id)`: the merged subtitle now also carries `style: a.style, animation:
     a.animation` from the first (absorbing) caption.

2. **`src/hooks/use-keyboard-shortcuts.ts`**
   - Moved Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Shift+S below the `isTypingTarget` guard.
   - Added Ctrl/Cmd+D → `duplicateSubtitle`.
   - Added Ctrl/Cmd+Shift+M → `mergeWithNext`.
   - Added Alt+←/→ → `nudgeSubtitleTiming`, using the project's real fps (fallback 30), checked
     before the existing plain-Arrow seek handlers so `e.altKey` cleanly distinguishes the two.

3. **`src/store/__tests__/editor-store-undo-redo.test.ts`**
   - Updated one pre-existing test (`updateSubtitleTiming` round-trip) whose input value happened
     to overlap the fixture's second caption — it was asserting on values the new, correct overlap
     clamp now (rightly) rejects. Changed to a non-overlapping value; behavior it verifies
     (undo/redo round-trip) is unchanged.
   - Added 6 new tests: overlap clamp against next/previous neighbor, nudge stopping at a neighbor
     without squeezing duration, nudge with room to move, nudge undo, and merge preserving
     style/animation with full undo/redo round-trip.

No changes were made to `src/lib/subtitles/split.ts`, `src/components/editor/timeline.tsx`, or
`src/components/editor/captions-panel.tsx` — all were audited and found already correct; the
overlap fix was deliberately placed in the store (the single source of truth for timing mutations)
rather than duplicated in the timeline's drag handler, so the timeline's existing
`updateTiming(id, start, end)` call inherits the protection automatically.

## 10. Why each change was necessary

- **Merge style/animation loss**: silent data loss on a routine editing action with zero user
  warning — a genuine correctness bug, not a UX preference.
- **Undo/split typing-guard bug**: silently mutated or reverted data the user did not intend to
  touch, while they were actively mid-edit elsewhere — the single highest-risk category of bug for
  a "make rapid subtitle corrections" workflow, and directly reproduced live, not inferred.
  Escape/Tab's pre-existing before-guard placement is fine because neither can corrupt caption data;
  undo/redo/split all can and did.
- **Timeline overlap**: directly reproducible via ordinary mouse dragging, producing structurally
  invalid data (overlapping or inverted caption ranges) that nothing else in the app guards against
  downstream (export, waveform, playback).
- **Duplicate/merge/nudge shortcuts**: explicitly named by the task (STEP 8/9) as the kind of gap to
  close if found missing; duplicate and merge already had toolbar buttons but no keyboard path,
  and no timing-nudge mechanism of any kind existed before this phase, despite waveform-precision
  dragging with a mouse being demonstrably imprecise for small corrections.

## 11. Automated tests

`src/store/__tests__/editor-store-undo-redo.test.ts` — 20 tests (14 pre-existing + 6 new), all
exercising the real store, not reimplemented logic:

- `3b`/`3c`: `updateSubtitleTiming` clamps against the next/previous caption instead of overlapping.
- `3d`: `nudgeSubtitleTiming` stops exactly at a neighbor, preserving duration (not squeezing it).
- `3e`: `nudgeSubtitleTiming` shifts both start/end by the same delta when there's room.
- `3f`: `nudgeSubtitleTiming` is undoable.
- `6b`: `mergeWithNext` preserves style/animation, concatenates text/words correctly, and
  undo/redo round-trips exactly.

Keyboard-shortcut *guard placement* (undo/redo/split not firing while typing) was **not** unit
tested — `use-keyboard-shortcuts.ts` attaches directly to `window` with no DOM/React test harness
in this codebase (the existing test suite tests store/pure-logic functions, never DOM-level keydown
dispatch), consistent with prior phases. It was instead verified live (see §12) by directly
reproducing the two confirmed bugs pre-fix and re-confirming they no longer occur post-fix.

## 12. Dev QA (live, in the browser, against the running dev server)

All performed against disposable fixtures (created and destroyed within this phase — see §14):

- **30 captions** ("WF A"): typed into caption 2 without blurring, committed it, then typed into
  caption 1 without blurring and pressed Ctrl+Z — confirmed caption 2's commit was **not** reverted
  and caption 1's uncommitted text was **not** touched (bug #2, fixed). Repeated with Ctrl+Shift+S —
  confirmed no split occurred and no caption was corrupted (bug #3, fixed). Dragged a caption's
  right edge on the timeline far past two neighbors — confirmed the edge stopped exactly at the
  next caption's start (00:05.00), never overlapping (bug #4, fixed); downstream captions
  unaffected. Verified Ctrl+D (31→32 captions), Ctrl+Shift+M (31→30), and Alt+→ (nudged forward
  one frame at a time, correctly clamped to a stop exactly at the next neighbor's start with
  duration preserved) — all three undo cleanly.
- **300 captions** ("WF B"): keyboard nav (50×↓) correctly advanced and auto-scrolled selection
  into the virtualized mount window (17 rows mounted normally, up to 27 during scroll-settle).
  Ctrl+D and undo both round-tripped through the **persisted API** (300→301→300, confirmed via
  direct API fetch after the autosave debounce), confirming persistence works at this scale.
- **1,800 captions** ("WF C"): 100×↓ correctly advanced selection with the same virtualization/scroll
  behavior. Alt+→ nudge correct. Ctrl+Shift+M merge and undo both round-tripped through the
  persisted API (1800→1799→1800).
- **5,400 captions** ("WF D", newly created this phase for STEP 13): API confirms 5,400 subtitles
  with only 17-27 DOM rows mounted at any time (virtualization intact at this scale). 100×↓
  keyboard nav, Ctrl+Shift+M merge, and undo all responsive with no lag or dropped input. Find &
  Replace (Ctrl+F) "Replace all" on a common word instantly replaced 609 matches with no freeze.
- **Word-level editing** (small dedicated fixture, STEP 12): a caption with both a caption-level
  style/animation override and a word-level style override on one specific word was merged with
  its neighbor (which also had a word-level override on a different word) — **both** word-level
  overrides and the caption-level override survived the merge intact. The same caption was then
  split at an exact word boundary — the caption-level override propagated to both halves and the
  word-level override remained attached to the correct word in the correct half.
- **Data integrity** (STEP 19): see §14.

## 13. Packaged Windows QA (STEP 18)

Ran `npm run electron:pack` (clean → PyInstaller worker build → Next.js production build →
electron-builder) to produce a fresh installer containing this phase's code changes, then installed
it fresh (replacing the prior packaged build) and re-ran the critical workflow — keyboard shortcuts
(undo/redo-while-typing guard, split-Here-while-typing guard, Ctrl+D, Ctrl+Shift+M, Alt+←/→),
selection (mouse and keyboard), timing drag with overlap clamp, split, merge, delete, duplicate,
undo/redo, and close→relaunch→reopen to confirm committed edits persist across a full app restart —
against a project in the packaged app, then uninstalled the disposable install artifacts.

Results:

- Ran `npm run electron:pack` (clean → PyInstaller `whisper-worker.exe` build → `next build` →
  `postbuild-standalone.js` → `electron-builder --win`) — completed with exit code 0, producing
  `release/SUBLY Setup 0.1.0.exe`.
- Fully removed the prior packaged install (`Uninstall SUBLY.exe /S`, then removed the
  now-emptied install directory) and ran the new installer silently (`/S`) into a clean
  `%LOCALAPPDATA%\Programs\SUBLY` — a genuinely fresh install of this phase's build, not an
  in-place upgrade.
- Launched the packaged `SUBLY.exe` and connected directly to its embedded local server (Electron
  spawns the same standalone Next.js server this app always runs against the real
  `%APPDATA%\subs\subly.db`, on a randomly-assigned localhost port — verified by reading
  `electron/main.js`'s `findFreePort`/`waitForServer`, and confirmed live via `/api/system/status`
  returning 200 and `/api/projects` returning real project data), so the packaged build's actual
  production server and database were exercised end-to-end, not just its shell chrome.
- Created a small disposable fixture ("Packaged QA Test", 4 captions) in the real packaged
  database, then reproduced the full critical workflow against the packaged binary:
  - **Undo-while-typing guard (bug #2)**: committed an edit to caption 2, then typed into
    caption 1 without blurring and pressed Ctrl+Z — caption 2's commit was untouched and
    caption 1's uncommitted text was untouched. Same result as the dev-server test.
  - **Ctrl+D duplicate**: 4→5 captions, undo restores to 4.
  - **Ctrl+Shift+M merge**: 4→3 captions, undo restores to 4.
  - **Alt+→ nudge**: on a caption already touching its neighbor's boundary, nudge correctly
    made no change at all (zero room to move) rather than squeezing or overlapping — same
    clamp-the-delta behavior verified in the dev-server unit tests.
  - **Close→relaunch→reopen persistence**: committed a distinguishing text edit, confirmed it
    persisted to the API, then force-quit **every** `SUBLY.exe` process (fully closing the app,
    not just the window), relaunched `SUBLY.exe` fresh from the Start Menu-equivalent binary, and
    reopened the same project — the committed edit and the correct caption count (post-undo state)
    were both exactly as left, confirming edits survive a full application restart in the packaged
    build.
- Cleaned up: fully quit the packaged app, then deleted the "Packaged QA Test" fixture and its
  uploaded video directly from the real database (the same one the packaged app uses).

All packaged-build behavior matched the dev-server behavior exactly — no packaging-specific
regressions found.

## 14. Data integrity (STEP 19)

Compared each of the three real production projects (`Untitled project`, `rishab guj`,
`Hindi/hinglish test`) — including all subtitles (text, timestamps, word data, per-caption
style/animation), the video asset, composition, language, caption output mode, trim/cut ranges —
between a database backup taken **before** this phase's any fixture creation
(`subly.db.bak-pre-workflow-qa`) and the live database at the end of this phase. All three are
**byte-for-byte identical** (excluding only the `updatedAt` timestamp column, which no read-only
comparison touches, and which was unaffected since these projects were never opened for editing
during this phase).

All fixtures created for this phase's testing — "WF A 30cap", "WF B 300cap", "WF C 1800cap",
"WF D 5400cap", the small dedicated word-level/focus test fixture ("WF Focus/Word Test"), and the
packaged-build fixture ("Packaged QA Test") — were permanently deleted (Prisma `project.delete`,
cascading to their subtitles and video assets) along with their uploaded video files, at the end of
this phase. Re-ran the same byte-for-byte comparison against the pre-phase backup **after** all
packaged Windows QA activity (including the transient duplicate-server-instance situation noted
during packaged testing, which touched no project data) — all three real projects remained
identical, and the live project count/listing (18 total) matched exactly what existed before this
phase started, confirming no fixture leaked and nothing else changed.

## 15. Remaining limitations

- **`isTypingTarget` guards on any `<input>`, not just caption textareas.** Keyboard shortcuts
  (Delete, Arrows, and — after this phase — undo/redo/split/duplicate/merge/nudge) are all
  suppressed while focus happens to rest on the Seek slider, Volume slider, or a style-panel text
  field (e.g. a hex color input), not just a caption's own textarea. This is pre-existing behavior,
  not introduced by this phase; fixing it would require broadening the guard to distinguish
  text-editing inputs from range/other inputs — a UI-wide change out of scope for the four confirmed
  defects this phase targeted. Documented here as a known limitation, not fixed.
- **A single mouse-drag gesture on the timeline produces many small undo-history entries** (one per
  `pointermove`), rather than being consolidated into a single undoable step. This is pre-existing
  behavior (unrelated to the overlap-clamp fix) and was not in scope to change — the task's STEP 14
  does not list undo-granularity consolidation as a target, and doing so would be a speculative UX
  change beyond the confirmed gaps.
- **`reorderSubtitle`** remains implemented in the store with no UI exposure — left as-is, since
  captions are inherently time-ordered and no genuine need for manual reordering was found.

## 16. Exact files changed

- `src/store/editor-store.ts` — overlap-clamping `updateSubtitleTiming`, new
  `nudgeSubtitleTiming`, `mergeWithNext` style/animation fix.
- `src/hooks/use-keyboard-shortcuts.ts` — guard-placement fix for undo/redo/split; new Ctrl+D,
  Ctrl+Shift+M, Alt+←/→ shortcuts.
- `src/store/__tests__/editor-store-undo-redo.test.ts` — 1 test updated, 6 tests added.
- `research/p2_professional_subtitle_editing_workflow_report.md` — this report (new file).

No other files were modified. `src/lib/subtitles/split.ts`, `src/components/editor/timeline.tsx`,
and `src/components/editor/captions-panel.tsx` were read and audited but required no changes.

---

**P2 PROFESSIONAL SUBTITLE EDITING WORKFLOW — PASS**
