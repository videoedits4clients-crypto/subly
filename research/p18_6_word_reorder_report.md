# P18.6 — Word Reorder & Text/Timing Integrity

## 1. Task ID
113528

## 2. Scope
Add a bounded MOVE WORD FROM INDEX A TO INDEX B operation within a single caption — reordering the textual order of words while keeping the resulting word timing state explicit and safe. Not a full word editor; not cross-caption; not AI rewriting; no timing recalculation.

## 3. Baseline
Version 0.1.17. P18.1–P18.5 complete (PASS). 1353/1353 tests, typecheck PASS, lint 0 errors / 5 pre-existing warnings, before this task.

## 4. Phase-0 audit
Read/re-confirmed the full mutation/rendering pipeline before writing any code:
- **Word identity is positional (array index), not content-based** — confirmed via `remapWordsToText` (editor-store.ts), which maps old word `i` → new token `i` purely by array position whenever a text edit preserves token count.
- **`updateSubtitleTiming`'s pure-shift branch** (`{...w, start: w.start + delta, end: w.end + delta}`) is the established pattern for "a word object keeps moving with its own timing" — the direct precedent this task's `shiftSubtitleByDelta`-style move follows.
- **`splitWordText`/`mergeWords`/`resolveWordInsertion`/`deleteWordConservative`** (word-edit.ts) — the established METADATA POLICY: `style` always travels; `confidence` never travels onto a genuinely new/changed token; `hinglishText`/`gujaratiScriptText` travel only when unambiguous; `removed` propagates conservatively. A pure reorder moves the *same* word (no new token), so every one of these fields should travel unconditionally — confirmed as the correct model, not merely assumed.
- **Two independent, already-shipped pieces of evidence prove non-monotonic word order is safe to render and export**, found by reading the actual code, not assumed:
  1. `findActiveWordIndex` (playback-context.ts, used by the live preview) finds the active word by **timestamp content** (`time >= w.start && time < w.end`) via `Array.prototype.findIndex` — never by assuming the array is chronologically sorted.
  2. `buildIntervals` (ass.ts, the ASS/export word-highlight engine) builds its own sorted set of time breakpoints from every word's own start/end, then **independently re-derives which word is active for each interval by the same content check** — the rendered text line is built by iterating `words` in ARRAY order (i.e., reading order), so the caption text reflects the new order while each word's own highlight still fires at *its own* original time. **This was verified, not just read** — see §20/§21.
