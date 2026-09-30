# P18.10 — Final Non-Monotonic Word-Order Integrity Audit

## 1. Task ID

118943

## 2. Scope

A comprehensive but bounded audit of the ENTIRE production source tree for any remaining code that
treats `Word[]` array order as a substitute for real chronological (timestamp) order — the
assumption P18.6 (Task 113528) deliberately broke by making word reorder a permanent, supported
feature, and that P18.7/P18.8/P18.9 progressively removed from Split/Merge, caption Resize, and the
word-level timing nudge. This is not a feature task: where the audit found genuine, reproducible
correctness bugs, they were fixed surgically with regression tests; nothing was "fixed" that was
already correct, and no unrelated refactoring was performed.

## 3. Baseline

- Version: 0.1.17 (unchanged)
- P18.1–P18.9 complete; P18.9 Task ID 117206
- Baseline: 1620/1620 tests, typecheck PASS, lint PASS (0 errors / 5 pre-existing warnings)

## 4. Phase-0 audit methodology

Systematic `grep`/`Grep` sweeps of `src/` (production code only, test files inspected separately —
see §6) for every pattern the task specified: `words[i±1]`, `words[0]`/`words[length-1]`/`.at(-1)`,
`prevWord`/`nextWord`/`prevEnd`/`nextStart` identifiers, `.sort()` on a `words` array, and running
accumulator patterns. Every hit was read in full context and classified (§6) as TEXTUAL-ORDER-
INTENTIONAL (safe, matches an established precedent), CONTENT/TIMESTAMP-BASED (safe), or a genuine
TIMING computation that assumed array adjacency implies chronological adjacency (investigated
further, and — where confirmed — fixed). For each candidate bug, a small standalone probe script
was run directly against the unfixed function to observe its ACTUAL output before writing the
mandatory regression test, then the same scenario was written as a permanent failing test, run
against the unmodified code to confirm the failure, then fixed.

## 5. Complete audit findings

**Confirmed bugs (5)** — see §8 for full detail:
1. `mergeWords` (lib/subtitles/word-edit.ts) — merge-with-next-word.
2. `deleteWordConservative` (lib/subtitles/word-edit.ts) — word delete's gap-collapse.
3. `computeInsertionGap` (lib/subtitles/word-edit.ts) — word insert's gap geometry.
4. `resegmentAll` (store/editor-store.ts) — the flattened word list fed to `segmentWords`.
5. `remapSubtitlesToEdited` (lib/timeline/edit-model.ts) — the export pipeline's cut-range remap.

**Confirmed safe (no change)** — already fixed by P18.6–P18.9, or never assumed chronological
array order in the first place:
- `word-reorder.ts`, `split.ts`, `merge-subtitles.ts` (caption-level), `ripple-edit.ts`,
  `clampWordsToCaptionBounds`, `validateWordsWithinCaptionBounds`, `updateSubtitleTiming`/
  `resolveTimingUpdate`, `clampWordTiming`/`findChronologicalWordNeighbors`, `updateWordTiming`.
- `lib/subtitles/word-navigation.ts` (`resolveWordNavigation`, Left/Right word-selection arrow keys)
  — deliberately walks the ARRAY (displayed text order), exactly the "UI word-chip order" exception
  the task itself calls out as intentional; this is a cursor-movement feature, not a timing
  calculation.
- `lib/timeline/word-snapping.ts` (`computeWordSnappedTiming`) — a pure function that only ever
  consumes `prevWordEnd`/`nextWordStart` VALUES it's given; both of its real callers
  (`captions-panel.tsx`, `timeline.tsx`) already compute those values via
  `findChronologicalWordNeighbors` (fixed in P18.9).
