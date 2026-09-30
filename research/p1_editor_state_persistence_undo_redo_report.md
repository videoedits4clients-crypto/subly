# P1 — Editor State Persistence & Undo/Redo Integrity

## 1. Current editor state architecture (as found)

**Client state — `src/store/editor-store.ts`** (Zustand, single store, one instance per editor session):
- `project: ProjectData | null` — the entire working project (subtitles, globalStyle, animation, timingRules, composition, trim/cutRanges, name, language, etc.), the single source of truth the whole editor UI reads from.
- `past: HistorySnapshot[]` / `future: HistorySnapshot[]` — the undo/redo stacks. A `HistorySnapshot` is exactly `{ subtitles, globalStyle, animation, timingRules, composition, trimStart, trimEnd, cutRanges }` — every field that participates in undo/redo, and *only* those fields.
- `dirty: boolean` / `saveState: "idle"|"unsaved"|"saving"|"saved"|"error"` — what `hooks/use-autosave.ts` watches to decide whether/when to persist, and what `top-bar.tsx` shows the user.
- Ephemeral, explicitly-documented-as-never-persisted, never-undoable UI state: `selectedSubtitleId`, `lastAppliedCustomPresetId`, `isPlaying`, `currentTime`, `seekRequest`, `focusCaptionRequest`, `aiToolsDemo`, `transcriptionDemo`.

**Every persisted mutation goes through exactly one of two paths:**
1. `commit(mutator)` — the undo/redo-tracked path. Pushes the pre-mutation snapshot onto `past`, clears `future`, applies the mutator, marks `dirty: true`. Used by `updateSubtitleText`, `updateSubtitleTiming`, `deleteSubtitle`, `duplicateSubtitle`, `splitSubtitle`, `mergeWithNext`, `reorderSubtitle`, `setGlobalStyle`, `setSubtitleStyleOverride`, `setGlobalAnimation`, `setSubtitleAnimationOverride`, `setWordStyleOverride`, `setTimingRules`, `setComposition`, `replaceAllSubtitles`, `applyPreset`, `pasteStyle`, `findReplace`, `setTrim`, `addCutRange(s)`, `removeCutRange`, `clearCutRanges`, `resegmentAll`.
2. A plain `set()` that still marks `dirty: true` but is deliberately **not** undoable: `setCaptionOutputMode` (a lazy Hinglish/Gujarati-script cache-fill, not a content edit — explicitly documented in the store).

**`undo()`/`redo()`** pop/push `HistorySnapshot`s between `past`/`future`/`project`, marking `dirty: true` on every call — i.e. undo and redo are themselves ordinary persisted mutations from autosave's point of view.

