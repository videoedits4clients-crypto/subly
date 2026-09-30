# P17.1 — Derived Word State, Safe Merge/Delete & Staleness

Legend used throughout, per this task's own explicit instruction: **PASS** = actually exercised and
directly observed working this session. **NOT TESTED** = not exercised. **EXPECTED** = a reasoned
expectation (unchanged code, or covered only by automated tests, not live QA). **KNOWN LIMITATION**
= a pre-existing constraint, not something this task introduced. **DEFERRED** = a capability this
task deliberately did not implement, with the reason recorded.

## 1. Task ID

Task 106284 (P17.1) — the narrow follow-up P17 (Task 105631) identified around derived per-word
state: safe derived-field preservation on Merge, whether Delete is safe in a derived mode, explicit
detection of derived-text staleness, a safe way to regenerate it, and a small clipboard-mode
clarification. Per this task's own explicit scope: no editor redesign, no translation/alignment AI,
no new synchronization architecture, Split/Insert stay Original-only, no version bump, no
packaging unless a packaging-specific defect was found (none was). P18 was not started.

## 2. P17 baseline

Entering this task: Task 105631 (P17) was "development PASS" — the explicit Original/Hinglish/
Gujarati Script display-mode contract shipped, word chips and timing editable in all three modes,
Split/Merge/Delete/Insert restricted to Original mode (deliberately conservative — P17's own report
recorded Merge/Delete as "follow-up candidates, not structurally unsafe," and Split/Insert as
structurally unsafe permanently), a real derived-text corruption bug already fixed
(`remapHinglishWordsToText`/`remapGujaratiScriptWordsToText` no longer fabricate `Word.text` on a
word-count-changing derived edit), 1081/1081 tests passing, clean typecheck/lint, live Dev QA across
all three modes. Version remained 0.1.17.

## 3. Audit findings

Re-read `research/p17_caption_display_modes_report.md` in full, then re-inspected the exact current
state of `mergeWords`/`deleteWordConservative` (word-edit.ts), `updateSubtitleHinglishText`/
`updateSubtitleGujaratiScriptText`/`remapHinglishWordsToText`/`remapGujaratiScriptWordsToText`
(editor-store.ts), `applyOutputModeToWords`/`generateHinglishForSubtitle`/
`generateGujaratiScriptForSubtitle` (output-mode.ts), `isWordTimingStale` (word-timing.ts), and
`ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` (editor-store.ts) — all exactly as P17 left
them, confirmed unchanged since. Answers to Phase 0's six specific questions:

1. **What exactly becomes stale after a derived word-count change?** The caption's own cached
   whole-caption derived text (`sub.hinglishText`/`sub.gujaratiScriptText`) reflects the user's new
   edit, but `sub.words` — deliberately left untouched by the P17 fix — still holds the OLD per-word
   derived-text breakdown. The two no longer reconstruct each other.
2. **Can that staleness be represented without modifying the database schema?** Yes — purely
   derived, by comparing token counts, exactly the same shape `isWordTimingStale` already uses for
   the analogous original-text case. No new field, no migration.
3. **Can derived per-word text be regenerated deterministically from the authoritative Original
   words?** Yes — `transliterateWord`/`devanagariToGujaratiScript` are both pure, deterministic,
   per-word functions already used by `generateHinglishForSubtitle`/
   `generateGujaratiScriptForSubtitle` (P7-era code, unchanged) — the only gap was that those two
   functions only fill GAPS (`?? `), never force-overwrite an already-present (but stale) value.
4. **Can Merge preserve both derived fields without fabricating anything?** Yes, conditionally: when
   BOTH source words already have a real value for a given derived field, joining them by space is
   the identical operation `.text` itself already gets — not fabrication. When either is missing,
   the field must stay `undefined` (matches "never invent a derived value" exactly).
