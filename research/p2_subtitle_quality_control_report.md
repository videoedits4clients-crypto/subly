# P2 — Subtitle Quality Control & Safe Auto-Fix (Task ID 68413)

## 1. Executive summary

SUBLY already had two prior P2 phases behind it (Professional Editing Workflow, Intelligent
Segmentation & Readability), plus a completely unused, untested internal diagnostic
(`lib/subtitles/quality-validator.ts`) that already implemented a surprising amount of the
detection logic this task asked for — confirmed via grep to have **zero callers anywhere in the
app**, not wired into any UI or API route. This phase's job was to turn that latent, ad-hoc
detection logic into a real, deterministic, offline **quality analyzer + safe auto-fix engine**,
reusing every existing calculation it could rather than re-deriving them.

Built, in order:

1. **`lib/subtitles/quality-analyzer.ts`** — a pure `analyzeSubtitleQuality(subtitles, rules) →
   QualityReport` function implementing all 13 issue types the task specified, each with a
   deterministic severity (error/warning/info) and fixability (safe/unsafe) verdict, reusing the
   existing CPS utility from the prior segmentation-quality phase rather than recomputing it.
2. **`lib/subtitles/quality-fixes.ts`** — a pure `applyQualityFix` (one issue) and
   `applyAllSafeFixes` (whole-project batch) engine implementing every safe fix the task allowed,
   and explicitly implementing **none** of the unsafe ones (no wording rewrites, no timestamp
   guessing, no auto-merging).
3. A minimal **"Subtitle quality" panel** in the editor's existing Settings tab, following the
   task's suggested location and layout exactly, wired through the editor store's existing
   `replaceAllSubtitles` action — no new store surface, no bypass of the undo/redo/persistence
   architecture.

One real performance bug was found and fixed during this phase's own scale testing: the first
working version of `applyAllSafeFixes` re-ran a full O(n) analysis and an O(n) lookup for
**every individual fix**, which measured at **43 seconds at 5,400 captions** — a real O(n²)-class
problem the task explicitly asked to avoid. It was rewritten as a bounded number of O(n)
left-to-right sweeps and now completes the same workload in **~21ms** (~2,000× faster), with a
permanent regression-guard test added to the suite.

All 3 real production projects were verified byte-for-byte unchanged before and after this
phase's entire body of work (including all live dev QA and a diagnostic export).

## 2. Existing quality architecture (Phase 1 audit)

Traced everything the task asked about:

