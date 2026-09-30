# P12 — Professional Review Workflow & Issue Navigation — Final Report

## 1. Status

**PASS.**

## 2. Task ID

99261

## 3. Version

0.1.12 → **0.1.13** (bumped only after the full test suite, typecheck, lint, dev QA, and packaged Windows QA all passed).

## 4. Phase 0 audit findings

Before writing any code, the existing infrastructure was inspected in full. Summary of what already existed vs. what was genuinely missing:

**Already existed and correct (reused unchanged):**
- `qualityIssueIndex` (editor-store.ts) — the ONE shared cursor every entry point (top bar buttons, Alt+↑/↓, the quality dialog's own Prev/Next) already reads and writes, non-wrapping, reset on `load()`/`runQualityAnalysis()`.
- `isQualityReportStale(currentSubtitles, qualityReportSubtitles)` — a pure, reference-equality derivation with zero persisted state; already the sole source of truth for staleness everywhere it's checked.
- `goToQualityIssue(delta)` — already selects the target caption and seeks the video; already tolerant of a caption that no longer exists (skips navigation, still moves the cursor).
- The captions panel's scroll-into-view effect (`useEffect` keyed on `selectedId`) — already brings an off-screen/virtualized caption into the DOM via `computeScrollTargetForIndex`, exactly the mechanism `goToQualityIssue`'s `selectSubtitle` call needed for virtualized navigation. Confirmed still active and NOT defeated at 199 captions (only ~19 rows mounted at a time).
- `use-keyboard-shortcuts.ts`'s Alt+↑/↓ handler — already positioned AFTER both the `isTypingTarget` guard (line 107) and the `isAnyDialogOpen()` guard (line 114), so it already correctly never fires while typing or while any dialog is open.
- `src/components/ui/dialog.tsx`'s `pointer-events-none!` fix (from Task 97025/P10) — confirmed still intact; reconfirmed live in both dev and the packaged 0.1.13 build that a closed dialog never blocks clicks.
- The quality panel dialog's "Manual review" (unsafe-fixability) path, the P11 compact issue-count/category summary, and `quality-fixes.ts`'s safe-fix engine — all reused completely unchanged.
- `selectSubtitle`/`selectWord` (editor-store.ts) — `selectSubtitle` already nulls `selectedWordIndex` when moving to a different caption, which is exactly the "never invent a fake word selection" behavior a caption-level issue needs.

**Genuinely missing (the actual P12 work):**
1. `QualityIssue` had no `wordIndex` field — `WORD_TIMESTAMP_INVALID` is the only issue type that targets a specific word, but nothing recorded WHICH word, so navigation could never select it.
2. `goToQualityIssue` never called `selectWord` at all — word-level issue focus never happened, even though the underlying word-chip highlight UI (from Task 92618/P7.2) already existed and just needed to be driven.
3. The dialog's own "Go to caption" button used a separate, narrower `navigateToCaption(captionId)` path that bypassed `goToQualityIssue` entirely and never selected a word either — a real inconsistency between "click Next" and "click Go to caption," both meant to land on the SAME current issue (found and fixed during this task's own dev QA, see §7).
4. No "reviewed" bookkeeping existed at all (objective 7 — "know when all currently reported issues have been reviewed").
5. "Analyze"/"Re-analyze" only ran analysis; it never navigated to the first issue, so every fresh analysis left the reviewer at a blank "nothing navigated yet" state one extra click away from Issue 1.
6. The existing fix flow (`fixOne`/`fixAllSafe` in quality-panel-dialog.tsx) called `runQualityAnalysis()` immediately after every fix — silently regenerating the report and resetting `qualityIssueIndex` to `null` on every single fix, which is the opposite of this task's explicit "current issue navigation must remain stable... do not silently regenerate analysis" requirement.
7. No persistent (non-toast) stale indicator existed in the compact top-bar navigation widget — only a one-shot toast fired on each Prev/Next click while stale.
8. The estimated-row-height virtualization scroll-to-index jump (`scrollIndexIntoView`) had no correction pass once the target row actually mounted — an existing, documented, accepted imprecision that P12's own long-list QA (199 captions) made visible in a concrete, measurable way (see §12).

