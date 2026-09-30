# P3 — Release Polish & Backend Boundary Hardening (Task ID 58314)

## 1. Executive summary

This phase had two narrow, unrelated goals, both completed and verified against a freshly built,
freshly installed Windows package: harden the `globalStyle` PATCH boundary so malformed input can
no longer crash export, and give SUBLY a real, branded Windows icon in place of the generic
Electron default.

**Part 1** traced the exact path a prior phase's audit had flagged — a raw `PATCH
/api/projects/:id` request could replace a project's entire `globalStyle` with a partial object,
which the API accepted without any structural validation (`z.record(z.string(), z.unknown())`,
i.e. "any object at all"), stored as-is, and which then crashed `lib/subtitles/ass.ts`'s
`assColorWithAlpha()` (`hex.trim()` on `undefined`) the next time that project was exported. The
crash was reproduced directly against the unmodified `ass.ts` before any fix, confirming the exact
reported stack trace. The fix adds two complementary, minimal layers — a normalization function
(`resolveGlobalStyle`, mirroring the codebase's own existing `resolveTimingRules`/
`resolveComposition` pattern) that fills any missing field from the canonical
`DEFAULT_SUBTITLE_STYLE`, and a structural zod schema (`globalStyleSchema`) that rejects a
wrong-*typed* field with a clear 400 before it's ever persisted — applied at both the read boundary
(`project-mapper.ts`, protecting against any already-corrupted data by any means) and the write
boundary (the PATCH route, stopping new bad data from being written at all). `ass.ts` itself was
not touched. 11 new focused tests plus 1 new integration test cover every scenario the task
specified; all pass, alongside the full existing suite (439/439).

**Part 2** first inspected the repository for an existing SUBLY brand asset — none exists as a
standalone image (the only icon-like file present, `src/app/favicon.ico`, is a generic
`create-next-app` default triangle, confirmed by rendering it). The app *does* have a real,
consistently-used mark, though: a gradient rounded-square chip with a white Lucide "Sparkles" glyph,
identical across the landing navbar, footer, dashboard sidebar, mobile tab bar, and every auth
page — the de facto SUBLY logo, just never exported as a standalone file. This was faithfully
reproduced (exact colors from `globals.css`'s `--accent`/`--accent-cyan`, exact glyph path data from
the installed `lucide-react` version, exact on-screen proportions) as `build/icon.svg`, wired into
`electron-builder`'s `win.icon` config, and verified end-to-end against a real, freshly built and
installed `.exe`: the installer icon, the installed `SUBLY.exe`'s own embedded icon resource, the
Start Menu shortcut, the Desktop shortcut, and the uninstaller all now show the real branded icon
(each verified by extracting the actual icon bytes from the real files/shortcuts, not by reading
config back). No new visual identity was invented.

A focused RC smoke test against the final build — launch, dashboard, create/upload/transcribe,
editor, a live malformed-style PATCH (accepted and normalized) immediately followed by a
fundamentally-invalid one (rejected with 400), animation change, export, SRT/VTT/TXT download,
restart, and reopen with full persistence — passed completely. Production data is confirmed
byte-for-byte unchanged across five tables.

## 2. Audit findings

- `src/types/subtitle.ts` already has an established, working pattern for exactly this class of
  problem: `resolveTimingRules()` and `resolveComposition()` both take a
  `Partial<T> | null | undefined` and merge it with a canonical `DEFAULT_*` constant. Neither
  `globalStyle` nor `animation` had an equivalent function — `project-mapper.ts` line 61 instead
  called `fromJson<SubtitleStyle>(project.globalStyle, DEFAULT_SUBTITLE_STYLE)`, and
  `lib/db-json.ts`'s `fromJson` only substitutes its fallback when the stored value is entirely
  absent or fails to parse as JSON — a syntactically valid but *incomplete* object passes straight
  through unchanged. This is the exact root cause: not a rendering bug, a missing normalization
  step at the read boundary.
- The PATCH route's `patchSchema` (`src/app/api/projects/[id]/route.ts`) validated `globalStyle`
  as `z.record(z.string(), z.unknown()).optional()` — structurally accepts any object with any
  keys/values, providing zero protection against a wrong-shaped or incomplete style payload. Every
  *other* field in the same schema (`language`, `status`, `aspectRatio`, etc.) has real structural
  validation; `globalStyle` (and, identically, `animation`, `timingRules`, `composition`) did not.
- `applyProjectPatch` (`src/lib/project-patch.ts`) is, by its own doc comment, "the single source
  of truth for what saving an editor change actually does to the database" and explicitly expects
  an *already-validated* payload — it JSON-stringifies whatever it's given with no checks. This
  confirmed validation belongs at the route layer, not inside this shared, already-tested function.
- Every real path that produces a `globalStyle` PATCH already sends a complete object:
  `editor-store.ts`'s `setGlobalStyle` merges a partial patch into the always-complete in-memory
  `snap.globalStyle` before it ever leaves the client; `use-autosave.ts` then sends that same
  complete `project.globalStyle` object, never a raw fragment. Every built-in preset
  (`lib/presets.ts`) and every custom preset (`lib/custom-presets.ts`) is typed and constructed as
  a complete `SubtitleStyle`. This confirms the malformed-payload path is real but genuinely
  unreachable through the actual UI — exactly as the prior audit had already established — and
  that a stricter API-level schema cannot break any of these legitimate call sites, since all of
  them already produce exactly what the new schema requires.
- No standalone SUBLY brand-image asset exists anywhere in the repository (`assets/` holds only
  the offline font-cache seed; a repo-wide search for `*logo*`/`*icon*`/`*brand*`/`*mark*` image
  files under 100KB found nothing else). `src/app/favicon.ico` was rendered and inspected directly
  — it is the generic black-circle-white-triangle Next.js/Vercel default favicon, not SUBLY
  branding.
- The in-app mark (gradient chip + Sparkles glyph) is used identically and consistently in 10
  files across the whole product (landing navbar/footer, dashboard sidebar, mobile tab bar,
  top bar, register/login pages, processing screen, AI menu) — confirmed by grep and by reading
  the navbar's exact markup (`size-7` box, `rounded-lg`, `bg-gradient-to-br from-accent to-accent-cyan`,
  a `size-4` white `Sparkles` icon centered inside).
- `sharp` (a full SVG-capable image library) is already present in `node_modules` as an
  `optionalDependency` of `next` itself (Next's own Image Optimization API depends on it) — used
  only for a one-time local preview render during this phase's icon design, never for the actual
  `.ico` generation and never added as a new project dependency.
- `electron-builder`'s own `app-builder-lib` ships a complete, already-integrated icon-conversion
  pipeline (`util/iconConverter.js`, `toolsets/icons.js`) that accepts a source SVG directly,
  rasterizes it, and produces every required Windows `.ico` resolution (16/24/32/48/64/128/256) —
  this is the "deterministic local build step/tool already appropriate to the repository" the task
  asked for; nothing was hand-rolled.

## 3. Malformed globalStyle reproduction

Reproduced directly against the unmodified `lib/subtitles/ass.ts`, before any fix, by calling its
exported `buildAssDocument()` with a malformed `globalStyle` (`{ fontFamily: "Montserrat", fontSize:
70 }` — the exact shape from the prior phase's own accidental discovery):

```
CRASHED AS EXPECTED: Cannot read properties of undefined (reading 'trim')
TypeError: Cannot read properties of undefined (reading 'trim')
    at assColorWithAlpha (ass.ts:43:43)
    at buildStyleLine (ass.ts:86:19)
    at buildAssDocument (ass.ts:305:23)