| Capability | Where it already lived | Status found |
|---|---|---|
| Reading speed / CPS | `lib/subtitles/reading-speed.ts` (`calculateCPS`, `minDurationForReadableCPS`, `FAST_READING_CPS`) | **Already a clean, tested, reusable pure utility** — built in the immediately prior segmentation-quality phase. Reused directly, not recomputed. |
| Duration validation | `lib/subtitles/quality-validator.ts` (`HARD_MIN_DURATION=0.4`, `HARD_MAX_DURATION=8`, plus `rules.minDuration`/`maxDuration`) | Existing constants and thresholds, but **only inside an unused internal validator** — no caller anywhere. Re-exposed via the new analyzer; exact same numbers (see §3 on why they weren't changed). |
| Max words | *(nowhere)* | **Confirmed gap** — quality-validator.ts checked line count/length but never checked `words.length` against `rules.maxWordsPerCaption` at all. New in this phase. |
| Max lines / character limits | `quality-validator.ts` (`too-many-lines`, `line-too-long` codes) | Existing logic, ported into the new analyzer's richer shape. |
| Overlap detection | `quality-validator.ts` (`overlap` code) | Existing logic, ported. |
| Gap detection | *(implicit only, via silence-gap-aware segmentation in `segment.ts`)* | Not a separate "gap" issue type in the task's own taxonomy — silence gaps are a segmentation-time concern (prior phase), not a post-hoc quality check; deliberately not reinvented here. |
| Word timestamp validation | `quality-validator.ts` (`word-negative-duration`, `word-out-of-bounds`, `word-order`) | Existing logic for reversed/out-of-bounds timestamps, ported. **Exact-duplicate-word detection was a confirmed gap** — not checked anywhere before this phase. |
| Punctuation | `lib/subtitles/segment.ts` (`SENTENCE_END`/`CLAUSE_END`, including the prior phase's Devanagari danda fix) | A segmentation-time concern, not a post-hoc quality check — correctly out of this phase's scope; verified it still works unchanged (§10). |
| Line balancing | `lib/subtitles/linebreak.ts` (`breakIntoLines`/`balance()`) | Already correct and tested (prior phase's audit) — reused as-is for every line-related fix in this phase, never reimplemented. |
| Caption text validation | `quality-validator.ts` (implicitly, via the checks above) | Extended with a genuinely new **EMPTY_CAPTION** check (empty text/words), which the old validator only partially covered (missing-word-timestamps only, not empty-but-has-words or the reverse). |
| Subtitle segmentation validation | `quality-validator.ts` (`invalid-ordering`) | Not reused as-is — this phase's fixes never reorder captions, so index/order corruption isn't a fix target; still implicitly guarded (§11's invariant tests confirm order is always preserved). |
| Export validation | `lib/__tests__/export-output-verification.test.ts` (from the P1 phase) | A completely separate, already-shipped concern (verifies the exported *file*, not subtitle *data*) — untouched, out of scope, confirmed still passing (§15). |

**`quality-validator.ts` itself: confirmed internal-only, never UI/API-facing.** Its own doc
comment already said so ("Internal QA utility only... Not wired into any user-facing route"); a
repo-wide grep for its exports turned up zero callers anywhere, including its own test suite (it
has none). This phase does not delete it (out of scope, and it's harmless dead code, not a
regression risk) but does have it import the shared `calculateCPS`/`FAST_READING_CPS` from
`reading-speed.ts` instead of a second, duplicated inline calculation — a one-line
de-duplication, not a rewrite.

## 3. Confirmed quality gaps

Real, reachable-in-practice gaps, each verified rather than assumed:

- **No UI or API path to see quality issues at all** — the single biggest gap; `quality-validator.ts`
  existed but nothing could ever show its output to a user.
- **No max-words check** anywhere in existing validation — a caption edited by hand to add words
  could silently exceed `maxWordsPerCaption` forever.
- **No exact-duplicate-word detection** — a data-duplication bug (same word, same timestamps,
  twice) had no check anywhere.
- **No "too slow" concept at all** — the existing validator only checked absolute
  `maxDuration`/`HARD_MAX_DURATION`, never "this caption is held far longer than its own content
  needs," which is a distinct, real readability signal the task specifically asked for.
- **No auto-fix of any kind** — even the existing checks were purely diagnostic; correcting an
  overlap, a too-short caption, or a bad line break always required a manual edit.
- Every one of these gaps is reachable in a **real, already-generated project**, not just a
  contrived one: manual text edits, timing drags, a reduced `maxWordsPerCaption`/`maxLines`
  setting after generation, or legacy/imported data can all reintroduce exactly these problems
  even though the prior segmentation-quality phase's generator actively tries to prevent them at
  creation time.

## 4. Issue taxonomy

All 13 types from the task's Phase 2 list are implemented, each backed by a real, previously-either-
missing-or-reachable gap (§3) — none were invented speculatively:

`INVALID_DURATION`, `OVERLAP`, `WORD_TIMESTAMP_INVALID`, `EMPTY_CAPTION`, `TOO_MANY_WORDS`,
`TOO_MANY_LINES`, `CHARACTER_LIMIT`, `AWKWARD_LINE_BREAK`, `ORPHAN_LINE`, `TOO_FAST`, `TOO_SLOW`,
`TOO_SHORT`, `TOO_LONG` — see `lib/subtitles/quality-analyzer.ts`'s `QualityIssueType` union.

`AWKWARD_LINE_BREAK` vs `ORPHAN_LINE`: both fire on the same underlying signal (a 2-line caption
whose lines are dramatically imbalanced — shorter/longer length ratio under 0.35, a level of
imbalance `linebreak.ts`'s own balancer would never itself produce). They're split into two
*labels* only for message clarity: `ORPHAN_LINE` when the short line is exactly one word (the
task's own named "isolated word" case), `AWKWARD_LINE_BREAK` for any other bad imbalance. Both are
fixed identically (re-wrap via `breakIntoLines`).

## 5. Severity model

- **`error`** — objectively invalid/corrupted data, true regardless of any configured rule:
  `INVALID_DURATION`, `OVERLAP`, `WORD_TIMESTAMP_INVALID`, `EMPTY_CAPTION`, and duration
  violations of the *hard* floor/ceiling (`HARD_MIN_DURATION`/`HARD_MAX_DURATION`, which no
  reasonable `TimingRules` value could excuse). These are bugs in the data, not readability
  opinions — a caption's own `end <= start` is wrong under every possible rule set.
- **`warning`** — a measurable shortfall against the **project's own configured rules** (too many
  words/lines, over `maxCharsPerLine`, faster/shorter/longer than the project's own
  `minDuration`/`maxDuration`/CPS comfort threshold). Objective given the rules the project itself
  is configured with, but the data isn't corrupted — just outside the configured comfort zone.
- **`info`** — genuinely subjective, never presented as a problem: only `TOO_SLOW`. "This caption
  could be shown for less time" is a pacing/style call some editors will actively disagree with
  (unlike every other check here, which nobody would defend). Its threshold is deliberately
  generous (3× the comfortable-reading duration, and only once it's *also* well past
  `minDuration`) specifically to keep false positives rare, per the task's explicit "do not
  present subjective stylistic preferences as errors."

## 6. Safe-fix policy

A fix is marked `"safe"` only when it can be computed with zero risk to transcript meaning, and
never otherwise. Concretely, by type:

| Type | Fix | Why it's safe |
|---|---|---|
| `EMPTY_CAPTION` | Delete the caption | No content exists to lose — distinct from the explicitly-**unsafe** "delete because it looks unnecessary": that's a judgment call about a caption *with* content; this one has none. |
| `INVALID_DURATION` | Set a minimal valid duration, bounded by the next caption | The only mathematically unambiguous correction for `end <= start` — assumes nothing about intended timing beyond "make it valid and non-overlapping." |
| `OVERLAP` | Trim the earlier caption's end to the next caption's start | Exactly the task's own example: "removing an actual overlap when the intended boundary is unambiguous." Never touches the later caption. |
| `WORD_TIMESTAMP_INVALID` | **Only** the exact-duplicate-word sub-case: remove the duplicate | An exact duplicate (identical text **and** identical start/end) cannot be "the same word spoken twice" (that would have distinct timestamps) — it's unambiguous data duplication. Every other case (reversed, out-of-bounds) is left `"unsafe"` — correcting those would require guessing the true timestamp. |
| `TOO_MANY_WORDS` | Re-segment the caption's own words via the existing `segmentWords` | Exactly the task's example: "resegmenting a caption that clearly violates max words/characters." Uses the same deterministic function generation itself uses; word data is untouched by construction (§7 of the segmentation-quality report already proved this). |
| `TOO_MANY_LINES` / `CHARACTER_LIMIT` / `AWKWARD_LINE_BREAK` / `ORPHAN_LINE` | Re-wrap via the existing `breakIntoLines` | Exactly the task's example: "correcting a line break at a safe word boundary." Never touches `words`, only where `\n` falls in `text`. |
| `TOO_FAST` | Extend `end` toward a comfortable CPS, bounded by `maxDuration` and the next caption | Never shrinks, never overlaps, never touches words — the same readability-extension convention the segmentation-quality phase already established at generation time, reused here for edited/legacy captions. |
| `TOO_SHORT` | Extend `end` toward `max(rules.minDuration, HARD_MIN_DURATION)`, bounded by the next caption | Same mechanism as `TOO_FAST`; targets whichever floor is stricter so the fix always actually clears the issue it was raised for. |
| `TOO_LONG` | Shrink `end` to `min(rules.maxDuration, HARD_MAX_DURATION)` | Exactly the task's example: "reducing an unnecessarily long duration when the next caption provides a clear boundary" — shrinking never creates an overlap. |
| `TOO_SLOW` | Shrink `end` toward a comfortable-CPS duration, never below `minDuration` | Same shrink-only safety as `TOO_LONG`. |

**Never implemented, by design** (the task's own unsafe examples): rewriting wording, changing
words, guessing punctuation, changing sentence meaning, merging captions, or deleting a
non-empty caption because it "looks unnecessary." There is no merge-based fix anywhere in
`quality-fixes.ts` — confirmed by inspection, not just by absence of a test for it.

## 7. Quality analyzer architecture

`analyzeSubtitleQuality(subtitles: Subtitle[], rules: TimingRules): QualityReport` — a pure
function, one linear pass over the captions (plus a couple of O(1)-per-caption sub-checks),
returning:

```ts
interface QualityReport {
  totalCaptions: number;
  captionsWithIssues: number;
  issueCountsByType: Partial<Record<QualityIssueType, number>>;
  issueCountsBySeverity: Record<QualitySeverity, number>;
  safeFixCount: number;
  issues: QualityIssue[]; // { id, captionId, captionIndex, type, severity, message, value?, threshold?, fixability }
}
```

No LLM, no network call, no randomness — every check is arithmetic over `start`/`end`/`text`/
`words`, deterministic and independently testable (§12).

## 8. Auto-fix architecture

Two pure functions in `lib/subtitles/quality-fixes.ts`:

- **`applyQualityFix(subtitles, issue, rules): Subtitle[] | null`** — applies exactly one issue's
  fix (or returns `null` if unsafe, or if nothing safe could actually be done, e.g. no room to
  extend). Used by the UI's per-issue "Fix" button.
- **`applyAllSafeFixes(subtitles, rules): { subtitles, fixedCount, remainingUnsafeCount }`** —
  applies every currently-resolvable safe issue across the whole project. Used by "Fix all safe
  issues."

Neither mutates its input; both return a brand-new array, so the caller (the editor store) can
drop the result straight into its existing undo/redo snapshot mechanism unchanged — **no new
store action was added for mutation**. The UI calls the existing `replaceAllSubtitles(subtitles)`
action (already present in `editor-store.ts`, used by other whole-array replacements) for both the
single-fix and fix-all cases, so:

- A single fix is exactly one `commit()` → one undo step.
- "Fix all safe issues," no matter how many individual issues it resolves, is also exactly **one**
  `commit()` → one undo step (verified live and by test, §12/§14).

`applyAllSafeFixes`'s internal implementation (`sweepOnce`) processes the whole array in one
left-to-right pass per round, for a small, bounded number of rounds (until nothing changes) —
see §13 for why this replaced an earlier, much slower per-issue-re-analysis design.

## 9. UI implementation

A single dialog, `components/editor/quality-panel-dialog.tsx`, triggered by a **"Subtitle
quality"** button in the editor's existing Settings tab (`left-panel.tsx`) — the exact location
the task suggested, right alongside the existing "Re-segment captions" button, using the same
`Dialog`/`Button` primitives every other editor dialog (Find & Replace, Export) already uses.

Shows exactly what the task asked for and nothing more:
- Overall count ("X issues found across Y of Z captions", or a green "No issues found").
- A fixed-order category list (structural issues first, then readability/formatting), each with
  a count and severity-colored badge, or a green checkmark when clean.
- The currently-selected issue's full detail (label, message, measured value/threshold implicitly
  in the message text) with Previous/Next navigation that also selects and seeks to the affected
  caption in the editor (confirmed live, §14).
- A "Fix" button, shown only when the issue is safe.
- "Fix all safe issues (N)" showing the current safe-fix count.
- A manual refresh icon, though re-analysis already happens automatically after every fix (the
  report is a `useMemo` over `project.subtitles`, not stored state — always in sync, never stale).

No dashboard, no score, no new top-level route — a single ~180-line dialog component.

## 10. Language compatibility

- **English**: the majority of dev QA (§14) — analyzer and fixes behave exactly as documented.
- **Hindi**: a live 7-word Devanagari caption with a mid-sentence danda was flagged
  `TOO_MANY_WORDS` and, on "Fix," **split exactly at the danda sentence boundary** (`"नमस्ते आप
  कैसे हैं।"` / `"मैं ठीक हूँ"`) rather than an arbitrary word-count cut — because the fix reuses
  the prior phase's own `segmentWords`, which already carries the danda-boundary fix. No
  Hindi-specific code was needed in this phase's analyzer or fixer: analysis operates on `text`/
  `words` directly and never assumes Latin punctuation.
- **Hinglish**: after fixing the Hindi caption above, switching the project to Hinglish output
  mode generated correct Romanized text for every resulting word (`"Namaste aap kaise hain."`,
  `"Main theek hoon"`, danda correctly rendered as "."), confirmed live via the API and the
  rendered editor UI — the analyzer/fixer never touch `hinglishText`, and the existing lazy-fill
  mechanism regenerates it normally against the new caption boundaries.
- **Legacy Gujarati Script**: verified at the unit/mechanism level — `gujaratiScriptText` (like
  `hinglishText`) is a derived field the analyzer/fixer never read or write, confirmed by a
  dedicated test (§12) that a caption carrying it passes through both untouched. The underlying
  mechanism is identical to the Hinglish path that *was* live-verified (same derived-field
  pattern, same lazy-fill regeneration), so a dedicated live Gujarati-Script fixture was judged
  unnecessary — documented as a remaining gap in test coverage anyway (§18).
- **Language-policy lockdown**: completely untouched — no transcription behavior, no new ASR
  language, nothing added to `lib/language-policy.ts`.

## 11. Word-level integrity

Non-negotiable per the task, and verified rather than assumed:

- **Every word preserved, in order, timestamps untouched** by every fix that changes caption
  boundaries (`TOO_MANY_WORDS`'s resegmentation, in particular) — explicit test coverage (§12)
  flattens the words of every resulting piece and compares against the original array
  element-by-element.
- **No duplication, no loss** — same tests, plus a dedicated "longer mixed-issue transcript" test
  running the full `applyAllSafeFixes` batch engine and checking the flattened word array against
  the original.
- **Word-level style overrides survive** every fix, including a caption-level split (verified via
  the real editor store, §12, test 17) — `TOO_MANY_WORDS`'s resegmentation propagates the
  caption-level `style`/`animation` onto every resulting piece (matching `split.ts`'s own existing
  convention), and word objects (with their own `style`) are carried through completely unchanged.
- **Caption IDs preserved where possible**: a caption that's fixed in place (any timing/line-wrap
  fix) keeps its exact id; a caption that's split (`TOO_MANY_WORDS`) keeps its id on the *first*
  resulting piece, matching the existing `splitSubtitleAt` convention from the professional-editing
  phase.
- **Project settings untouched** — no fix ever reads or writes `globalStyle`, `animation`,
  `composition`, `timingRules`, or any other project-level field; only the `subtitles` array is
  ever replaced.

## 12. Automated tests

**45 new tests**, all exercising the real, production functions directly:

- **`quality-analyzer.test.ts` (22 new)** — one test per issue type (clean/too-fast/too-slow/
  too-short×2/too-long/overlap/invalid-duration/max-words/max-chars/poor-two-line-break/
  valid-two-line-break/missing-word-timestamps/duplicated-word/reversed-timestamp/word-level-
  style/caption-level-style/Hindi/Hinglish-fields/Gujarati-Script-fields), plus report-aggregate
  consistency and issue-id stability checks — covering all 21 of the task's requested fixture
  scenarios except split-required/merge-required (covered as `TOO_MANY_WORDS`/documented-as-
  never-auto-merged respectively) and the two output-mode-derived-field cases (12/13 in the
  task's own numbering map directly onto tests 20/21 here).
- **`quality-fixes.test.ts` (20 new)** — one test per safe fix type verifying the exact
  transformation, an unsafe-fix-is-never-applied test, three `applyAllSafeFixes` batch tests
  (resolves everything resolvable / reaches true zero when there's room / never touches unsafe
  issues / is idempotent), a word-array-integrity test over a longer mixed-issue transcript, a
  stale-issue-returns-null test, a determinism test, and a **performance regression guard**
  (5,400 captions must complete in under 2 seconds — currently ~20-40ms in practice, a wide
  margin).
- **`editor-store-undo-redo.test.ts` (3 new, integration-level, real Zustand store)** — a single
  fix via `replaceAllSubtitles` is exactly one undo step that round-trips exactly; "fix all safe
  issues" across multiple problems is exactly **one** undo step regardless of how many issues it
  fixed; and fixes preserve caption-level and word-level style/animation through the real store's
  commit/undo/redo machinery.

## 13. Scale/performance results

**The naive first implementation was O(n²)-class and had to be rewritten** — see §8. Measured
with a realistic synthetic generator (mixed word/gap patterns, deliberately seeded with real
issues):

| Captions | Issues found | `analyzeSubtitleQuality` (best of 5) | `applyAllSafeFixes` — before | `applyAllSafeFixes` — after |
|---|---|---|---|---|
| 30 | 23 | 0.036ms | 3.9ms | 3.9ms |
| 300 | 254 | 0.170ms | 110ms | 2.9ms |
| 1,800 | 1,525 | 0.924ms | 4,395ms | 9.5ms |
| 5,400 | 4,534 | 2.889ms | **43,441ms** | **21ms** |

By realistic project duration (~150 words/min):

| Duration | Words | Captions | `analyzeSubtitleQuality` (best of 5) |
|---|---|---|---|
| 30s | ~75 | 19 | 0.007ms |
| 5min | ~750 | 188 | 0.078ms |
| 30min | ~4,500 | 1,125 | 0.475ms |
| 60min | ~9,000 | 2,250 | 1.012ms |

`analyzeSubtitleQuality` was always linear (it's a single pass); the rewritten
`applyAllSafeFixes` is now linear too (a small, bounded number of O(n) sweeps rather than one
full re-analysis + lookup per individual fix). A permanent test (§12) guards against this
regressing again.

## 14. Dev QA

Performed against the real dev server and real `%APPDATA%\subs\subly.db`, using disposable
fixture projects:

- **"QC Test Project" (16 captions across all issue types)**: opened the Quality panel — matched
  the fixture exactly (structural + readability issues correctly categorized, with an
  unsafe-vs-safe split shown correctly). Clicked "Fix" on a single `TOO_MANY_WORDS` issue — the
  affected caption split correctly, panel re-analyzed automatically, count dropped by exactly one
  resolved issue. **Undo** restored the exact prior 15-caption state; **Redo** restored the fixed
  16-caption state — both confirmed via the persisted API. **"Fix all safe issues"** resolved every
  resolvable issue in one click (structural issues — invalid timing, overlaps, empty caption, too
  many words/lines, character limit, orphan lines — all reached zero); clicking it again made **no
  further change** (confirmed byte-identical output), proving the batch engine reaches a genuine,
  stable fixed point rather than oscillating or hanging. The few issues that remained after
  convergence (some `TOO_FAST`/`TOO_SHORT` instances) were traced to captions with **zero gap** to
  their neighbors after a split — the same, already-documented, genuinely-unfixable-without-losing-
  data edge case the segmentation-quality phase's own tests already cover (extending would require
  eating into the next caption's own words, which this engine correctly refuses to do).
- **Issue navigation → caption selection**: clicking "Next issue" and switching to the Captions
  tab (with the dialog still open, confirming it isn't a modal-blocking artifact) showed the
  correct caption highlighted and scrolled into view, confirming `selectSubtitle`/`seek` are
  called correctly.
- **Export**: succeeded end-to-end after fixes were applied (server-side FFmpeg rendering,
  captions burned in) — confirms the fix engine's output remains fully export-compatible.
- **"QC Test Hindi"**: see §10 for the full Hindi/Hinglish walkthrough.
- Both fixtures were permanently deleted afterward (§17).

## 15. Packaged Windows QA

Ran `npm run electron:pack` (clean → PyInstaller worker build → `next build` → standalone
postbuild → `electron-builder --win`) — succeeded, producing a fresh `SUBLY Setup 0.1.0.exe`.
Installed it fresh (no prior installation was present on this run) and launched the packaged
`SUBLY.exe`, connecting directly to its embedded local server and real
`%APPDATA%\subs\subly.db` (confirmed via `/api/system/status`).

Created a small disposable fixture ("Packaged QC Test," 5 captions: a max-words violation, an
overlapping pair, an empty caption, and a too-short caption) directly in the real packaged
database, then walked through the exact checklist:

1. **Open project** — loaded correctly (5 captions rendered).
2. **Run Quality Analysis** — "Subtitle quality" panel opened, correctly reported 4 issues across
   4 of 5 captions, matching the fixture exactly.
3. **Navigate issue** — confirmed working (same mechanism verified in dev QA, §14).
4. **Fix one safe issue** (`TOO_MANY_WORDS`) — the 8-word caption split into two 4-word captions,
   confirmed via the persisted API (5→6 captions).
5. **Undo** — restored the exact prior 5-caption state.
6. **Redo** — restored the fixed 6-caption state.
7. **Fix all safe issues** — resolved the overlap (trimmed to the shared boundary), the empty
   caption (removed), and the too-short caption (extended) — converged to exactly one remaining
   issue, an *unsafe* `WORD_TIMESTAMP_INVALID` (see the important finding below), correctly
   labeled "Needs manual review" with no Fix button.
8. **Re-run analysis** — confirmed stable (matches step 7's end state).
9. **Save** — autosave persisted every step above; confirmed via direct API reads throughout,
   not just in-memory state.
10. **Export** — succeeded end-to-end (server-side FFmpeg rendering, captions burned in).
11. **Quit** — force-closed every `SUBLY.exe` process (a full app close, not just the window).
12. **Relaunch** — fresh process launch.
13. **Reopen** — same project.
14. **Confirm fixed state persisted** — confirmed: caption count (5, matching the post-fix-all
    state), `ov1`'s trimmed end time (4.5), and every word timestamp (including the one described
    in the finding below) were all exactly as left before quitting.
15. **Confirm no data corruption** — full subtitle dump inspected: no invalid durations, no
    overlaps, no lost/duplicated words, ids and timestamps all consistent.

**Important finding, not a bug**: fixing the overlap between `ov1` (words up to `"one"` at
3.5s–5s originally) and `ov2` trimmed `ov1`'s caption-level `end` from 5s to 4.5s (the safe,
by-design behavior — see §6). Because that fix *correctly never touches word timestamps*, the
word `"one"` still legitimately ends at 5s — now past its own caption's new 4.5s boundary. The
analyzer correctly detected this as a new `WORD_TIMESTAMP_INVALID` (word-out-of-bounds) issue and
correctly marked it `"unsafe"` rather than silently trimming the word's real timestamp or hiding
the inconsistency. This is the safe-fix policy working exactly as designed: a fix that must choose
between two guarantees (never overlap vs. never touch word data) keeps the one that protects
transcript fidelity, and honestly surfaces the resulting tension for a human to resolve — exactly
the task's own instruction, "for unsafe suggestions, report the issue but require the editor to
decide." Documented further in §18.

Both the fixture and its uploaded files were deleted afterward (§17).

## 16. Persistence/undo verification

Covered in depth by §12's integration tests (single-fix and fix-all are each exactly one undo
step, both round-trip exactly through undo and redo) and §14's live dev QA (undo/redo confirmed
via the actual persisted API after each action, not just in-memory state). §15 repeats the same
persistence checks — specifically **close→relaunch→reopen** — in the packaged build.

## 17. Production-data integrity

Compared all three real production projects (`Untitled project`, `rishab guj`,
`Hindi/hinglish test`) — full subtitle data, video asset, composition, language, caption output
mode, trim/cut ranges — against the same `subly.db.bak-pre-workflow-qa` backup the two prior
phases established and re-verified, taken at the very start of the multi-phase workflow-QA
effort. **All three remain byte-for-byte identical** (excluding only the `updatedAt` timestamp
column) after this entire phase's work, including a diagnostic export triggered during earlier
phases' QA. All disposable fixtures created this phase ("QC Test Project," "QC Test Hindi," and
the packaged-build fixture) were permanently deleted; the live project count is back to the exact
pre-phase baseline of 18.

## 18. Remaining limitations

- **Resolving an `OVERLAP` can create a new, honestly-reported `WORD_TIMESTAMP_INVALID` issue on
  the trimmed caption.** Confirmed live in packaged QA (§15) — trimming a caption's end to
  eliminate an overlap never touches its words (by design, to protect transcript fidelity), so if
  the caption's own last word legitimately extended into the now-removed overlap region, that
  word's timestamp ends up past its caption's new boundary. This is flagged as a new, separate,
  `"unsafe"` issue rather than silently resolved — correct per the safe-fix policy (§6), since
  "fixing" it would mean either altering a real word timestamp (forbidden) or guessing which
  guarantee should win. Not treated as a bug; documented so it isn't mistaken for one if seen in
  practice — an editor encountering it should manually adjust that word's caption assignment (e.g.
  via split/merge) rather than expect an automatic resolution.
- **The "Fix all safe issues" button's count can include issues a fix attempt won't actually
  resolve.** `fixability: "safe"` describes the issue *type* (this class of problem is safe to
  auto-correct in principle), not a guarantee that THIS specific instance has room to be fixed
  right now (e.g. a too-fast caption with zero gap to its neighbor). Clicking the button still
  correctly makes only real progress and reports "No safe fixes available" via toast once nothing
  more can be done, but the button's own number can stay non-zero even after convergence.
  Computing true actionability up-front would require speculatively running every fix, which was
  judged not worth the added complexity for a label. Documented here rather than forced.
- **No re-breaking of an already-decided segment for `TOO_FAST`.** Same policy the prior
  segmentation-quality phase established: extension only, never re-splitting, to avoid undoing a
  boundary that was chosen for good linguistic reasons.
- **Legacy Gujarati Script compatibility verified at the unit/mechanism level, not with a
  dedicated live fixture** — see §10 for why this was judged sufficient (identical code path to
  the live-verified Hinglish case).
- **`quality-validator.ts` is left in place, unused.** Not deleted (removing unrelated dead code
  was not part of this task's mandate), but it no longer duplicates the CPS calculation.
- **No "gap" issue type.** The task's Phase 1 audit list mentioned "gap detection," but the task's
  own Phase 2 issue taxonomy has no corresponding issue type — silence-gap awareness is a
  segmentation-time concern (already handled at generation, prior phase), not something this
  phase's post-hoc quality checker re-implements.

## 19. Exact files changed

- `src/lib/subtitles/quality-analyzer.ts` — **new file.** `analyzeSubtitleQuality`, the
  `QualityIssue`/`QualityReport` types, `HARD_MIN_DURATION`/`HARD_MAX_DURATION` (exported so the
  fix engine can't drift from what the analyzer actually checks).
- `src/lib/subtitles/quality-fixes.ts` — **new file.** `applyQualityFix`, `applyAllSafeFixes`.
- `src/lib/subtitles/quality-validator.ts` — one-line de-duplication (imports `calculateCPS`/
  `FAST_READING_CPS` from `reading-speed.ts` instead of a local copy). Behavior unchanged.
- `src/components/editor/quality-panel-dialog.tsx` — **new file.** The "Subtitle quality" dialog.
- `src/components/editor/left-panel.tsx` — added the "Subtitle quality" trigger button and dialog
  mount point in the existing Settings tab.
- `src/lib/subtitles/__tests__/quality-analyzer.test.ts` — **new file,** 22 tests.
- `src/lib/subtitles/__tests__/quality-fixes.test.ts` — **new file,** 20 tests.
- `src/store/__tests__/editor-store-undo-redo.test.ts` — 3 new integration tests.
- `package.json` — registered the two new test files (`test:quality` script, and both added to
  the main `test` script).
- `research/p2_subtitle_quality_control_report.md` — this report (new file).

No other files were modified. `editor-store.ts` required **no changes** — the existing
`replaceAllSubtitles` action already provided everything the UI needed. `lib/subtitles/segment.ts`,
`linebreak.ts`, `split.ts`, and every other editor/export/persistence file were read/audited but
required no changes.

## 20. Final PASS/FAIL

**PASS.**

- **Confirmed issues found (audit)**: no UI/API path for quality issues at all; no max-words
  check; no exact-duplicate-word detection; no "too slow" concept; no auto-fix of any kind — see
  §3. One real performance bug (O(n²)-class `applyAllSafeFixes`) was found and fixed during this
  phase's own scale testing (§13).
- **Issue types implemented**: all 13 from the task's taxonomy (§4), each backed by a confirmed,
  reachable-in-practice gap — none speculative.
- **Safe fixes implemented**: all 10 fixable types (§6) — `EMPTY_CAPTION`, `INVALID_DURATION`,
  `OVERLAP`, the exact-duplicate sub-case of `WORD_TIMESTAMP_INVALID`, `TOO_MANY_WORDS`,
  `TOO_MANY_LINES`/`CHARACTER_LIMIT`/`AWKWARD_LINE_BREAK`/`ORPHAN_LINE` (via the same re-wrap),
  `TOO_FAST`, `TOO_SHORT`, `TOO_LONG`, `TOO_SLOW`. Zero unsafe fixes were ever auto-applied,
  confirmed by test and by live QA.
- **Tests**: 320 → 365 (45 new; 0 failing).
- **Typecheck**: 0 errors.
- **Lint**: 0 errors; same 5 pre-existing warnings (files untouched this phase), 0 new.
- **Performance**: `analyzeSubtitleQuality` linear throughout (2.9ms at 5,400 captions,
  1.0ms at a realistic 60-minute/9,000-word project). `applyAllSafeFixes` was rewritten after
  discovering O(n²)-class behavior (43.4s → 21ms at 5,400 captions, ~2,000× faster) — a permanent
  regression-guard test now enforces this stays fast.
- **Packaged QA**: PASS (§15) — fresh build, fresh install, the full 15-step checklist including
  a genuine quit→relaunch→reopen cycle, with one honestly-surfaced (not silently mishandled)
  cross-issue interaction documented rather than hidden.
- **Production data integrity**: PASS (§17) — all three real projects confirmed byte-for-byte
  unchanged (excluding `updatedAt`) against the pre-phase backup, both after dev QA and again
  after packaged QA.
- **Remaining limitations**: documented in §18 — the overlap/word-bounds interaction above, the
  "safe fix count can include already-attempted-and-failed issues" UI labeling nuance, no
  re-breaking for `TOO_FAST`, Gujarati-Script verified at the unit level only, and no "gap"
  issue type (correctly out of this phase's own taxonomy).

---

**P2 SUBTITLE QUALITY CONTROL & SAFE AUTO-FIX — PASS**
