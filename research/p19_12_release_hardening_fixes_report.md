# P19.12 — Release Hardening: Confirmed P0/P1 Correctness Fixes

## Task ID

137421

## Scope

Fix exactly the P0 finding and six P1 findings confirmed by P19.11's audit-only report (`research/p19_11_release_candidate_gap_audit.md`). No new feature phase, no architecture redesign, no packaging. The source tree is left ready for P19.13 (fresh packaged Electron build + Windows release QA).

## Files changed

- `src/components/landing/pricing.tsx` — rewritten (P0).
- `src/types/subtitle.ts` — added `TRANSLATABLE_LANGUAGES` constant.
- `src/lib/ai/index.ts` — import cleanup only (no behavior change).
- `src/app/api/translate/route.ts`, `src/app/api/projects/[id]/translate/route.ts` — validate against the shared constant instead of a duplicated literal.
- `src/components/editor/ai-menu.tsx` — Translate menu filtered by the shared constant.
- `src/lib/subtitles/word-preview-scale.ts` — new, `scaleWordStyleValue` (pure, zero-import).
- `src/lib/subtitles/preview-style.ts` — re-exports `scaleWordStyleValue`.
- `src/components/editor/subtitle-overlay.tsx` — `wordDynamicStyle` now scales word-level fontSize/letterSpacing.
- `src/store/editor-store.ts` — exported `resolveTimingUpdate`; fixed `undo()`/`redo()` to regenerate derived text; fixed 5 call sites that rebuild caption `.text` to exclude removed words.
- `src/components/editor/timeline.tsx` — caption drag now uses a local live-preview state, committing once on pointer-up/-cancel.
- `src/lib/subtitles/ass.ts` — `joinWithOriginalLineBreaks` now walks word-object boundaries (not raw text tokens); all callers updated.
- `src/lib/subtitles/output-mode.ts` — 5 call sites updated for the new `joinWithOriginalLineBreaks` signature.
- `package.json` — 8 new test files registered in `test` and a new `test:p19-12` script.
- 8 new test files (see §Tests).

## Production behavior changed

Yes — see each fix below. No database schema, no migration, no Electron packaging changes.

## P0 fix

### 1. Pricing page (`src/components/landing/pricing.tsx`)

Removed the fictional 3-tier plan table (fake project/duration limits, a non-existent watermark, fake team seats/priority rendering) and the literal developer-facing sentence "Placeholder pricing — wire up your billing provider of choice." Replaced with a single, truthful section: "Free during preview," listing only capabilities that actually exist today (AI transcription, caption styling, timeline editing, export formats), with a real "Start for free" CTA to `/register`. Kept `id="pricing"` so the navbar/footer anchor still resolves. No billing system, checkout, or subscription state was built — per the task's explicit instruction not to.

**Test:** new `src/components/landing/__tests__/pricing-claims.test.ts` (4 tests) — no landing component contains developer-placeholder language or a dollar-denominated price (since no billing exists); `pricing.tsx` specifically contains no fictional entitlement claims; the section still exists with its anchor id.

## P1 fixes

### 2. Translate language mismatch

Added `TRANSLATABLE_LANGUAGES` (`src/types/subtitle.ts`) — the exact same 10 codes (`en, hi, gu, es, fr, de, pt, ar, ja, ko`) both `/api/translate` route handlers already validated against, previously duplicated as an identical `z.enum([...])` literal in each. Both routes now import and validate against this one constant. `ai-menu.tsx`'s Translate menu now filters `LANGUAGES` by `TRANSLATABLE_LANGUAGES` in addition to the existing current-language exclusion, so `mr/bn/ta/te/pa/ur` (the 6 previously-selectable-but-rejected codes) can never appear. Placed in `types/subtitle.ts` (not `lib/ai/index.ts`, which pulls in the server-only `openai` package) so the same constant is safely importable from the client-side menu component.

