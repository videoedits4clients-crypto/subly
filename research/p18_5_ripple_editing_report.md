# P18.5 — Ripple Timeline Editing & Structural Timing Hardening

## 1. Task ID
112347

## 2. Scope
Add a bounded, subtitle-only ripple editing workflow: **Ripple Delete** (remove a contiguous caption selection and shift everything after it earlier by exactly the deleted span) and **Ripple Insert** (insert a span of subtitle-timeline time at a point, shifting everything at/after it forward). Never touches the source video/audio file, `project.video`, `trimStart`/`trimEnd`, or `cutRanges`. Not a timeline redesign, not a new NLE.

## 3. Baseline
Version 0.1.17. P18.1–P18.4 complete (PASS). 1290/1290 tests, typecheck PASS, lint 0 errors / 5 pre-existing warnings, before this task.

## 4. Phase-0 timing/media audit
A dedicated research pass (19 audit items) plus direct reads of the most load-bearing code confirmed:
- **`commit()`** (`editor-store.ts:731-745`) never deep-clones — `past`/`future` hold shallow `HistorySnapshot`s, and every mutator's `.map()`/`.filter()` structural sharing is what keeps an untouched caption's object reference stable across a commit. `dirty: true` is set **only** inside `commit()`/`undo()`/`redo()`; `useAutosave` is driven purely by `dirty` + a project-reference change — any ripple mutation routed through `commit()` autosaves with zero new plumbing.
- **`updateSubtitleTiming`** clamps only against the *immediate* neighbor and, for a pure duration-preserving shift, moves every word by the identical delta (`{...w, start: w.start + wordDelta, end: w.end + wordDelta}`) — this exact pattern is what `shiftWordsByDelta`/`shiftSubtitleByDelta` (§8) replicate for ripple.
- **`deleteSubtitle(s)`** is filter + reindex only — confirmed: **delete does NOT ripple today**, it leaves a gap.
- **`duplicateSubtitle(s)`** has an explicit, already-considered-and-rejected precedent (see `duplicate-timing.ts`'s own doc comment): "every other timing mutation... only ever clamps against the IMMEDIATE neighbor, never cascades further down the timeline" — duplication **rejects** rather than shifting later captions. This is the strongest piece of prior art: it establishes that a cascading shift must be a **new, separate, explicitly-invoked** operation, never a change to existing delete/duplicate/nudge behavior — exactly what this task builds.
- **Media/project duration model (critical)**: `project.video.duration` is a completely separate field from subtitle timing. Grep-confirmed: it is **never** read by `updateSubtitleTiming`, `nudgeSubtitleTiming`, `nudgeSubtitles`, `duplicateSubtitle(s)`, `splitSubtitle`, or `mergeWithNext`. **A subtitle's start/end can already exceed the video's duration with zero validation anywhere in the mutation layer.** Ripple does not need to (and does not) newly invent a video-duration constraint.
- **`trimStart`/`trimEnd`/`cutRanges`** (`lib/timeline/edit-model.ts`) are a genuinely separate, non-destructive **video-editing** layer, entirely in source time, applied only at preview/export as a read-only remap (`remapSubtitlesToEdited`) — never written back into `project.subtitles`. `Subtitle.start`/`end` as stored and mutated is **always source time**, the same space every existing timing mutation already operates in. Ripple is therefore orthogonal to this layer and does not need to touch it.
- **Timeline's "Cut range" feature** is the video-cut model (`addCutRange`), not a caption-timing operation — it hides a source-time span from playback/export without ever moving `project.subtitles`. Explicitly *not* reused or duplicated for ripple (would violate the "subtitle-only, don't touch media" rule).
- **No existing "is this selection contiguous" shared helper** — the check exists only inlined once, in `duplicateSubtitles`. A new shared `isContiguousSelection` helper was added for ripple (§8) rather than duplicating the inline logic a second time, per the task's own "prefer reusing... do not duplicate existing timing logic unnecessarily."
- **Quality-report staleness** (`isQualityReportStale`) is pure reference inequality on the whole `subtitles` array — any `commit()` automatically makes the check true, zero new code needed.
- **Keyboard shortcuts**: a dense, already-fully-occupied namespace (J/K/L, Home/End, Alt+←/→, brackets, Ctrl+D/Shift+M/Shift+S/Z/A, arrows, Delete/Backspace, Space, Tab, Ctrl+C/X/V) — see §11 for the resulting decision.

## 5. Exact ripple semantics
**RIPPLE DELETE** of a contiguous (array-index-adjacent — the array is always kept sorted by `start`, so index-adjacency is time-adjacency), selected set of captions {c₁…cₖ}:
```
rippleStart = c₁.start
rippleEnd   = cₖ.end
delta       = rippleEnd - rippleStart   (the selected block's OWN occupied span — never the
                                          surrounding gaps)
```
Every caption before c₁: untouched. Every caption after cₖ: `start -= delta`, `end -= delta`, every word shifted by the same `-delta`. Duration is invariant by construction — a pure translation can never violate a minimum-duration rule.

**RIPPLE INSERT** of `durationSec` at `insertAtSec`:
- A caption entirely before (`end <= insertAtSec`): untouched.
- A caption entirely at/after (`start >= insertAtSec`): shifted forward by `+durationSec`.
- A caption whose span **strictly straddles** the point (`start < insertAtSec < end`): the operation is **rejected outright** — no split, no expand, no whole-caption shift, per the task's own "prefer rejection of ambiguous operations over silent destructive behavior."

Both are implemented as pure functions over `Subtitle[]` (Phase 1's own requirement), proven overlap-safe by construction (see the algebra in `ripple-edit.ts`'s top-of-file doc comment and the tests in §19) — given the project's captions are always mutually non-overlapping beforehand, neither operation can create a new overlap.

## 6. Gap/overlap policy
Directly answering the task's own worked example: deleting caption A (0–2) ahead of a 2–4 gap before caption B (4–6) does **not** collapse that gap. `delta = 2 - 0 = 2` (A's own span only), so B moves to 2–4 — the original 2s gap is preserved exactly, just relocated to start at t=0 instead of t=2. Verified by a dedicated test (`ripple-edit.test.ts`, "the task's own worked example") and live in the browser (§20). No overlap-detection validator ever needs to fire in practice (proven unreachable for valid input), but a defensive floor (`Math.max(0, ...)`) and a note that this is defense-in-depth, not a load-bearing check, are both present.