## 5. Existing infrastructure reused

`qualityIssueIndex`, `qualityReport`/`qualityReportSubtitles`, `isQualityReportStale`, `goToQualityIssue`'s caption selection/seek, `selectSubtitle`/`selectWord`, the captions panel's virtualized scroll-into-view effect and its existing `focusCaptionRequest` rAF-retry pattern (reused for the new scroll-precision fix), `quality-fixes.ts` (completely untouched), the P11 compact issue-count/category summary, the existing `ConfirmDialog`/dialog-open-guard system, and the existing keyboard-shortcut guard ordering. No new database fields, no new persisted state, no new dialog, no new keyboard shortcut.

## 6. Review-state implementation

One new field, `reviewedIssueIds: Set<string>` (editor-store.ts) — ephemeral client state, the exact same category as `qualityIssueIndex` (never part of undo/redo, never persisted, reset on `load()` and on every fresh `runQualityAnalysis()` so a stale report's "reviewed" ids can never inflate a new report's progress count). Populated by `goToQualityIssue` adding the current issue's `id` on every navigation, from every entry point (keyboard, top bar, dialog buttons, "Go to caption") since they all funnel through this one action. No DB migration; `current issue index`/`current issue ID`/`total current issues` were already available via existing state (`qualityIssueIndex`, `qualityReport.issues[index]`, `qualityReport.issues.length`).

## 7. Issue navigation behavior

