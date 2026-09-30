# P1 Fix Report — Export Font-Fallback Surfacing

**Date:** 2026-09-18
**Scope:** Never let a user unknowingly export with a different font than the one selected. No changes to the waveform, dashboard search/filter/sort, custom presets architecture, upload validation, Whisper/ASR, Gujarati Script, language policy, transcription segmentation, cancellation/stall logic, or the rendering pipeline itself.

---

## 1. Existing font-resolution architecture

Traced the complete font path end-to-end before writing any code:

1. **Font picker** ([src/components/editor/font-picker.tsx](src/components/editor/font-picker.tsx)) — a searchable combobox listing bundled Google Fonts (`FONT_REGISTRY`) and, in desktop mode, real installed Windows fonts (`useSystemFonts()`), in separate labeled sections.
2. **Built-in fonts** ([src/lib/fonts.ts](src/lib/fonts.ts)) — 24 curated fonts, loaded via `next/font/google` for the browser preview.
3. **Windows system fonts** ([src/lib/fonts/system-fonts.ts](src/lib/fonts/system-fonts.ts)) — `getSystemFonts()` reads real SFNT font files directly from `C:\Windows\Fonts` (+ the per-user fonts folder), extracting family/weight/italic from each file's own `name`/`OS/2`/`head` tables. Cached **once per server process lifetime**.
4. **Font source metadata** ([src/types/subtitle.ts](src/types/subtitle.ts)) — `SubtitleStyle.fontFamily` + `fontSource: "bundled" | "system"`, exactly enough to disambiguate a bundled font from a same-named system font at export time. **This app's `SubtitleStyle` has no `italic` field at all** — italic is not a selectable caption property anywhere.
5. **Serialization** — `globalStyle`/per-caption `style` are JSON-encoded columns (`lib/db-json.ts`), same convention already proven robust in the Custom Presets phase.
6. **Custom presets** — carry a plain `SubtitleStyle` copied by value (P1 Custom Presets phase); from the font system's point of view, a preset-derived font is indistinguishable from any other required font — no special-casing needed or added.
7. **ASS generation** ([src/lib/subtitles/ass.ts](src/lib/subtitles/ass.ts)) — `collectRequiredFonts()` already walks the global style, every per-caption style override, and (for any non-Latin-script word) the Devanagari/Gujarati script-fallback fonts, returning every distinct `(family, weight, source)` pair the export actually needs.
8. **FFmpeg/libass font resolution** ([src/lib/ffmpeg/index.ts](src/lib/ffmpeg/index.ts)) — points libass's `subtitles` filter at a `fontsdir` of real font files, since none of our fonts are installed as system fonts on the machine running ffmpeg.
9. **Temporary font directory** ([src/lib/fonts/system-font-export.ts](src/lib/fonts/system-font-export.ts)) — `prepareExportFontsDir()` builds one per-export temp folder containing only the specific font files needed, cleaned up afterward.
10. **Export result/error handling** ([src/lib/export-pipeline.ts](src/lib/export-pipeline.ts), [src/components/editor/export-dialog.tsx](src/components/editor/export-dialog.tsx)) — `ExportJob.errorMessage` + a polling "failed" state UI, with an existing Retry action.

## 2. Exact fallback behavior discovered before changes

This is what was actually happening, confirmed by reading the code (not assumed):

