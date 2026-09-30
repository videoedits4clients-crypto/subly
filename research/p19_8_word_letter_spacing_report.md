# P19.8 — Word-Level Letter Spacing & Export Parity

## 1. Task ID

131508

## 2. Scope

Add professional word-level letter-spacing override support, end-to-end:

WORD OVERRIDE → EDITOR PREVIEW → PERSISTENCE → ORIGINAL/HINGLISH/GUJARATI MODES → UNDO/REDO → WORD EDITING → ASS EXPORT → REAL MP4 OUTPUT.

A bounded feature extension on top of the existing word-style system (P18.3, re-audited P19.7) — no redesign, no changes to Whisper/transcription/language handling/Gujarati ASR/timeline ruler virtualization/playback-scrubbing/ripple-delete implementation/caption-timing architecture/quality system/autosave architecture/undo-redo architecture/database schema/Electron packaging.

## 3. Phase-0 audit

Read: `types/subtitle.ts`, `word-style-capabilities.ts`, `word-timing-popover.tsx`, `style-panel.tsx`, `subtitle-overlay.tsx`, `global-style-validation.ts`, `presets.ts`, `editor-store.ts` (`setWordStyleOverride`), `word-edit.ts`, `segment.ts`, `ass.ts` (in full for all `letterSpacing`/`\fsp` usages), `hinglish-toggle.tsx`, `preview-style.ts`, and the P18.3/P19.7 reports.

Answers to the 7 required questions:

1. **Does `letterSpacing` already exist in `SubtitleStyle`?** Yes — `types/subtitle.ts:57`, a top-level field, default `0`.
2. **Its unit?** Plain `number`, px at `REFERENCE_HEIGHT = 1920` (ass.ts) — the same reference-height convention `fontSize`/`outlineWidth`/etc. already use.
3. **Existing global caption-level behavior?** `style-panel.tsx`'s "Font" section has a "Letter spacing" `NumberSlider` (`min={-2} max={12} step={0.5} suffix="px"`), patching `globalStyle`/a caption's own `style` override. Consumed in preview via `preview-style.ts`'s `styleToTextCss`: `letterSpacing: \`${style.letterSpacing * scale}px\`` on the caption CONTAINER. Consumed in export via `ass.ts`'s `buildStyleLine`: `Math.round(style.letterSpacing * scale)` written into the ASS `Style:` line's own "Spacing" field.
4. **Existing ASS `\fsp` handling?** None. A full-file grep for the literal `\fsp` returned zero matches before this task — only the Style-line-level "Spacing" field existed, never a per-run inline override tag.
5. **Existing CSS letter-spacing handling?** Only at the caption-container level (`preview-style.ts`). `subtitle-overlay.tsx`'s `wordDynamicStyle` (the per-word manual-override path) had no `letterSpacing` branch at all.
6. **Existing export conversion?** Only the caption/global Style-line Spacing field (item 3) — no word-level conversion.
7. **Does style serialization already preserve unknown/known properties safely?** Yes — `word.style` is validated only as `z.record(z.string(), z.unknown())` in both `api/projects/[id]/route.ts` and `api/ai/remove-fillers/route.ts` (no per-field word-style schema exists), and `setWordStyleOverride`'s store implementation is a plain, fully generic `{ ...w.style, ...patch }` merge — neither needed any change for a new property.

**Conclusion:** `letterSpacing` was a real, existing, well-defined caption/global-level property with zero word-level plumbing anywhere (preview, export, or UI) — exactly the "unsupported" classification `word-style-capabilities.ts` already documented, and exactly the gap this task closes.

## 4. Existing letter-spacing architecture (pre-task)

