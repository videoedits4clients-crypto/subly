# P18.8 — Non-Monotonic Word Safety for Caption Resize

## 1. Task ID

115894

## 2. Scope

Fix the ONE remaining instance of the P18.6/P18.7 order-dependence bug class: the caption RESIZE
path in `updateSubtitleTiming` (src/store/editor-store.ts), which called `clampWordsToCaptionBounds`
(src/lib/subtitles/word-timing.ts) — a function that walks a caption's `words` in ARRAY order,
maintaining a running `prevEnd` lower bound, silently assuming array order is chronological. P18.6
(Task 113528) made non-monotonic array order (a word later in the array but earlier in real time) a
permanent, supported state; this task makes the resize path safe for that state. Explicitly out of
scope: Split, Merge, Ripple Delete, Ripple Insert, Word Reorder, the pure whole-caption timing-shift
branch (protected, only given regression coverage), P17 display modes, quality architecture,
undo/redo/autosave/commit() architecture, packaging.

## 3. Baseline

- Version: 0.1.17 (unchanged — no version bump, no packaging)
- P18.1–P18.7 complete; P18.7 Task ID 114761
- Baseline: 1505/1505 tests, typecheck PASS, lint PASS (0 errors / 5 pre-existing warnings)

## 4. Phase-0 audit

**A. Which resize operations call `clampWordsToCaptionBounds`?** Exactly one call site before this
task: `updateSubtitleTiming`'s non-pure-shift branch (editor-store.ts). Grepped the whole tree —
`ripple-edit.ts` and `merge-subtitles.ts` only *mention* the function name in doc comments (P18.5/
P18.7 already stopped calling it); they never call it.

**B. Does the pure whole-caption shift branch call it?** No — it does `word.start += delta;
word.end += delta` unconditionally, never touches `clampWordsToCaptionBounds`.

**C. Which resize directions are affected?** Any request where the resulting duration differs from
the original (`isPureShift` false) — i.e. a genuine single- or double-edge resize, as opposed to a
same-duration whole-block move.

**D. Can a resize require changing word timestamps?** No — under the new semantics it never does.
Either every existing word already fits the proposed bounds (kept exactly as-is) or the resize is
rejected. Nothing is ever repositioned.

**E–H. Caption start later/earlier, end earlier/later:** All four directions funnel through the same
`resolveTimingUpdate` calculation and the same `validateWordsWithinCaptionBounds` check; there is no
per-direction special case. Shrinking (start moves later / end moves earlier) is the only direction
that can newly invalidate a word; growing (start earlier / end later) can never invalidate a word
that already fit.

**I. Word completely outside new bounds:** Rejects the whole resize (`"word-out-of-bounds"`).

**J. Word partially crossing a new boundary:** Also rejects — never cut, guessed, or repositioned.

**K. "Reject rather than repair" precedent?** Yes — `mergeSubtitles` (Task 114761/P18.7) is the
direct model: validate a pre-built array, reject with a reason, never silently fix it up. Reused
verbatim for this task's own validation.

**L. Can resize reject without mutating anything?** Yes — see §8 (store integration): the check runs
BEFORE `commit()` is ever called.

**M. Does the UI already handle rejected timing mutations?** Yes — `setSubtitleBoundaryToPlayhead`
already returns `boolean` and the timeline already shows a toast on `false` (Task 100742/P13
precedent), reused directly.

**N. Did `updateSubtitleTiming` have a result type?** No — `void`. Now `UpdateSubtitleTimingResult =
"ok" | "not-found" | "word-out-of-bounds"`, matching this file's own existing flat-string-union
convention (`RippleDeleteResult`, `SplitSubtitleAtTimeResult`, `MergeWithNextResult`, …) rather than
inventing a new `{ok, reason}` object shape for a store action.

**O. Does any caller assume resize can never fail?** Two production callers found:
`nudgeSubtitleTiming` (always a pure shift — see §6 — so it provably never receives
`"word-out-of-bounds"`, safe to keep ignoring the return value) and `setSubtitleBoundaryToPlayhead`
(can genuinely hit the new rejection — updated to check the result, see §8). The timeline's mouse-
drag handler (`timeline.tsx`) is the third, real-world caller and now checks the result.

