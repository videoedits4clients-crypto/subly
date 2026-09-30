# P10 — Batch Text & Content Editing Workflow

**Task ID:** 97025
**Status:** PASS
**Final version:** 0.1.11 (bumped from 0.1.10 only after all functional QA below passed)

## 1. Status: PASS

## 2. Task ID and final version

Task 97025. Version bumped 0.1.10 → 0.1.11 only after every gate below passed.

## 3. Phase-0 architecture findings

- **Existing text mutation functions**: `updateSubtitleText` (single caption), `applyTextMap` (a `Record<id,text>` lookup, used by AI text-tools), and `findReplace` (project-wide, hardcoded case-insensitive, no selection scoping, no whole-word option, immediate-apply with no preview) all funnel through the exact same private helper, `remapWordsToText(words, newText)`. This was the single most important finding: **the entire word-timing-safety mechanism already exists and needed zero changes.**
- **`remapWordsToText`** (unchanged, reused as-is): tokenizes the new text (`tokenizeCaptionText` — whitespace/newline split), and if the new token count equals the existing `words.length`, remaps each word's own `text` field onto the new tokens while leaving every timestamp/`confidence`/`style` untouched; if the counts differ, it returns the **original words array completely untouched** — no fabrication, no redistribution.
- **P7.2 stale-word-timing logic**: staleness is **derived**, not stored — `isWordTimingStale(subtitle)` just compares `words.length` to `tokenizeCaptionText(subtitle.text).length`. This means "mark timing stale" is not an action at all: it happens automatically and for free the instant `remapWordsToText` leaves an old-count words array attached to new-count text. P10's own "use the existing mechanism, do not create a second stale-timing system" requirement was satisfied by literally not writing any staleness-tracking code.
- **Existing "Rebuild timing" workflow** (`rebuildWordTiming`): unchanged, still available and still works correctly on a caption a batch operation made stale (verified — test 128 and live QA).
- **Undo/redo (`commit()`)**: confirmed (again, per P8/P9 precedent) that a mutator touching many captions in one `commit()` call is exactly one `past` entry — both new batch actions use this directly.
- **Autosave**: watches the store's `dirty` flag, set unconditionally by `commit()` — no new persistence path was needed or added.
- **Search/replace functionality already present**: `findReplace` (store) + `SearchReplaceDialog` (UI, opened via Ctrl+F through a `subly:open-search` custom event). This existing dialog was **extended in place** with a second, selection-aware mode rather than duplicated — see §6.
- **Quality analyzer / P7.2/P7.3 quality-report state**: `isQualityReportStale` compares `qualityReportSubtitles` (a snapshot reference) against the live `project.subtitles` — since batch text ops go through `commit()` like everything else, this "just works" with no new code. `goToQualityIssue` already defensively looks up a caption by id and no-ops the navigation (while still moving the cursor) if it's gone — batch text ops never delete captions, so this was never actually at risk, but the existing defense covers it regardless.
- **P8 selection model**: `selectedSubtitleIds: Set<string>` — used directly and exclusively; no DOM selection anywhere in the new code.
- **Existing keyboard shortcuts**: confirmed via a full read of `use-keyboard-shortcuts.ts` that **Ctrl+H was completely unused** — free to bind.
- **Existing dialogs**: `ConfirmDialog` (generic title/description/Cancel/Confirm) reused as-is for the Transform confirmation flow; `Dialog`/`DialogContent` reused for the extended Find & Replace. `isTypingTarget`/`isAnyDialogOpen` guard placement was preserved exactly — Ctrl+H was added in the same "fires even while typing" bucket as the pre-existing Ctrl+F, since opening a dialog is never itself a mutation.

## 4. Exact files changed

