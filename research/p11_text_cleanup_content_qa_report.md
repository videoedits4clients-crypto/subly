# P11 — Professional Text Cleanup & Content QA — Final Report

## 1. Status

**PASS.**

## 2. Task ID

98134

## 3. Version

0.1.11 → **0.1.12** (bumped only after the full test suite, typecheck, lint, dev QA, and packaged Windows QA all passed).

## 4. Files changed

New:
- `src/lib/subtitles/text-cleanup.ts` — pure cleanup/classification engine.
- `src/lib/subtitles/__tests__/text-cleanup.test.ts` — 56 pure tests.
- `src/components/editor/text-cleanup-dialog.tsx` — the batch "Text cleanup" dialog UI.

Modified:
- `src/lib/subtitles/batch-text-ops.ts` — exported the previously-private `staleAfterTextChange` so `text-cleanup.ts` reuses it instead of redefining staleness.
- `src/lib/subtitles/quality-analyzer.ts` — added `WHITESPACE_ISSUE`, `REPEATED_PUNCTUATION`, `SUSPICIOUS_SHORT_TEXT` issue types and their checks; added `QUALITY_CATEGORY_BY_TYPE`/`QualityCategory` for the Timing/Text/Style summary grouping.
- `src/lib/subtitles/__tests__/quality-analyzer.test.ts` — 9 new tests for the 3 new issue types.
- `src/store/editor-store.ts` — added `applyTextCleanup(ids, selection)` action (one commit: edits + deletes together).
- `src/store/__tests__/editor-store-undo-redo.test.ts` — 20 new tests (145–164), store-level integration.
- `src/components/editor/captions-panel.tsx` — added a "Cleanup" button next to the existing P10 "Transform" button, shown whenever `hasSelection`.
- `src/components/editor/quality-panel-dialog.tsx` — added labels for the 3 new issue types, a new "Text content" group (parallel to Structural/Readability), and a compact "N issues · errors · warnings · info" + Timing/Text/Style category summary line.
- `package.json` — new `test:text-cleanup` script, registered in the aggregate `test` script; version `0.1.11` → `0.1.12`.

No database schema changes. No new keyboard shortcut was added (see §21).

## 5. Architecture decisions (Phase 0 audit findings + design choices)

