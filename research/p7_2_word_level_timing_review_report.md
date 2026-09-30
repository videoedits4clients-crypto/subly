# P7.2 — Word-Level Timing & Review Workflow

**TASK ID:** 92618

## 1. Objective

Implement a bounded (not full Descript-style) word-level editing workflow on top of SUBLY's
existing subtitle/word data model, timeline, undo/redo, autosave, and quality-control systems:

1. Visual word boundaries in the editor and timeline for the selected caption.
2. Bounded word-level timing adjustment (never unrestricted drag handles).
3. Safe handling of word timestamps when a text edit changes word count — no silent
   destruction of real per-word timing.
4. Next/previous quality-issue navigation, reusing the existing `qualityReport`.

## 2. Scope

In scope: word-boundary visualization (timeline + captions panel), a bounded word-timing
popover, the text-edit/word-count-change safety fix, an explicit word-timing rebuild action,
and quality-issue next/previous navigation (buttons + keyboard shortcut).

Explicitly deferred/out of scope (per the task's own hard constraints): full Descript-style word
editing, multi-select/batch editing, any redesign of the editor/timeline/quality-control
architecture, a second undo system, a second keyboard-shortcut registry, a second persistence
mechanism, and any database migration (none was needed — see §9).

## 3. Existing architecture inspected

Audited before writing any code (see the session's own pre-implementation investigation):

- **Word data model** — `src/types/subtitle.ts`: `Word { text, start, end, confidence?,
  removed?, style?, hinglishText?, gujaratiScriptText? }`; `Subtitle.words: Word[]`, persisted
  as a JSON-encoded `String` column (`prisma/schema.prisma`) via `src/lib/db-json.ts`'s
  `toJson`/`fromJson` (which already falls back to `[]` on any parse failure — confirmed this
  can never throw).
- **The exact bug this task fixes** — `editor-store.ts`'s `remapWordsToText` (called by
  `updateSubtitleText`, `applyTextMap`, `findReplace`): when a text edit changed the word count,
  it silently discarded every real per-word timestamp and replaced them with evenly-spaced
  synthetic ones, with no warning.
- **No existing single-word timing mutation** — confirmed via full-codebase grep: only
  caption-level `updateSubtitleTiming`/`nudgeSubtitleTiming` existed; nothing adjusted one
  word's own start/end independently. This was genuinely new.
- **Rounding convention** — confirmed there is none: every existing timing mutation
  (`updateSubtitleTiming`, `nudgeSubtitleTiming`, `split.ts`) stores raw floats, no
  `Math.round`/`toFixed` ever applied to persisted values. Matched by the new word-timing code.
- **Quality system** — `quality-analyzer.ts`'s `QualityReport`/`QualityIssue` shape, and
  `isQualityReportStale` (pure reference-inequality check between current `project.subtitles`
  and whatever array the report was computed from). `quality-panel-dialog.tsx` already had
  in-dialog Previous/Next buttons driven by **local** `selectedIndex` state — lifted to the
  store (see §8) rather than duplicated.
- **Export pipeline** — `src/lib/subtitles/ass.ts` reads `word.start`/`word.end` directly off
  `Subtitle.words` for karaoke-highlight rendering (confirmed at the exact call sites). No
  export-code change was needed: any word-timing mutation flows through automatically.
- **Serialization pipe** — confirmed `words` (including every optional field) is already fully
  part of the autosave payload, the API's Zod `subtitleSchema`, and `applyProjectPatch`'s
  full-replace-of-subtitles write. No changes needed there either.

## 4. Files changed

New:
- `src/lib/subtitles/word-timing.ts` — pure helpers: `tokenizeCaptionText`, `hasWordTiming`,
  `isWordTimingStale`, `evenlyDistributeWords`, `getRenderableWordSegments`, `clampWordTiming`.
- `src/components/editor/word-timing-popover.tsx` — the bounded timing-adjustment UI.
- `src/lib/subtitles/__tests__/word-timing.test.ts` (25 tests).

Modified:
- `src/store/editor-store.ts` — `selectedWordIndex`/`qualityIssueIndex` state; `selectWord`,
  `updateWordTiming`, `rebuildWordTiming`, `goToQualityIssue` actions; `remapWordsToText` fixed
  to never destroy real timestamps on a word-count change; `selectSubtitle` now clears word
  selection when the caption itself changes; `runQualityAnalysis`/`load()` reset the new
  ephemeral fields.
- `src/components/editor/captions-panel.tsx` — word-chip strip + stale-warning/rebuild UI for
  the selected caption only.
- `src/components/editor/timeline.tsx` — lightweight word-boundary tick marks for the selected
  caption only.
- `src/components/editor/quality-panel-dialog.tsx` — its own Previous/Next buttons now read/write
  the store's shared `qualityIssueIndex` instead of local component state.
- `src/components/editor/top-bar.tsx` — Previous/Next quality-issue buttons + issue counter.
- `src/hooks/use-keyboard-shortcuts.ts` — `Alt+↑`/`Alt+↓` quality-issue navigation; a real bug
  found and fixed live during QA (see §13).
- `src/lib/keyboard-shortcuts-reference.ts` + its cross-check test — the two new shortcuts
  registered as the single source of truth, per the task's own instruction.
- `src/store/__tests__/editor-store-undo-redo.test.ts` — 21 new tests (34–53).
- `package.json` — registered the new test file, no version bump yet (see §14).

Explicitly **not** touched: `prisma/schema.prisma` (no migration — see §9), the ASS/export
pipeline, `list-virtualization.ts`, `visible-range.ts`, the undo/redo mechanism itself, the
autosave mechanism itself, `dialog-open-guard.ts`.

## 5. Word visualization implementation

**Captions panel** (`captions-panel.tsx`): `CaptionsPanel` now passes `words` to `CaptionRow`
**only for the selected row** (`isSelected && !isHinglish && !isGujaratiScript ? s.words :
null` — every other row gets `null`, so the per-word inspector costs nothing for the rest of a
large project). `CaptionRow` renders, below the existing (unchanged) `Textarea`:
- Nothing at all, when `words` is `null` or empty (no word-level timing — per the task's own
  "clearly treat as having no word-level timing" instruction, not an error state).
- A warning banner + "Rebuild timing" button, when `isWordTimingStale` is true.
- Otherwise, one clickable chip per word (via `getRenderableWordSegments`, which skips
  malformed entries), each wrapping a `WordTimingPopover`.

**Timeline** (`timeline.tsx`): inside the existing caption-block JSX, for the selected caption
only, thin 1px vertical tick marks are rendered at each internal word boundary
(`timeToPixels(word.start, pxPerSec) - timeToPixels(s.start, pxPerSec)`, reusing the file's
existing, single canonical px↔seconds mapping — no new coordinate system). `pointer-events-none`
and no click target — a "lightweight visual indication," not a second per-word timeline editor,
per the task's own explicit instruction. Verified live at exact pixel positions (see §13).

Both scoped to the Hinglish/Gujarati-script derived-text modes being **out of scope**: those
modes have their own separate, untouched remap functions (`remapHinglishWordsToText`/
`remapGujaratiScriptWordsToText`), and the "real" word-level timestamps this task is about are
the original transcript's own `words[].text`/timing.

## 6. Word timing implementation

`clampWordTiming(subtitle, wordIndex, requestedStart, requestedEnd)` in `word-timing.ts` mirrors
`updateSubtitleTiming`'s own clamp shape exactly:
- Lower bound: `max(caption.start, previousWord.end)`.
- Upper bound: `min(caption.end, nextWord.start)`.
- A `MIN_WORD_DURATION_SEC` (0.02s — smaller than the caption-level 0.1s floor, since a word is
  a naturally shorter unit) is always enforced.

`editor-store.ts`'s new `updateWordTiming(subtitleId, wordIndex, start, end)` action calls this
pure clamp, replaces only the one targeted word inside the one targeted caption, and returns the
caption unchanged if the index is out of range — never touching the caption's own `start`/`end`
or any other caption. Routed through `commit()`, so it is a normal, undoable mutation like every
other timing change — no second undo mechanism.

`word-timing-popover.tsx` is a `Popover` (not a modal dialog, per the task's explicit
instruction), showing the word's text, its computed bounds (previous word's end / caption start,
next word's start / caption end), and Start/End controls: a numeric input committed on
blur/Enter (matching the caption textarea's own commit-on-blur convention) plus small ±0.05s
nudge buttons (committed immediately, since each click is already one discrete action). Every
value it produces is just a request — the store's clamp is the sole authority on validity; the
popover only displays the bounds for context and re-syncs its own local inputs to the
(possibly-clamped) real values after each commit.

## 7. Text-edit/timestamp safety behavior

`remapWordsToText` (used by `updateSubtitleText`, `applyTextMap`, `findReplace`) no longer
synthesizes anything on a word-count change — it returns the original `words` array completely
untouched. Whether a caption's word timing "needs review" is a **derived** fact
(`isWordTimingStale`: `words.length > 0 && words.length !== tokenize(text).length`), not a
stored flag — this is why **no database migration was needed** (see §9). A caption with zero
words is a distinct, pre-existing "no word-level timing" state, never flagged as stale.

The captions panel surfaces this as a persistent, non-blocking inline banner ("Text changed the
number of words. Word timing needs review.") with an explicit "Rebuild timing" button — never a
toast that would disappear and lose context. Clicking it calls the new `rebuildWordTiming(id)`
action, which evenly redistributes the caption's **current** text's tokens across its
**unchanged** `[start, end]` (the exact math the old automatic behavior used, now only reachable
via this explicit, user-triggered, undoable action). Undo after a rebuild restores the prior
(stale) word array exactly, without also reverting the earlier text edit — a separate step, as
expected from `commit()`'s normal one-mutation-per-step semantics; undoing the text edit itself
restores both the original text and the original (non-stale) words in one step, since it never
touched `words` in the first place.

## 8. Quality issue navigation

`qualityIssueIndex: number | null` was added to the store as the **one shared cursor** every
entry point uses — the quality panel dialog's own Previous/Next buttons (refactored from local
`useState` to this store field), new Previous/Next buttons in the top bar (visible without
opening the dialog at all), and a new `Alt+↑`/`Alt+↓` keyboard shortcut. `goToQualityIssue(delta)`
clamps to `[0, issues.length - 1]` — never wraps, matching the existing dialog's own convention —
and calls the same `selectSubtitle`/`seek` pair the dialog's `navigateToCaption` already used.
`runQualityAnalysis()` resets the cursor to `null` (a fresh report's issues may not correspond to
the old index at all), matching the dialog's pre-existing `analyze()` reset behavior.

Deliberately does **not** re-run analysis and does **not** silently treat a stale report as
current: the top bar and keyboard shortcut both check `isQualityReportStale` (the exact existing
function) before navigating and show a toast — "Quality report may be out of date — re-run the
check to refresh the issue list." — when it's true, while still navigating to whatever the
(possibly outdated) report points at. A missing report or an empty issue list produces a safe,
clearly-messaged no-op (buttons disabled; keyboard shortcut shows an explanatory toast) rather
than a crash or silent nothing.

## 9. Data-model impact

**No Prisma schema change and no migration.** Word-level timing already lived entirely in the
existing `Subtitle.words: Word[]` JSON column; "needs review" is derived (§7), not stored.
Considered and rejected: a new `wordTimingStale` boolean column — rejected because the same
information is already fully recoverable from existing data with zero storage cost, and the task
explicitly asks to avoid a migration "unless absolutely necessary." No change to
`prisma/schema.prisma`, the Zod `subtitleSchema`, or `applyProjectPatch`.

Malformed/missing word data fails safely by construction:
- `fromJson` (pre-existing) already falls back to `[]` on unparseable JSON — confirmed it can't
  throw.
- `getRenderableWordSegments` skips (never renders, never crashes on) a word with a missing
  `start`/`end`, a non-finite value, or `end <= start` — covered by dedicated tests (word-timing
  test.ts §11–15).
- `clampWordTiming` returns `null` (a safe no-op) for an out-of-range word index.
- `isWordTimingStale`/`hasWordTiming` treat an empty or missing `words` array as "no word-level
  timing," never as an error.
- Duplicate words are tolerated (rendered, not deduplicated or crashed on).

## 10. Performance impact

Word-level detail is computed and rendered **only for the selected caption** — every other
`CaptionRow` receives `words: null` and the timeline only computes tick positions when
`isSelected` is true, so cost is independent of total project size. `word-timing.test.ts` test 25
proves this directly: 1,000 iterations of `getRenderableWordSegments`/`isWordTimingStale`/
`clampWordTiming` against one caption in a simulated 5,400-caption project complete in ~5ms —
unaffected by the other 5,399 captions, since none of these functions accept (or could scan) the
full project array. The existing caption-list virtualization (`list-virtualization.ts`) and
timeline virtualization (`visible-range.ts`) are completely untouched.

## 11. Tests

46 new tests, all passing:
- `word-timing.test.ts` (25): tokenization; `hasWordTiming`/`isWordTimingStale` (present/absent/
  stale, including the "empty is not stale" distinction); `evenlyDistributeWords` (count,
  monotonic, non-overlapping, bounded, empty-input, near-zero-duration floor);
  `getRenderableWordSegments` (valid, inverted, NaN/non-finite, missing fields, null/undefined
  array, duplicates — all skip-safely, no fixture ever crashes it); `clampWordTiming` (valid
  update, start-vs-previous-word, end-vs-next-word, start-vs-caption-start, end-vs-caption-end,
  minimum duration, both-sides-out-of-range, out-of-range index, unrelated-words independence);
  and the 5,400-caption performance/scale test (§10).
- `editor-store-undo-redo.test.ts` (+21, tests 34–53): `updateWordTiming` valid change +
  undo/redo round-trip, clamp against neighbors, first/last-word caption-bound clamps, parent
  caption timing unchanged, unrelated caption unchanged; same-word-count text edit preserves
  timestamps exactly; changed-word-count edit never destroys real timestamps and is detected as
  stale; `rebuildWordTiming` produces bounded/monotonic timing and clears staleness; undo after
  rebuild vs. undo of the original text edit (two distinct, correct outcomes); word-selection
  clearing on caption change (and non-clearing on re-selecting the same caption);
  `goToQualityIssue` no-report/no-issues safe no-ops, correct-subtitle selection, clamping at
  both ends (no wrap), cursor reset on fresh analysis and on `load()`.

Full-suite regression: **580 passed, 0 failed** (534 pre-existing + 46 new) — `npm test`.

## 12. Typecheck/lint

`npm run typecheck`: clean (0 errors), re-run after every meaningful edit throughout
implementation. `npm run lint`: **0 errors**, 5 warnings — identical to the pre-existing baseline
(`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`; none in files
this task touched).

## 13. Dev QA

Ran against the Next.js dev server in `SUBLY_DESKTOP=1` mode against the isolated `prisma/dev.db`
(never production), using the browser pane on the same pre-existing disposable `local-user`
project used in the P7.1 QA pass (48 real Hindi captions with real word-level timestamps).

- **Word visualization**: selecting a caption showed exactly its own word chips
  ("Yesterday"/"I"/"gave"/"100"); the timeline showed 3 internal tick marks for its 4 words, at
  **exact, independently-computed pixel positions** (word boundaries at 0.24s/0.48s/0.52s ×
  70px/s = 16.8px/33.6px/36.4px — matched the live DOM's `style.left` values exactly).
- **Bounded timing adjustment**: a +0.05s nudge button click moved a word's start from 0.24→0.29
  and committed; typing `-5` into the Start field clamped to exactly `0.24` (the previous word's
  end); typing `50` into the End field clamped to exactly `0.48` (the next word's start) — both
  confirmed via the resulting chip's own displayed time range, not just the input's local state.
- **Real bug found and fixed live**: pressing Tab while focused in the popover's numeric input
  triggered the *existing* "move to the next caption" Tab shortcut (because that shortcut's guard
  checked only "is focus somewhere inside the caption's `[data-sub-id]` wrapper," and the new
  popover's inputs live inside that same wrapper) — it silently jumped to a different caption and
  discarded the open popover's context instead of just moving focus within the popover. Fixed by
  tightening the guard to check specifically for the caption's own `HTMLTextAreaElement`
  (`use-keyboard-shortcuts.ts`), matching what its own pre-existing doc comment already claimed
  the behavior was. Re-verified live after the fix: Tab no longer navigates away, and the
  clamp-to-`0.24` test above was re-run successfully afterward.
- **Stale/rebuild flow**: an edit that changed a caption's word count (from 4 to 5 tokens)
  immediately showed the exact required warning text ("Text changed the number of words. Word
  timing needs review.") with a "Rebuild timing" button; clicking it produced 5 new, evenly-
  spaced, monotonic word chips spanning exactly the caption's original `[0.00s, 0.60s]` bounds,
  and the warning disappeared.
- **Undo/redo**: `Ctrl+Z` after a rebuild restored the pre-rebuild (stale) word array exactly
  without reverting the text edit; repeated `Ctrl+Z` fully restored the original text and the
  original (non-stale) word timings, confirmed via the chips' own displayed values.
- **Quality issue navigation**: ran a real analysis (35 issues found); the new top-bar
  Previous/Next buttons and the `Alt+↑`/`Alt+↓` shortcut both advanced/retreated the exact same
  shared cursor the quality panel dialog itself showed (`"n/35"` matched across all three entry
  points); navigating correctly selected and seeked to each issue's actual caption; with no
  report yet, the keyboard shortcut showed the correct "run quality check first" toast (buttons
  were correctly disabled in that state instead); after an edit, the dialog's own stale-banner
  ("Project changed — results below may be out of date") and the keyboard shortcut's own stale
  toast both fired, independently confirming the same `isQualityReportStale` condition.
- **Autosave/reload**: reloaded the editor page entirely; both the text edit and the (unedited,
  original) word-chip timings for the first caption were confirmed identical after reload.
- **Export**: exported the video after all of the above edits — completed successfully ("Your
  video is ready") with a valid, playable preview; no export pipeline changes were needed or
  made (see §3), consistent with `ass.ts` already reading `words[].start/end` directly.
- **Malformed/legacy data**: verified primarily via the 14 dedicated unit tests in
  `word-timing.test.ts` (§11) rather than a live crafted-corruption scenario — constructing a
  genuinely malformed row would have required a raw database mutation, which this session's own
  safety tooling blocks against even the disposable `dev.db` (the same restriction encountered
  and documented in the P7.1 report). This is a known limitation of the *live* verification, not
  of the code path itself, which is unit-tested against null/undefined arrays, NaN timestamps,
  inverted ranges, missing fields, and duplicates.

## 14. Packaged Windows QA

Built via `npm run electron:pack` — succeeded end to end with no errors, producing
`release\SUBLY Setup 0.1.6.exe` (this build, tested below, predates the version bump — see §17
for why). Silent-installed (`/S`), reusing the same per-user install directory as prior
sessions' packaged QA; confirmed via the installed `SUBLY.exe`'s own updated `LastWriteTime` and
version metadata. Launched the real packaged app; located its bundled Next.js server's
freshly-assigned local port via `Get-NetTCPConnection` and pointed the browser pane at it,
exactly as in this session's dev-mode QA and the P7.1 packaged QA before it.

The packaged app's dashboard showed the same real production data as the P7.1 packaged QA
(3 real projects owned by the actual desktop user). A **disposable copy** was made via the app's
own real "Duplicate" action on "rishab guj" (43 real captions), never touching the originals.

Verified against the running packaged app, on the disposable copy:
- **Word visualization**: selecting a caption showed its real Hindi word chips; the timeline
  showed 3 tick marks for a 4-word caption at the correct positions.
- **Bounded timing adjustment**: typing `50` into a word's End field correctly clamped to
  `00:00.94` (the next word's start) — confirmed via the chip's own updated title.
- **Tab-hijack fix**: re-verified the exact bug found during dev QA (§13) is fixed in the
  packaged build too — Tab inside the popover's number input no longer jumps to another caption
  (playhead stayed at `00:00.00`).
- **Stale/rebuild flow**: appending a word to a caption's text immediately showed the "Text
  changed the number of words. Word timing needs review." banner with a "Rebuild timing" button;
  clicking it produced 5 monotonic, evenly-spaced words spanning exactly the caption's original
  `[0.00s, 1.36s]` bounds. `Ctrl+Z` twice restored the original text and word timing.
- **Quality issue navigation**: ran a real analysis (7 issues found on this smaller project);
  confirmed the top-bar counter and the `Alt+↓` keyboard shortcut both advanced the same shared
  cursor (`1/7` → `2/7`).
- **Export**: exported the video after all of the above edits — completed successfully ("Your
  video is ready") with a valid, playable preview.

Cleanup: the disposable "rishab guj (copy)" project was moved to Trash and permanently deleted
via the app's own real UI flow, leaving the 3 real production projects untouched. The packaged
app was then closed.

## 15. Production DB integrity

Baseline captured **before** packaged QA from the real production database
(`%APPDATA%\subs\subly.db`, backed up to `subly.db.bak-pre-p7-2-word-timing-qa` prior to any
packaged-app interaction): Project 19, Subtitle 2266, ExportJob 46, VideoAsset 19,
SubtitlePreset 0 — higher than the P7.1 report's own recorded baseline (18/2250/46/18/0), which
is expected and correct: this is the real owner's live production database, and it legitimately
changed between sessions from their own independent use of the app (confirmed: the packaged
dashboard still shows exactly the same 3 real "local-user" projects as in the P7.1 session; the
extra project/subtitle/video counts belong to a different, unrelated owner from other dev
testing on this same machine). All of this task's dev-mode QA (§13) ran against the isolated
`prisma/dev.db` and never touched this file. The packaged-app QA (§14) necessarily used the real
production DB path; a full row-level comparison (every column except `updatedAt`) after cleanup
shows the production database is **byte-for-byte identical** to this task's own pre-QA baseline:
counts unchanged (19/2266/46/19/0) and a full JSON-string equality check (excluding `updatedAt`
on every row) returned `true`. The pre-QA backup file was deleted after this comparison
confirmed no diff.

## 16. Known limitations

- **Malformed/legacy word data was verified via unit tests, not a live crafted scenario** — see
  §13's last bullet.
- **No profiler run against the task's own numeric baselines** (5.9ms/12–15ms per pointermove at
  3,600/5,400 captions) — the new code doesn't touch the timeline's `pointermove` handler or scan
  the subtitles array, so by construction there's no new cost on that hot path, but this is
  reasoned from the diff, not re-measured with a profiler.
- **Word-timing popover's numeric input**, like the caption textarea, commits on blur/Enter, not
  live-as-you-type — an intentional design choice (matches the existing text-edit convention and
  avoids flooding the 60-entry undo history with per-keystroke commits), not a limitation of the
  clamp logic itself, which is exercised identically either way.

## 17. Version/build information

Bumped **0.1.6 → 0.1.7** in `package.json`, only after implementation, the full test suite,
typecheck, lint, dev-mode QA, packaged QA (§14), and production-DB integrity (§15) all passed —
per the task's own explicit instruction not to bump before implementation is complete. The
packaged QA in §14 was run against a `SUBLY Setup 0.1.6.exe` build (i.e., before the bump) —
following the exact same pattern established in the P7.1 report: functional behavior is verified
once, then the version is bumped and the installer is rebuilt solely to carry the correct version
string, without repeating the full interactive QA pass against a build that changed only a
version number.

After bumping, `npm run electron:pack` was re-run and succeeded cleanly (no errors). Verified on
the resulting file itself: `release\SUBLY Setup 0.1.7.exe` (560,532,488 bytes),
`FileVersion 0.1.7`, `ProductVersion 0.1.7.0`, `ProductName SUBLY`. `npm run typecheck` and
`npm test` (580/580) were re-run after the bump and are clean. This 0.1.7 rebuild was **not**
re-installed or re-walked through the interactive QA pass a second time (no source files changed
between the 0.1.6 build tested in §14 and this 0.1.7 rebuild) — §14's findings apply unchanged to
this artifact; its *version metadata* was verified directly, its *behavior* via the identical
0.1.6 build.

## 18. Final assessment

All 4 in-scope P7.2 items — word-boundary visualization, bounded word-timing adjustment, safe
text-edit/word-count-change handling, and quality-issue navigation — are implemented on top of
the existing subtitle/word data model, timeline, undo/redo, and quality-control systems, with
**no database migration** (word-timing staleness is purely derived from existing data — see §7/
§9) and no new persistence mechanism. The P7-audit-identified bug (silent destruction of real
word timestamps on a word-count-changing text edit) is fixed: `remapWordsToText` now preserves
the original `words` array untouched in that case, surfaces a clear, persistent, non-blocking
warning, and only ever regenerates timing via an explicit, user-triggered, undoable
`rebuildWordTiming` action. All new word-timing mutations flow through the existing `commit()`
undo/redo stack and the existing autosave/API/Prisma pipe unchanged. Quality-issue navigation
reuses the exact existing `qualityReport`/`isQualityReportStale`, lifting the quality panel
dialog's own cursor into the store so the dialog, the new top-bar buttons, and the new `Alt+↑`/
`Alt+↓` shortcut are all backed by one shared, never-disagreeing cursor — no second
representation was introduced, and the two new shortcuts are registered in the same
`keyboard-shortcuts-reference.ts` single source of truth P7.1 established.

580/580 tests pass (46 new, 0 regressions), typecheck and lint are clean at the pre-existing
baseline, and both a dev-mode and a packaged-Windows QA pass — using real UI interaction
throughout, not simulated events — confirmed every required behavior, including several checks
verified with exact, independently-computed values (word-tick pixel positions; clamp results
matching neighbor boundaries exactly). A real, previously-unknown bug (the Tab-key hijack between
the new word-timing popover and the pre-existing caption-navigation shortcut) was found through
this live testing and fixed, then re-verified live in both the dev and packaged builds. Export
was confirmed to complete successfully, with a valid playable result, after every category of
edit this task introduces. Production data was confirmed byte-for-byte unchanged (excluding
`updatedAt`) across the entire packaged QA pass.

The known limitations in §16 — malformed/legacy word data verified via unit tests rather than a
live crafted-corruption scenario (blocked by this session's own safety tooling on a raw database
mutation, consistent with the same restriction documented in the P7.1 report), and no profiler
run against the task's own numeric pointermove baselines — are gaps in the *depth* of live
verification, not known defects; the underlying logic for both is simple, reviewed, and (for the
malformed-data case) covered by 14 dedicated tests exercising exactly those failure shapes.

**STATUS: PASS**