- **`src/lib/subtitles/batch-text-ops.ts`** (new) — pure, store-free helpers: `escapeRegexLiteral`, `buildFindRegex` (Unicode-aware whole-word boundary), `computeBatchFindReplace`, `TextTransformKind`, `applyTextTransform`, `computeBatchTextTransform`.
- **`src/lib/subtitles/__tests__/batch-text-ops.test.ts`** (new) — 31 pure unit tests.
- **`src/store/editor-store.ts`** — new `applyBatchFindReplace`/`applyBatchTextTransform` actions, both thin wrappers: compute via the pure helpers, then one `commit()` reusing the existing `remapWordsToText`.
- **`src/components/editor/search-replace-dialog.tsx`** — extended with a batch mode (match case / whole word switches, live preview, stale-timing warning, Apply/Cancel), auto-selected whenever `selectedSubtitleIds.size >= 1`; the original 0-selection mode is untouched.
- **`src/components/editor/captions-panel.tsx`** — new "Transform" dropdown in the existing selection header (shown whenever `selectedSubtitleIds.size >= 1`), wired to the existing `ConfirmDialog` for a preview-then-apply flow.
- **`src/hooks/use-keyboard-shortcuts.ts`** — Ctrl+H added alongside Ctrl+F (both dispatch the same `subly:open-search` event; the dialog decides its own mode).
- **`src/lib/keyboard-shortcuts-reference.ts`** + **`src/lib/__tests__/keyboard-shortcuts-reference.test.ts`** — Ctrl+H entry added; Ctrl+F's description updated to mention selection-scoping.
- **`src/components/ui/dialog.tsx`** — **bug fix, discovered live during this task's own QA** (see §21): `DialogOverlay`/`DialogContent` now use `data-[state=closed]:pointer-events-none!` (Tailwind `!important` modifier) to stop a "stuck" (not-yet-unmounted) closed dialog from blocking all mouse interaction with the rest of the app.
- **`src/store/__tests__/editor-store-undo-redo.test.ts`** — 35 new store-level integration tests (110–144).
- **`package.json`** — new test script registered, version `0.1.10` → `0.1.11`.

No changes to transcription/Whisper, export/FFmpeg rendering, installer configuration, or the database schema.

## 5. (merged into §4 above — file list)

## 6. Find & Replace implementation

The **existing** `SearchReplaceDialog` (Ctrl+F, and now also Ctrl+H) was extended in place rather than duplicated: it now inspects the live `selectedSubtitleIds` and renders one of two modes —