```

Separately reproduced through the real HTTP boundary (before the API-level fix): a raw `PATCH
/api/projects/:id` with `{ globalStyle: { fontFamily: "Montserrat", fontSize: 70 } }` was accepted
(200) and persisted verbatim; the very next export of that project reached the same crash. This is
the unreachable-via-UI, reachable-via-raw-API path the task described.

## 4. Root cause

`lib/db-json.ts`'s `fromJson<T>(value, fallback)` only substitutes `fallback` when `value` is
absent or fails to parse — a syntactically valid but structurally incomplete JSON object is
returned exactly as stored, with no merge against any default. `project-mapper.ts`'s
`toProjectData()` (the one function that turns every stored project row into the domain object
every consumer — preview, export, the API response — reads) called `fromJson` for `globalStyle`
with no normalization step afterward, and the PATCH route's own schema for `globalStyle` performed
no structural validation at all, so nothing anywhere between "a client sends a PATCH" and
"`assColorWithAlpha` reads `style.color`" ever verified that the object was complete. `ass.ts`'s
`buildStyleLine()` is typed to take a complete `SubtitleStyle` and, being TypeScript, that
guarantee is compile-time only — nothing re-checks it at runtime, which is exactly why data
reaching it already malformed crashes rather than degrading.

## 5. Defensive fix

Two complementary layers, both reusing `types/subtitle.ts`'s existing `DEFAULT_SUBTITLE_STYLE` as
the single source of truth — no new/arbitrary defaults were invented anywhere:

1. **`resolveGlobalStyle(parsed: Partial<SubtitleStyle> | null | undefined): SubtitleStyle`** —
   new function in `src/types/subtitle.ts`, immediately next to `resolveTimingRules`/
   `resolveComposition`, following their identical `{ ...DEFAULT, ...parsed }` pattern. A complete,
   valid style passed in comes back unchanged (every field already overrides the default); a
   partial one has every missing field filled from the canonical default; `null`/`undefined`
   returns `DEFAULT_SUBTITLE_STYLE` exactly.
   - Applied at the **read boundary**: `project-mapper.ts`'s `toProjectData()` now calls
     `resolveGlobalStyle(fromJson<Partial<SubtitleStyle> | undefined>(project.globalStyle,
     undefined))` instead of the old bare `fromJson`. This protects every consumer (preview
     rendering, export/`ass.ts`, the API's own `GET` response) regardless of how a malformed value
     might have reached the database — including data written before this fix existed.
2. **`globalStyleSchema`** — new file `src/lib/global-style-validation.ts`, a zod object schema
   with every `SubtitleStyle` field declared `.optional()` but structurally typed when present
   (numbers for numeric fields, booleans for the `*Enabled`/`wordHighlight` flags, the exact
   literal unions for `fontWeight`/`textCase`/`align`/`vAlign`, plain strings for every color
   field). A missing field is not an error (normalization handles it); a *wrong-typed* present
   field is. Colors are validated as `z.string()` only, not a strict hex pattern — `ass.ts`'s
   `assColorWithAlpha` already tolerates a non-hex-matching string gracefully via its own regex
   fallback (falls back to white internally, no crash), so the only actual gap being closed is the
   TYPE (`undefined` crashing `.trim()`), not the format.
   - Applied at the **write boundary**: `src/app/api/projects/[id]/route.ts`'s `patchSchema.
     globalStyle` now uses `globalStyleSchema.optional()` instead of the old permissive
     `z.record(...)`. If the whole payload including `globalStyle` still parses successfully, the
     route then calls `resolveGlobalStyle(data.globalStyle)` before handing it to
     `applyProjectPatch` — so what's *persisted* is always a complete style, not just what's
     *read*. A genuinely malformed field (wrong type, or `globalStyle` not even an object) fails
     `patchSchema.safeParse` and the route returns the same `{ error: "Invalid update payload." }`
     / 400 response every other invalid-field case already produces — a real, structured,
     pre-existing error contract, not a new one-off shape.

`lib/subtitles/ass.ts` was not modified in any way — `buildStyleLine`/`assColorWithAlpha` are
exactly as fragile as before; the fix is entirely about never letting malformed data reach them.

**Preserved, verified explicitly, not just assumed:**
- *Existing UI behavior* — the real Style panel always sends a complete `SubtitleStyle` (confirmed
  by reading `editor-store.ts`/`use-autosave.ts`, §2); the new, stricter schema changes nothing for
  it.
- *Existing preset behavior* — every built-in and custom preset is already typed/constructed as a
  complete `SubtitleStyle` (§2); unaffected.
- *Caption-level and word-level overrides* — `resolveStyle()` (`types/subtitle.ts`) merges
  `sub.style` on top of `project.globalStyle`; fixing `globalStyle` to always be complete means
  this merge always produces a complete result too, with zero changes to the per-caption/per-word
  override mechanism itself (`fromJson<Partial<SubtitleStyle> | undefined>` for `Subtitle.style`
  was deliberately left exactly as it was — a caption override is *supposed* to be partial).
- *Undo/redo* — entirely client-side (`editor-store.ts`'s command/history stack); nothing in this
  fix touches any client code.
- *Export behavior for valid projects* — test 11 (§6) directly confirms a complete, valid style
  produces byte-identical ASS output whether or not it's passed through `resolveGlobalStyle` first.

## 6. Tests added

`src/lib/subtitles/__tests__/global-style-robustness.test.ts` (new, 11 tests):

1. Complete valid `globalStyle` → `resolveGlobalStyle` returns it unchanged.
2. Missing color field → filled from `DEFAULT_SUBTITLE_STYLE`, everything else present preserved.
3. Missing multiple fields (the exact real-world malformed shape) → every missing field filled,
   present fields preserved, resulting object has the full canonical key count.
4. `null`/`undefined` → returns `DEFAULT_SUBTITLE_STYLE` exactly.
5. `globalStyleSchema` accepts a partial-but-correctly-typed object (missing fields are not an
   error).
6. `globalStyleSchema` rejects a wrong-typed known field (`color: 123`) — "fundamentally invalid."
7. `globalStyleSchema` rejects a non-object payload outright (string/number/`null`) — the
   raw-malformed-PATCH case.
8. `globalStyleSchema` rejects a wrong-typed enum field (`align: "middle"`).
9. `buildAssDocument` still crashes on a raw, un-normalized malformed style — proves `ass.ts`
   itself was not changed (a deliberate "before" regression guard).
10. `buildAssDocument` succeeds once the same malformed style is passed through
    `resolveGlobalStyle` first — the export path with the actual fix in effect; also asserts the
    submitted `fontFamily` genuinely survives into the ASS output, not just that nothing throws.
11. A complete, valid style produces byte-identical ASS output with or without going through
    `resolveGlobalStyle` — the existing-valid-style regression guard.

`src/lib/__tests__/project-patch.test.ts` (extended, +1 test, test 15): writes a raw, partial
`globalStyle` directly through `applyProjectPatch` — bypassing the route's own validation entirely,
simulating either legacy pre-fix data or any other future write path — and confirms
`toProjectData()`'s read-side `resolveGlobalStyle()` still heals it into a complete style on
reload, independent of how the bad data reached the database.

All 12 new/extended tests pass, alongside the full pre-existing suite. Registered in `package.json`
as `test:release-polish` and folded into the main `test` script.

## 7. Windows icon asset audit

| Candidate | Verdict |
|---|---|
| `src/app/favicon.ico` | Generic `create-next-app`/Vercel default (black circle, white triangle) — rendered and visually confirmed, not SUBLY branding. |
| `assets/` directory | Contains only `fonts-cache-seed/` (font files for offline export) — no image/brand assets. |
| Repo-wide search for logo/icon/brand/mark image files | No other candidates found. |
| In-app "Sparkles" gradient-chip mark | **A real, existing, consistently-used SUBLY mark** — not a standalone file, but identical markup (`bg-gradient-to-br from-accent to-accent-cyan` + white `lucide-react` `Sparkles` glyph) repeated verbatim across `landing/navbar.tsx`, `landing/footer.tsx`, `dashboard/sidebar.tsx`, `editor/mobile-tab-bar.tsx`, `editor/top-bar.tsx`, `(auth)/register/page.tsx`, `(auth)/login/page.tsx`, `editor/processing-screen.tsx`, `editor/ai-menu.tsx`, and `landing/features.tsx`. |

**Verdict: a suitable existing brand asset exists** (the in-app mark), just never exported as a
standalone image. Per the task's instruction, this was faithfully reproduced rather than treated
as "no asset exists" — reconstructing an already-established, product-wide visual identity from
its own exact markup/colors/glyph is not inventing a new one.

## 8. Icon implementation

- **New file `build/icon.svg`** — a 1024×1024 SVG: a rounded-rect (`rx`/`ry` = 293, matching the
  in-app chip's `rounded-lg`-on-`size-7` proportion, ≈28.6%) filled with a `linearGradient` from
  `#7c3aed` to `#22d3ee` (the exact `--accent`/`--accent-cyan` values from `src/app/globals.css`,
  top-left to bottom-right, matching Tailwind's `bg-gradient-to-br`), with the Lucide `Sparkles`
  glyph centered at ≈57% of the box (matching the in-app `size-4`-inside-`size-7` ratio), path data
  copied verbatim from the installed `lucide-react@1.41.0`'s own `sparkles.mjs` source, stroked in
  white with the exact same `stroke-width="2"`/round-cap/round-join attributes Lucide's own
  `createLucideIcon` uses by default.