- `lib/subtitles/ass.ts` `buildIntervals` (ASS export) — builds its own sorted breakpoint set from
  word TIMESTAMPS and resolves the active word per interval by timestamp containment
  (`mid >= w.start && mid < w.end`), never by array position; `computeActiveWordChip`'s own
  `lines.findIndex`/`line.indexOf` walk the DISPLAY LINE layout (inherently array/textual order,
  correctly so — that's what determines on-screen word position).
- `lib/subtitles/playback-context.ts` `findActiveWordIndex`/`findActiveCaption` (live preview) —
  content/timestamp-based (`Array.prototype.findIndex` with a `time >= w.start && time < w.end`
  predicate), independent of array order.
- `lib/subtitles/quality-analyzer.ts`'s per-word checks (`end < start`, out-of-caption-bounds) —
  evaluate each word independently, order-independent.
- `lib/subtitles/quality-fixes.ts`'s `nextStart`/`clampEnd` usages — all CAPTION-level (`next` =
  `subtitles[i+1]`), and captions are always kept chronologically sorted by `commit()`'s own
  `.sort((a,b)=>a.start-b.start)` — caption-level array adjacency IS chronological adjacency,
  unconditionally, unrelated to the Word[] non-monotonic issue.
- `lib/subtitles/segment.ts` (`segmentWords`) — its ENTIRE algorithm is an intentional sequential
  array walk (grouping consecutive words into captions); this is correct AS DESIGNED for its normal
  input (fresh Whisper output, or `resegmentAll`'s now-sorted input, see §8). Rewriting its internal
  algorithm to be order-independent would mean building a new segmentation engine, explicitly out of
  scope ("Do NOT create a new generalized timing engine") — the actual bug was entirely at the ONE
  call site that could feed it non-chronological input (`resegmentAll`), fixed there instead.

**Confirmed dead / zero production impact (documented, not "fixed")**:
- `quality-analyzer.ts`'s exact-duplicate-word detection (`prevWord = s.words[w-1]`,
  `WORD_TIMESTAMP_INVALID`) scans only the ARRAY-adjacent previous word. A duplicate that ends up
  non-adjacent after a reorder would simply not be flagged by this specific heuristic — a missed
  best-effort lint, not a data-corruption risk (nothing is written; this is a read-only quality
  check). Left as-is: fixing it would mean an O(n²) all-pairs scan for a heuristic whose entire
  premise (accidental adjacent-duplicate transcription artifacts) is inherently about ARRAY-adjacent
  repeats in the first place.
- `quality-validator.ts`'s `validateSubtitles` (`"word-order"` warning at line 110, flags
  `words[i].start < words[i-1].start`) — confirmed via exhaustive grep to have **zero** imports
  anywhere in `src/`. The file's own top-of-file comment already says "Internal QA utility only —
  never surfaced to end users... Not wired into any user-facing route." This predates P18.6 entirely
  (a leftover from the much earlier P2 quality-control task) and has no production reachability
  whatsoever. Not modified — touching genuinely dead code would be exactly the "unrelated cleanup"
  this task explicitly forbids.

## 6. Classification of every relevant Word[] ordering usage

| Location | Usage | Classification |
|---|---|---|
| `word-navigation.ts` | Left/Right word-selection cursor | TEXTUAL-ORDER-INTENTIONAL |
| `captions-panel.tsx` word chip rendering | display order | TEXTUAL-ORDER-INTENTIONAL |
| `word-reorder.ts` | the reorder operation itself | TEXTUAL-ORDER-INTENTIONAL (by definition) |
| `ass.ts` `wordsByLine`/line layout | on-screen word position | TEXTUAL-ORDER-INTENTIONAL |
| `ass.ts` `buildIntervals` | active-word resolution | CONTENT/TIMESTAMP-BASED — safe |
| `playback-context.ts` | active-word/caption resolution | CONTENT/TIMESTAMP-BASED — safe |
| `clampWordTiming` / `findChronologicalWordNeighbors` | word nudge bounds | CHRONOLOGICAL — safe (P18.9) |
| `validateWordsWithinCaptionBounds` | caption resize validation | per-word independent — safe (P18.8) |
| `split.ts` / `merge-subtitles.ts` (caption-level) | structural split/merge | time-partitioned/validated — safe (P18.7) |
| `quality-analyzer.ts` per-word bounds/negative-duration | quality checks | order-independent — safe |
| `quality-fixes.ts` `nextStart` | CAPTION-level (always sorted) | safe, unrelated to Word[] |
| `mergeWords` | word-level merge-with-next | **WAS a bug — fixed (§8)** |
| `deleteWordConservative` | word-level delete gap-collapse | **WAS a bug — fixed (§8)** |
| `computeInsertionGap` | word-level insert gap geometry | **WAS a bug — fixed (§8)** |
| `resegmentAll` | flattened input to `segmentWords` | **WAS a bug — fixed (§8)** |
| `remapSubtitlesToEdited` | export-pipeline cut-range remap | **WAS a bug — fixed (§8)** |
| `quality-analyzer.ts` duplicate-word detection | quality lint | low-severity, not fixed (§5) |
| `quality-validator.ts` `"word-order"` warning | dead code | zero impact, not fixed (§5) |

