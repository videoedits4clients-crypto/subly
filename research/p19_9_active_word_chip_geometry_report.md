# P19.9 — Active-Word Highlight Chip Geometry Parity

## 1. Task ID

132941

## 2. Scope

A bounded cosmetic hardening fix on top of P19.8: when the currently active/karaoke-highlighted word has a word-level `fontSize` and/or `letterSpacing` override, the active-word background chip (`bg-highlight` word animation) must size itself to that word's own EFFECTIVE style, not the caption's base style. No redesign of the caption renderer, the word-style system, ASS timing, word timing, transcription, language handling, Gujarati ASR, timeline ruler, playback/scrubbing, ripple-delete, quality system, autosave, undo/redo, database schema, Electron packaging, or export architecture.

## 3. Phase-0 audit findings

- **Complete active-word highlight rendering path:** two entirely independent implementations exist for the same visual effect, one per consumer, as already documented in `preview-style.ts`'s own top comment ("mirrors `wordOverride()` in ass.ts — same cases, CSS syntax instead of ASS override tags"):
  - **Live editor preview:** `activeWordCss()` (`preview-style.ts`)'s `"bg-highlight"` case returns plain CSS (`backgroundColor` + `boxShadow`-as-halo + `borderRadius`) applied directly to the active word's own `<span>` in `subtitle-overlay.tsx`. The browser's own box model sizes this automatically around whatever content/CSS that span already has (including any `wordDynamicStyle` manual `fontSize`/`letterSpacing`, wired in P18.3/P19.8) — **there is no manual geometry estimation in preview at all.**
  - **MP4/ASS export:** `computeActiveWordChip()` + `estimateTextWidthPx()` (`ass.ts`, added in P5.1/Task 86317) manually estimate the chip's pixel rectangle and emit it as a real `\p`-drawing Dialogue event, because ASS/libass generation has no way to query real glyph metrics ahead of burn time.
- A full-tree grep for `computeActiveWordChip`/`estimateTextWidthPx`/`ActiveWordChipGeometry` confirms both are referenced **only** inside `ass.ts` and its own test file (`bg-highlight-export.test.ts`) — **confirming this bug is export-only; the live preview was never affected and needed no change.**
- **Exact values used (before this task), traced through `computeActiveWordChip`:**
  - Font family: not used at all in the width estimate (only via `fontWidthCalibration(style.fontFamily)`, a per-family calibration constant — caption-level only, unaffected by any word override, out of scope here).
  - Font size: `fontSizePx = Math.round(style.fontSize * scale)` — computed **once**, at the call site, from the **caption's own** `style.fontSize`, then passed down and used for every word in the line, including the active one.
  - Letter spacing: `letterSpacingPx = style.fontSize > 0 ? style.letterSpacing * (fontSizePx / style.fontSize) : 0` — same caption-only value, applied to every word.
  - Text content: `applyTextCase(w.text, style.textCase)` per word — already correct, word-identity-based (`line.indexOf(activeWord)`, object reference, not text or array-position matching) — untouched by this task.
  - Horizontal padding / border radius / vertical padding: `padding = 0.15 * fontSizePx`, `cornerRadius = 0.25 * fontSizePx` (at the call site), `glyphHeight = fontSizePx * 1.05` — all three derived from the same caption-level `fontSizePx`.
