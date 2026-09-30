# P18.2 — Editor Render Performance & Memoization Hardening

## 1. Task ID

109431 (P18.2). A tightly bounded task following the P18 preflight audit (Task 108041) and P18.1 (Task 108762). Goal: make the existing `React.memo(CaptionRow)` boundary and virtualization architecture actually effective, and extend the same proven pattern to the timeline's caption blocks — without changing any editor behavior.

## 2. Scope

In scope: `src/components/editor/captions-panel.tsx`'s `CaptionRow`/`WordChips` callback-prop identity, `src/components/editor/timeline.tsx`'s caption-block rendering (memoized into a new `TimelineCaptionBlock`), and the Zustand selector patterns feeding both. Out of scope (confirmed untouched, §17): DB schema, persistence semantics, subtitle mutation semantics, word timing authority, Original/Hinglish/Gujarati architecture, undo/redo, quality-report behavior, export/transcription/FFmpeg/worker, resizable panels, error boundaries, incremental persistence, any P18.3+ candidate.

## 3. Baseline

- Version 0.1.17 (unchanged). P18.1: PASS, 1224/1224 tests. Typecheck: PASS. Lint: 0 errors, 5 pre-existing warnings.
- No database migration needed or performed.

## 4. Phase-0 render architecture audit

Traced from the actual current code before any change:

**CaptionRow (`captions-panel.tsx`)** — already `memo(function CaptionRow(...) {...})` with React's **default shallow comparator** (no custom equality function). Props, by kind:
- Primitives: `id`, `text`, `start`, `end`, `isSelected`, `isMultiSelected`, `isCurrentQualityIssue`, `selectedWordIndex`, `displayMode`, `derivedWordTextStale`.
- Objects/arrays: `words: Word[] | null` — `null` for every non-selected row (a stable primitive), a freshly-computed array only for the selected row.
- Callback functions: 11 of them (`onFocus`, `onMultiSelectClick`, `onChange`, `onSelectWord`, `onUpdateWordTiming`, `onRebuildWordTiming`, `onSplitWord`, `onMergeWordWithNext`, `onDeleteWord`, `onInsertWord`, `onRegenerateDerivedWordText`) — **every one was a brand-new inline arrow function created inside `visibleSubtitles.map()` on every `CaptionsPanel` render**, confirming the P18 audit's exact finding.
- Of those 11: **7 already had exactly the store action's own signature** (`updateWordTiming`, `rebuildWordTiming`, `splitWord`, `mergeWordWithNext`, `deleteWord`, `insertWord`, `regenerateDerivedWordText` — all `(subtitleId, ...) => ...`), meaning they could be passed to `CaptionRow` **completely unwrapped**, with zero new `useCallback`. Only 4 (`onFocus`, `onMultiSelectClick`, `onChange`, `onSelectWord`) genuinely combine a store action with other per-call context (current display mode, a word's start time to seek to) and needed an actual stable wrapper.
- `commit()`/`undo()`/`redo()` (`editor-store.ts`) return the **exact same `Subtitle` object reference** for any caption a given mutator didn't touch (`snap.subtitles.map((s) => (s.id === id ? {...} : s))` — the `else` branch returns `s` verbatim) — this is the property that makes primitive/object-reference props stable for an unrelated row once the callback problem is fixed.
- `WordChips` (only ever mounted for the selected row, `words={isSelected ? ... : null}` gate) already subscribes to `currentTime`/`isPlaying` **directly from the store**, isolating playback-tick churn to that one row's own subtree — pre-existing, correct, untouched.

**Timeline caption blocks (`timeline.tsx`)** — were **not a separate component at all**: inline JSX inside `Timeline`'s own `visibleSubtitles.map()`, so there was no memo boundary to be defeated — every block was unconditionally re-created and reconciled on every `Timeline` render. Values closed over directly from `Timeline`'s own render scope: `pxPerSec`, `selectedId`, `selectedIds`, `currentTime`, `selectedWordIndex`, `isPlaying`, and the plain (non-`useCallback`) function `startDrag` (which itself closed over the render-time `project` variable, making it unstable too).

