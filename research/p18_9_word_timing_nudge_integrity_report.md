# P18.9 — Non-Monotonic Word Safety for Word-Level Timing Nudge

## 1. Task ID

117206

## 2. Scope

Fix the last discovered instance of the P18.6-broke-an-assumption bug class: `clampWordTiming`
(src/lib/subtitles/word-timing.ts), which derived its allowed range from `words[wordIndex-1]`/
`words[wordIndex+1]` — array-ADJACENT neighbors — assuming array order is chronological. P18.6
(Task 113528) made that assumption false on purpose (explicit word reorder). This is the function
behind the popover's start/end +/- nudge and typed inputs, and the timeline's own word-handle drag.
Explicitly out of scope: the word-timing popover's redesign, word timing's data model, Word Reorder
semantics, Split, Merge, Ripple Delete/Insert, caption Resize, `clampWordsToCaptionBounds`,
`validateWordsWithinCaptionBounds`, `updateSubtitleTiming`, `resolveTimingUpdate`, the whole-caption
shift branch.

## 3. Baseline

- Version: 0.1.17 (unchanged)
- P18.1–P18.8 complete; P18.8 Task ID 115894
- Baseline: 1545/1545 tests, typecheck PASS, lint PASS (0 errors / 5 pre-existing warnings)

## 4. Phase-0 audit

**A. Production callers of `clampWordTiming`.** Grepped the whole tree — TWO real call sites, not
one:
1. `updateWordTiming` (editor-store.ts) — backs the popover's +/- buttons and typed start/end
   inputs (word-timing-popover.tsx's `onCommit`).
2. `TimelineWordHandles`'s `onPointerMove` (timeline.tsx) — the timeline's own word-handle DRAG,
   called on every pointermove for the LIVE PREVIEW (never commits mid-drag; commits once on
   pointer-up via `onCommitWordTiming` → the same `updateWordTiming`).

Two FURTHER call sites turned out to share the exact same array-adjacent bug independently,
without going through `clampWordTiming` at all:
3. `captions-panel.tsx` (~line 821) computed `prevWordEnd`/`nextWordStart` for the popover's own
   "Bounded by" DISPLAY LABEL via `words[index-1]`/`words[index+1]` — a second, display-only
   instance of the identical mistake.
4. `timeline.tsx`'s `TimelineWordHandles.startWordDrag` computed the same pair via array adjacency
   for `computeWordSnappedTiming`'s SNAP-TARGET proposal (cosmetic — the authoritative clamp below
   it can never be bypassed by a wrong snap target, but the snap guide itself could point at the
   wrong boundary).

Phase-0's own instruction ("do not assume the popover is the only caller") is exactly why these
were found — fixing `clampWordTiming` alone would have left the "Bounded by" label and the drag's
snap target still wrong.

**B. What semantics did `clampWordTiming` implement?** A single-word CLAMP (never reject except for
an out-of-range index): floor/ceiling the requested start/end against `[max(captionStart, prevEnd),
min(captionEnd, nextStart)]`, with a `MIN_WORD_DURATION_SEC` floor on duration.

**C/D. `requestedStart`/`requestedEnd`.** The caller's proposed new start/end for the target word —
always evaluated against the word's OWN CURRENT position in the data (its real neighbors), never
against the request itself.

