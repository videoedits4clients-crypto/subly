# P19.11 — Professional Release Candidate Gap Audit

## 1. Task ID

135904

## 2. Audit scope

Audit-only triage (no feature implementation) across ten subsystems: caption rendering/export parity, word-level editing, display modes, timeline, quality/review, persistence/reliability, export, large-project performance, Windows/release packaging, and error handling — plus a dedicated investigation of the P19.10-documented `boxWidthPercent` gap, a full-codebase+full-report-history known-limitations sweep, a marketing/product-claim cross-check, and a test-coverage gap audit. P19.8/P19.9/P19.10 were not reopened. No production code was modified as part of this task (see §22 for the one pre-existing-baseline exception: no changes at all were made; this audit is purely read-only against the tree left by P19.10).

## 3. Methodology

Seven parallel research agents (code-inspection only, no production changes) covered: (1) the keyword sweep (`limitation`/`TODO`/`unsupported`/etc.) across `src/`, `electron/`, `python/`, `scripts/`, `prisma/`, and all 63 `research/*.md` reports; (2) caption rendering/export parity including the `boxWidthPercent` investigation; (3) word-level editing and display modes, with real in-memory reproductions (not just code reading) of several suspected bugs; (4) timeline and large-project performance, including running the existing performance suites for real current numbers; (5) quality/review and persistence/reliability, running all 9 target suites (305/305 passing); (6) export formats, Windows packaging, and error handling; (7) marketing/product-claim cross-checking against actual implemented behavior. I independently confirmed the test/typecheck/lint baseline (1818/1818 tests, 0 tsc errors, 5 pre-existing lint warnings — unchanged from P19.10) and directly queried the local dev database for QA-fixture hygiene. I then synthesized, cross-checked, and triaged all findings myself; severity classifications and the P0–P3 labels are my own judgment applied to the agents' evidence, not copied from any agent's own opinion.

## 4. Executive summary

SUBLY's core editing/export architecture (word-style resolution, undo/redo snapshotting, display-mode separation, quality analysis, autosave single-flight queue, Electron packaging fundamentals) is solid and extensively tested (1818 automated tests, many with real-MP4 or real-libass verification from P5 through P19.10). This audit found **one true release blocker** (the Pricing page ships fictional claims and literal developer placeholder text to end users), a small number of **concrete, reproduced correctness bugs** reachable through ordinary use (word-structural edits reviving soft-deleted filler text; a word-level style preview-scaling bug; a timeline-drag gesture that can silently evict the entire undo history), and a large, already-well-documented inventory of accepted design trade-offs and untested-but-plausible edge cases accumulated across P0–P19.10. The single most important release-process fact: **the packaged Windows installer predates every change since P16** — nothing from P17 through P19.10 has been packaged or QA'd in the actual Electron app.

## 5. P0 findings

**P0-1. Pricing page ships fictional claims and literal developer placeholder text to end users.**
- Subsystem: Marketing/landing page (`src/components/landing/pricing.tsx`).
- Evidence: Free tier claims "Up to 5 projects", "10 min video length", "720p export with watermark" — none enforced anywhere in code (no project-count limit, no duration limit, no watermark logic found anywhere in `src/`). Creator/Agency tiers claim "Team seats", "Priority rendering" — no team/seat model or priority queue exists. Line 42 literally renders: **"Placeholder pricing — wire up your billing provider of choice."** — text written for the next developer, visible to real users. There is no billing system at all (`dashboard/settings/page.tsx:72` hard-codes a "Plan: Free" badge).
- Reproduction status: Confirmed by direct code reading; visible on the live landing page today.
- User impact: A prospective customer sees a pricing page promising a watermark-free upgrade path, team seats, and priority rendering that literally do not exist, plus a sentence that reads as an obvious placeholder/bug.
- Blocks release: **Yes.** This is squarely what "release-blocking" means for a "professional release candidate."
- Recommended next action: Either remove the Pricing section entirely until billing exists, or replace it with accurate "what's included today, more coming later" copy. This is a content/copy fix, not an engineering redesign — small, isolated, safe.

## 6. P1 findings

**P1-1. Translate menu offers six target languages the backend rejects, with a misleading error.**
- Subsystem: AI translate (`src/components/editor/ai-menu.tsx` vs `src/app/api/projects/[id]/translate/route.ts` / `src/app/api/translate/route.ts`).
- Evidence: The in-app Translate menu lists all of `LANGUAGES` (15 entries) except the current language (`ai-menu.tsx:187-192`). Both translate API routes only accept `["en","hi","gu","es","fr","de","pt","ar","ja","ko"]`. Marathi, Bengali, Tamil, Telugu, Punjabi, and Urdu are shown in the menu but rejected by the server with HTTP 400. The client's error handler then shows "AI service temporarily unavailable" — a false diagnosis (`ai-menu.tsx:51`).
- Reproduction status: Confirmed by direct code reading (menu source vs. route validator); requires an `OPENAI_API_KEY` to reach the server call at all (otherwise a demo-mode toast fires first).
- User impact: A user who selects one of the six mismatched languages gets a confusing, incorrect error message instead of either a working translation or an honest "not supported yet."
- Blocks release: Borderline — only reachable with a configured OpenAI key (not the default desktop build), but it is a clean, mechanical fix.
- Recommended next action: Filter the Translate menu to the six languages the backend actually accepts (a one-line array intersection), or extend backend validation to match the menu — whichever is intended long-term.