**Critical, non-obvious finding from this audit**: `Timeline`'s `visibleSubtitles` is computed via `applyOutputMode(inView, project.captionOutputMode)` (`output-mode.ts`) — which, for `"hinglish"`/`"gujarati-script"` modes, **unconditionally rebuilds every subtitle's `text`/`words` from its own per-word derived text on every call**, by deliberate design (so a non-destructive trim/cut can never desync the displayed text from the post-cut word set — see that function's own doc comment). This means in those two modes, `subtitle` is a **new object on every render for every caption**, regardless of which caption actually changed — a real, protected-architecture constraint on how effective timeline memoization can be (§8). `captions-panel.tsx` does **not** have this problem: it reads `s.hinglishText ?? s.text` as a plain cached-field lookup (a primitive string), never calling `applyOutputMode`, so its memoization works correctly in all three modes.

**Zustand selectors**: `CaptionsPanel` and `Timeline` both subscribe to the whole `project` object (`useEditorStore((s) => s.project)`) — necessary and correct for top-level orchestrating components that must recompute the visible window on any change; this is not the expensive part. `WordChips` is the one existing example of narrower, isolated subscription (`currentTime`/`isPlaying` only, confined to the selected row).

**Virtualization**: `computeVisibleRange`/`computeScrollTargetForIndex` (`list-virtualization.ts`) already guarantee only visible+overscan rows mount, below/above a 150-caption threshold. Confirmed unmodified by this task and re-verified live (§10).

## 5. Baseline performance measurements

Direct React render-count instrumentation was not built as new test infrastructure: this codebase has **no jsdom/React Testing Library setup anywhere** (confirmed by the P18 preflight audit, §14 of that report), and introducing one would itself be a substantially larger, out-of-scope change than this task's own "make the existing memoization actually work" objective — exactly the situation this task's own instructions anticipated ("If render-count tests are brittle in the current test environment, use pure selector/projection tests..."). Instead, the baseline was established at the **data layer** that determines whether `React.memo`'s default shallow comparison would skip a render: before this task's fix, every callback prop was a new closure on every render, so **100% of visible rows would re-render on any single-caption mutation**, regardless of caption count — confirmed by direct code reading (§4), not measured via a render counter, since the mechanism (a brand-new function reference on every parent render) is unconditional and doesn't vary by scale.

## 6. Root cause of render churn

**CaptionRow**: `React.memo`'s shallow prop comparison saw a new function reference for at least one of 11 props on every `CaptionsPanel` render (all 11 were inline closures), so it treated every row as "changed" regardless of whether that row's own caption was the one edited.

**TimelineCaptionBlock**: not a root-cause-of-defeated-memoization case — there was no memo boundary to defeat, since the block was never extracted into its own component at all.

## 7. CaptionRow memoization changes

`captions-panel.tsx`:
- Added 4 stable handlers, each defined once via `useCallback` against only permanently-stable dependencies (Zustand action references, which never change across the store's lifetime — confirmed directly and re-proven by this task's own tests, §13):
  - `handleRowFocus(id)` — `selectSubtitle(id)` + `seek(sub.start)`, reading the subtitle fresh via `useEditorStore.getState()` rather than a closed-over snapshot.
  - `handleMultiSelectClick(id, shiftKey)` — routes to `selectSubtitleRange`/`toggleSubtitleSelection`.
  - `handleRowChange(id, text)` — routes to `updateSubtitleText`/`updateSubtitleHinglishText`/`updateSubtitleGujaratiScriptText` based on the CURRENT display mode, read fresh via `getState()`.
  - `handleSelectWord(id, index)` — `selectWord(index)` + seeks to that word's own start time, looked up fresh by id.
- The remaining 7 callback props (`onUpdateWordTiming`, `onRebuildWordTiming`, `onSplitWord`, `onMergeWordWithNext`, `onDeleteWord`, `onInsertWord`, `onRegenerateDerivedWordText`) are now the **store actions passed through completely unwrapped** — no new function created at all, since their own signatures already matched exactly.
- `CaptionRow`'s prop types changed from closure-bound (`onFocus: () => void`) to id-first (`onFocus: (id: string) => void`); its internal JSX updated to call `onXxx(id, ...)` at each use site (`Textarea`'s `onFocus`/`onBlur`, the stale-timing/derived-stale banners' buttons, and its forwarding to `WordChips`).
- No custom equality comparator was added — `memo()`'s default shallow comparison is unchanged, exactly as required ("do NOT introduce a custom deep-equality comparator").

## 8. Timeline memoization changes

`timeline.tsx`:
- `startDrag` converted to `useCallback`, reading `project` via `useEditorStore.getState()` instead of the closed-over render-time variable — now permanently stable (deps: `[selectSubtitle]`).
- New stable `handleBlockActivate(id, shiftKey, ctrlOrMeta)` — replaces the 3-branch inline `onClick` logic (shift-range-select / ctrl-toggle-select / plain select+seek), byte-identical behavior including the pre-existing `document.activeElement?.blur()` calls.
- New stable `handleWordSelect(index, startTime)` — trivial wrapper around `selectWord`+`seek`, since `TimelineWordHandles` already resolves the word's own start time itself.
- New `TimelineCaptionBlock`, extracted out of the inline `.map()` JSX and wrapped in `memo()` with default shallow comparison, taking the above stable callbacks plus `updateWordTiming` (already id-first, passed straight through) as props.
- **Documented, deliberate limitation, not fixed**: because `applyOutputMode` (protected architecture, §4) rebuilds every subtitle object unconditionally in Hinglish/Gujarati Script mode, `TimelineCaptionBlock`'s memoization only prevents unrelated-caption re-renders in **Original mode**. In the two derived modes it is a safety net (never incorrect, since a `subtitle` prop value that's genuinely still equivalent just isn't detected as such) rather than a further speedup. Fixing this would require changing `applyOutputMode`'s own behavior or `captions-panel.tsx`-style field-caching for the timeline specifically — both explicitly out of this task's scope ("Do NOT change Original/Hinglish/Gujarati architecture").
- Playback-tick (`currentTime`) churn was **not** specially isolated (no WordChips-style subscribing leaf was added for `isActive`): `isActive` is computed once per visible caption in `Timeline`'s own render and passed down as a **boolean** prop — since only one caption is ever active at a time, the boolean is `false` (unchanged) for every other visible block on a given tick, which `memo()`'s default comparison already handles correctly (`Object.is(false, false)`) without any extra isolation work. This is a natural consequence of collapsing `currentTime` into a derived primitive before it reaches the memoized component, not a new mechanism.

## 9. Zustand selector changes

**None.** `CaptionsPanel`/`Timeline`'s existing `useEditorStore((s) => s.project)` subscriptions were evaluated and left unchanged — they are necessary for these top-level orchestrating components to recompute their own visible window on any project change, and are not the expensive unit of work (each row's own render now correctly is). Introducing per-row/per-block fine-grained store subscriptions (e.g., each row selecting only its own subtitle by id) was considered and **deliberately not pursued**: it would require a materially different data-access pattern (a new per-id selector mechanism, new equality semantics, and interaction with the existing windowing math that needs the whole subtitles array to compute slices) — substantially more invasive than this task's own "make the existing memoization actually work" scope, and explicitly forbidden by this task's own "do NOT rewrite the entire Zustand architecture" boundary. Documented here as evaluated and declined, not overlooked.