**E. Is the clamp meant to prevent overlap with chronological neighbors?** Yes — that was always the
intent (see the function's own pre-existing doc comment, "never crosses the previous/next word").
The bug was purely in HOW "previous/next" was determined (array position, not real time).

**F. Minimum word duration enforced?** Yes, via the pre-existing `MIN_WORD_DURATION_SEC` constant —
reused unchanged, no new duration policy invented.

**G. Clamp or reject?** Clamp, with one narrow addition (see §6): reject (return `null`) only when
the real neighbors leave literally no room for even a minimum-duration word — a case the old
array-adjacent version could silently turn into an INVERTED interval instead (see §5).

**H. Does `updateWordTiming` expect an always-repaired interval?** It already handled `null` (out-
of-range index) as a silent per-caption no-op — but critically, it called `commit()`
UNCONDITIONALLY regardless of that no-op, meaning even an invalid request created a phantom undo
entry before this task. Fixed (§9) to pre-check outside `commit()`, matching every other rejecting
store action in this file.

**I. What does the UI expect?** The popover never enforces bounds itself (per its own doc comment:
"this component never enforces the bounds itself, only displays them for context") — `onCommit`
(→ `updateWordTiming`) is the sole authority; the UI just displays `prevWordEnd`/`nextWordStart` as
a hint.

**J/K. First/last chronological word.** No previous/next neighbor respectively — bounded by the
caption's own start/end instead, exactly as before (this half of the contract needed no change).

**L. Gaps between words?** Irrelevant to neighbor-finding — the gap itself isn't a factor, only the
closest real word on each side (see §8).

**M. Words touching exactly?** Counts as a valid neighbor (half-open `[start,end)` convention,
matching P18.8's own boundary-touching rule).

**N. Overlapping/corrupt data?** A candidate that overlaps the target satisfies neither
"before" (`candidate.end <= target.start`) nor "after" (`candidate.start >= target.end`) — it's
simply excluded from consideration, never picked as a neighbor.

**O. Is a `removed` word's own nudge special-cased?** No — the pre-existing code never checked
`.removed` at all. Preserved exactly: a removed word can still be nudged, and still counts as a
blocking neighbor for others.

**P. Non-monotonic array order.** The entire point of this task — see §5/§6.

**Q/R. Smallest safe way to derive chronological neighbors, without changing array order?** A new
pure function, `findChronologicalWordNeighbors(words, wordIndex)` — a plain O(n) scan comparing
real timestamps, never touching the array itself (see §8).

**S. Can the function remain pure?** Yes — no state, no mutation, same as every other word-timing
helper in this module.

**T. Can the fix preserve the existing return contract?** Yes for both: `clampWordTiming` keeps its
exact `{start,end} | null` signature (null's meaning is extended, not changed in shape — see §6);
`updateWordTiming` keeps its exact `void` signature (no UI currently needs to distinguish "rejected"
from "applied" for a word nudge — the word's displayed timing simply doesn't change).

## 5. Original reproduction

`editor-store-word-nudge-bounds.test.ts` test 0 (MANDATORY REGRESSION), the task's own exact live
reproduction: caption `[1.75, 6.0]`, words BRAVO=[2,3] (array index 0), DELTA=[5,6] (index 1, moved
there by an actual `reorderWord` in the store tests / by hand in live QA), CHARLIE=[3.5,4.5] (index
2, chronologically BETWEEN BRAVO and DELTA). Requesting CHARLIE's start move from 3.5→3.6 — safely
inside its real bounds (3.0–5.0) — against the CURRENT (pre-fix) code produced `{start: 6, end: 6}`:
the buggy `clampWordTiming` used `words[1]` (DELTA, end=6.0) as CHARLIE's "previous" neighbor and
`subtitle.end` (also 6.0, since CHARLIE was array-last) as its "next" bound, collapsing the allowed
range to a single degenerate point and silently discarding the request. Run against the unfixed
tree, the test failed with exactly that `{start:6, end:6}` vs. the expected `{start:3.6, end:4.5}`.
After the fix, the same test passes unmodified.

## 6. Exact unsafe behavior

`clampWordTiming` derived `prevEnd`/`nextStart` from `words[wordIndex-1].end`/
`words[wordIndex+1].start` — positions in the array, not real time. `captions-panel.tsx`'s "Bounded
by" label and `timeline.tsx`'s word-drag snap target did the identical thing independently, feeding
the popover a wrong display and the drag a wrong snap guide.

## 7. Chosen semantics

Unchanged clamp SHAPE (still floor/ceiling with a minimum-duration floor) — only the neighbor
SOURCE changed: every word's real chronological predecessor/successor (by actual timestamp,
independent of array position), never sorted, never mutated. Additionally: if those real neighbors
leave no room for even a minimum-duration word (genuinely overlapping/corrupt neighbor data — a
case the old code could silently turn into an inverted interval), the whole request is now REJECTED
(`null`) rather than producing a broken result — reusing `clampWordTiming`'s own pre-existing `null`
return, not a new architecture.

## 8. Chronological-neighbor algorithm

`findChronologicalWordNeighbors(words, wordIndex)` (new, word-timing.ts): for the target word only,
scans every OTHER word once and keeps the MAXIMUM `end` among candidates where `candidate.end <=
target.start` (closest real predecessor) and the MINIMUM `start` among candidates where
`candidate.start >= target.end` (closest real successor). Malformed candidates (non-finite
start/end) are skipped — same convention as `getRenderableWordSegments`/
`validateWordsWithinCaptionBounds`. `removed` words are NOT skipped (unchanged pre-existing
behavior — never special-cased). Returns `{prevEnd: null, nextStart: null}` for a malformed target.
O(n) in the target caption's own word count; never sorts, reorders, or mutates `words` — the
persistent array stays in exactly whatever order the user (or word reorder) left it in, which is
precisely why P18.6's textual/array-order semantics remain fully intact: this function only ever
READS timestamps to answer "what are this word's real neighbors," it never writes anything back
into array position.

`clampWordTiming` now calls this once, substitutes `subtitle.start`/`subtitle.end` for a `null`
side (unchanged fallback behavior), and — new — returns `null` outright when
`upperBound - lowerBound < MIN_WORD_DURATION_SEC` before attempting the old clamp math (which could
otherwise produce `end < start` for a genuinely-inverted neighbor pair).

## 9. Store integration

`updateWordTiming` (editor-store.ts) now pre-checks `clampWordTiming` OUTSIDE `commit()` — since
`commit()` unconditionally pushes history/sets dirty whenever it's called (confirmed by reading its
own implementation — no built-in no-op detection), the only way to guarantee zero of that for an
unsatisfiable request is to never call `commit()` at all. This mirrors the exact double-check
pattern `updateSubtitleTiming`/`splitSubtitleAtTime`/`mergeWithNext` already use: check once before
committing, then re-derive against the fresh snapshot inside the mutator as defense against state
changing in between. Return type stays `void` (Phase-0 Q T) — nothing currently needs to
distinguish rejected from applied for a word nudge.

`captions-panel.tsx` and `timeline.tsx`'s own `prevWordEnd`/`nextWordStart` computations were
switched to call `findChronologicalWordNeighbors` directly (display/snap-proposal only in both
cases — the actual authority, `clampWordTiming`, is unaffected by this and was already correct
once fixed).

## 10. Metadata/reference preservation

A nudge only ever writes `{...w, start, end}` for the ONE targeted word (unchanged shape from
before this task); every other field (`text`, `confidence`, `style`, `removed`, `hinglishText`,
`gujaratiScriptText`) and every OTHER word's object reference is untouched — verified by store
tests #15/16/17/20/21/22/23 (metadata preservation, other-word reference preservation, removed-word
behavior, derived fields).

