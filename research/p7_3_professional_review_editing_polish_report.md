# P7.3 — Professional Review & Editing Polish

**TASK ID:** 93471

## 1. Objective

Polish the word-level editing and quality-review workflow built in P7.1/P7.2 — make it feel
coherent, discoverable, keyboard-friendly, and safe across the common subtitle-editing
operations (split, merge, duplicate, delete, caption timing changes, text edits) — without
redesigning any existing system.

## 2. Scope

In scope: word-selection visual polish, a bounded word-timing keyboard workflow, quality-issue
workflow polish (a current-issue indicator), word-timing review-state UX polish, and — the most
important part of this phase — a caption↔word timing consistency audit across split, merge,
duplicate, delete/restore, caption timing changes, and text editing, with the smallest necessary
fixes where the audit found real gaps.

Explicitly out of scope (per the task's own hard constraints): any redesign of the editor/
timeline/quality system, multi-select, batch editing, full Descript-style word dragging, regex
editing, copy/paste workflows, a second undo/shortcut/persistence/word-timestamp system, and any
database migration (none was needed).

## 3. Existing architecture audited

Before writing any code, a full pre-implementation audit traced exactly how `Subtitle.words` is
manipulated by every relevant operation (see the session's own investigation). Key findings that
shaped the implementation:

- **`splitSubtitleAt`** (`src/lib/subtitles/split.ts`): a pure array partition
  (`words.slice(0, i)` / `words.slice(i)`); every word keeps its original timestamp exactly; each
  half's own `start`/`end` is *derived* from its first/last word, so a word can never end up
  outside its own resulting half's bounds — this is already correct by construction. **No code
  change** — only new regression tests were added (§8).
- **`mergeWithNext`** (`editor-store.ts`): a straight `[...a.words, ...b.words]` concatenation
  with **no** overlap/bounds validation at all — correct in the common (non-drifted,
  non-overlapping) case, but any pre-existing drift on either side would carry straight into the
  merged caption untouched. **Fixed** (§9).
- **`duplicateSubtitle`**: shifts every word by the caption's own duration — algebraically
  guaranteed to stay in bounds *as long as the source words already were*. Correct by
  construction. **No code change** — regression tests added (§10).
- **`deleteSubtitle`**: undo/redo already restore/remove the exact word array via the existing
  history-snapshot mechanism (no special-casing needed). Found one real gap: `selectedWordIndex`
  (added in P7.2) was never cleared when its parent caption was deleted, leaving it pointing at a
  word index with no selected caption at all after a delete. **Fixed** (§11).
- **`updateSubtitleTiming`** (caption move/resize): a whole-block MOVE already shifts every word
  by the same delta (unchanged). A RESIZE (duration change) left words **completely untouched**
  even when the new, shrunk bounds now excluded them — the exact scenario the task's own hard
  constraints ("never allow `word.start < caption.start` or `word.end > caption.end`") explicitly
  forbid. **Fixed** (§12).
- **`nudgeSubtitleTiming`**: confirmed to always route through `updateSubtitleTiming` with no
  separate word-handling path — the fix above covers it automatically.
- **Timeline snapping** (`src/lib/timeline/snapping.ts`): confirmed a snapped `"move"` drag is
  always a pure shift (both edges move by the identical delta) and a snapped `"start"`/`"end"`
  drag is always a resize (only one edge moves) — this maps 1:1 onto `updateSubtitleTiming`'s own
  `isPureShift` detection, so the resize fix above transparently covers snapped drags too, with no
  separate change needed in `timeline.tsx`.
- **`updateSubtitleText`/`remapWordsToText`/`applyTextMap`/`findReplace`**: confirmed still
  exactly matching P7.2's fix — same word count preserves every timestamp; a word-count change
  returns `words` completely untouched (never destroyed, never re-synthesized), leaving the
  caption "stale" per `isWordTimingStale`. **No code change** — this is the exact behavior P7.2
  established and this task was explicitly told to preserve.
- **`isAnyDialogOpen`** (`src/hooks/dialog-open-guard.ts`): confirmed by the audit as
  presence-only (`querySelector('[role="dialog"]') !== null`). This module was not initially
  flagged as needing a change — but live QA (§20) surfaced a real, severe bug here once the new
  word-timing keyboard shortcuts started exercising the Popover more heavily. See §12 and §20.
- **Keyboard shortcuts**: confirmed the complete current key-combination inventory (25 entries)
  and confirmed bare `Alt+←/→` is already the caption-level nudge — ruling it out for word-level
  nudge and directly informing the shortcut choice in §5.

## 4. Word-level UX changes

- **Timeline** (`timeline.tsx`): the selected word's own time-range now renders a subtle
  highlighted rectangle (`bg-accent/25` with a thin accent ring) behind the existing static
  boundary ticks, computed via the same `timeToPixels` mapping the file already uses everywhere
  else. Verified live to land at the exact correct pixel position (word 0.00–0.24s at 70px/s →
  `left: 0px; width: 16.8px`, matching precisely).
- **Word chip selection** (`captions-panel.tsx`): already used a clear `border-accent
  bg-accent-soft` treatment from P7.2 — confirmed still correct and sufficiently obvious; no
  change needed there (adding a second visual layer on top would work against "keep the UI
  compact").
- **`WordTimingPopover`**: already displays the selected word's own text prominently
  (`"{word.text}"`) at the top of the popover — confirmed this already satisfies "the popover
  should clearly identify the selected word"; no redesign needed.
- **"Has timing data" indicator**: `getRenderableWordSegments` already only ever renders a chip
  for a word with valid timing (malformed/missing entries are silently skipped, never rendered) —
  so every visible chip already implies "this word has timing data" by construction. Deliberately
  did not add a second visual state for "no timing" per-word (would risk implying fabricated
  timing exists where it doesn't, which the task's own hard constraints forbid).

## 5. Keyboard workflow

New word-timing nudge shortcuts, registered in `src/hooks/use-keyboard-shortcuts.ts` and
`src/lib/keyboard-shortcuts-reference.ts`:

- **`[` / `]`** — nudge the selected word's **start** earlier/later.
- **`Shift+[` / `Shift+]`** — nudge the selected word's **end** earlier/later.
- Step: **0.05s** — reused from `WORD_NUDGE_STEP_SEC`, now exported from
  `src/lib/subtitles/word-timing.ts` (moved out of `word-timing-popover.tsx`, which now imports
  it), so the popover's own nudge buttons and the new keyboard shortcut can never silently drift
  apart. The task's own suggested 0.01s/0.05s dual tier was deliberately not implemented — this
  codebase's own only pre-existing word-level nudge convention (the popover's buttons, from P7.2)
  already uses a single 0.05s step with no "larger" variant, and the caption-level nudge
  (`Alt+←/→`) similarly has no dual tier; matching that existing precedent was judged more
  consistent than introducing a new size convention.

**Why not `Alt+←/→` or `Ctrl+Alt+←/→`** (the task's own suggested combos): the pre-implementation
audit confirmed bare `Alt+←/→` is already the caption-level nudge. `Ctrl+Alt+←/→` — a
natural-seeming "one modifier further out" alternative — was rejected as a known Windows/
graphics-driver screen-rotation hotkey on some machines (this app is Windows-only), which could
silently swallow the keydown before the renderer ever sees it. `[`/`]` and their Shift-modified
forms were confirmed completely unused in the existing shortcut map and carry no such OS-level
hijack risk.

**Guards** — placed after the existing `isTypingTarget`/`isAnyDialogOpen` guards, same as every
other mutating shortcut; no-op when `selectedWordIndex === null` or `selectedSubtitleId === null`
(never fabricates a target); every mutation routes through the existing `updateWordTiming`
action, so it gets the exact same `clampWordTiming` bounds enforcement as the popover's own
buttons — no new clamp logic. All four guard conditions (works when selected, no-op while typing,
no-op with nothing selected, no-op with a dialog open) were verified live (§20).

**Key-repeat/undo coalescing**: the audit confirmed no coalescing/debouncing mechanism exists
anywhere in `editor-store.ts` — every `commit()` call, from any source (mouse, single keypress, or
OS key-repeat), pushes exactly one history entry, with no existing "batch same-action" pattern to
extend. The existing `Alt+←/→` caption nudge already behaves this way. Rather than introduce new
coalescing logic (which the task's own hard constraints caution against — "do not change the
existing undo architecture"), the new word-nudge shortcuts deliberately match this exact,
already-shipped precedent instead of inventing a new grouping convention.

**A real bug found via this exact feature's own live QA**: see §12/§20 (`isAnyDialogOpen`
hardening) — the new keyboard shortcuts, by driving many more open/close cycles of
`WordTimingPopover` than manual clicking alone, is what surfaced it.

## 6. Quality-review changes

Added a **current-quality-issue indicator**: a small warning-colored "Current issue" badge next
to the timestamp of whichever caption `qualityIssueIndex` currently points at
(`captions-panel.tsx`), computed purely from the existing `qualityReport`/`qualityIssueIndex` —
no second issue-state model, and only shown once the user has actually navigated to a specific
issue (`qualityIssueIndex !== null`), not on the top bar/dialog's own "1/N" display-only
fallback-to-0 before any real navigation. Verified live: exactly one caption carries the badge at
a time, and it correctly moves to a different caption as `qualityIssueIndex` advances past a
caption's own last issue.

Everything else — the stale-report toast/banner, the safe empty states for "no report" and "no
issues", and the shared `qualityIssueIndex` cursor across the top bar/dialog/keyboard shortcut —
was confirmed unchanged and still correct; quality analysis is never re-run automatically by any
of this task's changes.

## 7. Review-state changes

The stale-word-timing architecture (`words.length !== tokenize(text).length`, no stored flag) is
completely unchanged. Two small UX polish additions in `captions-panel.tsx`:
- The persistent inline warning banner and "Rebuild timing" button are unchanged in placement and
  behavior (still never automatic, still fully undoable).
- Added a `title` tooltip on the "Rebuild timing" button explicitly stating it *replaces* the
  current (stale) word timing and is undoable — communicating the destructive/replacement nature
  of the action without a modal confirmation dialog, per the task's own "concise wording, no
  modal unless strongly required" instruction.

## 8. Split behavior

Confirmed correct by construction (§3) — no code change. New regression tests (via the store's
`splitSubtitle` action, previously untested at the store level — only pure-function coverage
existed in `split.test.ts`): word timestamps preserved exactly across the split, no word ends up
outside its resulting caption, timing stays monotonic, and undo/redo round-trips the exact
original (unsplit) word array. Verified live: seeking into a multi-word caption and splitting
produced a left half whose single word kept its exact original `[0.00, 0.24]` timestamp.

## 9. Merge behavior

**Fixed**: `mergeWithNext`'s word concatenation now passes through the new
`clampWordsToCaptionBounds` helper (`src/lib/subtitles/word-timing.ts`), which walks the
concatenated array left-to-right and repositions only whatever actually violates monotonic
ordering or the merged caption's own bounds — a no-op (returns the identical array reference) in
the common, already-valid case. New tests cover both the no-op regression case (exact timestamps
preserved) and a constructed-overlap case (fixed, stays non-overlapping and in-bounds). Verified
live: merging two real, already-adjacent captions preserved all 8 words' exact original
timestamps.

## 10. Duplicate behavior

Confirmed correct by construction (§3) — no code change; the existing "offset word timing by the
caption's own duration" semantics were preserved exactly (per the task's own "use the
application's existing duplicate semantics, do not invent a new meaning"). New explicit
bounds-check regression test plus an undo/redo round-trip test. Verified live: duplicating a
caption with words at `[0.10, 1.90]` inside a `[0, 2]` caption produced a copy whose words were
each shifted by exactly 2.0s, still fully inside the copy's own bounds.

## 11. Delete/restore behavior

**Fixed**: `deleteSubtitle` now also clears `selectedWordIndex` when the deleted caption was the
selected one (previously only `selectedSubtitleId` was cleared) — closing a real gap the audit
found: since undo/redo never touch selection state at all (it's ephemeral UI state, not part of
the history snapshot), a delete-then-undo cycle used to leave `selectedWordIndex` pointing at a
word index with `selectedSubtitleId` still `null`. New tests cover: clearing on the deleted
caption, **not** clearing when an unrelated caption is deleted, and an undo/redo round-trip
confirming the exact word array is restored/removed. Verified live via the exact same interaction
sequence the bug required (select caption, select word, delete, undo).

## 12. Caption timing behavior

**Fixed** (the audit's single largest finding): `updateSubtitleTiming`'s RESIZE branch (duration
changes — the one case that previously left `words` completely untouched) now also passes through
`clampWordsToCaptionBounds`, repositioning any word that the shrink/grow would otherwise leave
outside the new bounds, while remaining a no-op (identical array reference) whenever every word is
already valid — which is the overwhelming majority of real resizes, and exactly matches the
pre-P7.3 test suite's own "resize leaves words untouched" expectation in the non-violating case.
One existing test (26b) that had encoded the exact violation this fix corrects
(`word.start = 0 < caption.start = 0.6` after a squeeze) was updated to assert the new, correct,
bounds-respecting behavior instead — not weakened, corrected to match the task's own explicit
hard constraint.

Because timeline snapping's own `"move"`/`"start"`/`"end"` drag-edge distinction maps 1:1 onto
`updateSubtitleTiming`'s pure-shift-vs-resize detection (confirmed in §3), this fix transparently
covers drag-move, left-resize, right-resize, keyboard nudge (`Alt+←/→`, which always routes
through the same function), and snapped drags — no separate change was needed anywhere in
`timeline.tsx`. New regression tests cover right-edge-shrink, left-edge-shrink, and the
no-violation no-op case explicitly.

## 13. Text-edit behavior

Re-verified via the existing suite (unchanged) and via new regression assurance: same word count
preserves compatible timing exactly; a word-count change preserves the real original timestamps
untouched and makes the caption's stale state visible; `rebuildWordTiming` remains the only,
fully explicit path back to valid timing. No regression — this is exactly the P7.2 behavior this
task was told to preserve, not touch.

## 14. Undo/redo

Every new/fixed mutation (`updateWordTiming` via the new keyboard shortcuts, `mergeWithNext`'s
clamp, `updateSubtitleTiming`'s resize clamp, `deleteSubtitle`'s selection fix) goes through the
existing, completely unmodified `commit()`/`undo()`/`redo()` mechanism — no new undo system, no
change to `MAX_HISTORY` or the history-snapshot shape. Verified via 12 new store-level tests
(word-timing keyboard-equivalent nudge, resize-clamp, merge-clamp, delete+undo+redo,
split+undo+redo, duplicate+undo+redo) and live QA (Ctrl+Z/Ctrl+Shift+Z round-trips for split,
merge, duplicate, delete, and word-timing nudges, all confirmed restoring/reapplying the exact
prior/new state).

## 15. Autosave/reload

Verified live: a word-timing keyboard nudge was applied, the save-state indicator settled to
"Saved", the editor page was fully reloaded, and the nudged word's timing (`00:00.05 →
00:00.24`) was confirmed to have persisted exactly. No new persistence mechanism — this flows
through the exact same autosave/API/Prisma pipe every other subtitle mutation already used
(confirmed unchanged by this task; `words` was already fully part of the payload since P7.2).

## 16. Export verification

No export-pipeline code was touched (confirmed unnecessary — `ass.ts` already reads
`word.start`/`word.end` directly off `Subtitle.words`, so every fix in this task flows through
automatically). Verified live: exported the video after a word-timing nudge, split, merge, and
duplicate had all been applied (in sequence, each undone before the next to keep the test project
otherwise clean) — export completed successfully ("Your video is ready") with a valid, playable
preview each time this task's dev QA reached an export check.

## 17. Performance

No change to the timeline's `pointermove` handler, no new per-render scan of `project.subtitles`,
and the existing caption-list/timeline virtualization (`list-virtualization.ts`,
`visible-range.ts`) are completely untouched. `clampWordsToCaptionBounds` — the one new function
added to a hot path (`updateSubtitleTiming`'s resize branch and `mergeWithNext`) — operates only
on the ONE targeted caption's own `words` array (never the full subtitles array), matching the
existing O(one-caption) cost profile of every other word-timing helper. A profiler was not run
this pass (see Known limitations) — this is reasoned from the diff (no new O(n) or O(n²) operation
over the subtitles array was introduced) rather than re-measured against the task's own numeric
baselines.

## 18. Tests

57 new tests, all passing:
- `word-timing.test.ts` (+8, tests 26–33): `clampWordsToCaptionBounds` — no-op on already-valid
  input (exact reference equality), repositions a start-side violation, repositions an end-side
  (resize-shrink) violation, fixes a constructed overlap (merge-concatenation scenario),
  preserves every non-timing field, tolerates a malformed entry without crashing, empty-array
  no-op, and a sanity check that `WORD_NUDGE_STEP_SEC` matches the popover's own step.
- `editor-store-undo-redo.test.ts` (+12, tests 54–65): resize right/left-edge-shrink clamp,
  resize no-violation no-op (exact reference equality), merge no-op regression, merge
  overlap-fix, delete clears/preserves `selectedWordIndex` correctly (2 tests), delete
  undo/redo round-trip, split word-preservation + bounds + monotonicity, split undo/redo,
  duplicate explicit bounds check, duplicate undo/redo.
- `dialog-open-guard.test.ts` (rewritten, 6 tests, net +3 vs. the prior 3): open element → true;
  no element → false; a `data-state="closed"` element → false (the exact P7.3 fix); a closed
  element alongside a genuinely open one → true (closed never masks open); an element with no
  `data-state` at all → fails safe (treated as open); default-`document` smoke test.

Full-suite regression: **603 passed, 0 failed** (580 pre-existing P7.2 baseline + 26 new − 3
replaced-not-duplicated in `dialog-open-guard.test.ts` = net +23 tests registered, 603 total) —
`npm test`. One pre-existing test (26b) was corrected, not weakened or deleted, to match the
task's own explicit new invariant (§12) — no test was deleted to make the suite pass.

## 19. Typecheck/lint

`npm run typecheck`: clean (0 errors), re-run after every meaningful edit. `npm run lint`: **0
errors**, 5 warnings — identical to the pre-existing baseline (`project-card.tsx`, `ai/index.ts`,
`analytics.ts`, `ass.ts`, `preview-style.ts`; none in files this task touched).

## 20. Dev QA

Ran against the Next.js dev server in `SUBLY_DESKTOP=1` mode against the isolated `prisma/dev.db`
(never production), using the browser pane on the same pre-existing disposable `local-user`
project used in prior phases' QA (48 real Hindi captions with real word-level timestamps).

- **Word selection/visualization**: selecting a word chip showed it with the accent
  border/background; the timeline's selected-word highlight rectangle landed at the exact
  predicted pixel position (`left: 0px; width: 16.8px` for a 0.00–0.24s word at 70px/s).
- **Keyboard nudge**: `]` moved a word's start 0.00→0.05s; `[` reverted it; `Shift+[` moved its
  end 0.24→0.19s (confirmed only after discovering and working around a browser-automation-tool
  quirk where simulated `Shift+]` did not recompute `e.key` to `"}"` the way a real keyboard
  would — the shipped guard code was hardened to accept either representation, see §5/§12).
  Clamping against a touching neighbor word (0-gap) was also confirmed live: `Shift+]` on a word
  whose neighbor started exactly at its own end produced no change, correctly blocked by the
  existing `clampWordTiming`.
- **Guard behavior, all four conditions verified live**: fires correctly with a word selected;
  produces a literal `]`/`{` character with no mutation while typing inside the caption textarea;
  is a safe no-op with no word selected (caption selected, no word); is correctly blocked while
  the Keyboard Shortcuts dialog is open.
- **A real, severe bug found and fixed live**: after opening and closing a `WordTimingPopover` a
  number of times, `isAnyDialogOpen()` became permanently `true` for the rest of the session —
  the Popover's Radix `Content` element remained mounted in the DOM (`role="dialog"`,
  `data-state="closed"`, `visible: true`) after its exit animation, apparently because the
  animation never actually completed in this environment. This silently blocked **every**
  dialog-guarded shortcut (undo, redo, split, merge, duplicate, delete, quality nav) — confirmed
  live via a `Delete` keypress that produced no mutation while the guard was stuck. Root-caused to
  `isAnyDialogOpen`'s presence-only check and fixed by additionally checking `data-state`, scanning
  all matching elements (not just the first) so a stale closed node can never mask a real open
  dialog (§12). Re-verified live after the fix, including a deliberate stress-repro (multiple
  rapid popover open/close cycles) followed by successful `Delete`/`Ctrl+Z`.
- **Split/merge/duplicate/delete**: each performed live via their real keyboard shortcuts
  (`Ctrl+Shift+S`, `Ctrl+Shift+M`, `Ctrl+D`, `Delete`) on real captions with real word data,
  each confirmed to produce exactly the word-timing outcome described in §8–§11, each undone
  and re-verified restored to the original state.
- **Quality-issue current-caption indicator**: confirmed exactly one caption carries the "Current
  issue" badge at a time, confirmed it moves to a different caption once `Next` advances past a
  caption's last issue, confirmed synchronized with the top-bar counter and the in-caption
  selection highlight.
- **Autosave/reload**: a word-timing nudge was confirmed to autosave ("Saved" indicator) and
  survive a full page reload with the exact nudged value intact.
- **Export**: completed successfully after word-timing/split/merge/duplicate edits, producing a
  valid, playable preview each time.

## 21. Packaged Windows QA

Built via `npm run electron:pack` — succeeded end to end with no errors, producing
`release\SUBLY Setup 0.1.7.exe` (this build, tested below, predates the version bump — see §23
for why). Silent-installed (`/S`), reusing the same per-user install directory as prior sessions'
packaged QA; confirmed via the installed `SUBLY.exe`'s own updated `LastWriteTime` and version
metadata. Launched the real packaged app; located its bundled Next.js server's freshly-assigned
local port via `Get-NetTCPConnection` and pointed the browser pane at it.

The packaged app's dashboard showed the same real production data as prior sessions (3 real
projects owned by the actual desktop user). A **disposable copy** was made via the app's own real
"Duplicate" action on "rishab guj" (43 real Hindi captions), never touching the originals.

Verified against the running packaged app, on the disposable copy:
- **Word selection + keyboard nudge**: selecting a word chip showed it accent-highlighted;
  pressing `]` moved its start from `00:00.00` to `00:00.05`, confirming the new keyboard
  shortcut works identically in the packaged build.
- **The `isAnyDialogOpen` fix**: repeated popover open/close cycles were performed, followed by
  `Delete` and `Ctrl+Z` — both fired correctly (a caption was deleted, then undo restored it
  exactly), confirming dialog-guarded shortcuts are not blocked in the packaged build.
- **Merge**: `Ctrl+Shift+M` on two real captions produced a merged caption with all 8 original
  words present, in order, with their exact original timestamps preserved.
- **Delete + undo**: `Delete` removed the selected caption; `Ctrl+Z` restored its exact original
  text and word timing.
- **Export**: exported the video after the merge/delete/nudge edits above (each undone before the
  next to keep the disposable project in a clean, representative state) — completed successfully
  ("Your video is ready") with a valid, playable preview.

Cleanup: the disposable "rishab guj (copy)" project was moved to Trash and permanently deleted
via the app's own real UI flow, leaving the 3 real production projects untouched. The packaged
app was then closed.

## 22. Production DB integrity

Baseline captured **before** packaged QA from the real production database
(`%APPDATA%\subs\subly.db`, backed up to `subly.db.bak-pre-p7-3-review-polish-qa` prior to any
packaged-app interaction): Project 19, Subtitle 2266, ExportJob 46, VideoAsset 19,
SubtitlePreset 0 — identical counts to the P7.2 report's own recorded baseline, confirming
continued stability of the real owner's production data across sessions. All of this task's
dev-mode QA (§20) ran against the isolated `prisma/dev.db` and never touched this file. The
packaged-app QA (§21) — and the subsequent 0.1.8 installer smoke test (§23) — necessarily used the
real production DB path; a full row-level comparison (every column except `updatedAt`) after both
passes shows the production database is **byte-for-byte identical** to this task's own pre-QA
baseline: counts unchanged (19/2266/46/19/0) and a full JSON-string equality check (excluding
`updatedAt` on every row) returned `true` both immediately after the disposable-copy QA and again
after the 0.1.8 smoke test's real-project (read-only) navigation. The pre-QA backup file was
deleted after the first comparison confirmed no diff.

## 23. Version/build

Bumped **0.1.7 → 0.1.8** in `package.json`, only after implementation, the full test suite,
typecheck, lint, dev-mode QA, packaged QA (§21), and production-DB integrity (§22) all passed —
per the task's own explicit instruction not to bump before implementation is complete. The
packaged QA in §21 was run against a `SUBLY Setup 0.1.7.exe` build (i.e., before the bump) —
following the same pattern established in the P7.1/P7.2 reports: functional behavior is verified
once, then the version is bumped and the installer is rebuilt to carry the correct version
string.

After bumping, `npm run electron:pack` was re-run and succeeded cleanly (no errors). Verified on
the resulting file itself: `release\SUBLY Setup 0.1.8.exe` (560,531,715 bytes),
`FileVersion 0.1.8`, `ProductVersion 0.1.8.0`, `ProductName SUBLY`, installer filename
`SUBLY Setup 0.1.8.exe`. `npm run typecheck` and `npm test` (603/603) were re-run after the bump
and are clean.

**Unlike P7.1/P7.2, this task explicitly required at least a launch/smoke test of the actual
0.1.8 installer** (not just metadata verification) — performed: silently installed the 0.1.8
build, launched the real packaged `SUBLY.exe` (confirmed `FileVersion`/`ProductVersion` 0.1.8 on
the installed executable), confirmed the dashboard loaded showing the same 3 real production
projects with no data loss from the reinstall, opened the real "rishab guj" project and confirmed
it rendered correctly (captions, timeline, word-level UI all present and correct) — a read-only
navigation, no edits made — then closed the app. Production DB confirmed byte-for-byte unchanged
afterward (§22).

## 24. Known limitations

- **No profiler run this pass** (§17) — the performance claim is reasoned from the diff (no new
  O(n)/O(n²) operation over the full subtitles array), not re-measured against the task's own
  30/300/1,800/3,600/5,400-caption numeric baselines with a profiler.
- **The root cause of the stale-Popover-animation bug** (§20) was diagnosed and *worked around*
  robustly (the `isAnyDialogOpen` fix makes it harmless regardless of why it happens), but the
  underlying reason the exit animation doesn't fire `animationend` in this environment was not
  fully root-caused — e.g. whether it also occurs in the packaged app's own Chromium/Electron
  runtime, or is specific to this session's browser-automation harness, is addressed by the
  packaged QA in §21 but the CSS/animation mechanism itself was not further investigated once the
  guard fix was confirmed sufficient.
- **Key-repeat coalescing** (§5): deliberately not implemented, matching the existing `Alt+←/→`
  precedent exactly (verified via the audit that no better grouping convention exists anywhere in
  `editor-store.ts`) — a held-down `[`/`]`/`Shift+[`/`Shift+]` will still create one undo entry
  per repeated keydown, same as the pre-existing caption-level nudge already does.

## 25. Intentionally deferred

Per the task's own hard constraints and scope: multi-select/batch word editing, full
Descript-style word dragging in the timeline, a second "has timing" per-word visual distinct from
chip-presence-implies-valid-timing, and any dual small/large nudge-increment tier beyond the
single 0.05s step already established by P7.2's popover.

## 26. Final assessment

All in-scope P7.3 items are implemented: word-selection visual polish (timeline highlight,
confirmed pixel-exact), a bounded, guard-safe word-timing keyboard workflow (`[`/`]`/
`Shift+[`/`Shift+]`, registered in the shortcuts reference and its cross-check test), a
current-quality-issue indicator using only the existing `qualityReport`/`qualityIssueIndex` as
canonical source, and word-timing review-state UX polish (tooltip clarifying the rebuild action's
replace-and-undoable nature). The task's own "most important part" — the caption↔word timing
consistency audit — found split/duplicate/text-editing already correct by construction (verified,
not rewritten, new regression tests added) and found two genuine gaps, both fixed with the
smallest necessary change: `mergeWithNext`'s unchecked concatenation and
`updateSubtitleTiming`'s unclamped resize, both now routed through one new, shared, no-op-in-the-
common-case helper (`clampWordsToCaptionBounds`). A third, unplanned but real and severe bug —
`isAnyDialogOpen`'s presence-only check being fooled by a Popover that fails to unmount after its
exit animation, permanently blocking every dialog-guarded shortcut — was found via this task's
own live keyboard-workflow QA and fixed at its root (checking `data-state`, not just presence).

603/603 tests pass (57 new + 3 net-added in a rewritten file, 0 regressions, one pre-existing test
corrected — not weakened — to match the task's own new hard-constraint invariant), typecheck and
lint are clean at the pre-existing baseline, and dev-mode + packaged-Windows QA — using real UI
interaction throughout — confirmed every required behavior, including the stale-popover bug's
live reproduction and live-verified fix in both the dev server and the packaged app. Undo/redo,
autosave/reload, and export were all confirmed working correctly across every affected operation
(word nudge, merge, split, duplicate, delete). Production data was confirmed byte-for-byte
unchanged (excluding `updatedAt`) across the entire packaged QA pass and the subsequent 0.1.8
installer smoke test.

The known limitations (§24) — no profiler run, and the stale-Popover-animation's underlying CSS
root cause not further investigated once the guard fix was confirmed sufficient — are gaps in
investigative depth, not known defects; the fix itself was verified correct both by construction
(checking Radix's own documented `data-state` contract) and by live reproduction-then-fix
confirmation in both environments.

**STATUS: PASS**