5. **Can Delete safely operate in a derived display mode?** Yes, unconditionally: `deleteWordConservative`
   never creates or reads text content at all (only removes a whole word and lets a neighbor absorb
   its timing gap), and operates purely by INDEX — which the already-proven 1:1 word-count/order
   mapping of the derived transforms (P17's own audit) makes exactly as safe as the timeline's own
   already-shipped word-timing-drag behavior.
6. **What should happen to the authoritative Original transcript after each operation?** Exactly what
   already happens in Original mode, unconditionally — Merge and Delete's underlying store actions
   have no notion of `captionOutputMode` at all (confirmed by re-reading `mergeWordWithNext`/
   `deleteWord`, editor-store.ts) and always mutate the REAL `words[].text`/timestamps regardless of
   what's currently displayed.

## 4. Merge safety decision

**Enabled in every mode.** `mergeWords` (lib/subtitles/word-edit.ts) now preserves
`hinglishText`/`gujaratiScriptText` by the same join-by-space rule as `.text`, independently per
field, ONLY when both source words already have a real value — otherwise the field is left
`undefined`, exactly the pre-P17.1 behavior. `caption-display-mode.ts`'s own capability table:
`wordMergeAllowed: true` for `hinglish`/`gujarati-script` (was `false`). The underlying store action
(`mergeWordWithNext`) was not modified — it already always operated on the real, authoritative
words; only `mergeWords`'s own derived-field handling changed.

## 5. Delete safety decision

**Enabled in every mode.** No pure-function change was needed — `deleteWordConservative` was already
provably safe by construction (never creates text, index-based). `caption-display-mode.ts`:
`wordDeleteAllowed: true` for `hinglish`/`gujarati-script` (was `false`). The word-timing popover
now shows a short clarification whenever Merge/Delete are visible in a derived mode: "Merge and
delete affect the Original transcript's own word, not just what's displayed here." — no confirmation
dialog was added (matches this task's own explicit "do not add one unless existing UX patterns
require it"; no existing word-editing action in this app uses one).

## 6. Derived staleness model

New pure type + two functions in `lib/subtitles/output-mode.ts`:

- **`DerivedWordTextSyncStatus`** — `"synchronized" | "pending-generation" | "word-count-mismatch"`.
  `getDerivedWordTextSyncStatus(sub, mode)` computes it by comparing the per-word derived-text token
  SUM against the caption-level cached derived text's own token count (the exact same
  token-count-comparison shape `isWordTimingStale` already uses — deliberately not a new concept).
  `"pending-generation"` (caption-level field is `undefined`) is explicitly NOT surfaced as stale —
  it resolves itself automatically the moment the project switches into that mode
  (`ensureHinglishCoverage`/`ensureGujaratiScriptCoverage`). Only `"word-count-mismatch"` is
  actionable.
- **`isDerivedWordTextStale(sub, mode)`** — the simple boolean gate this task's own brief suggested
  by name, `true` only for `"word-count-mismatch"`.

Kept entirely separate from `isWordTimingStale` (word-timing.ts) — never combined into one flag,
never one banner. captions-panel.tsx renders them as two independent, simultaneously-visible
conditions (confirmed live in Dev QA, §12, where BOTH banners were showing at once on a caption that
happened to be stale in both senses, and clicking the NEW banner's own action cleared both — a real,
unplanned, informative coincidence: the underlying `stale` computation for the ordinary banner
happened to also be sensitive to the displayed-text/displayed-words mismatch in that specific case,
which is consistent, not a conflation — see §12 for the exact walkthrough).

## 7. Regeneration decision

**Implemented**, reading ONLY the authoritative `words[].text` — never the stale/mismatched derived
text itself. Two new pure functions in output-mode.ts: `regenerateHinglishForSubtitle(sub)` /
`regenerateGujaratiScriptForSubtitle(sub)` — the same transliteration/script-conversion
`generateHinglishForSubtitle`/`generateGujaratiScriptForSubtitle` already use, but forced to
overwrite EVERY word's own derived field (not just fill `undefined` gaps), then rebuild the
caption-level cached text fresh from the now-correct per-word values. `text`/`start`/`end`/
`confidence`/`style`/`removed` are completely untouched — only the one requested derived field
changes, confirmed by dedicated tests (§9) and live (§12).

New store action `regenerateDerivedWordText(subtitleId, mode)` (editor-store.ts): computes
feasibility (`isDerivedWordTextStale`) BEFORE any commit — returns `false`, no commit, when the
caption isn't actually stale (no pointless undo entry), matching every other reject-without-mutating
action in this file. One commit = one undo step when it does regenerate. Wired to a new "Regenerate"
button in captions-panel.tsx, shown only alongside the new derived-staleness banner (never the
ordinary word-timing-stale one).

## 8. Clipboard UX decision

**Small toast-wording clarification, no semantics change.** A new `clipboardModeSuffix(mode)` helper
in `hooks/use-keyboard-shortcuts.ts` appends `" (Original text)"` to the existing Copy/Cut/Paste
success toasts whenever `captionOutputMode !== "original"` — nothing else changed.
`buildCaptionClipboard`/`applyTextMap`/`updateSubtitleText` (the actual clipboard read/write paths)
were not touched at all; Copy/Cut/Paste already operated on the authoritative `text` unconditionally
before this task, and still do. Confirmed live (§12): "Copied caption (Original text)" in Hinglish
mode, plain "Copied caption" in Original mode.

## 9. Implemented changes

- `src/lib/subtitles/word-edit.ts` — `mergeWords` preserves `hinglishText`/`gujaratiScriptText`
  symmetrically when both sides have them (§4); module-level metadata-policy doc comment updated to
  describe Split vs. Merge separately now that they differ.
- `src/lib/subtitles/output-mode.ts` — `DerivedCaptionOutputMode` type,
  `getDerivedWordTextSyncStatus`, `isDerivedWordTextStale`, `regenerateHinglishForSubtitle`,
  `regenerateGujaratiScriptForSubtitle` (§6/§7).
- `src/lib/subtitles/caption-display-mode.ts` — `wordMergeAllowed`/`wordDeleteAllowed` now `true`
  for Hinglish/Gujarati Script; doc comments rewritten to describe the P17.1 reasoning per
  capability; new `isWordStructuralCreationAllowed`/`wordStructuralCreationUnavailableReason` (Split
  + Insert specifically) and `derivedWordEditAffectsOriginalNotice` (Merge/Delete's own
  clarification) helpers; the now-redundant `wordTextMutationUnavailableReason` (dead — no
  remaining caller, confirmed by search) was removed rather than kept as unused code.
- `src/store/editor-store.ts` — new `regenerateDerivedWordText` store action (§7). No change to
  `mergeWordWithNext`/`deleteWord` themselves — both already operated mode-independently.
- `src/components/editor/captions-panel.tsx` — word chips/timing/popover props now thread
  `displayMode` (a `CaptionOutputMode`) instead of a single precomputed boolean, so each downstream
  component derives its own per-operation capability row; new, SEPARATE derived-staleness banner +
  "Regenerate" button, independent of the existing word-timing-stale banner (§6).
- `src/components/editor/word-timing-popover.tsx` — Split/Merge/Delete are now three INDEPENDENTLY
  gated buttons in the same row (previously all-or-nothing); two separate notice lines
  (`wordStructuralCreationUnavailableReason`, `derivedWordEditAffectsOriginalNotice`) replace the
  old single combined message.
- `src/hooks/use-keyboard-shortcuts.ts` — `clipboardModeSuffix` helper, applied to all three
  Copy/Cut/Paste success toasts (§8).

## 10. Deliberately deferred changes

- **Split, Insert** — remain Original-only, permanently, per this task's own explicit Hard Rule and
  the structural reasoning in §3/P17's own report: no deterministic, non-fabricated way to create
  new `Word.text` content from derived-script input. Not revisited this session.
- **A rebuild-per-word-timing-style auto-fix for `"pending-generation"`** — not needed; it already
  resolves itself automatically via the existing `ensureHinglishCoverage`/
  `ensureGujaratiScriptCoverage` lazy-fill, confirmed by §6's own status breakdown.
- **A confirmation dialog before Merge/Delete in a derived mode** — considered, not added; matches
  this task's own explicit "do not add one unless existing UX patterns require it," and no other
  word-editing action in this app uses one.
- **Changing what Copy/Cut/Paste actually copy** based on mode — explicitly forbidden by this task's
  own Hard Rules ("do not make clipboard behavior mode-dependent"); not done.

## 11. Tests

- **`src/lib/subtitles/__tests__/word-edit.test.ts`** — 1 existing test's title/comment corrected for
  accuracy (it was testing the "missing on one side" case, which is still `undefined` under the new
  rule — no behavior change to that specific test) + 9 new tests: both-present (Hinglish, Gujarati
  Script), first-missing, second-missing, both-missing, the two fields decided completely
  independently, and a combined test proving confidence/style/removed/timestamp policy is
  unaffected by the new derived-field preservation.
- **`src/lib/subtitles/__tests__/output-mode-policy.test.ts`** — 12 new tests: `getDerivedWordTextSyncStatus`'s
  three outcomes (including the exact P17-residue reproduction), independence between Hinglish and
  Gujarati Script status, a multi-token merged word counted by its own token sum (not 1-per-word),
  `isDerivedWordTextStale`'s boolean gate, both regenerate functions resolving a mismatch back to
  `"synchronized"` while reading only the authoritative text, full field preservation, overwrite
  (not just gap-fill) behavior, determinism, and safety when called on an already-synchronized
  caption.
- **`src/lib/subtitles/__tests__/caption-display-mode.test.ts`** — rewritten for the new,
  non-symmetric table: Merge/Delete available in every mode, Split/Insert Original-only,
  `isWordTextMutationAllowed` now true everywhere, new `isWordStructuralCreationAllowed`/
  `wordStructuralCreationUnavailableReason`/`derivedWordEditAffectsOriginalNotice` tests.
- **`src/store/__tests__/editor-store-output-mode.test.ts`** — 9 new correctness tests
  (`mergeWordWithNext` preserving/not-preserving derived fields at the store layer;
  `regenerateDerivedWordText`'s two rejection paths — not-stale and nonexistent-caption, both zero
  commits — its one-commit success path, reading-only-the-authoritative-text proof, undo/redo, the
  Gujarati Script variant, and full non-derived-field preservation) + 5 new performance tests (§12).
- **Full suite**: **1119/1119 passing** (1081 baseline + 38 net new/changed), 0 failing.

## 12. Performance

Run at the full required scale — **30 / 300 / 1,800 / 3,600 / 5,400 captions**, all PASS:

- `regenerateDerivedWordText` on one stale caption inside a project of each size: well under the
  150ms ceiling at every size (proportional to that one caption's own cost, not project size — the
  same `snap.subtitles.map()` cost profile every other single-caption store action already pays, not
  a new cost class).
- The existing `applyOutputModeToWords`/`setCaptionOutputMode` performance tests (unchanged from
  P17) still pass, confirming no regression to the one genuinely project-wide operation
  (`ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` on a mode switch).
- The full existing P15/P16/P17 word-level performance suites all still pass unmodified.

## 13. Dev QA

Live, against the running dev server, reusing the SAME disposable seeded project
(`p17-display-mode-qa@example.test`) from P17's own session — which, as a bonus, had persisted
real leftover state from that prior session's own dev QA (a genuine word-count-mismatch on caption
2's Gujarati Script text), providing an unplanned but perfect live reproduction of the exact bug
this task's staleness/regeneration work targets. All items below **PASS**, directly observed:

1. **Original mode**: word chips, Split/Merge/Insert-before/Insert-after all present and unchanged
   from P17 — no regression.
2. **Hinglish mode**: word chips render correctly (`Namaste`/`duniya`/`aaj`); a word's popover shows
   Start/End timing PLUS both new notice lines — "Split and insert are available in Original mode."
   and "Merge and delete affect the Original transcript's own word, not just what's displayed
   here." — PLUS working Merge/Delete buttons (no Split button).
3. **Gujarati Script mode**: on first load, the caption already showed BOTH the pre-existing
   word-timing-stale banner AND the new "Word-level Gujarati Script text is out of date. Regenerate"
   banner simultaneously — direct, unplanned confirmation the two are independent, never conflated.
4. **Regeneration, live**: clicked "Regenerate" — BOTH banners cleared in one click (explained in
   §6: the ordinary banner's own `stale` computation, fed the display-swapped text/words, was ALSO
   sensitive to this specific mismatch — a coherent, not a conflated, outcome), and word chips
   updated to the correct 3 real words (`નમસ્તે`/`દુનિયા`/`આજ`). Confirmed via network/UI that this
   was a single commit (one "Saved" cycle) reading only from the real original words.
5. **Merge, live, in Hinglish mode**: clicked Merge on "Namaste" — chips became `Namaste duniya` /
   `aaj`; the merged chip's own popover title read "Namaste duniya" (both source words already had
   real hinglishText AND gujaratiScriptText at that point — from the earlier Regenerate step — so
   BOTH derived fields were preserved, confirmed by the caption later showing correctly in BOTH
   modes with no corruption).