## 11. Quality behavior

Unchanged mechanism. A successful nudge changes the subtitles array reference through the normal
`commit()` path, so an existing quality report goes stale exactly as before (test #27). A rejected
nudge makes zero mutations, so nothing goes stale (same test).

## 12. Undo/redo

A rejected nudge: zero `past` entries (test #26), confirmed live (no toast, no visible change,
timing untouched). A successful nudge: exactly one `past` entry; undo/redo round-trips exact timing
(tests #24/#25, and live QA's own undo→redo cycle).

## 13. Autosave

Unchanged — a successful nudge still goes through `commit()` → `dirty: true` → the existing
`useAutosave` watch (test #28; live QA showed the header's "Saved" indicator update). A rejected
nudge never sets `dirty` (test #28b).

## 14. Performance

Store test #36 (parameterized over word counts 5/20/100/500/1000 × caption counts
30/300/1800/3600/5400 = 25 cases): a nudge on one caption completes in under 150ms at every
combination, and every OTHER caption keeps its exact object reference. `findChronologicalWordNeighbors`
is a single linear scan of the TARGET caption's own words only — never the whole project.

## 15. Tests

1620/1620 (baseline 1545 + 75 new: 19 pure-function tests appended to `word-timing.test.ts` (#45–63,
covering monotonic/non-monotonic/gaps/touching/overlapping/malformed/removed/lone-word/no-mutation
cases for `findChronologicalWordNeighbors`, plus `clampWordTiming`'s own reproduction/reject/
out-of-range/lone-word cases), and 56 in the new `editor-store-word-nudge-bounds.test.ts` (the
mandatory regression plus all 36 of the task's numbered categories: monotonic baseline,
non-monotonic in every array/chronological arrangement, first/last-chronological-at-wrong-index,
gaps, touching, valid/invalid start/end nudges, minimum duration, full metadata/reference/array-
order/text preservation, removed-word and derived-field preservation, undo/redo, rejected-nudge
history/dirty behavior, quality staleness, word-reorder+nudge, multiple non-monotonic words, gaps+
non-monotonic combined, malformed index, overlapping/corrupt input, lone-word edge case, and the
5×5 performance matrix). No existing test was deleted or weakened; all pre-existing
`updateWordTiming` call sites (caption-row-render-stability.test.ts, editor-store-output-mode.test.ts,
editor-store-undo-redo.test.ts) continued to pass unmodified, since none of their fixtures happened
to trigger the old array-adjacent bug.

## 16. Live QA

Duplicated the original (unmodified) `P18.7 Split-Merge QA` disposable project fresh (captions ALFA
/ BRAVO CHARLIE DELTA / HOTEL INDIA JULIET KILO, real word timestamps, clean/unreordered state) via
the dashboard's own Duplicate action.

1. Seeded state confirmed: BRAVO 2–3, CHARLIE 3.5–4.5, DELTA 5–6.
2. Used the word-timing popover's "Move left" on DELTA once.
3. Confirmed array/textual order became "BRAVO DELTA CHARLIE".
4. Confirmed real timestamps stayed BRAVO 2–3, DELTA 5–6, CHARLIE 3.5–4.5 (word chips).
5. Opened CHARLIE's popover.
6. Confirmed "Bounded by" read **00:03.00 – 00:05.00** — CHARLIE's real chronological neighbors
   (BRAVO's end, DELTA's start) — not the old broken "6.00 – 6.00".
7. Performed a valid start nudge (the "+"/Later button): CHARLIE's start moved from 3.50 to 3.55
   (chip displayed 3.54 due to pre-existing float-formatting, unrelated to this fix).
8/9. Confirmed only CHARLIE's own timing changed — BRAVO (2–3) and DELTA (5–6) chips stayed
   exactly as shown before.
10. Metadata (style/confidence/removed/derived fields) preservation was NOT visually distinguishable
   in this particular fixture's plain words (none had an explicit override) — covered exhaustively
   at the unit level instead (§15); see NOT TESTED.
11. Performed a valid end nudge: typed `7.0` into the End field directly.
12/13. Confirmed the invalid request (past DELTA's real start) was CLAMPED to exactly **5.00**
   (DELTA's own real start) rather than corrupted or silently discarded — BRAVO/DELTA unaffected.
14. Undo: one `Ctrl+Z` restored CHARLIE to `[3.54, 4.50]` (the post-nudge-1 state), confirming
   exactly one history step per successful commit.
15. Redo: restored `[3.54, 5.00]` exactly.
16. Reloaded the editor URL directly: array order "BRAVO DELTA CHARLIE" and CHARLIE's timing
   `[3.54, 5.00]` both persisted exactly through the database round-trip.
17. (same as 16 — persistence confirmed.)
18. Ripple Insert (1.00s at the caption's own start, 1.75): caption shifted to `[2.75, 7.00]`, words
   shifted by +1s each (BRAVO 3–4, DELTA 6–7, CHARLIE 4.54–6.00, confirmed via chips). Reopened
   CHARLIE's popover: "Bounded by" now read **00:04.00 – 00:06.00** — BRAVO's NEW end and DELTA's
   NEW start — proving the neighbor computation uses CURRENT, not stale pre-ripple, timestamps.
19. Real MP4 export — see §17.
20. See §17 for the two-plus frames proving correct highlighting.

Ripple Delete was not separately exercised (only Insert) — see NOT TESTED, same limitation P18.8's
own report already carried forward for the equivalent case.

## 17. Export verification

Exported the project after the full reorder+nudge+ripple sequence above (server-side FFmpeg, no
error; export POST 200 OK, output file 181,465 bytes). Extracted three frames with the project's
own `ffmpeg-static` binary and inspected them directly:

- t=3.5s → **BRAVO** highlighted (its real `[3,4]`).
- t=5.0s → **CHARLIE** highlighted (its real `[4.54,6.00]`) — CHARLIE is LAST in array/textual
  order (rendered text: "BRAVO DELTA CHARLIE") but chronologically BEFORE DELTA, which sits before
  it in the array. This is the task's own "key export proof": a word last in array order but
  chronologically earlier than another word still highlights at its own real timestamp after the
  nudge (and after the ripple shift, and after the reorder).
- t=6.5s → **DELTA** highlighted (its real `[6,7]`).

No malformed ASS, no missing/duplicated words, no FFmpeg error.

## 18. NOT TESTED

- Ripple Delete immediately followed by a word nudge was not separately live-clicked (only Ripple
  Insert was); structurally identical to the Insert case that was tested (both just change caption/
  word timestamps before `findChronologicalWordNeighbors` runs on whatever is current).
- Live-QA item 10 (style/confidence/removed/derived-field preservation) was not visually
  distinguishable in the browser for this particular fixture (plain words, no explicit overrides) —
  covered exhaustively instead by store tests #15/16/17/20/21/22/23, which use a fixture with real
  confidence/style/hinglishText/gujaratiScriptText/removed values and assert every field byte-for-
  byte before/after a nudge.
- The timeline's own word-handle DRAG interaction (`TimelineWordHandles`, as opposed to the
  popover's +/- buttons and typed inputs) was not separately live-dragged in the browser — it
  shares the exact same `clampWordTiming` call (already proven fixed) and its own snap-target fix
  is covered by code review/typecheck, not a live pointer-drag QA pass.
- Keyboard-only word timing controls: none exist in this codebase (confirmed by Phase-0 grep — only
  the popover's mouse-driven +/- buttons and typed inputs, and the timeline's mouse drag).

## 19. Known limitations

None affecting this task's own guarantee: a word-level timing nudge (popover, typed input, or
timeline drag) can no longer silently corrupt a non-monotonic word's real timing, and the "Bounded
by" display / drag snap target now agree with the actual authoritative clamp in every case audited.

## 20. Protected systems

`clampWordsToCaptionBounds`, `validateWordsWithinCaptionBounds`, `updateSubtitleTiming`,
`resolveTimingUpdate`, Split, Merge, Ripple Delete, Ripple Insert, Word Reorder semantics, P18.2
memoization, P18.3 word styles, P18.4 error boundaries, P17 display-mode architecture, quality
architecture, autosave, `commit()`, undo/redo architecture, waveform, playback architecture,
Whisper, FFmpeg/export, Electron packaging — none were modified (confirmed by the full test suite
passing with no changes to any of their own test files' assertions). The word-timing popover itself
(word-timing-popover.tsx) was not touched at all — it already consumed whatever `prevWordEnd`/
`nextWordStart` it was given; only the VALUES fed to it (in captions-panel.tsx) changed.

## 21. Packaging

NOT REQUIRED. No version bump (stays 0.1.17). No Electron changes.

## 22. Final verification

- `npm test`: 1620/1620 PASS
- `npx tsc --noEmit`: PASS (0 errors)
- `npx eslint .`: PASS (0 errors, 5 pre-existing warnings, unchanged from baseline)
- Live QA: 18 of 20 listed scenarios directly exercised in the browser (see §16/§18)
- Real MP4 export: verified via direct frame extraction, correct highlighting proven for all three
  non-monotonic words after reorder + nudge + ripple

## 23. P19 status

NOT STARTED.