- **`QualityIssue.wordIndex`** (quality-analyzer.ts) is a plain, ephemeral array-index computed fresh every `analyzeSubtitleQuality` run — never persisted, never remapped. Since `isQualityReportStale` is pure reference-inequality on the whole `subtitles` array (confirmed identical to the mechanism already reused by P18.5's ripple editing), any reorder commit automatically invalidates the whole report — no stale index can ever be read, because the report itself is marked stale as a unit.
- **Caption-level `.text` rebuild convention**: every existing word-array-structural mutation (`splitWord`, `mergeWithNext`, `deleteWord`, `insertWord`) rebuilds `.text` via `breakIntoLines(words.map(w=>w.text).join(" "), rules.maxCharsPerLine, rules.maxLines)` and **unconditionally clears the caption-level `hinglishText`/`gujaratiScriptText` cache** (confirmed directly in `mergeWithNext`'s merged-caption object literal, which carries neither field forward). This is the exact precedent reorder follows (§10).
- **`reorderSubtitle` already exists** in editor-store.ts — but it is an unrelated, CAPTION-level, adjacent-swap operation (swaps two captions' *content* while keeping each caption's own time *slot* fixed) — the opposite semantic model from what this task needs. Confirmed distinct, not reused, not modified, not renamed-over.
- **`@dnd-kit`** is an installed but completely unused dependency (zero imports anywhere in `src/`) — confirming no existing drag-and-drop infrastructure to build on.
- Clipboard (`caption-clipboard.ts`) operates at the whole-caption level (copies `words` wholesale) — unaffected by and irrelevant to word reorder.

### Phase-0 answers
- **A.** Positional (array index).
- **B.** Yes — proven safe by the two independent content-based lookups above.
- **C.** Travels with the word object, untouched.
- **D.** Travels with the word object, untouched.
- **E.** Travels with the word object, untouched.
- **F.** Per-word `hinglishText`/`gujaratiScriptText` travel untouched; the *caption-level* cached derived-text string is cleared (not regenerated) on every reorder, exactly like split/merge/insert already do.
- **G.** No remapping needed — the whole report goes stale as a unit via the existing reference-inequality check.
- **H.** Yes — a pure transformation over `Subtitle`, touching only word array order.
- **I.** N/A (H is yes).

## 5. Semantic decision
**WORD OBJECT IDENTITY TRAVELS WITH THE WORD** — the task's own preferred model, confirmed safe and implemented literally: `reorderSubtitleWord` performs a `splice`-based array move and nothing else. No word is rebuilt, no timestamp regenerated, no metadata cleared, `remapWordsToText` is never called.

## 6. Word identity model
Positional/array-index, matching this codebase's existing model everywhere else. A "move" is therefore unambiguous: move the element currently at `fromIndex` to `toIndex`, shifting everything between by one slot (standard `splice` semantics).

## 7. Timing behavior
Every word retains its exact pre-existing `start`/`end`. The caption's own `start`/`end`/duration are untouched (spread from the input, never recomputed). Word timing is explicitly allowed to become non-monotonic — verified this is safe for both preview and real export (§20/§21), so **no re-sorting is ever performed**.

## 8. Confidence behavior
Travels with the word object via plain object spread — never cleared, never recomputed, regardless of how far or which direction the word moves. Verified by unit test, store test, and live QA (BRAVO's `confidence: 0.6` survived a full A→B→…→D→…→A round trip byte-for-byte).

## 9. Style behavior
`word.style` (including P18.3's explicit `fontWeight`/color overrides) travels with the object. Verified end-to-end into real ASS export: DELTA's `color: "#22c55e"` override rendered correctly on the correct word after being moved from index 3 to index 2 (§21).

## 10. Removed-word behavior
`removed` travels with the word object — verified by a dedicated unit test and a dedicated store test (moving a `removed: true` word to a new position; the flag is neither cleared nor flipped).

## 11. Derived-mode behavior
`wordReorderAllowed` is **`true` in every mode** (Original, Hinglish, Gujarati Script) — added as a new field to the existing `CaptionDisplayModeCapabilities` table (`caption-display-mode.ts`), following the exact same reasoning already established for Merge/Delete: reorder fabricates no new `Word.text` and operates purely by index, which the derived transforms' proven 1:1 word-count/order mapping makes exactly as safe as Merge/Delete already are. The one thing reorder must additionally guard against that Merge/Delete don't: the existing P17.1 staleness check (`getDerivedWordTextSyncStatus`) is purely **word-count**-based, and reorder is the one operation that changes order without changing count — the one case that check was never designed to catch. Rather than extend that shared check (a bigger, riskier change explicitly out of this task's scope), `reorderWord` unconditionally clears the caption-level `hinglishText`/`gujaratiScriptText` cache on every reorder — the exact same defensive step split/merge/insert already take, closing the gap with zero new staleness-detection logic and zero change to how Merge/Delete/Split/Insert already work. Verified at the store level directly against `captionOutputMode: "hinglish"`; **not live-UI-tested** (see §21) — the disposable QA project's language (English) never surfaced the Hinglish/Gujarati mode switcher in the Settings panel.

## 12. Quality-review behavior
No new quality state, no index remapping. A reorder is an ordinary subtitle mutation through `commit()`; the existing `isQualityReportStale` reference-inequality check catches it automatically (verified by a dedicated store test that seeds a real quality report, confirms it reads fresh, reorders, and confirms it now reads stale) — identical, zero-new-code reuse of the exact mechanism P18.5's ripple editing already relies on.

## 13. Pure transformation
`src/lib/subtitles/word-reorder.ts` (new):
- `reorderSubtitleWord(subtitle, fromIndex, toIndex)` → `{ok:true, subtitle} | {ok:false, reason: "invalid-index"|"noop", subtitle}`. Rejects a non-integer/negative/out-of-range index, or `fromIndex === toIndex` (no partial mutation; the input `subtitle` reference is returned unchanged on rejection). Does **not** touch `.text`/`hinglishText`/`gujaratiScriptText` — that resync is the caller's job, mirroring how the pure word-edit functions never know about `project.timingRules`.

## 14. Store integration
`editor-store.ts`'s `reorderWord(subtitleId, fromIndex, toIndex): WordReorderStoreResult` (`"ok" | "invalid-index" | "noop" | "not-found"`): resolves against the current snapshot for an early no-commit rejection, then re-resolves inside `commit()`'s own mutator against the fresh snapshot (the same defensive double-check pattern every other batch/reject-capable action in this file already uses). On success: rebuilds `.text` via the exact same `breakIntoLines(...)` call split/merge/insert use, clears the caption-level derived-text cache, and keeps `selectedWordIndex` following the moved word to its new position (mirroring `splitWord`'s own "keep selection on what the user just acted on" convention). One `commit()`, one undo step. `commit()` itself was not modified.

## 15. UI
Added "Move left"/"Move right" buttons (with `MoveLeft`/`MoveRight` icons) to the existing `WordTimingPopover`, in a new "REORDER" section placed right after P18.3's Word Style section. Chose explicit buttons over drag-and-drop after confirming `@dnd-kit` is installed but wired up nowhere in this codebase (§4) — introducing real drag interaction for the first time anywhere in the editor would be substantially more complexity than this task's own "prefer Move Left/Move Right" guidance calls for. Each button is `disabled` at its own boundary (verified live via `button.disabled` inspection at both the first and last word of a 4-word caption) rather than allowing a no-op click. No new keyboard shortcut was added (the shortcut namespace is already dense — J/K/L, Home/End, Alt+←/→, brackets, every letter Ctrl combination in active use — and this task's own Phase 4 explicitly allows a UI-action-only implementation).

## 16. Undo/redo
Verified live end-to-end: a single "Move right" click produced exactly one undo step; Ctrl+Z restored the exact original word order, per-word timing, confidence, and style; Ctrl+Shift+Z re-applied the exact same reorder. Also verified at the store level for a full round trip (reorder → undo → redo). `commit()`/`undo()`/`redo()` were not modified.

## 17. Autosave
Routes through the existing `commit()` → `dirty: true` → `useAutosave` subscription path, zero new plumbing. Verified live: the "Saved" indicator updated after each move, and — because the browser session was interrupted and restarted mid-QA by an external usage-limit reset — the project was reloaded completely fresh from the database partway through testing and showed the exact correct post-reorder state, an unplanned but strong real-world confirmation of the full autosave → reload path.

## 18. Performance
`editor-store-word-reorder.test.ts` runs `reorderWord` across the full cross product of caption word counts (1, 5, 20, 100, 500 — 1 excluded from the reorder matrix itself since a single-word caption has no non-noop move) and total project caption counts (30, 300, 1800, 3600, 5400): every combination completes in well under 150ms (worst case ~6.3ms, at 500 words / 5400 captions), and **every caption other than the one being reordered keeps its exact object reference** (asserted directly via `assert.equal`, not value-equality) — the P18.2 memoization contract, confirmed to hold at every tested scale.

## 19. Tests
- `src/lib/subtitles/__tests__/word-reorder.test.ts` — 25 pure tests: every ordering scenario the task named (first↔second, first↔last, last↔first, the task's own "this is a test → this test is a" worked example), no-op rejection, invalid/negative/non-integer/NaN index rejection, single-word and empty-words edge cases, exact timing/confidence/style/removed/derived-field preservation, non-monotonic-order-is-not-corrected, caption-level invariants (start/end/duration/id/index/style unchanged, `.text`/derived-text untouched — caller's job), and object/reference behavior (no input mutation, untouched word objects keep their own reference, the moved/displaced word objects themselves keep their own reference just relocated, a fresh subtitle object is always returned on success).
- `src/store/__tests__/editor-store-word-reorder.test.ts` — 37 tests: one-commit verification, `.text` rebuild, per-word timing/metadata/style preservation, caption-level derived-text clearing, unrelated-caption reference stability, selection-follows-move, undo/redo, `dirty` flag, quality-report staleness via the real mechanism, "works identically in Hinglish/Gujarati mode," no-op/invalid-index/not-found rejection with zero mutation, and the full word-count × caption-count performance/reference-stability matrix (20 of the 37).
- `src/lib/subtitles/__tests__/caption-display-mode.test.ts` — extended with 1 new test (`wordReorderAllowed: true in EVERY mode`) plus updated the existing `derivedWordEditAffectsOriginalNotice` test's own description to mention reorder; net +1 over its prior 13 (now 14).
- All three files registered in `package.json`'s `test` script.
- **Baseline 1353 → 1416** (1353 + 25 + 37 + 1). Zero tests deleted or weakened.

## 20. Live QA
Seeded a disposable project (`p18-6-reorder-qa`, real 12s video, one caption with 4 uniquely-timed words: ALFA 0.5–1.5 [confidence 0.95], BRAVO 2.0–3.0 [confidence 0.6, `fontWeight: 700`], CHARLIE 3.5–4.5 [confidence 0.85], DELTA 5.0–6.0 [confidence 0.9, `color: "#22c55e"`], `wordHighlight: true`):
1. **A → B**: ALFA moved to index 1 ("BRAVO ALFA CHARLIE DELTA"); database confirmed both words' original timestamps/confidence/style traveled with them, non-monotonic order confirmed.
2. **Undo**: exact original order/timing/metadata restored (discovered along the way: undo is correctly suppressed while the word popover is open, via the *existing* `isAnyDialogOpen()` dialog guard — not a bug, the intended, pre-existing behavior).
3. **Redo**: exact reorder re-applied.
4. **A → D**: three sequential "Move right" clicks moved ALFA to the last position; database confirmed ALFA's original 0.5–1.5 timing fully intact at its new textual position.
5. **D → A**: three sequential "Move left" clicks moved ALFA back to first; **a full round-trip (A→B→undo→redo→undo→A→D→D→A) resulted in byte-identical original data** — zero drift across 6+ mutations.
6. **No-op / boundary protection**: confirmed live via `button.disabled` inspection — Move Left disabled exactly when the word is at index 0, Move Right disabled exactly when at the last index, symmetric at both ends.
7. **Autosave/reload**: confirmed both through the normal flow and via an unplanned full session interruption/restart mid-QA (see §17).
8. **Original mode**: all of the above was performed in Original mode (the project's only exposed mode, given its English source language).
9. **Derived mode**: not live-UI-tested (§11's honesty note) — the Hinglish/Gujarati switcher never appeared for this English-language project; covered instead by a real, passing store-level test against `captionOutputMode: "hinglish"`.
10. **Quality report**: not re-demonstrated via live UI interaction in this session; covered by a dedicated, real store-level test using the actual `analyzeSubtitleQuality`/`isQualityReportStale` functions (§12) — the identical mechanism already relied on by P18.1–P18.5.
11. **Console**: no errors observed at any point.

## 21. Export verification
Exported the project (real server-side FFmpeg) after moving ALFA to the last textual position ("BRAVO CHARLIE DELTA ALFA" — timings 2–3, 3.5–4.5, 5–6, 0.5–1.5, genuinely non-monotonic). Extracted real frames from the actual output MP4 with `ffmpeg-static`:
- **t=1.0s** (ALFA's own original 0.5–1.5s window): the frame shows the full reordered line "BRAVO CHARLIE DELTA ALFA" with **"ALFA" — the textually LAST word — rendered in the active-word highlight color (cyan)**, and "DELTA" simultaneously showing its own green style override. This is the single most important piece of evidence in this report: it directly proves, at the pixel level, that `buildIntervals`'s content-based (not position-based) active-word matching correctly handles a non-monotonic word array in real ASS/libass export, exactly as the Phase-0 audit predicted — no words duplicated, none missing, correct text, correct highlight timing, correct style attachment to the correct word.
- **t=2.5s** (BRAVO's own original 2–3s window): "BRAVO" — now textually first — correctly shows the active highlight at its own original time; "DELTA" still shows its own independent green override; "ALFA" is plain (correctly not active at this moment).

## 22. NOT TESTED items
- Live UI-level reorder in Hinglish/Gujarati Script mode (covered by a real store-level test only — see §11/§20 item 9).
- Live UI-level quality-report staleness (covered by a real store-level test only — see §12/§20 item 10).
- Reordering a caption containing a `removed: true` word through the live UI/export pipeline specifically (covered by unit + store tests; the general removed-word-preservation mechanism was live-QA'd only indirectly, via BRAVO/DELTA's confidence/style, not a `removed`-flagged word).
- Real video playback through a reordered, non-monotonic caption (only paused-frame/export-frame verification was performed — consistent with not claiming playback QA without observing actual playback).

## 23. Known limitations
- **The word-timing popover's `open` state is keyed by array position, not word identity** (`key={index}` in `WordChips`, unchanged, pre-existing architecture also used by every other word popover interaction). Discovered during live QA: if a popover stays open across a reorder that moves a *different* word into its slot, the still-open popover will show that other word's data, not the one originally clicked. This is a pre-existing characteristic of the whole word-popover architecture (any index-reindexing operation — split, insert, delete — has the identical property), not something this task introduces; fixing it would require a stable per-word id that doesn't exist anywhere in the data model today, an out-of-scope, cross-cutting change explicitly outside this task's bounded scope. Worked around during QA by closing the popover (Escape) between moves; documented here for honesty rather than silently working around it without mention.
- Move Left/Right are single-step only (no "move to start/end" shortcut) — matches the task's own bounded "Move Left/Move Right" UI guidance; a caption with many words requires one click per position, same cost as the click-through QA above.
- No keyboard shortcut (§15) — toolbar/popover-button-only, by deliberate, documented choice.

## 24. Protected systems
Not touched: Prisma schema, persistence architecture, autosave queue, local snapshot architecture, crash recovery, stale-job recovery, undo/redo architecture, `commit()`, word timing authority, P17 display-mode contracts (extended additively with one new capability field, not altered), P17.1/P17.2 derived-state machinery, P18.1 confidence behavior, P18.2 memoization/virtualization, P18.3 word styling, P18.4 error boundaries, P18.5 ripple editing (its own `reorderSubtitle`, `rippleDeleteSubtitles`, `rippleInsertTime` are completely untouched and confirmed distinct in purpose from this task's `reorderWord`), waveform, playback, Whisper/transcription, FFmpeg/export worker, Electron packaging.

## 25. Packaging decision
NOT REQUIRED — pure editor/store/UI change, no Electron/native/runtime behavior touched. Version kept at 0.1.17.

## 26. Final verification
- `npm test`: **1416/1416 PASS** (1353 baseline + 63 new).
- `npx tsc --noEmit`: **PASS**, 0 errors.
- `npx eslint .`: **PASS**, 0 errors, 5 pre-existing warnings (identical set to before this task, zero new).

## 27. P18.7 status
NOT STARTED.

---

TASK ID: 113528
STATUS: PASS
VERSION: 0.1.17
PRODUCTION CODE CHANGED: YES
DATABASE CHANGED: NO
TESTS: 1416/1416
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18.7: NOT STARTED