**P1-2. Word-level Size and Letter-spacing overrides are not scale-corrected in the live preview.**
- Subsystem: Word-style preview parity (`src/components/editor/subtitle-overlay.tsx`).
- Evidence: `wordDynamicStyle`'s `manual.fontSize = \`${word.style.fontSize}px\`` and `manual.letterSpacing = \`${word.style.letterSpacing}px\`` (lines 94, 98) use the raw stored (reference-height) number directly as CSS pixels, with **no** multiplication by the caption-level scale factor (`refHeightPx / 1920`) that `preview-style.ts` applies to every other size-like property. The export path (`ass.ts`'s `wordStyleTag`) correctly treats word `fontSize` as a *relative* `\fscx`/`\fscy` percentage against the caption's own size, and correctly scales `\fsp` by `playResY/1920`.
- Concrete effect: at a typical preview canvas height of ~640px (`refHeightPx`), the scale factor is roughly 0.33. A word-level override set equal to the caption's own font size (a completely ordinary thing to do — e.g. "make this one word the same size as the rest, just to test the control") renders at full, unscaled size in the editor preview — visibly **~3x larger** than the surrounding caption text — while the actual exported MP4 renders it correctly proportioned.
- Reproduction status: **Confirmed by direct code reading** (not a hypothesis) — the missing scale factor is a one-line diff away from the correct pattern used one property over.
- User impact: Directly undermines "what you see is what you get" for a just-shipped, marketed feature (per-word styling, P19.7/P19.8). A user styling a word in the editor sees something meaningfully different from what actually exports.
- Note: P19.8's own live QA verified the *exported MP4* looked correct (via real frame extraction) but never checked the *preview's own on-screen proportion* against that same export — so this gap was not caught by prior verification, which is itself worth noting as a QA-methodology lesson (see §12).
- Blocks release: No (cosmetic, editor-only), but should be fixed promptly — it is a trivial, well-understood, low-risk fix (multiply both values by the same scale factor `preview-style.ts` already computes).