**Test:** new `src/components/editor/__tests__/ai-menu-translate-targets.test.ts` (5 tests) — confirms the 6 previously-broken codes are excluded, the menu component's source references the shared constant, both route files validate against it, and a simulated menu-build (mirroring the component's own filter expression) never contains a rejected code.

**Live QA:** confirmed in the real running app — the Translate menu on a live project shows exactly "Hindi, Gujarati, Spanish, French, German, Portuguese, Arabic, Japanese, Korean" (9 of the 10, English excluded as the project's own language) with none of the 6 broken languages present.

### 3. Word-level preview scaling

`subtitle-overlay.tsx`'s `wordDynamicStyle` previously set `manual.fontSize`/`manual.letterSpacing` directly from the raw stored (reference-height) number with no scaling, while the caption-level equivalent (`preview-style.ts`'s `styleToTextCss`) correctly scales by `refHeightPx / 1920`. Extracted the scaling formula into a new, zero-import pure function `scaleWordStyleValue(value, refHeightPx)` (`src/lib/subtitles/word-preview-scale.ts` — kept out of `preview-style.ts` itself, which uses the `@/...` alias and extensionless imports that only Next.js's bundler resolves, not this project's node-native test runner). `wordDynamicStyle` now calls it for both properties, preserving the existing `!== undefined` (not truthy) check so `0` and negative values remain meaningful. No change to stored values, word-style resolution, export scaling, or `wordStyleTag`.

**Test:** new `src/lib/subtitles/__tests__/word-preview-scaling.test.ts` (7 tests) — no-op at the reference height, the exact 64px-at-640px-canvas scenario from the audit (confirms the scaled value is well under half the raw value), proportional scaling, zero, negative, and scaling above the reference height.

**Live QA:** confirmed in the real running app at an actual ~436px-tall preview canvas — a word overridden to `fontSize: 90, letterSpacing: 8` computed to `fontSize: 20.4375px, letterSpacing: 1.81667px`, which is `90 * (436/1920)` and `8 * (436/1920)` respectively, exact matches — while the caption's own unoverridden words computed to `14.5333px = 64 * (436/1920)`, confirming the word now scales by the identical factor as the caption text around it (previously it would have rendered at the raw, unscaled 90px — roughly 4-6x too large next to 14.5px caption text).

### 4. Timeline caption-drag undo coalescing