## 7. Insert-inside-caption policy
A caption whose `[start, end)` strictly contains `insertAtSec` makes the operation ambiguous (split? expand? shift the whole caption?) and is rejected with `reason: "crosses-caption"` plus the specific caption's id, so the UI can name it. A caption **touching** the insertion point at a boundary (`end === insertAtSec` or `start === insertAtSec`) is *not* ambiguous — it falls cleanly into "before" or "at/after" respectively, verified by dedicated tests and live QA (§20, item 7).

## 8. Pure ripple engine
`src/lib/subtitles/ripple-edit.ts` (new):
- `shiftWordsByDelta(words, deltaSec)` / `shiftSubtitleByDelta(subtitle, deltaSec)` — identity-preserving at `deltaSec === 0`, otherwise a pure translation that touches only `start`/`end`, leaving `text`, `confidence`, `style`, `removed`, `hinglishText`, `gujaratiScriptText` completely untouched. Mirrors `updateSubtitleTiming`'s own pure-shift branch exactly.
- `isContiguousSelection(subtitles, selectedIds)` — the new shared helper (§4), exported separately so the UI can pre-emptively disable Ripple Delete for a non-contiguous selection.
- `resolveRippleDelete(subtitles, selectedIds)` → `{ok:true, subtitles, deltaSec} | {ok:false, reason: "empty-selection"|"non-contiguous-selection"}`.
- `resolveRippleInsert(subtitles, insertAtSec, durationSec)` → `{ok:true, subtitles, affectedCount} | {ok:false, reason: "invalid-duration"|"invalid-insertion-point"|"crosses-caption", crossingSubtitleId?}`.
No partial mutation on any failure — the input array is never touched.

## 9. Store integration
`editor-store.ts`: `rippleDeleteSubtitles(ids): RippleDeleteResult` and `rippleInsertTime(insertAtSec, durationSec): RippleInsertResult` — status-string return types (`"ok" | "empty-selection" | "non-contiguous"` and `"ok" | "noop" | "invalid-duration" | "invalid-insertion-point" | "crosses-caption"`) mirroring `DuplicateResult`'s own established shape/reasoning exactly. Both: check the resolution first for an early return (no commit on failure), then re-resolve against the fresh snapshot **inside** `commit()`'s own mutator (same defensive "never apply a stale-computed result" pattern every other batch action already uses) — one `commit()` call, one undo step, on success. `rippleInsertTime` additionally treats `affectedCount === 0` as `"noop"` and skips the commit entirely (no pointless undo entry for an operation that changes nothing), mirroring `nudgeSubtitles`' own `if (clampedDelta === 0) return`. `commit()` itself was not modified.