**P1-3. A single timeline caption-drag gesture can silently evict the entire undo history.**
- Subsystem: Undo/redo + timeline (`src/components/editor/timeline.tsx` + `src/store/editor-store.ts`).
- Evidence: Caption-level drag-to-resize calls `updateSubtitleTiming` — a full `commit()` — on **every** `pointermove` tick (`timeline.tsx:319`, confirmed by the component's own doc comment at lines 1207-1208 contrasting it with the word-handle drag, which commits once on release). `MAX_HISTORY = 60` (`editor-store.ts:613`), applied via `.slice(-MAX_HISTORY)` with **no coalescing** of same-gesture commits (`editor-store.ts:909`).
- Concrete effect: A drag gesture producing more than 60 pointermove ticks (easily reached on a slow, deliberate drag, or at a high mouse-polling rate) evicts every undo entry that existed *before* the drag started — a user's prior work becomes permanently unrecoverable via Ctrl+Z, with no warning.
- Reproduction status: Confirmed by direct code reading of both the commit-per-tick behavior and the unconditional history truncation; not independently re-verified with a live 60+-tick drag in this audit (that would require real mouse-drag QA, a long-standing tooling gap — see §12).
- User impact: Silent, unbounded data-loss-of-undo-capability during a very ordinary interaction (dragging a caption's edge on the timeline).
- Blocks release: No, but it is a real correctness gap in a core, heavily-used interaction.
- Recommended next action: Coalesce same-gesture drag commits into one undo step on pointer-up (matching the word-handle-drag convention that already does this), rather than committing on every tick. This is the same "prefer the existing single-commit-per-gesture pattern" fix already used elsewhere in the same file — low regression risk.

**P1-4. Two structural word-editing bugs reproduced in memory (removed-word text corruption; merged-word line-wrap miscount).**
- Subsystem: Word-level editing (`src/store/editor-store.ts` + `src/lib/subtitles/ass.ts`).
- **B1 — removed filler words reappear in caption text.** Every structural word action (reorder, split, merge, delete) rebuilds `.text` from **all** words including `removed` ones (`editor-store.ts:1172,1201,1221,1252,1277`), while `isWordTimingStale` only counts non-removed words. Reproduced in memory: a caption `"so this is good"` with a soft-deleted filler word "um" — after any structural edit, "um" reappears in `.text` and the caption becomes word-timing-stale (word chips then hide until the user runs a destructive "Rebuild Word Timing"). No existing test catches this; one test explicitly comments the symptom as "pre-existing, unrelated" and skips asserting on it.
- **B2 — a merged multi-token word breaks line-wrap counting.** `mergeWords` creates one word whose `.text` contains a space (e.g. `"hello world"`). `joinWithOriginalLineBreaks` (`ass.ts`) counts *space-separated tokens* per stored line to rebuild line breaks, but the word array has one *entry* per merged word — so a merged word in a multi-line caption misassigns words to lines. Reproduced in memory: words `["hello world"(merged), "foo", "bar"]` with stored text `"hello world\nfoo bar"` produces `"hello world foo\nbar"` instead. This affects ASS export (all display modes), active-word chip line assignment, and derived-mode (Hinglish/Gujarati) rendering — anywhere `joinWithOriginalLineBreaks` or the equivalent line-grouping in `ass.ts`'s `wordsByLine` is used.
- Reproduction status: **Confirmed, reproduced in memory** by the auditing agent using the real store/lib code (not run in a browser, no files modified).
- User impact: Both are real content-correctness bugs reachable through completely ordinary editing sequences (deleting a filler word then reordering/splitting/merging; merging two words in a two-line caption).
- Blocks release: No single one is catastrophic, but both affect exported/burned-in output correctness, which is the product's core promise.

## 7. P2 findings

- **Export dialog ignores quality-report staleness.** `QualityReadinessRow` (`export-dialog.tsx:45-81`) reads only the cached `qualityReport`, never checking `isQualityReportStale`/`qualityReportSubtitles` — so it can show "No quality issues detected" for a report that no longer matches the current captions, even though the top bar and quality panel do surface staleness correctly. Confirmed by code; user-reachable (edit captions after running quality analysis, then open Export).
- **Export renders the last *saved* database state, not necessarily the current editor state.** Neither the Export button nor `startExport` flushes the pending autosave debounce (900ms) or checks `dirty`/`saveState` before calling the export API, which loads the project fresh from the DB. Plausible race, not reproduced live in this audit.
- **Autosave success handler can clear `dirty` and delete the crash snapshot for a newer edit made during an in-flight save.** A narrow window: edit → save starts → edit again → first save completes and unconditionally clears `dirty`/deletes the local crash snapshot, even though a newer, not-yet-saved edit exists. The already-scheduled next debounce save normally recovers it, but a crash/tab-close in that exact window would lose the newest edit. Plausible from code reading; `use-autosave.ts` has zero dedicated tests.
- **`TOO_FAST`/`TOO_SHORT` quality issues are marked "safe" but can be unfixable** (no room to extend without overlapping the next caption) — this inflates the "N fixed" count and can leave `deriveQualityState` reporting `ISSUES_FOUND` after "Fix all" while `remainingUnsafeCount` reports 0. Confirmed and already pinned by an existing test (`quality-fixes.test.ts:206-231`) — a real, if minor, UX-counting inconsistency.
- **Path escaping does not handle a literal single quote in a filesystem path.** `escapeAssPathForFfmpeg` (`ass.ts:657-659`) escapes backslashes and colons but not `'`, and the path is wrapped in single quotes for ffmpeg's filter string. A Windows username containing an apostrophe (e.g. `O'Brien`) would break the export filter string, surfacing only the generic "Something went wrong while exporting your video" message. Confirmed by code; no test uses a path with an apostrophe.
- **Malformed-but-validly-JSON style data is never type-checked on read, and can crash export with only the generic error message.** `globalStyle` is validated on write via `globalStyleSchema`, but per-caption/per-word `style`/`animation` and project `animation`/`timingRules`/`composition` accept `z.record(string, unknown)` with no type checking on write, and no normalization on read. A legacy or hand-edited row with e.g. `color: 123` reaches `assColorWithAlpha`'s `hex.trim()` and crashes at export time. Confirmed by code reading; not reachable through the ordinary UI (which only ever writes well-typed values), only through a malformed/legacy/hand-crafted row.
- **Word-level `fontWeight` overrides are never included in export font-bundling.** `collectRequiredFonts` (`ass.ts`) only scans the global/caption-resolved style plus scripts, never `word.style.fontWeight` — so bolding one word via the popover's Bold toggle does not add that weight's font file to the export's fontsdir. The real visual consequence (libass substitution vs. faux-bold) was not confirmed by an actual render in this audit (flagged as a hypothesis by the auditing agent) — recommend verifying with a real export before prioritizing a fix.
- **Offline font-cache seed covers only 16 of the roughly 100+ font/weight combinations the picker offers**, including zero coverage for several fonts added by later presets (Manrope, Outfit, Urbanist, Playfair Display, DM Serif Display, Quicksand, Fredoka, Baloo 2, League Spartan, Hind). An offline desktop export using an unseeded font/weight requires network access and otherwise fails with "Font unavailable." Confirmed by file listing; a real, if narrow, offline-usability gap.
- **`afterPack` only warns, never fails the build, if the Whisper worker binary is missing**, and does not check for `ffmpeg.exe`/`ffprobe.exe` presence at all. A future build that dropped either binary would still produce an installer that "looks fine." Confirmed by code reading of `scripts/electron-builder-after-pack.js`.
- **Multi-selection overlays on the timeline are not viewport-virtualized** (unlike the caption blocks themselves) — selecting all captions in a 5400-caption project renders 5400 overlay DOM nodes. Confirmed by code; not measured for an actual rendering-performance regression in this audit.
- **The packaged Windows installer (`release/SUBLY Setup 0.1.17.exe`, built 2026-09-23) predates every change from P17 through P19.10.** Every one of those tasks' final reports says "PACKAGING: NOT REQUIRED" and the version has never bumped. This means none of the last ~25 tasks' worth of changes has ever run inside the actual packaged Electron app. Confirmed directly (file timestamp vs. report timestamps). This is not a "bug" so much as the single most important release-process fact this audit surfaced — see §20.

## 8. P3 findings

A large number of pre-existing, already-documented, deliberate design trade-offs and low-impact gaps were re-confirmed rather than newly discovered; the full inventory is in §10/§11 below. Representative examples: Hinglish capitalization goes stale (cosmetic) after word reorder/delete on the first word; the active-word background chip is a ~6-8px-off-center, character-heuristic width estimate (documented since P5.1); word-level background/fontFamily/outline/shadow overrides remain intentionally editor-only or unsupported; `boxWidthPercent` doesn't affect ASS export margins (see §14); no auto-updater/file-associations/uninstall-data-cleanup; five pre-existing lint warnings nobody has addressed; several small dead-code items (`quality-validator.ts`, `resegmentOne`, `clampWordsToCaptionBounds`).

## 9. Confirmed bugs

(Concrete evidence — either reproduced directly, or a direct code-level contradiction between two code paths that must agree.)

1. Pricing page fictional claims + visible placeholder text (§5).
2. Translate menu offers 6 backend-rejected languages with a misleading error (§6).
3. Word-level Size/Letter-spacing preview scaling missing (§6).
4. Timeline caption-drag commits per pointermove tick with no undo coalescing, against an unconditional 60-entry history cap (§6).
5. Removed/soft-deleted filler words reappear in caption text after any structural word edit (§6, B1).
6. A merged multi-token word breaks per-line word-count-based line-wrap reconstruction on multi-line captions (§6, B2).
7. Undo/redo across a caption-output-mode switch leaves the project with no derived (Hinglish/Gujarati) text and nothing regenerates it automatically, until the next commit or reload (from the word-editing/display-modes agent's B4 finding).
8. `escapeAssPathForFfmpeg` does not escape a literal single quote (§7).
9. `collectRequiredFonts` never reads `word.style.fontFamily` or `word.style.fontWeight` (§7; the fontFamily half was already documented pre-existing, the fontWeight half is a new, confirmed-by-code finding).
10. `boxWidthPercent` has zero effect on ASS export margins — confirmed directly by grep (`ass.ts` hardcodes `MarginL=MarginR=40`); previously documented in P19.10 as a narrow/extreme-only concern, but see §14 for this audit's revised assessment.
11. Caption-level `backgroundRadius`/padding asymmetry is never exported (ASS `BorderStyle 3` is always a square box with averaged padding) — this directly contradicts an old P2 report's "Confirmed matched" verdict for that property, which appears to have been asserted without an actual render.

## 10. Known limitations

This is an extensive, already-substantially-documented inventory (the keyword-sweep agent alone catalogued ~160 distinct items across the codebase and 63 prior reports). Rather than re-list all of them narratively, the following groups the highest-signal, still-open ones by subsystem; each carries file/report evidence available in the underlying agent reports (retained in this session's transcript) for anyone who needs to trace a specific item further.

**Word-style / rendering parity (by design, documented since P18.3/P5.1):** word background is editor/preview-only (no ASS per-run box); word bold is binary (`\b1`/`\b0` at a 700 threshold, no continuous weight); word opacity, highlightColor, wordHighlight, activeWordScale, lineHeight, x/y/align/vAlign are all "unsafe" (would be ambiguous or redundant as per-word overrides); word fontFamily/outline/shadow/textCase/backgroundRadius are architecturally unsupported without new preview plumantfhe active-word chip is a character-heuristic width estimate calibrated for only 3 fonts, ~6-8px vertically off-center, and blind to fontWeight.

**Animation fidelity (by design):** typewriter/word-pop/char-pop are all approximated as the same capped 150ms fade in both preview and export; gradient/chromatic-aberration text effects are approximated with two solid colors; outline/shadow use different rendering techniques (CSS text-shadow vs. ASS Outline/Shadow) that are visually close but not pixel-identical.

**Export (by design or long-standing, low-priority):** MP4 output is H.264/yuve420p only via a fixed `veryfast` preset (not user-selectable); VTT export has no per-word cue timing (the format could support it); export verification is structural only (file exists, plays, has sane dimensions) — never a perceptual/content check that captions actually burned in correctly; the historical SAR-quirk workaround (`setsar=1`) papers over an unreverse-engineered libx264 VUI computation.

**Display modes (by design, extensively protected across P17-P18):** Split/Insert remain Original-mode-only permanently (no deterministic way to fabricate new word content from derived-script text); a derived-mode caption's per-word breakdown can go stale after a word-count-changing derived-text edit (partially mitigated by an explicit "Regenerate" action); clipboard copy always copies Original text regardless of which mode is displayed (documented UX gap, no fix applied).

**Timeline/performance (documented, several confirmed-by-code in this audit):** in Hinglish/Gujarati modes, `TimelineCaptionBlock`'s memoization is defeated (every visible caption re-renders every frame) — explicitly accepted as the cost of not touching the protected output-mode architecture; captions-panel row-height is an 89px estimate that can drift a few dozen pixels on very long lists; Fit-to-Selection/Project cannot show a range longer than what the minimum zoom level allows (documented, honest limitation); no cursor-anchored zoom; snap threshold (8px) is fixed, not configurable; no group/multi-caption drag.

**Quality system (by design):** "Fix all safe issues" can include instances that don't actually resolve (see §6 TOO_FAST/TOO_SHORT); fixing one OVERLAP issue can surface a new WORD_TIMESTAMP_INVALID issue; short-caption/fragment detection is a length heuristic, not linguistic; no "gap between captions" issue type exists; find/replace has no regex mode and no whole-word toggle for project-wide search.

**Persistence (by design):** every autosave replaces the entire subtitles array (no per-row diffing); the 900ms autosave debounce window is an inherent, accepted latency; `beforeunload` flush bypasses the normal save queue (a narrower, separately-documented race than the one in §7); stale-job recovery assumes a single-process architecture (explicitly flagged as needing re-examination if SUBLY ever grows a multi-worker architecture); only one transcription job can run at a time, with no queue.

**Electron/Windows (by design or low-priority housekeeping):** no auto-updater (upgrade = run a new installer); no file associations; uninstall leaves user data in place (electron-builder default, not overridden); `ffmpeg`/`ffprobe` ship twice (~166MB of redundant installer size, documented in P3); stray repo files (`AGENTS.md`, `CLAUDE.md`, `README.md`, an empty `.bak` file) ship inside the installer's resources folder; no renderer-crash (`render-process-gone`) handler, only a generic `uncaughtException` logger.

**Test infrastructure (methodology, not a product bug):** there are zero React component/DOM tests anywhere in the codebase — every UI interaction (drag, snap, zoom, popover behavior) is verified only by the pure underlying functions plus historical live-QA sessions, never by an automated component test; "real mouse-drag" interactions have never been live-verified because the available browser-automation tooling cannot deliver realistic intermediate `pointermove` sequences (documented across at least 6 prior reports).

## 11. Unsupported-by-design behavior

(Explicitly out of scope by an earlier task's own decision, not a defect — included here only because the audit task asked for this category explicitly, and because a few of these are close enough to a marketing claim to be worth double-checking against §13.)

- Per-word font family, outline, shadow, text-case, background radius/padding — all explicitly scoped out of P18.3's word-style system as requiring new preview architecture beyond that task's bounds.
- Gujarati (and 13 other languages) transcription — explicitly deferred in `language-policy.ts`, backed by a failed experimental LoRA fine-tuning assessment (`overall_assessment: "FAIL"`) that validates the deferral decision.
- GPU-accelerated transcription — explicitly deferred, not yet offered.
- Cloud sync / real-time collaboration — reaffirmed out of scope in roughly 8 separate prior reports.
- Regex-based find/replace — explicitly deferred (non-goal noted in at least 5 reports).
- Multi-word insertion (only single-word insert is supported) — explicitly deferred.
- Batch split/merge/reorder/boundary-to-playhead — single-caption-at-a-time only, by design.
- A "paste timing" clipboard feature — data model already reserves the field, feature itself explicitly deferred to a future task.

## 12. Test coverage gaps

(A missing test is not automatically a bug — flagged per the task's own explicit rule. These are the highest-value places where additional testing would reduce real risk, based on what is and isn't covered today.)

- **No React component/DOM tests exist anywhere.** All timeline drag/snap/zoom, captions-panel selection, popover, and canvas behavior is verified only through pure-function unit tests plus historical manual/agent-driven browser QA, never an automated component test. This is the single largest structural test gap in the project.
- **Real mouse-drag gestures have never been live-verified** — the available browser automation cannot deliver a realistic intermediate `pointermove` sequence, so anything gated on genuine per-tick drag behavior (including the P1-3 undo-eviction finding above) rests on code reading plus discrete-step interaction tests, not a true drag.
- **`use-autosave.ts` and `local-snapshot.ts` have zero dedicated tests** — the debounce timing, retry/backoff, crash-snapshot write/restore, and unload-flush behavior are all unverified by any automated test (only the underlying `save-queue.ts` primitive is tested).
- **`runExportJob`'s own catch-block error-message mapping has no test** — the lower-level `renderExport`/cancellation/temp-file tests stop short of the pipeline function that actually decides which user-facing message to show.
- **No test for a genuinely malformed (wrong-typed, not just missing) stored style/animation/composition field** — existing tests cover missing fields (filled from defaults) and write-time schema validation for `globalStyle` only; a legacy or hand-edited row with a wrong-typed field is untested end-to-end.
- **No test combining a word-level style override with a multi-line caption, mode switching, or the B1/B2 scenarios above** — these bugs were found by manual code reading and in-memory reproduction precisely because no existing test exercises these combinations.
- **Electron main-process behavior (single-instance lock, renderer crash, `killServerTree`) has no automated test** beyond the one DB-migrations test file — the only Electron-side test suite in the whole project.
- **SRT/VTT/TXT export formatting functions (`toSRT`/`toVTT`/`toTXT`) have zero tests** — timestamp formatting at >1h, `-->` sequences inside caption text, and empty-caption-list behavior are all unverified.
- **Packaged-app QA has not been re-run since before P17** (see §7's installer-staleness finding) — every subsequent feature's "packaging" verification has been a code-reading exercise, not a real installed-app check.

## 13. Marketing/product claim mismatches

(Full detail in the dedicated agent report; summarized and re-triaged here.)

- **Pricing (P0, §5).**
- **Translate menu (P1, §6).**
- **"Typewriter" animation** (`features.tsx`, `animation-panel.tsx`) is, in both preview and export, the same capped ~150ms fade used for word-pop/char-pop — not a real progressive character reveal. This has been a known, accepted rendering-fidelity limitation since early animation work, but the *label* "Typewriter" in both marketing copy and the in-app animation picker actively implies behavior that doesn't exist. Low urgency (cosmetic naming), but a real, user-visible overclaim.
- **"Style every word — fonts, colors, animation, word highlighting"** (`how-it-works.tsx`) implies per-word fonts and per-word animation. Per-word font family is explicitly unsupported (§11); animation is set per-caption or per-project, never per individual word. The color/highlighting portion of the claim is accurate.
- **AI text tools (fix/rephrase/shorten) and translation require a cloud OpenAI API key**, which no marketing copy discloses; the desktop build ships with no key configured, so these tools run in a "(Demo)"/no-op mode by default. This is a real disclosure gap, not a functional bug — the demo-mode UI label does exist, so a user isn't silently misled once they try it, but the marketing copy itself oversells "one click" AI capability without the caveat.
- **Translation resets word-level (karaoke) timing to evenly-spaced synthetic values** while preserving caption-level start/end — the FAQ's "preserving the original subtitle segmentation and timing" claim is accurate for caption timing but not for word timing, which is not disclosed.
- **The `language-claims.test.ts` guard is real and passing (3/3)** and correctly prevents any landing-page text from naming an unsupported language or hardcoding a language count — this specific, narrower claim area is well-protected by an automated test, unlike every other claim category above.
- **Underclaims (informational, not a problem):** SRT/VTT/TXT export, ripple delete/insert, multi-select, and system-font support are all real, working features that marketing copy doesn't mention at all.

## 14. P19.10 `boxWidthPercent` investigation

Per the task's explicit question set:

- **(A) Is this a genuine user-visible product mismatch?** Yes. `boxWidthPercent` fully controls the live preview's caption box width (`preview-style.ts`, rendered as a CSS `width` percentage with `word-break: break-word` wrapping) but has **zero** effect on the ASS export (`buildStyleLine` hardcodes `MarginL=MarginR=40` regardless of the style's `boxWidthPercent`). Confirmed directly by grep — `boxWidthPercent` does not appear anywhere in `ass.ts`.
- **(B) How often can it occur through the normal UI?** The Style panel exposes a "Box width" slider (30-100%, default 82%) in the ordinary Background section — not a hidden or advanced control. Two built-in presets set it to 70% and 90%.
- **(C) Does it affect ordinary projects, or only extreme/constructed ones?** **This audit revises P19.10's own "extreme/constructed only" assessment.** New analysis from this audit's rendering-parity agent shows the divergence is plausibly reachable at *ordinary* settings, not just deliberately extreme ones: `breakIntoLines` keeps any caption text up to `maxCharsPerLine` (default 42, user-adjustable 20-60) as a single stored line; at the default portrait canvas (1080×1920) and default style (Inter 800, 64px, uppercase), the 82%-width preview box holds roughly 20 uppercase characters before visually wrapping — meaning the **preview** already shows two lines for any caption over ~20 characters, while the **export's own line-width estimator** suggests a 42-character line comes out around 1100px — close to the full 1080px frame width, and (since P19.10's `WrapStyle: 2` change) no longer eligible for libass's own automatic wrap either. In other words: a caption near the ordinary maxCharsPerLine ceiling can show as two lines in the editor and render as one (possibly frame-overflowing) line in the actual export. This was **not verified by an actual test render** in this audit (a HYPOTHESIS with strong supporting arithmetic, not a confirmed reproduction) — but the reasoning is concrete enough that it should not be filed under "extreme/constructed only" without a real render checking it first.
- **(D) Does it affect only extreme/constructed cases?** Partially superseded by (C) above — the *original* P19.10 reproduction (a word-level font-size override) is indeed an extreme, constructed scenario, but the *broader* boxWidthPercent-vs-export-margin mismatch this task asked to re-examine looks plausibly reachable through ordinary caption lengths at ordinary settings, pending a real render to confirm.
- **(E) Would fixing it require changes to caption geometry?** Yes, in the sense that deriving `MarginL`/`MarginR` from `boxWidthPercent` would change the ASS Style line's margin fields — but this is an additive, well-scoped change (reuse the existing scale factor already computed in `buildStyleLine`), not a rework of the chip/word/line-layout geometry machinery P19.9/P19.10 touched. It would not need to touch `computeActiveWordChip`, `wordsByLine`, or `estimateTextWidthPx`.
- **(F) Would fixing it create regression risk?** Low-to-moderate. Changing MarginL/R from a fixed `40` to a `boxWidthPercent`-derived value changes the wrap-relevant geometry for every existing project's export, even though `WrapStyle: 2` means it no longer causes *automatic* wrapping — it would, however, change where a manually-authored multi-line caption's lines sit relative to the frame edges for any project whose `boxWidthPercent` differs from whatever effective width `40`/`40` margins implied before. This needs the same kind of before/after real-render regression check P19.9/P19.10 both performed, not a code-only change.
- **(G) Is it actually release-blocking?** No — this is a genuine, real, and (per this audit's revised reachability assessment) more-likely-than-previously-thought-to-matter gap, but it degrades gracefully (worst case: a caption renders wider than the intended box, or overflows the frame at extreme lengths) rather than crashing or corrupting data. Recommended as a well-scoped follow-up (see §20), not a blocker.

## 15. Performance findings

No new performance architecture was introduced or is recommended. Current numbers (all measured live during this audit, all passing against their existing budgets):

- Ordinary per-commit word/caption mutations (split, merge, delete, insert, reorder, resize, nudge, ripple, letter-spacing) all complete in under 30ms at 5400 captions, against budgets of 150-300ms — comfortable headroom.
- `buildAssDocument` with bg-highlight chips + per-word overrides: 70-160ms at 5400 captions, against a 2000ms budget.
- Hinglish mode-switch generation: up to ~35ms at 5400 captions, against a 2000ms budget.
- No genuine O(n²) pattern was found in any hot path. A blanket `.map((s,i)=>({...s,index:i}))` reindex still exists (unfixed since P18.7) in `deleteSubtitle`/`deleteSubtitles`/`duplicateSubtitle`/`duplicateSubtitles` — this is O(n), not O(n²), but it does defeat the P18.2 caption-row memoization contract for every caption after the change point on those four specific actions (confirmed by code; P18.7 already fixed the equivalent issue for split/merge but not these four). No reference-stability test currently covers these four actions the way it does for the others.
- One caption-count-coverage inconsistency: several newer performance suites (word-letter-spacing, active-word-chip-geometry, ass-autowrap-chip-parity) test 30/300/1800/5400 but skip the 3600 tier that most older suites include — a minor, low-risk test-matrix inconsistency, not a functional gap.
- Timeline caption-drag's per-tick commit cost (§6, P1-3) is not itself a performance problem (each commit is fast) — its cost is entirely in undo-history correctness, not speed.

## 16. Persistence/recovery findings

- The autosave single-flight queue (`save-queue.ts`) is correctly implemented and well-tested (8/8 passing tests, including the specific race it was built to fix).
- Stale-job (crash/force-kill) recovery at server startup is thoroughly tested (15/15 passing, using a real temporary SQLite DB) for the job-state-recovery logic itself, though only against a *fake* storage layer for file deletion — real filesystem cleanup on crash recovery is unverified.
- Undo/redo's `MAX_HISTORY = 60` bound has no dedicated test, and interacts with the P1-3 drag-commit-per-tick finding above to create a real (if narrow) user-facing gap.
- See §7 for the two most actionable persistence findings (export-time dirty-state flushing, and the narrow autosave-success/crash-snapshot race).

## 17. Export findings

- MP4, SRT, VTT, and TXT export formats all genuinely exist and work; MP4 uses real H.264/AAC via bundled ffmpeg.
- Export output verification is structural-only (file exists, plays, has sane non-zero dimensions/duration) — it does not verify captions were actually burned in correctly. This has been an accepted, documented trade-off since early export-verification work.
- SRT/VTT/TXT timestamps may not reflect trim/cut edits the same way the MP4 export does (the subtitles route doesn't call the same `remapSubtitlesToEdited` the MP4 pipeline uses) — plausible from code reading, not confirmed by an actual export-and-compare test; worth a follow-up check on a project with active cuts.
- See §6/§7 for the font-bundling (word-level weight) and path-escaping findings.

## 18. Windows/release findings

- ffmpeg and ffprobe are correctly bundled (not relying on system PATH) and confirmed present in the existing packaged build.
- No admin-required operations were found anywhere (all writes go to `userData`/`temp`; the server binds only to `127.0.0.1`).
- Single-instance locking exists and is implemented correctly (previously live-verified per an existing code comment).
- Database migrations run safely inside a transaction with rollback on failure, and are well-tested (6/6 passing) for additive-column changes; non-additive schema changes (renames, new tables) are not supported by the current migration runner design.
- The single most important release-readiness fact: **the packaged installer has not been rebuilt or QA'd since before P17** (§7/§20).

## 19. Database safety

Confirmed directly (not delegated) by querying the local database:

- **No schema changes, no migrations, and no production database exists or was touched** — SUBLY's only database in this environment is a local SQLite file (`file:./dev.db`), used purely for development/QA across the project's entire history.
- Word styles remain schema-free JSON as intended (`z.record(string, unknown)` at every relevant API boundary — no per-field schema was added or needed for this audit).
- **QA fixture inventory:** two disposable QA user accounts (`p193-qa-tester@localhost.test`, `p198-qa-tester@localhost.test`) and five disposable, clearly-named QA projects (all containing "QA"/"disposable" in their name, none soft-deleted) remain in the local dev database from P19.3 through P19.10's own live-QA work. This is consistent with a long-established project practice — the dev database already contained more than a dozen other QA accounts from tasks P0 through P17 before this session began. Zero production risk (there is no production database), and the packaged build uses a separate, clean `prisma/template.db` generated by a dedicated script — QA fixtures do not ship to end users.
- No orphaned or corrupted data was found; all QA artifacts are traceable to a specific task by name.
- Recommendation: no urgent action needed, but a periodic `dev.db` cleanup (delete accounts/projects whose name matches a QA-fixture naming pattern) would be reasonable low-priority housekeeping, not a safety issue.

## 20. Recommended next implementation phase

In priority order:

1. **Fix the Pricing page (P0).** Remove or rewrite the fictional plan limits and the visible placeholder sentence. This is a content change, not an engineering task — should be trivial and should happen before any public release regardless of what else is scheduled.
2. **Filter the Translate menu to the 6 backend-supported languages** (P1) — a one-line fix.
3. **Fix word-level Size/Letter-spacing preview scaling** (P1) — apply the same `refHeightPx/1920` factor `preview-style.ts` already computes for caption-level styles.
4. **Coalesce timeline caption-drag commits into one undo step per gesture** (P1) — mirror the word-handle-drag's existing commit-on-release pattern.
5. **Fix the two reproduced word-editing bugs** (P1): exclude removed words from rebuilt caption `.text` (B1); make `joinWithOriginalLineBreaks`/`wordsByLine` count merged multi-token words correctly for line-break reconstruction (B2).
6. **Regenerate derived-mode text automatically after an undo/redo that crosses a mode switch** (confirmed bug #7 in §9), or at minimum surface a visible "derived text needs regenerating" state the way the existing word-count-mismatch staleness indicator already does.
7. **Package and Electron-QA a fresh release build incorporating everything through P19.10** before any further feature work is layered on top of an installer that has never run any of it. This is a process/scheduling recommendation, not code — but it should happen soon, and ideally before or alongside items 1-6 above so the packaged QA sweep covers the fixes too.
8. **Lower-priority, well-scoped follow-ups** (any of these could be their own small P19.x task): verify the background-box-color-in-export and word-fontWeight-in-export hypotheses with a real render (§6/§7/§9) and fix if confirmed; derive ASS `MarginL`/`MarginR` from `boxWidthPercent` (§14) with a full before/after render comparison; add the export-dialog quality-staleness indicator (§7); escape single quotes in `escapeAssPathForFfmpeg` (§7); expand the offline font-cache seed to cover more of the picker's font/weight combinations (§7).

## 21. Explicit list of things that should NOT be changed

- **The word-style resolution architecture** (`resolveEffectiveWordStyleValue`, `mergeWordStyleOverride`, `isWordStylePropertyOverridden`, the `WORD_STYLE_CAPABILITIES` classification map) — correct, well-tested, and the right foundation; the P1-2 preview-scaling bug is a bug *in one consumer* of this system, not in the system itself.
- **The `WrapStyle: 2` fix from P19.10** — it correctly and fully fixed the chip-vs-libass line-divergence bug it targeted; do not revert it. Any follow-up on the `boxWidthPercent`/margin gap (§14/§20 item 8) should be additive on top of it, not a reason to reconsider it.
- **The established word-editing style-propagation conventions** (split copies style to both halves, merge keeps the first word's style, insertion copies the anchor word's style) — these are deliberate, documented, and consistently tested; the B1/B2 bugs are about text/line reconstruction, not about these conventions, and fixing them should not change this behavior.
- **The undo/redo commit/snapshot architecture itself** (`past`/`future` arrays, `MAX_HISTORY = 60`, structural sharing) — sound design; the P1-3 finding is about *how often* one specific UI interaction calls `commit()`, not a flaw in the undo system's own mechanics. Fix the caller, not the architecture.
- **The Original/Hinglish/Gujarati-Script display-mode separation** — extensively protected and tested across P17-P18; the known staleness/memoization trade-offs in this area are deliberate, previously-litigated decisions, not oversights.
- **The autosave single-flight queue primitive (`save-queue.ts`)** — correct and well-tested; the P2 race finding is in the calling hook's (`use-autosave.ts`) success-handler logic, not in the queue itself.
- **Electron packaging fundamentals** (bundled ffmpeg/ffprobe via `extraResources`, single-instance lock, transactional migrations) — sound; the packaging gaps found (§7/§18) are additions/verifications needed, not corrections to the existing approach.
- **The quality-analyzer's issue taxonomy and severity/fixability classification** — internally consistent and well-tested; the TOO_FAST/TOO_SHORT counting quirk (§7) is a display/counting nuance, not a reason to redesign the classification system.
- **Anything explicitly protected by P19.8/P19.9/P19.10's own instructions** (Whisper, transcription, language handling, Gujarati ASR, timeline ruler virtualization, playback/scrubbing, ripple-delete implementation, caption timing architecture, database schema, Electron packaging) remains out of scope here too, per this task's own instructions.

## 22. Final release-readiness assessment

No overall score or pass/fail rating is provided, per this task's own explicit instruction. As a factual summary: one finding (the Pricing page) is a genuine release blocker and should be resolved before any public release regardless of scheduling; a small, well-understood set of P1 findings represent real correctness gaps reachable through ordinary use, each individually small and low-risk to fix; the great majority of the ~160-item known-limitations inventory represents deliberate, already-documented, previously-litigated design trade-offs rather than oversights; and the single fact most relevant to any release decision is that the packaged Windows build has not incorporated or been tested against any change made since before P17 — a release decision should account for that gap in verification coverage independently of any specific finding in this report.