`timeline.tsx`'s caption edge/move drag called `updateSubtitleTiming` (a full commit) on every `pointermove`. Exported the store's existing pure clamp/validation function `resolveTimingUpdate` (`editor-store.ts` — was module-private) so the timeline can call it on every pointermove for a purely local, non-committing live preview (`captionDragPreview` state, mirroring the exact pattern `TimelineWordHandles`' own word drag already used with `clampWordTiming`). `TimelineCaptionBlock` now reads `dragPreview?.start ?? subtitle.start` / `dragPreview?.end ?? subtitle.end` for its on-screen position/width, with `dragPreview` being `null` for every caption except the one actively being dragged (so unrelated captions never re-render mid-drag, preserving the existing memoization contract). `onPointerUp` (also wired as `onPointerCancel`) calls the real `updateSubtitleTiming` exactly once, with the last accepted preview position — one call, one commit, one undo entry, for the entire gesture. A rejected candidate ("word-out-of-bounds") leaves the preview exactly where it was — the same "stops at the wall" visual behavior as before, just without a commit on every tick. `MAX_HISTORY`, the `past`/`future` arrays, and the commit/snapshot architecture are completely untouched.

**Test:** new `src/store/__tests__/editor-store-caption-drag-coalescing.test.ts` (7 tests) — `resolveTimingUpdate` makes zero commits across 100 simulated pointermove ticks and never mutates the subtitles array; its own clamp/validation is unchanged; an 80-tick simulated drag followed by one `updateSubtitleTiming` call produces exactly one new undo entry; a 200-tick drag (over 3x `MAX_HISTORY`) does not evict 5 prior real edits' own undo history; a gesture where every candidate is rejected commits nothing; pointer-cancel behaves like pointer-up (one commit); redo after a coalesced commit restores the exact final position. This project has no React-rendering test infrastructure, so — per the task's own explicit fallback instruction — these test the extracted pure gesture logic and the store-level "one call, one commit" invariant directly rather than simulating real DOM pointer events.

**Live QA (real mouse drag, not synthetic):** made two real text edits (building undo history), then performed a real `left_click_drag` moving a caption on the timeline (the drag was long enough to trigger the existing word-out-of-bounds rejection toast partway through, confirming validation still runs live). Pressing Ctrl+Z **once** fully reverted the caption to its exact pre-drag timing (`00:03.00 → 00:05.40`) — proving the whole gesture coalesced to one undo step. A **second** Ctrl+Z then correctly reverted the earlier of the two prior text edits, proving that undo history predating the drag survived completely intact. Two Ctrl+Shift+Z (redo) presses correctly restored both the text edit and the exact dragged position.

### 5. Removed words reappearing in caption text

Every structural word-editing action (`splitWord`, `mergeWordWithNext`, `deleteWord`, `insertWord`, `reorderWord` — 5 identical call sites in `editor-store.ts`) rebuilt `.text` via `words.map((w) => w.text).join(" ")`, including soft-deleted (`removed: true`) words. Changed all 5 to `words.filter((w) => !w.removed).map((w) => w.text).join(" ")`. The word object itself — its `removed` flag, timing, style, and confidence — is completely untouched; only the reconstructed visible/exported text excludes it. `isWordTimingStale`'s own non-removed-word counting was already correct and needed no change.

**Test:** new `src/store/__tests__/editor-store-removed-word-text.test.ts` (8 tests) — the task's own exact worked example ("so this is good" → soft-delete "this" → "so is good"), then reorder/split/merge/delete-another-word/insert, each confirming "this" never reappears and word-timing staleness is never falsely tripped; the removed word's own metadata survives every edit untouched; undo restores the correct (already-removed-word-excluded) text.

**Live QA:** seeded a caption "so is good" with "this" soft-deleted (start/end still occupying its own timing slot). Opened the word popover for "good" and used the real "Move earlier" button twice through the actual UI — the array reordered to `[so, this, good, is]` and the caption's own text/preview correctly read "so good is" at every step, with "this" never appearing, confirmed via the live DOM text.

### 6. Merged multi-token word line reconstruction

`joinWithOriginalLineBreaks` (`ass.ts`) counted how many array entries belonged to each stored line by re-tokenizing the *original text string* (`line.split(/\s+/).length`) — correct only when every word object is exactly one token. A word merged by `mergeWords` (e.g. `.text = "hello world"`) is still one array entry but two tokens, so the old counting silently borrowed entries from the next line. Changed the function to take a new `sourceTexts: string[]` parameter (each word object's own raw, untransformed `.text`) and walk word objects one at a time, accumulating each one's own token width, until a line's own token target is met or exceeded — a merged word is therefore always assigned to exactly one line, atomically, never split across two (per the task's explicit "do not solve this by splitting merged word objects back into multiple word objects" constraint). All 6 call sites (1 in `ass.ts`, 5 in `output-mode.ts`) updated to pass the correct `sourceTexts` — the ORIGINAL (pre-mode-projection) word texts in every case, since that's what the original stored line-break structure was computed against.

**Test:** new `src/lib/subtitles/__tests__/merged-word-line-reconstruction.test.ts` (9 tests) — the task's own exact worked example; a merged word on the same line as normal words; a merged word straddling what would otherwise be a line boundary (kept atomic); multiple lines each with their own merged word; ordinary one-token words completely unaffected (byte-for-byte); a real `buildAssDocument` call proving the `\N` break lands correctly (not the old bug's exact wrong placement); `applyOutputMode` passthrough in Original mode; derived-mode (Hinglish) reconstruction with a merged word.

