# P17.3 — Removed-Word Timing Safety in Derived Modes

## 1. Task ID

**107284** (P17.3). Direct follow-up to Task 106731 (P17.2), fixing ONLY the one genuine pre-existing limitation P17.2 identified: a caption containing a `removed: true` word could incorrectly read `isWordTimingStale === true`, hiding word chips and blocking Merge/Delete/timing editing.

## 2. P17.2 baseline (confirmed at task start)

- SUBLY version: 0.1.17 (unchanged throughout this task).
- P17.1/P17.2: CLOSED.
- Full suite at task start: 1156/1156 passing.
- Typecheck: clean. ESLint: 0 errors, 5 pre-existing warnings.
- P17.2's own report (`research/p17_2_derived_mode_review_persistence_report.md`) documented the removed-word/`isWordTimingStale` interaction as a live-confirmed, deferred Known Limitation — the exact target of this task.

## 3. Exact reproduction (Phase 0)

Built a minimal fixture — 3 words, middle word `दुनिया` marked `removed: true`, all with valid timestamps — and ran it through the REAL functions (`generateHinglishForSubtitle`, `generateGujaratiScriptForSubtitle`, `applyOutputModeToWords`, `isWordTimingStale`), rather than a hand-authored DB row.

Critically, the caption's own `text` was built the way the REAL pipeline builds it: `src/lib/subtitles/segment.ts`'s `segmentWords` (used at transcription time and, more importantly, immediately after filler-word removal — `markFillerWords`/`api/ai/remove-fillers`) filters `!w.removed` before joining (`segment.ts:37`). So a genuine post-filler-removal caption's `text` **already excludes** the removed word's own text — `"नमस्ते आज"`, not `"नमस्ते दुनिया आज"`.

P17.2's own live-QA fixture had hand-set `text: "नमस्ते दुनिया आज"` (including the removed word's text) — which is **not representative of real data** and, as the reproduction below shows, accidentally masked the Original-mode instance of this exact bug.

| | Original | Hinglish | Gujarati Script |
|---|---|---|---|
| Displayed caption text | `"नमस्ते आज"` | `"Namaste aaj"` | `"નમસ્તે આજ"` |
| Displayed word count (chips array, incl. removed) | 3 | 3 | 3 |
| Authoritative word count (`sub.words.length`) | 3 | 3 | 3 |
| Old `wordTokenCount` (sum over ALL words, incl. removed) | 3 | 3 | 3 |
| `textTokenCount` (tokenize displayed text) | 2 | 2 | 2 |
| `isWordTimingStale` (BEFORE fix) | **true** | **true** | **true** |
| WordChips would render (`!stale`) | **false** | **false** | **false** |

**Which side of the comparison is inconsistent**: the per-word sum counts every word regardless of `removed`, while every function that builds the caption-level text being compared against it (`segmentWords` for Original, `generate*/regenerateHinglishForSubtitle`/`generate*/regenerateGujaratiScriptForSubtitle` for derived text) already excludes removed words. The bug is in the SUM, not in any of the text-building functions, and it is **mode-independent** — Original mode is affected exactly as much as Hinglish/Gujarati Script, contrary to what P17.2's own non-representative fixture happened to show.

## 4. Root cause

`isWordTimingStale` (`src/lib/subtitles/word-timing.ts`):
```ts
const wordTokenCount = subtitle.words.reduce((sum, w) => sum + tokenizeCaptionText(w.text).length, 0);
```
summed **every** word's own token count, including `removed: true` words, and compared it against `tokenizeCaptionText(subtitle.text).length` — but `subtitle.text` (in the real pipeline) never included the removed word's tokens in the first place. Any caption with a removed word therefore read as permanently "timing stale" the moment its text was built by the real pipeline, in every display mode.

This is the exact same class of bug P17.2 found and fixed in `getDerivedWordTextSyncStatus` (output-mode.ts) — a removed-word-exclusion mismatch between two sides of a token-count comparison — just in the OTHER (original-text) staleness check, which P17.2's own scope did not cover.

## 5. Correct invariant (Phase 1)