- `goToQualityIssue(delta)` unchanged in its clamping/staleness contract (never wraps, matching existing behavior — confirmed this is what the pre-P12 code already did, so no wrapping was introduced).
- New: also calls `selectWord(issue.wordIndex ?? null)` right after `selectSubtitle`, and records `issue.id` into `reviewedIssueIds`.
- New store action `runQualityAnalysisAndReview()` — runs analysis (identical to `runQualityAnalysis`, including its own reset semantics) and then, only if the fresh report has issues, navigates to the first one. Deliberately a SEPARATE action, not baked into `runQualityAnalysis` itself, because the export dialog's own readiness check (`QualityReadinessRow`'s `onAnalyze`) also calls `runQualityAnalysis` and must never jump the editor's selection/seek while someone is just checking export readiness — verified live in the packaged build that clicking "Check now" in the Export dialog updates the readiness text without touching caption selection.
- **Bug found and fixed during this task's own dev QA**: the quality dialog's "Go to caption" button called a separate `navigateToCaption(captionId)` path that never selected a word. Fixed by changing its signature to take the whole `QualityIssue` and call `selectWord(target.wordIndex ?? null)` too — now "Go to caption" and automatic Next/Previous navigation produce byte-identical selection state for the same issue. Verified live: clicking "Go to caption" on the WORD_TIMESTAMP_INVALID issue now correctly highlights the exact duplicate word chip, not just the caption.
- "Analyze"/"Re-analyze"/"Analyze Again" (quality-panel-dialog.tsx's `analyze()`) now calls `runQualityAnalysisAndReview()` — verified live (both dev and packaged) that clicking Analyze on a fresh report lands directly on Issue 1 of N, and that "Analyze again" after a stale report produces a fresh report AND re-navigates to its own new Issue 1.

## 8. Word-level navigation

`QualityIssue.wordIndex?: number` added to `quality-analyzer.ts`; populated for both `WORD_TIMESTAMP_INVALID` sub-cases (the safe exact-duplicate case and the unsafe malformed-timestamp case), each with the real index into that caption's `words` array. Every other issue type leaves it `undefined` — verified with a dedicated test (`TOO_FAST` issue asserted to have `wordIndex === undefined`) so no issue type ever gets a fabricated word target.

Verified live end-to-end: navigating to a WORD_TIMESTAMP_INVALID issue selects the caption AND the specific word, which drives the EXISTING word-chip highlight UI (no new UI code) — confirmed via direct DOM inspection that only the correct chip (the duplicate "Hello," index 1 in the test fixture) carries the `border-accent` selected styling. Moving from that word-level issue to a different, caption-level issue on the SAME caption correctly clears `selectedWordIndex` back to `null` (never leaves a stale word highlighted) — covered by both an automated store test and live QA against real production Gujarati/Hinglish caption data.

## 9. Stale-report behavior

Unchanged derivation (`isQualityReportStale`), but the FIX FLOW around it changed materially:

- `fixOne()`/`fixAllSafe()` (quality-panel-dialog.tsx) no longer call `runQualityAnalysis()` after applying a fix. The fix still applies via the existing `replaceAllSubtitles`; the report simply becomes stale via the pre-existing reference-inequality check, exactly like any other edit. `qualityIssueIndex` and `reviewedIssueIds` are left completely untouched — "current issue navigation must remain stable" is satisfied literally (nothing about the report OR the cursor changes; the stale banner is the only new thing that appears).
- A toast now explicitly tells the user the report is stale ("Fixed. The quality report is now out of date — Analyze again when you're ready to continue.").
- The dialog's stale banner copy was tightened to match this task's own wording more closely ("Quality report is outdated because the project changed. The issues below reflect the project as it was at the last analysis, not its current state.") with an "Analyze again" button (same underlying `analyze()` → `runQualityAnalysisAndReview()`).
- Verified live end-to-end (both dev and packaged): Fix → position/badge unchanged, stale banner appears → Analyze again → fresh report, cursor reset to Issue 1 of the NEW (possibly different) issue count, `reviewedIssueIds` reset to just the new Issue 1.
- A dedicated store-level test (`173. FIX FLOW CONTRACT`) locks in this exact contract independent of any UI timing.

## 10. Manual-review UX

Unchanged mechanism (P11's `fixability: "unsafe"` types — `WHITESPACE_ISSUE`, `REPEATED_PUNCTUATION`, `SUSPICIOUS_SHORT_TEXT` — never rendered with a "Fix" button). Label text changed from "Manual review" to **"Manual review required"** (this task's own exact wording) — verified live that the label, not a Fix button, is what renders for these types, and that Next/Previous/"Go to caption" all continue to work normally on them.

## 11. Clean state

Unchanged mechanism; wording tightened to "No quality issues found" (was "No issues found") alongside the existing `CheckCircle2` icon standing in for the ✓. No score, no percentage, no ranking — the message states only that the current analyzer found zero configured issues, per this task's explicit prohibition.

New: an "All N issues reviewed." success banner (green, `CheckCircle2`) appears once `reviewedIssueIds` covers every issue in the CURRENT (non-stale) report — objective 7. Deliberately gated on `!stale` so a stale report's "reviewed" count is never shown as if it still describes current data. Verified live: reached "100/100 reviewed" after stepping through every issue of a 100-issue report, banner appeared; after a fix made the report stale, the banner correctly disappeared (gated by `!stale`) until "Analyze again."

## 12. Virtualization behavior

Core requirement — navigating to an off-screen, unmounted caption — was already satisfied by existing infrastructure and confirmed still working at 199 captions (only ~19 DOM rows mounted at any time; the target row for the LAST issue in the list correctly mounted after navigation).

**Real, measurable finding from this task's own dev QA**: the jump-scroll (`scrollIndexIntoView`, based on `ROW_HEIGHT_ESTIMATE`) is only approximate — a caption with extra rendered content (e.g. a stale-word-timing warning) is taller than the estimate, and that drift compounds over a long list. Measured live: navigating to the very last caption of a 199-caption project landed the target row **~110px (≈1.2 rows) past the visible bottom edge** — mounted (satisfying the letter of the requirement) but not actually visible without a further manual scroll.

**Fix applied** (captions-panel.tsx): after the estimate-based jump, a `requestAnimationFrame` retry re-queries the now-mounted element and calls `scrollIntoView({ block: "nearest" })` on it — the exact same rAF-retry shape the file's own `focusCaptionRequest` effect already used for the analogous "off-screen Tab-focus" case. Measured live after the fix: the same navigation now lands the target row only **~45px (≈0.5 rows) past the bottom edge** — a clear, verified improvement, though not pixel-perfect (the remaining gap is the same class of estimate-vs-actual-height drift the existing `ROW_HEIGHT_ESTIMATE` doc comment already documents as an accepted tradeoff of this virtualization design; see Known Limitations).

## 13. Tests added

- `quality-analyzer.test.ts`: 3 new/extended tests — `wordIndex` correctly set to the duplicate's own index (not the original's) for the safe case, correctly set for the unsafe malformed-timestamp case, and confirmed `undefined` for a caption-level type (`TOO_FAST`).
- `editor-store-undo-redo.test.ts`: 12 new tests (165–176) covering word-level selection on navigation, word-selection clearing for caption-level issues (including switching between a word-level and caption-level issue on the SAME caption), `reviewedIssueIds` growth/dedup/reset-on-analysis/reset-on-load, `runQualityAnalysisAndReview`'s first-issue navigation (and its correct no-op when there are zero issues), confirmation that plain `runQualityAnalysis` (the export dialog's path) never navigates, the fix-flow contract (stability + staleness with no silent re-analysis), undo/redo never touching the new review state, and a 5,400-caption/many-issues performance test.