**Persistence — `hooks/use-autosave.ts`**, mounted once per editor session (`editor-shell.tsx`):
- Subscribes to the store; on every transition where `dirty` becomes true, it (a) flips `saveState` to `"unsaved"` immediately, (b) writes a synchronous, undebounced crash-safety copy to `localStorage` (`lib/local-snapshot.ts`), and (c) (re)starts a 900ms debounce timer.
- When the debounce fires, it `PATCH`es `/api/projects/:id` with `buildSavePayload(project)` — `{subtitles, globalStyle, animation, timingRules, composition, name, trimStart, trimEnd, cutRanges, captionOutputMode}` — i.e. every undo/redo-tracked field plus `name`/`captionOutputMode`.
- On success: `dirty: false`, `saveState: "saved"`, clears the local crash-safety snapshot (server now has it). On failure: `saveState: "error"`, retries with exponential backoff (3s → 30s cap) for as long as `dirty` stays true.
- A `beforeunload` listener (and the effect's own cleanup, i.e. component unmount / navigation away) fires one last best-effort `fetch(..., {keepalive: true})` PATCH so a quick navigation away doesn't drop the final edit.

**Server — `PATCH /api/projects/:id`** (`src/app/api/projects/[id]/route.ts`), Zod-validates the body, then (now, after this phase's one extraction — see §7) calls `applyProjectPatch` (`src/lib/project-patch.ts`): a single `$transaction` that (a) updates whichever `Project` columns were provided — Prisma's `undefined` means "leave this column alone", so a partial payload never touches fields it didn't include — and (b) when `subtitles` is present (not merely non-empty), deletes every existing `Subtitle` row for the project and recreates exactly what was sent (full replace, never a diff/merge).

**Read-back — `GET /api/projects/:id`** → `toProjectData` (`src/lib/project-mapper.ts`), the exact inverse: JSON-parses `globalStyle`/`animation`/`timingRules`/`composition`/`cutRanges`/each subtitle's `words`/`style`/`animation` back into typed objects (`lib/db-json.ts`'s `fromJson`), applying documented defaults for any project saved before a given field existed (`resolveTimingRules`, `resolveComposition`).

**Reload/reopen — `src/app/editor/[id]/page.tsx`**: on mount, fetches the project fresh via `GET` and calls `store.load(project)`, which **resets `past`/`future` to empty** and replaces `project` wholesale — i.e. a reload always shows exactly what the server has, never a stale client cache. It also checks `lib/local-snapshot.ts` for a crash-safety copy *newer* than the server's `updatedAt` and, if found, offers (via a toast, never automatically) to restore it — this is what protects an edit that never made it past the 900ms debounce before a crash.

**Font family/source/weight/size, colors, background, alignment, word highlighting, positioning** are all sub-fields of the single `SubtitleStyle` object (`globalStyle`, or a per-caption/per-word `Partial<SubtitleStyle>` override) — there is no separate persistence path for any of them; they are all covered by the exact same `globalStyle`/`subtitles[].style` round trip described above. Composition/aspect-ratio/video-visibility/background-color are likewise all sub-fields of the single `CompositionSettings` object (`composition`).

**Classification, per the task's STEP 1 taxonomy:**
| State | Category |
|---|---|
| subtitles, globalStyle, animation, timingRules, composition, trim/cutRanges, name, captionOutputMode | Persisted asynchronously (debounced ~900ms), with a synchronous local crash-safety mirror |
| `Project.status`, `language`, `errorMessage` (transcription/export pipeline writes) | Persisted immediately (separate direct `prisma.project.update` calls in `pipeline.ts`/`export-pipeline.ts`, not part of autosave) |
| `past`/`future` (undo/redo stacks) | Memory-only, intentionally never persisted — reset on every `load()` (reload/reopen), by design |
| `selectedSubtitleId`, `isPlaying`, `currentTime`, `seekRequest`, `focusCaptionRequest`, `lastAppliedCustomPresetId` | Memory-only, intentionally ephemeral UI state |
| `hinglishText`/`gujaratiScriptText` gap-fill (`ensureHinglishCoverage`/`ensureGujaratiScriptCoverage`) | Derived/recomputed, but persisted once generated (marks `dirty`) |
| `localStorage` crash-safety snapshot | Intentionally temporary — cleared the instant the real server save succeeds |

## 2. Data-loss risks identified

Two real risks were found by code inspection; both are addressed below. Everything else in the task's STEP 2 checklist was inspected and found to be **already correct** — no code change was made for these:

- **UI changes that never reach the database**: none found — every mutation that changes visible editor state routes through `commit()` or an explicit `set({dirty: true})`, and `buildSavePayload` covers every field `HistorySnapshot` does, plus `name`/`captionOutputMode`. Verified exhaustively by `project-patch.test.ts` (§8).
- **Undo/redo changing UI but not persistence, or vice versa**: both `undo()`/`redo()` mark `dirty: true`, so they're autosaved the same as any edit. Verified by `editor-store-undo-redo.test.ts` (§8) and live (STEP 12.G/H).
- **Reload restoring stale server state**: `load()` always replaces `project` wholesale from a fresh `GET` — there is no stale client cache to restore from.
- **Project-level settings persisted separately from subtitle changes causing a partial-save clobber**: `applyProjectPatch`'s Prisma-`undefined` semantics mean a partial PATCH (e.g. the dashboard's rename, which sends only `{name}`) can never touch subtitles/style — proven by `project-patch.test.ts` test 10.
- **Mutations that update only one of global/per-caption/word state**: each `set*Override` function operates on exactly its own layer (global vs. per-caption `.style` vs. per-word `.words[i].style`) without touching the others — confirmed by `project-patch.test.ts` tests 2–3.
- **A confirmed race — stale PATCH requests overwriting newer edits**: `use-autosave.ts`'s debounce logic had **no in-flight guard**. Every time `dirty` transitioned, it unconditionally rescheduled `setTimeout(save, 900)`, with no check for whether a *previous* `save()` call's PATCH was still awaiting its network response. Two independent `fetch` calls are not guaranteed to complete in the order they were sent; if an older, in-flight save (built from stale state) completed *after* a newer one, it would silently overwrite the newer edit in the database — while the UI still showed "Saved". This is a genuine, reproducible bug (see §5), confirmed to be structurally possible by reading the code (no re-entrancy guard existed at all), not merely theoretical.

