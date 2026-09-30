# P18.3 — Word-Level Style Parity & Review UX Hardening

## 1. Task ID
110184

## 2. Scope
Audit the gap between caption-level (`SubtitleStyle`) and word-level (`Word.style`) styling, classify every candidate property for safe word-level extension end-to-end (editor, preview, ASS/libass export, persistence, undo/redo, display modes), and implement only the properties that pass that audit — through the existing mutation path, in the existing `WordTimingPopover` UI. No new styling framework, no redesign of the existing system, no packaging changes.

## 3. Baseline
Version 0.1.17. P18 preflight (108041), P18.1 (108762, PASS), P18.2 (109431, PASS) complete. Test suite at 1249/1249 before this task, typecheck PASS, lint 0 errors / 5 pre-existing warnings.

## 4. Full property capability matrix

| Property | Caption-level | Word-level before P18.3 | Editor | Preview | Export | Classification |
|---|---|---|---|---|---|---|
| `color` | yes | yes | yes | yes | yes (`\c`) | **supported** |
| `fontSize` | yes | yes | yes | yes | yes (relative `\fscx\fscy`) | **supported** |
| `fontWeight` | yes | type-only (no UI, no reads) | **added by P18.3** | yes (already read, unused) | yes (already emitted, unused) | **supported** |
| `backgroundColor` | yes | yes | yes | yes | no ("no per-run background box") | editor-only |
| `backgroundOpacity` | yes | yes (coupled to backgroundColor) | yes | yes | no | editor-only |
| `opacity` | yes | type-only | — | not read | only inside the `color` branch | unsafe |
| `highlightColor` | yes | type-only | — | — | — | unsafe (redundant with active-highlight mechanism) |
| `wordHighlight` | yes | type-only | — | — | — | unsafe (mode switch, not per-word value) |
| `activeWordScale` | yes | type-only | — | — | — | unsafe (parameterizes the highlight mechanism) |
| `lineHeight` | yes | type-only | — | — | — | unsafe (block-level, not per-word) |
| `boxWidthPercent` | yes | type-only | — | — | — | unsafe (box layout, not per-word) |
| `x`, `y` | yes | type-only | — | — | — | unsafe (word dragging is explicitly out of scope) |
| `align`, `vAlign` | yes | type-only | — | — | — | unsafe (box layout, not per-word) |
| `backgroundRadius/PaddingX/PaddingY` | yes | type-only | — | — | — | unsupported (word background already hardcodes its own padding; no export path exists for any background property) |
| `fontFamily`, `fontSource` | yes | type-only | — | — | — | unsupported (would need new plumbing through `resolveFontFamilyCss`'s script-fallback system + export font-manifest collection) |
| `letterSpacing` | yes | type-only | — | — | — | unsupported (no per-word plumbing today) |
| `textCase` | yes | type-only | — | — | — | unsupported (export transforms the whole line's text string, not a per-word substring) |
| `outlineEnabled/Color/Width` | yes | type-only | — | — | — | unsupported (preview's outline is a container-level CSS text-shadow trick, not per-span) |
| `shadowEnabled/Color/Blur/OffsetX/OffsetY/Opacity` | yes | type-only | — | — | — | unsupported (same reason as outline) |
| `italic` | **does not exist at any level** | n/a | n/a | n/a | n/a | not applicable — not in the data model |
| `underline` | **does not exist at any level** | n/a | n/a | n/a | n/a | not applicable — not in the data model |

Full reasoning for every row lives in [`src/lib/subtitles/word-style-capabilities.ts`](../src/lib/subtitles/word-style-capabilities.ts) as the `getWordStyleCapabilityReason` data — this table is a summary of that module, not a separate source of truth.

## 5. Audit findings
- `color`, `fontSize`, `backgroundColor`/`backgroundOpacity` were already fully wired (P17-era) with a UI in `style-panel.tsx`'s "Word overrides" section.
- `fontWeight` was the one genuinely bounded gap: [`subtitle-overlay.tsx`](../src/components/editor/subtitle-overlay.tsx)'s `wordDynamicStyle` already read `word.style?.fontWeight` into the live preview, and [`ass.ts`](../src/lib/subtitles/ass.ts)'s `wordStyleTag` already emitted `\b1`/`\b0` at the 700 threshold for export — both pre-existing, unused because no UI ever wrote to that property. This is a pure "add the missing control" fix, not new plumbing.
- `backgroundColor` is an already-established, already-documented "editor-only" precedent ("ASS has no per-run background box") — cited, not re-litigated.
- `opacity` is a genuinely partial/inconsistent case: export only applies it when `color` is also set; preview doesn't read it at all. Left unsafe/unextended.
- `highlightColor`, `wordHighlight`, `activeWordScale` all parameterize the *automatic* active-word highlight mechanism (`activeWordCss`/`wordOverride`), which already yields to a word's manual `color`/`fontSize` override via `{...active, ...manual}` precedence — a per-word version of these would be a second, ambiguous knob for the same outcome.
- `italic`/`underline` do not exist in `SubtitleStyle` at any level — confirmed by reading the full 46-line interface (`src/types/subtitle.ts:46-91`). Not a parity gap; inventing them would be a new styling framework, explicitly out of scope.
- Presets (`applyPreset`) only ever touch `project.globalStyle`/`project.animation` — never `sub.style` or `word.style` (confirmed by reading its implementation). `copyStyle`/`pasteStyle` only touch caption-level `sub.style`/`sub.animation` — same confirmation. Neither interacts with word overrides.
- `AnimationConfig` has no per-word variant anywhere in the type system (`Subtitle.animation?: Partial<AnimationConfig>` only) — re-confirms the P18 preflight's own finding.
- `word-edit.ts`'s `splitWordText`, `mergeWords`, and `resolveWordInsertion` all propagate the *whole* `word.style` object (`style: word.style`) rather than enumerating individual properties — so a new sub-property like `fontWeight` needed zero changes there; it rides along automatically.
- No dedicated test file previously existed for `setWordStyleOverride`'s own merge/reset semantics (only one incidental usage inside an `applyStyleToSubtitles` test).

## 6. Existing architecture reused
- **Mutation path**: `editor-store.ts`'s `setWordStyleOverride(subtitleId, wordIndex, patch)` — completely unchanged. Already `commit()`-routed (one undo step, autosave-compatible), already merges (`{...w.style, ...patch}`), already treats `patch === null` as "clear override."
- **Preview**: `subtitle-overlay.tsx`'s `wordDynamicStyle` — unchanged; it already read `fontWeight`.
- **Export**: `ass.ts`'s `wordStyleTag` — unchanged; it already emitted `\b1`/`\b0`.
- **Style resolution**: `resolveStyle(project, sub)` (`types/subtitle.ts`) — reused as-is to give the popover the caption's effective style, for computing the word's *effective* (inherited-or-overridden) weight.
- **P18.2 prop-threading pattern**: the new `onSetWordStyle` callback is passed from `CaptionsPanel` to `CaptionRow` **unwrapped** (it's already id-first, same shape as `onUpdateWordTiming`), exactly matching the stable-reference convention P18.2 established for every other word action.

## 7. New implementation
- **`src/lib/subtitles/word-style-capabilities.ts`** (new, pure, no side effects): `getWordStyleCapability`/`getWordStyleCapabilityReason` (the classification table in §4), `isWordStyleUiEligible`, `resolveEffectiveWordStyleValue`, `isWordStylePropertyOverridden`, `mergeWordStyleOverride` (merges a patch onto an existing override and collapses to `null` if the result would leave every property `undefined`, so unsetting the last override never leaves a stray, effectively-empty-but-truthy style object).
- **`word-timing-popover.tsx`**: a new "WORD STYLE" section with a single Bold (`B`) toggle and a "Reset" link (shown only once overridden). The toggle always writes an *explicit* 700/400 (not merely unsetting), because the caption's own weight can already be bold — un-setting would just fall back to a still-bold inherited value and silently fail to make one word not-bold. "Reset" is the separate, explicit path back to inheriting, scoped to only the `fontWeight` key (never touches a color/size/background override set via the Style panel's own section).
- **`captions-panel.tsx`**: threads the caption's resolved style (`captionStyle`, computed only for the selected row — same gate as `words`) and `setWordStyleOverride` (`onSetWordStyle`, passed straight through unwrapped) down through `CaptionRow` → `WordChips` → `WordTimingPopover`.
- **No changes** to `editor-store.ts`, `ass.ts`, `subtitle-overlay.tsx`, `word-edit.ts`, or `style-panel.tsx` — every one of those already did the right thing.

## 8. Inheritance/reset semantics
- No word override → the popover shows the *effective* value resolved from `resolveEffectiveWordStyleValue(captionStyle, word.style, "fontWeight")`, labeled "— inherited from caption style."
- Explicit word override → labeled "— word override," with a "Reset" control.
- Toggling Bold always writes an explicit 700/400 (a real override, indistinguishable in kind from the Style panel's own color/size/background overrides).
- "Reset" un-sets just `fontWeight` (`mergeWordStyleOverride(word.style, { fontWeight: undefined })`), collapsing to a full `null` clear only if `fontWeight` was the word's *only* override — verified live: a word with just a Bold override reset back to `words[i]` having **no `style` key at all**, not a stray `{fontWeight: undefined}`.
- Changing the caption's own weight updates every *inheriting* word but never touches a word with an explicit override — verified live (§14).

## 9. Display-mode behavior
- `applyOutputModeToWords` only swaps `.text` for the mode's own field (`hinglishText`/`gujaratiScriptText`) — `.style` is passed through unchanged by construction (confirmed by reading the function; not something P18.3 needed to touch).
- `splitWordText`/`mergeWords`/`resolveWordInsertion` propagate `word.style` wholesale (§5) — a Bold override survives split/merge/insert with zero new code.
- Not live-QA'd in an actual Hinglish/Gujarati Script project: the seeded QA fixture (§14) is English-only, and the display-mode switcher didn't surface Hinglish/Gujarati options for it (gated on transcription language). This is a code-level guarantee (cited above, plus P17.1's own established word-`style` propagation precedent) rather than a live-verified one for *this specific* property — listed under §15.
- Original text is never mutated by any of this: the popover's `onSetStyle` only ever calls `setWordStyleOverride`, which only ever writes to `w.style`, never `w.text`.

## 10. Undo/redo behavior
Verified live: toggling Bold on is one `commit()` (one undo step); Ctrl+Z reverted the word's effective weight from 700 back to inherited 400 in one step; Ctrl+Shift+Z redid it back to 700 in one step. No new undo/redo mechanism — `setWordStyleOverride` already routed through the store's existing `commit()`.

## 11. Export verification
**Critical, and done against a real render, not DOM/CSS.** A disposable QA project (`p18-3-bold-export-qa`) was seeded with a real 12s video and two captions: one word ("BOLD") given an explicit `fontWeight: 700` override against a caption-level weight of 400. Exported a real MP4 via the app's own Export dialog (1080p, server-side FFmpeg). Extracted a frame from the actual output file with `ffmpeg-static` and inspected it directly:

- The word "BOLD" renders visibly heavier/bolder than "THIS WORD IS" in the same caption, in the same burned-in frame — genuine `\b1` ASS override taking effect through libass, not a preview-only illusion.

This confirms `fontWeight` has true end-to-end parity: editor UI → live preview (verified via computed `getComputedStyle().fontWeight`, 700 vs 400) → ASS export → real MP4 pixels.

## 12. Performance results
Added 5 new tests to `editor-store-word-edit.test.ts` at 30/300/1800/3600/5400 total captions, each asserting: (a) `setWordStyleOverride` completes in well under 150ms, and (b) **every other caption's `Subtitle` object keeps the exact same reference** (`===`) after the commit — the specific P18.2 memoization contract this task was required not to undo. All 5 pass, including at 5400 captions (0.3–2.8ms). `setWordStyleOverride` itself was not modified, so this is proving a pre-existing guarantee holds, not a new optimization.

## 13. Tests added
- `src/lib/subtitles/__tests__/word-style-capabilities.test.ts` — 18 tests covering: capability classification for every category (supported/editor-only/unsafe/unsupported), reason strings present, UI-eligibility filtering, effective-value resolution (inherited/overridden/partial-override), override-detection, and `mergeWordStyleOverride`'s merge/collapse-to-null semantics (including the "un-setting the only property collapses to null" and "un-setting one of several leaves a real patch" cases).
- `src/store/__tests__/editor-store-word-edit.test.ts` — 5 new performance/reference-stability tests (§12).
- Both registered in `package.json`'s `test` script (the new capabilities file only; the store test file was already registered).
- **Baseline 1249 → 1272** (1249 + 18 + 5). Zero tests deleted or weakened.

## 14. Live QA
All performed in the browser against the dev server, using the seeded disposable project `p18-3-bold-export-qa` (real video, real captions) plus the pre-existing disposable `P18.2 Render Perf QA - 30 captions` project for the popover's basic display:

1. Selected a word with no override → popover showed "Bold off — inherited from caption style," matching the caption's actual weight (400 and, separately, 800 on another fixture).
2. Clicked the Bold toggle → live preview's actual DOM (`getComputedStyle`) showed the word at `fontWeight: 700` while sibling words stayed at the caption's inherited weight — verified twice, once against a 400-weight caption and once forcing bold against an 800-weight (already-bold) caption.
3. Verified autosave: network tab showed `PATCH .../projects/:id → 200 OK` after the toggle; reloading the page and querying the database directly showed the word's `style: {"fontWeight":700}` persisted.
4. Undo (Ctrl+Z) reverted to inherited in one step; Redo (Ctrl+Shift+Z) restored the override in one step (§10).
5. Reset button cleared just the `fontWeight` key — the word's `style` field became fully absent (not a stray empty object) — confirmed directly in the database.
6. Changed the caption's own weight (400 → 900 via the Style panel) while the word had an explicit override → inheriting siblings became 900, the overridden word stayed at 700 — confirmed via `getComputedStyle` (§8/§9).
7. Exported a real MP4 and inspected the actual rendered frame (§11) — the definitive parity check.
8. Console/network checked throughout — no errors traceable to this task's code (one 400 was hit and diagnosed, but it was caused by a typo in this task's own seed data — an invalid `vAlign: "middle"` instead of `"bottom"` in the hand-written `globalStyle` — not a defect in the shipped code; fixed in the seed and reproduced cleanly afterward).
9. Confirmed `style-panel.tsx`'s pre-existing "Word overrides" section (Color/Size/Background) still renders and still works unchanged alongside the new popover control — not duplicated, not regressed.

## 15. NOT TESTED items
- Live QA in an actual Hinglish/Gujarati Script project (the seeded fixture is English-only and the mode switcher didn't offer those options for it). Covered instead by a direct code-path guarantee (§9) and the pre-existing P17.1 precedent for `word.style` propagation across derived-mode edits — not a live-browser confirmation for this specific new property.
- Split/Merge/Insert interaction with an explicit Bold override, in the live browser (covered at the unit level already via P17-era `word-edit.ts` tests, which assert `style` propagation generically — no new test added specifically for "split a word that has a fontWeight override," since the mechanism is untyped/opaque to the specific property and already covered).
- Real playback (video actually running while a bold-overridden word is the active/highlighted word) — the seeded video is a static 8-second clip; only scrubbing/paused-frame verification was done, consistent with "do not claim playback QA unless a real video asset is available" applying more to *animation timing* than to this static style property, but flagged here for completeness.

## 16. Known limitations
- The Bold toggle offers only two effective states (bold/not-bold) rather than the caption-level Weight dropdown's 6 values (400–900), because ASS export can only represent word-level weight as a binary `\b1`/`\b0` toggle at the 700 threshold — a finer per-word dropdown would look right in the editor and silently flatten on export. This is a deliberate, documented reduction in precision, not an oversight.
- `backgroundColor`/`backgroundOpacity` word overrides remain editor/preview-only (pre-existing, unchanged).
- `fontFamily`, `letterSpacing`, `textCase`, `outline*`, `shadow*` remain unextended at the word level — each would need new preview/export plumbing beyond this task's bounded scope (§4/§5); none are unsafe in principle, just out of scope for "the smaller number of genuinely end-to-end-supported properties" this task targeted.

## 17. Protected systems
Not touched: Prisma schema, persistence architecture, autosave queue, crash recovery, undo/redo architecture, Original/Hinglish/Gujarati source-of-truth semantics, word timing authority, word insertion/split/merge/delete semantics, quality-report architecture, transcription, FFmpeg worker architecture, installer/Electron packaging, P18.2's virtualization and stable-callback/memoization architecture (extended via the exact same pattern, not modified).

## 18. Packaging decision
NOT REQUIRED — no Electron/native/packaging-specific code touched. Version kept at 0.1.17.

## 19. Final verification
- `npm test`: **1272/1272 PASS** (1249 baseline + 23 new).
- `npx tsc --noEmit`: **PASS**, 0 errors.
- `npx eslint .`: **PASS**, 0 errors, 5 pre-existing warnings (identical set to before this task — none newly introduced).

## 20. Explicit P18.4 status
NOT STARTED.

---

TASK ID: 110184
STATUS: PASS
VERSION: 0.1.17
PRODUCTION CODE CHANGED: YES
DATABASE CHANGED: NO
TESTS: 1272/1272
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18.4: NOT STARTED