## 7. Remaining risks, if any

None rising to "production correctness bug." The two documented-but-unfixed items (§5, last
bullet group) are: (a) a best-effort quality lint that can miss one specific rare sub-case with zero
data-integrity consequence, and (b) genuinely unreachable dead code. Both are called out explicitly
rather than silently left for a future audit to rediscover.

## 8. Bugs found

### 8.1 `mergeWords` (lib/subtitles/word-edit.ts)

`mergeWordWithNext` merges `words[wordIndex]` with `words[wordIndex+1]` — ARRAY-adjacent, but only
guaranteed TEXTUALLY adjacent since P18.6. The old formula (`start: word.start, end: nextWord.end`)
silently assumed `word` was chronologically before `nextWord`; if a reordered `nextWord` was
actually chronologically EARLIER, the result was an INVERTED interval (`end < start`).

### 8.2 `deleteWordConservative` (lib/subtitles/word-edit.ts)

Extended `words[index-1].end` (or pulled `words[0].start` back) — the ARRAY-adjacent word — to
absorb the deleted word's own former edge. Its own doc comment claimed this was "UNCONDITIONALLY
safe... there is no case where it needs to reject," which the audit disproved: extending the wrong
(array-adjacent, not chronologically-adjacent) word could either invert that word's own interval or
silently swallow a third word's real timing.

### 8.3 `computeInsertionGap` (lib/subtitles/word-edit.ts)

Computed the "before"/"after" insertion gap from `words[anchorIndex-1]`/`words[anchorIndex+1]` —
same array-adjacency assumption. A reordered anchor's array-adjacent neighbor could be far away in
real time, producing a gap that silently overlapped a third word's real timing — i.e. the UI could
offer to insert a new word directly on top of an existing one.

### 8.4 `resegmentAll` (store/editor-store.ts)

`snap.subtitles.flatMap((s) => s.words)` preserves each caption's own ARRAY order, then feeds the
result to `segmentWords`, which walks its input SEQUENTIALLY (an inherently order-dependent
algorithm — see §5). A non-monotonic caption's own words, still in array order, are not guaranteed
chronological, so `segmentWords` could group them into a caption whose resulting `start`/`end`
excludes one of its own words entirely.

### 8.5 `remapSubtitlesToEdited` (lib/timeline/edit-model.ts)