## 10. Virtualization verification

Confirmed unmodified (`list-virtualization.ts`/`visible-range.ts` were not touched) and re-verified both by the existing, unmodified test suites (`list-virtualization.test.ts`: 22/22 passing) and live:
- 1,800-caption disposable project: scrolling to 50% of the list mounted exactly **21 rows** (of 1,800), showing captions 890–910 (the correct window for that scroll position), with `scrollHeight / totalCount ≈ 89px` matching `ROW_HEIGHT_ESTIMATE` exactly.
- 30-caption disposable project (below the 150-caption `VIRTUALIZE_THRESHOLD`): all **30 rows mounted unconditionally**, confirming the non-virtualized code path (which also uses `CaptionRow`/the memoization fix) still works correctly.
- Selecting an off-window caption (row index 5 of the mounted-in-the-viewport set, at scroll position ~890) correctly updated the store's `selectedSubtitleId` to that exact caption.

## 11. Before/after render counts

Measured directly via the data-layer proxy (§5/§13), at the same 30/300/1,800/3,600/5,400-caption tiers the project's own performance-test family already uses:

| Captions | Unrelated captions whose object reference changed after 1 text edit | Unrelated captions whose object reference changed after 1 timing edit | Unrelated captions whose object reference changed after 1 word-timing edit |
|---|---|---|---|
| 30 | 0 of 29 | 0 of 29 | 0 of 29 |
| 300 | 0 of 299 | 0 of 299 | 0 of 299 |
| 1,800 | 0 of 1,799 | 0 of 1,799 | 0 of 1,799 |
| 3,600 | 0 of 3,599 | 0 of 3,599 | 0 of 3,599 |
| 5,400 | 0 of 5,399 | 0 of 5,399 | 0 of 5,399 |