- **0 selected** — the original, completely unchanged global mode (project-wide, case-insensitive only, "Replace next"/"Replace all", immediate-apply).
- **1+ selected** — the new batch mode: Match case / Whole word switches (both OFF by default, matching the task's own spec), a live, purely-computed preview ("N replacements in M captions"), an inline word-timing-safety warning when applicable, and Cancel/Apply — nothing is written to the project until Apply is clicked (verified: typing in the Find/Replace fields, toggling switches, and closing via Cancel never call any store-mutating action).

Live-verified against the task's own worked example exactly: 3 captions selected ("Hello world" / "Hello everyone watching" / "Good morning to you"), Find "Hello" → Replace "Hi" showed **"2 replacements in 2 captions"**, applied, and caption 3 was confirmed byte-for-byte untouched (both in the UI and via direct database read).

## 7. Transform implementation

Three deterministic transforms — UPPERCASE, lowercase, Title Case — added as a compact "Transform" dropdown in the captions panel's existing selection header (shown for 1+ selected captions, reusing the same button row P8 already added for Delete/Clear — no new toolbar). Selecting one opens the **existing, generic** `ConfirmDialog` with a purely-computed preview ("Title Case will be applied to N of M selected captions[, P will require word-timing review]"), and the button relabels to "Apply and mark timing stale" exactly when relevant. Title Case preserves whitespace/newlines exactly by transforming only non-whitespace runs in place (never splitting/rejoining the string). Verified live that UPPERCASE/Title Case are harmless no-ops on Devanagari text (no case system to change) — an honest result, not a bug, and explicitly documented as such in code.

## 8. Timing safety behavior

For every affected caption, the SAME derivation `isWordTimingStale` already uses (token count vs. `words.length`) decides the outcome — computed by the new pure helpers, never a second definition:

- **Same token count** → `remapWordsToText` remaps each word's own `text` onto the new wording while leaving every timestamp, `confidence`, per-word `style` override, and derived `gujaratiScriptText` completely untouched (live-verified against real production word data with real `confidence` scores).
- **Different token count** → the caption's `words` array is left **exactly as it was** (same timestamps, same word count) — no invented timestamps, no redistribution, no silent rebuild. The mismatch against the new text is what makes `isWordTimingStale` return true afterward — automatically, with no explicit "mark stale" step anywhere in the new code.

## 9. Stale timing behavior

The dialog/ConfirmDialog surface an explicit warning **before** any commit happens ("N captions will require word-timing review — the replacement changes the number of words, so the existing timestamps can't be reused. Real timing is never invented or discarded."), and the primary button relabels to "Apply and mark timing stale" — verbatim matching the task's own example wording. `rebuildWordTiming` (unchanged, pre-existing) continues to work normally on any caption a batch operation made stale (test 128; live-verified).

## 10. Undo/redo behavior

Every batch operation — find & replace or transform, regardless of how many captions it touches — is exactly ONE `commit()` call and therefore ONE `past` entry (tests 110, 132, 134/135 assert `past.length` deltas directly, including a 15-caption and a 20-caption batch). Undo restores every affected caption to its exact previous text/word/timestamp state in one step; redo reproduces the exact same result (tests 134–136, and live-verified in both dev and the packaged app). Mixed sequences (single → batch → batch, or batch → batch → single) undo/redo in the correct order (test 137). A cancelled dialog, or a find/replace with zero matches in the selection, creates **no** history entry at all (tests 110, 119, 138 — `past.length`/`future.length` provably unchanged).

## 11. Autosave/reload verification

No new persistence path — batch operations go through the exact same `commit()` → `dirty: true` → existing autosave debounce as every other mutation. Live-verified in both dev mode and the packaged app: batch replace → reload → text and stale-timing state both persist exactly (confirmed via direct database read showing the correct `words.length` vs. text-token-count mismatch surviving the reload); undo/redo after a reload continue to work correctly on the freshly-loaded state.

## 12. Quality-report behavior

No automatic re-analysis was added (matching the task's own "do not automatically run a full quality analysis unless the existing architecture already does this" instruction — it doesn't, so none was added). The existing `isQualityReportStale` check correctly flags the report as stale after a batch text edit (test 139) purely because `commit()` changes the `project.subtitles` reference like any other mutation — no new code was needed. Quality-issue navigation (`goToQualityIssue`) does not crash and never references a stale/deleted caption id after a batch operation, because batch text operations never delete or rename caption ids — only their `text`/`words` change (tests 140, 141; live-verified via the top-bar Previous/Next quality-issue buttons after a batch replace, including through several navigations with no console errors).

## 13. Performance results

Automated (tests 142–144, 5,400-caption synthetic projects, matching this codebase's established convention): a full-project batch find & replace across all 5,400 captions, a full-project batch transform across all 5,400, and a batch find & replace over a 2,700-caption non-contiguous selection (every other caption of 5,400) each completed in a small fraction of the 300ms budget. Both `computeBatchFindReplace`/`computeBatchTextTransform` are a single O(n) pass over the subtitle array (one `selectedIds.has()` check per caption, never per-match or per-selected-item work against the whole array), and the store actions' own `commit()` mutator is a single `.map()` — no O(n²) behavior anywhere. Live-verified: typing into the Find field against a real 200-caption project (above the 150-caption virtualization threshold) recomputed the live preview on every keystroke with no perceptible lag, and a 200-caption Ctrl+A → Ctrl+H → type produced an instant, correct "200 replacements in 200 captions" preview.

## 14. Test count before/after

- Before: 662/662 passing (P9's final count).
- After: 662 + 31 (new pure `batch-text-ops.test.ts`) + 35 (new store-level tests 110–144) = **728/728 passing**. No existing test was weakened, deleted, or had its assertions loosened.

## 15. Typecheck

`tsc --noEmit` — clean, no errors, at every checkpoint throughout implementation and in the final pre-report pass.

## 16. Lint

`eslint` — 0 errors. 5 pre-existing warnings, all in files this task never touched — unrelated to P10. (One transient `react-hooks/rules-of-hooks` error was introduced and immediately fixed during implementation — see §21.)

## 17. Dev QA: PASS

Ran against the same isolated dev database used throughout P8/P9 (`prisma/dev.db`). Seeded a dedicated mixed-content project ("P10 QA - mixed text": English, Hindi/Devanagari, and mixed-script captions, real word-level timestamps, and one word-level style override) and reused the existing 200-caption P8 fixture for scale testing. Verified live, in order:

1. **Ctrl+H** opens the same dialog as Ctrl+F; with 0 selected it shows the original global mode unchanged; with a selection active it shows the new batch mode with the correct "N captions selected" label.
2. **Find/replace preview**: "2 replacements in 2 captions" for the exact task worked example — computed live, no project mutation until Apply.
3. **Match case**: OFF matched all casings; toggling ON correctly narrowed to exact-case-only.
4. **Whole word**: OFF matched "राम" inside "रामायण" too (2 matches); ON correctly matched only the standalone occurrence (1 match) — the exact Unicode-mark discovery from the pure-test phase (see §21) confirmed live.
5. **Apply**: text updated correctly; word-level style override (`{color:'#FF00AA'}`) on the first word of a same-token-count replacement survived, confirmed via direct database read.
6. **Timing preservation**: same-token-count replacements kept every original timestamp exactly.
7. **Stale timing warning**: shown with the exact spec wording, button relabeled "Apply and mark timing stale", applied correctly, and the stale state (`words.length` ≠ new token count) was visible in the captions panel and confirmed via direct database read.
8. **Undo**: restored exact previous text in one step (confirmed blocked correctly while a caption's own textarea has focus — the pre-existing, correct `isTypingTarget` guard — and working once blurred).
9. **Redo**: reproduced the exact applied result.
10. **Autosave**: "Saved" indicator fired after every apply; confirmed via direct database read that changes persisted.
11. **Reload**: text and stale-timing state both persisted exactly across a full page reload; selection itself was correctly NOT restored (ephemeral).
12. **Quality navigation**: ran analysis, navigated Next/Previous multiple times after a batch edit with zero console errors.
13. **Transforms**: UPPERCASE/Title Case tested; a no-op on Devanagari text correctly showed "0 of 1 selected caption" in the confirm dialog; Title Case on English text ("concatenate the cat catalog" → "Concatenate The Cat Catalog") applied correctly with auto-close and a success toast.
14. **Large selection**: Ctrl+A across 200 captions instantly showed "200 replacements in 200 captions" with no lag.
15. **Single-caption regression**: plain click-to-select, Escape-to-deselect, and the original global Ctrl+F/H flow (0 selected) all continued to work exactly as before.

## 18. Packaged Windows QA: PASS

- Backed up production `subly.db` before touching anything (`subly.db.bak-pre-p10-batch-text-qa`).
- Built and installed the 0.1.10 packaged app (before the version bump), launched it, connected to its local server.
- Created a disposable QA fixture via the app's own real "Duplicate" action on a real production project with real Gujarati/Hindi captions ("rishab guj" → "rishab guj (copy)", 43 real captions with real per-word `confidence` scores and `gujaratiScriptText`).
- Selected 3 real captions, ran a batch find & replace ("दर" → "समय") via Ctrl+H: preview correctly showed "2 replacements in 2 captions", applied, and direct database inspection confirmed every other word's `confidence`/`gujaratiScriptText`/timestamp fields were preserved byte-for-byte — only the matched word's `text` changed.
- Confirmed one Ctrl+Z restored both captions' exact original text in one step (after correctly being blocked while a textarea had focus, matching the existing guard).
- **Also confirmed the dialog click-through bug fix (§21) live in the packaged build**, not just dev mode: after closing the Find & Replace dialog, a subsequent click correctly focused a different caption's textarea (`document.activeElement` verified via script injection).
- Deleted the disposable copy via the app's own Trash → typed-confirmation ("rishab guj (copy)") permanent-delete flow.
- Compared the production database row-by-row (Project/Subtitle/VideoAsset/ExportJob/SubtitlePreset, JSON-string-equality excluding only `updatedAt`) before vs. after: **identical** (19 projects, 2,266 subtitles, 19 video assets, 46 export jobs, 0 presets).
- Only then bumped the version to 0.1.11, rebuilt (`SUBLY Setup 0.1.11.exe`, 566,391,049 bytes, with its `.blockmap`), verified EXE and installer `FileVersion`/`ProductVersion` both report `0.1.11`, reinstalled silently, launched, and opened a real production project to confirm the version-bumped installer works end-to-end.
- **App sidebar version**: verified by extracting the literal compiled string from the packaged build's own JS bundle (`resources/app-server/.next/static/chunks/...`) rather than a live desktop screenshot — confirmed the bundle contains exactly `"SUBLY Desktop v0.1.11"`, proving `NEXT_PUBLIC_APP_VERSION` was correctly baked in at build time for this version. (A live screenshot of the P8-era 0.1.9 build already visually confirmed this exact code path renders correctly; this task did not repeat that screenshot — see §21 for why.)
- Ran the same production-DB row comparison a final time after this smoke test (view-only, no edits): row counts identical (19/2266/19/46/0).

## 19. Installer filename and size

`release/SUBLY Setup 0.1.11.exe` — 566,391,049 bytes, with `SUBLY Setup 0.1.11.exe.blockmap` (572,894 bytes).

## 20. Production DB integrity

Identical (excluding `updatedAt`) across both the pre-version-bump (0.1.10) and post-version-bump (0.1.11) packaged QA passes — 19 projects, 2,266 subtitles, 19 video assets, 46 export jobs, 0 presets, verified via direct row-level JSON-equality comparison each time.

## 21. Known limitations / newly discovered issues

- **Dialog click-through bug (found and fixed this task)**: any modal `Dialog` (not just Find & Replace — Export, Quality panel, Keyboard shortcuts, etc., since all share the same `components/ui/dialog.tsx` primitive) could, after being closed, leave its full-screen backdrop overlay mounted (the same underlying "exit `animationend` never fires in this environment" root cause Task 93471/P7.3 already diagnosed for the word-timing Popover) — and because Radix sets an **inline** `pointer-events: auto` style on that overlay to enforce modality while open, the stuck overlay silently blocked **every mouse click anywhere in the app** until the page was reloaded. This was discovered live while testing this task's own Find & Replace dialog. Root-caused via `getComputedStyle`/`elementFromPoint`/inline-style inspection (a plain `data-[state=closed]:pointer-events-none` class was correctly generated but lost to the inline style in the cascade); fixed with Tailwind's `!` important-modifier (`pointer-events-none!`), which does beat a plain (non-`!important`) inline style. Verified fixed in both dev mode and the packaged 0.1.11 build. This is a **pre-existing bug in shared UI infrastructure**, not something P10 introduced — it just happened to be the first task whose own QA workflow (open dialog → apply → close → immediately click elsewhere) reliably reproduced it.
- The sidebar-version verification for 0.1.11 used a static compiled-bundle check rather than a fresh desktop screenshot (see §18) — a deliberate choice after an earlier screenshot attempt in this session captured an unrelated foreground browser window; the static check is arguably more precise (confirms the exact compiled string) but is a different verification method than prior phases' live screenshots.
- `escapeRegexLiteral` in the new `batch-text-ops.ts` module duplicates one existing trivial one-line regex-escape helper already private inside `editor-store.ts` (used only by the untouched, pre-existing `findReplace`) — a deliberate, documented, minimal-risk tradeoff rather than exporting/refactoring existing code for a one-liner.
- "Whole word" uses Unicode General Category L/N/M (letter/number/mark) as the word-forming definition — correct and tested for English and Hindi/Devanagari (including the mark-attachment case), but is not full linguistic word-segmentation for scripts without whitespace-delimited words (e.g. Thai, Chinese) — this app's own text is already whitespace-tokenized everywhere else (`tokenizeCaptionText`), so this matches the existing convention rather than overclaiming a capability the app doesn't otherwise have.

## 22. Deferred items

Everything in the task's own NON-GOALS list: regex, AI rewriting/correction/translation/paraphrasing, copy/paste, batch word-level timing editing, freeform word dragging, cloud sync, collaboration, new database schema, major UI redesign, new export formats. None were touched.

## 23. Newly discovered issues

See §21 (dialog click-through bug) — the primary finding of this task beyond its own stated scope, fixed and verified in both dev and packaged builds.

## Summary

Do not declare success merely because tests pass — this PASS is backed by: 728/728 tests passing (66 net new); clean typecheck; 0 lint errors; extensive live dev-mode QA against mixed English/Hindi/mixed-script content with real word-level style overrides; a full packaged-Windows-installer QA cycle at both 0.1.10 and the final 0.1.11 against a real production project with real transcription confidence scores; two independent row-level production-database integrity checks showing zero unintended changes; and the live discovery, root-cause, fix, and cross-environment (dev + packaged) verification of a real, severe, pre-existing UI bug that was blocking this task's own QA. No regression of any P7/P8/P9 workflow, no silent word-timing destruction, and no modification of any caption outside the active selection.