- **Does fontWeight affect the estimator?** No — `estimateTextWidthPx`/`CHAR_WIDTH_PER_1000` is a single, pre-computed Helvetica-**Bold**-derived character-width table (the file's own comment: "biased toward BOLD because this app's default/most-used caption weight is 600-900"). There is no weight parameter anywhere in the estimator; a lighter or heavier word already renders at the SAME estimated width regardless of its real weight, both before and after this task. Making the estimator weight-aware would require new per-weight calibration data (the same kind of hand-measured, real-ffmpeg-verified calibration `FONT_WIDTH_CALIBRATION` already required for width) — a genuinely larger effort than this bounded task, so **left alone**, per the task's own explicit permission, and confirmed by a dedicated regression test (§9, test 11).
- **Existing tests:** `bg-highlight-export.test.ts` (18 tests, P5.1) — thoroughly covers chip existence/timing/positioning/font-calibration but never sets `word.style`, so none of them exercised the bug or could regress from this fix (confirmed: all 18 pass unchanged, byte-for-byte identical output).
- **P5.1/P18.3/P19.7/P19.8 reports:** P5.1 established the estimator and its calibration methodology; P18.3 established word-level `fontSize` support (editor+preview+export, via `wordStyleTag`'s `\fscx\fscy`); P19.8 added word-level `letterSpacing` (`\fsp`) and explicitly flagged this exact gap in its own §11/§17/§22 ("the P5.1 active-word background-chip width estimate does not account for a per-word letterSpacing (or fontSize/fontWeight) override").

## 4. Existing chip geometry formula/path (before this task)

```
fontSizePx = round(style.fontSize * scale)                         // caption-level only
letterSpacingPx = style.letterSpacing * (fontSizePx / style.fontSize)
widths[i] = estimateTextWidthPx(word[i].text, fontSizePx, letterSpacingPx, calibration)  // SAME pair for every word
wordWidth = widths[activeIndex]
padding = 0.15 * fontSizePx
glyphHeight = fontSizePx * 1.05
cornerRadius = 0.25 * fontSizePx   // at the call site
```

Every one of these six derived values used the caption's own `fontSizePx`, never the active word's own effective size/spacing.

## 5. Exact root cause

`computeActiveWordChip` measured **every** word in the active word's line — including the active word itself — with a single, caption-level `(fontSizePx, letterSpacingPx)` pair. A word-level `fontSize`/`letterSpacing` override (P18.3/P19.8) IS rendered in the real text right next to the chip (via `wordStyleTag`'s `\fscx\fscy`/`\fsp`), but the chip's own manually-estimated rectangle never looked at that override — so an oversized or extra-spaced active word rendered visibly wider/taller than its own highlight box (or a shrunk one rendered inside an oversized box).

## 6. Files changed

- `src/lib/subtitles/ass.ts` — the fix.
- `src/lib/subtitles/__tests__/active-word-chip-geometry.test.ts` — new, 15 tests (11 correctness + 4 performance).
- `package.json` — registered the new test file in `test` and a new `test:bg-highlight-export` addition (bundled alongside the existing bg-highlight suite, since both exercise the same function).

## 7. Implementation

`computeActiveWordChip` now additionally resolves the active word's own **effective** `fontSize`/`letterSpacing` (word override if present, else the caption's value) via the existing, already-generic `resolveEffectiveWordStyleValue` helper (`word-style-capabilities.ts`) — no new resolution logic:

```ts
const effectiveFontSize = resolveEffectiveWordStyleValue(style, activeWord.style, "fontSize");
const effectiveLetterSpacing = resolveEffectiveWordStyleValue(style, activeWord.style, "letterSpacing");
const activeFontSizePx = style.fontSize > 0 ? Math.round(effectiveFontSize * (fontSizePx / style.fontSize)) : fontSizePx;
const activeLetterSpacingPx = style.fontSize > 0 ? effectiveLetterSpacing * (fontSizePx / style.fontSize) : 0;
```

reusing the exact same `fontSizePx / style.fontSize` scaling ratio the file already used for the caption-level `letterSpacingPx` — no new `scale` parameter needed.

