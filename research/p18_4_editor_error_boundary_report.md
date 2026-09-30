# P18.4 — Editor Error Boundary & Recoverable UI Failure Hardening

## 1. Task ID
111026

## 2. Scope
Add a bounded, app-level React error boundary so a render-time exception shows a recovery screen instead of a blank white app, without altering persistence, autosave, undo/redo, or P18.2/P18.3's architecture. Pure UI resilience — not a general error-handling rewrite, no telemetry, no new persistence mechanism.

## 3. Baseline
Version 0.1.17. P18.1/P18.2/P18.3 complete (PASS). 1272/1272 tests, typecheck PASS, lint 0 errors / 5 pre-existing warnings, before this task.

## 4. Error-handling audit
- **No React error boundary existed anywhere** — confirmed by grepping the whole `src/` tree for `ErrorBoundary`, `componentDidCatch`, `getDerivedStateFromError`: zero hits. No Next.js `error.tsx`/`global-error.tsx` route-segment files either. This matches the P18 preflight's own finding exactly.
- **Root**: `app/layout.tsx` → `<Providers>` (`components/providers.tsx`) — `SessionProvider` + a `sonner` `Toaster` rendered as a sibling to `{children}`. No DOM wrapper of its own.
- **Editor route**: `app/editor/[id]/page.tsx` (`"use client"`) fetches the project in a `useEffect`, shows a loading spinner, `ProcessingScreen` (which already has its own "Something went wrong" retry UI for pipeline `ERROR` status — a *different*, pre-existing failure mode this task must not duplicate or reinterpret), or `EditorShell`.
- **Editor shell**: `components/editor/editor-shell.tsx` calls `useAutosave(projectId)` and `useKeyboardShortcuts()` **as hooks in its own body**, before returning JSX that renders `TopBar`/`LeftPanel`/`VideoCanvas`/`Timeline`/`RightPanel`/`MobileTabBar`. This is the single most important structural fact for boundary placement (see §9/§5).
- **Existing error handling is exclusively for async/event-handler paths** — every `try {` in `src/components/editor/*.tsx` (export-dialog, ai-menu, presets-panel, processing-screen, style-panel, language-switcher) wraps an API call or event handler, never a render path (React doesn't support try/catch for render errors — confirming the premise of this task). Autosave failures surface via `setSaveState("error")` (`use-autosave.ts`) with its own retry/backoff. Transcription/export failures surface via `ProcessingScreen`'s own status UI and `export-dialog.tsx`'s own error state. None of these needed to change.
- **Toast infrastructure**: `sonner`'s `Toaster`, rendered as a sibling of `{children}` in `Providers` — used throughout for async errors (`toast.error(...)`), untouched by this task.
- **Keyboard-shortcut/dialog guard**: `hooks/dialog-open-guard.ts`'s `isAnyDialogOpen()` — a pure DOM query for any `[role="dialog"]` element whose `data-state` isn't `"closed"` — is checked by `use-keyboard-shortcuts.ts` **immediately before every mutating shortcut** (undo, redo, select-all, split, merge, delete, ...; confirmed by reading the hook's full guard chain). This is the *existing dialog/keyboard guard system* Phase C asks the fallback to respect — reused directly (§6), not reimplemented.
- **Electron renderer**: `electron/main.js` has a main-process `uncaughtException` handler (Node-side, unrelated to renderer React errors) and no `render-process-gone`/renderer-crash handling. Out of scope: a full OS-level renderer crash is a different failure class than a caught React render exception, and no packaging-specific issue was found (§18).
- **Visual precedent**: `ProcessingScreen`'s own `status === "ERROR"` branch already renders almost exactly the fallback this task asks for — `bg-grid` background, a `size-14` `bg-danger/10 text-danger` circle with `AlertTriangle`, "Something went wrong" heading, `max-w-sm text-sm text-muted` body, and an outline/accent button pair (`Back to dashboard` / `Retry`). This is the established SUBLY visual language for a failure screen, deliberately mirrored (§6).
- **Local logging**: `lib/analytics.ts`'s `track()` is a product-analytics event log (`project_created`, `export_completed`, ...) with a `console.log`-by-default sink — not a diagnostic error logger. Repurposing it for crash diagnostics would be scope creep; this codebase's actual convention for diagnostics is a tagged `console.error("[tag] ...", err)` (seen in `lib/pipeline.ts`, `lib/fonts/server-font-cache.ts`) — that's what the boundary uses (§8).

## 5. Boundary placement decision
**Two instances of one reusable component** — the minimal structure the task itself offered as an option, refined:
1. **App-level** (`scope="app"`): in `Providers`, wrapping `{children}` (inside `SessionProvider`, before the sibling `Toaster`). Catches anything not already inside the editor's own boundary — dashboard, auth, upload flow.
2. **Editor-scoped** (`scope="editor"`): inside `EditorShell`, wrapping everything it renders (`TopBar` through `MobileTabBar`) — *not* wrapping `<EditorShell>` itself from the page. This is the critical placement decision: `useAutosave`/`useKeyboardShortcuts` are called in `EditorShell`'s own body, above where the boundary's `children` prop is evaluated. A render error in any panel unmounts only the boundary's subtree; `EditorShell` itself never throws, so those two hooks — and the Zustand store subscription autosave runs on — keep running completely undisturbed while the fallback shows (§9).

No third (dashboard-specific) boundary: the app-level instance already covers the dashboard, and a dashboard-only boundary nested under the app-level one would be exactly the "unnecessary nested boundary" the task warns against.

`EditorShellContent` was extracted as a small internal component purely so the two hook calls could stay in `EditorShell`'s own body while the ErrorBoundary wraps everything else — not a new abstraction, just where the JSX had to move to keep the hooks outside it.

## 6. Recovery semantics
- **Try again**: `this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))`. The children are rendered inside `<Fragment key={this.state.resetKey}>` — bumping the key forces React to fully remount the subtree (fresh component instances, not just a re-render of the same ones that crashed) with **zero extra DOM node** (a Fragment's `key` doesn't render an element). Touches only this component's own local state — no store, no Prisma, no autosave, no undo/redo call. Hidden for the narrow class of errors `isRecoverableRenderError` flags as not fixable by a bare remount (chunk-load failures, stack overflow) — "Reload" always remains available regardless.
- **Reload editor / Reload**: `window.location.reload()` — a genuine full browser reload, re-running the editor route's normal fetch-and-load flow (`app/editor/[id]/page.tsx`'s `useEffect`) from scratch, exactly like the user pressing F5. Never reconstructs or rewrites project data itself.
- **Return to dashboard** (editor scope only): `router.push("/dashboard")` via `next/navigation`'s `useRouter` — "normal navigation," not a raw `location.href` assignment (which Next's own `@next/next/no-location-assign-relative-destination` lint rule flags for internal routes, and which this implementation was actually caught and corrected by during verification, see §14). Because `useRouter` is a hook and the boundary itself must be a class component, the exported `ErrorBoundary` is a thin function-component wrapper that supplies `onReturnToDashboard` as a prop to the actual class (`ErrorBoundaryImpl`).

