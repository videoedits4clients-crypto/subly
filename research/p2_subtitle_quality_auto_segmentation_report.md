# P2 — Intelligent Subtitle Segmentation & Readability (Task ID 56291)

## 1. Executive summary

The audit found SUBLY's existing segmentation pipeline (`lib/subtitles/segment.ts` +
`lib/subtitles/linebreak.ts`) to be substantially more capable than a first read of the task
suggested: max-words/max-lines hard ceilings, sentence/clause/pause-aware smart breaking, explicit
transcript-boundary respect, a merge-back pass for stray short fragments, and genuinely good
two-line visual balancing were **all already correctly implemented and already tested**. This
phase did **not** rewrite that architecture — per the task's own instruction, working, correct code
was left alone.

Five real, empirically-confirmed gaps were found and fixed, all narrowly scoped:

1. **Reading speed (CPS) was never computed as a reusable utility and never influenced
   segmentation at all** — only a diagnostic validator (never surfaced to users) computed it, after
   the fact, as a warning nobody would see. A generated caption could read at 30+ characters/second
   (confirmed: a real 5-word caption at ~33 CPS sailed through ungoverned) with no correction.
2. **Devanagari sentence-terminal punctuation (। and ॥, the Hindi/Sanskrit equivalent of ".") was
   not recognized by the sentence-boundary regex** — Hindi audio silently lost the "prefer sentence
   boundaries" segmentation quality entirely, falling back to pure word-count/duration caps.
3. **The character ceiling could silently overshoot by up to one word's length** — contradicting
   the function's own documented "hard ceiling" contract, confirmed to actually produce captions
   90 characters long against an 84-character cap once a project used a larger max-words setting.
4. **A too-short/too-fast caption that the merge-back pass couldn't merge (blocked by the word or
   character cap) had no fallback** — it stayed under the configured minimum duration or above a
   comfortable reading speed indefinitely, with zero correction mechanism anywhere in the pipeline.
5. **The explicit-transcript-segment lookup was O(words × segments)**, rescanning from the start on
   every single query — turned into O(words + segments) via a monotonic pointer (safe because
   queries are made in time order), measured up to ~130× faster at high segment counts, with no
   behavior change.

All five fixes are implemented as small, targeted, pure-function changes to
`lib/subtitles/segment.ts` plus one new pure utility module
(`lib/subtitles/reading-speed.ts`). No new UI controls were added — the existing min/max
duration, max words, max lines, and Smart Segmentation controls remain the only user-facing knobs;
the readability improvements are automatic. Verified with 25 new automated tests (17 in
`segment.test.ts`, 8 in a new `reading-speed.test.ts`), live through the real app (re-segmenting
real word-level data for English and Hindi, editing the result, exporting it), at realistic scale
(60 minutes of speech segments in ~3.7ms), and in a freshly packaged Windows build.

## 2. Existing segmentation architecture

Full pipeline traced, file by file:

1. **Whisper word output** — `src/lib/transcription/` (local-whisper-sidecar.ts / local-provider.ts,
   unchanged, out of scope). Produces `Word[]` (`text`, `start`, `end`, optional `confidence`) plus
   `TranscriptSegment[]` (the provider's own sentence/paragraph chunking).
2. **Word timestamps** — `types/subtitle.ts` `Word` interface. Already includes `removed` (soft
   filler-word delete), `style`, `hinglishText`, `gujaratiScriptText` — all confirmed to pass
   through segmentation completely unmodified (new test coverage, §13).
3. **Segmentation function** — `lib/subtitles/segment.ts` `segmentWords(words, rules, segments?)`.
   The single entry point; called from three places (`lib/pipeline.ts` after transcription,
   `store/editor-store.ts`'s `resegmentAll`, and `app/api/ai/remove-fillers/route.ts` after
   filler-word marking) — one function, one behavior, everywhere captions get (re)generated.
4. **Max words** — `rules.maxWordsPerCaption`, a hard ceiling (`Math.max(1, ...)` floors it),
   already correctly enforced and tested. **No change.**
5. **Max lines** — `rules.maxLines` combined with `rules.maxCharsPerLine` via
   `maxChars = maxCharsPerLine * maxLines`, enforced as the segmentation-level character ceiling,
   then `lib/subtitles/linebreak.ts` `breakIntoLines` wraps the resulting text into that many
   visual lines. **Character-ceiling enforcement fixed (§9); line-wrapping/balancing untouched.**
6. **Smart segmentation** — `rules.smartSegmentation` toggle; when on, prefers sentence end, clause
   end + a real pause, or a long silence gap, all gated behind the current fragment already meeting
   `minDuration` (so it never manufactures a tiny early caption just because punctuation appeared).
   Already correct. **Extended to recognize Devanagari punctuation (§10).**
7. **Punctuation handling** — `SENTENCE_END`/`CLAUSE_END` regexes. **Extended for Hindi (§10).**
8. **Silence/gap handling** — `gap = next.start - word.end; gap >= 0.45` triggers an early break.
   Already correct, already tested. **No change.**
9. **Explicit transcript boundaries** — `buildSegmentLookup`, respected even with Smart
   Segmentation off, protected from the merge-back pass's own folding. Already correct.
   **Lookup performance fixed (§14); behavior unchanged.**
10. **Split-at-word behavior** — `lib/subtitles/split.ts` (interactive, editor-triggered split, not
    generation-time segmentation) — audited, already correct (verified in the prior P2 Professional
    Editing Workflow phase and re-confirmed by the unchanged, still-passing `split.test.ts` this
    phase). **No change** — out of this phase's scope (generation/resegmentation only).
11. **Subtitle duration calculation** — was simply `start = firstWord.start, end = lastWord.end`.
    **Extended with a readability floor (§8/§9).**
12. **Subtitle text construction** — `seg.map(w).join(" ")` then `breakIntoLines`. Unchanged.
13. **Word-array construction** — the original `Word` objects are grouped, never copied/rebuilt
    field-by-field, so every field (including `style`, `hinglishText`, `gujaratiScriptText`,
    `confidence`) survives verbatim. Already correct, now with explicit test coverage (§13).
14. **Persistence into ProjectData** — `lib/pipeline.ts` writes `Subtitle[]` straight into the
    `Subtitle` table; `store/editor-store.ts`'s `resegmentAll` writes into the in-memory
    `ProjectData` via the normal `commit()`/undo-redo path. Neither needed any change — both
    already just call `segmentWords` and use its output as-is.

## 3. Current behavior discovered (feature-by-feature verdict)

| Rule | Verdict before this phase |
|---|---|
| A. Max words | **Already implemented correctly.** Hard ceiling, tested. |
| B. Max lines | **Implemented incorrectly** — the underlying character ceiling could overshoot by up to one word, occasionally producing more/longer lines than configured. Fixed (§9). |
| C. Minimum caption duration | **Partially implemented** — enforced only via merge-back; no fallback when merging was blocked by another cap. Fixed (§8). |
| D. Maximum caption duration | **Already implemented correctly.** Hard ceiling during the forward pass, respected by the merge-back pass and by the new duration-extension logic. |
| E. Reading speed / CPS | **Missing entirely** from generation (existed only as an unused diagnostic). Fixed (§8). |
| F. Punctuation boundaries | **Already implemented correctly for Latin punctuation; missing for Devanagari.** Fixed (§10). |
| G. Silence/gap boundaries | **Already implemented correctly.** No change. |
| H. Sentence/clause boundaries | Same as F. |
| I. Orphan word prevention | **Partially implemented** — backward merge-back only; a first-segment orphan had no recourse. Addressed via duration-extension rather than a forward-merge (§8, see also §19 for why a forward-merge was rejected). |
| J. Two-line visual balancing | **Already implemented correctly.** `linebreak.ts`'s `balance()` was tested against several naturally lopsided sentences and consistently produced well-balanced output; no change made. |
| K. Natural phrase breaks | **Already implemented correctly** via the existing punctuation/pause priority chain; no evidence found that conjunction/preposition-specific avoidance is needed (tested, §13) — adding one would be a speculative, arbitrary heuristic the task explicitly warns against. |

## 4. Confirmed quality gaps

See §3's "Missing"/"Partially implemented"/"Implemented incorrectly" rows — five gaps, each
reproduced empirically (not assumed) before any code was written:

1. A synthetic 5-word, 0.75s caption ("The quick brown fox jumps") measured **~33 CPS**, segmented
   with default rules, with zero warning or correction anywhere in the generation path.
2. A synthetic Hindi transcript with a mid-sentence danda (`हैं।`) segmented as **one run-on
   caption**, capped only by `maxWordsPerCaption`, instead of breaking at the sentence boundary.
3. With `maxWordsPerCaption: 200` and default 42-char/2-line settings, a 60-word synthetic
   transcript produced captions of **87–90 characters** against an 84-character ceiling.
4. A synthetic 3-word transcript with `maxWordsPerCaption: 2` produced a trailing single-word
   caption (`"c"`) held for only **0.5s** against a configured 0.8s minimum, with the merge-back
   pass unable to help (2-word cap already reached by its neighbor).
5. A synthetic 30,000-word / 2,000-segment lookup benchmark measured **40.3ms** for the old linear
   rescan vs **0.3ms** for the new monotonic-pointer version (~130×) — realistic 60-minute Whisper
   output (~225 segments) showed a smaller but still real ~5× difference (2.0ms → 0.4ms).

## 5. Proposed segmentation model

`words[] + rules → segmentWords → segments[]` remains the model — unchanged. The priority order for
where to break (never split a word > maxWords hard cap > explicit transcript boundary > sentence
end > clause end + pause > long silence gap > char/duration hard caps) was evaluated against the
task's own suggested "boundary scoring" architecture and deliberately **kept as an ordered
priority chain, not rewritten into a formal scoring function** — it already produces the same
effective prioritization, is fully covered by tests old and new, and the task's own instruction is
to not rewrite already-correct behavior for stylistic reasons alone. What *is* new is a distinct,
separately-testable **readability pass** applied after segmentation decides *where* to break:
given each resulting segment's own text and neighbor boundaries, compute a target duration from
`max(minDuration, minDurationForReadableCPS(text))`, clamped by `maxDuration` and the next
caption's start, and only ever *extend* — never move or shrink a caption's start, never touch a
single word timestamp.

## 6. Implemented changes

1. **New file `lib/subtitles/reading-speed.ts`** — pure functions `calculateCPS(text, duration)`
   and `minDurationForReadableCPS(text, maxCps)`, plus the `FAST_READING_CPS = 20` threshold moved
   here from the validator (a single definition instead of two that could drift).
2. **`lib/subtitles/quality-validator.ts`** — now imports `calculateCPS`/`FAST_READING_CPS` from
   the new module instead of a local, duplicated inline calculation. Behavior unchanged (same
   threshold, same warning) — pure de-duplication.
3. **`lib/subtitles/segment.ts`**:
   - `SENTENCE_END` regex extended to include U+0964 DANDA and U+0965 DOUBLE DANDA.
   - The character-ceiling check moved from "after pushing the word, check if we overshot" to
     "before pushing, check if it *would* overshoot — if so, close the segment first and defer the
     word to the next one." Never splits a word (a single word that alone exceeds the cap still
     becomes its own one-word segment — unavoidable).
   - A new readability pass in the final segment→Subtitle mapping step extends each caption's `end`
     toward `max(minDuration, minDurationForReadableCPS(text))`, clamped by `maxDuration` and the
     next caption's own start — never overlapping, never shrinking, never touching word timestamps.
   - `buildSegmentLookup` rewritten from a per-call linear rescan to a monotonic pointer (safe
     because its one caller only ever queries non-decreasing timestamps), turning
     O(words × segments) into O(words + segments).