6. **Authoritative integrity after Merge**: switched to Original mode — read exactly
   `नमस्ते दुनिया` / `आज` (2 real words, correctly merged, zero corruption, zero Latin/Gujarati-script
   leakage into `Word.text`).
7. **Delete, live, in Gujarati Script mode**: selected the merged caption (now showing
   `નમસ્તે દુનિયા` / `આજ`), clicked Delete on `આજ` — chip row correctly became just
   `નમસ્તે દુનિયા`.
8. **Authoritative integrity after Delete**: switched to Original mode — read exactly
   `नमस्ते दुनिया` (the real Devanagari word removed, matching the derived-mode delete exactly).
9. **Undo/Redo across Merge+Delete**: one Undo correctly restored the deleted `आज` word (`नमस्ते
   दुनिया` / `आज`); Redo correctly re-deleted it (`नमस्ते दुनिया`) — one commit per operation,
   confirmed visually.
10. **Clipboard clarification, both ways**: Ctrl+C on the selected caption while in Hinglish mode
    produced the toast "Copied caption (Original text)"; the same action in Original mode produced
    plain "Copied caption" — confirming the suffix is present ONLY in a derived mode.
11. **Autosave**: the "Saved" indicator was observed after every mutating action throughout this
    entire session (Regenerate, Merge, Delete, Undo, Redo).