Used by `lib/export-pipeline.ts` whenever a project has ANY cut ranges (trim, filler-word removal,
silence removal — extremely common). Derived each resulting caption's `start`/`end` from
`words[0].start`/`words[words.length-1].end` — the exact same assumption P18.7's OLD `split.ts` had
(see that file's own historical doc-comment note) — silently assuming array-first is chronologically
earliest and array-last is chronologically latest. This is on the EXPORT PATH: any project combining
a reordered word with a trim/cut produced a caption whose bounds could exclude one of its own words.

## 9. Reproduction tests (mandatory, written and run BEFORE each fix)

All five were written first, run against the unmodified code, and their actual failures recorded
before any production code changed:

- `mergeWords`: merging DELTA[5,6] then CHARLIE[3.5,4.5] (array order) produced `[5, 4.5]` — a
  genuinely inverted interval.
- `deleteWordConservative`: deleting DELTA (array index 1, real chronological predecessor CHARLIE)
  extended array-adjacent BRAVO to `[2, 6]` instead of extending CHARLIE — `BRAVO (not DELTA's real
  neighbor) must be completely untouched: actual [2, 6], expected [2, 3]`.
- `computeInsertionGap`: inserting "before" DELTA (array index 1) claimed gap `{start: 3, end: 5}`
  (BRAVO's array-adjacent end) instead of `{start: 4.5, end: 5}` (CHARLIE's real chronological end)
  — a gap that fully overlapped CHARLIE's own real `[3.5, 4.5]`.
- `resegmentAll`: a non-monotonic caption (BRAVO/DELTA/CHARLIE array order) resegmented into a
  caption `[2, 4.5]` that excluded its own word `DELTA [5,6]` — `word "DELTA" [5,6] must fall within
  its own resulting caption's bounds [2,4.5]`, failed.
- `remapSubtitlesToEdited`: the identical non-monotonic caption, remapped through an UNRELATED cut
  range (far from any of the caption's own words, isolating the bug), produced caption bounds
  `[2, 4.5]` — again excluding `DELTA [5,6]`.

All five now pass unmodified after the corresponding fix (§10).

## 10. Fixes

1. **`mergeWords`** now computes `start: Math.min(word.start, nextWord.start)`,
   `end: Math.max(word.end, nextWord.end)` — always the true bounding span of both real timestamps,
   byte-identical to the old formula whenever `word` genuinely IS chronologically first (the
   overwhelmingly common, unreordered case). This alone does not guard against swallowing a THIRD
   word — see next point.
2. **`mergeWordWithNext`** (store) now pre-checks (outside `commit()`, same "decide before
   committing" shape every other rejecting action in this file uses) whether the merged span would
   overlap any OTHER word in the caption, via a new small pure helper,
   `overlapsOtherWord` (word-edit.ts). If so, the merge is rejected: zero mutation, zero commit, zero
   undo entry — mirroring `mergeSubtitles`'s own "concatenate, then validate rather than silently
   repair" precedent (P18.7). No new UI toast was added for this specific rejection reason (see
   §16 Known limitations) — the click simply has no visible effect, matching how P18.6's reorder
   buttons already treat their own unreachable "noop" case.
3. **`deleteWordConservative`** now finds the word's REAL chronological predecessor/successor (the
   closest OTHER word by actual timestamp — not array position) and extends THAT word's edge
   instead. Proven safe by construction: extending the true chronological predecessor forward only
   as far as the deleted word's own end can never reach a third word, because any word closer than
   that would already have overlapped the deleted word before the deletion (pre-existing, unrelated
   corrupt data, not something this operation could introduce) — so no additional overlap-guard was
   needed here, unlike merge.
4. **`computeInsertionGap`** now calls the existing, already-tested `findChronologicalWordNeighbors`
   (word-timing.ts, P18.9) directly instead of reading array-adjacent indices — reusing the exact
   precedent the task itself names, rather than duplicating the scan.
5. **`resegmentAll`** now sorts the flattened word list by real `start` before handing it to
   `segmentWords`. This is a LOCAL, temporary sort of a copy used only to rebuild the caption
   structure from scratch — `resegmentAll` already discards every existing caption's own `words`
   array entirely (its own pre-existing doc comment: "any per-caption style/animation override or
   edited text is lost"), so there is no persisted textual order being overwritten; the freshly
   rebuilt captions' own word order is simply chronological, the only sensible order for a brand-new
   segmentation to produce. No other caption's persisted array is touched.
6. **`remapSubtitlesToEdited`** now computes `start`/`end` as the true MIN/MAX across every one of
   the caption's own (already correctly remapped) words, via a plain O(n) loop — not
   `words[0]`/`words[last]`.

None of Split, Merge (caption-level), Ripple Delete/Insert, caption Resize, Word Reorder semantics,
`clampWordsToCaptionBounds`, `validateWordsWithinCaptionBounds`, `updateSubtitleTiming`,
`resolveTimingUpdate`, `updateWordTiming`, or `findChronologicalWordNeighbors` were modified — all
five fixes either add a new, colocated pure helper or change internal computation inside an existing
function while preserving its exact external signature/contract.

## 11. Regression coverage

1636/1620 = +16 new tests, all passing, zero existing tests weakened or deleted:
- `word-edit.test.ts`: 3 new mandatory-regression tests (mergeWords inversion, deleteWordConservative
  wrong-neighbor, computeInsertionGap fake-gap) — all 75 tests in the file pass, including every
  pre-existing monotonic-fixture test (unaffected, since the fixes are byte-identical for
  chronologically-ordered input).
- `editor-store-word-edit.test.ts`: 2 new tests (`mergeWordWithNext` rejects when a third word would
  be swallowed, with zero commit/history entry; and succeeds when nothing sits between the two
  merge targets) — all 69 tests pass.
- `editor-store-resegment.test.ts` (new file — `resegmentAll` had ZERO prior test coverage): 3 tests
  (the mandatory regression, a monotonic-project sanity check, an empty-project no-op check).
- `edit-model.test.ts` (new file — this whole module had ZERO prior test coverage): 8 tests (the
  mandatory regression plus baseline coverage of `sourceToEdited`/`editedToSource`/`editedDuration`/
  `keptRanges`/`isInsideCut`/`remapWordsToEdited`/`effectiveCuts`/`normalizeCuts`, none of which
  existed before this task).

## 12. Performance

No new project-wide or O(total-captions × words) behavior was introduced. `overlapsOtherWord` and
the chronological-neighbor scan inside `deleteWordConservative` are both O(words in the ONE target
caption) — identical complexity class to the array-adjacent code they replaced, just scanning the
whole caption's words instead of two fixed indices (still bounded by a caption's own, small word
count, never the project's caption count). `resegmentAll`'s new `.sort()` is O(total words in the
project) — the SAME asymptotic cost `segmentWords` itself already had scanning that same flattened
array; sorting it first does not change the complexity class of the action as a whole.
`remapSubtitlesToEdited`'s MIN/MAX loop is O(words in that one caption), same as the
`words[0]`/`words[length-1]` accesses it replaced (O(1) → O(words), a negligible, unavoidable cost
for correctness). No test in the existing 1636-strong perf-focused suite regressed.

## 13. Live QA

Duplicated the pristine `P18.7 Split-Merge QA (disposable)` project fresh. Reordered DELTA to
produce the non-monotonic "BRAVO DELTA CHARLIE" caption (real times BRAVO 2–3, DELTA 5–6, CHARLIE
3.5–4.5), then specifically live-tested each fix:

- **Insert**: opened DELTA's popover, "Insert before" — the gap preview read **"Claims the full
  gap: 00:04.50 – 00:05.00 (0.50s)"** (CHARLIE's real end, 4.5), not the old broken 3.00–5.00 (which
  would have overlapped CHARLIE). Typed "ECHO", inserted — landed correctly between CHARLIE and
  DELTA with no overlap. Undone.
- **Delete**: deleted DELTA. CHARLIE (DELTA's real chronological predecessor) absorbed the gap,
  becoming `[3.5, 6.0]`; BRAVO stayed exactly `[2, 3]`, completely untouched (confirmed via its own
  chip). Undone.
- **Merge (reject case)**: opened BRAVO's popover, clicked "Merge with the next word" (BRAVO +
  array-adjacent DELTA, which would swallow CHARLIE's real timing) — the click had **zero visible
  effect**: caption stayed "BRAVO DELTA CHARLIE", all three chips unchanged.
- **Merge (safe case)**: opened DELTA's popover, clicked "Merge with the next word" (DELTA +
  array-adjacent CHARLIE, nothing between them) — succeeded, producing "DELTA CHARLIE" spanning
  `[3.5, 6.0]` (the true min/max of both real timestamps); BRAVO stayed `[2, 3]`. Undone.
- **Re-segment captions** (Settings tab): with the caption still in non-monotonic BRAVO/DELTA/CHARLIE
  order, clicked "Re-segment captions." The rebuilt project produced captions `[0.5, 4.5]`
  (ALFA/BRAVO/CHARLIE, correctly grouped and bounded) and `[5, 6]` (DELTA alone, correctly bounding
  its own real span) — no word fell outside its own caption. Undone.
- **Export with a cut range** (the `remapSubtitlesToEdited` fix, the export-pipeline path): added a
  manual cut range `[11.5, 12.0]` (positioned after every caption, isolating the bug from the cut
  mechanism itself), then exported — see §14.

## 14. Export verification

Exported the project (real server-side FFmpeg, no error; output file 177,926 bytes) with the cut
range present AND the caption still in its non-monotonic "DELTA BRAVO CHARLIE" array order (this
particular duplicate ended up with DELTA at array index 0, chronologically LAST — an even sharper
version of the reproduction). Extracted three frames directly from the exported MP4:

- t=2.5s → **BRAVO** highlighted (its real `[2,3]`) — despite DELTA sitting first in the array/text.
- t=4.0s → **CHARLIE** highlighted (its real `[3.5,4.5]`).
- t=5.5s → **DELTA** highlighted (its real `[5,6]`) — DELTA is FIRST in array/textual order (the
  rendered text reads "DELTA BRAVO CHARLIE") but chronologically LAST, and still highlights
  correctly at its own real time.

This is the definitive proof that the `remapSubtitlesToEdited` fix works end-to-end through the real
export pipeline, not just in isolation: no malformed ASS, no missing/duplicated words, no FFmpeg
error, correct highlighting for every word regardless of array position.

## 15. NOT TESTED

- The timeline's own word-handle DRAG interaction was not separately live-dragged for these five
  fixes (none of them touch that code path — it already routes through the P18.9-fixed
  `clampWordTiming`/`findChronologicalWordNeighbors`, unaffected by this task).
- Ripple Delete was not separately live-clicked (Ripple Insert was, as part of confirming
  `remapSubtitlesToEdited`'s interaction is really about cuts, not ripple specifically — ripple
  itself was not touched by any P18.10 fix and was not re-audited beyond the grep sweep in §4, which
  found nothing).
- The quality-analyzer duplicate-word-detection edge case (§5) and the dead
  `quality-validator.ts` warning (§5) were not exercised live — both are explicitly non-production-
  impacting findings, documented rather than fixed.

## 16. Known limitations

- `mergeWordWithNext`'s new rejection case (merging would swallow a third word) has no dedicated
  toast — the click simply has no effect. Wiring one would require touching prop types across three
  files (captions-panel.tsx twice, word-timing-popover.tsx once) purely for an extremely rare edge
  case (requires a deliberate reorder into a specific pathological arrangement), which felt like
  UI-redesign scope creep for a task explicitly scoped as a bounded audit + surgical fixes.
- `remapSubtitlesToEdited`'s fix changes a caption's resulting bounds from "array-first word's own
  start to array-last word's own end" to "the true min/max across every word" — for an
  ALREADY-non-monotonic caption that also has any lead-in/lead-out padding between its own bounds
  and its outermost real word timestamps, the padding itself is not recoverable in a chronologically
  safe way; the fix always produces the tightest correct bounding box, occasionally very slightly
  narrower than the original artistic padding would have been. This is an accepted, minor,
  inherent trade-off of the fix, not a new bug.

## 17. Protected systems

Confirmed untouched (full test suite passes with no assertion changes to their own test files):
Word type/data model, P18.6 Word Reorder semantics, P18.7 Split, P18.7 Merge (caption-level), P18.5
Ripple Delete, P18.5 Ripple Insert, P18.8 caption resize, P18.9 word timing clamp,
`findChronologicalWordNeighbors`, `validateWordsWithinCaptionBounds`, `clampWordsToCaptionBounds`,
`updateSubtitleTiming`, `resolveTimingUpdate`, `updateWordTiming`, autosave, commit architecture,
undo/redo architecture, P18.2 memoization architecture, P18.3 word styles, P18.4 error boundaries,
P17 display-mode architecture, waveform, playback, Whisper, FFmpeg, Electron, packaging.

## 18. Database

No schema changes, no migration, no production database changes.

## 19. Packaging

NOT REQUIRED. No version bump (stays 0.1.17). No Electron changes.

## 20. Final verification

- `npm test`: 1636/1636 PASS
- `npx tsc --noEmit`: PASS (0 errors)
- `npx eslint .`: PASS (0 errors, 5 pre-existing warnings, unchanged from baseline)
- Live QA: every one of the five fixes exercised directly in the real editor UI, with observable,
  correct before/after behavior at each step (§13)
- Real MP4 export: verified via direct frame extraction with BOTH a cut range and a non-monotonic
  caption present simultaneously — the exact combination that exposed the `remapSubtitlesToEdited`
  bug — correct highlighting proven for all three words (§14)

## 21. P19 status

NOT STARTED.

**Final answer to this task's own closing question:** after this audit and the five fixes above, no
remaining production timing path was found that incorrectly assumes `Word[]` array order is
chronological. Two non-production-impacting findings (a best-effort quality-lint gap and genuinely
dead code) are documented in §5 rather than fixed, since neither can affect a user's actual data or
export. P18 can be closed on this basis.
