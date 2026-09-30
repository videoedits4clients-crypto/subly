# P19.5 — Ripple Delete & Structural Timeline Editing Hardening

## 1. Task ID

125843

## 2. Scope

Audit and, only where necessary, harden ripple delete: exact-caption removal, exact shift of subsequent captions, order/word-timing preservation (including non-monotonic word arrays), no negative timestamps, no overlaps, correct multi-selection (contiguous vs. non-contiguous) semantics, exactly one undo step, no unrelated state mutation, and preserved non-ripple delete behavior. Bounded — no editor redesign, no timeline architecture rewrite, no new state machine, no schema/DB changes. P19.4 is closed and was not reopened.

## 3. Phase-0 audit

Read `editor-store.ts`'s delete/ripple/undo/selection/quality actions, `lib/subtitles/ripple-edit.ts`, both existing ripple test files, `timeline.tsx`'s ripple-delete UI wiring, `use-keyboard-shortcuts.ts`'s Delete/Backspace handling, and the relevant P18.5/P18.6/P18.7/P18.10/P19.1–P19.4 context already established in this session, plus a full-tree grep for every term the task listed. This task's Phase 0 found ripple delete was **already a mature, extensively-tested P18.5 feature** — the matrix below reflects that.

| Case | Current behavior (before this task) | Safe/Unsafe | Code path |
|---|---|---|---|
| A. Single caption ripple delete | Removes it, shifts everything after by its own duration | Safe | `resolveRippleDelete` (k=1 case), already tested |
| B. Contiguous multi-caption | Removes the whole block, shifts by the block's total span | Safe | Already tested against the task's own A/B/C/D worked example |
| C. Non-contiguous multi-selection | Rejected outright (`"non-contiguous-selection"`), no commit | Safe (explicit rejection, not a guess) | `isContiguousSelection`/`resolveRippleDelete`, already tested |
| D/E/F. First/middle/last caption | First: no negative timestamp (tested). Middle: block deletion (tested). Last: nothing after to shift, still one valid commit (tested) | Safe | Already tested |
| G. Captions with word timings | Every surviving word shifts by the caption's own delta; metadata (confidence/style/removed/derived text) preserved exactly | Safe | Already tested |
| H. Non-monotonic word-array order | `shiftWordsByDelta` is a positional `.map()` — never sorts, never reads chronology | Safe by construction, but **no regression test existed proving it** | **Gap — closed this task** (see §7) |
| I. Delete → undo | Exact original state restored | Safe | Already tested |
| J. Delete → undo → redo | Exact ripple-deleted state re-applied | Safe | Already tested |
| K/L. Near zero / near project end | Defensive `Math.max(0, ...)` floor; "nothing after" is a valid one-commit outcome | Safe | Already tested |
| M. Selection after delete | Deleted ids pruned from `selectedSubtitleIds`/`selectedSubtitleId`/`selectionAnchorId` automatically | Safe (generic `commit()`-level `pruneSelection`) | `selectedWordIndex` cleanup specifically was untested for ripple — **gap closed this task** (see §9) |
| N. Quality/review state after delete | `qualityReport`/`qualityReportSubtitles` are explicitly "never part of undo/redo" ephemeral state; staleness is detected via the generic `isQualityReportStale` reference-comparison every other mutation already relies on | Safe, already tested (store test line 125) | No special-casing needed — confirmed live (§13) |
| O. Autosave after delete | `commit()` sets `dirty:true` and a new `project` reference; the existing generic `useAutosave` subscription (watches `dirty`+`project` reference) handles the rest | Safe, generic infrastructure | Live-verified reload (§12) |

**One genuine documentation/implementation mismatch found**: `ripple-edit.ts`'s own top-of-file doc comment claimed a defensive overlap re-check "runs anyway (see § validateRippleDeleteResult)" — but **no such function existed anywhere in the codebase**. The shift-by-delta math is genuinely overlap-safe by construction for a valid, non-overlapping input (verified by re-deriving the algebra), so this was never reachable through the UI — but a documented promise that doesn't match the code is exactly the kind of finding this task's own "do not assume existing behavior is correct" instruction is for. **Closed this task** — see §5.

**No other unsafe or missing behavior was found.** Non-ripple `deleteSubtitle`/`deleteSubtitles` were confirmed completely untouched (a separate code path `rippleDeleteSubtitles` never calls), and keyboard Delete/Backspace was confirmed to route through the plain (non-ripple) delete only — ripple delete has always been a deliberate, button-only, explicitly-invoked action, never a keyboard shortcut, so invariant #12 ("preserve existing non-ripple delete behavior") was trivially already true.