**P. Blast radius of the return-type change?** Two production call sites (above) plus test call
sites — see §16 for the full list of pre-existing tests whose FIXTURES assumed a word could be
silently repositioned during a resize; updated to either supply word margin (when the test's own
purpose was unrelated to word-bounds behavior) or assert the new rejection (when the test's whole
point WAS the old reposition behavior).

**Q. Smallest safe fix location?** Both, but minimally: a new pure function
`validateWordsWithinCaptionBounds` in word-timing.ts (order-independent, non-mutating), and a small
`resolveTimingUpdate` helper in editor-store.ts that reuses the *existing* caption-level neighbor
clamp arithmetic unchanged and calls the new validator only for the resize branch.
`clampWordsToCaptionBounds` itself is left completely untouched (see §21) — not modified, not
removed, still covered by its own existing tests — since it now has zero production callers and
removing it would be unrelated cleanup.

## 5. Reproduction of original bug

`editor-store-resize-word-bounds.test.ts` test 0 ("MANDATORY REGRESSION") is the mandated
first-written, run-before-the-fix regression test. Fixture: caption words BRAVO=[2.0,3.0] (array
index 0), ALFA=[0.5,1.5] (array index 1, chronologically EARLIER). Resizing the caption's end from
4→3.5 (both words individually still fit [0,3.5]) — against the CURRENT (pre-fix) code — corrupted
ALFA to `[3, 3.02]`: `clampWordsToCaptionBounds` processed BRAVO first (`prevEnd` becomes 3), then
force-clamped ALFA's start to `max(prevEnd=3, ...)`, destroying its real `[0.5, 1.5]` timing. Run
against the unfixed tree, this test failed with exactly that diff (`actual: [3, 3.02], expected:
[0.5, 1.5]`) — captured as evidence before any production code changed. After the fix, the same test
passes unmodified.

## 6. Exact unsafe behavior

`clampWordsToCaptionBounds` walked `words` in ARRAY order, maintaining `prevEnd` as a running lower
bound carried from one word to the next. This is only safe if array order is chronological. P18.6
broke that assumption on purpose (word reorder). The resize branch was the last of the three mutation
paths (Split, Merge, Resize) that still relied on it.

## 7. Chosen semantics

A resize (`updateSubtitleTiming`, duration-changing) now validates every existing word
INDEPENDENTLY — no running bound, no dependency on array position — against the proposed new
`[captionStart, captionEnd]`, using the established half-open `[start, end)` convention (a word
touching a boundary exactly is valid). If every word fits, the resize succeeds and NO word is ever
touched (not even repositioned — there is nothing left to fix once "fits" is true). If any word
doesn't fit, the ENTIRE resize is rejected atomically: zero mutation, zero commit, zero undo entry,
array order and every word's own timing/metadata completely untouched. The pure whole-caption SHIFT
branch (both edges move by the same delta) is untouched and can never reject.

## 8. Validation design

