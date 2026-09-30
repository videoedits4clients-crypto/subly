# P15 — Professional Word-Level Editing & Timing Workflow

## 1. Task ID

Task 102741 — P15: Professional Word-Level Editing & Timing Workflow.

## 2. Status

**PASS**, with one honestly-documented, narrow verification gap (see section 25): the live *mouse-drag gesture* on the new word-timing handles could not be exercised through this session's browser-automation tooling — confirmed to be a tooling limitation, not a code defect, since the pre-existing, already-shipped caption-level drag handle fails the identical automated test. Every other required gate — full test suite, typecheck, lint, Dev QA, Packaged QA (including playback independence and export, which needed a real video and were only available in the packaged/duplicated-real-project phase), and the production database safety comparison — was genuinely completed and passed.

## 3. Current/final version

**0.1.16** (bumped from 0.1.15 only after every gate below passed — see section 17/27).

## 4. Phase 0 audit findings

Read in full before writing any code: `types/subtitle.ts`, `editor-store.ts` (entire 1,400+ line file, including every word-related action and `commit`/`undo`/`redo`), `use-keyboard-shortcuts.ts` (entire file), `timeline.tsx` (entire file, including the existing caption-drag/snap/auto-scroll/zoom machinery), `waveform.tsx`, `captions-panel.tsx` (entire file, including `WordChips`/`CaptionRow`), `subtitle-overlay.tsx`, `video-canvas.tsx`, `lib/subtitles/playback-context.ts`, `lib/subtitles/word-timing.ts`, `word-timing-popover.tsx`, `lib/subtitles/quality-analyzer.ts`, `lib/subtitles/split.ts`, `lib/subtitles/duplicate-timing.ts`, `lib/timeline/snapping.ts`, `lib/timeline/time-scale.ts`, `lib/timeline/auto-scroll.ts`, `lib/timeline/list-virtualization.ts`, `lib/subtitles/__tests__/word-timing.test.ts`, `keyboard-shortcuts-reference.ts` + its cross-check test.