- Rendered locally at 512/32/16px (via the already-present `sharp` optional dependency, for design
  review only — not part of the actual build pipeline) to confirm legibility before wiring it in;
  those preview files were deleted afterward, leaving only the source SVG in `build/`.
- **`package.json`**'s `build.win` block gained one line: `"icon": "build/icon.svg"`. No other
  packaging configuration was touched — `files`, `extraResources`, `afterPack`, `nsis`, and every
  other setting Task 47216 already validated are unchanged.
- electron-builder's own bundled icon-conversion tool (`app-builder-lib`'s `iconConverter.js` /
  `icons.js`) picked this up automatically at build time — confirmed live in the build log:
  `downloaded label=icons-bundle.tar.gz progress=100%`, and the previously-present-in-every-prior-
  build warning `default Electron icon is used  reason=application icon is not set` is **gone**
  from this build's log. No hand-rolled `.ico`-packing code was written.

## 9. Installer/executable/shortcut verification

All checks performed against a **freshly built** (`SUBLY Setup 0.1.2.exe`) and **freshly, silently
installed** copy — not by reading configuration back.

- **Generated `.ico`** (`release/.icon-ico/icon.ico`, electron-builder's own build-time cache):
  inspected directly — contains all 7 standard Windows resolutions (16, 24, 32, 48, 64, 128, 256),
  rendered and visually confirmed to be the correct gradient-chip-with-sparkle design.
- **Installer icon** (`SUBLY Setup 0.1.2.exe`): extracted the actual icon resource from the real
  installer file (`System.Drawing.Icon.ExtractAssociatedIcon`) — the SUBLY mark, not generic.
- **Installed `SUBLY.exe`'s own icon**: extracted directly from the real installed executable at
  `C:\Users\User\AppData\Local\Programs\SUBLY\SUBLY.exe` — the SUBLY mark.
- **Start Menu shortcut**: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\SUBLY.lnk` —
  `TargetPath`/`IconLocation` both point at the installed `SUBLY.exe,0`; icon extracted directly
  from the shortcut file — the SUBLY mark.
- **Desktop shortcut**: `%USERPROFILE%\Desktop\SUBLY.lnk` — identical result, SUBLY mark.
- **Uninstaller icon** (`Uninstall SUBLY.exe`, generated inside the install directory): extracted
  directly — the SUBLY mark.
- **Live, running app window**: a real OS-level screenshot of the actual Electron `BrowserWindow`
  (not the source config) shows the SUBLY mark in the window's title bar, cropped and zoomed for a
  clear close-up — legible and correctly colored even at the small title-bar size.
- **Windows file-version resource**: `SUBLY.exe`'s `VersionInfo` — `ProductName: SUBLY`,
  `FileVersion`/`ProductVersion: 0.1.2` (matching the version bump made for this phase's build),
  confirming the executable's version metadata is correctly populated. `CompanyName` reads the
  generic `GitHub, Inc.` (an artifact of `package.json` having no explicit `author` field —
  present and unchanged since the very first build in Task 47216, `author is missed in the
  package.json`, unrelated to icon branding and outside this task's two stated goals; not touched).

Every one of these was verified by extracting bytes from the real, on-disk artifact — never by
re-reading `package.json`'s `icon` setting and assuming it worked.

## 10. Full test/typecheck/lint results

- **Tests**: 439/439 passing (427 pre-existing + 12 new/extended this phase: 11 in
  `global-style-robustness.test.ts`, 1 added to `project-patch.test.ts`).
- **Typecheck**: `npm run typecheck` — 0 errors.
- **Lint**: `npm run lint` — 0 errors, 5 warnings, identical to the baseline that has been
  unchanged across every phase of this project (`project-card.tsx`'s unused `router`,
  `lib/ai/index.ts`'s unused `fallback`, `lib/analytics.ts`'s stale eslint-disable,
  `lib/subtitles/ass.ts`'s unused `lineDurSec`, `lib/subtitles/preview-style.ts`'s unused `scale`).
  0 new warnings — an initial draft of this phase's own test file introduced one (`_omit` unused
  destructure), caught by this same lint run, and fixed before proceeding.

## 11. Fresh installer build result

`npm run electron:pack` (the full `clean → worker:build → build → electron-builder` pipeline) run
fresh for this phase, version bumped `0.1.1` → `0.1.2` to clearly mark this as a distinct,
verifiable build. Completed successfully — confirmed via the established definitive completion
marker (`SUBLY Setup 0.1.2.exe.blockmap`, the literal last line electron-builder writes on
success), not a "process exited" heuristic. Final installer: `release/SUBLY Setup 0.1.2.exe`,
560MB.

## 12. Focused RC smoke test

Performed against the freshly installed `0.1.2` build (a genuinely fresh install — no prior
version was present on this machine at the time):

1. **Launch** — debug log confirms clean startup, server ready in ~5.5s.
2. **Dashboard** — `GET /api/projects` returns the 3 real active projects correctly.
3. **Create/open project** — new disposable project created, returned a real id.
4. **Upload** — real video uploaded and probed successfully.
5. **Transcription** — completed (`READY`, 48 real captions from real English speech).
6. **Editor** — project detail loads with full caption/style/animation data.
7. **Style** — a malformed (missing-fields) `globalStyle` PATCH was accepted (200) and correctly
   normalized to a complete 30-key style with `color` defaulted to `#FFFFFF`, submitted fields
   preserved — the Part 1 fix, exercised live in the packaged app. A second PATCH with a
   fundamentally invalid field (`color: 999`, wrong type) was correctly **rejected** (400,
   `{"error":"Invalid update payload."}`).
8. **Animation** — changed and persisted correctly.
9. **Export** — using the just-normalized (originally malformed) style, completed successfully
   (`DONE`/`complete`) — no crash, confirming the fix holds end-to-end through the real packaged
   export pipeline, not just in unit tests.
10. **Download** — SRT (2530 bytes), VTT (2403 bytes), TXT (907 bytes) all downloaded successfully.
11. **Restart** — full process kill and relaunch.
12. **Reopen project** — the smoke-test project's `status` (`EXPORTED`), normalized `globalStyle`
    (still 30 keys, `fontFamily: "Poppins"`, `color: "#FFFFFF"`), and `animation` all confirmed
    byte-identical after the restart.

All 12 steps passed. No regression was found, so — per the task's own instruction — the full
30-step RC cycle from Task 47216 was not repeated.

## 13. Production data integrity comparison

Backed up before any QA this phase: `subly.db.bak-pre-release-polish-qa`. Baseline captured via
direct SQL query: **18 projects, 46 export jobs, 0 custom presets** — matching Task 47216's own
final, verified state exactly.

All QA this phase used clearly disposable fixtures ("Malformed Style QA (disposable)", "Malformed
Style Export QA (disposable)", "RC Smoke Test 58314") and disposable copies of one existing QA
video. Every fixture was removed through the application's own normal Trash → permanent-delete
flow (`DELETE /api/projects/:id` then `DELETE /api/projects/:id/trash`), never by direct database
surgery.

Final comparison — every row of every relevant table, not just counts, excluding only the
`updatedAt` timestamp column:

| Table | Before | After | Row-for-row identical |
|---|---|---|---|
| Project | 18 | 18 | **Yes** |
| ExportJob | 46 | 46 | **Yes** |
| Subtitle | 2250 | 2250 | **Yes** |
| VideoAsset | 18 | 18 | **Yes** |
| SubtitlePreset | 0 | 0 | **Yes** |

No orphaned QA scripts or stray files remain in the repository (`git status --porcelain` confirmed
clean of any QA artifacts). The `build/` directory contains only the final `icon.svg` source —
every intermediate preview PNG generated during icon design was deleted.

## 14. Remaining limitations

- **`animation`, `timingRules`, and `composition` have the identical theoretical "partial JSON
  passes through `fromJson` unmerged" gap for `animation`** specifically (`timingRules` and
  `composition` already have their own `resolve*` merge functions, applied). `animation`'s fields
  (string enums, one number) are far less likely to crash a consumer the way an `undefined` color
  string does — no crash was demonstrated for it, and the task's explicit scope is `globalStyle`
  only. Noted here as a related, lower-risk observation rather than fixed, per "only fix
  demonstrated problems."
- **`CompanyName` in the Windows executable's version resource reads the generic `GitHub, Inc.`**
  (from `package.json` having no `author` field) — present since the very first packaged build in
  Task 47216, unrelated to icon branding, and outside this task's two stated goals; not changed.
- **The icon is deliberately a faithful reproduction of the existing in-app mark at a fixed 28.6%
  corner radius and ~57% glyph-to-box ratio** — matching the real UI exactly rather than
  hand-tuning for maximum small-size (16px) legibility the way a dedicated app-icon design pass
  might. At 16px the fine detail (the small plus/dot accents) softens, same as the identical glyph
  already does at the same 16px size inside the app's own sidebar — an inherent, pre-existing
  property of the mark's design, not something introduced or that this task's scope invited fixing
  (reproducing the existing identity, not redesigning it).

## 15. Exact files changed

- `src/types/subtitle.ts` — added `resolveGlobalStyle()`.
- `src/lib/project-mapper.ts` — read-side fix: `globalStyle` now goes through `resolveGlobalStyle`.
- `src/lib/global-style-validation.ts` — **new file**, `globalStyleSchema`.
- `src/app/api/projects/[id]/route.ts` — `patchSchema.globalStyle` now uses `globalStyleSchema`;
  PATCH handler normalizes via `resolveGlobalStyle` before persisting.
- `src/lib/subtitles/__tests__/global-style-robustness.test.ts` — **new file**, 11 tests.
- `src/lib/__tests__/project-patch.test.ts` — added test 15 (read-side defense against raw
  corrupted data).
- `build/icon.svg` — **new file**, the SUBLY Windows icon source.
- `package.json` — `build.win.icon` added; version bumped `0.1.1` → `0.1.2`; new
  `test:release-polish` script; new test registered in the main `test` script.
- `research/p3_release_polish_backend_hardening_report.md` — this report (new file).

No other files were modified. `lib/subtitles/ass.ts` (the renderer), the editor's client-side
store/undo-redo mechanism, preset definitions, the export pipeline, FFmpeg resolution, the
installer/uninstall architecture, and user-data locations were all read where relevant to verify
this phase's fixes but never changed.

## 16. Final PASS/FAIL

- Malformed/incomplete `globalStyle` cannot crash export — confirmed by direct reproduction against
  the unmodified renderer (crashes), then confirmed the fix prevents it (doesn't crash), then
  confirmed live through the full packaged export pipeline (§12).
- Valid existing style behavior is unchanged — confirmed by a byte-identical-ASS-output test (§6,
  test 11) and by tracing every real call site (UI, presets) to confirm they already send complete
  objects unaffected by the stricter schema (§2, §5).
- Focused regression tests pass — 12/12 new/extended.
- Full test suite passes — 439/439.
- Typecheck passes — 0 errors.
- Lint has no new errors/warnings — 5 pre-existing, 0 new.
- Fresh installer builds successfully — `SUBLY Setup 0.1.2.exe`, verified via the definitive
  completion marker.
- The actual installed Windows executable is verified — icon extracted directly from the real
  installed `SUBLY.exe`, both shortcuts, the installer, and the uninstaller; version resource
  confirmed correct.
- A valid existing brand asset was found (the in-app gradient-sparkles mark) and is now correctly
  applied throughout Windows packaging — installer, executable, both shortcuts, uninstaller, and
  the live running window, every one independently verified.
- Production data is byte-for-byte unchanged apart from timestamps (§13).
- No unrelated features or architecture were modified — the packaging architecture, installer,
  uninstall behavior, user-data locations, crash recovery, save queue, export/FFmpeg architecture,
  editor architecture, and transcription/language/segmentation systems were all left exactly as
  Task 47216 validated them.

---

**TASK 58314 — PASS**
Tests: 439/439
Typecheck: PASS
Lint: PASS
Installer: PASS
Backend robustness: PASS
Windows branding: PASS
Production data integrity: PASS
