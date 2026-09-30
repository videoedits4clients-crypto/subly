# P9 — Duplicate Collision Safety & Timeline Hardening

**Task ID:** 95640
**Status:** PASS
**Final version:** 0.1.10 (bumped from 0.1.9 only after all functional QA below passed)

## 1. Status: PASS

## 2. Task ID and final version

Task 95640. Version bumped 0.1.9 → 0.1.10 only after every gate below passed.

## 3. Phase-0 audit findings

- **`duplicateSubtitle(id)`** (pre-fix): found the caption's index, computed `dur = original.end - original.start`, and unconditionally placed the copy at `[original.end, original.end + dur]`, spliced immediately after the original. It never inspected `snap.subtitles[idx + 1]` (the next caption) at all.
- **`duplicateSubtitles(ids)`** (pre-fix): for a contiguous selection, computed `shift = spanEnd - spanStart` (the whole block's own width) and placed the copy block at `[start + shift, end + shift]` for every caption in the block, spliced immediately after the block. Same gap: never checked `subs[endIdx + 1]`.
- **Caption ordering/indexing**: `project.subtitles` is maintained as a plain array kept in sorted-by-`start` order — every mutator (`duplicateSubtitle`, `mergeWithNext`, `splitSubtitle`, `deleteSubtitle(s)`) splices at the correct array position and re-numbers `index` sequentially afterward; `updateSubtitleTiming` additionally re-`.sort()`s after any drag/nudge. "Array-adjacent" and "time-adjacent" are the same invariant everywhere else in the codebase.
- **Existing overlap-prevention logic**: `updateSubtitleTiming` (the sole caption-timing mutator for drag/resize/nudge) clamps a caption's start/end against its immediate sorted-order neighbors (`prevEnd`/`nextStart`), floored at `MIN_CAPTION_DURATION_SEC = 0.1`. `nudgeSubtitles` (batch nudge, P8) does the equivalent for a whole selection at once. Duplication was the ONE caption-adding path with no equivalent check.
- **Existing timing helpers**: `clampWordsToCaptionBounds(words, captionStart, captionEnd)` repositions word timestamps to stay inside a (possibly-changed) caption's own bounds — used by `updateSubtitleTiming`'s resize branch and `mergeWithNext`. Not needed by this fix's chosen policy (see below), since a rejected duplicate never writes anything and an accepted one is always a pure translate (words shift by the placement's own delta, never reshaped).
- **`updateSubtitleTiming`**: confirmed as the "clamp against the immediate neighbor only" precedent this fix's own fit-check (`resolveDuplicateShift`) deliberately mirrors.
- **Undo/redo / commit architecture**: unchanged — `duplicateSubtitle`/`duplicateSubtitles` still call `get().commit(mutator)` exactly once when they succeed, and make NO commit call at all when they reject (verified by `past.length` staying unchanged in tests 90–92, 103–105, 107's reject branch).
- **Autosave**: unchanged (`use-autosave.ts` watches the store's `dirty` flag; a rejected duplicate never sets `dirty`, so no wasted autosave cycle fires for a no-op).
- **Timeline rendering assumptions**: the timeline draws whatever `project.subtitles` contains; it has no assumption that duplication succeeds, so no timeline code needed to change.
- **Quality-report assumptions around overlapping captions**: `quality-analyzer.ts` already flags `s.end > next.start + 0.001` as an `"OVERLAP"` **error**-severity issue for ANY two sorted-adjacent captions — this is the existing, authoritative definition of "invalid overlap" in this editor, and this fix's `OVERLAP_EPSILON_SEC = 0.001` was chosen to match it exactly (test 108 confirms a successful duplicate never produces this issue).
- **Existing tests for duplication/timing collisions**: none existed for the collision case itself — `editor-store-undo-redo.test.ts` tests 6, 23, 64, 65 (pre-existing) all either used a fixture with no following caption, or (test 6, using the shared zero-gap-adjacent default fixture, and tests 84–86, using a fixture whose captions 2–3 didn't leave room before caption 4) happened to exercise exactly the buggy silent-overlap path without ever asserting the resulting (overlapping) timing values. These were the concrete "P8 discovered this gap" evidence and are fixed in place (see §6).

**Conclusions used to decide the policy:**
- The insertion time is always "immediately after the original(s), shifted forward by their own total width" — never negotiable, so the ONLY question is whether that placement is safe.
- Only the immediate next caption (by sorted order) can ever collide with that placement, because the project's own subtitles are otherwise mutually non-overlapping (the very invariant `updateSubtitleTiming` and `quality-analyzer.ts` already enforce/report).
- Single and batch duplication can share one fit-check function taking only `(blockStart, blockEnd, nextCaptionStart)` — nothing else differs between them.

## 4. Exact collision policy chosen

**Place the duplicate flush immediately after the original(s) (shifted forward by exactly its/their own total width — no gap introduced) ONLY when that fits entirely before whichever caption comes next in sorted order. If it does not fit, REJECT the duplication entirely: no caption is added, no commit is made, and the UI shows a toast explaining why.**

Clamp (shrinking the duplicate's own duration to fit) and shift (pushing the trailing caption and everything after it further down the timeline) were both explicitly considered and rejected:
- **Shrinking** would silently turn "duplicate this caption" into "create a differently-shaped caption" with no well-defined floor, and is impossible to apply consistently to a *batch* whose own explicit requirement is to **preserve duration** — single and batch duplication would then need two different rules, which this task explicitly forbids.
- **Shifting the trailing block** would be a far larger, more surprising change than duplication (or any other timing mutation in this codebase) has ever made — every other timing mutation (drag, resize, keyboard nudge, P8's batch nudge) only ever clamps against the *immediate* neighbor and never cascades further down the timeline.
- **Rejecting** is simple, deterministic, never destroys or reshapes data, and is explicitly an accepted outcome per this task's own spec ("if the chosen policy rejects the duplication... show a concise toast").

Implemented as one pure, shared, unit-tested helper — `resolveDuplicateShift(blockStart, blockEnd, nextCaptionStart)` in the new `src/lib/subtitles/duplicate-timing.ts` — with two thin convenience wrappers (`resolveSingleDuplicateShift`, `resolveBlockDuplicateShift`) so `duplicateSubtitle` and `duplicateSubtitles` can never disagree about "enough room."

## 5. Exact files changed

- **`src/lib/subtitles/duplicate-timing.ts`** (new) — `resolveDuplicateShift`, `resolveSingleDuplicateShift`, `resolveBlockDuplicateShift`; `OVERLAP_EPSILON_SEC = 0.001` matching quality-analyzer.ts's own overlap slack.
- **`src/lib/subtitles/__tests__/duplicate-timing.test.ts`** (new) — 13 pure unit tests for the fit-check (Cases A–E, boundary-exact, float-noise tolerance, both wrappers, empty-block defensiveness).
- **`src/store/editor-store.ts`** — new exported `DuplicateResult = "ok" | "non-contiguous" | "no-room"` type; `duplicateSubtitle`/`duplicateSubtitles` now compute the fit-check before calling `commit()` and return this result instead of `void`/`boolean`; placement math itself unchanged (still "shift by the block's own total width") for the success path.
- **`src/components/editor/timeline.tsx`** — Duplicate button's click handler now branches on `DuplicateResult` and shows a distinct toast for `"no-room"` vs. the pre-existing `"non-contiguous"` message.
- **`src/hooks/use-keyboard-shortcuts.ts`** — Ctrl+D handler updated the same way.
- **`src/store/__tests__/editor-store-undo-redo.test.ts`** — 21 new tests (89–109, see §17 for the full matrix); tests 6, 84, 85, 86 updated (fixtures/assertions only — see §17 "known limitations" for exactly why, and confirmation nothing was weakened) plus a new local `stripIndex` helper used by tests 96/107 to compare caption content independent of array-position renumbering.
- **`package.json`** — added `test:duplicate-timing` script, registered the new test file in the aggregate `test` script, version `0.1.9` → `0.1.10`.

No changes to transcription/Whisper, export/FFmpeg rendering, installer configuration, or the database schema — none were required or made.

## 6. Single-caption duplication behavior

Unchanged when there IS room: the copy is placed at `[original.end, original.end + duration]`, words shifted by the same delta, style/animation overrides copied through untouched (verified live and by tests 89, 94–100). When there is NOT enough room, `duplicateSubtitle` now returns `"no-room"`, makes no commit, and leaves the project byte-for-byte unchanged (tests 90–92, 96b) — verified live in both the dev fixture and, notably, against a **real production caption track** ("rishab guj (copy)") where every single one of its 43 captions turned out to have zero-or-near-zero trailing gaps, meaning duplication there was silently broken for essentially the entire project before this fix.

## 7. Batch duplication behavior

Unchanged when there IS room: the whole contiguous block is shifted by its own total width (including internal gaps), preserving every caption's own duration, internal relative timing, word timestamps, and per-caption style/animation overrides (tests 84, 86, 106). When there is NOT enough room before the caption immediately following the block, the WHOLE batch is rejected as one unit — `"no-room"`, no partial commit, nothing added, captions far down the timeline (beyond the immediate trailing neighbor) are provably untouched (tests 103–105, 107).

## 8. Zero-gap behavior (Case B)

`A: [0,2]`, `B: [2,4]` — duplicating A needs 2s of room but has 0. Rejected (`"no-room"`), zero data change (test 90; live-verified against captions 2–6 of the "P8 QA" fixture project, which the earlier P8 phase's own batch-nudge testing had left exactly zero-gap-adjacent).

## 9. Tight-gap behavior (Case C)

`A: [0,2]`, `B: [2.1,4]` — only 0.1s of room, 2s needed. Rejected deterministically (test 91). The pure fit-check has an explicit boundary test proving the EXACT-equal-to-width case (room == width) still succeeds — the rejection only triggers when room is genuinely less than the required width, beyond a 0.001s float-noise tolerance matched to `quality-analyzer.ts`'s own overlap-detection slack.

## 10. Partial-overlap behavior (Case D)

A pre-existing/pathological state where the "next" caption already overlaps the original (e.g. `A: [0,2]`, `B: [1,3]`) yields a negative available-room value from the same arithmetic — rejected the same way as a merely-tight gap, never crashing or compounding the corruption (tests 92, 105).

## 11. Word-timing verification

- The original caption's own words are never mutated by a duplicate attempt, successful or rejected (test 97).
- A successful duplicate's words shift by exactly the same delta as the caption itself, preserving each word's own duration and order (tests 23 [pre-existing], 98).
- Word ordering/duration/in-bounds invariants are never at risk because a successful placement is always a pure translate (no resize, no `clampWordsToCaptionBounds` call needed) — confirmed by the "explicit bounds check" pre-existing test 64 continuing to pass unmodified.

## 12. Style/animation verification

Caption-level `style`/`animation` overrides on the original are copied onto the duplicate unchanged for both single (tests 99, 100) and batch (test 106, each duplicated caption's own override checked independently) duplication. Verified live: the toolbar Duplicate button's rejection path never touches `style`/`animation` fields either, since the whole mutator never runs.

## 13. Undo/redo verification

Single duplicate: undo removes exactly the duplicate, redo re-creates the exact same one (tests 101, 102; live-verified in both dev and packaged builds). Batch duplicate: undo removes the entire duplicated block in one step, redo reproduces it exactly (test 86 fixed/re-verified; live-verified). A rejected attempt (either reason) creates **zero** history entries — `past.length` unchanged — verified in tests 90, 103.

## 14. Autosave/reload verification

Live-verified in dev mode: a successful single duplicate, and separately a successful batch duplicate, both persisted correctly and survived a full page reload with identical timing; a rejected attempt (in either the dev fixture or against real "rishab guj (copy)" data in the packaged app) left the persisted row count and timing completely unchanged, confirmed by direct database inspection before/after.

## 15. Performance results

Test 109 (5,400-caption synthetic project, matching this codebase's existing convention): a single duplicate on a boundary-exact-fit caption completed in well under 100ms; a 3-caption contiguous batch duplicate targeting the true last captions (Case E) also completed in well under 100ms. The fit-check itself is O(1) (reads exactly one neighboring array element); the surrounding `findIndex`/`slice`/`map` costs are unchanged from the pre-fix implementation — no new O(n²) behavior was introduced. Live dev QA additionally exercised a 200-caption project (above the 150-caption virtualization threshold) with no observable slowdown; virtualization itself was not touched by this task.

## 16. Test count before/after

- Before: 627/627 passing (P8's final count).
- After: 627 + 13 (new pure `duplicate-timing.test.ts`) + 22 (new store-level tests 89–109, including 96b) = **662/662 passing**. Four pre-existing tests (6, 84, 85, 86) were updated — not weakened — to (a) use a fixture with adequate room where the test's actual intent is undo/redo mechanics rather than collision behavior, and (b) assert the new, more specific `DuplicateResult` string instead of a boolean, in every case strengthening rather than loosening what's checked (see §17).

## 17. Known limitations / exactly what was changed in existing tests and why

- **Test 6** ("caption addition (duplicate): add → undo removes it; redo brings it back") used the file's shared default fixture, whose `s1`/`s2` are zero-gap-adjacent — duplicating `s1` there is now correctly rejected. Since this test's actual purpose is verifying add/undo/redo *mechanics*, not collision behavior, it now loads a small override fixture with room to spare; its assertions are otherwise identical, plus a new check that the result is `"ok"`.
- **Tests 84 and 86** ("duplicateSubtitles: a CONTIGUOUS selection...") used `multiCaptionFixture()`, whose `s4` sits only 0.5s after the `s2`+`s3` block's own 2.5s-wide end — also now correctly rejected. Both now load a filtered version of the same fixture with the tight trailing caption removed (an explicit, commented "Case E" substitution), and their subtitle-count assertions were corrected from 7→5 to match the smaller fixture (3 original + 2 duplicated, not 5 + 2).
- **Test 85** ("a NON-CONTIGUOUS selection is deferred") needed no fixture change (rejection happens before the room check even runs) — only its assertion changed from `assert.equal(ok, false)` to `assert.equal(ok, "non-contiguous")`, which is strictly more specific, not weaker.
- **`duplicateSubtitle`/`duplicateSubtitles` return type changed** from `void`/`boolean` to the shared `DuplicateResult` string union, specifically so the UI can show a *different, accurate* toast for "non-contiguous" vs. "no-room" rather than one generic message — this is a deliberate, documented API change, not an incidental one, and both call sites (`timeline.tsx`, `use-keyboard-shortcuts.ts`) were updated accordingly.
- Duplication remains contiguous-selection-only for the batch case (unchanged from P8 — out of this task's scope to revisit).
- The fix does not attempt to repair *pre-existing* overlaps already present in a project (e.g. from data imported before this fix existed, or from the "Case D" pathological state) — it only prevents *duplication* from ever introducing a *new* one.

## 18. Deferred items

Everything in the task's own NON-GOALS list: copy/paste, regex editing, batch text/word editing, freeform timeline editing, new multi-track behavior, new database schema, cloud sync, collaboration, major UI redesign, new export formats. None were touched.

## 19. Newly discovered issues

None beyond what's already documented in §17. One observation worth flagging for awareness rather than action: the real "rishab guj" production project (43 captions) has essentially zero slack between every consecutive caption — meaning virtually any future duplication attempt on it will be rejected under this new, correct policy. This is expected, correct behavior (the alternative was a silent, invisible data-corruption bug), not a regression, but it may surprise a user who is used to the old (broken) "it always seems to work" behavior on tightly-packed transcripts. No action taken beyond the toast message already added.

## 20. Dev QA result: PASS

Ran against the same isolated dev database used throughout P8 (`prisma/dev.db` — architecturally separate from the packaged app's production `subly.db`). Verified live in the browser:
- Rejection on a real, previously-live P8 QA fixture (captions 2–6, left zero-gap-adjacent by P8's own earlier batch-nudge testing) — toolbar Duplicate showed **"Not enough room to duplicate here — the next caption starts too soon."**, zero data change.
- A fresh small "wide gaps" fixture (5s spacing) verified: successful single duplicate (flush placement, correct undo, correct reload persistence) and successful batch duplicate of 2 contiguous captions (block width/internal-gap preservation, correct undo, correct reload persistence), plus a correctly-rejected batch attempt (captions 1+2, whose combined block width didn't fit before caption 3) with zero data change.
- No regression of single-caption workflows: plain duplicate-with-room, undo, redo, style/animation preservation, word-timing shift, all behave exactly as before P9 for every caption that has adequate room.

## 21. Packaged Windows QA result: PASS

- Backed up production `subly.db` before touching anything (`subly.db.bak-pre-p9-duplicate-safety-qa`).
- Built and installed the 0.1.9 packaged app (before the version bump, per "do not bump before QA passes"), launched it, connected to its local server.
- Created a disposable QA fixture via the app's own real "Duplicate" action on a real production project with real Gujarati captions ("rishab guj" → "rishab guj (copy)", 43 real captions).
- Confirmed via direct database inspection that **every** consecutive pair of captions in this real project has 0 or near-0 gap — a perfect real-world stress test.
- Verified: duplicating the first caption (zero gap) was rejected — toast shown, subtitle count stayed at exactly 43 (confirmed via direct DB read).
- Verified: duplicating the LAST caption (no follower — Case E) succeeded — count went 43→44, copy placed flush at `[58.12, 59.56]` immediately after the original `[56.68, 58.12]`, autosave persisted correctly.
- Verified: one Ctrl+Z restored the count to exactly 43.
- Deleted the disposable copy via the app's own Trash → typed-confirmation ("rishab guj (copy)") permanent-delete flow.
- Compared the production database row-by-row (Project/Subtitle/VideoAsset/ExportJob/SubtitlePreset, JSON-string-equality excluding only `updatedAt`) before vs. after: **identical** (19 projects, 2,266 subtitles, 19 video assets, 46 export jobs, 0 presets).
- Only then bumped the version to 0.1.10, rebuilt (`SUBLY Setup 0.1.10.exe`, 566,392,292 bytes, with its `.blockmap`), verified EXE and installer `FileVersion`/`ProductVersion` both report `0.1.10`, reinstalled silently, launched, and opened a real production project to confirm the version-bumped installer actually works end-to-end.
- Ran the same production-DB row comparison a final time after this smoke test (view-only, no edits): row counts identical (19/2266/19/46/0), confirming nothing changed.
- **Known gap in this QA pass**: the "app sidebar version" display (`window.subly.isDesktop` → "SUBLY Desktop v{version}", `src/components/dashboard/sidebar.tsx`) was NOT re-captured visually for 0.1.10 — two attempts to screenshot the real Electron window instead captured an unrelated foreground browser window (the automation's window-targeting failed twice, and repeated attempts were stopped rather than risk capturing more unrelated content). This exact code path was visually confirmed correct for P8's 0.1.9 build (screenshot showed "SUBLY Desktop v0.1.9"), and the underlying mechanism — `next.config.ts` injecting `NEXT_PUBLIC_APP_VERSION: pkg.version` at build time — is untouched by this task and independently confirmed via the EXE/installer `FileVersion`/`ProductVersion` both correctly reading `0.1.10`. The sidebar is expected to read "SUBLY Desktop v0.1.10" on the same basis, but this was not re-confirmed by a fresh screenshot for this specific version.

## 22. Installer filename and size

`release/SUBLY Setup 0.1.10.exe` — 566,392,292 bytes, with `SUBLY Setup 0.1.10.exe.blockmap` (571,179 bytes).

## 23. Production DB integrity result

Identical (excluding `updatedAt`) across both the pre-version-bump (0.1.9) and post-version-bump (0.1.10) packaged QA passes — 19 projects, 2,266 subtitles, 19 video assets, 46 export jobs, 0 presets, verified via direct row-level JSON-equality comparison each time.

## 24. Known limitations

See §17. Additionally: the sidebar-version visual re-confirmation for 0.1.10 specifically was not captured (§21) due to a screenshot-targeting failure in this environment, though the underlying version-injection mechanism is unchanged and independently verified via EXE/installer metadata.

## 25. Deferred items

See §18 — everything in the task's own NON-GOALS list.

## 26. Newly discovered issues

See §19 — the real "rishab guj" production project's uniformly tight caption spacing (expected consequence of the fix, not a bug).

## Summary

Do not declare success merely because tests pass — this PASS is backed by: 662/662 tests passing (35 net new); clean typecheck; 0 lint errors; live dev-mode QA against both a synthetic fixture and a real, previously-live P8 QA project with a genuine zero-gap collision; and a full packaged-Windows-installer QA cycle at both 0.1.9 and the final 0.1.10 — including discovering, via direct database inspection, that a REAL production caption track's every single caption had zero-or-near-zero trailing gaps, making this a live-fire confirmation that the original bug was real and that the fix now correctly protects every one of them. No regression of any single-caption or batch duplication workflow that has adequate room, and duplication can no longer silently create an invalid caption overlap.