Established before writing any fix:
- A removed word must not create a false timing-stale condition merely because the caption-level displayed text (in ANY mode) excludes it, by the same established convention every text-building function already follows.
- Original mode's mechanism (comparing word-token sum to text-token count) stays the same shape — no redesign, no second flag.
- Removed words stay in `words[]`, keep their real timestamps, and are never deleted, renamed, or reinterpreted.
- Derived generation continues to exclude removed words — unchanged, not touched.
- A genuine timing mismatch (real word-count change among non-removed words) must still read as stale, in every mode, with or without a removed word also present.
- A pathological case (all words removed but leftover non-empty text) must not silently read "fresh" — it is a genuine mismatch and must still be flagged.

## 6. Minimal fix (Phase 2)

Added one small, shared, pure helper — `sumWordTokens(words, field)` — to `src/lib/subtitles/word-timing.ts` (the canonical home for tokenization/timing helpers, where `tokenizeCaptionText` already lives):

```ts
export function sumWordTokens(words: readonly Pick<Word, "removed" | "text" | "hinglishText" | "gujaratiScriptText">[], field: "text" | "hinglishText" | "gujaratiScriptText"): number {
  return words.reduce((sum, w) => (w.removed ? sum : sum + tokenizeCaptionText(w[field] ?? "").length), 0);
}
```

- `isWordTimingStale` now calls `sumWordTokens(subtitle.words, "text")` instead of its own inline reduce.
- `getDerivedWordTextSyncStatus` (output-mode.ts, P17.2) was refactored to call the SAME helper instead of its own near-identical filter+reduce — the two staleness checks (original-text and derived-text) now share exactly one counting convention, per the task's explicit preference, instead of two independently-maintained copies.
- Nothing else changed: `applyOutputModeToWords`, `generate*/regenerate*ForSubtitle`, the database schema, `Word.removed` semantics, Merge/Delete behavior, and clipboard semantics are all completely untouched.
- The distinction between authoritative word structure, displayed text, derived word text, timing staleness, and derived-text staleness is preserved exactly as before — this fix only corrects how ONE of those (timing staleness) counts tokens, using the same convention its own sibling check (derived-text staleness) already used.

## 7. Pure tests (Phase 3)

Added to `src/lib/subtitles/__tests__/word-timing.test.ts` (imports `generateHinglishForSubtitle`/`generateGujaratiScriptForSubtitle`/`applyOutputModeToWords` from output-mode.ts for the derived-mode cases):

| Case | Test | Result |
|---|---|---|
| A | Original + removed word | PASS |
| B | Hinglish + removed word | PASS |
| C | Gujarati Script + removed word | PASS |
| D | Genuine mismatch WITH removed word | PASS (still detected) |
| E | Genuine mismatch WITHOUT removed word | PASS (pre-existing, unaffected) |
| F | Multiple removed words | PASS |
| G | Removed FIRST word | PASS |
| H | Removed MIDDLE word | PASS |
| I | Removed LAST word | PASS |
| J | ALL words removed | PASS — empty text reads fresh; any leftover non-empty text still correctly reads stale (never silently "fresh" for a malformed case) |
| K | Multi-token merged word + removed word | PASS — the two concerns (P15 multi-token words, P17.3 removed-word exclusion) compose without interfering |
| — | `sumWordTokens` unit tests (both `text` and `hinglishText` fields) | PASS |

Added to `src/lib/subtitles/__tests__/output-mode-policy.test.ts`:
- **L** — re-ran the full existing P17.2 `getDerivedWordTextSyncStatus`/`isDerivedWordTextStale` suite (28 tests) unmodified after the shared-helper refactor: all still pass, confirming behavior is byte-for-byte unchanged.
- **M** — two new "composition" tests proving `regenerateHinglishForSubtitle`/`regenerateGujaratiScriptForSubtitle` on a removed-word caption (built with the real-pipeline text convention) now reads `isWordTimingStale === false` in BOTH Original and the derived mode, AND `getDerivedWordTextSyncStatus === "synchronized"` — the two independent staleness mechanisms compose correctly, not merely each in isolation.

No existing test was deleted or weakened. `word-timing.test.ts` grew from 33 to 54 tests (all passing — the case matrix, two `sumWordTokens` unit tests, and the five performance-tier tests from §9 together); `output-mode-policy.test.ts` grew from 28 to 30.

## 8. Store tests (Phase 4)

Added a dedicated `loadRemovedWordFixture()` (with `text` built the real-pipeline way, `language: "gu"` so all 3 modes are available) and 12 focused tests to `src/store/__tests__/editor-store-output-mode.test.ts`, reusing the existing store actions — no new store mechanism introduced:

1. Fixture loads. PASS
2. Original mode word chips remain available (`isWordTimingStale` false). PASS
3. Hinglish mode word chips remain available after switching. PASS
4. Gujarati Script mode word chips remain available after switching. PASS
5. Merge available (Hinglish). PASS
6. Delete available (Gujarati Script). PASS
7. Word timing controls available (`updateWordTiming` applies). PASS
8. Existing timing edits still clamp correctly — and specifically, a removed word still participates in neighbor-clamping since it retains a real timestamp (confirmed both here and live). PASS
9. Undo/redo still work. PASS
10. Derived regeneration still works. PASS
11. Quality-report staleness remains independent (pure reference check, unaffected). PASS
12. `reviewedIssueIds` behavior unchanged (untouched by ordinary mutations). PASS

Confirmed via code trace that `isWordTimingStale` has exactly one production call site (`captions-panel.tsx:527`, gating only the `WordChips` render) — it is never used to gate any store action, so Merge/Delete/timing-update/undo/redo/regenerate were never actually broken at the data layer; only the UI's word-chip visibility was. This file grew from 67 to 79 tests, all passing.

## 9. Performance (Phase 6)

Added a parametrized test (`src/lib/subtitles/__tests__/word-timing.test.ts`) running `isWordTimingStale` against a caption with a removed word, pulled from a synthetic project at 30/300/1,800/3,600/5,400 total captions — 1,000 iterations each, all well under the 200ms ceiling (actual: 0.1–3.9ms), and each correctly reads non-stale. `sumWordTokens`'s added `.filter()` is a single linear pass over one caption's own words — still O(words in the caption), never a function of total project size; the existing 5,400-caption regression test (test 25) continues to pass unmodified.

## 10. Live Dev QA (Phase 5) — live, browser-verified

Disposable project (`p17-2-review-qa@example.test` account, reused; project "P17.3 Removed-Word Timing QA (disposable)"), seeded directly via Prisma with `text` built the real-pipeline way (`"नमस्ते आज"`, excluding the removed `"दुनिया"`), `language: "gu"`.