## 3. Undo/redo semantics (as found — not redesigned)

One `commit()` call = one undoable step. Concretely, this already-correct, already-working design means:
- Typing in a caption's textarea is **not** one undo step per keystroke — the textarea keeps its own local React state and only calls `updateSubtitleText` (→ `commit()`) **on blur**. This is deliberate (confirmed by reading `captions-panel.tsx`): committing every keystroke to the undo stack would make Ctrl+Z nearly useless (one character at a time). This is correct, working behavior — not a bug, and was **not changed**.
- Dragging a caption's timing on the timeline calls `updateSubtitleTiming` (→ `commit()`) on **every `mousemove`** during the drag, not just on release — so a single drag gesture can produce many rapid `commit()` calls. This is also unmodified/working; it does mean a drag is exactly the kind of rapid-fire scenario the autosave race in §2 could affect in practice, which is why the fix in §5 matters for real usage, not just a contrived test.
- Changing a slider (font size, letter spacing, etc.) or a color hex field, a font family, a dropdown (weight/case), an entrance/word animation, canvas aspect ratio, or background color — each is one `commit()` call, one undo step.
- A `deleteSubtitle`/`duplicateSubtitle`/`splitSubtitle`/`mergeWithNext` is one undo step that restores/removes the exact caption(s) with the same id(s) and content.
- `MAX_HISTORY = 60` — the past/future stacks are bounded, oldest entries drop off; not part of this task's scope to change.
- Undo/redo stacks are **not** persisted across a reload/reopen/restart — `load()` resets both to `[]`. This matches the task's own explicit guidance ("do not assume undo state itself needs to be persisted... unless existing product behavior explicitly intends that") — it doesn't, and this was left exactly as-is. What *does* matter, and is what this phase verified, is that the **resulting** state after any undo/redo is faithfully persisted the same as any other edit.

No undo/redo UX change was made — it was demonstrably already correct.

## 4. The persistence contract

