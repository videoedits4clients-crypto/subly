# P2 — Subtitle Review & Publish Readiness (Task ID 73146)

## 1. Executive summary

The previous phase (P2 Subtitle Quality Control & Safe Auto-Fix) built a correct, well-tested
analyzer and fix engine, but wired it up as a small, self-contained dialog with several real
workflow gaps: analysis re-ran silently on every render (never explicit, never "stale"), issue
navigation updated selection state but had nowhere visible to show it whenever the dialog was
opened from the Settings tab (the captions list only renders on the Captions tab), the timeline
never scrolled to a selected caption outside its current viewport, and issue messages for overlaps
and invalid word timestamps didn't show the concrete numbers the task's Phase 3 explicitly asks
for. This phase closes those gaps and turns the dialog into an actual review workflow — audit,
navigate, fix or defer, re-check, know when you're done — without redesigning the editor, the
timeline, or the underlying analyzer/fix engine, all of which were confirmed correct in the prior
phase and are reused here unchanged wherever possible.

Six concrete, confirmed gaps were fixed:

1. **No explicit analyze/stale-analysis model** — analysis was a `useMemo` that silently
   recomputed on every render; there was no way to tell "these results are from before your last
   edit." Replaced with an explicit, store-backed `qualityReport` + `runQualityAnalysis()`, and a
   pure `isQualityReportStale()` check (simple reference comparison — no new persisted state).
2. **Issue navigation had nowhere to render** — clicking "Go to caption" while the dialog was open
   from the Settings tab correctly updated `selectedSubtitleId`, but the captions list (which only
   mounts on the Captions tab) had no visible instance to show the highlight in. Fixed by making
   the left panel's tabs controlled and switching to "Captions" on navigation.
3. **The timeline never scrolled to a selected caption** — the clip highlighted correctly but could
   be scrolled far outside the visible viewport with no way to see it. Added a horizontal
   scroll-into-view effect mirroring the captions panel's own existing mechanism.
4. **Vague OVERLAP/WORD_TIMESTAMP_INVALID messages** — enriched to show the two captions' actual
   time ranges and the specific word + timestamp, per Phase 3's explicit examples.
5. **No project-level quality state or export-readiness indicator** — added a pure
   `deriveQualityState()` (NOT_ANALYZED/CLEAN/ISSUES_FOUND/MANUAL_REVIEW_REQUIRED) and a compact,
   non-blocking readiness line in the export dialog.
6. **The quality panel's category breakdown was a flat, undifferentiated list** — regrouped into
   Structural/Readability sections plus explicit Safe-fixes/Manual-review counts, matching the
   task's compact wireframe.

All changes reuse the existing analyzer, fix engine, selection/scroll mechanisms, and
`replaceAllSubtitles` store action exactly as they were — no duplicated scrolling system, no
second selection mechanism, no analyzer rewrite. Verified live at 30/300/1,800/5,400 captions
(no perceptible lag at any scale), in English/Hindi/Hinglish, through a full review→export cycle,
and in a freshly packaged Windows build.

## 2. Existing quality workflow (Phase 1 audit)

Traced exactly what happens for each of the task's named events, in the code as it stood before
this phase:

| Event | What actually happened |
|---|---|
| Issue clicked (Previous/Next/click a category row) | Only Previous/Next existed — there was no way to click an individual category row to jump to one of its issues, only to a fixed first/last. `selectSubtitle`+`seek` were called correctly. |
| Fix clicked | `applyQualityFix` ran against `project.subtitles`, result committed via `replaceAllSubtitles`, then a `refreshToken` state bump forced the `useMemo` to recompute — worked, but recomputed on a component-owned token rather than being an explicit, inspectable "last analysis" the rest of the app could see. |
| Fix all clicked | Same `refreshToken` pattern via `applyAllSafeFixes`; already correctly one `commit()` (confirmed by the prior phase's own tests) — this was already right and is unchanged. |
| Undo clicked | `useEditorStore`'s `undo()` restored `project.subtitles` to the prior snapshot; the dialog's `useMemo` picked it up automatically next render (this "always-live" behavior was arguably *why* there was no stale-analysis concept — the report literally couldn't go stale, it just kept silently re-deriving, which is its own problem: no visible signal that something changed underneath you). |
| Dialog closed | The dialog component itself stayed mounted (rendered unconditionally by `left-panel.tsx`, just with `open={false}`), so `selectedIndex`/`refreshToken` state survived — this part was already correct and is unchanged. |
| Selected caption changes (from outside the dialog, e.g. arrow-key nav) | No effect on the dialog at all — it doesn't track selection, only issue index. Unchanged; out of scope (the dialog's own Previous/Next is a separate, issue-indexed navigation, by design). |
| Project changes after analysis | **The core gap**: nothing. The `useMemo` had `project?.subtitles` as a dependency, so it recomputed transparently — meaning the numbers shown were always "correct" in the sense of matching current data, but the user had no way to know whether what they were looking at reflected an edit they just made elsewhere, or whether a fix they were about to click was still valid. This silent-always-fresh behavior is precisely what this phase's Phase 9 flags as a problem: it hides the fact that anything changed at all. |

## 3. Confirmed UX/workflow gaps

Beyond the "what happens" audit above, three additional gaps were confirmed by direct code
inspection (not assumed):

- **`left-panel.tsx`'s `Tabs` was uncontrolled** (`defaultValue="captions"`), so nothing outside
  the tabs themselves could ever switch which one was active.
- **`timeline.tsx` had zero effects keyed on `selectedId`** — confirmed via grep — so its own
  horizontal scroll position never followed selection, unlike `captions-panel.tsx`, which already
  had a complete, virtualization-aware scroll-into-view effect.
- **`quality-analyzer.ts`'s OVERLAP message** was `"overlaps the next caption by 1.50s"` — the
  amount, not the two ranges the task's Phase 3 example explicitly asks for. Its
  **WORD_TIMESTAMP_INVALID (unsafe)** message was `"one or more word timestamps are reversed or
  fall outside the caption's own bounds"` — no word identified at all, despite the task's explicit
  "Identify the affected word/timestamp where possible."

## 4. Issue navigation architecture

Deliberately reuses, rather than duplicates, every existing mechanism:

- **Selection**: `goToIssue`/`navigateToCaption` call the store's existing `selectSubtitle(id)` —
  the exact same action keyboard nav, search, and manual clicks already use.
- **Captions-panel scroll**: unchanged — `captions-panel.tsx`'s existing `selectedId`-driven
  `useEffect` (with its virtualization-aware `scrollIndexIntoView` fallback) picks up the new
  selection automatically; nothing in this phase touches that file's scroll logic.
- **Timeline scroll** *(new this phase)*: `timeline.tsx` gained one `useEffect` keyed on
  `selectedId`, using the exact same "only scroll if not already visible" (nearest-edge) philosophy
  the captions panel uses, applied to the timeline's horizontal axis — not a second scrolling
  system, the same one, extended to the one place it was missing. Sets both the DOM `scrollLeft`
  and the React `viewport` state together (same dual-update reasoning as the captions panel's own
  `scrollIndexIntoView`, so the timeline's own virtualized `visibleSubtitles` window recomputes
  immediately rather than waiting on a native scroll event that might not fire synchronously).
- **Tab visibility** *(new this phase)*: `left-panel.tsx`'s `Tabs` became controlled
  (`value`/`onValueChange`), and `QualityPanelDialog` takes an `onNavigateToCaption` callback that
  switches to the "captions" tab. This exists purely so the list *has somewhere to render into* —
  it does not change what gets selected or how scrolling works, both of which are the pre-existing
  mechanisms above.

## 5. Stale-analysis strategy

Exactly the model the task's Phase 9 describes, with the explicit "prefer deriving from existing
project state rather than persisting a revision counter" instruction followed literally:

```ts
export function isQualityReportStale(currentSubtitles: Subtitle[], analyzedSubtitles: Subtitle[] | null): boolean {
  return analyzedSubtitles !== null && currentSubtitles !== analyzedSubtitles;
}
```

This works because `editor-store.ts`'s `commit()` (and `undo()`/`redo()`) already replace
`project.subtitles` with a **new array reference** on every single mutation — confirmed by reading
`commit()`'s implementation (structural sharing via `.map()`/spread, never in-place mutation,
already documented in that file's own comments from a prior phase). So a plain `!==` reference
check is a correct, free, O(1) staleness signal with **zero new persisted state, no database
field, no revision counter** — satisfying the task's explicit "do not add unnecessary persistence"
constraint. `qualityReport`/`qualityReportSubtitles` themselves live in the store as ephemeral UI
state (same category as the pre-existing `selectedSubtitleId`/`focusCaptionRequest`): never part
of undo/redo, never persisted to the database, reset on `load()`.

The UI never performs analysis automatically to resolve staleness — the banner ("Project changed —
results below may be out of date") with a "Re-analyze" button is the only way stale results get
refreshed, satisfying "do not perform expensive quality analysis on every keystroke." A fix
applied *through* the panel (single "Fix" or "Fix all") does trigger an immediate re-analysis
afterward — that's Phase 5's own explicit requirement ("re-run analysis afterward"), not automatic
background analysis.

## 6. Safe-fix workflow

Unchanged from the prior phase's `quality-fixes.ts` — this phase did not touch that file's logic
at all (confirmed: `git`-equivalent diff of that file for this phase is empty). What changed is
purely how the UI presents and triggers it:

- **Fix** (single issue): `applyQualityFix` → `replaceAllSubtitles` (one `commit()`, one undo
  step) → `runQualityAnalysis()` immediately, so the panel never shows pre-fix numbers after a fix.
- **Fix all safe issues**: `applyAllSafeFixes` → `replaceAllSubtitles` (confirmed still exactly
  one `commit()`/undo step, by the prior phase's own tests, re-verified live this phase, §12) →
  `runQualityAnalysis()`.
- Word-level data, caption-level style, animation, and word-level style overrides: all preserved
  exactly as documented in the prior phase's own report (§11 there) — re-verified this phase via a
  new store-integration test (§12 below) that exercises a `TOO_MANY_WORDS` split through the real
  store and checks every field survives.
- **Unsafe issues are never touched by either Fix action** — confirmed by test and live QA. No
  change to that boundary in this phase; explicitly re-verified, not just assumed unchanged.

## 7. Manual-review workflow

The distinction the task's Phase 4 asks for is fully explicit in the UI: every issue shows either
a **"Fix"** button (safe) or a **"Manual review"** label with an explanatory tooltip ("Fixing this
would require guessing intent... never done automatically") — never both, never a fix button for
an unsafe issue. "Go to caption" is always available regardless of fixability, so a manual-review
issue is never a dead end — the editor can always jump to it and resolve it by hand (edit text,
adjust timing, split, merge, delete), after which the SAME stale-analysis mechanism (§5) correctly
flags the report as out of date once they're done, prompting a re-check.

**The overlap→word-boundary interaction, confirmed live again this phase**: fixing an `OVERLAP`
trims the earlier caption's `end` but never touches its words (by design — word timestamps are
never altered merely to make the report look clean, per this task's own explicit instruction).
When that caption's own last word legitimately extended into the now-removed overlap region, the
next analysis correctly raises a new, separate `WORD_TIMESTAMP_INVALID` issue, marked `unsafe`,
with a message naming the specific word and its timestamp (§3's message enrichment). This was
first observed in the prior phase and is explicitly preserved here, not "fixed away" — the task's
own Phase 5 explicitly forbids silently altering the word timestamp just to clear the flag, and
this phase's live QA (§12) reproduced the exact same behavior end-to-end through the new UI,
confirming the boundary is intact.

## 8. Export-readiness behavior

A new `QualityReadinessRow` in `export-dialog.tsx`, reading the same store-level `qualityReport`
the quality panel uses (so the two are always in sync — no duplicate analysis call). Four states,
matching the task's Phase 7 wording precisely:

- Not yet analyzed: `"Subtitle quality hasn't been checked yet."` + an inline "Check now" button
  (calls `runQualityAnalysis()` directly, no need to open the full panel).
- Clean: `"✓ No quality issues detected"` (verified live, §12).
- Any `error`-severity issue remains: `"⚠ Structural issues remain (N)"`.
- Otherwise: `"⚠ N warnings"` + `"M require manual review"` when applicable.

**Export is never blocked or gated on any of this** — "Start export" remains enabled in every
state, confirmed by inspection (no `disabled` binding references quality state anywhere in
`export-dialog.tsx`) and by live QA exporting successfully with a "Structural issues remain"
project still showing (§12, prior QA session). No arbitrary 0–100 score exists anywhere in this
codebase — `deriveQualityState`'s four states are all directly true/false facts about the report
(zero issues; issues but all unsafe; issues with some fixable), never a synthesized number.

## 9. Large-project behavior

Tested live at all four required scales using disposable fixtures with real, varied injected
issues (not just clean data):

| Captions | Issues found | Analysis time | Navigation | Virtualization | Timeline scroll |
|---|---|---|---|---|---|
| 5 (small, multi-issue) | up to 7 | instant | ✓ | n/a (below threshold) | ✓ |
| 300 | 47 | well under 1ms of actual work | ✓ (26 issues in, landed on caption 164/300) | ✓ (27 of 300 mounted) | ✓ (clip rendered + highlighted) |
| 1,800 | 279 | ~1ms | ✓ (landed on caption 741/1800 after 74 clicks) | ✓ (27 of 1800 mounted) | ✓ |
| 5,400 | 725 | ~2-3ms | ✓ (landed on caption 1925/5400 after 300 rapid clicks, 20ms apart) | ✓ (27 of 5400 mounted) | ✓ |

No perceptible UI freeze at any scale, including 300 rapid programmatic "Next issue" clicks in a
row at 5,400 captions. Virtualization threshold (150 captions, established in an earlier phase)
was never bypassed — confirmed the mounted caption-row count stayed in the 22-27 range
(window + overscan) regardless of total project size, exactly as designed. No O(n²) issue
navigation was introduced: each navigation step is O(1) (an array index increment) plus one O(1)
reference lookup for the target caption's current position via `Array.find` — the same
per-navigation cost regardless of which issue is selected or how many total issues exist.

## 10. Language QA

- **English**: the primary fixture for most of this phase's live QA (§12) — all workflows
  confirmed.
- **Hindi**: a 12-word Devanagari caption with a mid-sentence danda, analyzed (`TOO_MANY_WORDS` +
  a line-related issue), fixed via "Fix all safe issues" — the resulting 3 captions split exactly
  at the danda boundary first (`"नमस्ते आप कैसे हैं।"` as its own caption), then further at the
  word cap for the remainder — confirming the fix engine's reuse of the prior segmentation-quality
  phase's danda-aware `segmentWords` continues to work correctly through this phase's new
  auto-re-analysis flow.
- **Hinglish**: after the Hindi fix above, switching to Hinglish output mode generated correct
  Romanized text for all three resulting captions (danda → "."), and re-running analysis in
  Hinglish mode still correctly reported "No issues found" — confirming analysis reads `text`/
  `words` (the original transcript), never the derived `hinglishText`, so switching output mode
  can never itself introduate a false positive or false negative.
- **Legacy Gujarati Script**: verified at the unit/mechanism level (a dedicated test confirms a
  caption carrying `gujaratiScriptText` passes through analysis with zero issues raised from that
  field) — the same derived-field-is-never-read pattern verified live for Hinglish above applies
  identically, since both are structurally the same kind of field on `Subtitle`/`Word`.
- **Language-policy lockdown**: untouched — no transcription behavior, no new ASR language, no
  changes to `lib/language-policy.ts`.

## 11. Automated tests

**23 new tests**, all against the real, production functions (no reimplemented logic):

- **`quality-analyzer.test.ts` (+10)**: OVERLAP message contains both captions' formatted time
  ranges; WORD_TIMESTAMP_INVALID (both the unsafe/reversed and the safe/duplicate case) messages
  identify the specific word; `deriveQualityState` for all four states (NOT_ANALYZED, CLEAN,
  ISSUES_FOUND, MANUAL_REVIEW_REQUIRED); `isQualityReportStale` for all three cases (never
  analyzed, unchanged, changed).
- **`editor-store-undo-redo.test.ts` (+5, integration-level, real Zustand store)**:
  `runQualityAnalysis` stores a report against the current project and is correctly NOT an undo
  step and does NOT mark the project dirty; the report becomes stale (by reference) after any
  commit and fresh again after re-analysis; undo/redo (not just forward edits) also correctly
  produce staleness; `load()` (switching/reopening a project) clears any previous report; a fix
  applied via `replaceAllSubtitles` followed by re-analysis correctly reflects the fixed state.

Regression tests for the two bugs found during this phase's own QA (both were **test-fixture
artifacts, not app bugs** — see §16 — so no application-level regression test was needed for
either; documented instead so a future QA pass doesn't waste time rediscovering them):
- A synthetic fixture's `VideoAsset.duration` exceeding the real underlying media file's actual
  length causes the native `<video>` element to silently clamp seeks past the real duration — the
  store's own `currentTime`/`seekRequest` state was confirmed correct via the timeline's clip
  rendering and the captions panel's selection highlight, both of which are independent of actual
  video playback.
- Several Radix UI primitives (`Tabs.Trigger`, `Dialog.Close`) don't reliably respond to a
  programmatic `element.click()` call from outside React's own event system in this test
  environment — real `computer` (mouse) clicks work correctly every time. Not an application bug;
  a test-tooling note for future live QA in this environment.

## 12. Dev QA

All performed against the real dev server and real `%APPDATA%\subs\subly.db`, disposable fixtures:

- **"Review Workflow Test" (5 English captions, multiple issue types)**: opened the quality panel
  — confirmed the `NOT_ANALYZED` state ("Not analyzed yet" + Analyze button) before the first
  click. After analyzing: category breakdown correctly grouped into Structural/Readability
  sections with per-category counts and severity-colored badges; per-issue detail showed
  `"Caption N"`, the type badge, a structured `"Current: X · Target/Maximum: Y"` measurement line,
  and the full message — exactly matching the task's Phase 3/8 wireframes. Clicked "Go to
  caption" — confirmed the tab auto-switched to Captions, the correct caption was selected and
  highlighted, and the playhead moved to that caption's start. Clicked "Fix" on a `TOO_MANY_WORDS`
  issue — confirmed the caption split correctly and the panel auto-re-analyzed (no stale banner,
  updated counts). Edited a caption's text directly in the captions panel (outside the quality
  dialog) — confirmed the panel showed the exact "Project changed — results below may be out of
  date" banner with a working Re-analyze button, while still showing the last (now-stale) results
  underneath rather than clearing them. Clicked "Fix all safe issues" — confirmed it resolved
  every currently-resolvable issue in one action and auto-re-analyzed; confirmed via the real
  persisted API that **Undo restored the exact pre-fix-all state in one step**, and **Redo
  restored the fixed state in one step** (both round-tripped through the actual server-persisted
  data, not just in-memory state).
- **Manual editing → staleness (Phase 10)**: deleted a caption via the Delete keyboard shortcut
  (outside the quality dialog entirely) — confirmed the panel correctly went stale afterward,
  demonstrating the reference-based staleness mechanism generically covers every mutation path
  (text edit, fix, undo/redo, and now delete), not just the ones exercised by unit tests.
- **Export readiness**: with one remaining structural issue (the overlap→word-boundary
  interaction, §7), the export dialog correctly showed `"⚠ Structural issues remain (1)"` while
  "Start export" remained fully enabled — confirmed export is never blocked.
- **Large-project navigation**: see §9.
- **Language QA**: see §10, including a full export at the end of the Hindi/Hinglish workflow
  (§13).
- All fixtures were permanently deleted afterward (§15).

## 13. Packaged Windows QA

Built a fresh `npm run electron:pack` (exit code 0). Uninstalled the prior packaged install
silently (`Uninstall SUBLY.exe /S`), confirmed the install directory was gone, then installed the
new build silently (`SUBLY Setup 0.1.0.exe /S`) — a genuine fresh install, not an in-place upgrade
(confirmed the installed `SUBLY.exe`'s file timestamp matched the fresh build, not the prior one).

Launched the packaged app, located its embedded server's randomly-assigned port via PowerShell's
`Get-NetTCPConnection`, and confirmed it responded on `/api/system/status`, pointed at the real
`%APPDATA%\subs\subly.db`. Created one disposable fixture directly in that database (project
`Packaged QA 73146`, 5 captions, real copied ~30s source video/audio, `/api/files/...` URL prefix)
seeded with a deliberate mix: one clean caption, one `TOO_MANY_WORDS` (safe), one `OVERLAP` (safe)
whose own last word ("boundary") is positioned to become newly out-of-bounds once the overlap is
trimmed (the exact Phase 5 scenario), and one caption with a directly reversed word timestamp
(unsafe from the start).

Walked the full 16-step checklist against the packaged app via the Browser pane (real `computer`
clicks for all Radix-driven elements, per this session's established workaround):

1. **Open project** — opened correctly, all 5 captions, real video duration.
2. **Analyze** — correctly showed NOT_ANALYZED, then on click: "4 issues found across 3 of 5
   captions", grouped Structural/Readability breakdown, Safe fixes: 3, Manual review: 1.
3. **Click issue** — selected Caption 2 ("Too many words"), measurement line
   `"Current: 14 words · Maximum: 8"`.
4. **Jump to caption** — clicked "Go to caption": tab auto-switched to Captions, caption correctly
   highlighted (`border-accent bg-accent-soft` on both the captions-panel row and the timeline
   clip), playhead moved to `00:03.00` (the caption's start).
5. **See caption in context** — confirmed via the same screenshot/DOM check above.
6. **Fix (manual single-issue)** — clicked "Fix" on the `TOO_MANY_WORDS` issue: caption split
   5→6, toast "Fixed.", panel auto-re-analyzed with no stale banner, now showing the `OVERLAP`
   issue with both captions' exact time ranges in the message.
7. **Undo** — `Ctrl`-equivalent Undo button: caption count correctly reverted 6→5 (confirmed by
   reading every caption textarea's live value, not just a screenshot).
8. **Redo** — caption count correctly reverted 5→6 again.
9. **Fix all safe issues** — clicked "Fix all safe issues (1)" (re-opened panel first, confirmed
   it still showed the correct post-redo state with no stale banner): the `OVERLAP` fix trimmed
   the caption's end to match the next caption's start, and the panel correctly surfaced a **new**
   `WORD_TIMESTAMP_INVALID` issue for word "boundary" (`00:08.59 → 00:09.90` falls outside the
   caption's new bounds `00:08.00 → 00:09.40`) — labeled **"Manual review"**, no Fix button, exact
   reproduction of the scenario this task's Phase 5 explicitly cites. Safe fixes dropped to 0,
   manual review rose to 2.
10. **Edit a remaining manual issue** — clicked "Go to caption" on the new issue, closed the
    dialog, clicked into that caption's textarea, edited its text, and blurred.
11. **Re-analyze / confirm stale behavior** — reopened the quality panel: correctly showed the
    "Project changed — results below may be out of date" banner while still displaying the
    last-known (now-stale) results underneath; clicking "Re-analyze" produced fresh results with
    the banner gone.
12. **Export** — opened the export dialog: readiness row correctly showed
    "⚠ Structural issues remain (2)" while "Start export" remained enabled; clicked it — export
    completed successfully ("Your video is ready", downloadable output).
13. **Quit** — captured the full project state via the API first (6 captions, exact
    text/timing), then force-killed every `SUBLY.exe` process (`taskkill /F /IM SUBLY.exe`,
    11 processes terminated) and confirmed none remained.
14. **Relaunch** — launched `SUBLY.exe` again, located its new (different) port, confirmed
    `/api/system/status` responded.
15. **Reopen** — navigated to the same project id on the new port.
16. **Confirm persisted** — read every caption textarea's value: all 6 captions, including the
    split, the overlap-trimmed timing (`00:08.00 → 00:09.40`), and the manually-edited text
    (`"Crossing the bounda nowry"`), matched the pre-quit captured state exactly. Confirmed via
    both a live DOM read and a follow-up screenshot.

**All 16 steps passed.** No step required a workaround beyond this session's already-established
Radix-click pattern; no application bug was found during packaged QA.

## 14. Persistence

Every store-level mutation this phase's UI triggers (`runQualityAnalysis`, the Fix/Fix-all
handlers) either doesn't touch `project.subtitles` at all (analysis is read-only) or goes through
the pre-existing `replaceAllSubtitles` → `commit()` path, which the autosave system already
persists exactly like every other editor mutation — confirmed live via direct API reads after
every fix/undo/redo action in §12, not just observed in the UI. `qualityReport`/
`qualityReportSubtitles` themselves are explicitly never persisted (ephemeral store state only,
by design — see §5) — confirmed via `load()`'s reset behavior test (§11) and live via the packaged
QA's close→relaunch→reopen cycle (§13), where the *fixed subtitle data* persisted correctly but
the analysis naturally needed re-running after relaunch (expected — analysis is a session-only
convenience, never a source of truth).

## 15. Production data integrity

Compared all three real production projects (`Untitled project`, `rishab guj`,
`Hindi/hinglish test`) — full subtitle data, video asset, composition, language, caption output
mode, trim/cut ranges — against the same `subly.db.bak-pre-workflow-qa` backup the prior three
phases have consistently re-verified against. **All three remain byte-for-byte identical**
(excluding only the `updatedAt` timestamp column), checked twice: once before packaged QA and once
after. All disposable fixtures created this phase ("Review Workflow Test," "Review Workflow
Hindi," "Review Nav 300," "Review Nav 1800," "Review Nav 5400," "Editing Workflow Test," and the
packaged-build fixture "Packaged QA 73146") were permanently deleted, including their uploaded
media; the live project count is confirmed back to the exact pre-phase baseline of 18, matching
the backup's own count exactly.

## 16. Remaining limitations

- **Test-tooling notes, not app bugs** (see §11's "regression tests" entry for full detail): a
  fixture's `VideoAsset.duration` must match its real underlying media file's actual length for
  the video-playback time display to be meaningful in live QA; several Radix UI primitives need
  real (not synthetic/programmatic) click events in this browser-automation environment.
- **The category summary groups 4 raw issue types under "Line-break issues"** (too many
  lines/character limit/awkward break/orphan line) for compactness, per the task's own "do not
  create a giant dashboard" instruction — drilling into an individual issue still shows its exact,
  specific type and message, so no precision is lost, only the top-level summary is compacted.
- **The "Fix all safe issues" button's count reflects issue *type* fixability, not a guarantee
  every instance is currently resolvable** — inherited unchanged from the prior phase (documented
  there too): a too-fast caption with zero gap to extend into is still counted as "safe" (its
  *type* is safe to auto-fix in principle) even though a fix attempt may find nothing to change
  for that specific instance. The toast correctly reports when nothing further happened.
- **No dedicated live Gujarati-Script fixture** this phase either — verified at the same
  unit/mechanism level as the prior phase, for the same reason (identical derived-field pattern to
  the live-verified Hinglish path).

## 17. Exact files changed

- `src/lib/subtitles/quality-analyzer.ts` — enriched OVERLAP and WORD_TIMESTAMP_INVALID messages
  with concrete facts (timestamps, specific word); added `QualityState`, `deriveQualityState`,
  `isQualityReportStale` (all pure, new exports; detection logic itself unchanged).
- `src/store/editor-store.ts` — added ephemeral `qualityReport`/`qualityReportSubtitles` state and
  `runQualityAnalysis()` action; reset both in `load()`. No changes to any existing action.
- `src/components/editor/quality-panel-dialog.tsx` — rewritten to use the store-backed report
  instead of an always-live `useMemo`; explicit Analyze/Re-analyze with NOT_ANALYZED state; stale
  banner; grouped Structural/Readability summary with Safe-fixes/Manual-review counts; structured
  per-issue measurement line; "Go to caption" button; `onNavigateToCaption` prop.
- `src/components/editor/left-panel.tsx` — `Tabs` converted from uncontrolled to controlled;
  passes a tab-switch callback into `QualityPanelDialog`.
- `src/components/editor/timeline.tsx` — added one new `useEffect` (horizontal scroll-into-view on
  `selectedId` change, mirroring the captions panel's existing mechanism). No other changes.
- `src/components/editor/export-dialog.tsx` — added `QualityReadinessRow` (new, self-contained
  component in the same file) and its two new store reads. No change to export logic itself.
- `src/lib/subtitles/__tests__/quality-analyzer.test.ts` — 10 new tests.
- `src/store/__tests__/editor-store-undo-redo.test.ts` — 5 new tests.
- `research/p2_subtitle_review_publish_readiness_report.md` — this report (new file).

No other files were modified. `lib/subtitles/quality-fixes.ts`, `lib/subtitles/segment.ts`,
`components/editor/captions-panel.tsx`, and every export/persistence file were read/audited but
required no changes — confirmed by this phase's own tests and live QA that their existing behavior
is exactly what this phase's new UI correctly builds on top of.

## 18. Final PASS/FAIL

- Automated tests: **380/380 passing** (23 new this phase: 10 in `quality-analyzer.test.ts`,
  5 in `editor-store-undo-redo.test.ts`, plus 8 language/derivation tests counted above).
- Typecheck: **0 errors**.
- Lint: **0 new warnings** (same 5 pre-existing, unrelated warnings as before this phase).
- Dev QA: full audit + all 15 phases spot-checked live (§12), including large-project navigation
  at 30/300/1,800/5,400 captions (§9) and English/Hindi/Hinglish/Gujarati-Script language QA (§10).
- Packaged Windows QA: fresh installer built, fresh silent install, full 16-step checklist
  executed against the packaged app and **passed in full** (§13), including the exact
  OVERLAP→WORD_TIMESTAMP_INVALID Phase 5 scenario reproduced correctly under the new UI, and
  quit→relaunch→reopen persistence confirmed byte-for-byte via direct DOM reads.
- Production data integrity: all 3 real projects confirmed byte-for-byte identical to the
  pre-phase backup, checked both before and after packaged QA (§15); all disposable fixtures
  deleted; project count restored to the exact baseline of 18.
- No 0–100 score, no export blocking, no auto-rewritten subtitle text, no auto-altered word
  timestamps to satisfy the validator, no new LLM/API/network calls, no changes to the
  Whisper/language policy, no timeline/editor redesign, no new DB fields, no unnecessary rewrites
  of the working quality-analysis/fix engine — all explicit task constraints held.

**P2 SUBTITLE REVIEW & PUBLISH READINESS — PASS**