Only the active word's own entry in the per-line `widths[]` map uses `(activeFontSizePx, activeLetterSpacingPx)`; every other word in the line still uses the caption-level pair, unchanged. The chip's own `padding`/`glyphHeight` (and, at the call site, `cornerRadius`) now derive from `activeFontSizePx` instead of the caption's `fontSizePx`, so the chip's height and corner rounding scale with the actual active word's size. The whole-line vertical stacking (`lineHeightPx`, `lineTopY`, `numLines`) deliberately stays on the caption's own `fontSizePx` — a styled active word makes its OWN chip bigger, it does not shift where the whole line sits (this matches the task's own narrow, per-word scope, and avoids a much larger multi-line-layout change — see §13 for a real, discovered edge case this boundary does NOT cover).

`ActiveWordChipGeometry` gained one new field, `activeFontSizePx`, so the caller can size `cornerRadius` from the exact same resolved value without re-deriving it (avoiding duplicated resolution/scaling logic at the call site, per the task's own architecture requirement).

No React state, no store writes, no persistence, no mutation of `word`/`style` objects anywhere — the function remains pure, and its only inputs/outputs are its existing parameters/return value plus the two new derived numbers.

## 8. Effective-style resolution

```
effectiveFontSize = word.style?.fontSize !== undefined ? word.style.fontSize : captionStyle.fontSize
effectiveLetterSpacing = word.style?.letterSpacing !== undefined ? word.style.letterSpacing : captionStyle.letterSpacing
```

via `resolveEffectiveWordStyleValue`, which already implements exactly this `!== undefined` (never truthy) contract — confirmed by dedicated tests for an explicit `0` and a negative override (§9, tests 5-6). No new helper, no duplicated logic, no mutation.

## 9. Test coverage

`src/lib/subtitles/__tests__/active-word-chip-geometry.test.ts`, 15 new tests, all passing:

1. No override → identical to caption baseline.
2. Word `fontSize` override → wider AND taller chip.
3. Word `letterSpacing` override → wider chip, height unchanged.
4. Both together → wider than fontSize alone.
5. Explicit `letterSpacing: 0` → honored exactly (narrower than an inherited non-zero caption value).
6. Negative `letterSpacing` → narrows the chip below the (zero) caption baseline.
7. Removing the override (`style: undefined`) → returns exactly to the caption baseline.
8. Three words with **identical text** ("SAME SAME SAME") → only the active (middle) one's own override affects its chip; both neighbors are byte-for-byte identical to the no-override baseline.
9. **Non-monotonic word array** (the established `BRAVO[2,3] DELTA[5,6] CHARLIE[3.5,4.5]` fixture) → CHARLIE's own override follows CHARLIE by **object identity and its own interval timestamp**, found by matching the chip whose Dialogue Start equals CHARLIE's own 3.5s — never by array position.
10. Existing caption-level `letterSpacing` behavior (no word override at all) is unchanged — every word's chip still widens together.
11. `fontWeight` alone has **no** effect on the chip (documented limitation, §5/§13 — not silently "fixed" by this task).
12-15. Performance at 30/300/1800/5400 captions (see §10).

All 18 pre-existing `bg-highlight-export.test.ts` tests pass **unchanged, byte-for-byte** (verified before writing any new test) — confirming the no-override path produces identical output to before. No existing test was weakened, deleted, or bypassed.

## 10. Performance

`computeActiveWordChip`'s only new work per active word is two `resolveEffectiveWordStyleValue` property lookups and two arithmetic scalings — O(1), independent of project size, added inside the SAME existing per-word `.map()` the function already ran. No new loops, no new scans, no font-measurement dependency.

`npm test`'s new performance suite (`buildAssDocument` with a per-word `fontSize`+`letterSpacing` override on every caption's active word, `bg-highlight` animation on):

| Captions | Time |
|---|---|
| 30 | 1.9ms |
| 300 | 6.6ms |
| 1800 | 26.7ms |
| 5400 | 70.5ms |

Scales linearly with caption count (consistent with `buildAssDocument`'s existing O(n) shape) — no O(n²) introduced.

## 11. Live browser QA

Confirmed the split established in §3: the live editor preview's `bg-highlight` chip is pure CSS and was **already correct** (unaffected by this bug or this fix) — no code path in the browser exercises `computeActiveWordChip` at all. The task's own live-QA items (A-F, "chip visually expands...") are therefore only meaningfully testable against the **real exported MP4**, which is what was actually done:

- Reused the disposable P19.8 QA project (`p198letterspacingqamuljhhux`, account `p198-qa-tester@localhost.test`), set its word animation to `bg-highlight`, and gave one word a combined `fontSize: 100, letterSpacing: 10` override (caption base `fontSize: 64`).
- Exported a real MP4 via the app's own Export dialog (server-side FFmpeg, same pipeline as P19.8) and extracted two real frames with `ffmpeg-static`:
  - **A (no override, word "A"):** a small chip tightly hugging the single letter "A" — unchanged baseline behavior.
  - **D (fontSize + letterSpacing override, word "BIG"):** the chip visibly expands to fully enclose "BIG" at its actual larger, wider-spaced rendered size — correctly following the combined effective geometry. Both frames sent to the user.
- (B/C individually are subsumed by D's combined case — both properties were verified independently at the unit level in §9, tests 2-3.)
- **E (reset):** verified at the unit level (test 7) — a live re-export after removing the DB-level override was not separately re-captured as a frame, since the unit test already proves the geometry function itself returns exactly to the caption baseline; no new code path exists between "reset" and "re-export" beyond what test 7 already exercises.
- **F (moving active-word selection to another word):** verified both by the unit tests (each interval independently recomputes `computeActiveWordChip` from that interval's own `activeWordIndex` — there is no shared mutable state between intervals) and by the two real frames above, which are two DIFFERENT active-word intervals in the SAME export, each showing its own correctly-sized, non-retained geometry.

No synthetic pointer events were used for anything presented as UI verification (word/animation changes were made directly via the project's own database row, mirroring the project's established disposable-QA-fixture methodology, then loaded and exported through the app's real UI).

## 12. Whether chip is preview-only or export-represented

**Export-represented, not preview-only.** See §3/§11 — this is a real, burned-in ASS/MP4 rendering (`computeActiveWordChip`, P5.1/Task 86317), not a preview-only visualization. The live browser preview uses a completely separate, CSS-native implementation (`activeWordCss`'s `bg-highlight` case) that was never affected by this bug and needed no fix.

## 13. Limitations

- **fontWeight is not accounted for** (§3/§9 test 11) — the estimator has no weight axis at all; adding one would need new per-weight calibration data, a larger effort correctly left out of this bounded task, per its own explicit instruction.
- **A genuine, pre-existing, orthogonal edge case was discovered during live QA** (not introduced by this task, and out of its bounded scope): `wordsByLine` derives its line groupings solely from the caption's own stored `text`'s `"\n"` positions. If a word-level `fontSize` override is large enough that the resulting real text no longer fits within the caption's ASS margin box, **libass performs its own additional automatic line-wrap at burn time** — a wrap this app's geometry model has no visibility into, since it assumes the stored `"\n"` positions are the only line breaks that will ever occur. When that happens, chips on either side of the libass-induced wrap can be positioned using the wrong line's vertical slot. This is a limitation of the WHOLE pre-existing chip-geometry system's line-layout assumption (it would equally affect a plain caption-level font size large enough to force auto-wrap, with no word override involved at all) — not something this task's own "active word → effective fontSize/letterSpacing" fix causes or is scoped to fix, and doing so would require reworking the shared `lineHeightPx`/`numLines` stacking model to account for per-line maximum effective font size — a genuinely larger refactor. Documented here for visibility rather than silently left undiscovered; recommend as a candidate for a future, separately-scoped task (see §18).
- Every other observation from P19.8's own §17 remains true and unaffected.

## 14. Protected systems

Untouched: Whisper, transcription, language handling, Gujarati ASR, timeline ruler virtualization, playback/scrubbing, ripple-delete implementation, caption timing architecture, quality system, autosave architecture, undo/redo architecture, database schema, Electron packaging, word-style architecture (only consumed via its existing public helper), ASS timing. P19.4–P19.8 were not reopened; only `ass.ts`'s `computeActiveWordChip`/`wordStyleTag`-adjacent call site was touched, and only for chip geometry.

## 15. Database status

No schema change, no migration, no production DB modification. (Live QA used direct row edits on a disposable QA project's own data, the same established methodology as every prior P19.x task — not a schema change.)

## 16. Packaging status

Not touched; not required for this fix.

## 17. Final verification

- `npm test`: **1803/1803 passing** (1788 baseline + 15 new).
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, the same 5 pre-existing warnings (unrelated files, unchanged).
- Version: unchanged, `0.1.17` (no release-workflow requirement to bump it for this fix).

## 18. Recommendation for P19.10

The genuine edge case found in §13 — libass's own automatic line-wrap diverging from this app's precomputed `wordsByLine` line grouping once a word-level `fontSize` override is large enough to force it — is the natural next bounded candidate, if the team wants to pursue it: teach `computeActiveWordChip`'s line-height/stacking model to account for the MAXIMUM effective font size among a line's own words (not just the caption's base value) when computing `lineHeightPx`/`lineTopY`, OR (simpler, smaller) clamp/document a maximum sane word-level `fontSize` override relative to the caption's box width so this induced-wrap scenario can't arise in practice. Low priority — narrow trigger condition (an extreme per-word `fontSize` override combined with a narrow box), cosmetic only, export-only.