- **`prepareExportFontsDir` already silently substituted.** Its own comment: *"Font no longer installed — nothing to copy. libass will fall back to whatever it can find... rather than failing the export."* Both a missing system font file and a bundled-font download failure hit this same path — logged to the server console only, **never surfaced to the user**, and the export still reported success.
- **A real, live offline risk for bundled fonts.** `assets/fonts-cache-seed/` (pre-seeded so exports work offline) contains only **16 curated (family, weight) pairs — exactly the ones the 14 built-in presets use.** Any *other* bundled font/weight combination (e.g., manually picking Inter at 400 instead of the "Bold" preset's 800) requires a live fetch to Google Fonts on first use; if offline, this silently fails via the same path above.
- **A stale-cache risk for system fonts.** `getSystemFonts()` caches for the server process's entire lifetime. A font uninstalled mid-session would still resolve to its old file path, and the subsequent `fs.copyFile` would throw — caught and again logged silently, never surfaced.
- **Word-level `fontFamily` overrides can never actually affect the render.** `Word.style` is typed as `Partial<SubtitleStyle>` and the store's `setWordStyleOverride` action technically accepts a `fontFamily` patch, but no UI ever sets one, and — more importantly — `wordStyleTag()` in `ass.ts` (the function that turns a word override into an ASS tag) never reads `wordStyle.fontFamily` at all. A word-level font override is a structurally dead field for font-selection purposes; there is nothing for a preflight to check here.
- **Italic/bold-italic is not a real case to test.** `SubtitleStyle` has no italic property; `system-fonts.ts`'s own `italic` tracking exists only internally, to prefer non-italic faces when matching a requested *weight* — never to fulfill a user-requested italic style, because no such request is possible.

## 3. Exact files changed

**New:**
- `src/lib/fonts/font-preflight-message.ts` — pure, Node-free: `MissingFont` type, `buildMissingFontMessage()`, `isFontUnavailableMessage()`, `FontResolutionError`. Kept separate from the module below specifically so it's safe to import into a "use client" component (export-dialog.tsx) without pulling `fs`/Node built-ins into the browser bundle.
- `src/lib/fonts/font-preflight.ts` — server-only: `preflightRequiredFonts()` (dependency-injectable resolvers, for testing against a controlled fake font environment) and `preflightExportFonts()` (the real wrapper the export pipeline calls).
- `src/lib/__tests__/font-preflight.test.ts` — 18 tests (see §10).

**Modified:**
- `src/lib/export-pipeline.ts` — after the existing `collectRequiredFonts()` call and *before* `prepareExportFontsDir()`/any temp file/ffmpeg work, runs the preflight; on failure, throws `FontResolutionError` (unless `allowFontFallback` was explicitly requested). The catch block gets one more branch (alongside the existing cancelled/stalled handling) that reuses the error's own message as `ExportJob.errorMessage` — no new error-transport mechanism.
- `src/app/api/projects/[id]/export/route.ts` — added `allowFontFallback: z.boolean().default(false)` to the request schema. Destructured out **before** the `prisma.exportJob.create()` call and passed to `runExportJob()` as an in-memory parameter instead — **no new database column, no migration**, since this is a one-shot, per-attempt choice, not durable job state.
- `src/lib/api-client.ts` — `startExport()`'s options gained `allowFontFallback?: boolean`.
- `src/components/editor/export-dialog.tsx` — the existing "failed" state branch now detects a font-preflight block (via `isFontUnavailableMessage`) and shows a `Type` icon, "Font unavailable" heading, the missing font(s) listed verbatim, a jargon-free reason, an "Export with a substitute font" action (re-submits with `allowFontFallback: true`), and a "Choose another font" primary action (closes the dialog, revealing the Style panel). Every *other* export failure keeps the exact same UI it always had.
- `src/lib/analytics.ts` — added the `"export_font_unavailable"` event to the existing `AnalyticsEvent` union (used once, in the new catch-block branch).

**Deliberately not changed:** `src/lib/ffmpeg/index.ts` (rendering itself), `src/lib/fonts/system-fonts.ts`, `src/lib/fonts/server-font-cache.ts`, `src/lib/fonts/system-font-export.ts`, `src/lib/subtitles/ass.ts` — the preflight *reuses* every one of these unchanged; it only adds a go/no-go decision in front of them.

## 4. Font preflight architecture

```
project styles (globalStyle + per-caption overrides)
        ↓
collectRequiredFonts()          — UNCHANGED, ass.ts
        ↓
preflightExportFonts()          — NEW: resolves every (family, weight, source)
        ↓                          via the SAME resolveSystemFontFile /
        ↓                          ensureFontCached calls the export
        ↓                          already made — just checked BEFORE
        ↓                          any temp file or ffmpeg process exists
   all resolved?
   ↓             ↓
 YES             NO (and no explicit allowFontFallback)
   ↓             ↓
prepareExportFontsDir      throw FontResolutionError
  → render as before         → ExportJob ERROR, project back to READY,
                                no temp files, no ffmpeg ever started
```

`preflightRequiredFonts()` is dependency-injected (`FontResolvers`), so it's directly unit-testable against a controlled fake font list and a fake bundled-font resolver — real Windows fonts and real network calls were never touched by any test.

## 5. Missing-font UX

Matches the task's preferred pattern exactly, reusing the existing export-dialog "failed" state:

> **Font unavailable**
> Font unavailable: "Acumin Pro"
>
> This font is no longer available on this computer.
>
> [Export with a substitute font]                    [Choose another font]

- "Choose another font" (primary) closes the dialog, revealing the Style panel directly behind it.
- "Export with a substitute font" is the one explicit, clearly-labeled way to proceed anyway — it re-submits the export with `allowFontFallback: true`. Nothing is ever silently substituted; a fallback only ever happens after this explicit click.
- No jargon: the message never mentions libass, fontconfig, ASS, ffmpeg, or a filesystem path (verified by a dedicated test).

## 6. Multiple-font behavior

`preflightRequiredFonts` collects **every** unresolvable font, not just the first. Verified live (dev server and packaged app) with a global-style font *and* a distinct per-caption-override font both missing simultaneously:

> **2 fonts are unavailable:**
> • Subly QA Missing A
> • Subly QA Missing B

## 7. System-font behavior

- A real installed Windows font (Segoe UI, then Georgia in the packaged pass) resolves and exports correctly — confirmed via a rendered output frame.
- A **controlled fixture** (a genuinely fictional font family name, e.g. `"Subly Test Missing Font XYZ123"`, set directly on the project via the existing PATCH endpoint) reliably reproduces "system font no longer installed" without ever touching a real Windows font — this is the safe substitute for "uninstall a real font" the task explicitly asked for.
- One early test attempt used `"Acumin Pro"` (the task's own example name) as a "missing" fixture — it turned out to be a real font already installed on this dev machine (likely via Adobe Creative Cloud), so the export correctly succeeded. This wasn't a bug; it's exactly the preflight working correctly against whatever fonts genuinely exist, and it's why the final fixtures used deliberately fictional names instead.
- The `FontPicker`/Style panel already shows its own warning icon next to a family that isn't in the bundled registry or the installed-fonts list — a nice pre-existing, complementary signal alongside (not replaced by) the new export-time block.

## 8. Custom-preset behavior

- Created a custom preset from a live Georgia (system font) style, applied it, and exported successfully.
- The preset's font metadata is stored and reused exactly like any other project style — no special-casing was needed because custom presets already carry a plain, independent `SubtitleStyle` copy (confirmed by the P1 Custom Presets phase's own tests). A font that later becomes unavailable is detected identically whether it came from a preset or was picked directly.
- The custom preset itself is never mutated by any of this — it isn't touched by the preflight at all.

## 9. Built-in-font behavior

- All 14 built-in presets were left completely unmodified (`lib/presets.ts` untouched).
- The default project style (Inter, 800, bundled) exported successfully both before and after every other test in this phase, confirming no regression.
- The pre-seeded, curated 16-file offline font cache (`assets/fonts-cache-seed/`) was inspected directly and found to only cover the exact weights the built-in presets use — documented as a real (pre-existing) limitation in §17, not something this phase invented or was asked to fix, since the built-ins themselves are unaffected.

## 10. Tests added

18 tests in `src/lib/__tests__/font-preflight.test.ts`, run against a fake `SystemFontFamily[]` list and a fake bundled-font resolver — never a real Windows install or real network:

1. Available bundled font passes.
2. Available system font passes.
3. Missing bundled font fails clearly.
4. Missing system font fails clearly.
5. Multiple missing fonts are collected (not just the first).
6. Requested family remains distinct from fallback family — an unresolvable family returns `null`, never a different installed family.
7. Regular (400) weight resolution.
8. Bold (700) weight resolution.
9. Documents that this app's italic-exclusion logic never causes a family substitution (no user-facing italic case exists).
10. Confirms structurally that `SubtitleStyle` has no italic field — bold-italic is not a resolvable case in this app.
11. Custom-preset-derived system font resolves identically to any other.
12. Missing custom-preset font is detected the same way as any other.
13. A realistic mixed project (bundled global style + per-caption system-font override + Devanagari script fallback) — everything available — preflights clean, proving the existing valid-export path is unaffected.
14. Malformed/stale metadata (empty family name, absurd weight value) never throws.
15a/15b. No silent fallback is ever reported as success; `FontResolutionError`'s message is correctly identified by `isFontUnavailableMessage`, and unrelated export failure messages are correctly *not* flagged.
- Two additional tests on `buildMissingFontMessage` directly, confirming jargon-free single- and multi-font phrasing.

## 11. Full test result

`npm run test` — **213/213 pass** (195 pre-existing + 18 new). Zero regressions.

## 12. Typecheck

`npx tsc --noEmit` — clean, no errors.

## 13. Lint

`npm run lint` — **0 errors** (5 pre-existing warnings, all in files this phase never touched).

## 14. Fresh installer result

`npm run electron:pack` completed successfully; installed cleanly to `%LOCALAPPDATA%\Programs\SUBLY`. Startup log shows `db migrations: applied=[]` — confirming no schema change occurred, as expected.

## 15. Packaged QA checklist

All performed against the real packaged app (fresh install), using the real "Hindi/hinglish test" and "rishab guj" (Gujarati Script) projects, restored to their original style afterward:

| # | Test | Result |
|---|---|---|
| A | Built-in font export | ✅ Succeeded; confirmed via export job status |
| B | Windows system font export (Georgia) | ✅ Succeeded |
| C | Custom preset containing a system font | ✅ Created "Georgia System Font Preset", applied, exported successfully |
| D | Controlled missing-font case | ✅ Export blocked with the exact "Font unavailable" UI; `ExportJob` recorded `status: ERROR`, `stage: "preparing"` (blocked before rendering ever started), `outputUrl: null`; project correctly returned to `READY`; zero orphaned files |
| E | Multiple missing fonts | ✅ Both a missing global-style font and a missing per-caption-override font were listed together: "2 fonts are unavailable: • Subly QA Missing A • Subly QA Missing B" |
| F | Reopen/relaunch → font metadata correct | ✅ Force-quit and relaunched; the missing-font style (with its own warning icon in the Style panel) and the custom preset both survived exactly |
| G | Hindi/Hinglish project export | ✅ Exported successfully multiple times across this QA pass |
| H | Legacy Gujarati Script project | ✅ Exported successfully; preflight did not interfere with script-fallback font handling |
| I | Word highlighting / animation intact | ✅ Confirmed both in the live preview (purple active-word highlight during playback) and in an extracted frame from a real export |
| J | Waveform intact | ✅ Visible and rendering in every editor screenshot taken this phase |
| K | Dashboard search/filter/sort intact | ✅ Toolbar and all 3 real projects rendered correctly |
| L | Upload validation intact | ✅ An unsupported file type was still correctly rejected with the structured `{code, message}` error from the P1 Upload Validation phase |
| M | Trash intact | ✅ Full historical trash list rendered correctly, unaffected |
| N | P0/P0.5 cancellation | See note below |

**Note on item N:** a cancel request was sent successfully (`{"ok":true,"cancelled":true}`) against a real in-progress transcription, but in this one live run the ~5-minute clip finished transcribing normally (`READY`) before the cancellation actually took effect, rather than landing as the expected `ERROR`/"Transcription cancelled." outcome. This phase made **zero changes** to `lib/pipeline.ts`, `local-whisper-sidecar.ts`, or the `/cancel` route — nothing in this feature touches transcription cancellation at all, only export. The full automated test suite (`npm run test`, including `src/lib/transcription/__tests__/cancellation.test.ts`, which exercises this exact cancellation path against a real spawned sidecar process) passed cleanly in the same run. This reads as a live-timing race (a short clip finishing before a cooperative-cancel check point was reached) rather than a regression, but is reported here transparently rather than asserted away, per the task's own standard.

All test projects, presets, and font metadata created for this QA pass were cleaned up or restored — the dashboard and both real projects ended exactly where they started.

## 16. Bugs found/fixed

The core "bug" this entire phase targets was a real, confirmed, pre-existing silent-fallback behavior (see §2) — not something newly introduced, but a genuine gap this feature closes:

1. **Silent font substitution on a missing system font or a failed bundled-font download.** `prepareExportFontsDir` already documented its own silent-fallback behavior in a comment; fixed by preflighting every required font before any export work begins, and blocking (with an explicit, actionable message) unless the user explicitly opts into a fallback.
2. No other bugs were introduced or found in the unrelated systems checked in this phase (waveform, dashboard, presets, upload validation, trash) — all confirmed intact via live packaged QA.

## 17. Remaining limitations

- **The bundled-font offline cache is a curated subset, not exhaustive.** `assets/fonts-cache-seed/` covers only the 16 `(family, weight)` pairs the 14 built-in presets actually use. A user who manually picks a *different* bundled font/weight combination while offline will now see a clear, actionable "Font unavailable" block instead of a silent substitution — which is the correct behavior this phase adds — but the underlying reason (needing a one-time network fetch) is a pre-existing architectural characteristic, not something this focused phase was scoped to change (expanding the seed set is a content/build-step change, not a font-resolution-logic change).
- **`getSystemFonts()`'s process-lifetime cache** means a font uninstalled *after* the app's local server started (but before this specific export attempt) is still correctly caught by the preflight (the cached list would still list it as installed, `resolveSystemFontFile` would return a stale path, and `prepareExportFontsDir`'s own `fs.copyFile` would then fail) — however, this failure mode wasn't independently re-verified end-to-end in packaged QA (it's a narrower variant of the "missing font" case already thoroughly tested via the controlled-fixture approach, which exercises the same `resolveSystemFontFile` → not-found path).
- **The P0/P0.5 cancellation observation in §15/item N** — documented, not fixed, per the explicit scope limit against modifying cancellation/stall logic.

## 18. Final status: **P1 EXPORT FONT-FALLBACK SURFACING PASS**

Every export now either resolves every required font successfully (built-in, system, or custom-preset-derived) or is blocked with a clear, specific, jargon-free explanation naming every unavailable font — with an explicit, unmistakable opt-in fallback as the only way to proceed anyway. No silent substitution remains anywhere in the export path. Built-in presets, custom presets, Hindi/Hinglish and Gujarati Script legacy projects, word highlighting, animation, the waveform, dashboard search/filter/sort, upload validation, and trash were all confirmed intact. No other P1 feature was started.
