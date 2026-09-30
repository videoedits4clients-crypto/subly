# P18.7 — Structural Caption Split/Merge & Timing Integrity Hardening

## 1. Task ID
114761

## 2. Scope
Audit and harden the existing caption-level structural operations — Split Caption and Merge With Next — against the current word-level timing/styling/confidence/removed-word/derived-mode/quality-review/undo-redo/autosave/ripple/non-monotonic-word-order architecture. Not a new UX, not drag-and-drop, not a timeline redesign — a correctness and integrity task.

## 3. Baseline
Version 0.1.17. P18.1–P18.6 complete (PASS). 1416/1416 tests, typecheck PASS, lint 0 errors / 5 pre-existing warnings, before this task.

## 4. Phase-0 audit
Read the actual implementations (not assumed correct because tests passed) of `splitSubtitleAt`/`computeSplitWordIndex` (lib/subtitles/split.ts), `mergeWithNext`/`clampWordsToCaptionBounds` (editor-store.ts / lib/subtitles/word-timing.ts), and every adjacent system named in the task (word split/merge/insert/delete/reorder, ripple delete/insert, display-mode capabilities, quality-analyzer, `pruneSelection`, clipboard, ASS export's `buildIntervals`).

**Two confirmed, severe bugs found, both a direct consequence of Task 113528 (P18.6) legalizing non-monotonic word order:**

1. **`splitSubtitleAt` (old, word-index-based)**: partitioned by `words.slice(0, wordIndex)`/`words.slice(wordIndex)` (ARRAY POSITION) and derived each half's own `start`/`end` from `words[0].start`/`words[words.length-1].end` — silently assuming the first array element is chronologically earliest and the last is latest. Traced through concretely with the task's own example (`[BRAVO 2-3, CHARLIE 3.5-4.5, DELTA 5-6, ALFA 0.5-1.5]`, split at index 2): the "right" half `[DELTA, ALFA]` would derive `start=5.0` (DELTA's start), `end=1.5` (ALFA's end) — an **inverted, negative-duration caption**.
2. **`mergeWithNext`**: ran the concatenated word array (`[...a.words, ...b.words]`) through `clampWordsToCaptionBounds`, which walks an array IN ORDER maintaining a running `prevEnd` lower bound — implicitly assuming array order is chronological. Traced through concretely: a word positioned later in the array but timestamped earlier (e.g. `[DELTA 5-6, BRAVO 2-3]`) would have its `start` force-clamped forward past `DELTA`'s end, **silently destroying BRAVO's real 2-3 timing** — exactly the "'fix' P18.6 by sorting chronologically" behavior this task explicitly forbids.

**`computeSplitWordIndex`'s "snap the playhead to the nearer word boundary" fallback** (when the playhead lands inside a word) was also confirmed unsafe for non-monotonic input for the same reason, and — separately — was itself a form of silent guessing the task's own spec asks to replace with explicit rejection.

**Confirmed NOT reused/affected**: `reorderSubtitle` (editor-store.ts) is an unrelated, pre-existing CAPTION-level (not word-level) operation — it swaps two adjacent captions' *content* while keeping each caption's own time *slot* fixed, the opposite semantic model from P18.6's word reorder. Confirmed distinct, untouched.

**Confirmed NOT vulnerable**: the live preview (`findActiveWordIndex`) and ASS export's `buildIntervals` (both already audited in P18.6) resolve "which word is active" by timestamp content, never array position — no changes needed there. `QualityIssue.wordIndex` is ephemeral, recomputed fresh every analysis run, and the whole report goes stale as a unit via the existing reference-inequality check — no remapping needed.

### Phase-0 answers (selected)
- **A/K.** Words are assigned to LEFT/RIGHT by their own `[start,end)` interval relative to the split time, never by array position.
- **B.** A straddling word REJECTS the whole split (see §5).
- **C.** Timestamps are neither translated nor regenerated — carried forward exactly.
- **D–H.** Metadata (confidence, style, removed, per-word derived fields) all travel with the word object untouched; caption-level derived caches are cleared (not regenerated), matching the pre-existing split/merge/insert convention.
- **J/M.** A non-monotonic source caption is partitioned/concatenated correctly — see §6.
- **L.** No — merge no longer assumes sorted order (fixed).
- **N.** Caption-level style/animation: left/merged keeps the original's own values (unchanged convention).
- **O/P.** The whole quality report goes stale as a unit; no `wordIndex` remapping needed or added.
- **Q/R.** See §11.
- **Y/Z.** See §7 — both are now structurally impossible or explicitly rejected.

## 5. Split semantics
`splitSubtitleAt(original, splitAtTime, rules)` — **completely redesigned to take a TIME, not a word index**:
```
LEFT:  start = original.start, end = splitAtTime
RIGHT: start = splitAtTime,    end = original.end
```
independent of word array order entirely. Every word is assigned by its own interval: `w.end <= splitAtTime` → LEFT, `w.start >= splitAtTime` → RIGHT, otherwise (straddles) → **reject the whole operation** (`"word-straddles-split"`, with the offending word attached for a precise message). Also rejects a split time outside `(original.start, original.end)` (`"invalid-time"`) or one that would leave either side with zero words (`"empty-side"`). Each side keeps its own words in their **existing relative array order** — never re-sorted. The old "snap to the nearer word boundary when the playhead lands inside a word" fallback was removed entirely, replaced by explicit rejection, per this task's own "prefer rejection over silent destructive behavior."

## 6. Merge semantics
`mergeSubtitles(a, b, rules)` (new pure module, `lib/subtitles/merge-subtitles.ts`) — **word order is `a.words` followed by `b.words`, in their existing relative order (Option A from the task's own lettered choice)**, never re-sorted chronologically. This is provably safe with no repositioning needed: given the pre-existing, already-enforced invariants (`a`/`b` are adjacent in a sorted, non-overlapping array, so `a.end <= b.start`; every word of `a` already satisfies `w.end <= a.end` regardless of array order since P18.6 reorder never changes timing; same for `b`), no word of `a` can ever overlap any word of `b`. Rather than trust that proof blindly, the function still **validates** it (defense in depth, matching `ripple-edit.ts`'s established pattern) and **rejects** (`"out-of-bounds"` or `"overlap"`) if the invariant is somehow violated — replacing the old `clampWordsToCaptionBounds` call, which would have silently repositioned a word instead.

## 7. Non-monotonic word behavior
Directly tested with the task's own worked example through all three layers:
- **Pure function**: `splitSubtitleAt`/`mergeSubtitles` both have dedicated tests reproducing the exact `[BRAVO, CHARLIE, DELTA, ALFA]` (array order) / `[2-3, 3.5-4.5, 5-6, 0.5-1.5]` (chronological order) scenario, proving correct partition-by-timestamp and order-preserving concatenation.
- **Store**: `editor-store-split-merge.test.ts` exercises the same scenario through the real `splitSubtitleAtTime`/`mergeWithNext` actions.
- **Live browser + real export**: see §17/§18 — a non-monotonic caption was split through the actual UI, and the resulting captions were exported and inspected pixel-by-pixel.
Overlap/zero/negative duration (§Y/§Z): split can never produce them (caption bounds come from `splitAtTime`/`original.start`/`original.end`, never a word's own timing; a straddling word rejects rather than being cut). Merge can never produce them either, given the pre-existing invariants (§6); the validation path exists purely as defense in depth for genuinely corrupt pre-existing data.

## 8. Timing invariants
Verified by dedicated tests (pure and store-level): every word retains its exact original `start`/`end` and duration through both split and merge; no word is duplicated, dropped, or regenerated; the only structural change is which caption a word belongs to (split) or that two arrays are concatenated (merge).

## 9. Metadata behavior
Confidence, `style` (including `fontWeight`/color/background), `removed`, and per-word `hinglishText`/`gujaratiScriptText` all travel with the word object through both operations, verified by unit tests, store tests, and — for merge — a real export showing a word-level color override (INDIA, green) and a `removed` word (JULIET, correctly invisible in the rendered output) both surviving intact. Caption-level `style`/`animation` follow the pre-existing, unmodified convention: split propagates the original's values to both halves, merge keeps `a`'s own values ("A absorbs B").

## 10. Derived-mode behavior
P17/P17.1/P17.2 architecture was **not modified**. Both operations continue to clear the caption-level `hinglishText`/`gujaratiScriptText` cache on any word-array structural change (the same convention already used by split/merge/insert before this task), forcing a lazy, correct regeneration next time a derived mode is actually viewed rather than leaving a stale cached string. No word-count/order mismatch is introduced — split/merge only ever move complete word objects, matching the exact reasoning P18.6 already established for reorder.

## 11. Quality behavior
No bespoke issue-remapping logic was added. Both operations route through the existing `commit()`, which always produces a new top-level `subtitles` array reference — the pre-existing `isQualityReportStale` (pure reference-inequality) check catches this automatically, verified by a dedicated store test for each operation. `QualityIssue.wordIndex` needs no remapping since the whole report — and therefore every index it contains — is invalidated as a unit.

## 12. Selection behavior
`selectedSubtitleId`: split keeps the LEFT half's id identical to the original's, so the existing `pruneSelection` mechanism (unchanged) naturally keeps it selected; the RIGHT half (new id) is simply not auto-selected. Merge keeps `a`'s id, so `a` stays selected if it was; if `b` was selected, `pruneSelection` already correctly clears it (its id no longer exists).

**A genuine gap was found and fixed**: `selectedWordIndex` after a split. Because the LEFT half keeps the *same id* as the original, `pruneSelection`'s "clear word index only when the focused caption itself disappears" check never fires — but the LEFT half's `words` array is now *shorter*. A `selectedWordIndex` that pointed into what's now the RIGHT half (a different caption entirely) would be left silently out of bounds for the LEFT half's own array. `splitSubtitleAtTime` now explicitly clears `selectedWordIndex` in exactly this case (verified by a dedicated test), while leaving it untouched when it's still valid for the shrunk LEFT array (also tested). Merge needs no equivalent fix: appending `b.words` after `a.words` can only ever make a valid `selectedWordIndex` on the surviving `a` caption stay valid.

## 13. Undo/redo
Verified live and at the store level: one split = one commit/undo step; one merge = one commit/undo step; every rejection reason (straddle, invalid-time, empty-side, overlap, out-of-bounds, no-next-caption, not-found) produces zero commits. Undo/redo restore exact text, timing, words, and metadata in both directions. `commit()`/`undo()`/`redo()` were not modified.

## 14. Autosave
Both operations route through the existing `commit()` → `dirty: true` → `useAutosave` path with zero new plumbing, verified live (the "Saved" indicator, and a fresh-tab reload reproducing the exact post-split-and-merge state).

## 15. Ripple interaction
Explicitly tested per the task's own example, both at the store level and live in the browser: a caption shifted by **Ripple Delete** was correctly split afterward (using its new, shifted timestamps), and the whole sequence (ripple delete → split → undo → undo) restored the exact original state including the pre-ripple timing. Captions shifted by **Ripple Insert** were correctly merged afterward, with the merged caption's bounds reflecting the shifted timestamps. Ripple Delete/Insert themselves (lib/subtitles/ripple-edit.ts, the `rippleDeleteSubtitles`/`rippleInsertTime` store actions) were not modified.

## 16. Performance
`editor-store-split-merge.test.ts` runs both operations across the full cross product of caption word counts (1/5/20/100/500) and total project caption counts (30/300/1800/3600/5400): every combination completes well under 150ms (worst case ~7.5ms). **A real, confirmed reference-stability bug was found and fixed in the process**: the pre-P18.7 `splitSubtitle`/`mergeWithNext` reindexing (`.map((s,i) => ({...s, index: i}))`) blanket-rebuilt *every* caption in the array, including ones entirely before the split/merge point whose `index` never actually changed — silently defeating P18.2's `React.memo` boundary for the whole visible list on every split/merge, not just the affected captions. Both operations now only allocate new objects for captions from the split/merge point onward (mirroring `ripple-edit.ts`'s own established "reindex only what changed" pattern); every caption strictly before the operation's own point keeps its exact object reference, now explicitly asserted by tests (not just informally true).

## 17. Tests
- `src/lib/subtitles/__tests__/split.test.ts` — rewritten for the new time-based API (8 → 15 tests): basic partition-by-time, caption-boundary derivation from the split point (not word timing), id/style/animation propagation, invalid-time rejection (at/before start, at/after end, NaN/Infinity), word-straddle rejection (including the exact clean-boundary-is-not-a-straddle distinction), empty-side rejection, non-mutation, and 4 dedicated non-monotonic-order tests reproducing the task's own example (including the exact "would have been inverted under the old algorithm" case).
- `src/lib/subtitles/__tests__/merge-subtitles.test.ts` — new, 11 tests: bounds/order/gap-preservation, id/index/style/animation ("A absorbs B"), full metadata preservation, exact timing preservation, 2 non-monotonic-order tests (including one reproducing the exact old-clamp corruption scenario), out-of-bounds/overlap rejection, non-mutation.
- `src/store/__tests__/editor-store-split-merge.test.ts` — new, 71 tests: one-commit verification for both operations, metadata preservation through the real store, `selectedWordIndex` safety (both the bug fix and the "stays valid, not cleared unnecessarily" case), undo/redo, `dirty` flag, quality-report staleness via the real mechanism, non-monotonic order through the real store, Ripple Delete/Insert interaction, reference-stability at every point in the word-count × caption-count matrix (60 of the 71), and rejection paths with zero mutation.
- `src/store/__tests__/editor-store-undo-redo.test.ts` — 2 pre-existing tests updated from the old `splitSubtitle(id, wordIndex)` call to the new `splitSubtitleAtTime(id, time)`, preserving their original assertions exactly; 1 pre-existing test (#58) rewritten from "silent repair" to "explicit rejection," with a detailed comment explaining why the old expectation is now obsolete per this task's own mandate (not weakened — the new assertion is strictly more protective of data integrity).
- All new/changed files registered in `package.json`'s `test` script.
- **Baseline 1416 → 1505** (1416 + 7 net + 11 + 71). Zero tests deleted; one legitimately rewritten per an explicit, task-mandated behavior change (documented, not silent).

## 18. Live QA
Seeded a disposable project (`p18-7-split-merge-qa`, real 12s video) with a non-monotonic caption (`BRAVO 2-3, CHARLIE 3.5-4.5, DELTA 5-6, ALFA 0.5-1.5` — the task's own example) and two adjacent captions for merge testing (`HOTEL` with confidence 0.9; `INDIA`[green style]/`JULIET`[removed]/`KILO`[confidence 0.5]):
- **Split at t=1.75** (separating ALFA from the rest): database confirmed LEFT = `[ALFA]` with bounds `[0.5, 1.75]`, RIGHT = `[BRAVO, CHARLIE, DELTA]` with bounds `[1.75, 6]` — exactly the task's own expected result, textual order preserved.
- **Split at t=2.5** (inside BRAVO's own 2-3 span): exact toast "Can't split here — a word spans the split point." — zero mutation.
- **Undo/redo** for the split: exact restoration/re-application confirmed via direct database inspection.
- **Merge** `HOTEL` + `INDIA JULIET KILO`: database confirmed the merged caption spans `[7, 10.4]`, text is "HOTEL INDIA JULIET KILO", and every word's confidence/style/removed flag survived exactly.
- **Undo/redo** for the merge: confirmed via database inspection.
- **Reload persistence**: a completely fresh browser tab reproduced the exact post-split-and-merge state with a clean console (one batch of stale Turbopack HMR console errors from mid-implementation was investigated and confirmed to be leftover browser-tab history, not a current defect — reproduced as absent on a genuinely fresh tab).

## 19. Export verification
Exported the project (real server-side FFmpeg) after the split and merge above. Extracted real frames from the actual output MP4 with `ffmpeg-static`:
- **t=1.0s** (ALFA's split-off caption): shows "ALFA," highlighted (active-word color), matching its own original 0.5–1.5s window.
- **t=2.5s** (the other split-off caption): shows "BRAVO CHARLIE DELTA" with BRAVO — the array-first, chronologically-matching word at this instant — correctly highlighted; no trace of ALFA.
- **t=8.4s** (the merged caption): shows "HOTEL INDIA KILO" — **JULIET is correctly invisible** (its `removed: true` flag, preserved through the merge, is correctly respected by the export's own pre-existing `renderLineText`/`wordsByLine` filter, exactly as it already does for any other removed word) — with INDIA rendered in its own green style override.
This is definitive, pixel-level confirmation that split/merge output is correct end-to-end, not just in the database.

## 20. NOT TESTED
- Live UI-level split/merge in Hinglish/Gujarati Script mode specifically (the QA project's language never surfaced the mode switcher — same limitation already noted in the P18.6 report). Derived-mode cache-clearing behavior is covered by direct code inspection (§10) and is architecturally identical to the pre-existing, already-shipped split/merge/insert convention, not new logic this task introduced.
- Live UI-level quality-report staleness after split/merge (covered by real store-level tests using the actual `analyzeSubtitleQuality`/`isQualityReportStale` functions, not re-demonstrated through the browser in this session).
- Real video playback through a split/merged caption boundary (only paused-frame/export-frame verification was performed).

## 21. Known limitations
- The `clampWordsToCaptionBounds` bug pattern this task fixed for Merge also exists, unaudited-and-unfixed by this task's own deliberately bounded scope, in `updateSubtitleTiming`'s caption-**resize** branch (editor-store.ts, the non-pure-shift case) — a resize that shrinks a non-monotonic caption could exhibit the identical "drag a correctly-reordered word's real timing forward" corruption. Confirmed by direct code analysis, not fixed here (resize was never part of this task's named scope — only Split/Merge), and flagged via a background task suggestion (`task_49ce5e38`) for a dedicated follow-up rather than silently expanding this task's scope.
- The word-timing popover's own `open` state still follows array position, not word identity (a pre-existing characteristic already documented in the P18.6 report) — unaffected by this task, mentioned again only because a split/merge changes array structure the same way a reorder does.

## 22. Protected systems
Not touched: Prisma schema, persistence architecture, autosave queue, local snapshot architecture, crash recovery, stale-job recovery, `commit()`, undo/redo architecture, P18.2 memoization/virtualization architecture (extended via the exact same "reindex only what changed" pattern, not modified), P18.3 word styling, P18.4 error boundaries, P18.5 Ripple Delete/Insert (confirmed working correctly *through* split/merge, never modified), P18.6 word reorder semantics (explicitly NOT "fixed" by sorting — the whole point of this task was making split/merge respect P18.6's non-monotonic ordering, not undo it), waveform, playback architecture, Whisper/transcription, FFmpeg/export worker, Electron packaging.

## 23. Packaging
NOT REQUIRED — pure editor/store/timing logic change, no Electron/native/runtime behavior touched. Version kept at 0.1.17.

## 24. Final verification
- `npm test`: **1505/1505 PASS** (1416 baseline + 89 new/net).
- `npx tsc --noEmit`: **PASS**, 0 errors.
- `npx eslint .`: **PASS**, 0 errors, 5 pre-existing warnings (identical set to before this task, zero new).

## 25. P18.8 status
NOT STARTED.

---

TASK ID: 114761
STATUS: PASS
VERSION: 0.1.17
PRODUCTION CODE CHANGED: YES
DATABASE CHANGED: NO
TESTS: 1505/1505
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18.8: NOT STARTED