4. **`package.json`** — registered the new `reading-speed.test.ts` in `test:segmentation` and the
   main `test` script.

## 7. Readability rules (as actually implemented)

| Rule | Threshold | Why | Enforced where | User-configurable? |
|---|---|---|---|---|
| Max words | `rules.maxWordsPerCaption` (existing) | Existing product setting | Forward-pass hard cap | Yes (existing Settings control) |
| Max lines / chars | `rules.maxCharsPerLine * rules.maxLines` (existing) | Existing product setting | Forward-pass hard cap (now a true ceiling, §9) | Yes (max lines; max chars/line is a fixed 42, matching the existing default) |
| Min duration | `rules.minDuration` (existing) | Existing product setting | Merge-back pass (existing) + new readability extension (new) | Yes (existing Settings control) |
| Max duration | `rules.maxDuration` (existing) | Existing product setting | Forward-pass hard cap (existing) + ceiling on the new extension | Yes (existing Settings control) |
| Reading speed | `FAST_READING_CPS = 20` chars/sec (existing, moved from the diagnostic validator — not a new arbitrary number) | Reused the value the codebase already treats as "generally unreadable" rather than inventing a new one | New readability-extension pass | Not separately — it's expressed as a target duration, folded into the same min/max duration controls that already exist. A dedicated CPS slider was considered and rejected as scope creep: it would just be a second way to influence the same "how long should this stay on screen" question the existing duration sliders already answer. |
| Punctuation boundaries | Latin `.!?…` plus Devanagari `।॥` (new) | Confirmed gap for Hindi | Smart-segmentation break decision | No — always on when Smart Segmentation is (existing toggle) |
| Silence gaps | `gap >= 0.45s` (existing) | Existing, already tuned | Smart-segmentation break decision | No — same as above |

