# P18 — Professional Editor Preflight & Scope Definition

**Task 108041 — AUDIT ONLY.** No production code was changed to produce this report. No feature was implemented. No database schema was touched. No version bump. No packaging. Everything below is either directly cited to a file:line in the current codebase, or drawn from the project's own prior research reports and independently re-checked against current code where noted.

---

## 1. Task ID

108041 — P18 Professional Editor Preflight & Scope Definition. Purpose: produce a concrete, evidence-based roadmap for the next major phase after P17.3. This report is the deliverable; no P18 implementation work has started.

---

## 2. Current baseline

- SUBLY version: 0.1.17 (unchanged by this task).
- Completed immediately before P18: P14 (Caption Text Editing & Clipboard), P15 (Word-Level Editing & Timing), P16/P16.1 (Word Insertion + Grapheme-Safe Split, packaged/closed), P17 (Caption Display Modes), P17.1 (Derived Word State, Safe Merge/Delete & Staleness), P17.2 (Derived-Mode Review State & Persistence), P17.3 (Removed-Word Timing Safety).
- Full test suite: 1188/1188 passing. Typecheck: clean. ESLint: 0 errors, 5 pre-existing warnings. P18 implementation: not started.
- P17.3 established a shared `sumWordTokens()` convention (`src/lib/subtitles/word-timing.ts`) now used by both `isWordTimingStale` (original-text staleness) and `getDerivedWordTextSyncStatus` (derived-text staleness), removed-word timing safety across all three display modes, and confirmed the authoritative Original text stays fully protected through Merge/Delete/Regenerate and every mode switch.

---

## 3. Architecture inventory (30 subsystems)

Each entry: authoritative state → derived state → mutation path → undo boundary → persistence boundary → UI owner → invariants → known limitations → performance.

**1. Subtitle data model** — `Subtitle` (`src/types/subtitle.ts:124-144`): id/index/start/end/text/words[]/style?/animation?/hinglishText?/gujaratiScriptText?. Mutated exclusively via `editor-store.ts` actions, almost all routed through `commit()`. Undo boundary = one commit = one `HistorySnapshot` entry (reference-shared, no deep clone — `snapshotOf`, `editor-store.ts:514-525`). Persistence: full-array replace on every autosave that includes `subtitles` (`project-patch.ts:79-97`, `deleteMany` + `createMany`) — NOT an incremental/diffed write. UI owner: `captions-panel.tsx` (text list), `timeline.tsx` (visual blocks). Performance: proven O(n) per single-caption mutation to 5,400 captions (see §10).

**2. Word data model** — `Word` (`types/subtitle.ts:12-39`): text/start/end/confidence?/removed?/style?/hinglishText?/gujaratiScriptText?. Mutation path: `word-edit.ts` pure helpers (`splitWordText`/`mergeWords`/`deleteWordConservative`/`resolveWordInsertion`) + `updateWordTiming`, all `commit()`-routed. Full mutation semantics in §7.

**3. Authoritative Original text** — `textSource: "text"` in `caption-display-mode.ts:116-127`; the only mode where `captionTextEditable` writes to `text`/`words[].text`. Protected by the P17 capability contract and confirmed live/DB-verified untouched through every mode switch (P17.2/P17.3 reports).

**4. Hinglish derived text** — lazily generated (`generateHinglishForSubtitle`, `output-mode.ts:25-44`), cached at caption+word level, independently editable, staleness tracked by `getDerivedWordTextSyncStatus` (now using the shared `sumWordTokens` convention, P17.3). Invalidated (`undefined`) on any authoritative-text-changing mutation, together with Gujarati Script — both caches cleared regardless of which mode is active (`editor-store.ts:1000,1021,1420` etc.).

**5. Gujarati Script derived text** — same architecture as Hinglish, gated to `language === "gu"` (`projectSupportsGujaratiScript`). New "gu" transcription projects can no longer be created (V1 language policy, `lib/language-policy.ts` — Gujarati transcription is `DEFERRED`), but existing "gu" projects keep full display/edit support — explicitly preserved, not migrated away.

**6. Word timestamps** — `start`/`end` per word, clamped via `clampWordTiming` (neighbor- and caption-bound-aware, `word-timing.ts:112-127`). A removed word retains a real, editable timestamp and still participates in clamping its neighbors — confirmed live (P17.3 §5, steps 4/8).

**7. Removed-word semantics** — `removed?: boolean`, set only by filler-word detection (`fillers.ts:markFillerWords`), never by word-delete (which splices the word out entirely — a structurally different operation, see §7 matrix). Kept for history, excluded from every caption-level text-building function (`segmentWords`, `generate*/regenerate*ForSubtitle`). As of P17.3, `isWordTimingStale` and `getDerivedWordTextSyncStatus` share one exclusion convention (`sumWordTokens`).

**8. Word confidence** — preserved conservatively through every mutation (never fabricated on split/merge/insert — explicit metadata policy, `word-edit.ts:11-28`) but **confirmed to have zero UI consumers**: `grep "confidence" src/components` returns no matches. It is produced only by the transcription provider (`src/lib/transcription/local-provider.ts`) and referenced only in tests. NOT IMPLEMENTED as a user-facing signal.

**9. Word styles** — per-word `style?: Partial<SubtitleStyle>` is merged at render time directly in `subtitle-overlay.tsx:93-99` and at export time in `ass.ts`'s `wordStyleTag()` (`ass.ts:202-212`) — **not** folded into the shared `resolveStyle()` helper (`types/subtitle.ts:431-433`), which only merges global←per-caption. The word-level style panel exposes 3 of ~25 `SubtitleStyle` properties (color, font size, background color — `style-panel.tsx:218-238`). PARTIAL. KNOWN LIMITATION: ASS export has no per-run background-box primitive, so a word-level background override is preview-only, not exportable (`ass.ts:201`).

**10. Word selection** — `selectedWordIndex`, ephemeral, never undo-tracked, cleared when the parent caption's selection changes or the caption's word count changes.

**11. Caption selection** — `selectedSubtitleId` (focused caption). A plain (unmodified) click always collapses any active multi-selection to size ≤1 (`selectSubtitle`, `editor-store.ts:657-670`).

**12. Multi-selection** — `selectedSubtitleIds: Set<string>` + `selectionAnchorId` (`editor-store.ts:68-86`). Ctrl/Cmd-click toggles, Shift-click ranges by time order (not DOM position — correct against virtualization), Ctrl/Cmd+A selects all. Batch-capable: delete, duplicate (contiguous runs only), timing nudge, style, animation, find/replace, text transform, text cleanup, caption-text clipboard copy/cut/paste. NOT batch-capable (confirmed, no code path exists): split, merge, `setSubtitleBoundaryToPlayhead`, reorder, style-clipboard paste-to-selection (paste target is one caption or "all"), any word-level operation, and timeline mouse-drag-as-a-group (batch move exists only via the keyboard `Alt+←/→` nudge).

**13. Undo/redo** — `commit()`/`undo()`/`redo()` (`editor-store.ts:731-773`). `MAX_HISTORY = 60` caps both `past`/`future` stacks (`editor-store.ts:479,740,755,769`). `HistorySnapshot` (`editor-store.ts:44-53`) holds `subtitles`/`globalStyle`/`animation`/`timingRules`/`composition`/`trimStart`/`trimEnd`/`cutRanges` by reference (structural sharing, no deep clone) — its type shape makes it structurally impossible for selection, playback, or quality-report state to leak into undo history.

**14. Autosave** — `use-autosave.ts`: 900ms debounce after the last dirty change (`:99`), single-flight queue (`save-queue.ts:20-48`) preventing an older in-flight PATCH from overwriting a newer one, synchronous (non-debounced) `localStorage` crash-safety snapshot on every dirty change (`:94`), best-effort `beforeunload` flush via `fetch(..., {keepalive:true})` (`:110-129` — does not block navigation, PARTIAL as a delivery guarantee).