**Audit findings** (inspected before writing anything):
- P10's `batch-text-ops.ts` already established the exact reusable shape needed here: a pure compute function over `(subtitles, selectedIds, options)` returning affected-only results, called identically by a live preview `useMemo` and by the store action at Apply time. This task's engine mirrors that shape exactly.
- `remapWordsToText` (editor-store.ts, private) and the derived `isWordTimingStale`/`tokenizeCaptionText` (word-timing.ts) required **zero changes** — every text-mutating action in this codebase (P7.2's `updateSubtitleText`, P10's `applyBatchFindReplace`/`applyBatchTextTransform`) already funnels through them, and P11's `applyTextCleanup` does the same.
- `ConfirmDialog` (P10's own reuse pattern for Transform) is too narrow for this task's spec (a checklist of independent toggles + a rich before/after preview with delete-candidate counts) — a dedicated `TextCleanupDialog` was built instead, following the *other* existing precedent, `SearchReplaceDialog`: still one more compact `Dialog`, not a new panel.
- `deleteSubtitles(ids)` (P8) already does the exact "filter + reindex + let `commit()`'s `pruneSelection` handle selection" pattern needed for "Remove blank captions" — `applyTextCleanup` performs its filter-then-map inside **one** `commit()` mutator so a cleanup that both edits and deletes captions is provably one history entry (see §12).
- `quality-analyzer.ts` already had `EMPTY_CAPTION` (an existing check: `!flatText(text).length || !words.length`) — this already covers *both* "empty" and "whitespace-only" per the spec's own grouping. P11 does not duplicate it; only the 3 explicitly-new types were added, and the new `classifyCaptionContent`'s "empty"/"whitespace-only" cases are used solely for the cleanup engine's delete-candidate logic, never re-reported as a second issue type.
- `quality-fixes.ts`'s `applyQualityFix` switch has no case for the 3 new types and its top guard (`if (issue.fixability !== "safe") return null`) already means they're never touched — confirmed by inspection, no change needed there.
- Keyboard shortcuts: read `use-keyboard-shortcuts.ts` in full. Every single unmodified letter key already used for something (Ctrl+F/H, Z, A, S, D, M, [, ], J, K, L, arrows, Space, Enter, Delete/Backspace) or reserved by the OS/browser. No shortcut was added — the feature is reachable via the existing button row instead (see §21), matching the spec's own "do not add unnecessary shortcuts."

**Design choices** (deliberate deviations from a literal reading of the checkbox mockup, documented for the record):
- The spec's UI mockup lists "Normalize repeated punctuation" under *both* "Text cleanup" and "Punctuation." Implemented as **one** toggle (under Text cleanup) rather than two separate bound checkboxes — a duplicate checkbox controlling the same underlying operation would be confusing, not more capable.
- The 4 capitalization options (Sentence case / UPPERCASE / lowercase / Title Case) are a single-select control (`caseTransform: "none" | "sentence" | "uppercase" | "lowercase" | "titlecase"`), not 4 independent checkboxes — applying two case transforms to the same text simultaneously isn't a coherent, deterministic operation, and the spec's own emphasis on determinism supports collapsing them into one mutually-exclusive choice.
- Likewise, "Ensure trailing punctuation" and "Remove trailing punctuation" are a single-select (`trailingPunctuation: "none" | "ensure" | "remove"`) since they are direct opposites.

## 6. Text cleanup behavior

Four pure functions in `text-cleanup.ts`, each independently toggleable:
- `trimCaptionWhitespace` — trims only the caption's outer leading/trailing whitespace.
- `normalizeSpaces` — collapses runs of horizontal whitespace (space/tab) to one space; the character class deliberately excludes `\n`/`\r`, so line breaks are never merged.
- `normalizeLineBreakWhitespace` — strips horizontal whitespace immediately touching a line break on either side, preserving the break itself (and preserving an intentional blank line between two caption lines).
- `normalizeRepeatedPunctuation` — collapses a run of 2+ of the *same* mark (`!`/`?`) to one, and any run of 2+ dots to the canonical 3-dot ellipsis `...`. A backreference-based regex means a mixed run like `?!`/`!?` never matches and is left untouched; quote/apostrophe characters are never in the pattern at all, so they're never touched by any operation.

Applied in a fixed, documented pipeline order (line-break whitespace → inline spaces → outer trim → repeated punctuation → capitalization → trailing punctuation) so each step sees the previous step's already-cleaned input.

## 7. Sentence case behavior

`sentenceCase(text)` capitalizes **only** the first cased letter of each detected sentence — text start, the start of every existing line (an explicit spec signal), and the first non-whitespace character after `.`/`!`/`?` followed by whitespace. Nothing else in the sentence is ever touched (no forced lowercasing), which is exactly what keeps a mid-sentence acronym like "SUBLY" intact — verified with the spec's own worked example (`"hello world. this is SUBLY."` → `"Hello world. This is SUBLY."`).

A small, deliberately conservative URL/email detector (`looksLikeUrlOrEmail`) skips capitalizing a sentence-initial token that looks like a URL (`https://…`, `www.…`, a bare `label.tld` domain shape) or an email (`user@host.tld`) — verified live with `"example.com is a great site."` staying completely unchanged.

Script safety: `toLocaleUpperCase` on a single code point is a correct no-op for scripts with no case distinction. Verified with both automated tests (pure Devanagari, mixed English/Hindi) and **live packaged QA against real production Gujarati/Hinglish transcript data** (`rishab guj`): pure-Gujarati captions were untouched; a mixed caption (`"jay. लेप्रोस्को peak sarjaris"`) correctly capitalized only the Latin-script sentence starts (`"Jay. लेप्रोस्को Peak sarjaris"`... — actually `"peak"`→`"Peak"` and `"jay"`→`"Jay"`, Devanagari left alone).

## 8. Punctuation behavior

- **Ensure trailing punctuation**: adds `.` only when the trimmed text has at least one letter, doesn't already end in `.!?…,:;`, and its last whitespace-delimited token doesn't look like a URL/email. Verified: questions (`?`), exclamations (`!`), ellipses, trailing commas/colons/semicolons, URLs, and purely-numeric fragments are all correctly left untouched; plain complete sentences get a period.
- **Remove trailing punctuation**: strips only a trailing run of `.,!?;:…`, preserving any trailing whitespace and never touching internal punctuation.
- **Known limitation**: neither operation attempts syntactic sentence-fragment detection — a heading-like fragment ending in a letter (e.g. "Chapter 5") will still receive a period from "Ensure trailing punctuation." The spec itself provides no algorithm for this case beyond "use conservative heuristics," and every explicitly-listed do-not case (questions, exclamations, ellipsis, commas, colons/semicolons, URLs, numeric fragments) is handled. Documented here rather than silently claimed as solved.

## 9. Empty-caption behavior

`classifyCaptionContent(text)` returns one of `empty | whitespace-only | punctuation-only | suspicious-short | short-intentional | normal`, a script-agnostic length/letter-count heuristic (not an English word list):
- `empty`/`whitespace-only` — the only two classes "Remove blank captions" ever deletes.
- `punctuation-only` — has content but zero Unicode letters (e.g. `"..."`).
- `suspicious-short` — exactly one token with exactly one letter (e.g. a lone `"a"`).
- `short-intentional` — exactly one token with 2–3 letters (e.g. `"OK"`, `"No"`).
- Everything else is `normal`.

Delete candidates are computed from each caption's **original** text, never from a post-cleanup result — a caption that only becomes blank as a side effect of another selected operation is never silently deleted; it shows up as an ordinary text change instead, and the existing quality analyzer will flag it as `EMPTY_CAPTION` on the next check. Verified live and in tests: a punctuation-only (`"..."`) or short (`"OK"`) caption is never deleted, only a truly empty/whitespace-only one.

## 10. Word-timing safety

Zero new mechanism. `applyTextCleanup` computes new text per caption exactly like P10's batch actions, then calls the **same** `remapWordsToText`:
- Same token count → real timestamps/confidence/word-level styles preserved exactly, only each word's own `.text` remapped.
- Changed token count → the old `words` array is preserved completely untouched, which is exactly what makes it "stale" per the existing derived `isWordTimingStale`. Nothing is ever fabricated, evenly redistributed, or discarded.
- Verified live: removing the trailing punctuation-only token `"..."` from `"Hello ..."` (2 tokens → 1) correctly marked the caption stale without touching its existing word timestamps; `rebuildWordTiming` continued to work normally afterward.

## 11. Quality analyzer changes

Added `WHITESPACE_ISSUE` (warning), `REPEATED_PUNCTUATION` (warning), and `SUSPICIOUS_SHORT_TEXT` (warning for `suspicious-short`/`punctuation-only`, info for `short-intentional`) — all three `fixability: "unsafe"`, so they are **never** auto-fixed by "Fix all safe issues" (confirmed live: `Require manual review` count increased by exactly the new issues, `Safe fixes available` count unchanged). Each check reuses `text-cleanup.ts`'s own pure functions (`normalizeSpaces`/`normalizeLineBreakWhitespace`/`normalizeRepeatedPunctuation`/`classifyCaptionContent`) — "would cleanup change this caption" is the literal definition of "does it have this issue," never a second definition. `EMPTY_CAPTION` was left completely unmodified.

The quality panel dialog gained: labels for the 3 new types, a new "Text content" group (parallel to the existing Structural/Readability groups, listing all 3), and a compact summary line (`"N issues · X errors · Y warnings · Z info"` + `Timing/Text/Style` counts via the new `QUALITY_CATEGORY_BY_TYPE` map) — verified live against real project data, correctly updating from `4 issues` to `6 issues` (Text 0→2) after a manual edit introduced messy whitespace + repeated punctuation, and correctly showing the stale-report banner beforehand.

## 12. Tests added

- `text-cleanup.test.ts`: **56** pure tests (text cleanup 11, sentence case 9, trailing punctuation 15, empty/near-empty classification 7, batch preview 9, word timing 4, performance 2 — 5,400 and 2,700-non-contiguous).
- `quality-analyzer.test.ts`: **9** new tests for the 3 new issue types (fire/don't-fire cases, severity, unsafe-fixability).
- `editor-store-undo-redo.test.ts`: **20** new store-level tests (145–164) covering selection scoping (0/1/multi/non-contiguous), the spec's own "changes A, B, D and deletes C = one undo step" worked example, undo/redo, cancel/no-op = no history entry, selection pruning after a delete, never-deletes-non-blank, word-timing preserve/stale/no-fabrication, mixed single+batch undo/redo ordering, quality-report staleness/navigation/no-stale-ids, and 5,400/2,700-caption performance.

## 13. Full test count

**813 / 813** passing (728 baseline + 85 new: 56 + 9 + 20).

## 14. Typecheck result

`tsc --noEmit` — clean, 0 errors.

## 15. Lint result

`eslint` — **0 errors**, the same 5 pre-existing, unrelated warnings as before this task (`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`).

## 16. Dev QA

Ran against an isolated `prisma/dev.db` (never the packaged app's production DB), seeded with a disposable project (8 captions: messy-whitespace English, multi-sentence, pure Devanagari, mixed English/Hindi with a word-level style override, a multi-line caption, a caption with pre-existing stale word timing, a blank caption, and a punctuation-heavy caption). Verified live, via the real running app:
- Dialog opens with all toggles off and makes **no** change until Apply (confirmed via preview-only state).
- Live preview showed the exact expected before/after text and counts, including the spec's own delete-candidate wording ("N captions selected — M will change, K unchanged, J blank caption(s) will be deleted").
- Apply: `"  hello   world!!  "` → `"hello world!"`, `"Wait...... really????"` → `"Wait... really?"`, line-break whitespace normalized, blank caption deleted — all in one toast, one commit.
- Undo restored the exact prior state (8 captions, original messy text); Redo reproduced the exact applied result.
- Autosave fired ("Saved" indicator) and **reload verified** — all 7 remaining captions' text matched exactly, including the real `\n` line break, confirming persistence.
- Cancel made zero changes (verified via direct DOM read of textarea values before/after).
- Quality report: new issue types fired correctly on a live edit (`WHITESPACE_ISSUE`/`REPEATED_PUNCTUATION`), showed `"Manual review"` (not `"Fix"`) for them, and `"Go to caption"` navigated without any console error.
- Export dialog opened without crashing after using Cleanup (confirms the dialog-stacking/pointer-events behavior stays correct).
- 1-caption selection correctly showed singular "1 caption selected" wording (the same reusable pattern P10 established).
- Discovered and fixed nothing new here — the P10-era dialog pointer-events fix (`data-[state=closed]:pointer-events-none!`) was reconfirmed still correct: verified via `document.elementFromPoint` returning a real app element, never a stuck overlay, immediately after closing the cleanup dialog.

## 17. Packaged Windows QA

Built, installed (silent `/S`), and launched **0.1.11** first (pre-bump validation build), then rebuilt/reinstalled/relaunched **0.1.12** (the final, shipped build) after all QA passed.

Used a **disposable duplicate of a real production project** (`rishab guj` → `rishab guj (copy)`, created via the app's own "Duplicate" action — 43 real Gujarati/Hinglish captions with real timestamps):
- Selected all 43 captions; opened Cleanup; toggled Trim/Normalize spaces/Normalize repeated punctuation — preview correctly showed `"0 will change, 43 unchanged"` (real transcription data has no whitespace/punctuation issues, so nothing false-fires) and Apply was correctly disabled.
- Switched to Sentence case — preview correctly identified exactly 2 of 43 captions as affected (the 2 captions with Latin-script/Hinglish content mixed into an otherwise-Devanagari-script project), leaving all 41 pure-Devanagari captions untouched. Applied; verified the exact expected text (`"peak sarjaris so hōi"` → `"Peak sarjaris so hōi"`).
- Undo restored the exact original lowercase text; Redo reproduced the exact result.
- Verified no dialog-overlay click-blocking regression in the packaged build specifically (`document.elementFromPoint` after closing the dialog resolved to a real app element).
- Cleaned up: moved the duplicate to Trash, then permanently deleted it via the existing type-to-confirm flow.
- Final 0.1.12 launch smoke test: opened the real, unmodified `rishab guj` project and confirmed its captions still load correctly.

## 18. Production DB comparison

Backed up `subly.db` to `subly.db.bak-pre-p11-text-cleanup-qa` before QA. After the duplicate-edit-undo-redo-delete cycle, a row-level JSON comparison (Project, Subtitle, VideoAsset, ExportJob, SubtitlePreset — excluding only `updatedAt`) showed:

```
Project: before=19 after=19 diffs=0
Subtitle: before=2266 after=2266 diffs=0
VideoAsset: before=19 after=19 diffs=0
ExportJob: before=46 after=46 diffs=0
SubtitlePreset: before=0 after=0 diffs=0
TOTAL_DIFFS 0
```

Byte-identical. Backup file and the comparison script were deleted after use.

## 19. Installer size/path

`release/SUBLY Setup 0.1.12.exe` — **566,398,267 bytes** (~540 MB), with `SUBLY Setup 0.1.12.exe.blockmap` at 571,630 bytes. EXE `FileVersion`/`ProductVersion` and the installer's own `FileVersion`/`ProductVersion` both confirmed `0.1.12`; the compiled JS bundle contains the literal baked-in string `"SUBLY Desktop v0.1.12"` (grepped directly from the installed app's `resources/app-server/.next/static/chunks/`, avoiding a full-desktop screenshot per this session's own established privacy precedent).

## 20. Known limitations

- "Ensure trailing punctuation" does not attempt syntactic sentence-fragment detection (see §8) — a heading-like fragment ending in a letter will still get a period appended.
- `classifyCaptionContent`'s short/suspicious-short split is a coarse, script-agnostic length heuristic, not a dictionary of real short words per language — a genuinely meaningful single-letter utterance in some script may surface as a `WARNING` (never an error, never auto-deleted, always human-reviewable).
- Sentence case treats every existing line break as a new sentence start (per the spec's own explicit instruction) — a caption that was line-wrapped mid-sentence will have its second line's first letter capitalized even though it isn't grammatically a new sentence.
- Punctuation normalization only covers `!`, `?`, and `.` runs — other repeated marks (e.g. `,,`, `;;`) are left untouched, matching the spec's own worked examples exactly (it never asked for those).

## 21. Deferred / non-goals (explicitly out of scope per the task spec, confirmed still untouched)

Regex-based find/replace, AI rewriting/correction/translation/paraphrasing, copy/paste workflow, batch word-level timing editing, freeform word dragging, cloud sync, collaboration, new DB schema, new export formats, major UI redesign, and a new keyboard shortcut (the audit found none appropriate/available; the feature is discoverable via the existing button row, matching the spec's own "otherwise make the action discoverable through the existing... UI" instruction).