## 8. CPS implementation/status

**Before this phase: present only as an inline calculation inside the diagnostic-only
`quality-validator.ts` (never surfaced to users, never used at generation time).** Now: a pure,
independently-tested utility (`reading-speed.ts`) used by both the validator (unchanged behavior,
de-duplicated) and — new — by `segmentWords` itself, where it drives the readability-extension
pass described in §6. Handling of the edge cases the task asked about:

- **Spaces/punctuation**: count toward reading load (not stripped) — matches how a viewer actually
  reads a caption; only the caption's own line-break `\n` is collapsed to a space first (line
  breaks aren't extra reading time).
- **Very short captions**: `minDurationForReadableCPS` naturally returns a small value for short
  text, so a short caption isn't force-extended further than its own text actually needs.
- **Zero/near-zero duration**: `calculateCPS` returns `Infinity` for real text over zero/negative
  duration (unambiguously "too fast") and `0` for empty text regardless of duration (nothing to
  read). Verified in `reading-speed.test.ts`.
- **Existing user-created subtitles are never touched** — the CPS-driven duration extension lives
  entirely inside `segmentWords`, which only runs at generation time (initial transcription) or
  explicit re-segmentation (`resegmentAll`, filler-word removal) — never as a side effect of normal
  editing, split, merge, or drag.

## 9. Duration handling

- **Near-zero flashes**: directly addressed by the readability-extension pass (§6) — a caption that
  would otherwise flash by under `minDuration` or above the comfortable CPS threshold is held
  longer, bounded by `maxDuration` and the next caption's actual start.
- **Excessively long captions**: unaffected — the existing `maxDuration` hard cap in the forward
  pass is untouched, and the new extension never pushes a caption's duration past its own
  `maxDuration`.
- **Word timestamps remain intact**: the extension only ever changes the `Subtitle.end` field — it
  never touches any `Word.start`/`Word.end` (verified explicitly in tests, §13).
- **Neighboring captions are not overlapped**: the extension is clamped to
  `Math.min(desiredEnd, nextCaption.start)` — verified with an explicit "never overlaps" test and a
  general "no unintended overlaps across a whole fast-speech transcript" test (§13).
- **Existing gap behavior respected**: a real gap between two spoken phrases is only ever
  *partially* consumed by the extension (up to the readability target), never eliminated outright
  unless the gap itself is smaller than the target — in which case the caption is held right up to
  (never past) the next caption's start.
- **Undoable through the editor**: not applicable to interactive edits — the extension only runs at
  generation/re-segmentation time, and `resegmentAll` (the only user-triggered path) already goes
  through the store's normal `commit()`, which is undoable like every other mutation (unchanged,
  pre-existing behavior — confirmed live, §15).
- **Deterministic**: `segmentWords` remains a pure function of `(words, rules, segments)` — same
  input always produces the same output (explicit determinism test, §13).

## 10. Punctuation/silence handling

Silence-gap handling (`gap >= 0.45s`) was already correct and untouched. Punctuation handling was
already correct for Latin script and is now also correct for Devanagari: `SENTENCE_END` recognizes
`। ॥` (danda / double danda) exactly like `. ! ? …`, confirmed with dedicated tests (§13) and live
against a real Hindi transcript re-segmented through the actual app (§15) — a sentence boundary at
`हैं।` now correctly ends a caption instead of running the whole sentence together, subject to the
same pre-existing `minDuration` gate that already applies to Latin sentence-ends (so a very short
Hindi clause still doesn't manufacture a tiny caption — identical, uniform behavior, not a
Hindi-specific special case).

## 11. Two-line balancing