**15. Persistence** — `applyProjectPatch` (`project-patch.ts:58-100`): scalar `Project` fields are selectively patched (Prisma `undefined` = untouched); `subtitles`, when present, is a full replace — `deleteMany` then `createMany` for the entire set, never a per-row diff/upsert (`:79-97`, by explicit design comment).

**16. Quality analysis** — `analyzeSubtitleQuality` (`quality-analyzer.ts:151-331`): one O(n) pass over captions with a bounded inner loop over each caption's own words — effectively O(n) overall, no O(n²). Manual-trigger-only: the only two call sites are the export dialog's "Analyze" button and the quality panel dialog's "Analyze"/"Re-analyze" buttons (`export-dialog.tsx:86,224`; `quality-panel-dialog.tsx:107,151`) — confirmed never triggered by keystroke, commit, or any store subscription.

**17. Review state** — `reviewedIssueIds`/`qualityIssueIndex`, reset only by `load()` and `runQualityAnalysis()` — never by `commit()`/`undo()`/`redo()`. `isQualityReportStale` is a pure O(1) reference check (`quality-analyzer.ts:364-366`). KNOWN LIMITATION (P17.2, confirmed unfixed by explicit instruction): a display-mode switch can leave the quality report staled in a way `Ctrl+Z` cannot undo back to fresh, since mode switches don't route through `commit()`.

**18. Timeline** — `timeline.tsx` (998 lines) + `TimelineWordHandles`. Caption drag/resize commits on **every pointer-move** (many undo entries per drag); word-timing drag keeps a local preview and commits **once, on release** (`timeline.tsx:803-809,890-903`) — a real, documented, intentional asymmetry. Snapping: exactly 3 candidates (previous end / next start / playhead), fixed 8px screen threshold, not user-configurable (`snapping.ts`, `timeline.tsx:26-34`). Zoom: 20–220 px/sec, anchor-preserving (`zoom-anchor.ts`). Horizontal virtualization: time-range filter with a one-viewport buffer (`visible-range.ts:16-26`). No `React.memo` on caption blocks (inline JSX in a `.map()`).

**19. Waveform** — `lib/audio/waveform.ts`: real per-bucket peak analysis of decoded PCM (not a placeholder), `DEFAULT_PEAKS_PER_SECOND = 100`. Computed once server-side, cached, keyed on the source audio file's mtime (`app/api/projects/[id]/waveform/route.ts`). Client redraw is bounded by on-screen pixel width, never by total peak count or zoom level (`waveform.tsx:87-105`). No manual "regenerate" UI control exists (regeneration only follows an mtime change).

**20. Playback** — `video-canvas.tsx`: the `<video>` element is the actual source of truth; `isPlaying`/`currentTime` in the store are read-models synced from the video's own events, never routed through `commit()` (confirmed: neither `setCurrentTime` nor `setPlaying` nor `seek` calls `commit()`). J/K/L transport exists (`use-keyboard-shortcuts.ts:566-594`) but has no variable-speed shuttle (repeated J/L presses do not accelerate). Active-word-during-playback and manually-selected-word are two independently maintained concepts, confirmed never conflated in either `captions-panel.tsx` or `timeline.tsx`.

**21. Caption styling** — `SubtitleStyle` (~25 properties: font/color/opacity/background/outline/shadow/position/word-highlight, `types/subtitle.ts:46-91`). `resolveStyle` merges global←per-caption only (`:431-433`); the word layer is a separate merge applied directly in the renderer/exporter (§9). Copy/paste style is `localStorage`-backed (cross-project by design, `style-clipboard.ts:4-7`), targets: one caption or the whole project's global style — no "paste to current multi-selection" target for the style *clipboard* specifically (distinct from the patch-based `applyStyleToSubtitles`, which does support a selection).

**22. Caption animation** — `AnimationConfig` (entrance ×11 / exit ×4 / word ×7 / durationSec, `types/subtitle.ts:93-122`). Resolves global←per-caption; there is no per-word animation config object — the "word" animation is one setting applied per active-word time interval (karaoke-style), not an independent per-word choice. KNOWN LIMITATION (documented in `ass.ts:27-40` and `animation-render.ts:9-15`): `typewriter`/`word-pop`/`char-pop` have no true progressive-reveal implementation in either the live preview or export — both cap at a 150ms fade approximation (`APPROXIMATED_FADE_CAP_SEC`). KNOWN LIMITATION: the active-word background chip's width is estimated from a hand-built character-width heuristic calibrated for exactly 3 fonts, with a flat default for every other font (`ass.ts:270-289`) — not real glyph-metrics measurement, explicitly out of scope by prior decision.

**23. Clipboard** — two independent systems. (a) Caption-text clipboard (P14, `caption-clipboard.ts`, in-memory only): always operates on the authoritative Original text regardless of active display mode — confirmed by code (`buildCaptionClipboard` reads `s.text`, never `s.hinglishText`/`s.gujaratiScriptText`) and by an explicit doc comment; captures `style`/`animation`/`start`/`end` "for a future paste-timing/paste-style feature" but never applies them today — text-only paste (DEFERRED, explicit in-code note, `caption-clipboard.ts:14-18`). (b) Style clipboard (`localStorage`-backed, cross-project, §21).

**24. Batch text editing** — `computeBatchFindReplace`/`computeBatchTextTransform` (`batch-text-ops.ts`), 3 case transforms (upper/lower/title). Both require `selectedIds.size ≥ 1` — there is no distinct "whole project" batch mode separate from manually selecting all captions.

**25. Search/replace** — two modes selected purely by current selection count: 0 selected → project-wide (case-insensitive only, no whole-word toggle, no preview, immediate apply on "Replace next"/"Replace all"); 1+ selected → batch mode (match-case/whole-word toggles, live preview, staleness warning before Apply). Regex: the search string is **always** escaped as a literal before being embedded in the internal `RegExp` (`escapeRegexLiteral`, `batch-text-ops.ts:29-31,57-63`) — there is no way for a user to submit an arbitrary regex pattern; "whole word" is implemented via Unicode-aware lookaround boundaries, not user-authored regex.

**26. Text cleanup** — 9 enumerated deterministic transforms (whitespace/line-break normalization, repeated-punctuation collapse, sentence case, trailing-punctuation ensure/remove, blank-caption classification/removal — `text-cleanup.ts`), fixed pipeline order, selection-required (no 0-selected whole-project path), one commit for edits+deletions together.