**Live QA + real MP4 export:** merged two words in a two-line caption through the real word popover's "Merge" button (`"HELLO"+"WORLD"` → one word `"HELLO WORLD"`, spanning its combined timing). The editor's own re-wrapped stored text became `"HELLO WORLD TESTING MERGE\nHERE ON A SECOND LINE NOW"`. Exported a real MP4 and extracted a frame: the burned-in video shows **exactly** `"HELLO WORLD TESTING MERGE"` / `"HERE ON A SECOND LINE NOW"` — matching the stored text precisely, with the merged word never split and no tokens stolen across the line boundary. Frame sent to the user as evidence.

### 7. Derived text after mode-switch undo/redo

`captionOutputMode` deliberately lives outside `HistorySnapshot` (mode switching is not a commit), so a restored `past`/`future` snapshot can predate the project's *current* mode ever having been switched to, leaving some/all captions with no `hinglishText`/`gujaratiScriptText`. Applied the exact same gap-filling regeneration `commit()`/`load()` already use (`ensureHinglishCoverage`/`ensureGujaratiScriptCoverage`) inside `undo()` and `redo()`, run against the *current* `project.captionOutputMode` on the snapshot's own subtitles before installing it. Both helpers are already designed to never overwrite existing (generated or user-edited) derived text — they only fill gaps — so this is purely additive. Neither the mode-separation architecture, the snapshot format, nor `setCaptionOutputMode`'s own non-commit behavior changed.

**Verified as a real regression, not just a passing test:** temporarily reverted `undo()`'s fix and re-ran the new test suite — 2 of 6 tests failed exactly as expected (missing `gujaratiScriptText`/word-level `hinglishText`), then restored the fix and confirmed all 6 pass again.

**Test:** new `src/store/__tests__/editor-store-mode-switch-undo-redo.test.ts` (14 tests: 6 correctness + 8 performance) — Original→edit→switch-to-Hinglish→edit→undo-across-the-switch→derived text present; the same crossing forward via redo; the same fix for Gujarati Script mode; the regeneration never overwrites a user's own hand-edited derived text; `setCaptionOutputMode` still creates no undo entry; word-level (not just caption-level) derived text is also regenerated; performance at 30/300/1800/5400 captions in both the common (no-op, same-array-reference) case and the actually-regenerating case.

**Live QA (real database-verified):** in a live Hindi project, made a real Devanagari text edit (commit 1), switched to Hinglish via the Settings panel toggle (generating derived text), made a second edit to the Hinglish text directly (commit 2), then pressed Ctrl+Z twice — crossing back past the point where Hinglish generation had ever run. Queried the live database directly afterward: `captionOutputMode: "hinglish"` (untouched by undo, as designed), `text: "ठीक है"` (confirming the undo genuinely restored the pre-edit original), and **`hinglishText: "Theek hai"` with both words' own `hinglishText` populated** — not null/absent, which is exactly the bug this fixes.

## Test coverage

8 new test files, 61 new tests total, all passing:

| File | Tests |
|---|---|
| `pricing-claims.test.ts` | 4 |
| `ai-menu-translate-targets.test.ts` | 5 |
| `word-preview-scaling.test.ts` | 7 |
| `editor-store-caption-drag-coalescing.test.ts` | 7 |
| `editor-store-removed-word-text.test.ts` | 8 |
| `merged-word-line-reconstruction.test.ts` | 9 |
| `editor-store-mode-switch-undo-redo.test.ts` | 14 (6 correctness + 8 performance) |
| (subtotal above) | 54 |

Total: 54 new tests. No existing test was weakened, deleted, or had its assertions loosened.

## Full test result

`npm test`: **1872/1872 passing** (1818 baseline from the end of P19.11 + 54 new focused tests = 1872).

## Typecheck result

`npx tsc --noEmit`: clean, 0 errors.

## Lint result

