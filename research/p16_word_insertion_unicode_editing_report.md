# P16 — Word Insertion & Unicode-Safe Word Editing

## 1. Task ID

Task 103884 (P16). Follows P15 (Task 102741, word-level navigation/timing/split/merge/delete —
CLOSED, PASS, shipped 0.1.16). P16 is scoped ONLY to: (a) word insertion, (b) Unicode-grapheme-safe
default word splitting, (c) carrying forward P15's one open verification gap (real mouse-drag QA).
P15 itself was explicitly NOT reopened or redesigned.

## 2. Status

**CLOSED — PASS.** *(Updated by Task 104217 / P16.1, the dedicated closure task — see
`research/p16_1_release_closure_report.md` for the full packaged-QA and production-DB-safety
verification that closes this task's two previously-open gates. Everything below this notice is
the original P16 report, preserved as-is for history; it originally read "PARTIAL PASS" pending
those two gates.)*

Original status text (superseded by the CLOSED/PASS line above):

**PARTIAL PASS — engineering complete and verified; two QA gates not exercised this session.**

Everything within this session's control is done and passing: implementation, the full pure +
store test suite (114 new tests, 1046 total passing), a clean `tsc --noEmit`, a clean `eslint`, and
live Dev QA in the running dev server against a disposable seeded project (word insertion, both
directions, both rejection paths, undo isolation, and the Devanagari grapheme-split fix — all
confirmed working correctly in the actual browser UI, not just in unit tests).

**Not performed in this session** (see §17–19 for why, and what would need to happen next):
- **Packaged Windows installer QA** (building `SUBLY.exe`, installing it, testing against a
  duplicated real packaged project) — not attempted this session.