**27. Export** — real FFmpeg burn-in render only; no audio-only/sidecar-only MP4 mode (`export-output-verification.ts:69-70`). MP4 only, 720p/1080p/4k (scaled by the composition's shorter edge, not a fixed aspect assumption), 24/30/60fps, 4 quality presets → CRF, `veryfast` x264 preset fixed (not user-selectable). Separate SRT/VTT/TXT sidecar route, independent of the FFmpeg job pipeline. `verifyExportOutput` performs **structural sanity checks only** (file exists, non-zero bytes, ffprobe-readable within a bounded timeout, valid width/height/duration) — by explicit design it does **not** verify captions were actually burned in or any perceptual/content correctness. KNOWN LIMITATION: VTT export has no per-word cue-timing tags (the `<c>`/timestamp mechanism YouTube auto-captions use) — documented, deliberate, unimplemented.

**28. Display modes** — Original/Hinglish/Gujarati Script, full capability contract in `caption-display-mode.ts`. Split/Insert are Original-mode-only, permanently (no safe way to fabricate authoritative text from derived input). Merge/Delete available in every mode as of P17.1. Mode switching never creates an undo entry (§17's known limitation is the one documented consequence of this).

**29. Keyboard shortcuts** — `use-keyboard-shortcuts.ts`, 35 hand-verified bindings, drift-tested against `keyboard-shortcuts-dialog.tsx` (wired into `top-bar.tsx`) by `keyboard-shortcuts-reference.test.ts`'s 1:1 correspondence assertion. J/K/L exist but no variable-speed shuttle on repeated presses. No user-remappable bindings (a single hard-coded `if` chain). `Ctrl+S` is a deliberate no-op (autosave already persists).

**30. Virtualization/performance** — two independent mechanisms: captions list (fixed/estimated row-height windowing, `VIRTUALIZE_THRESHOLD = 150`, `ROW_HEIGHT_ESTIMATE = 89`, `list-virtualization.ts`) and timeline (time-range filter with a 1-viewport buffer, `visible-range.ts`). Both proven functionally correct to 5,400 captions. KNOWN LIMITATION, documented in-code: the captions-list row-height estimate can drift over a long list when a row renders taller than the estimate (a wrapped textarea, a stale-timing banner) — mitigated by a `requestAnimationFrame` re-correction, not eliminated. React re-render analysis: `CaptionRow` is wrapped in `memo()`, but every callback prop passed to it is a fresh inline arrow function created inside the parent's `.map()` (no `useCallback`) — so `memo()`'s shallow-prop comparison is defeated, and any edit anywhere in the project (which always produces a new `project`/`subtitles` reference via `commit()`) re-renders every currently-mounted row, not just the one that changed. No `React.memo` at all on the timeline's caption blocks. No O(n²) found anywhere in the mutation code — every single-caption/word mutator is 2–3 independent linear (O(n)) passes (a `find`, the mutator's own `map`, and `commit()`'s own `Set` construction for selection-pruning), never nested iteration.

---

## 4. Complete feature inventory

**A. Transcript generation** — COMPLETE (local faster-whisper worker, language policy V1 gates which languages can be newly transcribed; Gujarati transcription is explicitly DEFERRED though existing Gujarati projects' display features are fully preserved).

**B. Caption editing** — COMPLETE (direct text edit, split/merge/duplicate/delete/reorder, project-wide re-segmentation).

**C. Word editing** — COMPLETE (split/merge/delete/insert single word, per-word timing). Word **reorder** via drag — NOT IMPLEMENTED (only word-*timing* drag exists; no drag-to-change-order interaction anywhere in the code). Multi-word insertion — DEFERRED (single-token-only by explicit, still-current design decision from P16).

**D. Timing editing** — COMPLETE (caption- and word-level, mouse drag, keyboard nudge, numeric input, boundary-to-playhead, snapping).

**E. Timeline editing** — PARTIAL. Drag/resize/zoom/snap/virtualization: COMPLETE. Ripple-edit/ripple-delete (shifting downstream captions when a boundary changes): NOT IMPLEMENTED (no match for "ripple" anywhere in `src/`). Multi-caption mouse-drag-as-a-group: NOT IMPLEMENTED (batch move exists only via keyboard nudge). User-configurable snap threshold: NOT IMPLEMENTED (fixed 8px, explicit design decision).

**F. Playback** — COMPLETE (play/pause/seek/variable rate 0.5–2×/frame-step/J-K-L transport/fullscreen/safe-area guide). Variable-speed shuttle on repeated J/L: NOT IMPLEMENTED. Loop-between-marks: NOT IMPLEMENTED.

**G. Multi-selection** — COMPLETE for the selection mechanism itself (toggle/range/select-all, time-ordered, virtualization-safe). PARTIAL for which operations honor it (see §3 item 12 for the exact included/excluded list).

**H. Batch editing** — PARTIAL. Delete/duplicate-contiguous/nudge/style/animation/find-replace/transform/cleanup/clipboard: COMPLETE. Non-contiguous batch duplicate: NOT IMPLEMENTED (returns `"non-contiguous"`, no commit, by design). Batch split/merge/boundary-to-playhead/reorder: NOT IMPLEMENTED (explicitly out of scope per an existing in-code comment: "both are inherently scoped to one caption's own word index or its one adjacent neighbor").

**I. Styling** — COMPLETE at caption/global level. PARTIAL at word level (3 of ~25 properties exposed; no export-side background box for word-level style — KNOWN LIMITATION).

**J. Animation** — COMPLETE for entrance/exit/word-highlight fidelity in the common cases. KNOWN LIMITATION for `typewriter`/`word-pop`/`char-pop` (fixed 150ms fade approximation in both renderers) and for the active-word background-chip width heuristic (calibrated for 3 fonts only).

**K. Review/QA** — COMPLETE (16 issue types, safe/unsafe fixability classification, "Fix all safe issues," manual per-issue review navigation, `reviewedIssueIds` tracking). KNOWN LIMITATION: the P17.2 display-mode/undo interaction (documented, unfixed by explicit instruction both in P17.2 and in this task).

**L. Derived languages** — COMPLETE for Hinglish/Gujarati Script transliteration (fully staleness-safe as of P17.3). Real cross-language **translation** also exists as a separate feature (AI menu → OpenAI `gpt-4o-mini`, per-caption, archives the pre-translation transcript into a `SubtitleTrack`) — COMPLETE when `OPENAI_API_KEY` is configured, PARTIAL/graceful-degradation in demo mode (returns original text unchanged with an explicit "needs a real AI connection" message, never fabricates a translation).

**M. Clipboard** — COMPLETE for caption text (mode-independent, always the authoritative Original text) and for style (cross-project, `localStorage`). DEFERRED: paste-timing/paste-style via the caption clipboard (data is captured today but never applied — explicit in-code note).

**N. Export** — COMPLETE for MP4 burn-in + SRT/VTT/TXT sidecar generation, font preflight, cancellation, stall detection, structural output verification. NOT IMPLEMENTED: VTT per-word cue timing tags, transparent/alpha-channel export (the latter has never been discussed anywhere in 42 prior research reports — not even as a deferred item). Output verification is intentionally structural-only, not perceptual (a designed boundary, not a gap to close casually).

**O. Project management** — COMPLETE (dashboard search/filter/sort, rename, duplicate, soft-delete/trash/restore, type-to-confirm permanent delete). KNOWN LIMITATION: project duplicate does not copy `composition`/`trimStart`/`trimEnd`/`cutRanges`/export history — a duplicated project silently reverts to the uncut, default-canvas source. NOT IMPLEMENTED: scheduled/automatic trash purge (retained indefinitely until manual permanent delete). PARTIAL: Brand Kit supports only one kit per user despite a one-to-many DB relation, and "Apply Brand Kit" only sets 3 of its 6+ fields (`logoUrl`/`captionStyle` are stored but never read by the apply action).

**P. Persistence/recovery** — COMPLETE for the resilience layer: debounced autosave, single-flight save queue, synchronous local crash-safety snapshot, `beforeunload` best-effort flush, server-startup stale-job recovery (re-verified current in this audit, not just trusted from the old report). NOT IMPLEMENTED: an application-wide React error boundary (first flagged in the P7 workflow audit, confirmed still absent today — no `error.tsx`/`global-error.tsx`, no `ErrorBoundary` component anywhere in `src/`). The full-payload (non-diffed) persistence model is an architectural characteristic, not itself a defect.

**Q. Performance/large projects** — COMPLETE for the proven-scale envelope across word editing, output-mode/derived-text operations, undo/redo, and virtualization (5-tier sweeps to 5,400 captions). NOT TESTED: autosave/PATCH latency at scale (no performance test exists for `project-patch.ts`), quality-analyzer performance in isolation (only a combined, single-5,400-tier store-level proxy test exists), and React component render-count/wall-clock time at scale (no component-level test infrastructure exists in this codebase at all). PARTIAL: `CaptionRow` re-render avoidance, per the `memo()`-defeated-by-inline-closures finding in §3 item 30.

---

## 5. Deferred-item audit

Cross-referenced against all 42 prior `research/*.md` reports and live-verified against current code (full detail from the dedicated backlog-search agent; condensed here):

| Item | Status |
|---|---|
| Word insertion | RESOLVED (P16, closed P16.1) |
| Grapheme-safe splitting | RESOLVED (P16, closed P16.1, verified in the packaged Electron runtime) |
| Word dragging (reorder, distinct from timing drag) | STILL MISSING — no code path exists; only word-*timing* drag exists |
| Multi-word insertion | STILL DEFERRED, unchanged since P16 |
| Copy/paste (captions) | RESOLVED (P14); one minor known limitation carried forward unfixed (uncommitted textarea edit can be discarded by Ctrl+X with no text selection) |
| Batch editing | PARTIALLY RESOLVED — non-contiguous duplicate and a collision edge case (duplicate block vs. an already-existing trailing caption) remain open, never revisited past P8/P9 |
| Regex search/replace | STILL MISSING — literal-substring + whole-word only, by explicit repeated design choice across many reports |
| AI rewriting/correction | PARTIALLY RESOLVED — implemented (OpenAI-backed), demo-gated behind `OPENAI_API_KEY`, gracefully degrades rather than failing silently; never independently hardened/QA'd in its own dedicated report |
| Translation (real cross-language) | RESOLVED/IMPLEMENTED (demo-gated), architecturally and correctly distinct from Hinglish/Gujarati-script transliteration |
| Cloud sync | STILL MISSING, never attempted, reaffirmed out-of-scope in ~8 separate reports (P8 through P17) |
| Collaboration/multi-user | STILL MISSING, same pattern as cloud sync |
| Resizable editor panels | STILL MISSING — confirmed today: `left-panel.tsx` still uses a hard-coded `lg:w-80`; first flagged in the P7 workflow audit, never revisited |
| Crash-vs-error messaging | PARTIALLY RESOLVED — robust data-recovery resilience exists; no distinct labeled "the app crashed" UX surface; one specific gap on record since P1 (a force-killed process can leave a project stuck at `TRANSCRIBING` instead of `ERROR`, since killing the process also kills the watchdog) remains unfixed |
| Application-wide error boundary | STILL MISSING — confirmed absent in current code, identical finding to the original P7 audit |
| Delete confirmations | PARTIALLY RESOLVED — full confirm/type-to-confirm flow exists for projects; captions and words delete instantly with undo as the only safety net (a deliberate, previously-considered choice per P17.1's own notes, not an oversight) |
| Quality-report architecture redesign | STILL DEFERRED FOR THE SAME REASON since P12 — every later report (through P17.3) treats the existing reference-based mechanism as "already correct by construction" and declines to touch it |
| Display-mode undo semantics | Confirmed: the ONE documented finding on record (P17.2), unfixed, explicitly benign, this task's own hard rule forbids touching it |
| Keyboard shortcuts discoverability dialog | RESOLVED (P7.1), present and drift-tested today |
| Timeline limitations | PARTIALLY RESOLVED — a full DAW/NLE-style timeline redesign remains explicitly out of scope through every later report; several verification gaps (large-scale live QA, profiler runs) remain "reasoned from the diff, not re-measured live" |
| Playback limitations | Same pattern as timeline limitations |
| Export limitations | STILL MISSING for the two specifically named gaps (VTT per-word cue timing; the legacy-Gujarati export path was verified only by code-path equivalence, never a fresh live fixture) |
| Transparent-background/alpha-channel export | STILL MISSING — and notably has never been discussed as a feature request or backlog item anywhere in the 42-report corpus, not even as something deferred |

---

## 6. Professional workflow audit

IMPORT → TRANSCRIBE → REVIEW → CORRECT TEXT → WORD TIMING → CAPTION TIMING → SPLIT → MERGE → DELETE → INSERT → MULTI-SELECT → BATCH EDIT → STYLE → ANIMATE → PLAYBACK REVIEW → QUALITY CHECK → FIX → EXPORT → VERIFY

| Stage | Current capability | Friction / missing (factual) | Dependency |
|---|---|---|---|
| IMPORT | Video upload, local pipeline extraction | — | Electron/local storage |
| TRANSCRIBE | Local faster-whisper, progress %, stall/crash recovery on server start | Gujarati transcription deferred (existing projects preserved) | `lib/pipeline.ts`, `python/whisper_worker.py` |
| REVIEW | Quality analyzer + review navigation (§4 K) | Word confidence captured but never surfaced for review (§3 item 8) | `quality-analyzer.ts`, `Word.confidence` |
| CORRECT TEXT | Direct edit, find/replace, batch transform, text cleanup, AI fix/rephrase (demo-gated) | Search/replace is literal-only, no regex | `batch-text-ops.ts` |
| WORD TIMING | Drag/nudge/numeric input, clamping, snapping | — | `word-timing.ts`, `timeline.tsx` |
| CAPTION TIMING | Drag/resize/nudge/boundary-to-playhead/snapping | Snap threshold not configurable | `timeline.tsx`, `snapping.ts` |
| SPLIT | Single-caption, Original-mode-only, no batch | No batch split | `word-edit.ts`, `split.ts` |
| MERGE | Single-caption/word, all display modes (P17.1) | No batch merge | `word-edit.ts` |
| DELETE | Caption + word level, batch caption-level | No confirmation dialog (undo-only, deliberate) | `editor-store.ts` |
| INSERT | Single-word, Original-mode-only | Multi-word deferred; derived-mode insert permanently unavailable (architectural, no fabrication) | `word-edit.ts` |
| MULTI-SELECT | Contiguous + non-contiguous, range, select-all | — | `editor-store.ts` selection fields |
| BATCH EDIT | Delete/duplicate-contiguous/nudge/style/animation/find-replace/transform/cleanup/clipboard | Non-contiguous duplicate; batch split/merge/boundary-to-playhead absent | multiple, see §4 H |
| STYLE | Full at caption/global; 3-property word override | Word-level property coverage; no export-side word background box | `style-panel.tsx`, `ass.ts` |
| ANIMATE | Entrance/exit/word-highlight, 2 documented fidelity approximations | typewriter/char-pop reveal; chip-width heuristic | `ass.ts`, `animation-render.ts` |
| PLAYBACK REVIEW | Play/pause/seek/scrub/frame-step/rate/J-K-L | No variable-speed shuttle; no loop-between-marks | `video-canvas.tsx` |
| QUALITY CHECK | Manual-trigger analyzer, safe-fix, issue navigation | Display-mode/undo interaction (P17.2, not to be fixed) | `quality-analyzer.ts` |
| FIX | Safe auto-fixes + manual per-issue navigation + AI-assisted punctuation/grammar (demo-gated) | — | `quality-fixes.ts`, `lib/ai/index.ts` |
| EXPORT | MP4 burn-in + SRT/VTT/TXT sidecar | VTT lacks per-word cue timing; no alpha/transparent export | `lib/ffmpeg/index.ts`, `ass.ts` |
| VERIFY | Structural output verification (exists, non-zero, ffprobe-readable, valid dims/duration) | No perceptual/content correctness check — an explicit design boundary, not an oversight | `export-output-verification.ts` |

This table states facts only; whether any given friction point belongs in P18 is a product-owner decision (see §17), not asserted here.

---

## 7. Word-model mutation matrix

| Operation | `Word.text` changes? | Timestamps change? | Confidence changes? | Style changes? | `removed` changes? | Derived fields change? | Undoable? | One commit? | Can create stale timing? | Can create stale derived text? | Autosave persists? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Split** | Yes (1→2 tokens) | Yes (proportional by grapheme length) | No — always `undefined`, never fabricated | Propagated to both halves | Propagates unchanged | Cleared (`undefined`) at word level; caption-level cache invalidated | Yes | Yes | No (text/words rebuilt in sync via `breakIntoLines`) | Yes, if a derived mode is viewing this caption | Yes |
| **Merge** | Yes (2→1, joined by space) | Yes (spans `[first.start, second.end]`) | Dropped — always `undefined` | First word's wins | `true` if EITHER source was `removed` | Preserved (join-by-space) at word level ONLY if BOTH sides already had a value; caption-level cache always invalidated regardless | Yes | Yes | No | Only if word-level values weren't both present before the merge | Yes |
| **Delete** | Yes (word removed from sequence) | Neighbor absorbs the gap (survivor's own confidence/style/removed untouched) | Unaffected on survivors | Unaffected on survivors | N/A (word spliced out, not marked `removed`) | Caption-level cache invalidated | Yes | Yes | No | Yes (pending-generation until regenerated/re-entered) | Yes |
| **Insert** | Yes (new single-token word) | New word claims the available gap | `undefined` — never fabricated | Propagated from the anchor word | `false` explicitly (a present word, not history) | `undefined` at word level; caption-level cache invalidated | Yes | Yes | No | Yes (pending) | Yes; Original-mode only |
| **Timing change** (`updateWordTiming`) | No | Yes (clamped to neighbors/caption bounds) | No | No | No | No | Yes | Yes | No (this is the mechanism that keeps timing valid) | No | Yes |
| **Caption text edit** (`updateSubtitleText`) | Yes | Unchanged if token count matches; **untouched (stale) if it doesn't** | Preserved at matching positions when count matches (see inconsistency note below); untouched (now mismatched) when it doesn't | Same as confidence | Same as confidence | Both caption-level caches always cleared | Yes | Yes | **Yes, by design**, when token count changes (the P7.2 "never silently fabricate timing" architecture) | Yes (both cleared unconditionally) | Yes |
| **Batch text change** (find/replace, transform, cleanup) | Same `remapWordsToText` path, per affected caption | Same as above | Same as above | Same as above | Same as above | Same as above | Yes | Yes (one commit for the whole batch) | Same as above, per caption | Same as above, per caption | Yes |
| **Clipboard paste** (`applyTextMap`) | Yes (text-only; timing/style/animation captured but never applied) | Same `remapWordsToText` rule | Same as above | Same as above | Same as above | Same as above | Yes | Yes | Same as above | Same as above | Yes |
| **Undo / Redo** | Restores/reapplies the EXACT prior committed state | Same | Same | Same | Same | Same | N/A (this IS the undo mechanism) | N/A | Reflects whatever state existed at that point — never recomputed | Same | Yes |
| **Derived-mode text edit** (`updateSubtitleHinglishText`/`GujaratiScriptText`) | No (authoritative `text` untouched) | No | No | No | No | Yes — only the edited mode's caption-level field changes; word-level breakdown untouched (can create derived-word-count-mismatch) | Yes | Yes | No | Yes, if the edit changes token count | Yes |
| **Regenerate** (`regenerateDerivedWordText`) | No | No | No | No | No | Yes — full word-level AND caption-level recompute from authoritative `words[].text` | Yes | Yes | No | No (this is the resolution mechanism) | Yes |
| **Filler-word marking** (`markFillerWords` → `replaceAllSubtitles`) | Unaffected on the word itself; caption text rebuilt via re-segmentation excluding removed words | Unaffected on the word itself | Preserved | Preserved | `true` on detected filler words | Cleared/pending (whole project re-segmented into new `Subtitle` objects) | Yes | Yes (one commit for the whole project) | No (freshly segmented) | Yes, until a mode is re-entered/regenerated | Yes |
| **Word style override** (`setWordStyleOverride`) | No | No | No | Yes | No | No | Yes | Yes | No | No | Yes |

**Identified inconsistency (not fixed, per this task's own audit-only rule):** when a direct caption-text edit preserves an existing word's timestamp position because the new text's token count happens to match the old one (`remapWordsToText`, `editor-store.ts:1518-1524`), the OLD word's `confidence` (and `style`/`removed`) is carried onto the NEW, completely different text at that position — e.g. editing "hello world" → "hi earth" (2→2 tokens) leaves word 0's original Whisper-confidence-for-"hello" silently attached to "hi," a word Whisper never actually transcribed or scored. This is a genuine architectural wrinkle, not documented in any prior report, and is distinct from the split/merge "never fabricate confidence" policy (which correctly drops confidence for a genuinely NEW token) — this path never drops it because, from the code's point of view, "the position still exists," even though the text at that position is unrelated to what was originally measured. Not fixed in this audit-only task.

The split/merge/insert asymmetry on `hinglishText`/`gujaratiScriptText` (split always clears; merge conditionally preserves; insert always clears) is explicitly documented and deliberate (`word-edit.ts:11-28`) — not an inconsistency, a reasoned per-operation policy.

---

## 8. Timeline/playback audit

**Timeline.** Caption drag/resize is a single, continuous mutation path (`startDrag`/`onPointerMove` → `computeSnappedTiming` → `updateSubtitleTiming` on every pointer-move) — this commits on every move tick, unlike word-timing drags. Snapping is limited to 3 fixed candidates per edge (previous/next neighbor, playhead) at a fixed 8px screen threshold, explicitly not user-configurable. Zoom (20–220 px/sec) preserves either the playhead or viewport center as the anchor. Horizontal virtualization (time-range + 1-viewport buffer) governs only the caption-block row; the vertical captions-list virtualization is a separate, row-count-based mechanism with a documented row-height-estimate drift limitation. No ripple-delete/ripple-trim exists anywhere. No multi-caption mouse-drag-as-group exists (only the keyboard batch nudge).

**Waveform.** Real decoded-PCM peak analysis, computed once server-side and cached by audio-file mtime; client redraw is bounded by viewport pixel width, not data size or zoom level. No manual regenerate control, no stereo/multi-channel display, no vertical zoom/normalization.

**Playback.** The `<video>` element itself is authoritative; store fields are read-models only, confirmed never routed through `commit()`. J/K/L exist without variable-speed shuttle acceleration on repeated presses. Home/End are deliberately scoped to the *selected caption's* own bounds, not the whole timeline — a documented, intentional difference from J/L's playhead-relative behavior.

**Keyboard shortcuts.** 35 bindings, all enumerated and drift-tested against an in-app discoverability dialog (wired into the top bar). No customizable/remappable bindings exist.

**Multi-selection.** Fully described in §3 item 12 and §4 G/H — the selection mechanism itself is complete; which operations honor it is a documented, partial list.

**State separation — verified directly, not inferred.** `commit()` is the only function that ever pushes onto `past`/clears `future`. Selection actions (`selectSubtitle`, `selectWord`, `toggleSubtitleSelection`, `selectSubtitleRange`, `selectAllSubtitles`) and playback actions (`setCurrentTime`, `setPlaying`, `seek`) are all plain Zustand `set()` calls with zero interaction with `commit`/`past`/`future` anywhere in their bodies. `HistorySnapshot`'s own type shape contains no selection or playback field, making this separation structurally guaranteed, not merely conventional. One area flagged as NOT TESTED rather than confirmed either way: `load()`'s own `set()` call does not explicitly reset `currentTime`/`isPlaying`, so in-memory playback state from a previously loaded project could theoretically persist in the store until the video element's own events overwrite it on the next project load — no existing test covers this specific sequence.

---

## 9. Review/QA audit

`analyzeSubtitleQuality` produces a `QualityReport` (16 issue types across error/warning/info severities, safe/unsafe fixability) via a single O(n) pass with a bounded per-caption word loop. `isQualityReportStale` is a pure O(1) reference-inequality check that works correctly for every P17.1 mutation path (Merge/Delete/Regenerate) with zero special-casing, because `commit()`/`undo()`/`redo()` always install a different `subtitles` array reference. `deriveQualityState` (NOT_ANALYZED/CLEAN/ISSUES_FOUND/MANUAL_REVIEW_REQUIRED) and `applyAllSafeFixes`/`applyQualityFix` (the safe-fix mechanism) are both present and exercised by dedicated test files. `reviewedIssueIds` is reset only by `load()`/`runQualityAnalysis()`, confirmed untouched by every P17.1 mutation (Merge/Delete/Regenerate/undo/redo) via both automated tests and, for the removed-word case specifically, live browser QA in P17.3.

Analysis is confirmed manual-trigger-only — exactly two UI call sites (export dialog's "Analyze," quality panel dialog's "Analyze"/"Re-analyze") — never triggered by a keystroke, a commit, or a store subscription.

**The one documented architectural limitation** (P17.2, confirmed and explicitly protected by this task's own hard rules): a display-mode switch can change the `subtitles` array reference outside `commit()`'s undo tracking (via `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage`), so if a mode switch happens after analysis and before a mutation, undoing that mutation cannot restore the exact array reference that was analyzed — the report stays "outdated" even after `Ctrl+Z`. This is benign (never shows "fresh" when it isn't) and is explicitly NOT to be fixed in this task, nor was it fixed in P17.3.

No additional review-state inconsistency was found in this audit beyond the one above and the confidence-not-surfaced gap already noted in §3/§4 (a different subsystem, not part of the quality-report mechanism itself).

---

## 10. Performance audit

**Virtualization** — COMPLETE for both the captions list (row-count-based) and the timeline (time-range-based), independently implemented, both proven functionally correct at 5,400 captions. The captions-list row-height estimate drift is a documented, accepted KNOWN LIMITATION with a mitigating re-correction pass, not a correctness bug.

**React rendering** — PARTIAL. `CaptionRow` is `memo()`'d, and the `words: isSelected ? ... : null` gating correctly skips word-chip computation for every non-selected row. However, every callback prop passed into `CaptionRow` from `CaptionsPanel`'s `.map()` is a fresh inline arrow function (no `useCallback`), which defeats `memo()`'s shallow-prop comparison — combined with `project`/`subtitles` always being a new reference after any `commit()`, this means **any single edit anywhere in the project re-renders every currently-mounted (virtualized-window) caption row**, not just the one that changed. `Timeline` has no `React.memo` on its caption blocks at all.

**Quality analysis performance** — O(n) single pass, confirmed manual-trigger-only (no keystroke/commit-triggered re-analysis). NOT TESTED in isolation — no dedicated performance test exists for `analyzeSubtitleQuality`; the only timed evidence is a combined, single-5,400-tier store-level test that also includes 500 issue-navigation calls.

**Undo/redo snapshot performance** — `snapshotOf()` takes six fields by reference, no deep clone. `MAX_HISTORY = 60` bounds both stacks — confirmed NOT unbounded. `commit()`/`undo()`/`redo()` all do a shallow `project` spread, but the `subtitles` array itself is always a new reference for any caption-touching commit (even a single-word edit), which is the direct cause of the §"React rendering" finding above.

**Autosave/persistence performance** — 900ms debounce, single-flight queue (prevents out-of-order overwrites — does not reduce payload size). Every save (network AND the synchronous local crash-safety snapshot) sends/serializes the **entire** `subtitles` array, never a diff. Server-side, `subtitles` presence triggers a full `deleteMany`+`createMany`, never a per-row upsert. NOT TESTED at scale — no performance test exists for `project-patch.ts`'s apply latency at any caption count.

**Waveform rendering performance** — COMPLETE. Peaks computed once server-side (a 60-minute-equivalent sample count completes in under 5 seconds per its own test, explicitly framed as a sanity bound, not a strict SLA), cached, and client redraw cost scales with on-screen pixel width, never with total peak count or zoom level.

**Exhaustive "performance:"-family test inventory** (full detail in the dedicated performance-audit agent's findings; summarized): word-editing and output-mode/derived-text operation families have genuine full 5-tier sweeps (30/300/1800/3600/5400) for split/merge/delete/insert, Hinglish/Gujarati-Script mode-switch and mutation costs, undo/redo after a derived-mode merge, and the O(1) quality-staleness check. Batch operations (selection/nudge/style/delete/duplicate/find-replace/transform/cleanup), clipboard `buildCaptionClipboard`, and the combined quality-report-navigation test are each proven only at the single 5,400-caption tier, not the full sweep. Waveform's 60-minute sanity-bound test is likewise single-tier.

**O(n²) risk check** — confirmed absent everywhere inspected. Every single-caption/single-word mutator (`updateSubtitleText`, `updateWordTiming`, `mergeWordWithNext`, `deleteWord`, `splitWord`, `insertWord`) performs 2–3 independent linear (O(n)) passes over the subtitle array (typically a `.find()` for feasibility, then `commit()`'s own mutator `.map()`, then `commit()`'s own unconditional `Set` construction for `pruneSelection`) — never nested iteration. The existing "stays fast at N total captions" test family is precisely what proves this constant multiple stays tolerable up to 5,400 captions, not evidence of zero-cost O(1) operations.

---

## 11. Candidate P18 areas

Every item below is derived directly from a confirmed finding elsewhere in this report. None is asserted to belong in P18 — these are examples for product-owner selection (§15/§17).

- **Advanced timeline editing** — ripple-edit/ripple-delete, multi-caption drag-as-group, configurable snap threshold (justified by §3 item 18, §4 E).
- **Word-confidence review surface** — surfacing the already-captured, already-preserved `Word.confidence` data for review (e.g. highlighting low-confidence words) (justified by §3 item 8).
- **Word-level style parity** — expanding the word-override panel beyond 3 properties; addressing the ASS word-background-box export gap (justified by §3 item 9, §4 I).
- **Batch-operation completeness** — non-contiguous batch duplicate, batch split/merge/boundary-to-playhead (justified by §4 H).
- **Resizable editor panels** — the fixed 320px left/right panels flagged since P7 (justified by §5).
- **Application-wide error boundary** — confirmed absent since P7, never revisited (justified by §5, §4 P).
- **Delete-confirmation consistency** — caption/word delete is currently undo-only, unlike the project-level confirm/type-to-confirm flow (justified by §5, §4 O).
- **React re-render hardening** — `useCallback`-wrapping `CaptionRow`'s props, `memo()`-wrapping timeline caption blocks (justified by §10).
- **Incremental/diffed persistence** — replacing the full-array-replace autosave/PATCH pattern with a per-caption diff (justified by §3 items 14/15, §10 — but see §13, this touches a proven, production-critical system).
- **Export delivery completeness** — VTT per-word cue timing, transparent/alpha-channel export (justified by §3 item 27, §4 N, §5).
- **Keyboard/professional-transport polish** — variable-speed J/L shuttle, remappable shortcuts (justified by §3 items 20/29).
- **Regex-capable search/replace** — the literal-only implementation has been explicitly, repeatedly deferred across many prior reports as a deliberate choice (justified by §4 D... correction, §4 C/§5).
- **Project-duplicate completeness** — copying `composition`/`trimStart`/`trimEnd`/`cutRanges`/export history (justified by §4 O).
- **Trash retention policy** — no scheduled purge exists today (justified by §4 O, §5).
- **Brand Kit completeness** — multi-kit-per-user (a schema change) or full-field application within the existing single-kit model (justified by §4 O).

---

## 12. Dependency map

| Candidate | Existing subsystem reused | Files/modules likely touched | Prerequisite | Regression surface | Test strategy | Packaging impact | Scope |
|---|---|---|---|---|---|---|---|
| Advanced timeline editing | Undo/commit architecture, snapping/clamping math | `timeline.tsx`, `lib/timeline/*`, `editor-store.ts` (`duplicateSubtitle(s)`, `splitSubtitle`, `mergeWithNext`, `setSubtitleBoundaryToPlayhead`) | None blocking | High — touches timing/overlap invariants across the whole editor | Extend existing 5-tier perf-test family; new pure-function tests for ripple math; live QA | Not required | Medium–Large |
| Word-confidence review surface | Existing `Word.confidence` field (no migration needed) | `captions-panel.tsx`, `word-timing-popover.tsx`, possibly `quality-analyzer.ts` if surfaced as an issue type | None blocking | Low–Moderate (additive UI) | New pure-function classification tests, live QA for visual treatment | Not required | Small–Medium |
| Word-level style parity | Existing per-word `style` override mechanism | `style-panel.tsx`, `ass.ts` (`wordStyleTag`), `subtitle-overlay.tsx` | None blocking | Moderate (export fidelity) | Export regression tests, live preview/export parity QA | Not required | Medium |
| Batch-operation completeness | Existing batch infrastructure (`applyStyleToSubtitles` pattern) | `editor-store.ts` (`duplicateSubtitles`, `splitSubtitle`, `mergeWithNext`), `lib/subtitles/duplicate-timing.ts` | Resolving the P8/P9-era non-contiguous-duplicate/collision gap first | High (shared with advanced timeline editing) | Extend existing batch perf-test family; new collision/contiguity tests | Not required | Medium |
| Resizable editor panels | None — new UI mechanism | `left-panel.tsx`, editor layout shell | None blocking | Low (additive, layout-only) | New layout tests (first component-level tests in this codebase), live QA at multiple window sizes | Not required | Small |
| Application-wide error boundary | React error-boundary pattern (new to this codebase) | `src/app/editor/[id]/*`, new `error.tsx`/`global-error.tsx` | None blocking | Low (additive) | New component-level tests (first of their kind here), live QA (forced-error scenario) | Not required unless Electron-specific crash reporting is added | Small |
| Delete-confirmation consistency | Existing `ConfirmDialog` pattern (project-level) | `captions-panel.tsx`, `word-timing-popover.tsx` | Product decision: is undo-only acceptable, or is a confirm dialog wanted (§17) | Low (additive, UX-only) | New interaction tests, live QA | Not required | Small |
| React re-render hardening | Existing `memo()`/gating pattern | `captions-panel.tsx`, `timeline.tsx` | None blocking | Moderate (touches the highest-traffic render path in the app) | New render-count tests (first component-perf tests here), regression against the full existing test suite | Not required | Small–Medium |
| Incremental/diffed persistence | Existing `project-patch.ts`/`save-queue.ts` | `project-patch.ts`, `use-autosave.ts`, possibly a new diff-computation module | **High care** — this is a proven, production-critical system (§13) | **Very high** | New perf tests at 5,400-caption scale; production-DB-safety-comparison methodology (reused from P16.1's release-closure approach) | Not required unless Electron-side save queueing changes | Large |
| Export delivery completeness | Existing `export-formats.ts`/ffmpeg pipeline | `lib/subtitles/export-formats.ts`, `lib/ffmpeg/index.ts` (only if alpha export is pursued) | None blocking for VTT; alpha export needs a codec/container decision | High (export correctness is a high-stakes, user-facing deliverable) | Extend `export-output-verification`-style structural tests; format-specific correctness tests; live QA against a real rendered video | **Possibly required** if alpha-channel export touches the FFmpeg pipeline surface | Medium–Large |
| Keyboard/transport polish | Existing `use-keyboard-shortcuts.ts`/`video-canvas.tsx` rate control | `use-keyboard-shortcuts.ts`, `video-canvas.tsx` | None blocking | Low–Moderate (central shared hook) | Extend `keyboard-shortcuts-reference.test.ts`'s drift-detection pattern; live QA | Not required | Small–Medium |
| Regex-capable search/replace | Existing `batch-text-ops.ts` find/replace | `batch-text-ops.ts`, `search-replace-dialog.tsx` | Product decision: is real regex wanted despite repeated prior deferrals (§17) | Moderate (user-authored regex is a new correctness/safety surface — catastrophic backtracking, invalid patterns) | New pure-function tests for pattern validation/safety, live QA | Not required | Medium |
| Project-duplicate completeness | Existing duplicate route | `app/api/projects/[id]/duplicate/route.ts` | None blocking | Low–Moderate | New duplicate-fidelity tests, production-DB-safety-comparison | Not required | Small |
| Trash retention policy | Existing soft-delete/trash model | `app/dashboard/trash/*`, possibly a new scheduled job | Product decision on retention window (§17) | Low | New scheduled-purge tests | Possibly required if a background/cron mechanism is added on the Electron side | Small |
| Brand Kit completeness | Existing `BrandKit` model | `app/api/brand-kit/route.ts`, `presets-panel.tsx`, **schema change only if multi-kit is chosen** | Product decision: multi-kit (schema change) vs. full-field single-kit (no schema change) (§17) | Low–Moderate | New brand-kit application tests | Not required unless multi-kit needs new packaging-relevant migration tooling | Small–Medium |

---

## 13. Protected systems / hard boundaries

The following should NOT be touched in P18 unless a specific, concrete reason emerges during scoping — each is a proven, production-verified system:

- **Database schema** — no migration should be assumed necessary for any candidate above except Brand-Kit multi-kit, which is the one candidate that would require one, and only if that specific direction is chosen.
- **Authoritative Original text semantics** — the P17-era "Original text is the one authoritative field, derived text is always reversible and never overwrites it" contract, proven correct across P17–P17.3.
- **Derived text semantics** — the Hinglish/Gujarati Script generation/regeneration/staleness architecture (`output-mode.ts`, `caption-display-mode.ts`), and the shared `sumWordTokens` convention.
- **Removed-word semantics** — `Word.removed`'s soft-delete-for-history meaning, and its now-consistent exclusion from every text-building/token-counting function.
- **Existing undo/redo architecture** — `commit()`/`snapshotOf()`/`MAX_HISTORY`/`HistorySnapshot`'s reference-sharing model. Any "incremental persistence" work (§12) must not weaken this.
- **Autosave** — the debounce/single-flight/full-payload pattern, unless a candidate (incremental persistence) deliberately targets it with the DB-safety rigor P16.1 established.
- **Local crash recovery** — `local-snapshot.ts`, `stale-job-recovery.ts`, and the single-call-site guarantee enforced by its own structural test.
- **Packaged worker** — the Electron/whisper-worker packaging surface; none of the candidate areas above inherently require touching it.
- **FFmpeg/export verification** — `export-output-verification.ts`'s intentionally-structural-only scope; broadening it to perceptual/content verification is a large, separate undertaking, not a byproduct of any listed candidate.
- **Production data** — any P18 work must follow the P16.1-established methodology (backup → duplicate → QA-only-on-duplicate → diff → cleanup) before touching real project rows.

---

## 14. Test coverage map

**Heavily covered:** word editing (split/merge/delete/insert, full 5-tier performance sweeps), output-mode/derived-text operations (generation/regeneration/staleness, full 5-tier sweeps), undo/redo core mechanics, batch text operations (find/replace/transform/cleanup), list-virtualization and visible-range windowing math (functional correctness to 5,400), Hinglish/Gujarati-Script conversion correctness, caption-display-mode capability table.

**Moderately covered:** quality-analyzer correctness (dedicated test file exists, but no isolated performance test — only a combined single-tier proxy via the store), waveform correctness plus one sanity-bound performance test (not a strict SLA), export-output-verification structural checks, project-patch correctness (round-trip fidelity, no performance test at any scale).

**Weakly covered:** `style-clipboard.ts` has no dedicated test file at all (confirmed by direct file search). Autosave/PATCH latency at scale is untested. Brand Kit application logic (only 3 of 6+ fields applied) has no test asserting the other fields are intentionally unused vs. a bug.

**UI-only areas (no automated component-level test exists for the interaction logic itself — only the underlying pure-function modules are tested):** `timeline.tsx`'s drag/resize/snap/zoom interaction code, `captions-panel.tsx`'s selection/editing interaction code, `word-timing-popover.tsx`, `video-canvas.tsx`'s playback wiring, `waveform.tsx`'s canvas rendering. This is a structural characteristic of the whole codebase — there is no React component-testing infrastructure (no React Testing Library setup, no `src/components/**/__tests__` directory) anywhere in this project; every one of these areas has only ever been verified via live browser QA documented in each phase's own research report.

**Browser-QA-only areas:** every "Phase 5 Live Dev QA" section across the P14–P17.3 reports — this is the only verification any of these interaction flows have ever received.

**Packaged-QA-only areas:** P16.1's packaged Windows EXE QA (word insertion/grapheme splitting in the real Electron runtime), and by extension anything Electron-specific (native module paths, the packaged worker). `electron/__tests__/db-migrations.test.js` is the only automated test that runs against packaged-adjacent code; everything else Electron-specific has only ever been verified by building and running the actual installer.

---

## 15. P18 scope options

Five independently bounded options. None is ranked, scored, or recommended over another — this is a menu for the product owner to choose from (§17).

### Option A — Timeline & Batch Operation Completeness
- **Capabilities:** ripple-edit/ripple-delete, multi-caption drag-as-group on the timeline, non-contiguous batch duplicate, batch split/merge/boundary-to-playhead, configurable snap threshold.
- **Reuses:** existing undo/commit architecture, existing snapping/clamping math, existing batch-selection infrastructure.
- **Files touched:** `timeline.tsx`, `lib/timeline/*`, `editor-store.ts` (duplicate/split/merge/boundary actions), `lib/subtitles/duplicate-timing.ts`.
- **Dependencies:** resolving the P8/P9-era non-contiguous-duplicate collision gap as a likely prerequisite.
- **Regression surface:** high — touches timing/overlap invariants used everywhere in the editor.
- **Test requirements:** extend the existing 5-tier performance-test family; new pure-function tests for ripple math and collision resolution; live QA.
- **Packaging:** not required.
- **Explicitly excludes:** word-model changes, review/QA architecture, export, styling.

### Option B — Word-Level Review & Style Parity
- **Capabilities:** surfacing `Word.confidence` for review (e.g. low-confidence highlighting), expanding word-level style override coverage, ASS word-background-box export support.
- **Reuses:** the already-persisted `Word.confidence` field (no migration), the existing per-word style-override mechanism.
- **Files touched:** `captions-panel.tsx`, `word-timing-popover.tsx`, `style-panel.tsx`, `lib/subtitles/ass.ts`, `subtitle-overlay.tsx`.
- **Dependencies:** none blocking.
- **Regression surface:** moderate — touches rendering/export fidelity.
- **Test requirements:** new confidence-classification pure-function tests, export regression tests, live preview/export parity QA.
- **Packaging:** not required.
- **Explicitly excludes:** timeline changes, quality-report architecture, batch operations.

### Option C — Editor Shell Robustness & Polish
- **Capabilities:** application-wide React error boundary, resizable editor panels, delete-confirmation consistency for captions/words, keyboard shortcut remapping.
- **Reuses:** the existing `ConfirmDialog` pattern (project-level), the existing keyboard-shortcuts-reference drift-test pattern.
- **Files touched:** new `error.tsx`/`global-error.tsx`, `left-panel.tsx`/editor layout shell, `captions-panel.tsx`/`word-timing-popover.tsx` delete handlers, `use-keyboard-shortcuts.ts`.
- **Dependencies:** none blocking; all additive.
- **Regression surface:** low–moderate (remappable shortcuts touches the one central shared hook every other shortcut depends on).
- **Test requirements:** first component-level test infrastructure this codebase would have; live QA.
- **Packaging:** not required unless Electron-specific crash reporting is added to the error boundary.
- **Explicitly excludes:** timeline, export, word-model, review/QA.

### Option D — Export & Delivery Completeness
- **Capabilities:** VTT per-word cue timing, project-duplicate completeness (copy composition/trim/cuts/export history), Brand Kit completeness, trash retention policy.
- **Reuses:** existing `CompositionSettings`/`CutRange`/`BrandKit` models, existing export-formats/duplicate routes.
- **Files touched:** `lib/subtitles/export-formats.ts`, `app/api/projects/[id]/duplicate/route.ts`, `app/api/brand-kit/route.ts`, possibly the Prisma schema (only if multi-Brand-Kit is chosen).
- **Dependencies:** a product decision on Brand Kit direction (multi-kit vs. full-field single-kit) before scoping that piece.
- **Regression surface:** high for export correctness (a high-stakes, user-facing deliverable); low–moderate for the rest.
- **Test requirements:** extend `export-output-verification`-style structural tests, format-specific correctness tests, live QA against a real rendered video, production-DB-safety-comparison for duplicate changes.
- **Packaging:** possibly required if alpha-channel export is pursued (touches the FFmpeg pipeline surface) — otherwise not required.
- **Explicitly excludes:** timeline, word-model, review/QA UI.

### Option E — Persistence & Performance Hardening
- **Capabilities:** incremental/diffed autosave (replacing full-array replace), `CaptionRow`/timeline re-render optimization (`useCallback`/`memo` hardening), new performance-test coverage for autosave/PATCH latency at scale.
- **Reuses:** existing `project-patch.ts`/`save-queue.ts` architecture as the foundation to extend, not replace wholesale.
- **Files touched:** `project-patch.ts`, `use-autosave.ts`, `captions-panel.tsx`, `timeline.tsx`.
- **Dependencies:** none blocking, but this is the one option that touches a proven, production-critical system directly (see §13) — high care required regardless of technical scope.
- **Regression surface:** very high for the persistence half; moderate for the rendering half.
- **Test requirements:** new performance tests at 5,400-caption scale for the diff computation; the full production-DB-safety-comparison methodology from P16.1's release closure; new React render-count tests (a first for this codebase).
- **Packaging:** not required unless Electron-side save queueing is touched.
- **Explicitly excludes:** timeline features, export, word-model, review/QA.

---

## 16. Explicit exclusions (apply to every option above, regardless of which is chosen)

- No AI feature implementation or hardening beyond what already exists (Fix punctuation/grammar, Rephrase/Shorten, Translate, Generate title/description are all already implemented and demo-gated — none of the options above touch this layer).
- No cloud sync, no collaboration/multi-user features.
- No database schema change, with the single named exception (Brand Kit multi-kit, Option D) only if that specific direction is explicitly chosen.
- No redesign of the undo/redo architecture, the quality-report staleness mechanism, or the derived-text staleness mechanism.
- No change to removed-word semantics.
- No version bump, no packaging, unless a specific option's own dependency map names a concrete trigger (Option D's alpha export, Option C's Electron-side crash reporting, Option E's Electron-side save queueing — all conditional, none assumed).
- No P19 planning of any kind.

---

## 17. Open questions requiring product-owner decision

1. Which of the five scope options (or which combination) should P18 actually pursue? This report deliberately does not recommend one.
2. Is the confidence-highlighting idea (Option B) wanted at all, given Whisper confidence data has never been surfaced to end users in this product's history?
3. Is an application-wide error boundary and panel resizing (Option C) considered P18-worthy work, or a separate, smaller polish-only task?
4. Should real regex search/replace be built, given it has been explicitly and repeatedly deferred as a deliberate choice (not an oversight) across many prior phases — is that reasoning still valid, or has the product's needs changed?
5. Is incremental/diffed persistence (Option E) worth its regression risk against a currently stable, proven, zero-known-defect autosave system — or does "don't touch what isn't broken" apply here?
6. Should Brand Kit move to multiple kits per user (a schema change), or stay single-kit with full-field application (no schema change)?
7. Is transparent/alpha-channel export a real, current customer need, given it has never once been requested or even discussed as a deferred item across 42 prior research reports?
8. Should J/K/L gain variable-speed shuttle behavior, or is the current caption-edge-jump behavior sufficient for a dialogue-caption-driven editing workflow (as opposed to raw-footage scrubbing, which variable-speed shuttle is more suited to)?
9. Is the confidence-carries-over-to-different-text wrinkle identified in §7 (the one genuine mutation-matrix inconsistency found in this audit) something the product wants addressed at all, and if so, in P18 or a smaller, separate fix?
10. Should caption/word delete gain a confirmation step (matching the project-level pattern), or is undo-only considered the correct, deliberate UX for high-frequency editing actions?

---

## Final verification that this audit did not modify the project

Run after all research/synthesis was complete, to confirm the audit itself changed nothing:

- `git status --short` (excluding this new report file, added under the already-untracked `research/` directory): identical to the exact pre-existing baseline at the start of this task — the same modified `.gitignore`/`eslint.config.mjs`/`next.config.ts`/`package-lock.json`/`package.json`/`src/app/globals.css`/`src/app/layout.tsx`/`src/app/page.tsx`/`tsconfig.json` and the same untracked directories/files, all pre-dating this task. No production file was edited.
- `npm test`: **1188/1188 passing** — identical count to the P17.3 baseline.
- `npx tsc --noEmit`: clean, no errors.
- `npx eslint .`: 0 errors, the same 5 pre-existing warnings (`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`) — no new warnings introduced.
- Version: `package.json` still reports `0.1.17`.

All temporary reproduction/diagnostic work in this task (a repro script used earlier in this session for P17.3, and any scratch files) was confined to prior tasks and already cleaned up; no diagnostic script was created or left behind during this P18 audit itself — every finding here came from `Read`/`Grep`/`Glob` and read-only background research agents, none of which have write access.

