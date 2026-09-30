# P17 — Professional Caption Display Modes & Derived-Text Editing Safety

Legend used throughout, per this task's own explicit instruction: **PASS** = actually exercised
and directly observed working this session. **NOT TESTED** = not exercised. **EXPECTED** = a
reasoned expectation (unchanged code, or covered only by automated tests, not live QA). **KNOWN
LIMITATION** = a pre-existing constraint, not something this task introduced. **DEFERRED** = a
capability this task deliberately did not implement, with the reason recorded.

## 1. Task ID

Task 105631 (P17) — investigate and safely improve how SUBLY handles Original/Hinglish/Gujarati
Script caption text and word-level editing in relation to it, without corrupting the authoritative
transcript. Per this task's own explicit scope: no new word-editing features, no multi-word
insertion, no word dragging, no database migration, no synchronization model, no editor redesign.
P18 was not started.

## 2. P16/P16.1 baseline

Entering this task: Task 103884 (P16, word insertion + Unicode-grapheme-safe splitting) and Task
104217 (P16.1, its packaged-QA/production-DB-safety closure) were both **CLOSED/PASS**, shipped as
SUBLY 0.1.17. 1046/1046 tests passing, clean typecheck, clean lint, packaged QA and production DB
safety both verified. P16 itself was not reopened, and no P16 functionality was found to regress —
see §13.

## 3. Architecture audit

Read and traced, before writing any code: `types/subtitle.ts`, `store/editor-store.ts` (all
`hinglishText`/`gujaratiScriptText`-touching code, `commit()`, `remapWordsToText` and its two
derived-text analogues, every word/caption mutation action), `components/editor/captions-panel.tsx`
(the old `!isHinglish && !isGujaratiScript` word-chip gate and its own doc comment), `components/
editor/word-timing-popover.tsx`, `components/editor/timeline.tsx` (`TimelineWordHandles`),
`lib/subtitles/output-mode.ts`, `lib/subtitles/hinglish.ts`, `lib/subtitles/gujarati-script.ts`,
`lib/subtitles/caption-clipboard.ts`, `lib/subtitles/quality-analyzer.ts`, `lib/subtitles/
word-timing.ts`, `lib/subtitles/split.ts` (caption-level split/merge), and the existing test files
for every one of those (`hinglish.test.ts`, `gujarati-script*.test.ts`, `output-mode-policy.test.ts`,
`word-edit.test.ts`, `editor-store-word-edit.test.ts`, `editor-store-undo-redo.test.ts`,
`editor-store-clipboard.test.ts`).

Two concrete, pre-existing facts this task's own design leans on heavily (both verified by reading
the actual shipped code, not assumed):

1. **`hinglish.ts`/`gujarati-script.ts` are pure, per-word, 1:1 transforms.** Transliteration and
   script-remapping never change word count or word order, and a derived word always shares its
   original word's own `start`/`end`. `words[i].hinglishText`/`words[i].gujaratiScriptText`
   describes the exact same time span as `words[i].text`, always, for any word that has one.
2. **`timeline.tsx`'s `TimelineWordHandles` already selects, displays, and retimes (drag) the
   selected caption's words in EVERY mode today, completely unconditionally** — no
   `isHinglish`/`isGujaratiScript` gate at all, shipped since Task 92618/102741 (P7.2/P15). It
   works because `updateWordTiming` (editor-store.ts) looks up the real subtitle by id and only
   ever writes `.start`/`.end` by index — it never reads or writes `.text`, so which script is
   currently displayed is irrelevant to whether the mutation is safe. This is proof by existing,
   already-shipped behavior that word selection and timing adjustment are safe in every mode — not
   a new argument invented for this task.

## 4. Authoritative-vs-derived data model — answers to Phase 0's specific questions

1. **What is authoritative?** `Subtitle.text` / `Word.text` — literally documented as "the untouched
   original transcript" in `Word.hinglishText`'s own doc comment (types/subtitle.ts).