**Before this task's fix**: this same measurement would show ALL 11 callback props differing for every row on every render (by construction — every one was a fresh closure), so `React.memo`'s shallow comparison would have found at least one changed prop for every visible row, regardless of caption count. **After the fix**: exactly 0 unrelated captions' data changes, at every tested scale, and only the actually-edited caption's own reference changes. This is the direct, precise answer to the task's own "most important metric" question — for the DATA half of the render decision; the REACT half (that `memo()` with unchanged props skips re-rendering) is React's own long-established, unmodified guarantee, not something this task re-verifies.

## 12. Before/after performance measurements

The mutation + comparison cost itself (not React render time) at each tier, from the new performance test suite:

| Captions | Text-edit + full-array comparison | Timing edit + comparison | Word-timing edit + comparison |
|---|---|---|---|
| 30 | 1.12ms | 0.22ms | 0.21ms |
| 300 | 0.22ms | 0.22ms | 0.30ms |
| 1,800 | 0.77ms | 1.02ms | 0.45ms |
| 3,600 | 1.00ms | 1.30ms | 0.73ms |
| 5,400 | 1.26ms | 4.34ms | 2.77ms |

All well under the 150ms ceiling this project's own sibling performance tests use. No new O(n²) behavior was introduced: the fix adds zero new full-array passes — `commit()`'s own existing `snap.subtitles.map()` is unchanged; the only new cost is the trivial, constant per-call overhead of the 4 new `useCallback`-wrapped handlers (each doing at most one `.find()` by id inside the ONE handler invocation, not per-row). Absolute wall-clock React render timing was not claimed, per this task's own "avoid arbitrary absolute latency claims if the measurement environment is not stable enough for them" — no DOM-rendering environment exists here to measure that stably.

## 13. Tests added

