# P7 Preflight — Professional Caption Editing Workflow Audit

**Task ID:** 90137
**Type:** Audit only — no product code was changed, no version bump, no production data touched.
**Scope:** SUBLY v0.1.5, full codebase read (not relying on prior task descriptions where code differs).

---

## 1. Executive Summary

SUBLY's caption-editing core is **more solid than a typical MVP** — undo/redo is a single, consistent snapshot mechanism used by every mutation; autosave has real debouncing, retry, a local crash-safety snapshot, and a visible save-state indicator; caption-list virtualization is proven correct up to 5,400 captions in both unit tests and a prior first-party performance report; the waveform is genuine audio-derived data with real edge-case test coverage; and overlap between captions is structurally impossible by construction (a clamping formula in `updateSubtitleTiming`, not a UI-level guard that could be bypassed).

Where it falls short of a **professional** subtitle editor (Subtitle Edit, Premiere, Resolve, Descript, CapCut, VEED — verified below, not assumed) is almost entirely in **timeline interaction polish and word-level precision**, not in data integrity or architecture:

- **Word-level timestamp editing does not exist anywhere in the codebase** — not in the UI, not in the store. The app's own marketing copy (`src/components/landing/faq.tsx:9`) claims users can "adjust word-level timing," which is not backed by any code path. This is the single most important finding in this audit.
- **The timeline has no snapping, no auto-scroll during playback, and no zoom-position preservation** — three things every reference tool checked (Subtitle Edit, Premiere Pro, DaVinci Resolve) has.
- **There is no multi-select or batch operation for captions** anywhere (timeline or caption list) — every operation is single-caption.
- **Keyboard shortcuts are extensive (19 global shortcuts) and well-guarded against firing while typing**, but roughly half are undiscoverable in the UI — no shortcuts help dialog exists.
- Several genuinely good, non-obvious protections already exist and must not be disturbed: the `isTypingTarget`/`isAnyDialogOpen` shortcut guards (fixed a real prior bug where Ctrl+Z mid-edit could corrupt a different caption), the merge-preserves-style-override fix (also a prior bug, now regression-tested), and the overlap-clamping math in `updateSubtitleTiming`.

This report recommends a **7-item P7 scope** focused on timeline interaction quality and the smallest viable word-level timing capability — not a rewrite, not a feature dump, and explicitly not touching transcription, export, styling, or persistence systems.

---

## 2. Current Architecture Audit

### 2.1 Editor layout (`src/components/editor/editor-shell.tsx`)

Fixed three-panel desktop layout: Left panel (320px, Captions/Settings tabs) + center (video canvas + timeline, flexible) + Right panel (320px, Style/Animation/Presets tabs), all inside a non-scrolling `h-screen` shell. **Not resizable** — every panel width and the timeline height (`lg:h-64`) are hard-coded Tailwind classes; no splitter/drag-handle component exists anywhere.

Mobile/narrow viewports (`<1024px`) collapse to a single-column, tab-switched layout (`MobileTabBar`) with one deliberate, well-engineered detail: the video element is mounted exactly once and repositioned via CSS `order` across breakpoints, specifically to avoid the video reloading/losing state on resize — documented directly in a code comment. This should not be touched casually.

### 2.2 Video preview & playback (`src/components/editor/video-canvas.tsx`)