## 4. Existing implementation

`lib/subtitles/ripple-edit.ts` (P18.5): `shiftWordsByDelta`/`shiftSubtitleByDelta` (identity-preserving at delta=0), `isContiguousSelection`, `resolveRippleDelete`, `resolveRippleInsert` — all pure, no React/DOM/database dependencies, already deterministic and already returning immutable new arrays. `editor-store.ts`'s `rippleDeleteSubtitles`/`rippleInsertTime` wrap these with the established "check outside for an early return, recompute fresh inside `commit()`" pattern shared with `duplicateSubtitles`/`splitSubtitleAtTime`. `timeline.tsx` wires a single "Ripple delete" button (enabled for single or multi-selection) to clear, reason-specific toasts.

## 5. Structural invariants — the one change made

Added `validateRippleDeleteResult(subtitles: readonly Subtitle[]): boolean` to `lib/subtitles/ripple-edit.ts` — the function `resolveRippleDelete`'s own doc comment already claimed existed. Checks the CANDIDATE result (already in final order): every caption has `start >= 0` and `end > start`, and no two consecutive captions overlap (`subtitles[i-1].end <= subtitles[i].start`). `resolveRippleDelete` now calls it right before returning success; on failure it returns a new, distinct rejection reason (`"invalid-result"`) rather than silently committing a corrupted result — an atomic rejection via the exact same early-return-before-`commit()` shape the existing `"empty-selection"`/`"non-contiguous-selection"` rejections already use, so no partial mutation is possible. `RippleDeleteResult`/`RippleDeleteRejectionReason` (store + pure-module types) and `timeline.tsx`'s toast handling were updated to carry this new reason through end-to-end rather than silently collapsing it into `"non-contiguous"`.

This is defense-in-depth, not a bug fix for a reachable defect: the shift-by-delta math is proven overlap-safe by construction for any valid (already-non-overlapping) selection, and every existing test (39 pure + 33 store-level, all still passing) continues to exercise only the success path through this new check without ever triggering it. No other code path was changed.

## 6. Multi-selection semantics

Confirmed via Phase 0 (and re-confirmed live, §13) that CONTIGUOUS ripple delete already matches the task's own worked example exactly: `A[0,2] B[2,4] C[4,6] D[6,8]`, selecting B+C and ripple-deleting removes `[2,6]` and shifts D to `[2,4]` — live-verified byte-for-byte against this exact example (§13). NON-CONTIGUOUS selection is explicitly rejected (`"non-contiguous-selection"`), never silently reinterpreted as "the union of everything selected" — the existing, already-established product behavior, left unchanged per this task's own "do not invent a new ambiguous semantic" instruction.

## 7. Word-level safety

Every surviving word shifts by exactly its parent caption's own delta (`newStart = oldStart - delta`, `newEnd = oldEnd - delta`); every other field (`text`, `confidence`, `style`, `removed`, `hinglishText`, `gujaratiScriptText`) is carried forward via object spread, never rebuilt; array order is never touched (`shiftWordsByDelta` is a positional `.map()`, no sort). **New mandatory regression added** (`ripple-edit.test.ts`): the task's own exact worked example — `BRAVO[2,3]`, `DELTA[5,6]`, `CHARLIE[3.5,4.5]` in that (non-chronological) ARRAY order — ripple-deleted via a preceding caption, asserting each word's own new timestamp (`BRAVO→[1,2]`, `DELTA→[4,5]`, `CHARLIE→[2.5,3.5]`) and that array order (`BRAVO, DELTA, CHARLIE`) and the fixture's own non-monotonicity (`words[1].start > words[2].start`) both survive exactly. Live-verified separately on the seeded QA fixture's own non-monotonic caption (§13).

## 8. Undo/redo