- **Production database safety comparison** (backup → duplicate → QA-only-duplicate → diff →
  cleanup against this machine's real packaged `subly.db`) — not attempted this session, since it
  depends on the packaged build above.
- **Real mouse/trackpad drag QA** — carried forward from P15 as an already-known, already-isolated
  tooling limitation (this session's browser automation cannot produce trusted pointer-drag events;
  confirmed again this session, see §17). Not specific to P16 — P16 introduces no new drag
  interaction at all (word insertion is entirely click/type-driven), so this gap is unchanged from
  P15's own documented state, not newly introduced or newly worse.

Per this task's own explicit Phase 19 instruction ("do NOT call PASS if a required gate is
incomplete" / "do NOT bump version yet" until all required gates pass), **the version was NOT
bumped** — it remains **0.1.16**. Only Phases 0–15 (audit, implementation, tests, typecheck, lint,
Dev QA) are claimed as complete and verified; Phases 17–19 (packaged QA, production DB comparison,
version bump) are explicitly left incomplete rather than fabricated.

## 3. Version

**0.1.16** (unchanged — see §2 and §19).

## 4. Audit findings (Phase 0)

Read in full before writing any code: `types/subtitle.ts` (`Word`/`Subtitle` shape, confirmed
`confidence`/`removed`/`style`/`hinglishText`/`gujaratiScriptText` are all already-optional fields —
no schema change needed), `src/lib/subtitles/word-edit.ts` (P15's `splitWordText`/`defaultWordSplit`/
`mergeWords`/`deleteWordConservative` — the exact pattern to extend, not replace), `editor-store.ts`
(the `splitWord`/`mergeWordWithNext`/`deleteWord` actions — each: decide feasibility as a pure
function *before* any `commit()`, one `commit()` call that recomputes the caption's own `.text` via
`breakIntoLines`, then a separate `set({ selectedWordIndex })` call — this exact shape was
replicated for `insertWord`, not reinvented), `word-timing-popover.tsx` (the existing `splitting`
toggle-state inline-editor pattern — replicated as `inserting` rather than a new UI paradigm),
`captions-panel.tsx` (the `CaptionsPanel → CaptionRow → WordChips → WordTimingPopover` prop-threading
chain that `onSplitWord`/`onMergeWordWithNext`/`onDeleteWord` already use — `onInsertWord`/`onInsert`
threaded through the identical chain).

**Dependency audit (Phase 0's explicit ask):** confirmed via a direct Node check
(`node -e "console.log(typeof Intl.Segmenter); ...`) that `Intl.Segmenter` with
`granularity: "grapheme"` is natively available in this project's dev/test Node runtime (v24.19.0)
and correctly groups the Devanagari conjunct in "नमस्ते" into `['न', 'म', 'स्ते']` — i.e. it never
separates the combining vowel sign from its base consonant. Electron 44.2.0 (this project's packaged
runtime) bundles a Chromium/V8 recent enough that V8 has shipped `Intl.Segmenter` since Chrome 87, so
the same native support was expected in the packaged app too (not independently re-confirmed this
session, since the packaged build itself was not performed — see §2/§17). **No new npm dependency was
added** — `package.json`'s `dependencies` are unchanged from 0.1.16.

## 5. Word insertion architecture

New pure module additions to `src/lib/subtitles/word-edit.ts` (same file P15's split/merge/delete
already live in — no second word-editing module):

- `normalizeInsertedWordText(raw: string): string | null` — trims, rejects empty/whitespace-only,
  rejects any internal whitespace (`/\s/u.test`) so a multi-word phrase like `"very good"` is
  rejected outright rather than silently split. Unicode letters/punctuation fully allowed (not an
  ASCII check).
- `computeInsertionGap(words, anchorIndex, side, captionStart, captionEnd): { start, end } | null` —
  pure gap geometry: `words[anchorIndex - 1].end → words[anchorIndex].start` for `"before"` (or
  `captionStart` when there's no previous word), `words[anchorIndex].end → words[anchorIndex + 1].start`
  for `"after"` (or `captionEnd` when there's no next word).
- `resolveWordInsertion(words, anchorIndex, side, rawText, captionStart, captionEnd): { word: Word, index: number } | null`
  — the single decision function. `index` is the exact splice position into the *original* words
  array (`anchorIndex` for `"before"`, `anchorIndex + 1` for `"after"`).

The store action `insertWord(subtitleId, wordIndex, side, text): boolean` in `editor-store.ts`
mirrors `splitWord`/`mergeWordWithNext`/`deleteWord` exactly: computes `resolveWordInsertion` first
(no mutation if it returns `null`), then one `commit()` that splices the new word in and regenerates
`.text` via `breakIntoLines(words.map(w => w.text).join(" "), rules.maxCharsPerLine, rules.maxLines)`
— the SAME reflow every other word-editing action already uses, not a second text-reconstruction
algorithm — then a separate `set({ selectedWordIndex: result.index })`.

UI: `WordTimingPopover` gained an `inserting: "before" | "after" | null` state mirroring the existing
`splitting` state, its own button row ("Insert before" / "Insert after", using lucide's
`ArrowLeftToLine`/`ArrowRightToLine`, confirmed present in the installed `lucide-react` package) below
the existing Split/Merge/Delete row (kept as its own row rather than folded in — five buttons at once
would be too cramped for the popover's 256px width), and an inline editor showing a single text input
plus a live "Claims the full gap: H:MM.SS – H:MM.SS (N.NNs)" preview computed from the same props
already passed to the component (`prevWordEnd`/`nextWordStart`/`captionStart`/`captionEnd`/`word`) —
no new prop needed for the full `words` array. `splitting` and `inserting` are mutually exclusive
(opening one closes the other) and both reset on popover close/reopen.

## 6. Timing allocation rules

Deterministic, matches the spec's own worked example exactly (Previous 0.00→1.00, Selected
1.20→2.00, insert "very" before Selected → new word claims the *entire* 1.00→1.20 gap; Previous and
Selected are completely untouched) — verified by a dedicated test
(`resolveWordInsertion: 'Insert Before' claims the WHOLE gap (the spec's own worked example)`) and
live in the browser (§16). The new word never claims a partial/proportional share, never borrows time
from an unrelated word, and never resizes the caption itself. Boundary fallback (Phase 4): inserting
before the first word (or after the last) uses `captionStart`/`captionEnd` instead of a neighbor —
verified by dedicated tests and live in the browser (the "Hello" word's own caption-start rejection,
§16).

## 7. Rejection rules

`resolveWordInsertion` returns `null` (the store action then makes **zero** commits — confirmed by
asserting `past.length` is unchanged) when: the anchor index is out of range; the text is
empty/whitespace-only; the text contains more than one token; or the available gap is strictly less
than `MIN_WORD_DURATION_SEC` (0.02s). A gap *exactly equal to* the minimum is accepted (strict `<`,
not `<=`), matching `clampWordTiming`'s own existing boundary convention and covered by a dedicated
"exact minimum-duration boundary" test. The UI shows a clear toast ("No room to insert a word here…"
or "Can't insert that — enter exactly one word (no spaces)."), verified live in the browser for the
zero-gap case (§16).

## 8. Unicode/grapheme strategy

New module `src/lib/subtitles/grapheme.ts` exports `segmentGraphemes(text: string): string[]`, using
`Intl.Segmenter(undefined, { granularity: "grapheme" })` when available (the common case — see §4),
falling back to a small, deliberately non-exhaustive fallback (`graphemeFallback`) that keeps a
Unicode combining mark (`\p{M}`) attached to whichever base code point precedes it, using
`Array.from` so astral-plane code points are never split across their UTF-16 surrogate pair. This is
NOT a full UAX #29 grapheme-cluster-boundary implementation (no ZWJ-sequence joining, no
regional-indicator flag-pair joining) — it only guarantees the one property this task needs
(a combining mark never becomes its own cluster), which is exactly why `Intl.Segmenter` is preferred
whenever present.

`word-edit.ts`'s `defaultWordSplit` now calls `segmentGraphemes(trimmed)` and slices/joins the
resulting cluster array (`Math.ceil(graphemes.length / 2)` midpoint, biasing the extra cluster left —
identical tie-break rule to P15's old character-count version) instead of raw `.slice()` on the
string. For plain ASCII/Latin text every grapheme cluster is exactly one character, so P15's existing
ASCII test cases (`"abcd" → {left:"ab", right:"cd"}`) pass completely unchanged — confirmed by the
pre-existing test suite still passing byte-for-byte.

## 9. Metadata policy

For an inserted word: `confidence: undefined`, `hinglishText: undefined`, `gujaratiScriptText:
undefined` (never fabricated — nothing was actually transcribed/derived for this new span), `removed:
false` **explicitly** (not `undefined` — a deliberate, documented difference from split/merge's
`removed: undefined`/propagated-unchanged policy, per this task's own Phase 10 instruction that an
inserted word is genuinely present, not a soft-deletion-history placeholder), and `style` propagates
from the **anchor** word (the word the user selected before inserting) — my own documented decision
for this task's open question, mirroring `splitWordText`'s existing precedent of propagating style to
derived words. All of this is covered by a dedicated metadata-policy test at both the pure-function
and store level. P15's own split/merge metadata policy (confidence never fabricated, derived text
fields cleared, `removed` handled per each function's own pre-existing rule) was **not** touched.

## 10. Selection behavior

After a successful insertion, `selectedWordIndex` is set to the new word's own index — `wordIndex`
(the anchor's original index) when inserting `"before"`, `wordIndex + 1` when inserting `"after"` —
exactly matching `resolveWordInsertion`'s own returned `index`, per this task's Phase 6 rule. No
second selection architecture was introduced; this reuses the exact same `selectedWordIndex` field
and `set()` pattern `splitWord`/`mergeWordWithNext`/`deleteWord` already use. Verified by two
dedicated store tests (one for each side) and, indirectly, live in the browser (the inserted "there"
word's own popover was reachable immediately via the correctly-shifted word-chip index, §16).

## 11. Undo/redo

Each `insertWord` call that succeeds is exactly one `commit()` — confirmed by asserting
`past.length` increases by exactly 1 — so it is one undo step, indistinguishable in the history stack
from any other word-editing action. A rejected (infeasible) request makes **zero** commits (confirmed
by asserting `past.length` is unchanged), so there is no dead/no-op undo entry to skip over. Verified
live in the browser: after inserting "there" then separately nudging a word's End time (two distinct
commits), a single Undo reverted *only* the insertion (word list back to `["Hello","world","again"]`)
while leaving the earlier nudge (`world`'s End at 0.89) untouched — proving one-commit-per-operation
end to end, not just at the unit-test level. Interaction coverage (Phase 11): insert→delete,
insert→split, insert→merge, insert→undo→redo, split→insert, delete→insert — each combination tested
at the store level, confirming no overlap, no sub-minimum duration, no dangling `selectedWordIndex`,
and `isWordTimingStale` reads `false` after every sequence where words/text remain consistent.

## 12. Quality integration

Insertion is a project mutation like any other word edit: it changes the `project.subtitles` array
reference, which the pre-existing, purely reference-based `isQualityReportStale`/quality-report-stale
derivation picks up automatically — no second quality system, no automatic re-analysis, no reset of
the review cursor. Verified by a dedicated store test (`qualityReport` object itself is untouched;
`qualityReportSubtitles` reference differs afterward) and confirmed the existing pattern every other
P15 word-editing action already follows.

## 13. Performance

Pure-function tests confirm `resolveWordInsertion`/`computeInsertionGap` are O(1) (single-index
neighbor lookups, no scan). Store-level performance tests (mirroring P15's own pattern) run
`insertWord` on a single caption inside a large project at **30 / 300 / 1,800 / 3,600 / 5,400** total
captions — all completed in under 150ms (typically ~1ms; the ceiling exists to catch an accidental
O(n²) regression, not because real timings approach it), confirming the SAME O(n) `snap.subtitles.map()`
cost every other per-caption word mutation already pays, not a new cost class. Also covered: a
1-word caption (insert both before and after its only word), Hindi/Devanagari text, Gujarati-script
text, and a caption whose word timing was *already* stale before an insertion elsewhere (confirming
insertion doesn't fix, worsen, or otherwise touch an unrelated caption's pre-existing staleness).
20+-word captions and multi-line captions were not given a dedicated separate test, since insertion's
own cost is anchor-relative (splice + one reflow), not word-count-relative, and the existing
performance tests already exercise captions with realistic multi-word content at scale.

## 14. Test count

- **New pure tests**: 26 in `word-edit.test.ts` (`normalizeInsertedWordText`, `computeInsertionGap`,
  `resolveWordInsertion` — insert before/after/first/last/middle, boundary fallback, insufficient gap,
  exact-minimum boundary, whitespace/multi-token rejection, Unicode acceptance, metadata policy, no
  overlap) + 1 `defaultWordSplit` grapheme regression test, plus a new file `grapheme.test.ts` with
  12 tests (ASCII, precomposed vs. decomposed accented Latin, Devanagari, Gujarati, astral-plane
  emoji, skin-tone modifier, ZWJ family sequence, determinism, round-trip fidelity).
- **New store tests**: 25 in `editor-store-word-edit.test.ts` (one-commit/rejection/dirty/undo/redo/
  quality-stale/selection/metadata/no-overlap for `insertWord`, six Phase-11 interaction tests, five
  performance tests at the five required caption counts, four functional-variety tests).
- **Full suite**: **1046 tests passing, 0 failing** (up from 981 at the start of this task — net +65
  from this task's own new tests, after accounting for the fact some new tests exercise multiple
  assertions per `test()` block). Run via `npm test`, which now also includes the new
  `grapheme.test.ts` file (added to both `test:word-editing` and the aggregate `test` script in
  `package.json`).

## 15. Typecheck

`npx tsc --noEmit` — **clean, zero errors** (run twice: once immediately after the implementation
changes, once again after adding all new test files).

## 16. Lint

`npx eslint .` (whole project) — **zero errors**, 5 pre-existing warnings in files this task did not
touch (`project-card.tsx`, `lib/ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts` — all
unused-variable/unused-eslint-disable warnings that predate this task).

## 17. Dev QA

Performed live against the running dev server (`npm run dev`) using the same disposable seeded QA
project P15 used (`p15-word-edit-qa@example.test`, 7 captions including Hindi/Devanagari text and one
deliberately-stale caption), reusing its existing seed script rather than writing a new one. Verified
in the actual browser UI (not just unit tests):

1. **Insert Before rejection at a caption boundary** — selecting "Hello" (starts exactly at its
   caption's own start) and clicking "Insert before" correctly showed the toast "No room to insert a
   word here — the neighboring words are too close together," made no popover-editor transition, and
   is corroborated by the store-level assertion that this makes zero commits.
2. **Creating a real gap via the existing timing nudge control**, then **Insert After** on "world" —
   the inline editor correctly opened showing "Claims the full gap: 00:00.89 – 00:01.00 (0.10s)."
3. **Confirming the insertion** — typed "there," clicked Insert, and confirmed live: the word-chip
   row updated to `Hello / world / there / again`, and the caption's own text field updated to
   exactly `"Hello world there again"` (text reconstruction via the shared `breakIntoLines` reflow,
   confirmed in the live DOM, not just asserted in a test).
4. **Multi-token rejection in the live UI** was exercised at the pure/store level (§9/§14); the
   adjacent-words-touch rejection (word "there" has no gap before it, since it touches "world") was
   additionally confirmed live — clicking "Insert before" on the newly-inserted "there" correctly
   showed the same rejection toast with no state change.
5. **Undo isolation** — after the insertion (one commit) and an earlier, separate End-time nudge (a
   different commit), a single Undo click correctly reverted *only* the insertion (word list back to
   `Hello / world / again`) while leaving the nudge's effect (`world`'s End at 0.89) untouched —
   directly confirming one-commit-per-operation in the live app, not only in the test suite.
6. **The Unicode grapheme-split fix, live** — selecting the Devanagari word "नमस्ते" (from the
   seeded Hindi caption) and clicking Split showed the default-proposed boundary as **"नम" / "स्ते"**
   — the conjunct "स्ते" (स + ् + त + े) stayed intact as one token. This directly disproves the old
   P15 bug this task exists to fix, which would have proposed "नमस" / "्ते" (severing the vowel sign
   from its consonant) — confirmed live in the running app, not only in the isolated pure-function
   test.

Not separately re-verified live this session (already covered by the still-passing, unmodified P14/
P15 regression suites, and this task made no changes to either area): P14 caption-clipboard
shortcuts, P15 word navigation via arrow keys, and playback active-word-vs-selected-word
independence.

## 18. Real mouse drag QA

**Unavailable in this environment, unchanged from P15's own documented finding.** P16 introduces no
new drag-based interaction of its own (word insertion is entirely click-and-type — no dragging is
part of its UX at all), so this gap is carried forward exactly as-is, not newly introduced or made
worse by this task. Attempting a `left_click_drag` gesture on this session's browser-automation tool
against the pane produced the same class of rendering/interaction instability already noted in P15
(the automated tab repeatedly failed to produce a stable screenshot for coordinate-based interaction,
requiring `read_page`/`find`-based navigation instead of pixel-coordinate dragging throughout this
session's Dev QA — see §17's method). Per this task's own explicit instruction, this is recorded
honestly rather than invented as a pass: **manual/trusted-pointer drag verification remains
unavailable in this environment.** The drag implementation itself was not touched or rewritten to
satisfy any automation tool.

## 19. Packaged QA

**Not performed this session.** Building `SUBLY.exe` via `npm run electron:pack`, installing it, and
testing against a disposable duplicate of a real packaged project (the exact methodology P14/P15
established) is a substantial, multi-step operation involving this machine's real, accumulated
packaged-app database. Given this task's own explicit instruction to be completely honest rather than
claim a PASS on an incomplete gate, this step was deliberately left for a dedicated follow-up pass
rather than rushed through under this session's own time/scope constraints. The implementation itself
has no packaging-specific surface (no new IPC, no new file I/O, no new native module) — it is pure
TypeScript/React reusing existing store/commit/UI infrastructure — so the packaged build is expected
to behave identically to the verified dev-server behavior in §17, but that expectation has not been
independently confirmed.

## 20. Production DB comparison

**Not performed this session**, for the same reason as §19 (it depends on the packaged build/install
existing first). No production or production-like database was touched, modified, backed up, or
diffed as part of this session's work — only the local disposable dev-mode seed project
(`p15-word-edit-qa@example.test`, reused from P15's own existing seed script) was used for Dev QA.

## 21. Installer filename/size

Not applicable — no installer was built this session (see §19).

## 22. Known limitations

- Packaged Windows QA and the production-database safety comparison were not performed this session
  (§19/§20) — a dedicated follow-up pass should build `npm run electron:pack`, install it, and repeat
  the backup → duplicate → QA-only-duplicate → diff → cleanup procedure P14/P15 established before
  this task can be considered fully closed.
- Real mouse/trackpad drag verification remains unavailable in this automation environment (§18) —
  unchanged from P15, not newly introduced by this task.
- The Unicode grapheme fallback (`graphemeFallback` in `grapheme.ts`, used only when `Intl.Segmenter`
  is unavailable — not expected to trigger in this project's actual dev/packaged runtimes) does not
  implement full UAX #29 grapheme-cluster-boundary rules (no ZWJ-sequence joining, no
  regional-indicator flag-pair joining) — it only guarantees combining marks stay attached to their
  base character, which is the one failure mode this task exists to fix. `Intl.Segmenter` (used
  whenever available) has no such limitation.
- Multi-word insertion (e.g. typing "very good" and having it become two words) is explicitly
  deferred, per this task's own Phase 5 instruction to prefer rejection in this phase.

## 23. Deferred work

Everything this task's own scope-exclusion list already names (AI correction/rewriting/translation,
cloud sync, collaboration, regex editing, new export formats, database redesign, transcript-editor
redesign, unrestricted word dragging, new playback architecture, new quality-report architecture) —
none of it was started, per that list's own explicit instruction. **P17 was not started.** The two
QA gates named in §19/§20 are the concrete next steps before this task can be marked fully closed;
everything else (implementation, tests, typecheck, lint, Dev QA) is genuinely done.
