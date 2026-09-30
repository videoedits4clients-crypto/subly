# P19.10 — ASS Auto-Wrap / Active-Chip Line-Layout Parity

## 1. Task ID

134276

## 2. Scope

Fix the export/ASS geometry edge case P19.9 documented: a sufficiently large word-level `fontSize`/`letterSpacing` override can cause libass to perform its own automatic line-wrap that SUBLY's precomputed `wordsByLine` geometry has no visibility into, so an active-word background chip can land on the wrong visual line. Only this one mismatch was in scope — P19.8 (word letter spacing) and P19.9 (chip sizing) were not reopened, and no general subtitle-layout rewrite was attempted.

## 3. Phase-0 audit

Read the complete `ass.ts` chip/layout implementation and located every relevant piece:

- **`wordsByLine`**: groups a subtitle's words into lines using `sub.text.split("\n")` word-counts-per-line — the ONE and only source of "how many lines, and which words are on which line" for chip geometry. Never looks at rendered width.
- **`computeActiveWordChip`**: uses `lineHeightPx = fontSizePx * style.lineHeight` and `lineTopY = anchorY ± lineIndex/numLines * lineHeightPx` (P19.9-touched, but the LINE COUNT/ASSIGNMENT itself is untouched by P19.9) to vertically place a line, and `estimateTextWidthPx` per word to horizontally place a word within its line.
- **Active-word Dialogue event generation / caption Dialogue text generation** (`buildAssDocument`'s events loop, `renderLineText`): the caption's full text for one time interval is emitted as a SINGLE Layer-1 Dialogue event whose line breaks come from `joinWithOriginalLineBreaks(sub.text, rendered, "\\N")` — i.e. exactly, and only, the breaks already present in `sub.text`.
- **fontSize scaling / word-level `\fscx`/`\fscy`**: `wordStyleTag` emits a relative `\fscx\fscy` scale for an overridden word's own run — this is REAL, already-existing per-word scaling that changes the word's ACTUAL rendered width in the real burn, independent of whether the chip geometry accounts for it (P19.9 already fixed the chip side of this).
- **ASS alignment/margin settings**: `buildStyleLine` writes `MarginL=40, MarginR=40` as **fixed, unscaled constants** (not derived from `style.boxWidthPercent` at all — confirmed by grep: `boxWidthPercent` is never read anywhere in `ass.ts`). `PlayResX`/`PlayResY` come from the caller's `AssBuildOptions` (derived from the project's composition canvas × the chosen export-quality tier).
- **Critical gap found**: the `[Script Info]` header never set `WrapStyle`. Per the ASS/libass spec, an unset `WrapStyle` defaults to **0** ("smart wrapping" — libass will automatically re-wrap a line that doesn't fit within `PlayResX - MarginL - MarginR`). This is the exact mechanism: libass makes its OWN, independent, second wrapping decision on top of the app's own `\N`-delimited text, using REAL rendered widths (including any `\fscx`/`\fsp` scaling) that the app's `wordsByLine`/`computeActiveWordChip` never sees.

## 4. Exact reproduction fixture

A caption whose **stored** `text` has **no** newline (one logical app-side line):

```
text:  "WORD A WORD SPACEDOUT WORD C"
words: WORD[0,0.4]  A[0.4,0.8]  WORD[0.8,1.2]
       SPACEDOUT[1.2,1.6]  style: { fontSize: 90, letterSpacing: 8 }
       WORD[1.6,2.0]  C[2.0,2.4]
animation.word: "bg-highlight"
globalStyle: DEFAULT_SUBTITLE_STYLE (fontSize 64, lineHeight 1.15)
playResX: 1080, playResY: 1920  (⇒ ASS wrap width = 1080 - 40 - 40 = 1000px)
```

Reproduced two ways, both against the **real, unmodified-at-first** `buildAssDocument` output, rendered through **real libass** (not a theoretical read):

1. **Standalone**: generated the `.ass` document directly and burned it via `ffmpeg -f lavfi -i color=... -vf "subtitles='...'"` against a solid background — no app/DB/browser involved, fastest iteration loop.
2. **Full app pipeline**: seeded the exact same fixture into a disposable QA project (`p198letterspacingqamuljhhux`, reused from P19.8/P19.9), exported via the app's real Export dialog, and extracted frames with `ffmpeg-static` — confirming the standalone repro matches the real production path exactly.

## 5. Actual libass behavior observed

Extracting a frame during word **"A"**'s own interval (0.4–0.8s, no override, should be a small chip on the SAME line as the rest of the caption):

- **Before any fix**: libass rendered the caption as **two visual lines** — `"WORD A WORD"` / `"SPACEDOUT WORD C"` — even though `sub.text` has zero stored newlines. "A"'s own chip (computed assuming ONE single line) appeared floating near the **start of line 2** (behind "S" of SPACEDOUT), nowhere near where "A" actually rendered on line 1. This directly answers Phase-0's three required questions: **(A)** libass introduced an additional visual line; **(C)** the actual text and the chip occupied different vertical slots. (Answer **B**, "the chip remains in the original calculated line," is also technically true — the chip stayed on the app's ORIGINAL single-line assumption — but since libass's real render moved to two lines, that original assumption was simply wrong, which is precisely (C).)

## 6. Root cause

`buildAssDocument`'s `[Script Info]` header never declared `WrapStyle`, so libass used its own default (0, smart auto-wrap) and made an **independent second wrapping decision** whenever a Dialogue Text event's real rendered width (after any word-level `\fscx`/`\fsp` scaling) exceeded `PlayResX - MarginL - MarginR`. This app's own chip-geometry model has no visibility into that second decision at all — it only ever knows about `sub.text`'s own stored `"\n"` positions.

## 7. Options considered: A/B/C

- **Option A — model libass's wrapping.** Rejected. Reliably predicting libass's real wrap points would require reimplementing a real text-shaping/wrapping engine (accounting for FreeType glyph metrics, kerning, `\fscx`/`\fsp` interaction, bidi/shaping via HarfBuzz/FriBidi — visible in the very ffmpeg log this task's own reproduction printed) purely in JS. `estimateTextWidthPx`'s own doc comment already documents this was explicitly avoided even for chip WIDTH estimation (a much smaller problem). Modeling exact wrap points precisely is the "complete libass text-layout engine" this task explicitly forbids recreating.
- **Option B — constrain word-level fontSize/letterSpacing.** Considered, and the task itself devotes a detailed protocol to it. But a computed "safe max" would need to know the FINAL `PlayResX` (which varies by export-quality tier, chosen only at export time, not at edit time) and would only prevent THIS one specific caption/word/tier combination from wrapping — every OTHER caption, every OTHER word, and non-override cases (a long caption at a large caption-level fontSize, or a narrow custom `boxWidthPercent`) could independently trigger the exact same libass-vs-app-model divergence, since none of those paths are gated by a word-level slider at all. A per-word-slider constraint would be incomplete (fixes one entry point, not the actual divergence) and would still leave the underlying "two independent line models can disagree" problem in place for every other trigger.
- **Option C — reuse an existing mechanism.** The app does NOT have a separate reusable wrap-prediction calculation to share between text and chip geometry — but it DOES already have its own authoritative, already-computed line-break decision (`sub.text`'s stored `"\n"`, produced by `breakIntoLines` at authoring time). The gap wasn't "two mechanisms need to be unified" so much as "libass has been allowed to make a SECOND, independent decision the app never asked it to make."

## 8. Chosen solution

**`WrapStyle: 2`** in the ASS `[Script Info]` header — libass's own "no smart wrapping: a line only breaks at an explicit `\N`" mode. This is the smallest possible change (one new header line) that makes libass **defer entirely** to this app's own already-computed line breaks, for every caption, every word, every export-quality tier, unconditionally — not a variant of Option A (no prediction/modeling of libass's algorithm is attempted) and not Option B (no input is constrained or clamped). It most closely matches the spirit of Option C: instead of building a NEW shared mechanism, it makes the ALREADY-EXISTING, ALREADY-AUTHORITATIVE line-break decision (the app's own `sub.text` newlines) the ONLY one that can ever apply, eliminating the second, independent, unpredictable decision maker entirely.

## 9. Why the chosen solution is safer

- **Deterministic by construction, not by prediction.** `wordsByLine`'s line count and `computeActiveWordChip`'s line assignment are now GUARANTEED to match what libass actually renders, for every possible input — no heuristic, no calibration table, no "usually correct" — because libass is told to stop making its own competing decision.
- **Zero new geometry/layout code.** No new pure helper, no new width-prediction math, no new constraint-computation logic — the smallest possible diff (one header line + one explanatory comment).
- **No behavior change for the overwhelming majority of real captions.** Confirmed empirically (§13): every normal single-line and multi-line caption (no word overrides, or safely-sized overrides) produces **byte-for-byte identical** Dialogue/Style output — only the `[Script Info]` header gains one line.
- **The accepted, honestly-documented trade-off** (§16): at truly extreme override values, a line that would previously have been auto-wrapped now instead renders past its nominal margins. This is a strictly narrower, more predictable failure mode than the one being fixed (a silently MISPLACED highlight chip) — and it only manifests at the same kind of deliberately-extreme values this whole investigation needed to construct in the first place (§4). Given the task's own explicit instruction to "prefer a bounded product-safe constraint over an inaccurate prediction algorithm" when exact modeling isn't reliable, and given a Phase-0-driven finding that a input-side constraint (Option B) would be structurally incomplete (§7), disabling the divergence-causing auto-wrap entirely is the safer, more complete choice than either alternative.

## 10. Files changed

- `src/lib/subtitles/ass.ts` — the fix (one line + a doc comment).
- `src/lib/subtitles/__tests__/ass-autowrap-chip-parity.test.ts` — new, 15 tests (11 correctness + 4 performance).
- `package.json` — registered the new test file.

## 11. Implementation

```ts
// Task 134276 (P19.10) — WrapStyle 2 ("no smart wrapping — a line only breaks at an explicit
// \N, never re-wrapped automatically"). ...
const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
WrapStyle: 2

[V4+ Styles]
...`;
```

No other function was touched. `wordsByLine`, `computeActiveWordChip`, `estimateTextWidthPx`, `renderLineText`, `wordStyleTag`, `buildStyleLine` are all byte-for-byte unchanged from P19.9.

## 12. Test coverage

`src/lib/subtitles/__tests__/ass-autowrap-chip-parity.test.ts`, 15 new tests, all passing:

1. Every ASS document declares `WrapStyle: 2`.
2. Normal single-line caption (no overrides) → byte-for-byte identical Dialogue/Style output; only the header gains the new line.
3. Normal multi-line caption (explicit stored `\n`) → still two distinct visual lines, still emits real `\N`.
4. Word-level `fontSize` override safely inside the box → still one line.
5. **The exact Phase-0 reproduction fixture** → every chip (including the oversized word's) stays on the ONE computed line — matching libass's now-guaranteed single-line render.
6. Multiple words with different `fontSize` overrides on the same stored line → all stay on that one line.
7. Identical-text words with only the middle one oversized → one line; only the oversized word's own chip is wider.
8. Non-monotonic word array (`BRAVO[2,3] DELTA[5,6] CHARLIE[3.5,4.5]`) → CHARLIE's own override stays correctly on its one computed line, found by its own interval timestamp, not array position.
9. Active words on **two separate stored lines** remain isolated — a line-1 override never affects line-2's chip geometry (verified against a same-shape no-override baseline, not a cross-word comparison, since two different words' plain widths aren't otherwise comparable).
10. Boundary-sized overrides (80/100/120px) all resolve consistently to one line per stored line.
11. Regression: P19.9's own fontSize-widens-and-heightens / letterSpacing-widens-only chip behavior is completely unaffected by the WrapStyle change.
12–15. Performance at 30/300/1800/5400 captions (§13).

A same-visual-line clustering helper (`lineGroupCount`, threshold 40px) was used to distinguish "same stored line, different per-word glyph height" (P19.9's own legitimate small vertical re-centering, up to roughly half a `lineHeightPx`) from "genuinely different stored line" (a full `lineHeightPx` apart) — test fixtures were kept to fontSize ≤120px specifically to stay clear of that boundary.

All 33 pre-existing tests from P19.9/P5.1 (`bg-highlight-export.test.ts` + `active-word-chip-geometry.test.ts`) pass **unchanged**. No existing test was weakened, deleted, or bypassed.

## 13. Performance

`WrapStyle: 2` is a single fixed string appended once per document build — O(1), no per-caption or per-word cost at all. Measured `buildAssDocument` (bg-highlight, per-word `fontSize`+`letterSpacing` overrides) at:

| Captions | P19.9 baseline | P19.10 (with WrapStyle 2) |
|---|---|---|
| 30 | 1.9ms | 2.1ms |
| 300 | 6.6ms | 5.6ms |
| 1800 | 26.7ms | 28.5ms |
| 5400 | 70.5ms | 77.4ms |

Consistent with the P19.9 baseline (run-to-run noise, not a regression) — still linear in caption count, no O(n²) introduced.

## 14. Real MP4 QA

Seeded four captions into the disposable QA project (`p198letterspacingqamuljhhux`), `bg-highlight` animation, exported once via the app's real Export dialog, and extracted a real frame per case with `ffmpeg-static`:

- **Case A** (`"NORMAL CAPTION HERE"`, no overrides): ordinary small chip on the active word — unchanged baseline behavior.
- **Case B** (`"WORD A WORD"`, "A" at `fontSize: 90`, safely inside the box): single line, correctly-sized chip on "A" — matches P19.9's own correct behavior, still one line.
- **Case C** (`"WORD A WORD SPACEDOUT WORD C"`, "SPACEDOUT" at `fontSize: 90, letterSpacing: 8` — the exact known reproduction fixture from §4): **the chip now sits precisely on "SPACEDOUT"** where it actually renders, instead of drifting onto the wrong line as it did before this fix. The line does now overflow the frame's left/right edges at this deliberately extreme value (the accepted trade-off, §9/§16) — but text and chip agree perfectly on which line they're both on.
- **Case D** (`"TOP MID BOTTOM"`, "MID" at `fontSize: 100, letterSpacing: 10`, combined): chip correctly follows the combined effective geometry, precisely enclosing "MID".

All four frames were sent to the user as direct evidence. No synthetic pointer events were used — the four captions were seeded via a direct database write (the same established disposable-QA-fixture methodology used throughout P19.3–P19.9), then loaded and exported through the app's real UI exactly as a user would.

## 15. Before/after behavior

| Scenario | Before P19.10 | After P19.10 |
|---|---|---|
| Normal caption, any size | Correct (never triggered auto-wrap) | Identical (byte-for-byte) |
| Safe-sized word override | Correct (stayed under the wrap threshold) | Identical |
| Extreme word override that would exceed the ASS wrap width | Chip silently misplaced onto the wrong (libass-invented) line | Chip and text always agree on line, but the line itself can render past its nominal margins instead of auto-wrapping |
| Legitimate multi-line caption (explicit stored `\n`) | Two real lines | Identical — two real lines (WrapStyle 2 only disables AUTOMATIC re-wrapping, never explicit `\N` breaks) |

## 16. Limitations

- **Accepted trade-off (by design, not a bug):** an extremely wide word-level override — wide enough that libass would previously have auto-wrapped it — now renders past the caption's nominal margins instead of wrapping to a second line. This is the intentional, documented consequence of choosing "deterministic parity" over "auto-wrap that the app can't predict." A future task could reduce how often this triggers by deriving `MarginL`/`MarginR` from `style.boxWidthPercent` (currently hardcoded to `40`/`40` regardless of the user's chosen box width — a separate, pre-existing gap noted in §3 but out of this task's bounded scope) or by adding a bounded UI constraint (Option B) as defense-in-depth — see §17.
- `boxWidthPercent` still has no effect on the ASS export's own margins (pre-existing, confirmed in Phase-0, not introduced or fixed by this task).
- Every limitation already documented in P19.9's own report (fontWeight not accounted for in the width estimator, etc.) remains true and unaffected.

## 17. Protected systems

Untouched: Whisper, transcription, language handling, Gujarati ASR, timeline ruler virtualization, playback/scrubbing, ripple-delete, caption timing, word timing, quality system, autosave, undo/redo architecture, database schema, Electron packaging, project persistence architecture, word-style capability architecture, and ASS **timing** architecture (only the `[Script Info]` **layout** header gained one field — no `Dialogue` Start/End/timing value changed). P19.8/P19.9 were not reopened; `computeActiveWordChip`, `estimateTextWidthPx`, `wordStyleTag`, and every other P19.8/P19.9 function are byte-for-byte unchanged.

## 18. Database status

No schema change, no migration, no production DB modification. (Live QA reused the same disposable-project-direct-row-edit methodology already established across P19.3–P19.9.)

## 19. Packaging status

Not touched; not required.

## 20. Final verification

- `npm test`: **1818/1818 passing** (1803 baseline + 15 new).
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, the same 5 pre-existing warnings (unrelated files, unchanged).
- Version: unchanged, `0.1.17` (no release-workflow requirement to bump it for this fix).

## 21. P19.11 recommendation

If the residual trade-off in §16 ever becomes a real product concern (a user hitting visible overflow at the frame edges), the natural, still-bounded next step is to derive the ASS Style line's `MarginL`/`MarginR` from `style.boxWidthPercent` instead of the current hardcoded `40`/`40` — this would make the ASS wrap-width budget (irrelevant now that WrapStyle 2 disables auto-wrap, but directly relevant to how much room a caption has before IT overflows) match what the caption editor's own box actually represents, and would be a natural place to ALSO reconsider a bounded, Option-B-style word-level fontSize constraint (now genuinely computable, since the box width would finally be a real, honored quantity in export). Low priority — narrow trigger (an extreme per-word override on an already-long caption), cosmetic only, export-only, and only reachable today via deliberately constructed test values.