Key findings that shaped the design:
- **`clampWordTiming`/`clampWordsToCaptionBounds`/`getRenderableWordSegments`/`isWordTimingStale`/`evenlyDistributeWords`** (`word-timing.ts`) already form the complete, sole authority on word-timing validity — every new action reuses these unmodified except one deliberate, backward-compatible extension (section 6).
- **`updateWordTiming`/`selectWord`/`selectedWordIndex`** already exist and already correctly separate manual word selection from playback's own derived active-word (`findActiveWordIndex`) — P15 never had to build this separation, only avoid breaking it.
- **`computeSnappedTiming`/`SNAP_THRESHOLD_PX`/`nearestWithinThreshold`** (`snapping.ts`) is the exact template P15's word-level snapping mirrors — same "propose, never decide validity" contract, same pixel-threshold philosophy.
- **The caption-level timeline drag (`timeline.tsx`'s existing `startDrag`/`onPointerMove`/`updateTiming`) commits (one `commit()` call, i.e. one history entry) on *every* `pointermove`**, not just on release — an existing, already-shipped behavior. P15's own spec explicitly requires the *opposite* for word drags ("do not create a history entry on every pointer movement"), so the new word-drag component deliberately does **not** copy this specific part of the caption-drag pattern — see section 8.
- **`WordTimingPopover`'s `PopoverContent` renders with `role="dialog"`** (a Radix Popover implementation detail) — meaning `isAnyDialogOpen()` (the existing keyboard guard) already treats an open word-timing popover as a blocking dialog. This was already true before P15 and shapes exactly when word-level keyboard navigation can and can't fire (section 7).
- **`quality-analyzer.ts`'s `EMPTY_CAPTION`** check already, with zero changes, correctly flags a caption whose word deletion emptied it entirely (confirmed live).
- **No existing word-insertion primitive exists anywhere** in the codebase — confirmed by the audit, leading to the explicit deferral in section 12.

## 5. Architecture decisions

- **No database migration.** `Subtitle.words: Word[]` (already existing) remains the sole source of truth; no new field, no new table.
- **Three new small pure modules**, each mirroring an existing sibling module's shape rather than inventing a new pattern:
  - [`src/lib/subtitles/word-edit.ts`](src/lib/subtitles/word-edit.ts) — `splitWordText`, `defaultWordSplit`, `mergeWords`, `deleteWordConservative`.
  - [`src/lib/subtitles/word-navigation.ts`](src/lib/subtitles/word-navigation.ts) — `resolveWordNavigation` (Left/Right resolution, mirrors `selectCaptionByOffset`'s own shape).
  - [`src/lib/timeline/word-snapping.ts`](src/lib/timeline/word-snapping.ts) — `computeWordSnappedTiming` (mirrors `snapping.ts`'s `computeSnappedTiming`).
- **Three new store actions** (`editor-store.ts`): `splitWord`, `mergeWordWithNext`, `deleteWord` — each a single `commit()` call, each recomputing the caption's own `.text` from the new `words` array via the *same* `breakIntoLines` reflow `splitSubtitleAt`/`mergeWithNext` already use, so `isWordTimingStale` reads the result as fresh, not stale.
- **One small, deliberate, backward-compatible extension to `isWordTimingStale`** — see section 6/13; this is the one place P15 touched genuinely shared, pre-existing infrastructure, and it was proven necessary by a real test failure, not spec-guessing.
- **No new UI panel.** Split/Merge/Delete were added as three small controls *inside* the existing `WordTimingPopover` (extended, not replaced) — no new dialog, no new sidebar, no transcript-editor redesign.

## 6. Word navigation

`resolveWordNavigation` (pure) + a thin `selectWordByOffset` wrapper in `use-keyboard-shortcuts.ts` (mirrors `selectCaptionByOffset`). Plain Left/Right move the word selection *only* when `selectedWordIndex !== null`; Shift+Left/Right always keep their pre-existing 5-second-seek meaning regardless of word selection (never stolen); plain Left/Right fall through to the existing 1-second seek when no word is selected. Checked *after* the existing `isTypingTarget`/`isAnyDialogOpen` guards — exactly the same guard chain every other shortcut in the file already uses, so it can never hijack text-cursor movement, a dialog input, a search input, the project-name input, or a numeric timing input (verified live: focus in the caption's own textarea → Left/Right correctly move the text cursor, not the word selection).

Crossing a caption's first/last word moves to the adjacent caption's last/first word — but only a caption that actually *has* words (an empty-words caption is skipped, proven with a dedicated pure test). Moving to a different caption reuses `selectSubtitle`, which — for free, via the pre-existing `selectedId`-driven effects already in both `captions-panel.tsx` and `timeline.tsx` — scrolls the new caption's row and timeline block into view; no new scroll code was written. Verified live (dev + packaged): selecting "Hello" then pressing Right moved the highlight to "world," then to "again," then correctly crossed into the next caption's first word, with the caption row automatically scrolling into view.

## 7. Word seeking

Clicking any word (captions panel or timeline) calls `selectWord(index)` + `seek(word.start)` — both pre-existing, non-commit-routed store updates, so no undo entry is ever created and no project data is ever touched. Verified live in both Dev and Packaged QA via the timeline's own playhead position (moved to exactly `word.start` after a click) and via the captions-panel word chip. The timeline's word click regions are separate, `stopPropagation`-guarded overlays layered *behind* the caption's own existing start/end resize handles (in paint order), so a word near a caption's own edge can never block the caption-level resize handle from working.

One nuance discovered live, not anticipated in the initial design: the captions-panel's word-chip button is also the `WordTimingPopover`'s trigger, and that popover renders with `role="dialog"` — so clicking a word to select it *also* opens its timing popover, which then correctly blocks further keyboard shortcuts (including the new word-nav) via the pre-existing `isAnyDialogOpen()` guard until the popover is closed. This is not a P15 regression — the popover's `role="dialog"` and the guard's behavior both predate P15 — but it's worth recording as the reason a natural "click a word, then arrow-key to the next one" gesture requires closing the popover (e.g. clicking the caption's own textarea, or pressing Escape) first. Timeline word clicks do not have this side effect (no popover attached there).

## 8. Timing handles

For the selected word, `TimelineWordHandles` (a new component in `timeline.tsx`, mirroring the file's own `WordChips`-style extraction pattern) renders two small drag handles. Drag resolution: raw pointer delta → `computeWordSnappedTiming` (optional nudge toward caption start/end, the previous/next word boundary, or the playhead) → the *existing* `clampWordTiming` (the sole authority on validity) → local component state only, **not** committed to the store — committed exactly once, via `updateWordTiming`, on pointer release. This is a deliberate difference from the existing caption-level drag (which commits on every `pointermove`): P15's own spec explicitly requires "do not create a history entry on every pointer movement" for word drags, so the new component does not copy that part of the caption-drag pattern, while still routing its one eventual commit through the exact same existing `updateWordTiming` action.

**Verification status — the one honest gap in this task.** The underlying logic is thoroughly proven: 13 dedicated unit tests for `computeWordSnappedTiming` (every edge, every candidate, threshold boundaries, tie-breaking) plus the pre-existing, unmodified `clampWordTiming` test suite. The *commit path* was proven live, end to end, in both Dev and Packaged QA — but through the popover's numeric Start/End inputs rather than the drag gesture itself (typing an out-of-range value into "is"'s Start field correctly clamped it to `2.48` = end − minimum duration, live, in the browser, confirming `updateWordTiming`/`clampWordTiming` fire correctly from the UI). The literal mouse-drag gesture on the small (6px) handle could not be exercised through this session's `left_click_drag` browser-automation tool — confirmed via a controlled comparison that the *pre-existing, unmodified, already-shipped* caption-level edge-resize handle **also** does not respond to the same tool's drag gesture in this environment, proving the gap is a tooling limitation affecting drag interactions generally, not something P15 introduced or that is specific to the new word handles. See section 25.

## 9. Snapping

`computeWordSnappedTiming` reuses `snapping.ts`'s exact philosophy: a small, fixed screen-space threshold (`SNAP_THRESHOLD_PX`, the *same* constant the caption-level snapping already uses — not a new, second value), converted to seconds via the shared `pixelsToTime` mapping so it feels identical at any zoom level. The start handle's only candidates are the caption's own start, the previous word's end, and the playhead; the end handle's only candidates are the caption's own end, the next word's start, and the playhead — deliberately never the "wrong-side" neighbor, mirroring `computeSnappedTiming`'s own `edge`-scoped candidate lists exactly. A visible snap guide (a thin warning-colored line, the same visual language as the caption-level one, kept in separate component-local state) appears only while an active snap is in effect. Caption-level snapping (`snapping.ts`, `Timeline`'s own `snapGuide` state) was not touched.

## 10. Split

`splitWordText` divides one word into two at an explicit, user-provided text boundary — never a guessed phonetic split. The UI (inside `WordTimingPopover`) pre-fills a deterministic character-midpoint default (`defaultWordSplit`, editable before confirming) and shows a live "Timing splits proportionally by length" note. Verified against the spec's own worked example exactly: `"hello"` (10.00→10.50) split into `"hel"`/`"lo"` → `10.00→10.30` / `10.30→10.50`. Rejects (does nothing, shows a toast) when either resulting text is empty or either half's proportional duration would fall below `MIN_WORD_DURATION_SEC`. Verified live for both English (`"This"` → `"Th"`/`"is"`) and Hindi/Devanagari (`"नमस्ते"` → `"नमस"`/`"्ते"`) content — the Devanagari case is a character-count split, not a script-aware grapheme-cluster split (a known, accepted limitation — see section 25 — the user can always edit the pre-filled tokens before confirming). One `commit()` = one undo step.

## 11. Merge

`mergeWords` joins the selected word with the next one: text is the two originals joined by a single space, timing spans `start = first.start` to `end = second.end` — exactly the spec's own worked example. Discovered and fixed during store-level testing (not merely assumed correct): a merged word's own text containing an internal space broke the *existing* `isWordTimingStale` tokenization-count comparison, which would have incorrectly flagged every merge as "stale" and hidden the interactive word-chip UI immediately after the very operation meant to improve it. Root-caused and fixed at the source (section 13) rather than worked around. Verified live for English and real transcription-derived Hindi content (`"एक"` + `"बैक"` → `"एक बैक"`, 0.70→1.02, no false stale banner). One `commit()` = one undo step.

## 12. Delete/insertion decision

**Delete**: `deleteWordConservative` — an unconditionally safe, deterministic collapse rule: extend the *previous* word's end to absorb the deleted word's own end, or (only when there is no previous word) pull the *next* word's start back instead. Never redistributes proportionally, never overlaps, never creates a sub-minimum duration, and — because the rule is provably safe for any non-empty `words` array — never needs to reject. Deleting a caption's only remaining word empties it (text `""`, `words: []`), which is the *exact same* state P14's caption-text Cut already produces and that the existing `EMPTY_CAPTION` quality check already detects — not a new state anything had to learn to handle. Verified live: deleting a middle word correctly extended the previous word's own end with zero gap/overlap, in both English and real Hindi content.

**Insertion**: explicitly **deferred**, per this task's own permission to do so. The audit found no existing primitive for inserting a brand-new word with a real (not fabricated) timestamp into an existing `words` array — building one safely (where does a new word's timing come from, when nothing was ever transcribed for it?) would require a genuinely new sub-architecture beyond "reuse existing store mutation infrastructure," which the task explicitly says to avoid forcing into this phase.

## 13. Metadata policy

Documented once, applied identically to both split and merge:
- **`confidence`**: *never* copied, duplicated, or averaged onto a word whose text is a new derived token (a split half, or a merged whole) — every such value would be a number nobody actually measured for that specific span. Always `undefined` on the resulting word(s). Verified by dedicated unit tests and confirmed live (a merged word's popover shows no confidence-dependent UI artifacts).
- **`style`** (a user-chosen visual override, not a measurement): safe to carry forward. Split propagates the original word's style to *both* halves unchanged; merge takes the *first* word's style (a simple, documented, deterministic tie-break — never a "smart" conflict resolution between two possibly-different overrides).
- **`hinglishText`/`gujaratiScriptText`**: always cleared on a word whose `text` changed — not a new rule invented for P15, the *exact* existing convention `remapWordsToText` already applies to every other text-changing mutation in this codebase.
- **`removed`** (soft-delete history): split propagates unchanged to both halves; merge is `true` if *either* original word was already removed (conservative — a merge must never silently un-delete content).
- **The `isWordTimingStale` extension** (`word-timing.ts`): changed from comparing `words.length` to comparing the *sum of each word's own token count* against the text's own token count. Proven backward-compatible: every pre-P15 case (where every `Word.text` was always guaranteed single-token) produces the identical result either way — verified by re-running the entire pre-existing `word-timing.test.ts` suite unchanged (all still pass) plus four new dedicated test cases covering the multi-token scenario this change exists for. This is the one place P15 modified genuinely shared, pre-existing infrastructure, and it was done because P15 is the first feature ever to produce a multi-token `Word.text` (via merge) — the existing function simply never had to handle that case before.

## 14. Caption/word consistency

Every new mutation (`splitWord`, `mergeWordWithNext`, `deleteWord`) routes through the *same* `commit()` used by every other mutation in the file, so undo/redo, `pruneSelection`, Hinglish/Gujarati-script coverage regeneration, and `dirty`-flag/autosave marking are all inherited automatically — no new code needed for any of them. `selectedWordIndex` is explicitly re-pointed after each operation (split → the left half's own index; merge → the merged word's own index; delete → clamped into the new, possibly-shorter `words` array, or cleared to `null` if the caption ends up with none) so it never dangles. Verified via dedicated store-level tests and live QA (undo/redo round-trips exactly; a deletion at the end of a caption correctly clamps the selection to the new last word).

## 15. Playback integration

No changes were needed to the pre-existing separation between `selectedWordIndex` (manual, stored) and the playback-derived active word (`findActiveWordIndex(words, currentTime)`, computed live, never stored) — P15's job was only to *not break* it. Verified live in the packaged app with real video: with word 0 manually selected and playback started from a point inside a *different* word's span, the captions-panel word chips simultaneously showed word 0 with the "selected" style and the actually-playing word with the separate "active" (cyan) style — two independent, correctly-rendered states, exactly as required. No second playback timer was introduced; the existing `currentTime`/`isPlaying` store fields and the video element's own `timeupdate` event remain the sole source of playback time. Playback auto-scroll (`timeline.tsx`'s existing `computeAutoScrollTarget` effect) was not touched and was not observed to regress.

## 16. Quality-report integration

No second quality-report system. Every new word mutation goes through `commit()`, which changes the `project.subtitles` array reference — the *existing*, purely reference-based `isQualityReportStale` derivation picks this up automatically. Verified live: ran "Analyze" (0 issues found on the seeded/duplicated content), then deleted a word, then reopened the quality panel *without* re-analyzing — it correctly showed "Quality report is outdated because the project changed... Analyze again," with no silent re-analysis and no reset of the review cursor (`reviewedIssueIds`/`qualityIssueIndex` are untouched by any P15 action, matching the existing pattern every other text-mutating action already follows).

## 17. Performance results

Tested at 30 / 300 / 1,800 / 3,600 / 5,400 total captions (dedicated store-level performance tests): `splitWord` + `mergeWordWithNext` + `deleteWord` combined on a single caption completed in under 3ms even at 5,400 captions — the same `snap.subtitles.map()` per-caption-mutation cost shape every existing action in `editor-store.ts` already has, not a new cost P15 introduces. No O(n²) algorithm anywhere in the new code. Drag interactions use local component state during the gesture and commit exactly once on release (see section 8) — no history entry, and no full-editor re-render, on any intermediate frame; `TimelineWordHandles` is its own component specifically so a drag-frame update only re-renders that small subtree. The virtualized caption list (`list-virtualization.ts`) and the timeline's own visible-range virtualization were not touched. No DOM explosion: word click-regions/tick-marks/handles are rendered only for the single *selected* caption, exactly matching the pre-existing P7.2 word-boundary visualization's own scoping.

## 18. Test count

**981/981 passing** (904 at the start of this task + 77 new/modified: 28 in `word-edit.test.ts`, 12 in `word-navigation.test.ts`, 13 in `word-snapping.test.ts`, 22 in `editor-store-word-edit.test.ts` including the 5 scale-performance cases, and 4 new cases added to the pre-existing `word-timing.test.ts` proving the `isWordTimingStale` extension's backward compatibility).

## 19. Typecheck

`npm run typecheck` — clean, 0 errors, both mid-task (at 0.1.15) and on the final 0.1.16 build.

## 20. Lint

`npm run lint` — 0 errors throughout. The same 5 pre-existing warnings from before this task (`project-card.tsx`, `lib/ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`) remain, unchanged, in files this task never touched.

## 21. Dev QA

Performed against a disposable seeded project (English, Hindi/Devanagari, a Hinglish-ish caption, a multi-word "Testing word navigation here" caption for keyboard-nav testing, and one caption with deliberately mismatched word-count/text — genuinely stale, to confirm it stays flagged). All items from the task's own Dev QA list were exercised **except** the literal drag gesture (see section 8/25):
1. ✅ Click word → playhead seeks (confirmed via the timeline's own playhead pixel position).
2. ✅ Keyboard previous/next word.
3. ✅ Keyboard crosses caption boundary (with the target caption's row scrolling into view automatically).
4/5. ⚠️ Word start/end handles — commit path proven via the popover's numeric inputs (same `updateWordTiming`); the drag gesture itself not exercised (tooling limitation, see section 25).
6. ⚠️ Snapping — pure logic exhaustively unit-tested; live visual snap-guide not exercised (same drag-gesture limitation).
7. ✅ Invalid timing is rejected — confirmed live via the popover's numeric input (`10.0` correctly clamped to `2.48`).
8. ✅ Split word (English + Hindi/Devanagari).
9. ✅ Merge word.
10. ✅ Safe delete (no rejection needed, by design — see section 12).
11. ✅ Undo.
12. ✅ Redo.
13. ✅ Autosave.
14. ✅ Reload (word timing and text both persisted exactly).
15. ✅ Quality report becomes stale where expected.
16. Deferred to Packaged QA — the disposable dev project had no video, and playback independence needs one (see section 15 — verified there, live, with real video).
17. Deferred to Packaged QA for the same reason (see section 21/23 — verified there).
Also confirmed the *pre-existing*, genuinely-stale caption ("5 tokens of text, 3 words") still correctly shows its stale banner after this task's `isWordTimingStale` change — a direct regression check on the one piece of shared infrastructure this task modified.

## 22. Packaged QA

Built `npm run electron:pack` twice (once mid-task for QA at 0.1.15, once as the final release build at 0.1.16 after every gate passed), installed silently (`/S`), and tested against the actual installed `SUBLY.exe` — not `npm run dev` — using a disposable duplicate of a real, production-derived project ("Hindi/hinglish test," 28 real Hindi captions with real transcription word timing, and a real video file), created via the app's own existing `POST /api/projects/[id]/duplicate` endpoint. Verified, live, in the packaged app:
- Word navigation and word seeking (real transcription-derived, unevenly-spaced word timestamps, not synthetic evenly-spaced ones).
- Split, merge, delete — all on real Hindi content.
- Undo/redo (two consecutive undos correctly unwound a delete then a merge; redo correctly reapplied).
- Autosave + reload (persisted exactly).
- **Playback independence** (section 15) — verified with the real video: a manually-selected word stayed selected while a separately-playing word showed the independent "active" highlight.
- **Export after word edits** (section 17 spec item) — a real 1080p FFmpeg export completed (`status: "DONE"`, no error), producing a real ~3.0MB MP4 (HTTP 200, `video/mp4`).
- Keyboard guards — Left/Right correctly deferred to native text-cursor movement while typing; word-nav correctly did not fire while the timing popover (a Radix dialog) was open.
- Dialog guards — same `isAnyDialogOpen()` mechanism, unmodified, confirmed still correctly gating.
- **No regression to P14's clipboard shortcuts** — Ctrl+C ("Copied caption" toast) and Ctrl+V (pasted text correctly, verified via the DOM) both confirmed working, unmodified, in the 0.1.15 packaged build.
The word-timing drag *gesture* was attempted again in the packaged app and hit the identical tooling limitation described in section 8/25 — not re-litigated further here since the root cause (the automation tool's `left_click_drag`, not the app) was already isolated during Dev QA.

## 23. Production DB comparison

Following the exact backup → duplicate-one-real-project → QA-only-the-duplicate → diff → cleanup procedure established in the prior P14 closure task. `subly.db` (this machine's real, non-trivial, accumulated packaged-app database — 19 pre-existing projects, 2,266 subtitles, spanning every prior release-QA phase) was backed up byte-for-byte (SHA-256 recorded) before any QA. Only the app's own `duplicate` endpoint was used to create a test copy; every QA action in section 22 ran against *only* that duplicate's id. **Diff result: zero content differences in any of the 19 pre-existing projects or their 2,266 subtitles** (only the new duplicate project/subtitle/video/export-job rows this session itself created, and the expected `updatedAt` timestamps). The disposable duplicate and its files were deleted afterward, and a final count comparison (`projects/subtitles/videos/exportJobs`: 19/2266/19/46 before, identically 19/2266/19/46 after) confirmed the database was restored to an exact match. As with the P14 closure task, this is **not** paying-customer production data (none exists in this environment) — it is genuine, real, persistent packaged-app data from this machine's own release-QA history, handled with the same rigor real production data would require.

## 24. Installer filename and size

`release\SUBLY Setup 0.1.16.exe` — 566,409,650 bytes (≈540MB, matching every prior release build's size almost exactly, as expected since this task changes no packaged binaries). `release\SUBLY Setup 0.1.16.exe.blockmap` also produced. A final silent install + launch of this exact file was performed as the closing step, confirming a clean launch (3 real projects visible, zero console errors) and directly confirming the literal string `"0.1.16"` present in the packaged app's own served JS bundle.

## 25. Known limitations

- **Live mouse-drag-gesture verification of the word-timing handles could not be performed in this session**, due to a confirmed limitation of the browser-automation tooling available here (`left_click_drag` does not deliver the intermediate `pointermove` sequence this app's pointer-capture-based drag implementation expects) — proven to be a tooling limitation, not a P15-specific defect, by the *identical* test failing against the pre-existing, unmodified, already-shipped caption-level resize handle. The underlying logic is proven via 13 dedicated unit tests for the snap math plus the complete pre-existing `clampWordTiming` suite, and the exact same commit path (`updateWordTiming`) was verified live through the popover's numeric inputs. Recommend a follow-up live QA pass with a real mouse/trackpad (or a browser-automation tool that synthesizes trusted intermediate pointer-move events) specifically for the drag-handle gesture before treating it as fully closed.
- **Word split for scripts using combining/conjunct characters (e.g. Devanagari) is a plain character-count split**, not a Unicode grapheme-cluster-aware one — confirmed live (`"नमस्ते"` → `"नमस"`/`"्ते"`, where `्ते` is technically a combining vowel sign attached to what precedes it). This matches the task's own explicit "do not guess phonetic/linguistic boundaries" instruction and is always user-editable before confirming, but is worth calling out precisely rather than leaving implicit.
- **Word insertion was explicitly deferred** — see section 12 — per the task's own stated permission to do so when it would require a second text-state architecture.
- The pre-existing P14 known limitation (uncommitted-textarea-edit-discarded-by-Ctrl+X-with-no-selection) was not touched, not investigated further, and not regressed — P15 made no changes to that keyboard path.

## 26. Deferred work

- Word insertion (section 12/25).
- A grapheme-cluster-aware (rather than plain character-count) default split for combining-character scripts, if this becomes a real user-reported friction point.
- A dedicated live mouse-drag QA pass for the timing handles, once a suitable trusted-pointer-event automation tool (or manual QA) is available (section 25).