More complete than a minimal `<video>` wrapper: play/pause, a seek bar clamped to the trim range, frame-accurate step (`stepFrame`, using the project's real fps), a playback-speed dropdown (0.5×–2×), volume/mute, safe-area guide overlays (5%/10% insets — a genuinely professional touch for social captioning), and fullscreen. Space-bar and K/L transport are wired via custom DOM events rather than prop drilling, with a documented workaround for Chrome's user-gesture `video.play()` policy. Trim/cut ranges are skipped live during playback so scrubbing matches what export will actually produce.

**Gap**: no visible in/out (trim) markers on the seek bar itself (the range is clamped but not visually marked), and no loop/region playback.

### 2.3 Global states, dialogs, error handling

- Three-phase route controller (`src/app/editor/[id]/page.tsx`): `loading` → `processing` (full-screen takeover via `ProcessingScreen`, not inline) → `ready` (mounts `EditorShell`). While transcription is running, the editor DOM doesn't exist at all — no partial/inline indicator merged into the editor itself.
- **No React error boundary anywhere in the app** — no `error.tsx`/`global-error.tsx` under `src/app`. An uncaught exception inside `EditorShell` has no in-app recovery path. This is a real gap, but it is an app-wide robustness concern, not a caption-editing-workflow item — noted here but explicitly **not** proposed for P7 (see §12).
- All dialogs (Export, Search/Replace, Quality, Remove-silence) are true blocking Radix modals (`bg-black/70 backdrop-blur-sm` overlay) — none let the user see the timeline/video while open. The AI menu is a non-blocking dropdown for most of its actions, which is the one exception.
- Autosave failure is surfaced **inline** (a small red badge in the top bar), never a blocking dialog — editing is never blocked by a failed save. Exponential backoff retry (3s→30s cap), plus a synchronous local `localStorage` crash-safety snapshot on every dirty change, independent of network success.
- Crash/stale-job recovery (`src/lib/recovery/stale-job-recovery.ts`) runs once at server startup, before any HTTP request is served, and resets any job stuck in a non-terminal DB status to a clean failed/ready state with a user-facing retry message. It reuses the ordinary error UI rather than adding a new surface — clean, but means a genuine crash and an ordinary transcription failure look identical to the user (same UI, differentiated only by message string).
- A client-side local-snapshot-vs-server-state conflict (e.g., edits made just before a crash) is offered via a single dismissible toast on load — no persistent secondary affordance if the user misses it.
- One place breaks in-editor flow: if no Brand Kit exists yet, "Apply Brand Kit" sends the user to a separate `/dashboard/brand-kit` page and back — no inline creation.

### 2.4 Undo/redo (`src/store/editor-store.ts`)

Single choke point: every mutating action calls `commit(mutator)`, which snapshots the pre-mutation state onto a `past` stack (capped at `MAX_HISTORY = 60`) and clears `future`. `undo()`/`redo()` swap the whole snapshot. This means **every kind of edit — text, timing, style, structural (split/merge/delete/duplicate)** — is undoable through one consistent mechanism, not a per-feature ad hoc implementation. History is intentionally not persisted across a reload/restart (`load()` resets `past`/`future` to `[]`) — this matches how Premiere and Resolve also behave (neither persists undo history across an app restart), so it is not a gap.

### 2.5 Autosave (`src/hooks/use-autosave.ts`)

Debounced 900ms after the store's `dirty` flag flips true, single-flight queued (only one PATCH in flight at a time, preventing an older save from racing a newer one), exponential-backoff retry on failure, a synchronous `beforeunload` flush, and a four-state visible indicator in the top bar (Unsaved / Saving / Saved / Error with a retry-explaining tooltip). This is a complete, well-covered implementation with no silent-failure gap found.

### 2.6 Large-project performance & virtualization

Two **separate** virtualization mechanisms exist — this distinction matters for anyone touching either system in P7:

1. **Caption list sidebar** (`src/lib/timeline/list-virtualization.ts`, consumed by `captions-panel.tsx`): a generic row-window calculator, `VIRTUALIZE_THRESHOLD = 150` captions (confirmed identical in both the library's own test file and the production call site). Proven correct up to **5,400** captions in unit tests (`computeVisibleRange`/`computeScrollTargetForIndex`, covering top/middle/bottom-of-list and empty-list edge cases) and in a prior first-party performance report (`research/p2_editor_performance_scalability_report.md`, read as evidence): unvirtualized mount time at 5,400 captions was 1,572ms; virtualized, 374ms, with DOM rows capped at ~17 regardless of total count.
2. **Timeline canvas caption blocks** (`timeline.tsx`'s own `visibleSubtitles` filter): a simpler, hand-rolled time-window filter (`s.end >= viewStart && s.start <= viewEnd`) that does **not** use `list-virtualization.ts` at all. It has **no dedicated automated test** — its correctness at scale rests on the same prior performance report's manual DOM-inspection claim ("confirmed still correct at 5,400 captions"), not a unit test with asserted numbers.
3. **Waveform** (`waveform.tsx`): a canvas drawing only the visible-plus-buffer column range, explicitly sized to stay under Chromium's ~32,767px canvas-dimension cap at max zoom on a long recording. Real audio-derived peak data (`src/lib/audio/waveform.ts`, WAV PCM16 parsing + peak-per-bucket reduction), with tested edge cases: truncated/corrupt WAV, all-silence audio, sub-bucket-length audio, and a 60-minute-equivalent sample count computing in well under 5 seconds.

Drag-gesture cost from the same performance report: ~5.9ms/pointermove-step at 3,600 captions, ~12–15ms/step at 5,400 captions — i.e. drag responsiveness measurably degrades at the largest tested tier even with virtualization active. This is evidence, not yet a confirmed user-facing problem (see §10).

---

## 3. Workflow Audit — IMPORT → TRANSCRIBE → REVIEW → EDIT TEXT → FIX TIMING → REVIEW WORD TIMING → STYLE → PREVIEW → EXPORT

| Stage | Current workflow | Meaningful interactions | Leaves timeline/editor? | Context lost? | Keyboard gap | Visual feedback gap | Accidental-edit risk |
|---|---|---|---|---|---|---|---|
| **Import** | Upload page → transcription kicks off | 1 (file picker) | Yes — separate `/projects/[id]/upload` route (only pre-editing, doesn't interrupt a session) | No (nothing to lose yet) | N/A | Full-screen `ProcessingScreen` with step list, progress bar, cancel — good | None |
| **Transcribe** | Automatic; full-screen processing UI | 0 (passive) | No (same screen) | No | N/A | Good — explicit step list, elapsed time | None |
| **Review** | Read auto-captions in the caption list | Scroll/read | No | No | ↑/↓ to move between captions works | No inline quality signal per caption row (see Edit Text) | None |
| **Edit text** | Click into a caption's textarea, type, blur or Enter to commit | 1 click + typing + 1 commit per caption | No | No | Tab/Shift+Tab moves between captions while editing — good | **None**: no inline "this caption has a quality issue" badge in the list itself — must open a separate Quality dialog on a different left-panel tab to see any issue | **Real, evidence-based**: if a text edit changes the caption's word count (e.g. fixing "don't" → "do not"), original per-word transcription timestamps are silently discarded and replaced with evenly-spaced synthetic ones (`remapWordsToText`) — no UI warning at all |
| **Fix timing** | Drag caption block body (move) or edges (resize) on the timeline; or Alt+←/→ for 1-frame nudge | 1 drag or 1 keypress per caption | No | No | Alt+←/→ frame-nudge exists; plain arrows are caption-select, not timing | Timeline shows the block resize live, but **no snapping** to a neighbor's edge or the playhead, and **no auto-scroll** if the playhead runs off-screen during playback | Structurally safe — overlap is clamped, impossible to create |
| **Review word timing** | **No dedicated step exists.** The only word-level UI at all is a style-only "Word overrides" picker on the Style tab (color/size/background), which shows no timestamp | 0 (doesn't exist as a workflow) | N/A | N/A | N/A | **No word boundaries are rendered anywhere** — timeline, waveform, and caption list all show caption-level timing only | N/A — because there's nothing to edit, there's nothing to break, but this stage effectively does not exist |
| **Style** | Right panel (Style/Animation/Presets tabs), live-bound to the video preview | Several slider/color/dropdown interactions | No | No | None specific to style (mouse-driven sliders/pickers) | Live preview updates instantly — good (verified in Task 87426's own QA) | None found |
| **Preview** | Play button, scrub bar, safe-area toggle | 1 click | No | No | Space, J/K/L | Good (see §2.2) | None |
| **Export** | Export dialog (modal) | 1–3 clicks (config, export, download) | No (modal, not a route) | Timeline/video hidden behind the modal while exporting | None specific | Good — progress, font-fallback offer, history list, non-blocking quality advisory that never blocks export | None |

**Most significant workflow finding**: "Review word timing" is listed in the task's own workflow diagram as an expected stage — the audit confirms it currently has **zero UI surface**. This is the clearest, most evidence-backed gap in the entire audit (see §6).

---

## 4. Timeline Audit

*(Full detail from direct code reads of `timeline.tsx`, `waveform.tsx`, `edit-model.ts`, `time-scale.ts`, `list-virtualization.ts`.)*

| Capability | Status | Evidence |
|---|---|---|
| Zooming | Exists, mouse-only, no keyboard shortcut | Buttons only, `timeline.tsx:271-276`; range 20–220 px/sec |
| Zoom preserves playhead/viewport position | **Missing** | No `scrollLeft` recompute anywhere near the zoom handlers |
| Horizontal scroll/pan | Native scrollbar only | `overflow-x-auto` container, `timeline.tsx:279-289` |
| Auto-scroll to follow playhead during playback | **Missing** | Scroll-into-view effect is keyed only on `[selectedId]`, explicitly not on `currentTime` |
| Playhead click/drag seek | Works, continuous float-second precision | `timeFromClientX`→`pixelsToTime`, shared by ruler/video-track/waveform |
| Waveform | Real audio-derived peaks, canvas-rendered, tested edge cases | `src/lib/audio/waveform.ts` |
| Caption block drag (move) | Works | `timeline.tsx:109-121` |
| Caption block resize (edges) | Works, 0.1s min duration during drag | `timeline.tsx:114-115` |
| Snapping (to neighbor, waveform feature, or playhead) | **Missing entirely** | No magnetic threshold/snap logic found anywhere in `timeline.tsx` or `edit-model.ts` |
| Overlap prevention | **Solid — structurally impossible**, not just UI-blocked | `updateSubtitleTiming` clamp formula, `editor-store.ts:383-386`, verified by 4 dedicated tests |
| Selection (single) | Works | `selectedSubtitleId` |
| Multi-selection | **Does not exist** | No array/Set selection state found anywhere |
| Scrolling during large timelines | Native, no issue found | — |
| Current-time / duration display | `mm:ss.cc` (10ms resolution) | `formatTime`, `src/lib/utils.ts` |
| Precision | Continuous float-seconds for mouse; exact `1/fps` for the one frame-accurate keyboard nudge (Alt+←/→) | — |
| Large timelines (30s–30min+ projects) | Caption-list virtualization proven to 5,400 (unit-tested); timeline-canvas virtualization proven to 5,400 only by prior manual QA, no dedicated test | §2.6 |
| Keyboard interaction | Split/merge/duplicate/delete/nudge all have shortcuts; zoom and pan do not | §7 |

---

## 5. Caption Editing Audit

| Operation | Status | Why |
|---|---|---|
| Edit caption text | **Already works well** | Inline textarea, commits on blur/Enter, Tab/Shift+Tab moves between captions while editing, output-mode-aware (edits the right derived field) |
| Split caption | **Already works well** | Always at playhead (word-boundary-aware via `computeSplitWordIndex`), word timestamps provably untouched (test-verified), style/animation propagated to both halves |
| Merge captions | **Already works well** | Concatenates word arrays untouched; a prior bug where style/animation was silently dropped is fixed and regression-tested (`editor-store-undo-redo.test.ts` test 6b) |
| Duplicate caption | **Already works well** | Undoable, words shifted correctly into the new caption's bounds |
| Delete caption | **Works but needs UX improvement** | No confirmation dialog anywhere in the codebase (confirmed by grep — `ConfirmDialog` exists as a component but is never wired to caption delete); mitigated by the shortcut's typing-guard and by undo, but a stray Delete/Backspace with a caption merely *selected* (not focused for text entry) deletes immediately |
| Restore/undo delete | **Already works well** | One `commit()` step, test-verified round-trip |
| Move caption (timing) | **Already works well** | Drag or nudge, structurally overlap-safe |
| Change start/end time | **Already works well** | Same mechanism as move |
| Nudge timing | **Already works well** | Alt+←/→, exact 1-frame precision |
| Resize timing | **Already works well** | Edge-drag, 0.1s minimum |
| Prevent accidental overlap | **Already works well** | Structural clamp, not a soft warning |
| Preserve word timestamps (on move/resize/duplicate/split/merge) | **Already works well** | All five operations verified by direct code read + tests to either shift words exactly with the caption or leave them untouched |
| **Preserve word timestamps (on text edit / find-replace)** | **Partially implemented — a real gap** | Only preserved when word COUNT is unchanged; otherwise silently replaced with evenly-spaced synthetic timestamps, with zero UI indication this happened |
| Split at word | **Already works well** (indirectly) | Split is always at the playhead, which resolves to the nearest word boundary — there's no separate "click this word to split here" affordance, but the existing playhead-based flow already achieves word-aware splitting |
| Select multiple captions | **Missing** | No selection-array state exists anywhere |
| Batch operations | **Missing** | Follows directly from no multi-select; the only "operate on everything" actions are whole-project ones (`findReplace(all:true)`, `applyAllSafeFixes`), not user-driven batch selection |
| Copy/paste captions (text/timing) | **Missing** | Only *style* has a clipboard (`lib/style-clipboard.ts`); no analogous mechanism for caption text or timing — the closest thing is `duplicateSubtitle`, which is not a copy-to-clipboard/paste-elsewhere primitive |
| Duplicate formatting / paste formatting | **Already works well** | This is exactly what the existing style clipboard (`copyStyle`/`pasteStyle`) already does |
| Jump between captions | **Already works well** | ↑/↓, J/K/L, Tab/Shift+Tab while editing |
| Jump to next/previous issue | **Works but needs UX improvement** | Exists, but *only* inside the Quality panel dialog — no such control in the caption list or timeline toolbar, so the user must open a modal first |

---

## 6. Word-Level Editing Audit

This is the audit's most consequential finding, so it is detailed here rather than only in the table above.

**What exists:**
- A `Word` type (`{ text, start, end, confidence?, removed?, style? }`) with real per-word timestamps from transcription.
- A word-level **style** override: in the Style panel, under "This caption" scope, a "Word overrides" section renders one chip per word; clicking a chip lets the user set that word's color, font size, and background color, with a "Clear override" action. This selection is local component state, entirely decoupled from the timeline/waveform/caption list (selecting a word here does not highlight it anywhere else).
- Word timestamps are correctly *preserved* (not edited) through split, merge, duplicate, and whole-caption move/resize — verified by direct code reads and existing tests.
- The quality analyzer does check for structurally invalid word timestamps (end-before-start, out-of-caption-bounds, exact-duplicate-word) and surfaces them as generic error rows in the Quality dialog — but only navigates to the *caption*, not the specific word, and only the exact-duplicate case is auto-fixable.

**What does not exist — confirmed by exhaustive search, not inference:**
1. **No visual indication of word boundaries anywhere** — not on the timeline (caption blocks render as one solid rectangle each, no internal word subdivisions), not on the waveform (amplitude bars only, no `words` prop even passed in), not in the caption list (only the whole caption's start/end timestamp is shown).
2. **No action to edit a word's own `start`/`end`** — `setWordStyleOverride` is the only word-targeted store action, and it only ever patches `.style`. No `setWordTiming`/`nudgeWordTiming`/equivalent exists in the `EditorState` interface or its implementation.
3. **The app's own marketing page claims this capability exists** (`src/components/landing/faq.tsx:9`: "...adjust word-level timing") — this is not backed by any code path found in `src/`. This is a real product-claim/implementation mismatch, independent of whether P7 chooses to close the gap.
4. **`confidence` is captured from transcription but never consumed** by any UI component or the quality analyzer — no "suspicious/low-confidence word" surfacing exists, despite the data being available. VEED (verified in §8) explicitly ships exactly this as a "low-confidence word" flag.
5. **No word-by-word follow indicator in the caption list during playback** — the only word-by-word highlight in the codebase is the video-canvas overlay (`subtitle-overlay.tsx`), which previews the exported/burned-in look, not an editing aid for spotting timing problems while scrolling the caption list.

**Smallest meaningful change (per this task's own instruction not to propose a rewrite):**
A full "drag a word's boundary on the waveform" editor (à la Descript's wordbar) would be a substantial new interaction surface — new hit-testing, new drag state, new rendering, new clamping rules against both the parent caption's bounds and neighboring words. That is a real, multi-week feature, not appropriate for a 5–7-item P7.

The smallest viable step that still delivers real value: **extend the existing word-chip selection UI** (already built, in `style-panel.tsx`'s Word overrides section) with two small numeric nudge controls for the selected word's start/end, clamped to (a) stay within the parent caption's own `[start, end]` and (b) not cross the adjacent word's boundary — reusing the exact clamping *pattern* `updateSubtitleTiming` already established for captions, applied one level down. This adds a real capability without touching the timeline/waveform rendering at all, and closes the marketing/implementation gap for the "adjust word-level timing" claim.

---

## 7. Keyboard Workflow Audit

All shortcuts are registered through one global `keydown` listener (`src/hooks/use-keyboard-shortcuts.ts`), invoked once from `editor-shell.tsx`.

| Action | Shortcut | Works? | Context guard | Notes |
|---|---|---|---|---|
| Save | Ctrl/Cmd+S | Yes (no-op, autosave handles it) | **None** (deliberate — doesn't mutate) | |
| Search | Ctrl/Cmd+F | Yes | **None** (deliberate) | Can stack a second dialog on an already-open one — minor gap |
| Deselect | Escape | Yes | Checks `isAnyDialogOpen` only, not typing-target (intentional — should blur while typing) | |
| Next/prev caption while editing | Tab / Shift+Tab | Yes | Self-scoped to `[data-sub-id]` textareas | |
| Undo | Ctrl/Cmd+Z | Yes | Both guards | |
| Redo | Ctrl/Cmd+Shift+Z | Yes | Both guards | |
| Split at playhead | Ctrl/Cmd+Shift+S | Yes | Both guards | |
| Merge with next | Ctrl/Cmd+Shift+M | Yes | Both guards | No-ops silently on the last caption (button isn't disabled for this case either) |
| Duplicate | Ctrl/Cmd+D | Yes | Both guards | |
| Frame nudge | Alt+←/→ | Yes | Both guards | Exact `1/fps` precision |
| Select prev/next caption | ↑ / ↓ | Yes | Both guards | |
| Play/pause | Space | Yes | Both guards | |
| Seek ±1s / ±5s | ← / → (Shift) | Yes | Both guards | |
| Delete caption | Delete / Backspace | Yes | Both guards | No confirmation (see §5) |
| Focus caption text | Enter | Yes | Both guards | |
| Pause | K | Yes | Both guards | |
| Prev caption / -5s | J | Yes | Both guards | |
| Play / next caption | L | Yes | Both guards | |
| Zoom in/out | *(none)* | Mouse-only | N/A | No keyboard binding exists |
| Timeline pan | *(none)* | Mouse-only | N/A | No keyboard binding exists |

**"Both guards"** = `isTypingTarget(e.target)` (blocks while focus is in an INPUT/TEXTAREA/contentEditable) **and** `isAnyDialogOpen()` (blocks while any Radix dialog, `role="dialog"`, is open). This guard combination is documented in-code as the direct fix for a previously real bug: Ctrl+Z or Split firing while mid-edit in a caption's textarea could silently corrupt a *different* caption or discard just-typed text with no warning. **This guard logic must not be weakened or bypassed by any P7 work.**

**Discoverability**: zero in-app shortcut reference exists. Roughly 10 of the 19 global shortcuts (Escape, Tab-nav, Alt+frame-nudge, ↑/↓, Space, ←/→ seek, J/K/L) have no tooltip anywhere — a first-time user cannot discover them without reading source or trial-and-error. The other ~9 (split/merge/duplicate/delete/undo/redo/search) do have tooltips on their corresponding toolbar buttons.

---

## 8. Competitor Workflow References

Per this task's explicit instruction, every claim below was verified via live web search with sources, not asserted from memory. A. = existing SUBLY behavior (cited above, not repeated). B. = verified competitor behavior. C. = a potential direction — not a commitment, and separate from the final P7 recommendation in §12.

### Timeline interaction / snapping
**B.** Subtitle Edit: caption edges can be dragged against a waveform/spectrogram, and "subtitle edges snap to nearby shot changes automatically (configurable snap distance)." [Subtitle Edit — Main Window](https://subtitleedit.github.io/subtitleedit/features/main-window.html)
**B.** DaVinci Resolve: pressing `N` toggles snapping generally on the timeline; `G`/`H` snap-jump to the start/end of a clip (including subtitle clips). [DaVinci Resolve Keyboard Shortcuts Guide](https://davinciresolveclub.com/davinci-resolve-keyboard-shortcuts-guide/)
**B.** Premiere Pro: captions support "Roll Trim" (adjusts one caption's edge only) and "Ripple Trim" (adjusts the edge and pushes all downstream captions) directly on the timeline, the same trim vocabulary used for ordinary clips. [Larry Jordan — Adobe Premiere Pro: New, Improved Captions](https://larryjordan.com/articles/adobe-premiere-pro-new-improved-captions/)
**C.** SUBLY has none of this — no snapping, no ripple/roll distinction. A snap-to-adjacent-caption-edge (and optionally playhead) behavior is the most directly comparable, smallest-scope improvement.

### Word-level timing editing
**B.** Descript: a dedicated "wordbar" lets a user click-and-drag an individual word's boundary above the waveform to retime it, or drag the word left/right to nudge — explicitly a per-word operation, distinct from whole-segment editing. [Descript — The wordbar](https://help.descript.com/hc/en-us/articles/10249346632717-The-wordbar)
**B.** CapCut: "You can adjust the display time (entry and exit) of each subtitle individually" and supports word-by-word caption display styles, though the search results describe subtitle-segment-level timing adjustment more clearly than true per-word retiming. [CapCut — How Do I Fix Inaccurate Auto-Captions](https://www.capcut.com/help/auto-captions-in-capcut)
**B.** VEED: auto-captions include "a low-confidence word feature that flags any words to double-check," plus click-and-drag timeline editing and explicit start/end timestamp fields per subtitle line. [VEED — Sync Subtitles with Video](https://www.veed.io/tools/add-subtitles/sync-subtitles)
**C.** SUBLY has real per-word data (including `confidence`, currently unused) but zero word-level timing UI. The VEED "low-confidence flag" pattern is a particularly close, low-effort-relative-to-value match given SUBLY already stores the exact field needed and simply never reads it.

### Caption/timeline selection & batch editing
**B.** Premiere Pro: community documentation confirms users can select and move multiple caption items together on the timeline once inserted (a workflow question explicitly asked and answered in Adobe's own community forum, confirming the capability exists as a real, if sometimes non-obvious, feature). [Adobe Community — move multiple caption items](https://community.adobe.com/questions-729/how-to-insert-caption-item-move-multiple-caption-items-premiere-pro-14-9-and-earlier-1338714)
**C.** SUBLY has no multi-select at all (verified absent — §4/§5). This is a real, verified gap relative to at least one major reference tool, though the implementation shape (which items, what operations) is undetermined and carries real architectural surface area (see §11).

### Keyboard-driven workflow
**B.** DaVinci Resolve: as of Resolve 20, there are **no dedicated built-in keyboard shortcuts for subtitle editing specifically** — adding/switching subtitles is mouse-driven by default, though users can bind their own custom shortcut for "Add Subtitle." [PixFlow — DaVinci Resolve Keyboard Shortcuts 2026](https://pixflow.net/blog/davinci-resolve-keyboard-shortcuts/)
**A./C.** By contrast, SUBLY already has **more** built-in caption-specific keyboard coverage (19 shortcuts, including split/merge/duplicate/nudge) than Resolve ships by default for subtitles. This is a genuine SUBLY strength worth explicitly protecting, not a gap — the improvement opportunity is purely discoverability (§7), not shortcut coverage itself.

### Review workflow / flagging issues
**B.** VEED's low-confidence-word flag (above) is the clearest verified precedent for "surface a timing/accuracy concern inline, not just in a separate report."
**C.** SUBLY's Quality dialog already does structural/readability issue surfacing well (grouped, navigable, one-click-fixable where safe) — the gap is narrower than "build a review workflow from scratch": it's specifically that issues aren't visible without opening a dialog, and confidence-based word flagging doesn't exist at all yet despite the data being present.

---

## 9. UX Friction List

### UX-01 — No word-boundary visualization anywhere
**Current behavior:** Captions render as one solid block on the timeline; the waveform shows amplitude only; the caption list shows only whole-caption timestamps.
**Why it matters:** A user cannot see where an individual word starts/ends without opening the Style panel's word-chip picker, which itself shows no timestamp.
**Evidence:** `timeline.tsx:404-443` (one div per caption, no word subdivision); `waveform.tsx` (no `words` prop accepted); `captions-panel.tsx:213-264` (`CaptionRow`, timestamp + textarea only).
**Potential direction:** See §6/§12.

### UX-02 — No timeline snapping
**Current behavior:** Dragging a caption's edge or body is pure continuous pixel math; the only thing that stops a drag at a neighbor is the overlap clamp, which has no visual snap indicator or configurable threshold.
**Why it matters:** Precise alignment to an adjacent caption's exact edge, or to the playhead, requires pixel-perfect mouse control today.
**Evidence:** No snap logic found in `timeline.tsx` or `edit-model.ts` (confirmed by full-file read).
**Potential direction:** See §12.

### UX-03 — No timeline auto-scroll during playback
**Current behavior:** The playhead moves via a CSS `left` update every frame; scroll position never follows it.
**Why it matters:** On a long project, playback can move the playhead off the visible timeline window with no way to see it without manually scrolling.
**Evidence:** The only scroll-into-view effect (`timeline.tsx:168-192`) is keyed on `[selectedId]` only, explicitly (per its own comment) to avoid an unwanted scroll on unrelated edits — `currentTime` is not in its dependency list.
**Potential direction:** See §12.

### UX-04 — Zoom does not preserve viewport/playhead position
**Current behavior:** Clicking Zoom In/Out changes `pxPerSec` with no compensating scroll adjustment.
**Why it matters:** Whatever time region was centered in the viewport visually jumps after a zoom click.
**Evidence:** `timeline.tsx:271-276` (zoom handlers, no `scrollLeft` write nearby).
**Potential direction:** See §12.

### UX-05 — Word-level timing editing doesn't exist, contradicting the app's own marketing
**Current behavior:** No UI or store action to change an individual word's start/end.
**Why it matters:** This is a named, expected stage in the task's own workflow diagram ("REVIEW WORD TIMING") and a claim the app's own FAQ makes to users.
**Evidence:** `src/components/landing/faq.tsx:9` vs. exhaustive search of `editor-store.ts`/`timeline.tsx`/`waveform.tsx`/`style-panel.tsx` finding no such action.
**Potential direction:** See §6/§12.

### UX-06 — No multi-select / batch caption operations
**Current behavior:** Every editing action targets exactly one caption at a time.
**Why it matters:** Bulk cleanup (e.g., deleting several junk captions, or applying a style change to a range) requires one-at-a-time repetition.
**Evidence:** No selection-array state found anywhere in `editor-store.ts`, `timeline.tsx`, or `captions-panel.tsx`.
**Potential direction:** Deferred — see §11/§13 for why this is higher-risk than a P7-sized change.

### UX-07 — No in-app keyboard shortcut reference
**Current behavior:** ~10 of 19 global shortcuts have zero UI discoverability (no tooltip, no help panel).
**Why it matters:** A capable, professional-leaning shortcut set is only useful if users can find it.
**Evidence:** `Glob **/*shortcut*` returns only the hook itself, no help-dialog component; tooltip inventory in §7.
**Potential direction:** See §12.

### UX-08 — Quality issues are invisible until a separate dialog is opened
**Current behavior:** No inline badge/indicator on a caption row or timeline block signals it has a quality issue; the only way to see issues is the Quality dialog, opened from the Settings tab (not the Captions tab).
**Why it matters:** A user reviewing/editing captions has no idea an issue exists on the row they're looking at.
**Evidence:** `captions-panel.tsx` (full read) renders only timestamp + textarea, nothing quality-related; `left-panel.tsx:227-229` puts the Quality button on the Settings tab.
**Potential direction:** Out of P7 scope as a full inline-badge system (touches captions-panel rendering broadly), but "jump to next issue" reachable without opening the dialog first is a smaller, related win — see §12.

### UX-09 — Text edits that change word count silently discard real word timestamps
**Current behavior:** `remapWordsToText` preserves exact per-word timestamps only when the edited text's token count matches the original; otherwise it falls back to evenly-spaced synthetic timestamps across the caption's original span, with no UI indication.
**Why it matters:** A routine typo fix that adds/removes a word (e.g., "don't" → "do not") silently degrades timing accuracy for that whole caption's karaoke highlighting and any future quality checks, without the editing user knowing.
**Evidence:** `editor-store.ts:692-702`, used by `updateSubtitleText`, `applyTextMap`, and `findReplace`.
**Potential direction:** See §12 (a non-blocking warning, not a behavior change).

### UX-10 — No caption/timing copy-paste (only style has one)
**Current behavior:** `lib/style-clipboard.ts` supports copy/paste of style+animation only; there's no equivalent for caption text or timing.
**Why it matters:** Reusing a caption's wording or timing pattern elsewhere requires manual retyping.
**Evidence:** No `copyText`/`copyTiming`/`pasteText`/`pasteTiming` action found anywhere in `editor-store.ts`.
**Potential direction:** Deferred — see §13.

### UX-11 — Merge button isn't disabled on the last caption
**Current behavior:** Clicking "Merge with next" on the final caption silently no-ops (no toast, no visual feedback).
**Why it matters:** Minor, but a click that does nothing with zero feedback is confusing.
**Evidence:** `timeline.tsx:231` disables the button only on `!selected`, not on "is last caption"; `editor-store.ts:490` no-ops internally.
**Potential direction:** Trivial fix, candidate for a future small-polish pass — not P7-worthy on its own.

### UX-12 — Ctrl+F can open Search & Replace on top of an already-open dialog
**Current behavior:** The Ctrl+F handler has no `isAnyDialogOpen` guard (deliberately, since it doesn't mutate data), so pressing it while, say, the Export dialog is open stacks a second dialog.
**Why it matters:** Minor visual/interaction confusion, no data risk.
**Evidence:** `use-keyboard-shortcuts.ts:52-56` (no guard, by design per the surrounding comment).
**Potential direction:** Trivial fix, not P7-worthy on its own.

---

## 10. Performance Findings

All numbers below are cited from either existing automated tests or `research/p2_editor_performance_scalability_report.md` (a prior first-party report, treated as evidence, not as instructions). No new profiling was performed in this audit-only task beyond reading existing test assertions.

- **Caption list virtualization**: proven correct and fast at 5,400 captions — 374ms mount time post-virtualization vs. 1,572ms pre-virtualization, DOM rows capped at ~17 regardless of total count. This is solid, tested, and should not be touched.
- **Timeline canvas virtualization**: same 5,400-caption scale claimed correct, but only via manual QA in the prior report, not a dedicated automated test of `timeline.tsx`'s own `visibleSubtitles` filter. **If P7 touches the timeline's rendering at all** (e.g., for snapping or word-boundary display), this is the one area that should get a real automated test first, since none currently exists (see §11).
- **Drag-gesture responsiveness degrades at scale**: ~5.9ms/pointermove-step at 3,600 captions vs. ~12–15ms/step at 5,400 captions, per the same report's synthetic gesture benchmark. This is measured evidence, not a confirmed complaint — it indicates a ceiling worth being aware of if P7 adds computation to the drag path (e.g., snap-target lookup on every pointermove), not a currently-broken experience.
- **Waveform rendering**: bounded by screen width, not by total audio length or zoom level, by design (one canvas column per device pixel in the visible window). No performance concern found.
- No evidence of unnecessary re-renders, DOM growth beyond the ~17-row virtualized cap, or playback-sync issues was found in the files read for this audit — but this audit did not run a live profiler session against the actual app; it is based on code structure and existing test/report evidence only, consistent with this task's "audit only" instruction.

---

## 11. Regression Risks (systems most likely to regress if P7 touches the editor/timeline)

| System | Risk if touched carelessly | Why | Recommended pre-P7 test to have |
|---|---|---|---|
| Overlap-prevention clamp (`updateSubtitleTiming`) | High | Any snapping feature must layer on top of this clamp, never replace or bypass it — it's the one thing structurally guaranteeing no two captions overlap | Existing tests (3b/3c/3d) already cover this — re-run, don't modify |
| Word timestamp preservation (split/merge/move/resize/duplicate) | High | These are all currently provably correct (tested); a word-timing-nudge feature must not change how these five operations already preserve timestamps | Existing split/merge/timing tests — re-run as a regression gate before/after any P7 change |
| Keyboard shortcut guards (`isTypingTarget`/`isAnyDialogOpen`) | High | This guard combination fixed a real prior data-corruption bug; any new shortcut (e.g., a shortcuts-help-dialog trigger, or a zoom shortcut) must go through the same guard placement | No dedicated automated test currently exists for the guard logic itself — worth adding one before P7 introduces new shortcuts |
| Caption list virtualization (`list-virtualization.ts`) | Medium | Solid and tested; only at risk if P7's UI changes (e.g., inline quality badges) change `ROW_HEIGHT_ESTIMATE` assumptions | Existing 12-test suite — re-run |
| Timeline canvas virtualization (`visibleSubtitles` filter) | Medium-High | **No dedicated automated test exists today** — this is the one virtualization mechanism P7 could regress without any existing test catching it | Write a focused test for `visibleSubtitles`-equivalent logic before touching timeline rendering |
| Undo/redo (`commit`/`past`/`future`) | Medium | Any new mutating action (e.g., word-timing nudge) must route through `commit()` like everything else, not invent a parallel history mechanism | Existing undo-redo suite — extend with one test per new action, don't restructure the mechanism |
| Autosave (`dirty` flag propagation) | Medium | A new mutating action must correctly mark `dirty`; a new UI element (e.g., a shortcuts dialog) must not accidentally mark `dirty` when it shouldn't | Existing save-queue/autosave tests — re-run |
| Waveform rendering | Low | Only at risk if word-boundary visualization is drawn onto the same canvas rather than as a separate overlay layer (the existing pattern already separates waveform-bars from playhead/trim/selection overlays — follow that pattern) | Existing waveform test suite — re-run |
| Style/animation overrides & custom presets | Low | Explicitly out of P7 scope per this task's own instructions; not touched by anything in this audit's recommendations | N/A |
| Export parity | Low | Nothing in this audit's recommendations touches `ass.ts` or the export pipeline | N/A |
| Project recovery / stale-job-recovery | Low | Not touched by anything recommended here | N/A |
| Packaged Windows behavior | Low-Medium | Any new dialog (shortcuts help) or timeline interaction should be smoke-tested in the packaged app per this project's established QA pattern, but no packaged-app-specific risk was identified | Standard packaged-app QA pass, as done for prior tasks |

---

## 12. Recommended P7 Scope

Grouped per this task's required structure (no numerical scoring):

### CRITICAL WORKFLOW GAPS
- **Word-level timing editing does not exist**, despite being an expected workflow stage and a marketing claim. (§6)
- **No timeline snapping** — absent in a tool whose closest reference competitors (Subtitle Edit, Premiere, Resolve) all have it. (§4, §8)
- **No multi-select/batch caption operations** — a real, verified gap, but see §11 for why this is recommended as *deferred* rather than *in-scope*: it touches selection-state architecture broadly (timeline, caption list, and every single-caption action in the store), with no existing test scaffolding for a multi-select model, making it a poor fit for a tightly-scoped P7.

### HIGH-VALUE IMPROVEMENTS
- Timeline auto-scroll to follow the playhead during playback. (§4, UX-03)
- Zoom that preserves the viewport/playhead position. (§4, UX-04)
- In-app keyboard shortcuts reference/discoverability. (§7, UX-07)
- "Jump to next/previous quality issue" reachable without first opening the Quality dialog. (§5, UX-08)
- A non-blocking warning when a text edit's word-count change causes word timestamps to be re-synthesized. (§9, UX-09)

### NICE-TO-HAVE
- Resizable editor panels.
- Copy/paste of caption text/timing (distinct from the existing style clipboard).
- Regex support and live match count/highlighting in Search & Replace.
- Distinct crash-vs-ordinary-error recovery messaging.
- Fixing the two trivial UX-11/UX-12 no-feedback edge cases.

### DO NOT BUILD YET
- A full word-boundary drag-editing UI on the waveform/timeline (Descript-style wordbar) — real value, but a multi-week feature, not a P7-sized item. The scoped alternative (numeric nudge on the existing word-chip UI) is recommended instead.
- Multi-select/batch operations (see CRITICAL GAPS above for the reasoning).
- A React error boundary / app-wide error-handling redesign — a real gap (§2.3) but an availability/robustness concern, not a caption-editing-workflow item; better suited to its own dedicated task.
- Confirmation dialogs for destructive caption actions — undo already provides a safety net, and no evidence of repeated real-world accidental loss was found; not worth the added friction without stronger justification.

---

## 13. Deferred Features (explicit list)

- Multi-select / batch caption operations (bulk delete, bulk style apply, bulk timing shift)
- Full word-boundary drag-and-retime UI on the waveform/timeline
- Resizable editor panels
- Caption text/timing copy-paste (a second clipboard alongside the existing style clipboard)
- Regex + live match count/highlight in Search & Replace
- Distinct crash-vs-error recovery messaging
- React error boundary / app-wide error-handling improvements
- Confirmation dialogs for delete/merge/split/duplicate
- Trivial no-feedback fixes (merge-on-last-caption, Ctrl+F dialog-stacking) — low priority, can ride along with any future polish pass but don't need their own P7 slot

## 14. Do-Not-Touch Areas (explicit, per this task's own instructions and audit findings)

- Whisper / transcription pipeline
- Language policy (English/Hindi/Auto Detect)
- Segmentation (`segment.ts`, `split.ts`'s core algorithm — only the UI around it, if anything, per §12)
- Waveform **generation** (`lib/audio/waveform.ts`) — real, well-tested; only its *rendering/overlay* layer is a candidate for word-boundary visualization, and only additively (new overlay elements, same pattern the playhead/trim/selection overlays already use)
- Project recovery / stale-job-recovery
- SQLite schema/architecture
- Electron startup / single-instance behavior
- Installer architecture
- FFmpeg architecture / export pipeline
- Caption rendering / ASS renderer (`lib/subtitles/ass.ts`)
- Existing caption style system (45 built-in presets, Style/Animation panels)
- Custom preset system (save/rename/duplicate/delete, persistence)
- The overlap-prevention clamp formula in `updateSubtitleTiming` — P7 must build ON TOP of this, never replace it
- The `isTypingTarget`/`isAnyDialogOpen` keyboard-shortcut guard combination — fixed a real prior bug, must not be weakened
- Undo/redo's core `commit`/`past`/`future` mechanism — extend via new `commit()` calls, don't redesign
- Autosave's debounce/retry/local-snapshot mechanism
- Caption list virtualization (`list-virtualization.ts`) — proven correct, no changes needed

---

### RECOMMENDED P7

1. Timeline snapping for caption edges (and optionally the playhead) while dragging or resizing — layered on top of the existing overlap-prevention clamp, not a replacement for it.
2. Timeline auto-scroll to follow the playhead during playback.
3. Zoom in/out that preserves the time under the viewport center (or under the playhead) instead of visually jumping.
4. Word-boundary visualization plus a minimal, bounded word-timing nudge control on the existing word-chip selection UI (Style panel → Word overrides) — clamped to the parent caption's bounds and neighboring words, using the same clamping pattern `updateSubtitleTiming` already established.
5. An in-app keyboard shortcuts reference dialog (discoverability for the ~10 currently-undocumented shortcuts).
6. "Jump to next/previous quality issue" reachable directly from the caption list or timeline toolbar, without first opening the Quality dialog.
7. A non-blocking warning surfaced when a text edit's word-count change causes that caption's word timestamps to be re-synthesized (evenly-spaced) instead of preserved exactly.

### DEFERRED

- Multi-select / batch caption operations
- Full word-boundary drag-and-retime UI (Descript-style wordbar)
- Resizable editor panels
- Caption text/timing copy-paste (separate from the existing style clipboard)
- Regex + live match count/highlight in Search & Replace
- Distinct crash-vs-ordinary-error recovery messaging
- React error boundary / app-wide error-handling redesign
- Confirmation dialogs for destructive caption actions
- Trivial no-feedback polish (merge-on-last-caption, Ctrl+F dialog-stacking)

### DO NOT TOUCH

- Whisper / transcription, language policy, segmentation core algorithm
- Waveform generation (`lib/audio/waveform.ts`)
- Project recovery / stale-job-recovery
- SQLite architecture, Electron startup, installer architecture, FFmpeg / export pipeline
- Caption rendering / ASS renderer, existing caption style system, custom preset system
- The overlap-prevention clamp in `updateSubtitleTiming`, the keyboard-shortcut typing/dialog guards, undo/redo's core mechanism, autosave's debounce/retry/local-snapshot mechanism, and caption list virtualization