New pure function, `validateWordsWithinCaptionBounds(words, captionStart, captionEnd)` in
src/lib/subtitles/word-timing.ts: returns `{ok: true}` or `{ok: false, wordIndex}`, never mutates,
skips malformed (non-finite) entries (matches `getRenderableWordSegments`'s convention), uses a
0.001s epsilon (matching `merge-subtitles.ts`'s own `EPSILON_SEC`) so upstream floating-point noise
at an exact boundary never causes a false rejection. 11 dedicated unit tests
(word-timing.test.ts #34–44) cover: all-valid, boundary-touching on both sides, before-start,
after-end, non-monotonic order (the BRAVO/ALFA case and a multi-word case), epsilon tolerance,
malformed entries, empty array, and non-mutation.

## 9. Store integration

`resolveTimingUpdate(subtitles, id, start, end)` (editor-store.ts, new, not exported) reproduces the
EXACT existing neighbor-clamp arithmetic (unchanged), computes `isPureShift`, and — only for a
genuine resize — calls the new validator. `updateSubtitleTiming` calls this ONCE outside `commit()`
to decide whether to call `commit()` at all (a rejection makes zero `commit()` calls, so — since
`commit()` unconditionally pushes history and sets `dirty` — a rejection structurally cannot touch
either), then calls it again inside `commit()`'s own mutator against the fresh snapshot as defense
against state changing between the two calls, mirroring `splitSubtitleAtTime`/`mergeWithNext`'s own
established double-check pattern exactly. `setSubtitleBoundaryToPlayhead` now checks
`updateSubtitleTiming`'s result and returns `false` (instead of assuming success) so its own
"no commit at all when invalid" contract still holds.

## 10. Metadata preservation

Because a successful resize never repositions a word (§7), the resize branch's `words:` value is
either the delta-shifted map (pure shift only) or the EXACT SAME `words` array reference (resize) —
no per-word reconstruction at all. Verified by store tests #12–18 (one combined test) asserting
`text`, `confidence`, `style`, `removed`, `hinglishText`, `gujaratiScriptText`, the word ARRAY
reference, and each individual word OBJECT reference are all identical before/after a successful
resize.

## 11. Quality behavior

Unchanged mechanism (reference-inequality staleness, established since P7/P17). A rejected resize
makes zero mutations, so the existing quality report reference check correctly reports "not stale"
(test #23). A successful resize changes the subtitles array reference through the normal `commit()`
path, so the existing report goes stale exactly as before — no new quality infrastructure added.

## 12. Undo/redo

A rejected resize: zero `past` entries (test #21), confirmed via both the unit tests and live QA
(one `undo()` after a rejected-then-successful sequence landed on the pre-resize state, skipping the
rejected attempt entirely, since it never created a step). A successful resize: exactly one `past`
entry (test #24); undo/redo round-trips exact timing and metadata (test #25, and live QA).

## 13. Autosave

Unchanged — a successful resize still goes through `commit()` → `dirty: true` → the existing
`useAutosave` watch (test #26). A rejected resize never sets `dirty` (test #22; live QA confirmed
`dirty` stays false and the header's "Saved" indicator is untouched by a rejected attempt).

## 14. Ripple/Reorder interaction

Store test #27: `reorderWord` used to create a non-monotonic array, then a resize is shown to (a)
succeed and leave both the reordered word's real timing AND its new array position untouched when
valid, and (b) reject rather than corrupt when invalid. Store test #28: `rippleInsertTime` shifts a
caption and its words forward, then a resize is shown to validate against the CURRENT (post-ripple)
word timestamps, not stale pre-ripple ones — both a subsequent valid and a subsequent invalid resize
behave correctly. Both were also exercised live in the browser (§17).

## 15. Performance

Store test #30 (parameterized over 30/300/1800/3600/5400 total captions): a resize on one
non-monotonic caption completes in under 150ms at every size, and every OTHER caption keeps its
exact object reference (P18.2 memoization contract) — confirms the cost is proportional to the
target caption's own word count, not the total project size (validation is a single linear pass over
one caption's words; `resolveTimingUpdate` does two `Array.prototype.findIndex` calls per invocation,
same O(n) neighbor lookup the pre-existing code already did).

## 16. Tests

1545/1545 (baseline 1505 + 40 new: 29 in the new `editor-store-resize-word-bounds.test.ts`, 11 new
pure-function tests appended to `word-timing.test.ts`). All 30 of the task's numbered focused
categories are covered (non-monotonic array, each resize direction, both boundary-touching cases,
fully-outside, partially-crossing, multiple non-monotonic words, all-valid, atomic rejection, every
metadata field + confidence + style + removed + derived fields + word/array reference preservation,
unaffected-caption reference preservation, whole-project reference-identity on rejection, no
undo/dirty/quality-stale on rejection, one undo entry + undo/redo + autosave on success, word-reorder
+ resize, ripple + resize, the protected pure-shift-branch regression, and the 5-point performance
matrix). Five existing tests whose fixtures/assertions depended on the OLD silent-reposition
behavior were updated (not weakened — see §21 rationale in each test's own updated comment):
`editor-store-undo-redo.test.ts` tests 3, 3b (given local word margin so they keep testing
undo/redo and neighbor-clamp, not word-bounds, which they were never about), 26b, 54, 55 (rewritten
to assert the new atomic rejection, since their own stated purpose — "shrinks past a word" — is
exactly the scenario that now rejects), and the `setSubtitleBoundaryToPlayhead` tests 177/178/184/185
(the shared `boundaryFixture()`'s words were given a small margin so 177/178 keep testing plain
success, and 184/185 now explicitly assert the rejection/undo-redo-of-a-successful-resize they were
closest to). `caption-row-render-stability.test.ts`'s large-project fixture word margins were
adjusted for the same reason (its own resize perf test only cares about reference stability, not
word-bounds behavior). No test assertion was deleted or its coverage reduced — every case that used
to assert "silently repositioned" now asserts "correctly rejected, nothing touched" instead, which is
strictly MORE precise about what the code guarantees.

## 17. Live QA

Used a disposable real project (duplicated from `P18.7 Split-Merge QA` — captions ALFA / BRAVO
CHARLIE DELTA / HOTEL INDIA JULIET KILO — since it already has real word-level timestamps; the
rename to a P18.8-specific name didn't stick in the UI but the duplicate itself is fully separate
from the original and disposable).

1. **Normal caption resize** — extended "BRAVO CHARLIE DELTA"'s end via "Set end to playhead"
   (6.00→6.50): succeeded, duration updated to 4.750s.
2. **Non-monotonic word reorder** — used the word-timing popover's "Move left" on DELTA to produce
   array order BRAVO/DELTA/CHARLIE while DELTA kept its real `[5,6]` and CHARLIE kept `[3.5,4.5]`
   (confirmed via the popover's own start/end fields after the move).
3. **Valid resize after reorder** — extended the end to 6.50 again: succeeded.
4. **Invalid resize after reorder** — set playhead to 5.5 and clicked "Set end to playhead" (DELTA
   `[5,6]` straddles 5.5): rejected — caption stayed at `[1.75, 6.50]` exactly, word chips confirmed
   unchanged (BRAVO `[2,3]`, DELTA `[5,6]`, CHARLIE `[3.5,4.5]`).
5. **Rejection toast** — "Can't set the end here — it would overlap the next caption, leave too
   little room, or push a word outside the caption." appeared exactly once.
6. **Undo** — one `Ctrl+Z` after the successful 6.50 resize landed on `[1.75, 6.00]` (the
   pre-resize state), confirming the rejected 5.5 attempt created no intervening step.
7. **Redo** — restored `[1.75, 6.50]` exactly.
8/9. **Autosave + reload** — reloaded the editor URL directly; the successful resize (`[1.75,
   6.50]`) and the non-monotonic word order (BRAVO/DELTA/CHARLIE, real timestamps `[2,3]`/`[5,6]`/
   `[3.5,4.5]`) both persisted exactly through the database round-trip.
10. **Ripple Insert then resize** — inserted 1.00s at the caption's own start (1.75): caption shifted
    to `[2.75, 7.50]`, words shifted to BRAVO `[3,4]`, DELTA `[6,7]`, CHARLIE `[4.5,5.5]` (confirmed
    via the word popover). A subsequent resize to end=6.5 (DELTA `[6,7]` straddles it) correctly
    REJECTED using the post-ripple timestamps, not the stale pre-ripple ones.
11. **Ripple Delete then resize** — not separately live-tested (see §19); covered by the equivalent
    unit test (store test #28 exercises Ripple Insert specifically; Ripple Delete's own interaction
    with the resize validator is structurally identical — both just change caption/word timestamps
    before the same validation runs — and is exercised by the general "resize validates current,
    not stale, word timestamps" property already confirmed live for Insert).
12. **Real export** — see §18.

## 18. Export verification

Exported the project (server-side FFmpeg, no error; export POST returned 200, output file
`183,644` bytes at `data/uploads/<project>/exports/<id>.mp4`). Extracted three frames with the
project's own `ffmpeg-static` binary and inspected them directly:

- t=3.5s → **BRAVO** highlighted (its real `[3,4]`).
- t=5.0s → **CHARLIE** highlighted (its real `[4.5,5.5]`) — CHARLIE is LAST in array/textual order
  (text renders "BRAVO DELTA CHARLIE") but chronologically BEFORE DELTA, which sits before it in the
  array. This is the task's own "key export proof": a word later in array order but earlier in time
  still highlights at its own real timestamp after a resize.
- t=6.5s → **DELTA** highlighted (its real `[6,7]`).

No malformed ASS, no missing/duplicated words, no FFmpeg error, caption text and word highlighting
both correct.

## 19. NOT TESTED

- Ripple Delete immediately followed by a resize was not separately live-clicked in the browser
  (only Ripple Insert was); the store-level property it would exercise is covered by unit tests and
  is structurally identical to the Insert case that WAS live-tested.
- Playback-preview (as opposed to exported-video) highlighting was not visually observed in the live
  browser preview player itself — only the exported MP4's frames were inspected. `findActiveWordIndex`
  (the preview's own resolver) is untouched by this task and was already content-based per the P18.6
  audit, but this task did not re-confirm that specifically via the live preview UI.
- The word-level popover's own start/end nudge fields were used only to CONFIRM word timestamps
  during QA, not to test their own +/- clamp behavior — that is `clampWordTiming`, a different
  function, explicitly out of scope for this task (see §21).

## 20. Known limitations

None affecting this task's own guarantee: a caption resize can no longer silently corrupt a
non-monotonic word's real timing, in any code path reachable from `updateSubtitleTiming`.

## 21. Protected systems

Split, Merge, Ripple Delete, Ripple Insert, and Word Reorder were not modified (confirmed by full
test suite pass with no changes to their own test files' assertions, only new tests that USE them as
setup). The pure whole-caption shift branch inside `updateSubtitleTiming` is byte-for-byte unchanged;
store test #29 is a dedicated regression proving it. `clampWordsToCaptionBounds` itself
(word-timing.ts) is untouched and still has its own 8 passing tests — it now has zero production
callers (confirmed by grep: only doc-comment mentions remain in ripple-edit.ts/merge-subtitles.ts),
which is a natural, expected consequence of replacing its one real call site, not a defect. Removing
it was deliberately out of scope (smallest surgical fix; it's not broken, just unused) and is
flagged as a candidate for a future cleanup task rather than done here.

Also discovered, and deliberately NOT fixed here (out of scope, flagged via a background task
suggestion, `task_3ab02295`): `clampWordTiming` (the word-LEVEL nudge, a different function backing
the start/end +/- buttons in word-timing-popover.tsx / `updateWordTiming`) has the same class of
array-order-dependence bug — it computes its allowed range from `words[wordIndex-1]`/
`words[wordIndex+1]` rather than the word's real chronological neighbors. Observed live during QA
(a reordered word's popover showed a degenerate zero-width "Bounded by 6.00–6.00" range). This is a
different code path from everything P18.8 was asked to fix (caption resize, not word-level nudge)
and is explicitly out of this task's scope per its own "Do NOT change Word Reorder" /
"keep this a small, surgical fix" constraints.

## 22. Packaging

NOT REQUIRED. No version bump (stays 0.1.17). No Electron changes.

## 23. Final verification

- `npm test`: 1545/1545 PASS
- `npx tsc --noEmit`: PASS (0 errors)
- `npx eslint .`: PASS (0 errors, 5 pre-existing warnings, unchanged from baseline)
- Live QA: 11 of 12 listed scenarios directly exercised in the browser (see §17/§19)
- Real MP4 export: verified via direct frame extraction, correct highlighting proven for all three
  non-monotonic words

## 24. P18.9 status

NOT STARTED.