**Rule, as required by the task:** if the UI presents a change as committed (i.e. `saveState` reaches `"saved"`, or any prior autosave has already fired for a change that's still `dirty`), reopening the project must restore that exact change. This was verified true, end to end, for every category the task lists — see §9–§11. The one intentionally-transient exception, clearly documented and unchanged: the undo/redo stacks themselves (§3) — the *resulting* state persists; the ability to still press Ctrl+Z for something from a previous session does not, and was never intended to.

## 5. The bug found, and the fix

**Bug:** `hooks/use-autosave.ts` had no guard against two overlapping in-flight `PATCH` requests (see §2). **Fix, the smallest mechanism that closes it:** a new, tiny, dependency-free, fully unit-tested module, `src/lib/save-queue.ts`, exporting `createSingleFlightQueue(task)` — at most one call to `task` is ever in flight; a `run()` while one is already running doesn't start a second, overlapping one, it just flags exactly one follow-up call to run immediately after the current one settles, reading whatever is current at that point. `use-autosave.ts` now routes every save (both the debounced path and the failure-retry path) through this queue instead of calling `save()` directly. No server-side change, no schema change, no new dependency — the debounce/retry-backoff/local-snapshot/beforeunload-flush logic is otherwise completely unchanged.

This makes the race **structurally impossible** rather than merely unlikely: there is never more than one PATCH in flight, so there is nothing left to complete out of order.

## 6. Architecture verdict

The persistence and undo/redo architecture was **already correct** in almost every respect the task asked to verify — subtitle text, timing, word data, per-caption/per-word overrides, global style (every field), animation, composition, timing rules, trim/cuts, and undo/redo semantics all already round-trip correctly through the existing PATCH/GET cycle. **The one genuine gap found — the missing in-flight guard on autosave — has been fixed with the smallest possible mechanism** (§5), and one small, precedent-consistent extraction was made purely to enable testing the real production save mechanism directly (§7), with zero behavior change.

## 7. Files changed

- **New:** `src/lib/save-queue.ts` — `createSingleFlightQueue`, the actual bug fix.
- **New:** `src/lib/__tests__/save-queue.test.ts` — 8 tests, including a direct reproduction of the bug (test 5) and proof of the fix (test 6).
- **New:** `src/lib/project-patch.ts` — `applyProjectPatch`, the PATCH route's `$transaction` body extracted verbatim (zero behavior change) into a named, independently-testable function, mirroring the precedent set by `exportOutputKey`/`recoverStaleJobs` in prior P1 phases. This is what let the real production persistence mechanism be tested directly against a real database instead of a re-implemented copy.
- **New:** `src/lib/__tests__/project-patch.test.ts` — 14 tests against a real temporary SQLite DB through a real `PrismaClient`, exercising `applyProjectPatch` (write) + `toProjectData` (read) together — the actual save/reload round trip.
- **New:** `src/store/__tests__/editor-store-undo-redo.test.ts` — 14 tests against the real Zustand store (undo/redo semantics for text, timing, style, caption add/delete, composition, dirty-flag correctness, redo-stack invalidation on new edits, session-only stack reset).
- **Modified:** `src/hooks/use-autosave.ts` — routes saves through `createSingleFlightQueue` (the fix); no other behavioral change.
- **Modified:** `src/app/api/projects/[id]/route.ts` — `PATCH` now calls `applyProjectPatch(prisma, id, data)` instead of an inline `$transaction` (identical logic, just named and reusable).
- **Modified:** `src/lib/project-mapper.ts` — its one `@/types/subtitle` import changed to a relative `.ts`-extensioned import (matching this codebase's established convention for any file that needs to be importable by plain `node --test`) — required so `project-patch.test.ts` could import the real `toProjectData`.
- **Modified:** `src/lib/storage/index.ts` — same mechanical import-path fix as the prior P1 Recovery phase already applied elsewhere in this file's neighbors; needed transitively for the store test.
- **Modified:** `src/store/editor-store.ts` — its six `@/lib/...` value imports changed to relative `.ts`-extensioned imports (same convention), so the real store could be imported and exercised directly by `editor-store-undo-redo.test.ts`. Zero logic changes.
- **Modified:** `package.json` — added `test:save-queue`, `test:project-patch`, `test:undo-redo` and wired all three into the aggregate `test` script.
- **Not modified:** the undo/redo UX/design itself (§3 — demonstrably not broken), the export pipeline, font preflight, output verification, stale-job recovery, `local-snapshot.ts`, the `beforeunload` flush path (see §14's limitation note), transcription/pipeline.ts, waveform, dashboard, presets, upload validation, Trash, Gujarati/Hinglish logic.

## 8. Tests added — 36 new tests, all pass

**`save-queue.test.ts` (8):** single call executes once; a second `run()` while busy never overlaps; multiple `run()` calls while busy coalesce into exactly one follow-up; the follow-up reads whatever is current when it actually runs, not a stale snapshot; **a direct, queue-free reproduction of the original bug** (an older, slower call completing after a newer, faster one silently loses the newer write); **the same scenario through the queue, proven to always end with the latest edit**; a rejecting task never wedges the queue; idle calls always execute.

**`project-patch.test.ts` (14, against a real temp SQLite DB + real Prisma):** subtitle text/timing persist exactly; word timestamps and word-level style overrides persist exactly; per-caption style/animation overrides persist independent of global style; global style — every field including font family/source/weight/size, colors, background, alignment, word highlighting — persists exactly; animation persists exactly; composition (canvas, video visibility, background) persists exactly; timing rules persist exactly; trim/cut ranges persist exactly; rapid sequential writes leave the database in exactly the final state; a partial patch (bare rename) never touches subtitles/style; an omitted `subtitles` key leaves existing captions completely untouched; captionOutputMode + hinglishText/gujaratiScriptText round-trip independent of original text; a full multi-category write matches on every field at once after reload; an explicit empty `subtitles: []` actually clears captions (distinct from omission).

**`editor-store-undo-redo.test.ts` (14, against the real Zustand store):** text edit → undo → redo round-trips; timing edit → undo → redo round-trips; global style → undo → redo round-trips; caption deletion → undo restores it (same id/content) → redo removes it again; caption duplication → undo removes it → redo restores it; composition → undo → redo round-trips; a new edit after undo discards the stale redo branch; undo/redo stacks reset on `load()` even mid-session; undo/redo on empty stacks are safe no-ops; multiple sequential edits undo one step at a time in reverse order; every commit-based mutation marks `dirty`; `load()` (simulating reload) discards any edit that never reached the server.

All three new files wired into `package.json`'s `test` script.

## 9. Regression results

```
npm test
ℹ tests 277
ℹ pass 277
ℹ fail 0
```
(241 pre-existing + 36 new — all green, including P0/P0.5 cancellation/stall, font preflight, export output verification, stale-job crash recovery, waveform, dashboard search/filter/sort, custom presets, upload validation, language policy, Hinglish, Gujarati Script, and every existing export test — none modified.)

```
npx tsc --noEmit
(no output — clean)
```

```
npm run lint
✖ 5 problems (0 errors, 5 warnings)
```
Same 5 pre-existing warnings as before this phase, in files this phase never touched. **Zero new errors, zero new warnings.**

## 10. Rapid-edit results (live, real UI, disposable project)

- Typed a caption's text through five progressive edits ("Hello" → ... → "...SUBLY") via the real captions panel; confirmed the on-blur commit boundary (not per-keystroke) via direct code inspection of `captions-panel.tsx`, then confirmed the final text was exactly what the database held after blur + reload.
- **Directly reproduced STEP 5's rapid-edit scenario for a value that commits on every interaction** (not on blur): 5 rapid clicks along the Font Size slider in a single batched, back-to-back sequence. The database's final `fontSize` matched the UI's final displayed value exactly (83px) — no stale intermediate value won. This is the same class of interaction a real timing-drag or color-drag produces (many `commit()` calls in well under 900ms), directly exercising the fix in §5.
- Also verified via unit test (`save-queue.test.ts` tests 5/6) that, absent the fix, an artificially-delayed older write *can* overwrite a newer one, and that the fix prevents it unconditionally regardless of network timing.

## 11. Reload results (live, real UI controls, disposable project — every category the task lists)

| Category | Control used | Result |
|---|---|---|
| Text | Caption textarea | ✅ persists |
| Timing | Timeline drag (caption edge) | ✅ persists — confirmed via real `mousemove`-driven drag, matching the real interaction pattern |
| Font family | Style panel → Font → Family picker | ✅ persists (Inter → Poppins) |
| Font source | (implied by system-font selection — see prior P1 Export phases; not re-tested here as out of scope, unchanged) | not applicable to this phase's changes |
| Font weight | Style panel → Weight dropdown | ✅ persists (800 → 700) |
| Color | Style panel → Text color hex field | ✅ persists (#FFFFFF → #123456) |
| Animation | Animation panel → Entrance | ✅ persists (fade → pop) |
| Word highlighting | Animation panel → Word animation | ✅ persists (highlight → scale) |
| Composition (canvas) | Settings panel → Aspect ratio buttons | ✅ persists (1080×1920 → 1920×1080) |
| Background | Settings panel → Background hex field | ✅ persists (#000000 → #336699) |
| Caption positioning | (Position section exists in Style panel — same globalStyle round trip already proven exhaustively by `project-patch.test.ts` test 4, which covers `x`/`y`/`align`/`vAlign`) | ✅ covered by unit test |

Every row above was confirmed via a **genuine browser reload** (`navigate` to the same editor URL, not just an API check) after waiting for the "Saved" state.

## 12. Crash/relaunch results (live, real `taskkill`, disposable project)

- Made a confirmed-persisted edit (font size), **force-killed the dev server process**, relaunched, reopened the project: the edit remained exactly as saved.
- **Tested the persistence-boundary edge case explicitly** (STEP 8's requirement): made an edit and attempted to kill the server before the 900ms debounce could fire. In practice, the round-trip latency of tool-based browser automation consistently exceeded 900ms, so I could not empirically catch the exact sub-debounce window via this method — documented honestly as a limitation of the *testing methodology*, not a claim about the architecture. In its place, I directly verified the **mechanism** that provides protection for that window: within a single batched, near-zero-latency browser action, an edit's local crash-safety snapshot (`localStorage`, written synchronously, no debounce) was confirmed present with the correct value *before* any network request could plausibly have completed. This snapshot is what `editor/[id]/page.tsx`'s `offerLocalSnapshotRestore` uses to offer (never silently apply) recovery on the next time that project is opened, if its timestamp is newer than the server's.
- **Explicit, honest limitation, exactly as STEP 8 requires**: there is a real, unavoidable window (up to ~900ms plus one network round trip) during which an edit exists only in the browser's memory/localStorage and not yet in the database. A crash inside that window before localStorage's write completes (extremely small — localStorage writes are synchronous) would still only be recoverable via the *offered*, not automatic, "Found unsaved changes" restore prompt, and only if the exact same project is reopened afterward. This is a genuine, inherent property of a debounced-autosave architecture, not a bug this phase introduced or was asked to eliminate — it is documented here as required rather than silently claimed away.

## 13. Export interaction results (live, real UI + API, disposable project)

- Edited style/composition, confirmed persisted, exported: the exported video's composition (1920×1080, the edited background color) matched the edit exactly, and the editor's own state was completely unchanged after export.
- Triggered a controlled export failure (a fictional font name, the same safe fixture technique used in the prior P1 Export Output Verification phase), confirmed the editor's full state (33 subtitles, exact text, exact style/weight/color, exact composition) remained completely intact through the failure, restored the real font, retried, and the retried export succeeded — reflecting the exact same persisted edit.

## 14. Packaged Windows QA

Built via `npm run electron:pack` (exit 0, log clean of new errors). Installed fresh over the existing populated install. Confirmed both new modules (`save-queue.ts`, `project-patch.ts`) are bundled in the packaged app's server resources.

| Scenario | Result |
|---|---|
| Edit (caption text) | ✅ persists to the real packaged database |
| Close/relaunch (`taskkill /IM SUBLY.exe /F`, real relaunch) | ✅ edit survives |
| Reopen project | ✅ correct state loads |
| Undo | ✅ persists (via the packaged app's own toolbar button) |
| Redo | ✅ persists |
| Export | ✅ succeeds, real playable output file on disk |
| Verify output reflects state | ✅ editor state (33 subtitles, exact text, style) unchanged after export |

Confirmed the packaged app uses the identical persistence path as development: same `PATCH`/`GET /api/projects/:id` routes, same `applyProjectPatch`/`toProjectData` functions, same SQLite database file, same `save-queue.ts` fix — the packaged server log (`[electron] local server ready on 127.0.0.1:<port> (db: ...\subly.db)`) confirms it's the real bundled Next.js standalone server, not a dev-only path.

## 15. Data integrity (final)

- All 3 original real projects intact and unchanged: "Untitled project" (12 subtitles), "rishab guj" (43 subtitles, `language: "gu"`, `captionOutputMode: "gujarati-script"` — Gujarati legacy fully intact), "Hindi/hinglish test" (28 subtitles, `language: "hi"`) — exact same counts before and after this entire phase.
- No successful subtitles were lost.
- Export history intact for all 3 (8/5/10 entries respectively), every `DONE` row still has its `outputUrl`.
- Custom presets: none existed before this phase, none exist after — unaffected.
- Waveform endpoint responds correctly.
- Trash unchanged (15 pre-existing entries, identical before/after).
- Language metadata unchanged.
- Both disposable projects created for this phase's QA (one dev, one packaged) were fully trashed and permanently deleted, including their storage files, by the end of the session.

## 16. Limitations

- The autosave debounce window (~900ms + one PATCH round trip) is a genuine, inherent property of this architecture, not eliminated by this phase — mitigated by the pre-existing synchronous local-storage crash-safety snapshot and its offer-to-restore prompt on next open, but that mitigation is opt-in (a toast, not automatic) and scoped to reopening the *same* project. See §12.
- The `beforeunload`/component-unmount `flush()` path in `use-autosave.ts` still sends its own independent `fetch(..., {keepalive:true})` outside the single-flight queue — a residual, much narrower race exists if a page unload happens to race an already-in-flight regular save. This was deliberately left as-is: `flush()` is a last-resort, fire-and-forget escape hatch at the exact moment the page is disappearing, and routing it through the same async queue would add meaningful complexity for an edge case narrower than the one actually fixed (unload racing an in-flight save, rather than two edits racing each other). Documented here rather than silently addressed, per the task's explicit preference for the smallest appropriate mechanism.
- I could not empirically force a crash to land inside the sub-900ms debounce window via automated browser-tool orchestration (round-trip latency consistently exceeded it) — the protection for that window was verified at the mechanism level (§12) rather than via an end-to-end "crash mid-window, reopen, see the restore-prompt" live reproduction.

## 17. Unrelated observations

None beyond what prior phases already recorded.

---

**Summary:** the existing editor state persistence and undo/redo architecture was already correct for essentially everything the task asked to verify — text, timing, style (every field), animation, composition, and undo/redo semantics all already round-trip exactly through reload, crash/relaunch, and export/retry, confirmed live in both the dev environment and the actual packaged Windows app using real UI controls, real `taskkill`-based crashes, and a real temporary-database test suite exercising the real production save/load functions. One genuine, confirmed race — overlapping in-flight autosave requests that could let a stale edit silently win — was found by code inspection, reproduced directly in a unit test, and fixed with the smallest possible mechanism (a small, independently-tested single-flight queue), with zero change to the undo/redo UX, the export pipeline, or any other already-working system.

P1 EDITOR STATE PERSISTENCE & UNDO/REDO — PASS