## 14. Full test count

**826 / 826** passing (813 baseline + 13 new: 1 analyzer test extended into 3 assertions across existing+new tests, 12 store tests).

## 15. Typecheck

`tsc --noEmit` — clean, 0 errors.

## 16. Lint

`eslint` — **0 errors**, the same 5 pre-existing, unrelated warnings as before this task.

## 17. Dev QA

Against an isolated `prisma/dev.db` (never the packaged app's production DB), a disposable 199-caption project (8 handcrafted captions — timing/overlap/whitespace/repeated-punctuation/suspicious-short/word-level/multi-issue-on-one-caption — plus 190 clean filler captions plus 1 off-screen whitespace-issue caption at the very end) was seeded and exercised live in the real running app:

- Analyze → landed directly on Issue 1 of 100, confirmed live.
- Stepped through the full issue list via repeated Next clicks (verified positions 1 → 7 → 100, badges/captions matching the seeded fixture exactly: Invalid timing → Overlaps next caption → Whitespace needs cleanup → Repeated punctuation → Very short caption → Shown longer than needed → Invalid word timestamps → Whitespace needs cleanup, and finally caption 199's whitespace issue).
- Word-level focus confirmed via direct DOM inspection (the exact duplicate word chip, not just its caption, is highlighted).
- Off-screen (virtualized) navigation confirmed the target row mounts and is (after the §12 fix) brought close to visible.
- "Go to caption" bug found and fixed live (see §7).
- Manual editing verified: edited a whitespace-messy caption's text via a real controlled-input change, confirmed autosave ("Saved" indicator), undo/redo round-tripped correctly, and the edit persisted across a full page reload.
- Fix flow verified live end-to-end (see §9): stale banner appears, "Analyze again" produces a fresh report and re-navigates.
- "Manual review required" label confirmed for a `SUSPICIOUS_SHORT_TEXT` issue (no Fix button rendered).
- "All N issues reviewed." clean-review-complete banner confirmed at 100/100, and confirmed it disappears once the report goes stale.
- Export dialog confirmed to open without crashing and to run its own independent quality check ("Check now") without touching editor selection/seek — distinct from the review-session `runQualityAnalysisAndReview` path.
- No dialog click-blocking regression (`document.elementFromPoint` after closing the quality dialog resolved to a real app element, never a stuck overlay).

## 18. Packaged Windows QA

Built, installed (silent `/S`), and launched 0.1.12 first (pre-bump validation build), then rebuilt/reinstalled/relaunched **0.1.13** (the final, shipped build) after all QA passed.

Used a **disposable duplicate of a real production project** (`rishab guj` → `rishab guj (copy)`, created via the app's own "Duplicate" action — 43 real Gujarati/Hinglish captions):

- Analyze → landed on Issue 1 of 7 immediately (verified live).
- Stepped through issues via Next (1 → 4 of 7), no crash, correct caption/badge each time.
- Dialog closed cleanly (0 open dialogs after Close), confirmed no stuck click-blocking overlay in the packaged build specifically.
- Alt+ArrowDown / Alt+ArrowUp keyboard shortcuts verified working from the Captions tab in the packaged app; confirmed CORRECTLY BLOCKED while a caption textarea has focus (typed a caption's text, pressed Alt+ArrowDown, cursor position did not move) — objective 11's keyboard-safety requirement verified live, not just by code inspection.
- Cleaned up: moved the duplicate to Trash, then permanently deleted it via the existing type-to-confirm flow.
- Final 0.1.13 launch smoke test: opened the real, unmodified `rishab guj` project and confirmed its captions still load correctly.

## 19. Production DB comparison

Backed up `subly.db` to `subly.db.bak-pre-p12-review-workflow-qa` before QA. After the duplicate-analyze-navigate-delete cycle, a row-level JSON comparison (Project, Subtitle, VideoAsset, ExportJob, SubtitlePreset — excluding only `updatedAt`) showed:

```
Project: before=19 after=19 diffs=0
Subtitle: before=2266 after=2266 diffs=0
VideoAsset: before=19 after=19 diffs=0
ExportJob: before=46 after=46 diffs=0
SubtitlePreset: before=0 after=0 diffs=0
TOTAL_DIFFS 0
```

Byte-identical. Backup file and the comparison script were deleted after use.

## 20. Installer size/path

`release/SUBLY Setup 0.1.13.exe` — **566,402,126 bytes** (~540 MB), with `SUBLY Setup 0.1.13.exe.blockmap` at 571,891 bytes. EXE `FileVersion`/`ProductVersion` and the installer's own `FileVersion`/`ProductVersion` both confirmed `0.1.13`; the compiled JS bundle contains the literal baked-in string `"SUBLY Desktop v0.1.13"` (grepped directly from the installed app's `resources/app-server/.next/static/chunks/`).

## 21. Known limitations

- The virtualized scroll-to-index jump remains an ESTIMATE-based calculation (`ROW_HEIGHT_ESTIMATE`), not a measured one. The §12 rAF-retry fix substantially reduces the worst-case error (measured ~110px → ~45px at the tail of a 199-caption list) but does not eliminate it — a caption whose actual rendered height differs meaningfully from the estimate (very long text, many word chips, an active stale-timing warning) can still land a few dozen pixels short of full visibility after navigating deep into a very long list. This is an accepted, pre-existing tradeoff of the estimated-row-height virtualization architecture (documented in `captions-panel.tsx`'s own `ROW_HEIGHT_ESTIMATE` comment before this task), not a regression introduced here.
- `classifyCaptionContent`'s short/suspicious-short split (from P11, unchanged) remains a coarse, script-agnostic length heuristic — inherited, not something P12 was asked to revisit.
- No category-filtering UI was added for the Timing/Text/Style summary rows (they remain static counts) — the existing UI never supported filtering, and this task's own instructions explicitly said not to introduce one.
- The "reviewed" count is a pure navigation-visit tracker (has the reviewer's cursor passed over this issue), not a confirmation that the reviewer took any particular action on it — matching the task's own "optionally reviewed issue IDs if this can be safely maintained in existing client state" framing, which asked for tracking, not a richer review/approval workflow.

## 22. Deferred / non-goals (explicitly out of scope per the task spec, confirmed untouched)

Redesigning the quality panel, AI-assisted review, automatic rewriting, a new quality score or ranking, cloud/collaboration features, any database schema change (none was needed), disabling virtualization, automatic analysis on every keystroke (the report only ever changes on an explicit Analyze/Analyze Again click or the export dialog's own "Check now"), fabricated word-level issues (only the one genuinely word-targeted type carries a `wordIndex`), and weakened stale-report semantics (if anything, the fix-flow change makes staleness MORE authoritative, since a fix no longer silently launders a stale report back into looking current).