## 7. Diagnostic helper
`src/lib/errors/react-error.ts` — pure, no React import:
- `formatReactError(error: unknown): { message, detail? }` — handles `Error` instances (message, falling back to `name` if empty; a short one-line `detail` from the *first* stack frame only, never the full trace), plain string throws, `null`/`undefined`, and arbitrary thrown objects (best-effort bounded `JSON.stringify`, wrapped in try/catch so a circular object can never make formatting itself throw). Every message is truncated to 500 characters.
- `isRecoverableRenderError(error: unknown): boolean` — defaults to `true` (optimistic: a needless "Try again" is harmless, a hidden working recovery path is not); returns `false` only for `ChunkLoadError`/"Loading chunk ... failed" (stale-deploy chunk mismatches, where remounting fetches the exact same missing chunk and fails identically) and stack-overflow `RangeError`s.

## 8. Implementation
- **`src/components/error-boundary.tsx`** — `ErrorBoundaryImpl` (class: `getDerivedStateFromError`, `componentDidCatch` → `console.error("[error-boundary]", error, info.componentStack)`, matching the codebase's existing tagged-console-error convention, not `analytics.ts`'s `track()`) + the exported `ErrorBoundary` function-component wrapper (§6). Fallback markup: `role="dialog"` `data-state="open"` `aria-modal="true"` root (see §9 for why), the `ProcessingScreen`-matching visual treatment, the formatted message/detail, and the three action buttons gated by `scope`/`isRecoverableRenderError`.
- **`src/components/dev-crash-test.tsx`** — the Phase 4 controlled-failure trigger (§11).
- **`src/components/providers.tsx`** — wraps `{children}` in `<ErrorBoundary scope="app">`.
- **`src/components/editor/editor-shell.tsx`** — hooks stay in `EditorShell`; its JSX became `<ErrorBoundary scope="editor"><EditorShellContent .../></ErrorBoundary>`; `<DevCrashTest />` mounted at the top of `EditorShellContent` (inside the boundary).
- **No changes** to `editor-store.ts`, `use-autosave.ts`, `use-keyboard-shortcuts.ts`, `dialog-open-guard.ts`, Prisma schema, or any P18.1/P18.2/P18.3 file.