Unchanged, already correct: `rippleDeleteSubtitles` makes exactly one `commit()` call regardless of how many captions the ripple spans — `commit()` unconditionally pushes one `before` snapshot onto `past` and clears `future`. Live-verified: ripple delete → undo restored the exact original three-caption timing (including the non-monotonic caption's own word timestamps) → redo re-applied the exact same shifted result. Already covered by existing store tests (`undo restores the exact previous positions`, `redo re-applies the exact same ripple`) — unmodified.

## 9. Selection behavior

`commit()`'s existing generic `pruneSelection` (shared by every mutating action, including undo/redo themselves) already clears any deleted id out of `selectedSubtitleIds`/`selectedSubtitleId`/`selectionAnchorId`, and clears `selectedWordIndex` whenever the FOCUSED caption is one of the removed ones — ripple delete gets this for free via `commit()`, no special-casing needed. **New regression tests added** (`editor-store-ripple-edit.test.ts`): (1) selecting a caption, selecting one of its words, then ripple-deleting that exact caption — confirms `selectedSubtitleId`/`selectedWordIndex` both clear to `null`; (2) a REJECTED (non-contiguous) attempt leaves `selectedSubtitleId`, `selectedWordIndex`, and the `selectedSubtitleIds` set reference completely untouched — Phase 6's own explicit "after rejected ripple delete, EVERYTHING must remain unchanged" requirement, made explicit for selection state specifically (the subtitles-array side of that same guarantee was already tested).

## 10. Quality/review state

Not touched, and needed no changes: `qualityReport`/`qualityReportSubtitles`/`qualityIssueIndex`/`reviewedIssueIds` are explicitly documented in `editor-store.ts` as "never part of undo/redo" — staleness is detected purely by comparing the CURRENT `project.subtitles` reference against the snapshot `qualityReportSubtitles` was computed from (`isQualityReportStale`), which ripple delete triggers identically to every other subtitle-mutating action (a fresh `commit()` always produces a new `subtitles` array reference). Live-verified: ran a quality analysis (3 informational "shown longer than needed" issues across all 3 captions), ripple-deleted the first (flagged) caption, and confirmed "Next quality issue" still navigated correctly to the surviving captions' own issues — no crash, no special-casing required, matching the existing store test's own "marks stale via the normal reference mechanism, no new quality state" assertion.

## 11. Autosave/persistence

Not touched, needed no changes: the existing generic `useAutosave` hook watches `dirty`+`project`-reference changes and PATCHes the project — `rippleDeleteSubtitles`'s single `commit()` sets both, exactly like every other mutating action. Live-verified: ripple-deleted a caption, confirmed the top bar showed "Saved," reloaded the page, and confirmed the shifted structural state (exact timestamps) persisted exactly — no reversion, no partial state.

## 12. Performance

Existing store tests already measure `rippleDeleteSubtitles` at 30/300/1800/3600/**5400** captions (this task's own explicit target scale), asserting sub-millisecond-to-low-single-digit-millisecond operation time and that every caption BEFORE the deleted block keeps its exact object reference (no whole-array rebuild) — confirmed still passing unchanged. Live-verified on a seeded 1800-caption fixture: ripple-deleting the first caption completed with no visible lag, correctly shifted all 1799 remaining captions by exactly the deleted caption's own span, and left DOM caption-block virtualization intact (9 mounted blocks, unchanged from before the operation).

**Observation, out of scope**: the timeline's own ruler-tick marks are NOT viewport-virtualized (1800 DOM nodes rendered for a 1800-caption/60-minute-nominal project, one per 2-second tick) — a pre-existing characteristic of `timeline.tsx`'s ruler rendering, unrelated to and untouched by ripple delete's own (already viewport-virtualized, per P19.2/P19.4) caption-block rendering. Noted here for completeness, not fixed — outside this task's "harden ripple delete" scope.

## 13. Tests

- `lib/subtitles/__tests__/ripple-edit.test.ts`: 39 tests (was 30) — added the mandatory non-monotonic word-order regression (§7) and 5 new `validateRippleDeleteResult` unit tests (valid result passes; caption with `end<=start` rejected; caption starting before 0 rejected; two overlapping consecutive captions rejected; back-to-back/touching captions accepted; empty array trivially valid).
- `store/__tests__/editor-store-ripple-edit.test.ts`: 33 tests (was 31) — added `selectedWordIndex` cleanup on a successful ripple delete of the focused caption, and full selection/word-selection stability on a rejected (non-contiguous) attempt (§9).
- No existing test was weakened, deleted, or bypassed.
- Full suite: **1739/1739 passing** (+9 over P19.4's 1730).

## 14. Live QA

Performed in the Claude Browser pane using two disposable fixtures: the existing `P19.3 Precision Navigation QA` project (3 captions, including the non-monotonic `BRAVO/DELTA/CHARLIE` caption already used throughout P19.3/P19.4) and a newly-seeded `P19.5 Ripple Delete QA` project (5 captions — `ALPHA[0,2] BETA[2,4] GAMMA[4,6] DELTACAP[6,8] EPSILON[8,10]`, matching the task's own worked examples exactly) and the P19.4 1800-caption long-timeline fixture:

- Ran a real Subtitle Quality analysis (3 issues found), then ripple-deleted the first (flagged) caption via a REAL button click — the surviving captions shifted to EXACTLY the predicted timestamps, the non-monotonic caption's own CHARLIE word (verified by opening its own popover and reading its Start/End inputs directly: `2.25`/`3.25`, exactly `3.5-1.25`/`4.5-1.25`) shifted correctly using its own real timestamp, never an array-adjacent neighbor's.
- Undo restored the exact original 3-caption state (byte-for-bit timestamps); redo re-applied the exact ripple-deleted result.
- Reloaded the page after the ripple delete autosaved ("Saved" shown) — confirmed the shifted structural state persisted exactly.
- On the 5-caption fixture: selected BETA+GAMMA (contiguous) and ripple-deleted — DELTACAP shifted from `[6,8]` to EXACTLY `[2,4]`, matching the task's own stated expected outcome for this exact example verbatim.
- Selected ALPHA+EPSILON (non-contiguous, skipping the surviving DELTACAP) and clicked Ripple Delete — rejected atomically: all 3 remaining captions' timestamps stayed exactly unchanged, the 2-caption selection stayed exactly as it was, and the top bar continued showing "Saved" (no new commit, no dirty flag set).
- On the 1800-caption fixture: ripple-deleted "Caption number 0" via a real click — completed instantly, correctly shifted all subsequent captions (each by exactly 1.8s), and caption-block DOM virtualization stayed intact (9 mounted blocks).
- Console checked after every action: the only errors observed were confirmed (by exact stack-trace match) to be stale, self-induced artifacts from P19.4's own earlier synthetic-`PointerEvent` testing session — no new error was produced by any real interaction in this task.
- No synthetic pointer events were used for anything in this task's own live QA — every ripple-delete/undo/redo/selection/reload action was a real click, keypress, or navigation through the actual browser automation tool.

## 15. Limitations / NOT TESTED

- A true 5400-caption LIVE (browser) ripple delete was not performed — the 5400-caption scale was verified via the automated store-level performance test (§12) instead, consistent with this session's own established precedent (P19.2/P19.4) for testing extreme scale via automated tests rather than every live-QA pass; the 1800-caption scale WAS live-tested directly.
- The "invalid-result" defense-in-depth rejection (§5) has no live-QA reproduction — by design, it is unreachable through the UI for any valid selection (the whole point of "defense in depth" against a proof, not a reachable bug), so it is verified only at the pure-function level (5 new unit tests) and the store-level type wiring (compiles and returns the correct reason string), not observed via a real click producing that specific toast.
- The pre-existing ruler-tick-mark rendering characteristic noted in §12 was observed but not investigated further or fixed — outside this task's scope.

## 16. Protected systems

Not touched: Whisper/transcription/segmentation/language handling, Gujarati research/ASR, caption rendering, ASS export, FFmpeg, Electron packaging, database schema, authentication, project upload pipeline, and the P19.4 playback/scrubbing architecture (click-to-seek, scrubbing, auto-scroll — none of this task's changes touch `seek()`, pointer events, or zoom/viewport state at all). Verified by code review (every change is confined to `lib/subtitles/ripple-edit.ts`'s own new validation function, the store's ripple-delete result-reason plumbing, and one new toast branch in `timeline.tsx`) and by the existing + new reference-equality regression tests proving `project`, `subtitles` (captions before the deleted block), `past`, `dirty`, selection, and quality-report state all behave exactly as already established.

## 17. Database

No schema changes, no migrations, no production DB modifications. (A disposable QA fixture, `p19-5-ripple-delete-qa`, was seeded under the same test account established in P19.3/P19.4, through the existing, unmodified schema, solely for this task's own live QA.)

## 18. Packaging

Not required — no dependency or build-affecting change was made.

## 19. Final verification

- `npm test`: **1739/1739 passing**.
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, 5 pre-existing warnings (unchanged).
- No existing test was weakened, deleted, or bypassed.
- Version remains 0.1.17.

## 20. P19.6 recommendation

Ripple delete itself is now fully hardened and comprehensively tested; no further work is recommended on it specifically. If a P19.6 is planned, the one adjacent, out-of-scope observation from this task (§12 — the timeline ruler's own tick marks are not viewport-virtualized at extreme project lengths, unlike the already-virtualized caption blocks) would be a reasonable, narrowly-scoped candidate, but this is an observation, not a request — P19.6 is NOT STARTED and no assumption should be made about its actual scope until a real task specification is issued.