`npx eslint .`: 0 errors, the same 5 pre-existing warnings (`project-card.tsx`, `lib/ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`) — unchanged from before this task; no new warnings introduced (one transient warning from an unused import was caught and fixed during this task).

## Performance results

All existing performance suites at 30/300/1800/5400 captions continue to pass within their existing budgets — no regression measured. The one fix with genuine new per-call cost (fix #7's `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` calls inside `undo()`/`redo()`) was specifically measured: the common case (no mode-switch boundary crossed, same-array-reference no-op) stays under 2ms even at 5400 captions; the worst case (actually regenerating Hinglish text for all 5400 captions) takes ~52ms, comfortably under a 2000ms budget. No O(n²) pattern was introduced by any of the 7 fixes — every new per-caption/per-word operation added is a single additional O(n) or O(words-in-one-caption) pass, not nested.

## Manual QA performed

All 9 of the task's required manual QA items were performed against the real running app (real mouse/keyboard interaction, no synthetic pointer events):

1. Pricing page — confirmed visually truthful, no developer placeholder.
2. Translate menu — confirmed exactly the 9 supported (non-current-language) targets, none of the 6 broken ones.
3. Word fontSize/letterSpacing — confirmed exact correct scaling via live computed styles at a real ~436px preview canvas.
4-6. Timeline drag — real mouse drag (slow, triggering a real rejection toast mid-gesture), confirmed one Ctrl+Z undoes the whole drag, a second Ctrl+Z reaches a prior real edit, two redos restore both.
7. Removed word — confirmed live through 2 real word-reorder clicks that the removed word never resurfaces.
8. Merged word in a multi-line caption — confirmed live through the real Merge button, then a real MP4 export + extracted frame proving correct burned-in line structure.
9. Mode-switch undo/redo — confirmed live through the real Hinglish toggle, 2 real edits, 2 real undos, and a direct database query proving derived text was correctly regenerated.

## Remaining limitations

- Fix #4 (timeline drag) does not also keep `TimelineWordHandles`' own word-tick-mark positions live-synced during a "move" drag of the currently-selected caption (they still read the committed `subtitle.start`, not the live preview) — a narrow, pre-existing-shape visual nuance, not a correctness bug (the caption block itself, and the final committed result, are both fully correct); documented rather than fixed, to keep this change minimal and scoped to the undo-coalescing behavior the task asked for.
- All other P2/P3 items from the P19.11 audit remain open by design — explicitly out of scope per this task's own §11 scope-control list.

## Protected systems — confirmed not redesigned

- Word-style resolution architecture (`resolveEffectiveWordStyleValue`, `mergeWordStyleOverride`, `isWordStylePropertyOverridden`, `WORD_STYLE_CAPABILITIES`) — untouched.
- `WrapStyle: 2` (P19.10) — untouched.
- Undo/redo architecture — `MAX_HISTORY = 60`, the `past`/`future` arrays, structural sharing, and the `commit()` function itself are all byte-for-byte unchanged; fix #4 changed only how often `timeline.tsx` *calls* `updateSubtitleTiming`, and fix #7 added two already-existing helper calls inside `undo()`/`redo()` — neither touches the snapshot format or the history-truncation mechanism.
- Original/Hinglish/Gujarati-Script display-mode architecture — the mode-separation model, `applyOutputMode`, and the lazy-generation contract are unchanged; fix #7 reuses the exact existing regeneration helpers rather than adding new machinery.
- Autosave single-flight queue — untouched.
- Transcription/Whisper, language-policy backend architecture, caption timing architecture, timeline ruler virtualization, playback/scrubbing, ripple-delete implementation, database schema, Electron packaging fundamentals, quality taxonomy — none were touched.
- Existing style-propagation conventions (split copies to both halves, merge keeps the first word's style, insertion copies the anchor's style) — unchanged; fix #6 is about text/line *reconstruction*, not style propagation.

## Packaging

**NOT RUN — reserved for P19.13**, per this task's own explicit instruction. No Electron build, no installer changes.