- **Model:** `SubtitleStyle.letterSpacing: number` (px @ 1920 reference height), default `0`, range `-2..12` (the UI control's own bounds; no schema-level min/max in `global-style-validation.ts`, which only checks type).
- **Preview:** caption-level only, via `preview-style.ts`.
- **Export:** caption-level only, via the ASS Style-line "Spacing" field (`buildStyleLine`).
- **Word level:** nothing — `word-style-capabilities.ts` classified it `unsupported`.

## 5. Data model

No new type, no new unit, no schema change. `Word.style?.letterSpacing?: number` reuses `SubtitleStyle.letterSpacing` verbatim, exactly as `color`/`fontSize`/`fontWeight`/`backgroundColor` already do. Contract (Phase 1):

- `undefined` → inherit the caption's resolved `letterSpacing` (via the already-generic `resolveEffectiveWordStyleValue`).
- An explicit value (including `0` and negative values within the existing `-2..12` range) → this word's own value, checked with `!== undefined`, never a truthy check (0 must not be treated as "no override").
- Reset removes only `letterSpacing` from the word's override object, via the already-existing `mergeWordStyleOverride(word.style, { letterSpacing: undefined })` — the same helper `word-timing-popover.tsx`'s Bold-Reset already uses for `fontWeight`. No new helper was needed.

## 6. UI implementation

Added to `style-panel.tsx`'s existing "Word overrides" section (gated behind selecting a caption + the "This caption" scope toggle, same as Color/Size/Background) — no new panel, no new popover:

- A `Row label="Letter spacing"` with the same `NumberSlider` control used for the caption-level control, same bounds (`min={-2} max={12} step={0.5} suffix="px"`), defaulting its displayed value to the word's override if present else the caption's resolved value (`?? style.letterSpacing`).
- A "Reset" button, shown only when `isWordStylePropertyOverridden(word.style, "letterSpacing")`, calling `setWordStyleOverride` with `mergeWordStyleOverride(word.style, { letterSpacing: undefined })` — clears only this property.

`word-timing-popover.tsx` was deliberately left untouched — per its own documented scope ("avoid turning WordTimingPopover into a miniature Style panel"), Color/Size/Background/Letter-spacing all live in `style-panel.tsx`'s Word overrides section; the popover keeps only its single Bold toggle.

## 7. Preview behavior

`subtitle-overlay.tsx`'s `wordDynamicStyle`:

```ts
if (word.style?.letterSpacing !== undefined) manual.letterSpacing = `${word.style.letterSpacing}px`;
```

`!== undefined`, not a truthy check — verified `0` and negative values both apply correctly (unit + live tests). Merged into the returned `{...active, ...manual}` object unchanged — the word's manual override still wins over the automatic active-word highlight for this property, same precedence as every other word-style property. A live DOM check confirmed only the overridden word's `computedStyle.letterSpacing` changes; every neighboring word (including three separate "WORD" tokens with identical text) stayed `normal`.

## 8. Persistence

`setWordStyleOverride` itself needed no change (already a generic `Partial<SubtitleStyle> | null` merge). Verified:

- Apply → the DB row's `subtitle.words` JSON contains exactly `{"style":{"letterSpacing":12}}` for the targeted word (checked via a direct Prisma query against the live dev DB).
- Apply → real page reload → the editor's live DOM (`getComputedStyle(...).letterSpacing`) still reads `12px` — a genuine autosave + reload round-trip, not a store-only check.
- Reset: `mergeWordStyleOverride` does not delete the key outright when siblings remain (pre-existing P18.3 design — it only collapses fully to `null` once every property is undefined; the existing `fontWeight` test already documents this exact shape). An explicit `letterSpacing: undefined` key is functionally identical everywhere it's read (every consumer already checks `!== undefined`), and `JSON.stringify` — the real persistence path — drops it entirely. Verified both the live in-memory contract (via property-level equality) and the actual JSON round-trip (`JSON.parse(JSON.stringify(word.style))` produces exactly `{color, fontWeight}`).
- Compound case from the spec (`{color, fontWeight, letterSpacing}` → reset `letterSpacing` → result) verified exactly: `color` and `fontWeight` untouched, `letterSpacing` gone (functionally and after JSON round-trip).

## 9. Display modes

`setCaptionOutputMode` (`editor-store.ts`) only adds `hinglishText`/`gujaratiScriptText` fields via `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` — it never touches `word.style` at all. Verified with the established non-monotonic `BRAVO[2,3] DELTA[5,6] CHARLIE[3.5,4.5]` fixture: applied `letterSpacing` to CHARLIE, cycled Original → Hinglish → Gujarati Script → Original, confirmed CHARLIE's override survived unchanged throughout (store-level test + code-path confirmation).

## 10. Word-editing behavior

All verified against the non-monotonic fixture, following the **existing, already-documented** style-propagation conventions in `word-edit.ts`/`word-reorder.ts`/`ripple-edit.ts` (none of which branch on which `SubtitleStyle` property is set — they move/copy the whole `style` object):

| Operation | Result |
|---|---|
| Reorder | The override travels with the CHARLIE word object to its new array index; the word that now occupies CHARLIE's old index does **not** inherit it. |
| Split | **Both** halves inherit the split word's `letterSpacing` (existing `splitWordText` convention: `style` copied to both halves). |
| Merge | The merged word keeps the **first** word's `letterSpacing`, proven by giving the second half a different value first (existing, documented merge convention — not a new policy). |
| Insertion | The newly-inserted word inherits the **anchor** word's `letterSpacing` — this is `resolveWordInsertion`'s existing, explicitly documented behavior ("style propagates from the anchor word... so the newly inserted word visually matches its immediate neighbor"), confirmed identical for letterSpacing as for color/fontSize. Not a regression. |
| Caption split (`splitSubtitleAtTime`) | Each half's words keep their own `letterSpacing` intact — `splitSubtitleAt` only partitions the words array, never inspects `style`. |
| Caption merge (`mergeWithNext`) | Both captions' word-level overrides survive into the merged caption's words array. |
| Ripple delete of an earlier caption | CHARLIE's timing shifts by the deleted span; `letterSpacing` is untouched. |

## 11. ASS generation

`wordStyleTag(baseStyle, wordStyle, scale)` in `ass.ts` gained one new branch:

```ts
if (wordStyle.letterSpacing !== undefined) tag += `\\fsp${Math.round(wordStyle.letterSpacing * scale)}`;
```

- `\fsp` is an **absolute** ASS override tag (unlike `\fscx`/`\fscy`, which are relative percentages) — scaled by the same `playResY / REFERENCE_HEIGHT` factor `buildStyleLine` already uses for the caption-level Spacing field, so word- and caption-level letter spacing stay consistent across export-quality tiers. `scale` is threaded through `renderLineText` (previously computed only in `buildAssDocument` for `buildStyleLine`).
- Word-boundary scoping was **already correct** by construction: `renderLineText` wraps every word carrying any override in `{tags}text{\r}`, and `{\r}` resets **all** override tags (including the new `\fsp`) back to the Style line's defaults before the next word — the same mechanism `\c`/`\fscx\fscy`/`\b1`/`\b0` already relied on. No new reset logic was needed.
- The pre-existing caption/global Style-line "Spacing" field (`buildStyleLine`) is completely untouched by this change — verified by a dedicated test comparing the `Style:` line byte-for-byte with and without a word override present.
- New dedicated test file `src/lib/subtitles/__tests__/word-letter-spacing-export.test.ts` (7 tests): tag emission + word-boundary scoping, isolation from all neighbors (including two other identical-text "WORD" tokens), scale factor, explicit `0`, negative value, "no `\fsp` when no override", and Style-line non-interference.

**Known, pre-existing, orthogonal limitation (not introduced by this task):** the P5.1 active-word background-chip width estimator (`computeActiveWordChip`/`estimateTextWidthPx`) only ever reads the **caption's** own `style.letterSpacing` for its width math, never a per-word override — but this is equally true today for a word's `fontSize`/`fontWeight` override, which also isn't reflected in chip sizing. Not addressed here (out of this bounded task's scope; not a letterSpacing-specific gap).