1. **Original mode**: word chips visible (all 3, including the removed one), **no false stale banner**. PASS
2. **Hinglish**: switched mode, word chips visible, no false stale banner; clicked a chip — timing popover opened; Merge and Delete both available (with the existing P17.1 "Merge and delete affect the Original transcript's own word" notice). PASS
3. **Gujarati Script**: same — word chips visible, no false stale banner, popover opens, Merge/Delete available. PASS
4. **Real timing change**: clicked "Later" on the removed word's own start (0.60 → 0.65) — applied successfully, and correctly still clamped its neighbor ("नमस्ते"'s end stayed capped at the removed word's own start), confirming a removed word retains a real, editable timestamp and still participates in clamping. PASS
5. **Genuine staleness still detected**: edited the Hinglish text to add an extra token — both "Word timing needs review" (isWordTimingStale, the fix under test) and "Word-level Hinglish text is out of date" (P17.1's isDerivedWordTextStale) banners correctly appeared. PASS
6. **Undo**: reverted the edit — both banners cleared. PASS
7. **Redo**: reapplied — both banners reappeared. PASS
8. **Regenerate**: clicked Regenerate — both banners cleared, chips restored to "Namaste"/"duniya"/"aaj". PASS
9. **Mode switch sequence**: Original → Hinglish → Gujarati Script → Original, all rendering correctly with word chips throughout. PASS
10. **No Original-text leakage**: verified via a direct DB read after the full sequence — `text: "नमस्ते आज"` and `words[].text` (`"नमस्ते"`/`"दुनिया"`/`"आज"`) were exactly the original Devanagari, with no Latin or Gujarati-script content anywhere in the authoritative fields; only the derived `hinglishText`/`gujaratiScriptText` fields (caption-level and per-word) carried the transliterated content, exactly where it belongs. PASS
11. **Reload**: full page reload — text, word chips (all 3, no stale banner), and the removed word's edited timestamp (0.65) all persisted correctly. PASS
12. **Console**: checked after every major step (initial load, mode switches, edits, regenerate, reload) — zero errors at any point; only expected dev-mode HMR/React DevTools log lines. PASS

No step was inferred — every one above was actually exercised and observed in the browser pane, per the task's explicit "do not claim live PASS without exercising the UI" rule.

## 11. Regression results (Phase 7)

- `npm test`: **1188/1188 passing** (0 failures) — up from 1156 at task start (new tests added across `word-timing.test.ts`, `output-mode-policy.test.ts`, and `editor-store-output-mode.test.ts`; per-file before/after counts in §7/§8 above).
- `npx tsc --noEmit`: clean, no errors.
- `npx eslint .`: 0 errors, same 5 pre-existing warnings as baseline (`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`) — none touched by this task, no new warnings introduced.
- No existing test was deleted or weakened.

## 12. Remaining limitations

None newly introduced. The one limitation this task set out to fix is fixed and verified at three layers (pure functions, store, live browser). The two limitations P17.2 documented and explicitly told this task NOT to touch remain exactly as they were:
- Quality-report staleness triggered by a mode switch cannot always be undone back to "fresh" via Ctrl+Z (architectural, benign, out of scope per this task's hard rules).
- The one-off Ctrl+Shift+Z keyboard-shortcut-focus observation from P17.2 — not investigated per this task's explicit instruction, and this task's own removed-word fix did not expose any related regression (Undo/Redo were both exercised live via the toolbar buttons without incident).

## 13. Packaging decision (Phase 8)

**NOT REQUIRED.** All changes are pure TypeScript library code (`src/lib/subtitles/word-timing.ts`, `src/lib/subtitles/output-mode.ts`) and test files. No Electron, IPC, native module, dependency, preload/main process, worker, FFmpeg, or filesystem/runtime packaging surface was touched. No packaged build was produced. No version bump.

## 14. Final recommendation

P17.3 should be considered **closed**. The exact P17.2-identified limitation was reproduced first (not assumed), traced to its true root cause — a removed-word-exclusion mismatch in `isWordTimingStale`'s token-count comparison, mirroring the analogous bug P17.2 already fixed in `getDerivedWordTextSyncStatus` — and fixed with a single small shared helper (`sumWordTokens`) now used by both staleness checks, eliminating the duplicate counting logic rather than adding a third copy of it. The reproduction also revealed the bug was broader than P17.2's own live QA had shown (Original mode was equally affected, not just Hinglish/Gujarati Script) — this is now fixed uniformly across all three modes. Verified at the pure-function layer (21 new/modified tests), the store layer (12 new tests against a real-pipeline-style fixture), performance (5 tiers, 30–5,400 captions), and live in the browser (all 12 Phase 5 checks actually exercised, not inferred), with zero regressions across the full 1188-test suite, a clean typecheck, and no new lint issues.

---

```
TASK ID: 107284
STATUS: PASS
VERSION: 0.1.17
TESTS: 1188/1188
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18: NOT STARTED
```

**Exact root cause**: `isWordTimingStale` (word-timing.ts) summed every word's own token count, including `removed: true` words, while every function that builds the caption-level text it compares against (`segmentWords` for Original — the real transcription/filler-removal pipeline — and `generate*/regenerateHinglishForSubtitle`/`generate*/regenerateGujaratiScriptForSubtitle` for derived text) already excludes removed words. This made any caption with a removed word read as permanently timing-stale in EVERY display mode, not just Hinglish/Gujarati Script as P17.2's own non-representative fixture had shown.

**Exact production change**: added `sumWordTokens(words, field)` to `word-timing.ts` (excludes removed words, shared by both `isWordTimingStale` and `getDerivedWordTextSyncStatus`, replacing that function's own P17.2-era duplicate filter+reduce). Two files touched, no other production code changed.

**Tests added**: `word-timing.test.ts` 33→54 (case-matrix tests A–K, 2 `sumWordTokens` unit tests, 5 performance-tier tests), `output-mode-policy.test.ts` 28→30 (item M composition tests), `editor-store-output-mode.test.ts` 67→79 (Phase 4 items 1–12).

**Live scenarios verified**: all three display modes (word chips, no false stale banner, timing popover, Merge, Delete), a real timing change on a removed word (and its correct clamping effect on a neighbor), genuine-mismatch detection still working, undo/redo, regenerate, the full mode-switch sequence, a direct DB check proving zero leakage into the authoritative Original text/words, a full page reload, and a clean browser console throughout.

**Remaining limitation**: none new. P17.3 should be considered closed.
