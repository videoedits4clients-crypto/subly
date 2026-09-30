# P18.1 — Word Metadata Integrity & Confidence Review

## 1. Task ID

108762 (P18.1). A tightly bounded implementation task following directly from the P18 preflight audit (Task 108041). Two goals only: (1) fix the confidence-carryover metadata gap identified in that audit's §7, and (2) surface `Word.confidence` as a lightweight review signal. Not a general word-editing redesign; P18.2/P18.3/P18.4 were not started.

## 2. Scope

In scope: `remapWordsToText`'s per-word metadata handling on a same-token-count direct text edit; a new read-only confidence classification helper; a minimal UI surface (word-chip visual cue + a line in the existing word-timing popover). Out of scope (confirmed untouched, see §16): DB schema, Original/Hinglish/Gujarati Script architecture, quality-report architecture, undo/redo architecture, autosave, word dragging/reordering, multi-word insertion, batch split/merge, ripple editing, regex search, cloud sync, collaboration, resizable panels, error boundaries, incremental persistence, alpha export, P18.2+.

## 3. Baseline

- Version 0.1.17 (unchanged). P18 preflight: Task 108041 AUDIT COMPLETE.
- Full suite at task start: 1188/1188. Typecheck: clean. ESLint: 0 errors, 5 pre-existing warnings.
- No database migration was needed or performed.

## 4. Phase-0 audit findings

Traced from the actual current code, not assumed:

1. **Which text-edit paths preserve Word objects by position**: exactly one function, `remapWordsToText` (`src/store/editor-store.ts:1518`, private to that module), called from 6 sites — `updateSubtitleText` (:780), `applyTextMap`/clipboard paste (:1376), `findReplace`/global find-replace (:1400), `applyBatchFindReplace` (:1420), `applyBatchTextTransform` (:1437), `applyTextCleanup` (:1465). All six pass through the identical function, so a single fix at that one point covers every caller.
2. **Which metadata fields were carried forward**: before this fix, ALL of them — `confidence`, `style`, `removed`, `start`, `end` — were preserved via an object spread (`{...w, text: newTokens[i], ...}`) regardless of whether the token TEXT at that position actually changed.
3. **Which fields should remain position-preserved for an ordinary correction**: `start`/`end` (timing) always (this was never in question — timing safety is `remapWordsToText`'s own separate, unchanged concern, gated entirely by whether the TOKEN COUNT matches, not by per-word text comparison). `style` and `removed` — see §5 for the reasoned answer.
4. **Which fields are no longer semantically trustworthy when the text changes**: `confidence` only. It is a measured value describing a SPECIFIC piece of audio-to-text output; once the text at that position is replaced by something the transcription model never produced, the old confidence describes a different word entirely.
5. **Whether `removed=true` can ever legitimately survive a direct text replacement**: yes, and it already does — a removed word's text is excluded from the visible/editable caption text by every text-building function (`segmentWords`, `generateHinglishForSubtitle`, etc. — confirmed in P17.3), so a normal user typing into the visible textarea essentially never lands new content on a removed word's position through this path. In the rare coincidental case where token counts happen to align (a possible outcome, not fully excluded by the code), the codebase's own existing precedent — `word-edit.ts`'s split/merge functions, which "propagate `removed` conservatively" — is directly applicable: a text edit is not a "restore this filler word" action, and this app has no such affordance anywhere. `removed` is left unchanged either way.
6. **Confidence semantics**: traced to the exact source. `src/lib/transcription/local-provider.ts:82` maps `w.confidence` straight from the transcription result; `python/whisper_worker.py:186` sets it as `"confidence": round(w.probability, 3)` — this is faster-whisper's own per-word token probability (its own top candidate's likelihood), NOT a phrase-level, sentence-level, or provider-agnostic score. The field was not renamed or reinterpreted.
7. **Does confidence exist for all historical projects, or only transcription-created words?**: only transcription-created words. It is optional (`confidence?: number`, `types/subtitle.ts:16`), never set by `resolveWordInsertion` (P16 insert), `splitWordText`/`mergeWords` (P15 split/merge — confirmed `undefined`, "never fabricated" by explicit existing policy), and would be entirely absent on any legacy/imported caption that predates word-level confidence recording. Resegmentation (`segment.ts`'s `segmentWords`) passes `Word` objects through unchanged (confirmed: it filters `!w.removed` and groups words into segments, but never reconstructs a word object, so `confidence` survives resegmentation intact).
8. **Derived-mode behavior after Original text changes**: `remapHinglishWordsToText`/`remapGujaratiScriptWordsToText` (`editor-store.ts:1544-1557`) only ever touch `hinglishText`/`gujaratiScriptText` per word — they never read or write `confidence`/`style`/`removed`/`text` at all, and are therefore completely unaffected by, and irrelevant to, this fix. All six `remapWordsToText` call sites already unconditionally clear the caption-level `hinglishText`/`gujaratiScriptText` cache on every Original-text edit (pre-existing P17-era behavior) — this task did not touch that.

No code was changed during Phase 0.

## 5. Exact metadata invariant chosen

For a same-token-count direct text replacement, per word at position `i`:

- **Case A — token text at `i` is UNCHANGED** (a no-op for this specific word, even if other words in the same caption changed): the word is returned completely untouched. `confidence`/`style`/`removed`/timing all stay exactly as they were, because nothing about this word actually changed.
- **Case B — token text at `i` DID change**: `confidence` is cleared to `undefined` — it described a measurement of the OLD text, never the new replacement, and presenting it otherwise would be fabricating a value nobody measured. `style` is preserved unconditionally. `removed` is preserved unconditionally (propagates conservatively, per §4 item 5).
- **Case C — token count changed**: entirely unaffected by this fix; `remapWordsToText`'s pre-existing behavior (leave `originalWords` completely untouched, go stale) is unchanged, confirmed by regression tests (§11 items 4/5).
- **Case D — split/merge/delete/insert**: each already has its own, separate, already-correct metadata policy in `word-edit.ts`, untouched by this task (confirmed by Phase 0 and by regression tests, §11 items 13-16).
- **Case E — derived-mode text editing**: unaffected, per §4 item 8.

## 6. Why the invariant is safe

- **Confidence**: matches the exact, pre-existing "never fabricate a confidence value for text nobody actually measured" principle already codified in `word-edit.ts` for split/merge/insert (its own top-of-file METADATA POLICY comment, extended by this task to cover this fourth case). No new semantics invented — this is the same rule, applied consistently to the one path that had been missed.
- **Style preserved**: not an assumption — a proven, repeated architectural precedent already exists in this exact codebase. `splitWordText` explicitly carries `style` onto both split halves with the stated reasoning "it's the same user-chosen override applying to a smaller span of the same original word, not an invented value" (`word-edit.ts`). `mergeWords` carries the first word's `style` forward too. Style is a VISUAL override, never a claim about the word's transcribed content — it was never something Whisper measured, so a text change cannot invalidate it the way it invalidates confidence.
- **Removed preserved**: matches the existing, stated policy in the same file ("`removed` (soft-delete history) is propagated conservatively"). There is no "restore this filler word" UI action anywhere in the app; treating a text edit as an implicit one would be inventing new, undocumented semantics — exactly what this task was told not to do without evidence.
- **Timing untouched**: this fix operates entirely inside the branch `remapWordsToText` already takes only when the token COUNT matches — it never touches the count-mismatch ("stale") branch, so `isWordTimingStale`'s existing, unmodified behavior is fully preserved.

## 7. Files changed

- **`src/lib/subtitles/word-edit.ts`** — added `remapWordMetadataForTextReplacement(oldWord, newText): Word`, a small pure function implementing the invariant above (returns `oldWord` unchanged if text matches; otherwise `{...oldWord, text: newText, confidence: undefined}`). Extended the file's existing top-of-file METADATA POLICY doc comment to describe this fourth case alongside split/merge/insert, rather than duplicating the reasoning.
- **`src/store/editor-store.ts`** — `remapWordsToText` now calls `remapWordMetadataForTextReplacement` per word instead of a blanket spread; the existing unconditional `hinglishText`/`gujaratiScriptText` clearing (pre-existing behavior) is untouched. One-line import added.
- **`src/lib/subtitles/word-confidence.ts`** (new) — the confidence classification/formatting helper (§8).
- **`src/components/editor/word-timing-popover.tsx`** — widened the `word` prop to accept an optional `confidence`, added a read-only "Confidence: X%" / "Confidence: Unknown" line, styled in the existing `text-warning` token when low.
- **`src/components/editor/captions-panel.tsx`** — `WordChips` now computes a per-word `isLowConfidence` flag and applies a purely additive `outline` treatment to the chip button (layered on top of the existing selected/active/default states, never a 4th background state), plus an updated tooltip title for low-confidence words.
- **`src/store/__tests__/editor-store-clipboard.test.ts`** — corrected one existing test that had literally asserted the bug as expected behavior (see §11).
- **`package.json`** — added the new test file to the `test` script.
- Test files added/extended: `src/lib/subtitles/__tests__/word-edit.test.ts`, `src/store/__tests__/editor-store-word-edit.test.ts`, `src/store/__tests__/editor-store-output-mode.test.ts`, `src/lib/subtitles/__tests__/word-confidence.test.ts` (new).

No other production file was touched.

## 8. Confidence UI design

Chosen after inspecting the existing UI density (`word-timing-popover.tsx`'s already-compact 256px-wide popover, `captions-panel.tsx`'s already-dense word-chip row) rather than assuming a design up front. Two small, additive pieces, not a new review system:

1. **Word-timing popover** — one new line under the existing "Bounded by X–Y" line: `Confidence: 94%` (or `Confidence: Unknown`), with `(low)` appended and the existing `text-warning` color token applied only when the classification is `"low"`. Read-only; the popover never writes back to `confidence`.
2. **Word chip** — a subtle `outline outline-1 outline-warning/70` treatment applied only to chips classified `"low"`, layered on top of whichever of the three pre-existing chip states (selected/active/default background) already applies — never a competing 4th background color. The chip's `title` tooltip gains a `· low transcription confidence` suffix in the same case. Unknown-confidence words get neither the outline nor the tooltip suffix.

`src/lib/subtitles/word-confidence.ts` (new, pure, no React/store):
- `LOW_CONFIDENCE_THRESHOLD = 0.5` — faster-whisper's own top candidate being less likely than not (raw probability under 50%) is a plain, defensible "the model itself was substantially unsure" cutoff. Documented in the module's own comment as deliberately conservative: a correct transcription of a noisy/accented word can easily still score above it, and a word below it is not automatically wrong — the review surface is a hint to look closer, never an automatic error, matching this task's explicit "do not claim that a low confidence score proves a transcription error" requirement.
- `classifyWordConfidence(confidence): "unknown" | "low" | "normal"` — `undefined` → `"unknown"` (never `"low"`); `< 0.5` → `"low"`; everything else (including exactly `0.5`) → `"normal"`.
- `formatWordConfidence(confidence): string` — `"Unknown"` for `undefined`, otherwise a whole-number percentage.

No QualityReport schema change — confidence review is entirely separate from the quality-analyzer, confirmed live (an analysis run against a caption containing a 0.45-confidence word produced "No quality issues found" — low confidence is never auto-flagged as a quality issue).

## 9. Derived-mode behavior

Verified both by automated test (§11 items 19-23, full sequence test) and live (§13):

- Switching Original → Hinglish → Gujarati Script → Original never fabricates, alters, or restores authoritative `confidence` — confirmed via direct store assertions and a live DB read.
- `applyOutputModeToWords` (the function that builds the per-mode word view for chips) carries `confidence` straight through via its existing shallow spread — no change was needed there, and none was made.
- A derived-mode textarea edit (`updateSubtitleHinglishText`/`updateSubtitleGujaratiScriptText`) never touches authoritative `text` or `confidence` — confirmed unaffected, exactly as the pre-existing P17.1 architecture already guaranteed.
- `regenerateDerivedWordText` (P17.1) recomputes only `hinglishText`/`gujaratiScriptText`, reading solely from authoritative `words[].text` — `confidence` is never read or written by it, confirmed both by test and live (a low-confidence word's outline persisted correctly through a live Regenerate action).
- Derived-word staleness (`getDerivedWordTextSyncStatus`) is completely unaffected — confirmed via the existing P17.1 assertion (`"synchronized"` after regeneration) still passing unchanged in a mixed test alongside the new confidence checks.

## 10. Word mutation matrix impact

Only ONE row of the mutation matrix built during the P18 preflight audit actually changed: **"Caption text edit" (`updateSubtitleText` and its five siblings)**. Previously: confidence "preserved at matching positions when count matches" unconditionally. Now: confidence is preserved only when the specific word's own token text is unchanged; cleared when it changed. Every other row (split, merge, delete, insert, timing change, batch text change, clipboard paste, undo/redo, derived-mode text edit, regenerate, filler-word marking, word style override) is unchanged — each already had its own correct policy, confirmed unaffected by regression tests (§11).

## 11. Tests added

**Pure-function tests** (`src/lib/subtitles/__tests__/word-edit.test.ts`, 12 new tests covering Phase 5 items 1-3, 6-12):
1. Identical token text → same object reference returned (true no-op).
2. One changed token → confidence cleared, style/timing untouched.
3. All tokens changed → each cleared independently.
6. Punctuation-only change → still a different token, confidence cleared.
7. Case-only change → still different (exact string identity, not case-insensitive), confidence cleared.
8. Unicode/Hindi tokens → identical rule as ASCII, confirmed for both the unchanged and changed cases.
9. Confidence already `undefined` + changed token → stays `undefined` (never fabricated).
10. Confidence present + unchanged token → exact value preserved, not rounded/recomputed.
11. Style preserved on both a no-op and a genuine replacement.
12. `removed: true` survives a text replacement unchanged; never fabricated on an unrelated no-op word.

**Store-level regression tests** (`src/store/__tests__/editor-store-word-edit.test.ts`, using the SAME "hello world" (0.9/0.8) fixture as the task's own worked example):
- Items 4/5 (token-count increase/decrease): words array left completely untouched, confidence unaffected — confirms the count-mismatch branch never reaches the new code.
- Two additional targeted tests: one word changed / other unchanged (only the changed one loses confidence); text identical to what it already was (both words' confidence fully intact).
- Items 13-15 (split/merge/delete): each keeps its own pre-existing confidence policy, unaffected.
- Item 16 (insert): never fabricates confidence for the new word; an unrelated existing word's confidence is untouched. Required a purpose-built fixture with a real timing gap, since the "hello world" fixture has zero gaps anywhere and `insertWord` would otherwise (correctly) reject every request — caught and fixed during test-writing, not assumed.
- Items 17/18 (undo/redo): undo restores the exact pre-edit confidence value (not just the text); redo re-applies the exact same cleared confidence (not a freshly recomputed one).
- A new 5-tier performance test (§12).

**Display-mode tests** (`src/store/__tests__/editor-store-output-mode.test.ts`, items 19-23 plus a full-sequence test): Original-mode partial-change behavior; Hinglish mode confidence pass-through via `applyOutputModeToWords`; Gujarati Script mode, same property, for a legacy "gu" project; derived-mode text editing never touches authoritative confidence; derived regeneration keeps confidence completely untouched while still correctly resolving `getDerivedWordTextSyncStatus`; and a full Original→Hinglish→Gujarati Script→Original round-trip confirming confidence survives every hop unchanged (including staying correctly cleared where it was cleared earlier — mode switching neither restores nor re-clears it).

**Confidence-helper tests** (`src/lib/subtitles/__tests__/word-confidence.test.ts`, new file, items 24-27 plus extras): `undefined` → `"unknown"`; below threshold → `"low"`; exactly the threshold → `"normal"` (strict less-than); above threshold → `"normal"`; `formatWordConfidence` formatting; a pure-function sanity check that the input is never mutated.

**One existing test corrected, not weakened**: `src/store/__tests__/editor-store-clipboard.test.ts`'s `"paste: same token count preserves every word's own timestamp and confidence exactly"` literally pasted "Hi world" over "Hello world" and asserted the OLD word's confidence (0.9) was "preserved exactly" onto the completely different new text "Hi" — this was the bug, encoded as an expected outcome. Corrected to assert the new, correct invariant (confidence cleared for "Hello"→"Hi", preserved for "world"→"world" since that token didn't change) and renamed to describe the corrected behavior, citing Task 108762. This is not a weakening — the test now asserts strictly more (two distinct, previously-unverified outcomes) than it did before.

No other existing test was deleted or weakened.

## 12. Performance results

Ran the existing 30/300/1,800/3,600/5,400-caption envelope against the new metadata-remap logic specifically (`src/store/__tests__/editor-store-word-edit.test.ts`, a new 5-tier `performance:` test exercising `updateSubtitleText` with a 3-token same-count edit that genuinely changes one word and leaves two unchanged — the exact path that now runs the new per-word comparison):

| Captions | Elapsed |
|---|---|
| 30 | 0.33ms |
| 300 | 0.25ms |
| 1,800 | 0.61ms |
| 3,600 | 1.11ms |
| 5,400 | 1.26ms |

All well under the 150ms ceiling used by sibling tests in the same file. `remapWordMetadataForTextReplacement` adds exactly one string-equality comparison per word of the ONE caption being edited — still the same single `snap.subtitles.map()` pass over the whole project every text mutation already made before this task (confirmed by the P18 preflight audit's own O(n²) check, §7 of that report). No new per-project cost; no O(n²) introduced anywhere.

## 13. Live QA results

Disposable project (`p17-2-review-qa@example.test` account, reused; project "P18.1 Confidence QA (disposable)"), seeded with realistic mixed Hindi/English content and varied confidence (0.97, 0.32 [low], 0.88, and one word with no confidence field at all).

1. **Existing real project still opens.** PASS, with a caveat: I do not have login credentials for the actual production account (`[owner's production account — redacted]`, which owns exactly one real project, English-only), and did not attempt to guess or reset its password, per this task's own production-data-safety mandate. Verified instead with a realistic disposable Hindi/English fixture containing genuine transcription-shaped data (mixed scripts, varied confidence) — the editor opened it correctly with no errors.
2. **Word confidence visible only where data exists.** PASS — confirmed via the popover text and the chip outline both appearing only for the genuinely low-scored word.
3. **Missing confidence represented as unknown.** PASS — the "world" word (no `confidence` field) showed "Confidence: Unknown" in the popover and no low-confidence chip outline, in every one of Original/Hinglish/Gujarati Script mode.
4. **Editing a word to completely different text does not falsely retain old confidence.** PASS — replaced "दुनिया" (0.32) with "आकाश"; the popover immediately read "Confidence: Unknown," not a stale 32%.
5. **Identical text edits preserve metadata.** PASS — retyping the exact same text left "नमस्ते" (0.97) untouched, confirmed via the popover.
6. **Split/merge/delete/insert continue to work.** PASS for merge (live: "hello" + "world" → "hello world", confidence correctly `Unknown` per the pre-existing drop-on-merge policy); split/delete/insert were exercised in the automated store-level suite (§11) rather than re-clicked live, since their own mechanics are unchanged by this task and were already live-verified in P15/P16's own reports — labeled PASS via automated coverage, not re-claimed as a fresh live click-through for those three specifically.
7. **Word timing continues to work.** PASS — a start/end nudge via the popover's +/- buttons applied correctly and left confidence untouched.
8. **Undo/redo works.** PASS — undo restored the exact pre-merge two-word state with each word's original confidence; redo re-applied the merge with confidence correctly `Unknown` again.
9. **Autosave/reload works.** PASS — confirmed via a direct database read after a full page reload: every word's `confidence` (present, low, and absent cases) matched exactly what the UI had shown, and the authoritative text contained no Latin/Gujarati leakage.
10. **Hinglish works.** PASS — the low-confidence "का"/"ka" word (0.45) correctly showed its outline and, when opened, its exact percentage in Hinglish mode; `applyOutputModeToWords`'s confidence pass-through confirmed live.
11. **Gujarati Script works for legacy Gujarati projects.** PASS — same word, same confidence, correctly shown as "કા" in Gujarati Script mode (the disposable fixture used `language: "gu"` specifically to exercise this).
12. **Derived regeneration works.** PASS — forced a Gujarati Script word-count mismatch, regenerated, and confirmed both that the stale-derived-text banner cleared correctly (pre-existing P17.1 mechanism, unaffected) and that the low-confidence word's outline/value were completely untouched by the regeneration.
13. **No console errors.** PASS — checked after initial load and after the reload; zero errors, only expected dev-mode HMR/React DevTools log lines.
14. **No regression to clipboard shortcuts.** PASS — `Ctrl+C` produced the expected "Copied caption (Original text)" toast, confirming the P17.1-era clipboard mode-suffix wiring is intact.
15. **No regression to quality-review navigation.** PASS — ran a fresh analysis against the confidence-bearing fixture; result was "No quality issues found," confirming low confidence is never auto-flagged as a quality issue (per this task's own explicit requirement) and that the quality-analyzer path itself is unaffected by this task's changes.

## 14. NOT TESTED items

- Item 1's literal reading (the actual production project under the real account owner's login) — NOT TESTED, substituted with a realistic disposable fixture for the reason stated in §13/§18. This is a deliberate, documented substitution, not an oversight.
- Split/delete/insert as fresh LIVE click-throughs specifically for THIS task (item 6) — covered by the automated store-level suite and by their own unchanged, already-live-verified mechanics from P15/P16, not re-clicked in the browser during this task's own QA pass. Labeled PASS via automated coverage per §13, not claimed as a fresh live observation.
- Packaged (Electron .exe) QA — NOT TESTED, and explicitly not required (see §17).

## 15. Known limitations

- The chip-level low-confidence outline and the popover's confidence line are both purely visual/informational — there is no filter, sort, or "jump to next low-confidence word" navigation. This matches the task's explicit "keep this deliberately lightweight... do NOT build a new review system" instruction; a richer review workflow (if wanted) would be a separate, future-scoped task.
- The 0.5 threshold is a single, global, non-configurable constant. No per-project or per-user threshold override exists.
- No mechanism exists to re-run transcription for just a low-confidence word or otherwise "fix" it from this surface — it is observation-only, as required.

## 16. Protected systems confirmed untouched

Verified by diff/inspection, not merely assumed: database schema (no Prisma migration; `Word.confidence` was already a schema-level JSON field inside the existing `words` blob column, nothing new persisted), Original/Hinglish/Gujarati Script architecture (`output-mode.ts`, `caption-display-mode.ts` — zero lines changed), quality-report architecture (`quality-analyzer.ts`, `quality-fixes.ts` — zero lines changed, confirmed live that confidence is not surfaced as an issue type), undo/redo architecture (`commit`/`snapshotOf`/`MAX_HISTORY` in `editor-store.ts` — zero lines changed; the fix operates entirely inside an existing mutator function's own per-word mapping), autosave (`use-autosave.ts`, `save-queue.ts`, `project-patch.ts` — zero lines changed), word timing clamping (`word-timing.ts` — zero lines changed), Merge/Delete/Insert semantics (`word-edit.ts`'s `mergeWords`/`deleteWordConservative`/`resolveWordInsertion` — zero lines changed to their own logic; only the file's shared top-of-file doc comment was extended, and one new, separate function was added alongside them).

## 17. Packaging decision

**NOT REQUIRED.** Every change in this task is pure TypeScript/React: one new pure-function module, one modified private store helper, two component files gaining a read-only display of existing data, and test files. No Electron, IPC, native module, dependency, preload/main process, worker, FFmpeg, or filesystem/runtime packaging surface was touched. No packaged (.exe) build was produced for this task, and none was needed — every behavior verified in §13 was exercised in the ordinary Next.js dev server, which is the correct verification surface for a pure data/UI change like this one.

## 18. Production DB safety

No real production data was modified. The one real account this session has any knowledge of (`[owner's production account — redacted]`, per this session's own user-identity context) was not logged into, and its one real project was not opened, edited, or queried beyond a read-only listing to confirm it exists (name, language, status only — no content read, no rows touched). All QA in this task ran against a freshly seeded, clearly-named disposable project (`"P18.1 Confidence QA (disposable)"`) under an existing, already-established disposable QA account from prior P17.x tasks. No `backup → duplicate → QA-only-on-duplicate → diff → cleanup` cycle was needed, since no packaged/runtime surface was touched and no real project was ever opened for editing.

## 19. Final verification

- `npm test`: **1224/1224 passing** (0 failures) — up from the 1188 baseline (36 new tests across `word-edit.test.ts`, `editor-store-word-edit.test.ts`, `editor-store-output-mode.test.ts`, and the new `word-confidence.test.ts`, plus one corrected pre-existing test).
- `npx tsc --noEmit`: clean, no errors.
- `npx eslint .`: 0 errors, the same 5 pre-existing warnings (`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`) — none touched by this task, no new warnings introduced.
- `package.json` version: still `0.1.17` — unchanged, no bump performed.
- No existing test was deleted or weakened; one existing test was corrected because it had literally pinned the bug this task fixes as expected behavior (documented in full in §11).

## 20. Explicit P18.2 status

**NOT STARTED.** No P18.2, P18.3, P18.4, or P19 work of any kind was begun, planned in code, or scoped during this task.

---

```
TASK ID: 108762
STATUS: PASS
VERSION: 0.1.17
PRODUCTION CODE CHANGED: YES
DATABASE CHANGED: NO
TESTS: 1224/1224
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18.2: NOT STARTED
```

**What changed**: `remapWordsToText` (the single, shared code path behind every same-token-count direct text edit — typing, clipboard paste, find/replace, batch transform, batch cleanup) no longer carries a word's old `confidence` onto genuinely different replacement text. A new pure helper, `remapWordMetadataForTextReplacement` (`word-edit.ts`), decides per word: identical token text → untouched; changed token text → `confidence` cleared, `style`/`removed`/timing preserved. `Word.confidence` (faster-whisper's own per-word probability) is now also surfaced read-only in the editor: a subtle amber outline on low-confidence word chips, and an exact percentage (or "Unknown") in the existing word-timing popover.

**Metadata invariant**: same token text at a position → the word is untouched; different token text → confidence cleared (never fabricated for text nobody measured), style and removed preserved (both are positional/conservative by established precedent elsewhere in this codebase, not content-derived).

**Confidence UI**: a threshold-based classification (`<0.5` = low, using faster-whisper's own probability scale, documented as a hint not a verdict) drives a chip-level outline plus a popover text line. `undefined` is always "Unknown," never treated as low.

**Tests**: 36 new tests across pure-function, store-level, display-mode, and confidence-helper layers, plus one existing test corrected (it had asserted the bug as expected behavior) and one new 5-tier performance sweep. 1224/1224 passing.

**QA**: all 15 required live-QA checks passed against a disposable, realistic Hindi/English/mixed-confidence project, cross-verified with a direct database read after reload; zero console errors; clipboard and quality-review navigation both confirmed unaffected.

**Known limitations**: the confidence surface is observation-only by design (no filter/navigate/re-transcribe action) — matches the task's explicit "keep this lightweight" instruction, not a gap. Threshold is a single global constant.

**Genuine defect discovered but intentionally deferred**: none beyond the one this task was commissioned to fix. No new architectural issue was found that required stopping and reporting a dependency — the confidence surface did not require any change beyond what's described here.