2. **When is `hinglishText` generated?** Lazily, per caption, the first time the project's
   `captionOutputMode` is switched to `"hinglish"` (`ensureHinglishCoverage`, called from `load()`
   and every `commit()`) — and again for any caption that doesn't have one yet after ANY commit
   while already in that mode (a caption created by split/duplicate/paste, etc.).
3. **When is `gujaratiScriptText` generated?** Identically, via `ensureGujaratiScriptCoverage`.
4. **Stored per Word, per Subtitle, or both?** Both — a caption-level cached whole-caption string
   AND a per-word value on every `Word`. The per-word value is the one that matters for timing/word
   chips; the caption-level one is what the textarea itself shows and edits.
5. **What invalidates derived text?** Any edit to the caption's own authoritative `text` (direct
   edit, clipboard paste, find/replace, batch transform, text cleanup) explicitly sets
   `hinglishText: undefined, gujaratiScriptText: undefined` on that caption — confirmed present on
   every one of those code paths (`updateSubtitleText`, `applyTextMap`, `findReplace`,
   `applyBatchFindReplace`, `applyBatchTextTransform`, `applyTextCleanup`). Word-level split/merge/
   delete/insert clear only the CAPTION-level cached field (the untouched words keep their own
   per-word derived text; only genuinely new/changed words are missing theirs).
6. **What happens after a text edit?** `text` and `words[].text` update via `remapWordsToText`
   (same word count → per-word text remap, preserving timestamps; different word count → `words`
   left completely untouched, the caption reads as `isWordTimingStale` until the user explicitly
   calls "Rebuild timing" — a pre-existing P7.2 policy, unaffected by this task). Both derived
   fields are cleared, then lazily regenerated by the SAME commit if the project happens to be
   viewing that mode.
7. **After word insertion (P16)?** Caption-level derived fields cleared, then regenerated for
   missing words only; untouched words keep their own derived text. Confirmed unaffected by this
   task — see §13.
8. **After word deletion (P15)?** Same pattern.
9. **After split (word or caption level)?** Same pattern — confirmed by reading `splitWordText`
   (word-edit.ts) and `splitSubtitleAt` (split.ts, which builds two brand-new `Subtitle` objects
   with NO `hinglishText`/`gujaratiScriptText` field at all, and slices the ORIGINAL `words` array
   directly — each half keeps whichever per-word derived text those specific words already had; no
   fabrication, no bug found here).
10. **After merge (word or caption level)?** Same pattern — `mergeWithNext` (caption-level) builds
    a fresh object the same way `splitSubtitleAt` does; `mergeWords` (word-level, P15) merges only
    `.text` and explicitly clears the derived fields on the merged word (a deliberate P15 policy,
    unchanged here — see §7's Merge entry for why this specifically blocks enabling Merge in a
    derived mode today).
11. **After clipboard paste (P14)?** `caption-clipboard.ts`'s `buildCaptionClipboard` always reads
    `s.text` (the real original), and paste always applies through `applyTextMap`/
    `updateSubtitleText` — completely mode-transparent: Copy/Cut/Paste operate on the authoritative
    transcript regardless of what's currently displayed on screen. No bug found; see §6 for the one
    UX-clarity nuance this surfaces.
12. **After batch find/replace?** Same `remapWordsToText` + derived-field-clearing pattern as a
    direct text edit — confirmed identical code path.
13. **After text cleanup (P11)?** Same pattern, plus deletion of now-empty captions in the same
    commit — confirmed unaffected by derived-text concerns.
14. **After reload?** `load()` runs the exact same `ensureHinglishCoverage`/
    `ensureGujaratiScriptCoverage` pass as `commit()` — an already-generated, unmodified caption is
    left byte-for-byte untouched (confirmed by a new test, §10).