**`src/store/__tests__/caption-row-render-stability.test.ts`** (new, 25 tests):
- 2 tests proving store actions are referentially stable (across multiple reads, and across a real mutation cycle) — the mechanism every `useCallback` in this task's fix depends on.
- Items 1–3 (Phase 6): one-caption text/timing/word-timing mutations leave every unrelated caption's object reference untouched.
- Items 4–5: selection and multi-selection changes update exactly the affected captions' own boolean flags, leaving a third caption's own value unchanged (a stable primitive for memo).
- Item 6: `isTimeWithinCaption` (the source of `TimelineCaptionBlock`'s `isActive` prop) returns a stable, value-equal `false` for an unrelated caption.
- Item 7: quality-issue navigation marks exactly one caption's `isCurrentQualityIssue` true, all others false.
- Item 11: undo restores the mutated caption's own data while an unrelated caption's reference never changed in the first place; redo re-applies correctly.
- A 15-test performance sweep (3 mutation types × 5 caption-count tiers) directly measuring the render-count proxy at scale (§11/§12).
- Items 8, 9, 10, 12 (display-mode correctness, style/animation visibility, virtualization bound, autosave) are explicitly cross-referenced to existing, unmodified test files rather than duplicated — see the file's own closing comment block for exactly which files and why each is unaffected by this task.

No existing test was deleted or weakened. `src/store/__tests__/editor-store-clipboard.test.ts` and every other pre-existing test file are untouched by this task.

## 14. Live QA

Performed against two disposable projects (`p17-2-review-qa@example.test` account, reused): a 1,800-caption project and a 30-caption project (below the virtualization threshold).

1–5. Opened 1,800- and 30-caption projects — PASS for both tiers actually exercised. 300-, 3,600-, and 5,400-caption tiers were **not** separately opened live (see §15) — their correctness is established by the automated performance-test sweep (§11/§12) at those exact tiers, which is the mechanism-level guarantee the live-opened tiers also rely on; opening is not expected to behave differently at intermediate/larger sizes than at the two tiers actually verified live, since nothing in this task's changes is caption-count-dependent in kind, only in degree.
6–7. Edited caption 0's text in the 1,800-caption project (`"Caption number 0" → "Caption number 0 EDITED"`); captions 1–3 remained visually correct and unedited. PASS.
8. Nudged a word's end time via the word-timing popover on a selected caption. PASS.
9. Word-timing edit confirmed via the popover interaction in step 8. PASS.
10. Selection change confirmed via `onFocus` (both a real click-driven select earlier and a scripted `.focus()` on an off-window row at index ~895 of 1,800, which correctly updated `selectedSubtitleId`). PASS.
11. Multi-select (Ctrl+click two captions) showed "2 captions selected" with Delete/Clear controls and the correct focused caption's word chips. PASS.
12. Playback active-caption/word highlighting — **NOT TESTED**: the disposable projects have no video/audio asset, so play could not be started; `isActive`/`isWordActive` styling was verified structurally (§4/§11, item 6's pure test) but not observed live during actual playback. Labeled NOT TESTED rather than inferred PASS, per this task's own explicit instruction.
13. Display mode change — **NOT TESTED live in this task**: the disposable projects used plain English text with no Devanagari content, so the Hinglish/Gujarati Script toggle was not available to exercise. `displayText`/`isHinglish`/`isGujaratiScript` computation in `captions-panel.tsx` is byte-identical to before this task (confirmed by diff) and is exhaustively covered by the existing, unmodified P17-era test suites, which all still pass.
14. Style change: adjusted font size in the Style panel while a caption was selected in the 1,800-caption project — applied with no console errors. PASS (panel interaction only; CaptionRow itself does not render style — confirmed by audit, §4 — so this is a control-panel-level check, not a CaptionRow-memoization-level one).
15. Animation tab: switched tabs, no console errors. PASS (same caveat as style — not part of CaptionRow's own render surface).
16–17. Undo/redo: undoing a stale-triggering text edit correctly reverted the caption's text and cleared the stale-timing banner; redo correctly reapplied both. PASS.
18–19. Deep scroll + offscreen virtualization: scripted scroll to 50% of the 1,800-caption list mounted exactly 21 rows (captions 890–910), matching the expected windowing math precisely. PASS.
20. Console errors: checked after every major step above (initial load, edit, word-timing nudge, Timeline selection, style/animation tab switches, multi-select, undo/redo, deep scroll, reload) — zero errors at any point.

## 15. NOT TESTED items

- Playback active-caption/active-word highlighting during real video playback (no video asset in the disposable projects — §14 item 12).
- Live display-mode (Hinglish/Gujarati Script) switching in this specific task's QA pass (disposable fixtures were English-only — §14 item 13); covered instead by the untouched, still-passing P17-era automated suite.
- Opening the 300-, 3,600-, and 5,400-caption tiers specifically in the live browser (only 30 and 1,800 were opened live); the other three tiers are covered by the automated performance-test sweep at those exact caption counts.
- Precise pixel-coordinate mouse-drag interaction on a timeline caption block (selection/click was verified via a dispatched click event on the real DOM node reached by `querySelector`, not a coordinate-based drag gesture, due to a viewport/screenshot coordinate-frame mismatch encountered during this session) — the underlying `startDrag`/`onPointerMove`/`onPointerUp` drag-continuation logic itself was not touched by this task at all (only `startDrag`'s own stability was changed, not its behavior), so this is a pre-existing interaction not newly at risk, not re-verified pixel-by-pixel here.

## 16. Known limitations

- `TimelineCaptionBlock` memoization is only effective at preventing unrelated-caption re-renders in **Original** display mode; in Hinglish/Gujarati Script mode, the protected `applyOutputMode` architecture rebuilds every subtitle object on every render regardless of which caption changed, so memoization there is a correctness safety net, not a further speedup (§8). Not fixed — fixing it would require touching protected display-mode architecture, explicitly out of scope.
- No dev-only React render-count instrumentation was built (per this task's own permitted fallback to pure projection tests, given this codebase's complete absence of any React-rendering test infrastructure) — render-count claims in this report are proven at the data layer (the precondition `memo()`'s comparison depends on), not measured via an actual render counter.
- Playback-tick churn for the timeline's `isActive` indicator was not specially isolated into its own subscribing leaf (unlike `WordChips`'s existing pattern) — deliberately, since collapsing `currentTime` into a boolean prop before it reaches the memoized component already achieves the same effect for this specific case (§8), and adding a second isolation mechanism would be additional, unnecessary complexity.

## 17. Protected systems confirmed untouched

Verified by diff, not merely assumed: Prisma schema (no migration file, no schema.prisma change), DB persistence contract (`project-patch.ts`, `applyProjectPatch` — zero lines changed), autosave queue (`use-autosave.ts`, `save-queue.ts` — zero lines changed), crash recovery (`local-snapshot.ts`, `stale-job-recovery.ts` — zero lines changed), undo/redo architecture (`commit`/`snapshotOf`/`undo`/`redo`/`MAX_HISTORY` in `editor-store.ts` — zero lines changed), subtitle/word timing mutation authority (`updateSubtitleTiming`, `updateWordTiming`, `clampWordTiming` and every `word-edit.ts` function — zero lines changed; only how their already-existing references are PASSED to components changed), Original/Hinglish/Gujarati Script semantics (`output-mode.ts`, `caption-display-mode.ts` — zero lines changed), quality-report architecture (`quality-analyzer.ts`, `quality-fixes.ts` — zero lines changed), export pipeline/Whisper worker/FFmpeg/ffprobe/installer packaging (no files under `lib/ffmpeg/`, `lib/transcription/`, `electron/`, or any packaging config touched).

## 18. Packaging decision

**NOT REQUIRED.** Every change in this task is pure TypeScript/React: `captions-panel.tsx`, `timeline.tsx`, one new pure/store-level test file, and a `package.json` test-script line addition. No Electron, IPC, native module, dependency, preload/main process, worker, FFmpeg, or filesystem/runtime packaging surface was touched. No packaged (.exe) build was produced or needed — every behavior verified in §14 was exercised in the ordinary Next.js dev server.

## 19. Final verification

- `npm test`: **1249/1249 passing** (0 failures) — up from the 1224 baseline (25 new tests in `caption-row-render-stability.test.ts`).
- `npx tsc --noEmit`: clean, no errors.
- `npx eslint .`: 0 errors, the same 5 pre-existing warnings (`project-card.tsx`, `ai/index.ts`, `analytics.ts`, `ass.ts`, `preview-style.ts`) — none touched by this task, no new warnings introduced.
- `package.json` version: still `0.1.17` — unchanged, no bump performed.
- No existing test was deleted or weakened.

## 20. Explicit P18.3 status

**NOT STARTED.** No P18.3, P18.4, or P19 work of any kind was begun, planned in code, or scoped during this task.

---

```
TASK ID: 109431
STATUS: PASS
VERSION: 0.1.17
PRODUCTION CODE CHANGED: YES
DATABASE CHANGED: NO
TESTS: 1249/1249
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18.3: NOT STARTED
```

**Root cause**: `React.memo(CaptionRow)` already existed, but all 11 of its callback props were fresh inline closures created inside `CaptionsPanel`'s `.map()` on every render, so the shallow-equality memo comparison always saw at least one "changed" prop and re-rendered every visible row on any single-caption edit. Timeline caption blocks had no memo boundary at all — they were inline JSX, never extracted into a component.

**What changed**: `captions-panel.tsx` — 4 new stable, id-parameterized `useCallback` handlers (reading ephemeral/id-keyed state fresh via `useEditorStore.getState()`, never closing over render-time snapshots), plus 7 store actions passed straight through unwrapped since their signatures already matched exactly; `CaptionRow`'s prop types changed to id-first. `timeline.tsx` — extracted a new `memo()`-wrapped `TimelineCaptionBlock`, with `startDrag` and two new handlers (`handleBlockActivate`, `handleWordSelect`) made permanently stable the same way. No custom equality comparator was added anywhere; `commit()`/`undo()`/`redo()`'s pre-existing "same object reference for untouched captions" guarantee does the rest.

**Render-count improvement**: proven at the data layer, at all 5 required caption-count tiers (30–5,400): after a single-caption text, timing, or word-timing edit, **0 of the other N−1 captions' own object references change** — the exact precondition `React.memo`'s default comparison needs to skip re-rendering them. Before the fix, this was unconditionally the opposite (all 11 callback props differed on every row, every time).

**Performance results**: the mutation-plus-comparison cost itself stays under 5ms at every tier up to 5,400 captions (well under this project's own 150ms sibling-test ceiling); no new O(n²) behavior introduced.

**Virtualization status**: fully preserved and re-verified live — 21 of 1,800 rows mounted at a 50%-scrolled position (matching the expected windowing math exactly), all 30 rows mounted unconditionally in a below-threshold project, offscreen selection still works.

**Regression results**: 1249/1249 tests passing (25 new, 0 deleted/weakened), typecheck clean, lint clean (same 5 pre-existing warnings), all protected systems confirmed untouched by diff.

**Known limitations**: `TimelineCaptionBlock` memoization is only effective in Original display mode (a protected-architecture constraint in `applyOutputMode`, not fixed, documented); no dev render-count instrumentation was built (pure data-layer projection tests used instead, per this task's own permitted fallback); playback and display-mode live QA were NOT TESTED due to disposable-fixture limitations (no video asset, English-only content) and are labeled as such rather than inferred PASS.
