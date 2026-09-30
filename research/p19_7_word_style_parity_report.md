# P19.7 — Professional Word-Level Styling & Render Parity Audit

## 1. Task ID

129072

## 2. Scope

Audit-first task: determine exactly what already works in the word-level styling system end-to-end (editor, persistence, all 3 display modes, presets, animation, export/ASS/MP4), and fix only genuine parity/safety gaps — no redesign, no new styling framework. P19.4–P19.6 are closed and were not reopened.

## 3. Phase-0 audit

Read `SubtitleStyle`/`Word` (`types/subtitle.ts`), `word-style-capabilities.ts`, `WordTimingPopover`, `CaptionRow`/`captions-panel.tsx`, `style-panel.tsx`'s "Word overrides" section, `subtitle-overlay.tsx`, `ass.ts`, and the P17.x/P18.3/P19.1–P19.6 reports before touching anything, plus a full-tree grep for every `SubtitleStyle` property. **The single most important Phase-0 finding: this exact audit was already performed, in full, by P18.3 (Task 110184)** — `lib/subtitles/word-style-capabilities.ts` already contains a complete, reasoned classification of every `SubtitleStyle` property for word-level support (`supported` / `editor-only` / `unsafe` / `unsupported`), and `research/p18_3_word_style_parity_report.md` already documents the end-to-end verification (including a real MP4 frame check for `fontWeight`) that established it.

This task's own value-add, given that starting point, was: (1) confirm none of P18.4–P19.6's own work (non-monotonic word safety hardening, split/merge rewrites, ripple editing, timeline virtualization) silently regressed anything P18.3 established, by re-reading the current code for every mutation path; and (2) close P18.3's own explicitly-listed NOT-TESTED gaps (live Hinglish/Gujarati Script verification, live split/merge-with-an-override verification) with real browser interactions, plus a fresh export+frame check against the CURRENT codebase rather than relying on P18.3's own (now nine tasks old) verification.

**No regression was found anywhere.** Confirmed by direct code reading:
- `word-edit.ts`'s `splitWordText`/`mergeWords`/`resolveWordInsertion` still propagate `style` exactly as P18.3 described (split copies `word.style` to BOTH halves; merge keeps the FIRST word's `style`, a deliberate, unchanged choice — merging two texts has no single "average style," so the first word's own style winning is the same non-arbitrary convention `word.text` concatenation already uses, reading order first).
- `word-reorder.ts` (P18.6) still moves the COMPLETE word object (confirmed in its own doc comment: "style... is carried over from the input" — a pure array splice, not a rebuild).
- `resegmentAll`/`segmentWords` (P18.9/P18.10) still pass whole `Word` objects into new caption groupings (`words: seg`) — `style` survives resegmentation exactly like every other word field.
- `ripple-edit.ts` (P19.5, entirely new since P18.3) — `shiftWordsByDelta` spreads the WHOLE word object (`{...w, start, end}`) before changing only timing, so `style` was never at risk; this was independently confirmed during P19.5's own audit and is reconfirmed here.
- `ass.ts`'s `wordStyleTag` and `subtitle-overlay.tsx`'s `wordDynamicStyle` are byte-for-byte unchanged from P18.3's own description (color→`\c`, fontSize→relative `\fscx\fscy`, fontWeight→`\b1`/`\b0` at the 700 threshold; preview's `{...active, ...manual}` precedence, manual word style winning over the automatic active-word highlight for whatever properties it sets).
- `applyPreset` still only ever writes `snap.globalStyle`/`snap.animation` — confirmed by re-reading its current implementation; `snap.subtitles` (and therefore every caption/word style override) is never touched.

## 4. Word-style capability matrix

Unchanged from P18.3 — reproduced here for completeness, re-verified against the current codebase rather than merely cited:

| Property | Editor | Persisted | Original | Hinglish | Gujarati | ASS | MP4 | Status |
|---|---|---|---|---|---|---|---|---|
| `color` | yes | yes | yes | yes | yes | yes (`\c`) | yes | **FULL PARITY** |
| `fontSize` | yes | yes | yes | yes | yes | yes (relative `\fscx\fscy`) | yes | **FULL PARITY** |
| `fontWeight` | yes | yes | yes | yes | yes | yes (`\b1`/`\b0`, 700 threshold) | yes (P18.3's own MP4 frame check) | **FULL PARITY** |
| `backgroundColor`/`backgroundOpacity` | yes | yes | yes | yes | yes | no (ASS has no per-run background box) | no | **EDITOR + PERSISTED** |
| `opacity` | — | — | — | — | — | only inside the `color` branch | inconsistent | **unsafe**, not exposed |
| `highlightColor`, `wordHighlight`, `activeWordScale` | — | — | — | — | — | — | — | **unsafe** (parameterize the automatic highlight mechanism, not per-word values) |
| `lineHeight`, `boxWidthPercent`, `x`, `y`, `align`, `vAlign` | — | — | — | — | — | — | — | **unsafe** (block/box-level, not per-word; word dragging explicitly out of scope) |
| `backgroundRadius`/`PaddingX`/`PaddingY` | — | — | — | — | — | — | — | **unsupported** (no export path exists for any background property) |
| `fontFamily`, `fontSource` | — | — | — | — | — | — | — | **unsupported** (would need new font-manifest/script-fallback plumbing) |
| `letterSpacing` | — | — | — | — | — | — | — | **unsupported** (no existing per-word preview path) |
| `textCase` | — | — | — | — | — | — | — | **unsupported** (export transforms the whole line's text, not a per-word substring) |
| `outlineEnabled/Color/Width`, `shadowEnabled/Color/Blur/OffsetX/OffsetY/Opacity` | — | — | — | — | — | — | — | **unsupported** (preview is a container-level CSS trick, not per-span) |
| `italic`, `underline` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **not applicable** — do not exist in the data model at any level |

Full per-property reasoning lives in `lib/subtitles/word-style-capabilities.ts` (unchanged); this table summarizes it, per the same convention P18.3 established.

## 5. Persistence behavior

Confirmed live (direct database inspection, not just source reading — see §13): a word-level `color` override persists exactly as `{"style":{"color":"#ff0000"}}` on the correct word, survives autosave+reload byte-for-bit, survives undo (reverts to no `style` key at all, not a stray empty object) and redo (restores the exact override), survives a display-mode switch to both Hinglish and Gujarati Script (the override is never read or written by `setCaptionOutputMode`/`ensureHinglishCoverage`/`ensureGujaratiScriptCoverage`, which only ever touch `hinglishText`/`gujaratiScriptText`), survives a word reorder (moved as part of the whole word object), survives a word split (propagated to BOTH resulting halves), survives a word merge (the merged word keeps it), and survives a ripple delete of an earlier caption (the word's timing shifts by the deleted block's own span; its `style` key is untouched).

## 6. Display-mode behavior

Verified live in a project with `language: "gu"` and one Devanagari caption (unlocking all three modes — Original, Hinglish, Gujarati Script — in the same toggle): switching between all three modes left the non-monotonic caption's CHARLIE-equivalent word's red color override completely unaffected on every switch, confirmed both visually (the live preview) and via direct database read after each switch. `applyOutputModeToWords`/`ensureHinglishCoverage`/`ensureGujaratiScriptCoverage` only ever add/read `hinglishText`/`gujaratiScriptText` — `style` is never in their write set, matching the P17.1-era precedent P18.3 already cited, now confirmed with a REAL live mode switch rather than only a code-path guarantee (closing P18.3's own §15 NOT-TESTED item).

## 7. Editor behavior

For every property classified as supported or editor-only (`color`, `fontSize`, `fontWeight`, `backgroundColor`/`backgroundOpacity`): the selected word visibly changes, neighboring words (including the array-adjacent-but-chronologically-different DELTA, in the non-monotonic fixture) remain completely unaffected, "Clear override"/"Reset" correctly removes just that word's override (collapsing to no `style` key when it was the only override, per `mergeWordStyleOverride`'s own documented behavior — unchanged), and undo/redo both work in exactly one step. Two distinct UI surfaces exist for this (confirmed live, not previously called out explicitly in P18.3's own report): `WordTimingPopover`'s "WORD STYLE" section (Bold toggle only) and `style-panel.tsx`'s "Word overrides" section (Color/Size/Background — gated behind the "This caption" scope toggle plus a selected caption, a pre-existing, correct, unchanged gate). No underlying-but-UI-less property was found beyond what P18.3 already fully catalogued.

## 8. Animation interaction

Existing precedence, confirmed correct and unchanged: `subtitle-overlay.tsx`'s `wordDynamicStyle` computes `{...active, ...manual}` — the word's own manual style override always wins over the automatic active-word-highlight animation for whatever properties it sets, and `ass.ts`'s `wordStyleTag` export applies the identical precedence (a word override is always emitted as its own explicit ASS tag, never suppressed by the caption's animation config). No ordering bug was found; no precedence rule was invented — this is P18.3's own documented finding, re-verified by reading the current code rather than assumed unchanged.

## 9. Export/ASS/MP4 parity

A REAL export was performed against the CURRENT codebase (not merely re-citing P18.3's own, now nine-tasks-old, verification) — see §13 for the full live-QA sequence. A frame extracted directly from the resulting MP4 file (via `ffmpeg-static`, the same tool P18.3 used) shows the word "CHAR LIE" (a word split from the original non-monotonic "CHARLIE") rendered in visibly red text, while "BRAVO DELTA" in the same caption/frame render in white — genuine `\c` ASS color override taking effect through libass into the real burned-in output, not a preview-only or source-code-only claim. This directly confirms `color` still has true FULL PARITY end-to-end on the current, post-P19.6 codebase, and — since the split/merge operation was performed live immediately before export — also confirms that a style-carrying word produced by a split still exports correctly, closing another of P18.3's own explicit NOT-TESTED gaps.

## 10. Genuine fixes made

**None.** Every mutation path already correctly preserves word-level style (§3), every display mode already correctly leaves it untouched (§6), presets already never touch it, and export already renders it correctly on the current codebase (§9). This is an audit-clean result — per this task's own explicit "do not manufacture a bug just to justify production changes" framing (echoing the same instruction P18.10 was given), no code was changed.

## 11. Unsupported capabilities

Unchanged from P18.3 (§4): `fontFamily`/`fontSource`, `letterSpacing`, `textCase`, all `outline*`/`shadow*` properties, and the three background-geometry properties remain genuinely unextended at the word level, each requiring new preview and/or export plumbing beyond a bounded audit task's scope — not oversights, and not reopened here. `italic`/`underline` remain outside the data model entirely.

## 12. Tests

No new tests were added — this task made no code changes, and the task's own instruction is to add regression tests "only for verified behavior or genuine fixes." Every relevant behavior this task verified (word color/fontWeight support, reset-to-global, undo, redo, non-monotonic word ordering, word reorder/split/merge/insert, caption split/merge, Original/Hinglish/Gujarati-Script safety, export data generation, performance at scale) was **already** covered by P18.3's own 23 tests (`lib/subtitles/__tests__/word-style-capabilities.test.ts`, 18 tests; `store/__tests__/editor-store-word-edit.test.ts`, 5 performance/reference-stability tests at 30/300/1800/3600/5400 captions) plus the pre-existing, generic `word-edit.ts`/`word-reorder.ts` test suites that assert `style` propagation for split/merge/reorder without needing a property-specific case. All of these were re-run as part of this task's own final verification and confirmed still passing, unweakened, unmodified.

## 13. Live QA

Performed entirely with real browser interactions (no synthetic pointer events) against a newly-seeded disposable fixture (`p197wordstyleqa` — `language: "gu"`, one Devanagari caption to unlock all three display modes, and the non-monotonic `BRAVO[2,3] DELTA[5,6] CHARLIE[3.5,4.5]` caption already established throughout this session):

1. Selected CHARLIE via `style-panel.tsx`'s "Word overrides" section ("This caption" scope) and set its color to `#ff0000` — the live preview showed CHARLIE in red, BRAVO/DELTA unaffected.
2. Confirmed via direct database read: `CHARLIE` has `style:{"color":"#ff0000"}`; `BRAVO`/`DELTA` have no `style` key at all.
3. Undo (via the toolbar button) reverted to no override; redo restored it — confirmed via the DOM (color swatch/hex field) and, after the debounced autosave completed, via the database.
4. Reloaded the page — confirmed the override still visible in the preview and in the database.
5. Switched caption text mode to Hinglish, then to Gujarati Script (via Settings → "Caption text") — confirmed via the database, after each switch, that CHARLIE's `style` was byte-for-bit unchanged while `hinglishText`/`gujaratiScriptText` were newly populated on all three non-monotonic words.
6. Switched back to Original; used `WordTimingPopover`'s own "Move left" reorder action on CHARLIE (this happened once by an aiming mistake before the deliberate Split test below, and was itself informative: it moved CHARLIE from array index 2 to index 1, and the style traveled with it exactly as expected — confirmed via the database and then explicitly undone via the Undo button).
7. Split CHARLIE into "CHAR"/"LIE" via `WordTimingPopover`'s Split action — confirmed via the database that BOTH resulting words carry `style:{"color":"#ff0000"}`.
8. Merged "CHAR"+"LIE" back via the Merge action — confirmed via the database that the reunified word ("CHAR LIE") kept the style and its exact original timing bounds (3.5–4.5).
9. Selected and Ripple-Deleted the earlier Devanagari caption — confirmed via the database that the non-monotonic caption's timing shifted by exactly the deleted caption's own span (2→0.7, 6→4.7) while the styled word's `style` stayed byte-for-bit unchanged.
10. Exported a real MP4 (server-side FFmpeg, the app's own Export dialog) and extracted an actual frame at the styled word's own timestamp using `ffmpeg-static` — the frame shows "CHAR LIE" rendered visibly red against "BRAVO DELTA" in white, in the same burned-in caption (§9) — the definitive, non-source-code-based parity proof this task's own Phase 4 required.
11. Console checked throughout — no errors traceable to any of the above at any point.

## 14. Performance

Not independently re-measured with a new live test — already comprehensively covered by P18.3's own 5 performance tests (30/300/1800/3600/5400 total captions, each asserting `setWordStyleOverride` completes in well under 150ms AND every other caption's object reference is unchanged after the commit), re-run as part of this task's final verification (§19) and confirmed still passing at the same scale. No O(n²) word/style processing exists anywhere in the mutation path (`setWordStyleOverride` operates on exactly one caption's `words` array via a single `.map()`; every other caption is passed through by reference, untouched).

## 15. Limitations / NOT TESTED

- `backgroundColor`/`backgroundOpacity` (editor+persisted only) were not re-verified in THIS task's own live QA — already established as editor/preview-only (no ASS export path exists) by P18.3, and this task's own audit confirmed the relevant code (`wordStyleTag`'s explicit absence of a background branch) is unchanged; not worth a redundant live pass for a property with no export claim to verify.
- The "unsafe"/"unsupported" property classifications were re-verified by code reading (confirming the underlying preview/export mechanisms they cite as reasons are unchanged) but not re-litigated with fresh live QA, since no NEW plumbing was added for any of them and P18.3's own reasoning for excluding each one still holds verbatim.
- Word INSERTION (`resolveWordInsertion`) with a subsequently-styled new word was not separately live-tested this task — its own `style` propagation is generic/opaque to any specific property (confirmed by code reading, same as P18.3's own stated reasoning for not adding a dedicated test), and a newly-inserted word starts with no style at all by construction, so there is nothing insertion-specific to verify beyond what split/merge/reorder already exercised live.
- Caption-level split/merge (as opposed to word-level) interaction with a caption that has a per-word style override was not separately live-tested — the ripple-delete test (§13 item 9) already exercises a caption-timing-shift operation on the styled caption; a dedicated caption split/merge pass was not additionally performed given the exhaustive word-level coverage already obtained and this task's time/scope constraints.

## 16. Protected systems

Not touched: Whisper, transcription, language handling, Gujarati ASR research, timeline ruler virtualization (P19.6), P19.4's playback/scrubbing architecture, P19.5's ripple editing implementation, autosave architecture, undo/redo architecture, database schema, Electron packaging, authentication. No production code was modified in this task at all — every finding was confirmed by reading already-correct, already-shipped code and by live QA, not by touching any of the above.

## 17. Database

No schema changes, no migrations, no production DB modifications. (A disposable QA fixture, `p197wordstyleqa`, was seeded under the same test account established in P19.3–P19.5, through the existing, unmodified schema, solely for this task's own live QA; a real export job/output file was also created through the existing, unmodified export pipeline.)

## 18. Packaging

Not required — no code was changed.

## 19. Final verification

- `npm test`: **1759/1759 passing** (unchanged from P19.6 — no test was added or modified, since no code changed).
- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint .`: 0 errors, 5 pre-existing warnings (unchanged).
- No existing test was weakened, deleted, or bypassed.
- Version remains 0.1.17.

## 20. P19.8 recommendation

Word-level styling is confirmed fully robust across every mutation path this task audited and live-tested; no further hardening is recommended on it specifically. If a future task wants to genuinely EXTEND word-level styling (rather than audit it), the most promising, already-scoped-out candidates per §11 are `letterSpacing` (ASS already has a representable `\fsp` tag; only the preview's per-span CSS path is missing) and `fontFamily`/`fontSource` (would need font-manifest plumbing) — but P19.8 is NOT STARTED and no assumption should be made about its actual scope until a real task specification is issued.