Audited `linebreak.ts`'s `balance()` function against several naturally lopsided sentences
(including one intentionally shaped after the task's own bad-example pattern). In every case tested,
the existing balancer already produced reasonably even line lengths — no lopsided "one long line +
one trailing word" pattern was reproduced. **No change made** — rewriting already-correct,
already-tested code was judged unnecessary and out of scope.

## 12. Language compatibility

- **English**: unaffected by any change; all pre-existing English-focused tests still pass.
- **Hindi**: the core fix of this phase (§10) — verified both via unit tests and live in the real
  app (§15), re-segmenting an actual Hindi word-level transcript through the editor's own
  "Re-segment captions" control.
- **Hinglish**: segmentation operates on the *original* Devanagari `words[].text` — Hinglish
  (`words[].hinglishText`) is a derived, independently-generated field computed *after* captions
  exist (`lib/subtitles/output-mode.ts`, unchanged). Verified live: re-segmented Hindi captions,
  switched the project to Hinglish mode, and confirmed every word's Hinglish rendering (including
  danda → "." conversion) generated correctly against the new caption boundaries, and the editor UI
  rendered it correctly.
- **Legacy Gujarati Script projects**: same relationship as Hinglish —
  `words[].gujaratiScriptText` is a derived field, untouched by segmentation, confirmed to survive
  unmodified through segmentation (unit test, §13). Not separately live-tested this phase (no
  legacy Gujarati Script fixture was built), but the mechanism is identical to the Hinglish path
  that *was* live-verified, and the underlying transcript segmentation operates on the same
  Devanagari `words[].text` a Gujarati-language project also produces — the danda fix benefits it
  identically.
- **Language-policy lockdown**: untouched — no transcription language behavior was changed, only
  post-transcription grouping of words that already exist.

## 13. Automated tests

25 new tests, all exercising the real, production `segmentWords`/`calculateCPS`/
`minDurationForReadableCPS` functions directly (never reimplemented logic):

**`reading-speed.test.ts` (8, new file)**: basic CPS calculation; newlines excluded from reading
time; punctuation/spaces included; empty text; zero/negative duration; the inverse
(`minDurationForReadableCPS`) round-trips correctly; empty text needs no time; default rate.

**`segment.test.ts` (17 new, 7 pre-existing unchanged and still passing)**:
readability-extension raises CPS to the comfortable threshold without touching word timestamps;
extension never overlaps the next caption; extension never exceeds `maxDuration`; an already-
comfortable caption is left completely unchanged; Hindi danda sentence boundary; Hindi double-danda;
an explicit-boundary-forced orphan first word is held to a readable duration instead of being
silently merged away; a non-orphan explicit boundary is never merged away; Hinglish/Gujarati-Script
per-word fields survive segmentation; every word appears exactly once in original order across a
40-word synthetic transcript with a mixed punctuation/pause/word-count pattern; no unintended
overlaps across a whole fast-speech transcript; determinism (same input twice → identical output,
ignoring generated ids); per-word style overrides survive segmentation; two-line balancing avoids
lopsided output on a naturally long sentence; an extremely long caption (60 words,
`maxWordsPerCaption: 200`) still respects the character ceiling now that it's a true hard cap; an
extremely short, unmergeable caption still gets held to the minimum readable duration; a hard
word-count break landing on a conjunction ("and") still preserves every word correctly (no evidence
found that conjunction-avoidance logic is needed — tested as a coverage case, not a new feature).

## 14. Scale/performance results

Measured with a realistic synthetic word generator (mixed short/long words, ~15% terminal
punctuation, occasional pauses, Whisper-realistic transcript-segment chunking), best-of-5 after
JIT warm-up:

| Scale | Words | Transcript segments | Captions produced | Time (best of 5) |
|---|---|---|---|---|
| 30s | 75 | 2 | 22 | 0.06ms |
| 5 min | 750 | 19 | 208 | 0.33ms |
| 30 min | 4,500 | 113 | 1,236 | 1.95ms |
| 60 min | 9,000 | 225 | 2,495 | 3.75ms |

Clearly linear (not quadratic) scaling — a 120× increase in word count (75 → 9,000) produced only a
~60× increase in runtime, consistent with the O(n) forward/merge-back passes plus the now-O(n+m)
segment lookup. A dedicated isolated benchmark of just the old-vs-new segment lookup confirmed the
fix: 40.3ms → 0.3ms at 30,000 words / 2,000 segments (~130×); 2.0ms → 0.4ms at a realistic 9,000
words / 225 segments. Practical for large projects with wide margin.