## 12. Real MP4 verification

Mandatory per the task spec — not skipped.

- Seeded a disposable project (`p198letterspacingqamuljhhux`, owned by a fresh disposable QA account `p198-qa-tester@localhost.test`, created via the app's own `/register` flow — the prior `p193-qa-tester@localhost.test` account's session/password was not available in this session) with one caption: `WORD A WORD B WORD C`.
- Applied `letterSpacing: 12` (the UI's own maximum) to the middle word only, live, through the Word overrides UI.
- First export used a single-letter word ("B") — the resulting frame showed only a subtly wider trailing gap, since a single-character word has no internal letters to space out. Per the task's own "if the visual difference is too subtle, use a deliberately exaggerated test value" instruction, renamed that one word's text to a multi-letter `"SPACEDOUT"` (keeping `letterSpacing: 12`) and re-exported.
- Extracted a real frame from the second export with `ffmpeg-static` at `t=1.4s` (inside `SPACEDOUT`'s own 1.2–1.6s interval).
- **Result:** `SPACEDOUT` (purple — the active-word highlight color, since word highlighting was on) renders with clearly, unmistakably wider inter-character spacing; `WORD`, `A`, and `WORD C` all render with normal, tight spacing; caption-level styling (font, outline, uppercase case, position) is unaffected. Frame delivered to the user.

Exact value used: `letterSpacing: 12` (word override), export quality 1080p/30fps/High, composition 1080×1920.

## 13. Undo/redo

- Apply → exactly one `past` entry added (one commit).
- Apply → undo → override gone; redo → override restored — verified both at the store level and live in the browser via the real toolbar Undo/Redo buttons, checking `getComputedStyle` before/after each click.
- Compound case: apply `{color, letterSpacing}` → reset `letterSpacing` only → undo → `color` remains exactly as applied throughout (never touched by the reset or its undo).

## 14. Tests

29 new tests added (1759 → 1788, full suite green):

- `src/lib/subtitles/__tests__/word-style-capabilities.test.ts`: capability reclassified to `supported`; moved out of the `unsupported` list; added inherited/explicit-override/zero/negative/reset-preserves-siblings/reset-collapses-to-null cases (6 new + 2 modified existing assertions).
- `src/lib/subtitles/__tests__/word-letter-spacing-export.test.ts` (new, 7 tests): ASS `\fsp` tag emission, word-boundary isolation, scale factor, zero, negative, "no override → no tag", Style-line non-interference.
- `src/store/__tests__/editor-store-word-letter-spacing.test.ts` (new, 16 tests): one-commit apply, undo/redo, reset-preserves-siblings (live + JSON round-trip), compound reset+undo, zero round-trip, reorder/split/merge/insertion identity (non-monotonic fixture), caption split/merge, ripple-delete, mode-switch no-op, and 4 performance checks (30/300/1800/5400 captions).

All 22 of Phase 11's enumerated items are covered (capability classification, inherited, explicit override, reset, preserving unrelated fields, persistence, undo, redo, all 3 display modes, non-monotonic identity, reorder, split, merge, insertion, caption split, caption merge, ripple timing shift, ASS tag generation, neighboring-word isolation, and range — no separate "invalid input" test was needed since the UI slider already clamps to the existing `-2..12` range and the store layer accepts any `number`, matching every other numeric word-style property's existing behavior). No existing test was weakened, deleted, or bypassed.

New `package.json` script: `test:word-letter-spacing`, and both new files appended to the main `test` script.

## 15. Performance

`setWordStyleOverride` was not modified — it was already the single, fully generic, O(1)-relative-to-other-captions mutation path P18.3's own performance suite already covers at 30/300/1800/3600/5400 captions for `fontWeight`. Added an explicit `letterSpacing`-specific perf test at 30/300/1800/5400 captions for completeness (all well under the existing 150ms budget, ~1ms actual). No new O(n²) processing anywhere in this change.

## 16. Live QA

Using the real Browser pane (no synthetic pointer events) against `http://localhost:3000` with the fresh disposable account:

1. Selected the caption, toggled "This caption" scope, expanded "Word overrides", selected the pre-seeded "B"/"SPACEDOUT" word — the Letter spacing row showed the persisted `12px` with a "Reset" button, confirming load-time persistence.
2. Verified via `getComputedStyle` that only the target word's `letterSpacing` was non-`normal`; both `A`, `C`, and the two other identical "WORD" tokens were `normal`.
3. Clicked Reset — value returned to `normal` live.
4. Clicked the real toolbar Undo — `12px` restored. Clicked Redo — reset re-applied (`normal`). Clicked Undo again to restore `12px` for the export step.
5. Waited for autosave, reloaded the page — `12px` still present in the live DOM after reload (and confirmed in the raw DB row: `{"style":{"letterSpacing":12}}`, no stray keys).
6. Opened the real Export dialog, ran a genuine server-side FFmpeg export twice (once revealing the single-character visual-subtlety issue, once with the exaggerated multi-letter fixture), and extracted real frames with `ffmpeg-static` — see §12.

Not re-driven through the live browser specifically for letterSpacing (covered instead by the store-level tests in §10/§14, which exercise the same real, unmocked store/mutation code paths reorder/split/merge/ripple-delete/mode-switch already use for every other word-style property): the reorder/split/merge/insertion/caption-split/caption-merge/ripple-delete/mode-switch click-throughs themselves. These operations' style-propagation behavior is identical for every `SubtitleStyle` property (none of the underlying functions branch on which property is set), and was already live-verified for `color`/`fontWeight` in P18.3/P19.7.

## 17. Limitations / NOT TESTED

- The P5.1 active-word background-chip width estimate does not account for a per-word `letterSpacing` (or `fontSize`/`fontWeight`) override — pre-existing, orthogonal, out of scope (§11).
- Reorder/split/merge/insertion/caption-split/caption-merge/ripple-delete were verified for `letterSpacing` via real store-level tests (unmocked production code) and live-verified in the browser for other word-style properties previously — not independently re-clicked through the browser specifically for `letterSpacing` in this task (see §16).
- No new min/max validation was added anywhere (UI slider clamps to `-2..12`; the store/API layer accepts any `number`, matching every other numeric word-style property's existing, unvalidated-at-that-layer behavior — not a new gap).

## 18. Protected systems

Untouched: Whisper, transcription, language handling, Gujarati ASR, timeline ruler virtualization, playback/scrubbing, ripple-delete implementation (only its already-generic word-shift math was read, not modified), caption timing architecture, quality system, autosave architecture, undo/redo architecture (`commit`/`undo`/`redo` themselves untouched), database schema, Electron packaging. P19.4–P19.7 were not reopened.

## 19. Database

No schema change, no migration, no production DB changes. `word.style` was already a schema-free JSON blob (`words: String` column, validated only as `z.record(string, unknown)`); `letterSpacing` is just another key within it, exactly like `color`/`fontSize`/`fontWeight`/`backgroundColor` before it.

## 20. Packaging

Not touched; not required for this feature.

## 21. Final verification

- `npm test`: **1788/1788 passing** (1759 baseline + 29 new).
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, the same 5 pre-existing warnings (unrelated files, unchanged).
- Version: unchanged, `0.1.17`.

## 22. P19.9 recommendation

The word-style capability map now has `color`, `fontSize`, `fontWeight`, `letterSpacing` as `supported`; `backgroundColor`/`backgroundOpacity` remain `editor-only` (no ASS per-run background box). A natural, small, bounded next step in the same spirit as this task would be extending the active-word background-chip width estimator (§11/§17) to account for a word's own `fontSize`/`letterSpacing` override when that specific word is the active one — currently it always uses the caption's own values, which can misalign the chip by a few pixels when a styled word is also the karaoke-highlighted word. Low priority (cosmetic, only visible with `bg-highlight` word animation combined with a word-level size/spacing override on the currently-playing word).