## 9. Persistence safety
- `ErrorBoundaryImpl` never imports or calls anything from `editor-store.ts`, `lib/db`, `lib/save-queue.ts`, or `lib/local-snapshot.ts`. Its entire state is `{ error, resetKey }`, local to the component.
- Because the boundary sits **below** `useAutosave`/`useKeyboardShortcuts` in `EditorShell`'s own body (§5), a caught render error never unmounts those hooks — autosave's store subscription and debounce/retry timers keep running exactly as before; the `dirty` flag and undo/redo (`past`/`future` arrays in `editor-store.ts`) are completely untouched by a catch, a "Try again," a "Reload," or a "Return to dashboard."
- Verified live (§11): a deliberate crash produced **zero** `PATCH /api/projects/:id` requests (only pre-existing `GET`s), and the database's `Subtitle.words` for the crash-test project were byte-identical before and after the entire QA sequence (crash → Try again → Reload → Return to dashboard → reopen).

## 10. P18.2/P18.3 compatibility
- Exactly two `ErrorBoundary` instances exist in the whole app — not one per panel, row, or caption. Both sit **above** `CaptionRow`/`TimelineCaptionBlock`/virtualization (the editor instance wraps the entire shell, once), so P18.2's memoization/stable-callback/virtualization architecture gained one more ancestor component total, nothing per-row.
- P18.3's word-style architecture (`setWordStyleOverride`, `WordTimingPopover`'s Bold toggle) is untouched code and was re-verified live inside the post-implementation editor (§13): a word's "Bold on — word override" state rendered correctly.
- Full test suite (§14) includes P18.2's own `caption-row-render-stability.test.ts` and P18.3's `word-style-capabilities.test.ts` — both still pass unmodified.