12. **Console errors**: none observed at any point.
13. **Original transcript integrity / timing integrity, throughout**: at no point during this
    session did any Latin (Hinglish) or Gujarati-script text ever appear in an Original-mode
    textarea or word chip, and every word's own timestamp (visible via each popover's "Bounded by"
    hint) remained attached to the correct real word across every mode switch and mutation.

**NOT TESTED live this session**: quality-report staleness specifically after a Merge/Delete/
Regenerate action was not re-clicked-through live (covered only by the automated store-level test
carried over from P17, plus the identical, unmodified quality-staleness derivation mechanism this
task did not touch); a literal browser page-refresh reload was not performed (covered by the
store-level `load()` test).

## 14. Regression results

- `npm test`: **1119/1119 passing**, 0 failing.
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint .`: **0 errors**, the same 5 pre-existing warnings from before this task (unrelated
  files, unchanged).
- P16 word insertion: unaffected — `word-edit.test.ts`/`editor-store-word-edit.test.ts` unchanged
  and passing; `insertWord` still gated Original-only (untouched by this task).
- P15 split/merge/delete in Original mode: unaffected — `splitWordText`/`deleteWordConservative`
  themselves were not modified at all; `mergeWords`'s own pre-existing behavior (text-join,
  confidence-drop, style-first, removed-if-either) is completely unchanged, only its DERIVED-field
  handling gained new (additive, never-fabricating) capability.
- P14 clipboard: unaffected — only a toast STRING changed; `buildCaptionClipboard`/
  `resolvePasteMapping`/`applyTextMap` are untouched.
- No test was deleted or weakened; one existing test's title was corrected to accurately describe
  what it was always actually testing (§11).

## 15. Known limitations

- Split and Insert remain permanently Original-only — a structural limitation of the data model
  (§10), not a scope choice that could be revisited later without inventing a translation/alignment
  system this task's Hard Rules explicitly forbid.
- The `"pending-generation"` sync status is exposed for correctness but is not expected to ever be
  visibly reachable through the normal UI flow (mode switches always resolve it synchronously first)
  — documented as a defensive case, not a gap.
- Quality-report staleness after the new Merge/Delete-in-derived-mode/Regenerate actions was proven
  only at the automated-test layer this session, not re-confirmed by manually running "Analyze" and
  clicking through the UI live (time-scoped to the higher-priority safety-correctness checks in
  §13).

## 16. Packaging recommendation

**Not required.** Every change in this task is pure TypeScript/React — a word-edit.ts function
signature addition, three new output-mode.ts functions, one new store action, and UI prop/render
changes in two components plus a toast-string change in a keyboard-shortcut hook. No packaging-
specific surface (no IPC, no Electron main-process change, no new dependency) was touched or
discovered to be broken. Fully exercised and verified in the dev server (§13), matching this
project's own established convention that architecture/UX-only changes don't require a standalone
packaged-QA pass; a future release phase that DOES bump the version should still include this
task's changes in its own packaged-QA sweep, the same way P16.1 closed P16's own gate. Version
remains **0.1.17**, unchanged by this task, per its own explicit "do NOT bump the version" rule.