15. **What does export use?** `applyOutputMode` (output-mode.ts) — the SAME function the live
    preview and the timeline's own block labels use — REBUILDS the caption's whole-caption text
    from its current `words[].hinglishText`/`.gujaratiScriptText` on every call, rather than
    trusting the cached whole-caption field directly (deliberate, pre-existing, documented in that
    function's own comment: this is what keeps trim/cut remapping from ever desyncing the two).
16. **What does undo/redo restore?** The full subtitle snapshot, including both derived-text
    fields and every word's own fields — confirmed via existing `snapshotOf`/`commit()` machinery,
    unmodified by this task.

## 5. Display-mode contract

New pure module: `src/lib/subtitles/caption-display-mode.ts`. Exports
`CAPTION_DISPLAY_MODE_CAPABILITIES` (a `Record<CaptionOutputMode, CaptionDisplayModeCapabilities>`),
`getCaptionDisplayModeCapabilities`, `isWordTextMutationAllowed`, and
`wordTextMutationUnavailableReason`. Reuses the existing `CaptionOutputMode` type (types/
subtitle.ts) rather than inventing a parallel one. The table, deliberately NOT symmetrical:

| Capability | Original | Hinglish | Gujarati Script |
|---|---|---|---|
| `textSource` | `text` | `hinglishText` | `gujaratiScriptText` |
| `isAuthoritative` | true | false | false |
| `captionTextEditable` | true | true | true |
| `textEditWritesAuthoritativeText` | true | **false** | **false** |
| `wordChipsVisible` | true | **true (NEW)** | **true (NEW)** |
| `wordTimingEditable` | true | **true (NEW)** | **true (NEW)** |
| `wordSplitAllowed` | true | false | false |
| `wordMergeAllowed` | true | false | false |
| `wordDeleteAllowed` | true | false | false |
| `wordInsertAllowed` | true | false | false |

Every `false` cell has its own doc-comment justification in the module itself (not just "disabled
for safety") — see §7 below for the per-operation reasoning summarized.

## 6. Existing bugs/gaps discovered

1. **(Fixed — see §7.) Word-count-changing derived-text edit fabricated `Word.text`.**
   `remapHinglishWordsToText`/`remapGujaratiScriptWordsToText` (editor-store.ts), when a user's
   edit to the Hinglish/Gujarati-Script caption textarea changed the WORD COUNT, used to synthesize
   brand-new `Word` objects whose `.text` field held the just-typed Romanized/Gujarati-script
   content — silently writing derived content into the one field this app treats as "the untouched
   original transcript." No existing test covered this path at all (confirmed by search). This
   directly violated both `Word.hinglishText`'s own doc comment ("editing it never touches text")
   and this task's own explicit safety principle. **Fixed** (§7) and now covered by 4 dedicated
   tests plus a live, end-to-end Dev QA reproduction (§12).
2. **(Not fixed — documented as a pre-existing UX ambiguity, not a bug.)** Clipboard Copy/Cut/Paste
   (P14) always operates on the authoritative `text`, regardless of which mode is currently
   displayed on screen — confirmed correct/safe (§4 item 11), but a user looking at Hinglish text
   and pressing Ctrl+C gets the original Devanagari on their OS clipboard, not what they're reading.
   No functional change was made (clipboard behavior is out of this task's scope and changing it
   would be a P14 functional change, not a display-mode safety fix) — recorded as a §15 follow-up
   candidate for a small, clarifying UI label only.
3. **(Not a bug — a genuine, provable inconsistency, now resolved.)** `captions-panel.tsx`'s own
   word-chip gate was MORE conservative than the timeline's own already-shipped behavior for the
   identical underlying operation (word selection + timing display) — see §3 point 2. This is the
   "known issue" this task's own brief named; §7 resolves it by bringing captions-panel up to the
   same, already-proven bar, not by inventing new justification.

## 7. Changes implemented

- **`src/lib/subtitles/caption-display-mode.ts`** (new) — the capability contract (§5).
- **`src/lib/subtitles/output-mode.ts`** — extracted `applyOutputModeToWords(words, mode)` as the
  per-word half of the existing `applyOutputMode` (pure refactor; `applyOutputMode` now calls it
  internally; its own pre-existing tests still pass unmodified, proving no behavior change — see
  §9's new tests for the extraction itself).
- **`src/store/editor-store.ts`** — fixed `remapHinglishWordsToText`/
  `remapGujaratiScriptWordsToText` (§6 item 1): a word-count-changing edit now leaves `words`
  completely untouched (mirroring `remapWordsToText`'s own pre-existing, established policy for the
  analogous original-text case) instead of fabricating new words. The caption's own whole-caption
  `hinglishText`/`gujaratiScriptText` field still reflects exactly what the user typed either way;
  only the PER-WORD breakdown can lag behind until something else regenerates it (an honest
  staleness — reusing `isWordTimingStale`'s own existing token-count-comparison concept when
  combined with a later original-text edit, not a new mechanism — never a silent corruption).
- **`src/components/editor/captions-panel.tsx`** — word chips are now shown, and word timing is
  editable, in EVERY display mode (`words={isSelected ? applyOutputModeToWords(s.words,
  project.captionOutputMode) : null}` — same word count/order/timestamps as `s.words`, only
  `.text` differs, so every existing index-based callback — `onSelectWord`, `onUpdateWordTiming`,
  `onSplitWord`, etc. — still refers to the exact same real word in the store). The stale-timing
  banner's "Rebuild timing" button is now shown Original-mode-only (it always rebuilds from the
  real original text regardless of what's displayed — offering it in a derived mode would silently
  target different text than what's on screen); a derived mode shows a read-only "switch to
  Original" message instead when stale. New `displayMode`/`wordTextMutationAllowed` props threaded
  down to `CaptionRow` → `WordChips` → `WordTimingPopover`.
- **`src/components/editor/word-timing-popover.tsx`** — new `wordTextMutationAllowed: boolean`
  prop. Start/End timing controls are unaffected (shown/editable in every mode). The Split/Merge/
  Delete row AND the Insert Before/After row are both replaced with one explanatory line when
  `false`: "Word text editing is available in Original mode. Switch to Original to split, merge,
  delete, or insert words." — matching this task's own explicit example wording and its "prefer a
  precise explanation over a lossy transformation" instruction.

## 8. Changes deliberately NOT implemented

- **Word Split in a derived mode** — `wordSplitAllowed: false` for Hinglish/Gujarati Script.
  Splitting decides a NEW token boundary; there is no deterministic, non-fabricated way to map a
  boundary drawn in Romanized or Gujarati-script text back onto where the ORIGINAL Devanagari word
  should split. **DEFERRED indefinitely** — this is a structural limitation of the data model, not
  a scope-boundary choice; it cannot be made safe without inventing a translation/alignment system,
  which this task's own Hard Rules explicitly forbid.
- **Word Insert in a derived mode** — `wordInsertAllowed: false`. Inserting a word requires SOME
  text for its `Word.text`; there is no non-fabricated source for real Devanagari original text
  derived from a newly-typed Hinglish/Gujarati-script word. **DEFERRED indefinitely**, same
  structural reasoning as Split.
- **Word Delete in a derived mode** — `wordDeleteAllowed: false`. Deletion itself never fabricates
  text (only removal + neighbor-absorption of the timing gap), so it is structurally closer to
  "provably safe" than Split/Insert — but no EXISTING shipped precedent (unlike selection/timing,
  which the timeline already proves) covers it, and this task's own bias is "if an operation cannot
  be made safe with the existing data model... KEEP IT DISABLED" combined with "do not turn this
  into a giant editor rewrite." **DEFERRED as a follow-up candidate** (§15), not implemented here.
- **Word Merge in a derived mode** — `wordMergeAllowed: false`. Structurally closer to "just
  concatenate" than Split's "guess a boundary" — but the currently-shipped `mergeWords` (P15) merges
  only `.text` and deliberately clears both derived fields on the result, rather than merging every
  per-word field symmetrically. Enabling Merge here today would silently drop whatever derived text
  the two merged words already had. **DEFERRED as a follow-up candidate** (§15) — extending
  `mergeWords` to merge every field symmetrically is a small, well-scoped future change, but doing
  it inside this already-large task risked exactly the "giant editor rewrite" this task was told to
  avoid.
- **A "rebuild per-word Hinglish/Gujarati-Script timing" action** — considered (to give the §6
  item 1 fix's own "per-word breakdown can lag behind" trade-off a repair mechanism symmetric to
  the existing "Rebuild timing" button), but this would be inventing a NEW synchronization concept
  beyond reusing `isWordTimingStale`'s existing pattern, explicitly forbidden by this task's own
  Hard Rules ("Do not invent a synchronization model"). **Not implemented** — the honest staleness
  is surfaced (a later original-text edit correctly regenerates it — §4 item 6/§10), not hidden or
  auto-fixed.
- **A clarifying clipboard-mode label** (§6 item 2) — considered for Phase 2's UX audit, not
  implemented: this task's own scope explicitly says "prefer the smallest possible clarification...
  do not redesign the editor," and the current behavior (clipboard always operates on the
  authoritative text) is already SAFE, just not maximally obvious — recorded as a §15 follow-up
  rather than adding new UI this session.
- **No database schema change** — none was needed or made.
- **No new modal/panel/settings architecture** — the mode-awareness lives entirely in the existing
  Settings tab's caption-text dropdown (unchanged) and the existing word-timing popover.

## 9. Pure tests

- **`src/lib/subtitles/__tests__/caption-display-mode.test.ts`** (new, 10 tests) — `textSource`/
  `isAuthoritative`/`textEditWritesAuthoritativeText` per mode, word-chip/timing availability in
  every mode, word-text-mutation availability (Original-only), `isWordTextMutationAllowed`,
  `wordTextMutationUnavailableReason` (null for Original, identical non-empty message for both
  derived modes), and table completeness.
- **`src/lib/subtitles/__tests__/output-mode-policy.test.ts`** (6 new tests appended) —
  `applyOutputModeToWords`: Original is a no-op returning the SAME array reference, Hinglish/
  Gujarati-Script swap `.text` without mutating the input, falls back to original text for a word
  with no derived text yet, preserves word count/order/every other field exactly, and produces the
  IDENTICAL per-word result as the full `applyOutputMode` (proving the extraction changed nothing).

## 10. Store tests

**`src/store/__tests__/editor-store-output-mode.test.ts`** (new, 19 tests total including 5
performance tests — see §11):

- Same-word-count `updateSubtitleHinglishText`/`updateSubtitleGujaratiScriptText`: per-word derived
  field updates, `.text`/timestamps/confidence completely untouched.
- **The §6/§7 fix, directly**: a word-count-INCREASING and a word-count-DECREASING derived-text
  edit both leave the `words` array byte-for-byte unchanged — no fabricated Latin/Gujarati-script
  content in any `word.text`.
- One commit (one undo step) even on the word-count-changing path; undo restores the exact original
  hinglishText/words, redo re-applies.
- `updateWordTiming` and `splitWord`/`mergeWordWithNext`/`deleteWord`/`insertWord` all still work
  correctly at the STORE layer regardless of `captionOutputMode` — confirming the P17 safety gating
  lives entirely in the UI (word-timing-popover.tsx), not the data layer, so P16/P15's own store
  actions are provably unaffected (see §13).
- `setCaptionOutputMode("hinglish")` generates hinglishText for every caption missing it, in one
  pass.
- The two-edits-in-sequence case (a word-count-changing Hinglish edit, THEN a word-count-changing
  Original-text edit on top of it): confirms `hinglishText` is regenerated (never left permanently
  `undefined`), confirms `words` is STILL untouched (both remap functions independently follow the
  same "never fabricate on count change" policy), and confirms `isWordTimingStale` correctly flags
  the result — reusing the existing mechanism, not inventing a new one.
- Quality-report staleness after a derived-text edit (existing derivation, no silent re-analysis).
- Reload: a project already in Hinglish mode with pre-generated hinglishText is left byte-for-byte
  untouched by `load()`.

## 11. Performance results

Run at the full required scale — **30 / 300 / 1,800 / 3,600 / 5,400 captions**, all PASS:

- `setCaptionOutputMode("hinglish")` generating `hinglishText` for every caption in the project (the
  one operation in this whole feature that legitimately touches every caption): 1.1ms at 30 →
  27.9ms at 5,400 — well under the 2000ms ceiling, confirmed linear, no O(n²) introduced.
- `applyOutputModeToWords` for one caption's own words, called from within a 5,400-caption project:
  sub-millisecond, confirming captions-panel's per-selected-row word-chip cost is O(that caption's
  own word count) only, never O(project size) — the existing virtualization/per-row-cost
  architecture (only the selected caption computes word-level detail at all) is unchanged.
- The full existing P15/P16 split/merge/delete/insert performance suite (10 tests, same 5 caption
  counts) still passes unmodified, confirming no regression to their own cost profile.

## 12. Dev QA

Live, against the running dev server, using a disposable seeded project
(`p17-display-mode-qa@example.test`) spanning: English (no Devanagari), Hindi/Devanagari with real
per-word confidence values, and a second Hindi caption — project language set to `"gu"` so both
Hinglish and Gujarati Script modes were available. All **PASS**, directly observed:

1. **Original mode**: word chips render; a word's popover shows Start/End timing AND Split/Merge/
   Insert (Merge/Delete disabled per no-next-word/normal guards, not per this task).
2. **Hinglish mode**: switching modes correctly re-rendered the caption list with
   `Namaste`/`duniya`/`aaj` word chips (the exact fix this task exists to ship) and
   `Kal main bahut khush tha` for the third caption. Selecting the "Namaste" chip showed Start/End
   timing controls PLUS the exact explanatory message "Word text editing is available in Original
   mode. Switch to Original to split, merge, delete, or insert words." — no Split/Merge/Delete/
   Insert controls present.
3. **Word timing IS editable in Hinglish mode**: clicked the End "Earlier" nudge on "Namaste" —
   its own chip updated live from `00:02.00 → 00:02.70` to `00:02.00 → 00:02.65`.
4. **Authoritative text integrity, round-tripped**: switched back to Original mode — the caption
   still read exactly `नमस्ते दुनिया आज` (untouched), and the SAME word's timing correctly carried
   the edit through: `00:02.00 → 00:02.65` — proving timing is genuinely shared across modes while
   text is not.
5. **Gujarati Script mode**: word chips correctly showed `નમસ્તે` / `દુનિયા` / `આજ` (real
   Gujarati-block Unicode) — the literal "known issue" this task's brief named, now fixed and
   directly observed working.
6. **The §6/§7 bug fix, live, end-to-end**: edited caption 2's Gujarati-Script textarea, changing
   `નમસ્તે દુનિયા આજ` (3 words) to `નમસ્તે બિલકુલ દુનિયા આજ` (4 words) — a genuine word-count
   change. Switched to Original mode: the caption still read exactly `नमस्ते दुनिया आज`, 3 words,
   completely unmodified — no Gujarati-script content leaked into the authoritative transcript.
7. **Undo/redo across the fix**: one Undo correctly reverted the 4-word Gujarati-Script edit back
   to 3 words (`નમસ્તે દુનિયા આજ`); Redo correctly restored the 4-word version.
8. **Autosave**: the top-bar "Saved" indicator was observed after every edit throughout the session
   (mode switches, timing nudges, the word-count-changing text edit, undo/redo).
9. **Console errors**: none observed at any point during this session's interaction.

**NOT TESTED live this session** (covered only by the automated suite — §9/§10 — and by prior
P15/P16 live verification of the identical, unmodified code paths): playback active-word
highlighting in a derived mode specifically (the seeded QA project had no video to actually play;
the underlying `findActiveWordIndex` logic is purely timing-based and unaffected by which `.text`
field a word displays, so this is EXPECTED to work, not independently confirmed by watching video
play in this session), Split/Merge/Delete/Insert still functioning correctly when the user is back
in Original mode after having viewed a derived mode (covered by the automated suite's §10 tests, not
re-clicked through live this specific session), and reload-via-actual-page-refresh (covered by the
store-level `load()` test in §10, not performed as a literal browser refresh this session).

## 13. Regression results

- `npm test`: **1081/1081 passing** (1046 baseline + 35 new — 10 pure display-mode contract tests,
  6 pure `applyOutputModeToWords` tests, 19 store tests including 6 performance tests), **0
  failing**.
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint .`: **0 errors**, the same 5 pre-existing warnings from before this task (unrelated
  files, unchanged).
- **P16 word insertion**: unaffected — confirmed by the full, unmodified `word-edit.test.ts`/
  `editor-store-word-edit.test.ts` suites still passing, AND by a new test explicitly exercising
  `insertWord` while `captionOutputMode` is `"gujarati-script"` at the store layer (§10).
- **P15 split/merge/delete**: unaffected — same reasoning, plus a new test explicitly exercising all
  three while in `"gujarati-script"` mode.
- **P14 clipboard**: unaffected — `caption-clipboard.ts` and its own test suite were not touched;
  confirmed mode-transparent by re-reading its source (§4 item 11), not modified.
- No test was deleted, skipped, or weakened.

## 14. Known limitations

- Split, Insert, Merge, and Delete remain Original-mode-only — see §8 for the per-operation
  reasoning. Merge and Delete are recorded as plausible, well-scoped follow-up candidates; Split and
  Insert are structural limitations of the data model with no safe path forward short of inventing a
  translation/alignment system (explicitly out of scope).
- A word-count-changing derived-text edit leaves that caption's PER-WORD derived-text breakdown
  (used by `applyOutputMode` for export/preview/timeline labels) out of sync with the whole-caption
  field the user just typed, until something else regenerates it (e.g. a later original-text edit).
  This is an intentional, honest trade-off (§6 item 1/§8) — the alternative was fabricating fake
  original content, which is strictly worse. No new UI surfaces this specific staleness distinctly
  from ordinary word-timing staleness in this task; a future task could extend the stale-banner
  logic to distinguish the two if this proves confusing in practice.
- Clipboard Copy/Cut/Paste always operates on the authoritative Original text regardless of the
  currently displayed mode (§6 item 2) — correct and safe, but not obviously communicated to a user
  who is looking at Hinglish/Gujarati-Script text on screen. Not addressed this task.
- Gujarati Script mode remains gated to `language === "gu"` projects (pre-existing, unrelated to
  this task — Gujarati transcription itself is deferred in the V1 language policy, so this only
  ever applies to legacy/existing data, per `output-mode.ts`'s own doc comment).

## 15. Recommended follow-up

1. Extend `mergeWords` (lib/subtitles/word-edit.ts) to merge `hinglishText`/`gujaratiScriptText`
   symmetrically (when both source words have one) instead of always clearing them, which would let
   `wordMergeAllowed` become `true` for derived modes with a genuinely proven-safe mapping.
2. Investigate whether word Delete can be safely enabled in a derived mode — it doesn't fabricate
   text, so the main open question is purely a UX one (does removing a word from a Hinglish/
   Gujarati-Script VIEW clearly communicate that it deletes the underlying original word too).
3. A small, clarifying label near the caption-text mode selector and/or the Copy/Cut menu items,
   noting that clipboard operations always copy the original transcript — a "smallest possible
   clarification," not a functional change.
4. If the §6 item 1 fix's own per-word staleness (derived text lagging the whole-caption field after
   a word-count-changing derived edit) turns out to matter in practice, consider a small, explicit
   "regenerate this caption's Hinglish/Gujarati-Script word breakdown" affordance — reusing the
   EXISTING `isWordTimingStale`-style token-count-comparison pattern, not a new sync model.

## 16. Whether a packaged release is required

**Not required to close this task.** Per this task's own explicit Phase 10 instruction ("do NOT
spend the entire phase rebuilding the installer unless packaged-only behavior is affected... do NOT
bump the version merely because this phase is complete"): every change in this task is pure
TypeScript/React (a new lib module, a store-function fix, two component prop/render changes) with
no packaging-specific surface — no new IPC, no new file I/O, no Electron main-process change, no new
native/external dependency. It was fully exercised in the dev server (§12), which is sufficient to
validate this kind of change per this project's own established convention (P16 itself validated its
dev-server behavior separately from its later, dedicated packaged-QA closure task).

**Recommendation**: bundle a packaged-Windows-QA pass for this task's changes into whichever future
release phase next bumps the version (mirroring how P16.1 closed P16's own packaged-QA gate as a
separate, later task) — there is no urgency to do it standalone, since nothing here is
packaging-sensitive. Version remains **0.1.17**, unchanged by this task.