## 10. UI integration
Added to the Timeline toolbar (`timeline.tsx`), the one place that already has both single/batch selection state (`selected`/`isBatchSelection`/`selectedIds`) and playhead-based actions (Mark in/Mark out/Cut range) in scope:
- **Ripple delete** — an icon button (`Waves` icon) immediately after the existing Duplicate/Delete buttons, same `disabled={!selected && !isBatchSelection}` gating, same single-vs-batch routing. A non-contiguous batch selection shows a toast ("Ripple delete needs a contiguous selection...") and makes no change.
- **Ripple insert** — a small Popover (matching `WordTimingPopover`'s established inline-editor pattern) triggered from a button next to Cut range, showing the current playhead time and a duration input (default 1.0s). "Insert" validates and either succeeds (closes the popover, shows a success toast with the exact amount/time) or shows a specific rejection toast and **stays open** so the user can adjust and retry.
`style-panel.tsx`/`captions-panel.tsx` were not touched — no second competing UI location for the same action.

## 11. Keyboard decision
**No new keyboard shortcut was added.** The audit (§4) found the shortcut namespace already densely packed (J/K/L, Home/End, Alt+←/→, `[`/`]`/`{`/`}`, every Ctrl/Cmd combination from A through Z that's in use, arrows, Delete/Backspace, Tab, Space). Ripple Delete is a higher-blast-radius operation than ordinary delete (it moves *every later caption*, not just the selected ones), and Ripple Insert fundamentally requires a duration input a bare keypress can't supply. The task's own Phase 4 explicitly allows "a UI action alone is acceptable" and directs "do not add shortcuts if there is a serious conflict" — given the density here and the elevated risk of a muscle-memory misfire on a wide-blast-radius operation, that escape hatch was taken deliberately rather than forcing a shortcut in. The toolbar buttons (§10) are the sole, fully-functional entry point.

## 12. Word timing behavior
Every shifted word: `start += delta`, `end += delta`, nothing else touched — never regenerated, never recalculated. Verified: word duration exactly preserved, word ordering preserved, no `MIN_WORD_DURATION_SEC` check needed or performed (a pure translation cannot violate it). `remapWordsToText` is never called anywhere in `ripple-edit.ts` or the two new store actions — confirmed by inspection (the module doesn't import it) and by test (word `.text` values are asserted unchanged across every ripple test).

## 13. Metadata/style behavior
`confidence`, `style` (including explicit `fontWeight`/color/background overrides from P18.3), `removed`, `hinglishText`, `gujaratiScriptText` — on both captions and words — are carried forward via object spread, never rebuilt or cleared. Verified at three levels: pure-function unit tests (§19), store-level tests with a seeded `fontWeight: 700` word override, and — most conclusively — **live export**: a word-level Bold override survived a ripple-delete followed by a ripple-insert and rendered visibly bold in the actual burned-in MP4 frame (§20/§21).

## 14. Display-mode behavior
Ripple never reads or writes `hinglishText`/`gujaratiScriptText` generation logic, never calls `regenerateHinglishForSubtitle`/`regenerateGujaratiScriptForSubtitle`, and never touches `text` (the Original-text source of truth). `shiftSubtitleByDelta`'s spread carries any existing derived-text fields forward unchanged (verified by test — a caption seeded with `hinglishText`/`gujaratiScriptText` values keeps them byte-identical after a ripple shift). Not live-QA'd against a real Hinglish/Gujarati-Script project (see §22) — the seeded QA fixture is English-only — but the code path guarantee is the same one P17/P17.1's own established `word.style`-preservation precedent already relies on (confirmed identical spread pattern).

## 15. Undo/redo
Every successful ripple call is exactly one `commit()` — verified: `past.length` increases by exactly 1 per operation, `undo()` restores exact prior positions/metadata in one step, `redo()` re-applies the exact same result. No new history mechanism; `commit()`/`undo()`/`redo()` were not modified.

## 16. Autosave
Both actions route through the existing `commit()` → `dirty: true` → `useAutosave`'s store-subscription path with zero new code. Verified live: the "Saved" indicator updated after each ripple action, and a direct database check after each operation showed the exact expected shifted timings and preserved metadata (§20).

## 17. Quality-report behavior
`isQualityReportStale`'s pure reference-inequality check automatically returns `true` after any ripple commit (any `commit()` always produces a new `subtitles` array reference) — verified by a dedicated store test that seeds a quality report, confirms it's fresh, runs a ripple delete, and confirms it's now stale, using the exact existing mechanism with zero new quality-state code.

## 18. Performance results
`editor-store-ripple-edit.test.ts` runs both operations at 30/300/1800/3600/5400 total captions:
- Ripple delete near the tail of a large project: sub-3ms even at 5400 captions, and **every caption strictly before the deleted one keeps its exact object reference** (asserted directly, not just value-equality) — the P18.2 memoization contract.
- Ripple insert at the very start (worst case: every caption shifts): sub-4ms at 5400 captions.
- Ripple insert deep in the tail: sub-2ms at 5400 captions, earlier captions' references confirmed untouched.
Timings scale roughly linearly with caption count (30→~0.3-0.9ms, 5400→~1.7-3.8ms), consistent with the single O(n) pass both pure functions make — no O(n²) behavior, no repeated full-project cloning (both functions build the result array in one forward pass), no derived-text regeneration.

## 19. Tests added
- `src/lib/subtitles/__tests__/ripple-edit.test.ts` — 32 pure tests: identity-preservation at delta=0, metadata preservation, the task's own gap-preservation worked example, single-caption (k=1) delete, before-block reference stability, contiguous multi-caption delete, word timing/ordering, reindexing, delete of first/last/all captions, negative-timestamp safety, `isContiguousSelection` in isolation, insert's worked example, crossing-caption rejection (with the task's own 9–12/insert-at-10 example), exact-boundary touch (both directions, not a cross), insert at t=0, insert past everything (noop), duration/insertion-point validation (zero, negative, NaN, Infinity), and metadata preservation on insert.
- `src/store/__tests__/editor-store-ripple-edit.test.ts` — 31 tests: one-commit verification, metadata/style preservation through the real store, reference stability, undo/redo, `dirty` flag, quality-report staleness via the real mechanism, empty/non-contiguous rejection with zero mutation, selection pruning, and the full 30/300/1800/3600/5400 performance/reference-stability matrix (15 of the 31).
- Both registered in `package.json`'s `test` script.
- **Baseline 1290 → 1353** (1290 + 32 + 31). Zero tests deleted or weakened.

## 20. Live QA
Seeded a disposable project (`p18-5-ripple-qa`, real 12s video, 5 captions with deliberate gaps: ALPHA 0.5–1.5, BRAVO 2.0–3.0 [word `fontWeight:700` override], CHARLIE 3.5–4.5, DELTA 5.0–6.0, ECHO 8.0–9.0):
1. **Single-caption ripple delete** (ALPHA): BRAVO/CHARLIE/DELTA/ECHO all shifted earlier by exactly 1.0s; confidence and the `fontWeight` style override confirmed byte-identical in the database.
2. Undo: restored ALPHA and all five original positions in one step.
3. **Contiguous multi-caption ripple delete** (CHARLIE + DELTA): ECHO shifted from 8.0–9.0 to 5.5–6.5 (delta = 6.0−3.5 = 2.5), ALPHA/BRAVO untouched.
4. **Non-contiguous rejection** (ALPHA + ECHO, skipping BRAVO): exact toast "Ripple delete needs a contiguous selection — try selecting adjacent captions only." — zero timing change.
5. **Insertion inside a caption** (playhead at 2.5, inside BRAVO's 2.0–3.0): exact toast "Can't insert here — a caption spans the playhead..." — zero timing change, popover stayed open for retry.
6. **Insert at t=0** (+2.0s): every remaining caption shifted forward by exactly 2.0s; exact success toast.
7. **Insert past every caption** (+5.0s at t=11, past ECHO's new end of 8.5): exact "Nothing after the playhead to shift — no change made." toast, zero mutation ("noop", not an error).
8. Autosave: "Saved" indicator updated after every successful operation; database state matched the UI exactly after each step.
9. **Reload persistence**: navigating fresh to the project URL reproduced the exact post-ripple state with a clean console (no errors).
10. No console errors observed at any point in the sequence.

## 21. Export verification
Exported the project (server-side FFmpeg) after the full ripple-delete + ripple-insert sequence above (final state: ALPHA 2.5–3.5, BRAVO 4.0–5.0 [bold], ECHO 7.5–8.5). Extracted real frames from the actual output MP4 with `ffmpeg-static`:
- **t=1.0s** (ALPHA's original, pre-ripple position): frame is empty — proves the caption genuinely moved, not duplicated.
- **t=3.0s** (ALPHA's new, post-ripple position): frame shows "ALPHA" — the shifted timing round-tripped correctly through ASS generation and the burn-in.
- **t=4.5s** (BRAVO's new position): frame shows "BRAVO" rendered visibly **bold** — the P18.3 word-style `fontWeight: 700` override survived both ripple operations end-to-end into the real rendered video, not just the editor/preview.
This is definitive, pixel-level confirmation, not just DOM/CSS or database inspection.

## 22. NOT TESTED items
- Live QA against a real Hinglish/Gujarati-Script project (the seeded fixture is English-only) — covered instead by the code-path guarantee (§14: no derived-text function is ever called, spread preserves existing values) and dedicated unit tests seeding those fields directly.
- Keyboard-shortcut-triggered ripple (none exists, by deliberate decision — §11).
- Ripple operating on a project with an active `CutRange` (manual video cut) already present — not explicitly exercised live; the pure-function/store-level design never reads `cutRanges` at all (§4), so this is a code-level, not live-QA'd, guarantee.
- Real playback (video actually running) through a ripple-shifted caption boundary — only scrubbing/paused-frame and export-frame verification was performed, consistent with "do not claim playback QA unless observed."

## 23. Known limitations
- Ripple Insert's duration input has no upper bound beyond `Number.isFinite` — an accidental very large value would shift captions far into (or past) the video's own duration with no warning, since (per §4's audit finding) no existing subtitle-timing mutation anywhere in this codebase validates against `project.video.duration` either. This is a pre-existing gap in the mutation layer generally, not something ripple introduces; adding that guardrail was judged out of this task's bounded scope (it would be inventing a new constraint, not reusing one).
- Ripple Delete/Insert have no keyboard shortcut (§11) — toolbar-only, by deliberate, documented choice.
- The Ripple Insert popover's duration field does not snap to frame boundaries or use the timeline's existing snapping infrastructure — Mark in/Mark out/Cut range (its closest UI precedent) don't either, so this matches existing behavior rather than introducing an inconsistency, but it is worth noting that `lib/timeline/snapping.ts`'s `computeSnappedTiming` was deliberately not reused here (it's scoped to a single caption's own drag against immediate neighbors/playhead, not a project-wide cascading shift — see the module's own doc comment on why it doesn't apply).

## 24. Protected systems
Not touched: Prisma schema, persistence architecture, autosave queue, save queue, local snapshot architecture, crash recovery, stale-job recovery, undo/redo architecture, `commit()` semantics, word timing authority, Original/Hinglish/Gujarati source-of-truth semantics, P18.3's word-style architecture, P18.2's memoization/virtualization architecture, quality-report architecture, waveform math, playback architecture, transcription/Whisper, FFmpeg/export worker, Electron packaging. Existing `deleteSubtitle(s)`, `duplicateSubtitle(s)`, `nudgeSubtitle(s)`, `updateSubtitleTiming` behavior is completely unchanged — ripple is purely additive.

## 25. Packaging decision
NOT REQUIRED — pure editor/store/timing/UI change, no Electron/native code touched. Version kept at 0.1.17.

## 26. Final verification
- `npm test`: **1353/1353 PASS** (1290 baseline + 63 new).
- `npx tsc --noEmit`: **PASS**, 0 errors.
- `npx eslint .`: **PASS**, 0 errors, 5 pre-existing warnings (identical set to before this task, zero new).

## 27. Explicit P18.6 status
NOT STARTED.

---

TASK ID: 112347
STATUS: PASS
VERSION: 0.1.17
PRODUCTION CODE CHANGED: YES
DATABASE CHANGED: NO
TESTS: 1353/1353
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18.6: NOT STARTED