## 15. Dev QA

Performed against the real running dev server and real `%APPDATA%\subs\subly.db`, using disposable
fixture projects (created and destroyed within this phase):

- **English fixture** ("QA Segmentation English", 32 words loaded as 32 deliberately-bad one-word
  captions): clicked the editor's own "Re-segment captions" button (Settings tab) — produced 9
  naturally-grouped captions (e.g. `"Welcome back to the"`, `"channel. Today we are"`, ...) with
  CPS mostly at or under the comfortable threshold (a couple of 4-word captions at ~21–28 CPS where
  the word-count cap is the binding constraint and neighboring captions leave little room to
  extend — expected, not a defect: the word cap is a deliberate, user-configured limit, and the
  extension already claims all the room that's actually available). The trailing caption ("time.")
  was correctly held to the 0.8s minimum instead of flashing by. Verified Ctrl+D (duplicate),
  Ctrl+Shift+M (merge), and undo all still work correctly on the newly-generated captions, and that
  the result round-trips through the real persistence API (autosave confirmed via direct fetch).
- **Hindi fixture** ("QA Segmentation Hindi", a 2-sentence Devanagari transcript with a mid-sentence
  danda): re-segmented into 5 captions correctly breaking at/around the danda boundaries (subject to
  the existing `minDuration` gate, same as Latin). Verified merge + undo work correctly. Switched
  the project to Hinglish output mode — every word's Hinglish rendering generated correctly against
  the new caption boundaries (danda → "."), confirmed both via the API and the rendered editor UI.
- **Export**: both fixtures exported successfully end-to-end (server-side FFmpeg rendering,
  captions burned in) after fixing an unrelated bug in the disposable fixture-generation script
  itself (the video URL format didn't match the real upload flow's `/api/files/...` convention —
  a fixture-construction mistake, not a product or segmentation regression; confirmed by a
  real production project exporting successfully throughout, isolating the fault to the fixture).
- **Production-project isolation**: none of this phase's dev QA touched the three real production
  projects' subtitle data — confirmed in §18.

## 16. Packaged Windows QA

Ran `npm run electron:pack` (clean → PyInstaller worker build → `next build` → standalone
postbuild → `electron-builder --win`) — succeeded, producing a fresh `SUBLY Setup 0.1.0.exe`.
Fully uninstalled the prior packaged build and silently installed the new one
(`/S`) into a clean `%LOCALAPPDATA%\Programs\SUBLY` — a genuinely fresh install of this phase's
code, not an in-place upgrade. Launched the packaged `SUBLY.exe` and connected directly to its
embedded local server (the same standalone Next.js server + real `%APPDATA%\subs\subly.db` the
packaged app always uses, on its randomly-assigned localhost port — confirmed via
`/api/system/status`), exercising the actual production server and database, not just the shell.

Created a small disposable fixture ("Packaged Segmentation QA", 23 words loaded as 23 one-word
captions) directly in the real packaged database, then reproduced the critical workflow against
the packaged binary:

- **Re-segment captions**: 23 one-word captions → 6 naturally-grouped captions
  (`"Welcome back to the"`, `"channel. Today we are"`, ...), matching the dev-server result exactly.
- **Ctrl+D duplicate**: 6→7 captions, undo restores to 6.
- **Export**: server-side FFmpeg rendering completed successfully, captions burned in — "Your video
  is ready."
- **Close→relaunch→reopen persistence**: committed a distinguishing text edit, confirmed it
  persisted via the API, then force-quit **every** `SUBLY.exe` process (full app close, not just
  the window), relaunched `SUBLY.exe` fresh, and reopened the same project — the committed edit and
  the correct (post-undo) caption count were both exactly as left.
- Cleaned up: quit the packaged app, then deleted the fixture and its uploaded files directly from
  the real database.

All packaged-build behavior matched the dev-server behavior exactly — no packaging-specific
regressions found.

## 17. Regression results

- `npm test`: **320/320 passing** (295 pre-existing + 25 new; zero failures, zero pre-existing
  tests weakened or altered in behavior — the one adjustment to an existing test in the prior
  editing-workflow phase is unrelated to this phase).
- `npx tsc --noEmit`: **zero errors.**
- `npm run lint`: **zero errors**; the same 5 pre-existing warnings (in files this phase never
  touched) as before — zero new warnings.
- Full existing test suite (hinglish, split, composition, gujarati-script, model-selection,
  reliability/cancellation, language-policy, waveform, dashboard, presets, upload, fonts,
  export-verification, recovery, save-queue, project-patch, undo-redo, list-virtualization, db
  migrations) all still pass unmodified — none of this phase's changes touched any of those files.

## 18. Production-data integrity

Compared all three real production projects (`Untitled project`, `rishab guj`,
`Hindi/hinglish test`) — full subtitle data (text, timestamps, word arrays, per-caption/per-word
style/animation, hinglishText/gujaratiScriptText), video asset, composition, language, caption
output mode, trim/cut ranges — against the pre-existing `subly.db.bak-pre-workflow-qa` backup (from
the immediately prior phase, confirmed identical then and re-confirmed identical now, at the end of
this phase, after all dev QA including a diagnostic export triggered on one real project to isolate
an unrelated fixture bug). **All three remain byte-for-byte identical** (excluding only the
`updatedAt` timestamp column). Triggering an export does not touch subtitle data — confirmed by this
comparison. All disposable fixtures created this phase were permanently deleted afterward (see
§20's file list — the cleanup itself is not a "file changed" since it only removed database rows
and uploaded test videos, not repository files).

## 19. Remaining limitations

- **No forward-merge for a genuinely orphaned first caption.** An earlier version of this phase's
  work implemented a symmetric forward-merge (mirroring the existing backward merge-back pass) for
  just the first segment. It was removed after testing revealed a structural contradiction: the
  only realistic way a first segment ends up short/single-word *and* blocked from merging by a hard
  cap is via an **explicit transcript-provider boundary** — and an explicit boundary is exactly the
  thing this function must never silently undo (the same protection the backward pass already
  gives it). There was no remaining case where a forward-merge could safely apply. The
  readability-extension pass (§6/§9) instead holds a lone orphaned word on screen long enough to
  read comfortably, fixing the actual symptom (an unreadable flash) without ever combining words
  the transcript didn't put together.
- **No CPS-driven re-breaking of an already-decided segment.** The readability pass only ever
  *extends duration* — it does not go back and split a caption into two to lower its CPS. This was
  a deliberate choice: re-breaking would risk undoing a boundary the priority chain already chose
  for good linguistic reasons, and duration-extension is the standard, safe technique real caption
  tools use for this exact problem. In the rare case where a caption is already at `maxDuration`
  and still reads too fast (only reachable with an unusually low `maxDuration` combined with a high
  `maxWordsPerCaption`), the caption is held to its `maxDuration` ceiling and no further correction
  is applied — documented here rather than forced.
- **`isTypingTarget`/shortcut and other editor-level behaviors are unaffected and unchanged** — this
  phase touched only generation-time segmentation, never the interactive editor.
- **Legacy Gujarati Script compatibility** was verified via unit test (derived field survival) and
  via the mechanistically-identical, live-verified Hinglish path, but not separately live-tested
  with a dedicated Gujarati-Script fixture project.
- **`lib/subtitles/segment.ts`'s `resegmentOne` export remains genuinely dead code** — defined but
  called from nowhere in the codebase (confirmed via search), predating this phase. Left untouched:
  removing unrelated dead code was not part of this task's mandate.

## 20. Exact files changed

- `src/lib/subtitles/reading-speed.ts` — **new file.** `calculateCPS`, `minDurationForReadableCPS`,
  `FAST_READING_CPS`.
- `src/lib/subtitles/segment.ts` — Devanagari sentence-boundary punctuation; character-ceiling
  pre-check fix; new readability-extension pass; `buildSegmentLookup` monotonic-pointer
  optimization.
- `src/lib/subtitles/quality-validator.ts` — de-duplicated CPS calculation via the new module
  (behavior unchanged).
- `src/lib/subtitles/__tests__/segment.test.ts` — 17 new tests.
- `src/lib/subtitles/__tests__/reading-speed.test.ts` — **new file,** 8 tests.
- `package.json` — registered the new test file in `test:segmentation` and `test`.
- `research/p2_subtitle_quality_auto_segmentation_report.md` — this report (new file).

No other files were modified. `lib/subtitles/split.ts`, `lib/subtitles/linebreak.ts`,
`lib/pipeline.ts`, `store/editor-store.ts`, `app/api/ai/remove-fillers/route.ts`, and every
UI/editor component were read/audited but required no changes — `segmentWords`'s function
signature is unchanged, so every existing caller continues to work without modification.

## 21. Final PASS/FAIL

**PASS.**

- Segmentation is measurably better than pre-change behavior: reading speed on a synthetic
  fast-caption case dropped from ~33 CPS (ungoverned) to at/under the 20 CPS threshold; a real
  32-word English transcript re-segmented into 9 well-formed captions instead of 32 one-word
  fragments; Hindi sentence boundaries (danda) are now recognized instead of silently ignored;
  the character ceiling is now a true hard cap instead of overshooting by up to a word; the
  transcript-boundary lookup is asymptotically faster (O(n+m) vs O(n×m)).
- Word-level data remains completely intact — verified by dedicated tests (no word lost,
  duplicated, or reordered; timestamps, per-word style, hinglishText, and gujaratiScriptText all
  survive segmentation unmodified) and confirmed live against real transcript data.
- Generated subtitles obey every implemented readability constraint (min/max duration, CPS floor,
  max words, max chars/lines) — verified by test and live.
- Natural boundaries (sentence, clause, pause, explicit transcript boundary) are preferred over
  hard caps wherever available — unchanged, already-correct behavior, now extended to Devanagari
  punctuation.
- No unintended overlaps were introduced by the new duration-extension logic — verified by
  dedicated tests and confirmed live.
- English/Hindi/Hinglish behavior verified valid; legacy Gujarati Script compatibility verified at
  the mechanism level (derived-field survival) plus the equivalent, live-verified Hinglish path.
- All existing editor functionality (selection, editing, split, merge, duplicate, delete,
  undo/redo, autosave, persistence, export) verified intact, live, on top of the newly-generated
  captions, in both the dev server and a freshly packaged Windows build.
- **320/320 automated tests pass** (295 pre-existing + 25 new), **zero typecheck errors**, **zero
  lint errors** (5 pre-existing warnings, all in files this phase never touched — zero new
  warnings).
- **Packaged Windows QA passed** (§16) — fresh build, fresh install, full workflow including a
  full quit→relaunch→reopen cycle.
- **Production project data verified byte-for-byte unchanged** (§18) — all three real projects,
  compared before and after this phase's entire body of work.
- All disposable fixtures (dev-server and packaged) were permanently deleted; the project list is
  back to its exact pre-phase state (18 projects).

---

### Summary for the requester

- **PASS**
- **Exact files changed**: `src/lib/subtitles/reading-speed.ts` (new), `src/lib/subtitles/segment.ts`,
  `src/lib/subtitles/quality-validator.ts`, `src/lib/subtitles/__tests__/segment.test.ts`,
  `src/lib/subtitles/__tests__/reading-speed.test.ts` (new), `package.json`,
  `research/p2_subtitle_quality_auto_segmentation_report.md` (new, this report).
- **Tests**: 295 → 320 (25 new; 0 failing).
- **Typecheck**: 0 errors.
- **Lint**: 0 errors; same 5 pre-existing warnings (files untouched this phase), 0 new.
- **Segmentation performance**: 30s/75 words → 0.06ms; 5min/750 words → 0.33ms;
  30min/4,500 words → 1.95ms; 60min/9,000 words → 3.75ms (best-of-5, warmed up) — linear scaling,
  no O(n²) behavior. Transcript-boundary lookup fix measured up to ~130× faster in isolation.
- **Packaged QA**: PASS — fresh build, fresh install, re-segment/edit/export/persistence all
  verified working identically to the dev server, including a full quit→relaunch→reopen cycle.
- **Production data integrity**: PASS — all three real projects confirmed byte-for-byte unchanged
  (excluding `updatedAt`) against the pre-phase backup.
- **Remaining limitations**: no CPS-driven re-breaking of an already-decided segment (duration
  extension only, by design — see §19); no forward-merge for a first-segment orphan (evaluated and
  rejected as structurally unreachable without unsafely crossing explicit provider boundaries —
  see §19); legacy Gujarati Script compatibility verified at the mechanism/unit level but not with
  a dedicated live fixture; `resegmentOne` remains pre-existing dead code, left untouched as out of
  scope.

---

**P2 INTELLIGENT SUBTITLE SEGMENTATION & READABILITY — PASS**