## 11. Controlled failure QA
`src/components/dev-crash-test.tsx` — gated on `process.env.NODE_ENV === "production"` returning `null` immediately (a compile-time constant Next.js dead-code-eliminates from the production bundle entirely, not merely a runtime check — the `useSearchParams`/`throw` code doesn't exist in a production build at all), mounted inside the editor's boundary. In development, visiting `/editor/:id?__crashTest=1` throws a deliberate `Error` during render.

Live QA against the dev server, using the P18.3 QA project (`p18-3-bold-export-qa`, a real 12s video, two captions, one word with an explicit `fontWeight: 700` override):

1. Editor loads normally without the query param — confirmed (screenshot, clean console on a fresh tab).
2. Navigated to `?__crashTest=1` — the editor-scoped fallback appeared: "Something went wrong," the editor-specific explanation, the exact thrown message, a one-line stack-frame detail, and all three buttons (recoverable error → "Try again" shown).
3. Console showed exactly one `[error-boundary] Error: ...` diagnostic line (plus React's own automatic dev-mode logging, which fires regardless of any boundary) — useful, not excessive.
4. Database check: `Subtitle.words` unchanged.
5. Network check: only `GET` requests, no `PATCH`.
6. Clicked **Try again** — remounted and crashed again identically (the query param condition is still true) — this *proves* the remount actually happened (a stale/no-op click would have shown nothing different); this is the expected, correct outcome for a persistent (non-transient) test condition.
7. Clicked **Reload editor** — a real browser reload occurred (confirmed: URL retained the query param across the reload, and the crash reproduced identically from a cold reload, not from in-memory state).
8. Clicked **Return to dashboard** — navigated to `/dashboard`, which rendered normally (all 3 projects listed).
9. Reopened the editor **without** the crash param — loaded completely normally: both captions, both word chips, Style panel, timeline all present.
10. Final database check after the entire sequence: `Subtitle.words` for both captions byte-identical to before the crash test began, including the P18.3 Bold override.

All 10 items from Phase 4's checklist confirmed.

## 12. Regression QA
Per this task's own "do not repeat every historical QA scenario if unchanged" instruction, scoped to the editor shell and boundary placement:
- Dashboard: loads and lists projects correctly (via direct navigation and via "Return to dashboard").
- Editor opens, captions render, word chips render (confirmed via `read_page`).
- WordTimingPopover opens and P18.3's Bold control still shows correct "word override" state.
- Style panel (Font/Weight/Colors/Word highlight/Background/Outline/Shadow/Position sections) still renders.
- No new console errors on a fresh tab load (an earlier apparent `"Export ErrorBoundary doesn't exist"` error was investigated and confirmed to be a stale Turbopack HMR buffer artifact from mid-edit hot-reloads during implementation — reproduced as absent on a clean tab/dev-server restart, and the file's export was directly confirmed present via `grep`).
- Full automated suite (§14) covers autosave/undo/redo/reload-persistence/export logic at the unit level; this task did not re-run the full manual export/undo/redo click-through since none of that code was touched and P18.1–P18.3's own reports already cover it — the boundary's *persistence safety* specifically (not general editor functionality) was the focus, and was verified directly (§9, §11).

## 13. Performance
No per-row, per-word, or per-timeline-block boundary was added (§10) — the two instances are both static, once-per-app-lifetime component placements with no props that change per caption/word. `React.memo`'d `CaptionRow`/`TimelineCaptionBlock` are unaffected: the boundary is an ancestor, never re-rendered by caption-level state changes, and adds no render cost to the virtualized list itself. No new performance tests were added for this reason — there is no per-item operation to benchmark, unlike P18.3's `setWordStyleOverride`.

## 14. Tests added
- `src/lib/errors/__tests__/react-error.test.ts` — 18 tests: `formatReactError` (Error instance, empty message falls back to name, stack → short single-line detail not the full trace, no stack → no detail, string throw, empty string, null/undefined, arbitrary object, circular object never throws, long message/string truncation) and `isRecoverableRenderError` (ordinary Error/string/null/undefined default recoverable, `ChunkLoadError` by name, chunk-load message pattern without the exact name, stack-overflow `RangeError` unrecoverable, unrelated `RangeError` still recoverable).
- Registered in `package.json`'s `test` script.
- No React-rendering test framework was introduced (per Phase I's explicit instruction) — this repo has none, and this task didn't add one. The boundary's actual catch/render/reset behavior was verified through the controlled-failure live QA (§11) instead, which exercises the real class component in a real browser against a real thrown error — a stronger signal than a mocked unit test of React's own error-boundary lifecycle would have been.
- **Baseline 1272 → 1290** (1272 + 18). Zero tests deleted or weakened.

## 15. NOT TESTED items
- A deliberate crash of the **app-level** (`scope="app"`) boundary specifically — its wiring (correct import/export, renders `{children}` normally) was implicitly exercised on every single page load in this session (dashboard, editor, "Return to dashboard" navigations all round-tripped through it without incident), but no dedicated `?__crashTest=1`-style trigger was added outside the editor route. The underlying class component is identical to the editor instance, which *was* crash-tested directly.
- `ChunkLoadError`/stack-overflow-specific UI behavior (hiding "Try again") was unit-tested (`isRecoverableRenderError`) but not reproduced live — genuinely difficult to trigger deliberately in a dev server without faking a stale deploy.
- A crash inside `TopBar` specifically (vs. the `DevCrashTest` trigger, which is a sibling of `TopBar` inside the same boundary) — not separately verified, but architecturally identical (same boundary, same subtree) to what *was* tested.
- Full manual click-through of export/undo/redo/autosave-retry-on-network-failure — unchanged code, already covered by P18.1–P18.3's own live QA and this task's own unit suite; not repeated per the task's own scope guidance (§12).

## 16. Known limitations
- The fallback's "Try again" button is a blunt remount — it cannot know whether the specific condition that caused the crash has actually cleared (beyond the two `isRecoverableRenderError` cases it can detect), so a persistent bug will show the fallback again immediately after "Try again," same as it did in the live QA (§11 step 6). This is inherent to error boundaries in general, not specific to this implementation.
- `formatReactError`'s truncation is a length bound, not content-aware redaction — a thrown message that happened to interpolate project-specific text (caption content, filenames) would still show up (truncated) in the fallback's diagnostic line. No current throw site in this codebase does that, and the task's "avoid exposing sensitive project contents" is addressed by bounding length and never surfacing a full stack, not by content inspection.
- No telemetry/external reporting integration exists or was added, by design (explicitly prohibited by this task).

## 17. Protected systems
Not touched: Prisma schema, persistence architecture, autosave queue, save queue, local snapshot architecture, crash recovery, stale-job recovery, undo/redo architecture, subtitle mutation semantics, word timing authority, Original/Hinglish/Gujarati architecture, P18.3's word-style architecture, quality-report architecture, waveform/timeline math, virtualization, P18.2's memoization architecture, transcription/Whisper, FFmpeg/export worker, Electron packaging (checked, no packaging-specific issue found).

## 18. Packaging decision
NOT REQUIRED — pure React/Next UI change, no Electron/native code touched. Version kept at 0.1.17.

## 19. Final verification
- `npm test`: **1290/1290 PASS** (1272 baseline + 18 new).
- `npx tsc --noEmit`: **PASS**, 0 errors.
- `npx eslint .`: **PASS**, 0 errors, 5 pre-existing warnings (identical set to before this task; two new warnings surfaced during implementation — an unnecessary `eslint-disable` comment and Next's internal-navigation lint rule on a raw `location.href` — were both fixed, not suppressed).

## 20. Explicit P18.5 status
NOT STARTED.

---

TASK ID: 111026
STATUS: PASS
VERSION: 0.1.17
PRODUCTION CODE CHANGED: YES
DATABASE CHANGED: NO
TESTS: 1290/1290
TYPECHECK: PASS
LINT: PASS
PACKAGING: NOT REQUIRED
P18.5: NOT STARTED
