# P0 Fix Report — Language Policy Lockdown & Safe Permanent Deletion

**Date:** 2026-09-17
**Scope:** The four P0 findings from `research/product_audit_p1.md` — language-policy contradiction (marketing + picker + Gujarati Script exposure) and unsafe permanent deletion. No P1 features implemented. No Gujarati ASR/LoRA research touched.

---

## Final V1 language policy

Established as the single authoritative definition in **`src/lib/language-policy.ts`**.

**Supported / validated for transcription:**
| Code | Label |
|---|---|
| `en` | English |
| `hi` | Hindi |

**Deferred / not supported for transcription** (implementation preserved, not deleted; simply unreachable from normal use going forward):
`gu` Gujarati, `mr` Marathi, `bn` Bengali, `ta` Tamil, `te` Telugu, `pa` Punjabi, `ur` Urdu, `es` Spanish, `fr` French, `de` German, `pt` Portuguese, `ar` Arabic, `ja` Japanese, `ko` Korean.

**`auto` (Auto Detect)** remains available — it is not itself a claim of support for any specific unvalidated language; Whisper decides at runtime, same as before, and stays most reliable on the languages this project has actually validated.

**Deliberately out of scope:** the AI-translate feature (`ai-menu.tsx`) and the post-transcription `LanguageSwitcher` still use the full 16-language catalog (`types/subtitle.ts`'s `LANGUAGES`). That's a different question — translating already-transcribed text via a cloud model — from "can our local Whisper model transcribe this language well," which is what the policy governs. This scoping decision is documented in the policy file's own header comment.

---

## Files changed

**New:**
- `src/lib/language-policy.ts` — the authoritative policy (supported/deferred lists, validators, picker options, marketing-copy summary generator).
- `src/lib/__tests__/language-policy.test.ts`
- `src/components/landing/__tests__/language-claims.test.ts`
- `src/lib/subtitles/__tests__/output-mode-policy.test.ts`
- `src/lib/storage/__tests__/local-storage.test.ts`

**Modified:**
- `src/types/subtitle.ts` — `TRANSCRIPTION_LANGUAGE_OPTIONS` now derives from the policy (relative/extensioned import, not `@/...`, so existing tests that import this file directly under Node's native runner keep working).
- `src/app/api/projects/[id]/route.ts` — PATCH now rejects a `language` value the policy doesn't allow.
- `src/app/api/projects/route.ts` — POST (project creation) validated the same way, defense-in-depth.
- `src/lib/subtitles/output-mode.ts` — `projectSupportsGujaratiScript` documented against the policy (no behavior change); relative/extensioned imports fixed so the file is directly testable.
- `src/components/landing/features.tsx` — the "Multi-language" claim is now generated from `supportedLanguageSummary()`, not hand-typed.
- `src/components/landing/faq.tsx` — removed a stale, already-inaccurate "10 languages" claim about the (unrestricted) translate feature.
- `src/lib/storage/types.ts`, `src/lib/storage/local.ts`, `src/lib/storage/s3.ts` — new `delDir(prefix)` capability, with a hard-coded safe-id check (`/^[A-Za-z0-9_-]+$/`) independent of path resolution.
- `src/types/optional-s3.d.ts` — extended the ambient S3 SDK type stub with `ListObjectsV2Command`/`DeleteObjectsCommand` (the real `@aws-sdk/client-s3` package isn't installed; this stub is what makes `tsc` pass without it — see the file's own header comment).
- `src/app/api/projects/[id]/trash/route.ts` — permanent delete now calls `storage.delDir(id)` before the DB delete, best-effort (a storage error is logged, never blocks DB cleanup), plus a new `project_permanently_deleted` analytics event.
- `src/lib/analytics.ts` — added that event.
- `src/app/dashboard/trash/page.tsx` — replaced the native `confirm()` with an in-app type-to-confirm dialog.

**Bug found and fixed during this work (not part of the original plan):** my first version of the new confirmation dialog compared `project?.id` (`string | undefined`) directly against a `string | null` state variable — `undefined !== null` is always `true` in JS, so the reset-on-change guard could never converge, causing an infinite render loop. This was caught immediately by `next build`'s static prerendering of `/dashboard/trash` (which failed with "Too many re-renders"), fixed by normalizing both sides to `string | null` before comparing, and reverified with a clean build before proceeding.

---

## Exact permanent-deletion cleanup behavior

On `DELETE /api/projects/:id/trash` (requires the project already be in Trash):

1. **Storage files** — `storage.delDir(id)` recursively removes everything under the project's own storage prefix: source video, extracted audio, every exported MP4, and any `.ass` sidecars. `id` is the DB-verified, ownership-checked project id — never a client-supplied path. `LocalStorageDriver.delDir` additionally refuses any prefix that isn't a plain `[A-Za-z0-9_-]+` segment before even attempting path resolution, so a malformed or traversal-shaped id (`../x`, `a/b`, empty string) is rejected outright rather than silently resolved. This step is best-effort: a failure (e.g., a file momentarily locked) is logged and does **not** block step 2 — an unremovable Trash entry would be a worse outcome than a rare orphaned file, and `fs.rm(..., {force:true})` already tolerates files that are simply already gone.
2. **Database record** — `prisma.project.delete()`, which cascades (via `onDelete: Cascade` in `prisma/schema.prisma`) to every `Subtitle`, `VideoAsset`, `SubtitleTrack`, and `ExportJob` row referencing the project.

**What's retained and why:** nothing project-specific. Captions are pure database rows (text in a column), never separate files, so step 1 needs to do nothing for them — step 2's cascade handles them completely. There is no separate thumbnail/cache file: the dashboard's project thumbnail is the source video itself (`<video>` element pointed at `project.thumbnailUrl`), already covered by step 1. The user's account and other projects are obviously untouched — `delDir` only ever operates on the one verified id.

---

## Tests added

| File | Covers |
|---|---|
| `language-policy.test.ts` | Every supported language accepted; every deferred language (Gujarati included) rejected; unknown code rejected; Auto Detect accepted; picker options exactly Auto+supported; `types/subtitle.ts` re-export matches the policy exactly (single source of truth); marketing summary never names a deferred language; full catalog still contains every policy code. |
| `language-claims.test.ts` | No landing `.tsx` file's rendered copy names a deferred language; no hardcoded "N languages" claim anywhere; `features.tsx` actually derives its claim from the policy (not hand-typed). Comment-aware (strips `//`/`/* */` before scanning) so it checks real user-facing copy, not source comments. |
| `output-mode-policy.test.ts` | Gujarati project → Gujarati Script available; non-Gujarati (`en`,`hi`,`mr`,`bn`,`ta`,`auto`) → unavailable; switching language away from Gujarati revokes availability; Original/Hinglish/Gujarati-Script mode projections all still correct; `projectHasDevanagari` is content-based, independent of the language-code gate. The underlying conversion algorithm (`gujarati-script.ts`) is untouched — only its exposure is tested. |
| `local-storage.test.ts` | Successful deletion; project-with-exports (nested dir) fully removed; missing project is a no-op; repeated deletion is idempotent; deleting one project never touches another's files; path-traversal/unsafe prefixes (`../x`, `a/b`, empty string) are refused before any filesystem access, including a real sibling directory proven to survive. |

Backend HTTP-route validation itself (the PATCH/POST refine calls) is exercised via the shared `isValidTranscriptionLanguageRequest` function's own exhaustive unit tests above (the routes are thin wrappers around it) and directly re-verified against the real packaged app below — this project's existing test convention has no way to invoke a Next.js route handler directly under Node's native test runner (confirmed the same limitation applies here as for other routes earlier in this engagement).

---

## Test / build results

- **Full suite: 139/139 pass** (was 113 before this work — 26 new tests, zero regressions in the 113 pre-existing ones).
- **Typecheck: clean.** (Two real issues surfaced and fixed along the way: a test comparing a `string` against a narrowed union type, and the new `s3.ts` code needing its two new AWS command classes added to the project's existing ambient type stub for the not-actually-installed `@aws-sdk/client-s3` package.)
- **Lint: 0 errors** (5 pre-existing, unrelated warnings untouched).
- **Packaged Windows build: succeeded** on the second attempt — the first attempt failed at `next build`'s static-page prerendering with the infinite-render bug described above; fixed and reverified with a plain `next build` before re-running the full `electron:pack`.

---

## Packaged-app QA results

All performed against the real reinstalled packaged app, using the existing 3 real projects (`rishab guj` — legacy Gujarati, `Hindi/hinglish test`, `Untitled project`) as the "existing projects must remain untouched" control group throughout.

| Check | Result |
|---|---|
| Supported language picker | **PASS** — dropdown shows exactly Auto Detect / English / Hindi (confirmed via a real dropzone-simulated upload through the actual `TranscriptionSettingsDialog` UI) |
| Deferred language rejection | **PASS** — `PATCH .../route.ts` with `language: "gu"` and `"ar"` → `400 Invalid update payload.`; `"xx"` (unknown) → same rejection; `"auto"`, `"en"`, `"hi"` → all accepted |
| Gujarati Script / Hinglish behavior | **PASS** — the legacy `rishab guj` project (real pre-existing data, `language: "gu"`) still shows the 3-way Original/Gujarati Script/Hinglish selector, switching between all three renders correctly, and autosave persisted the change (`Saved` indicator) |
| Permanent deletion | **PASS** — created a real project with a real transcript (51 captions) and a real completed export, deleted it via the actual UI dialog (typed the exact name), and confirmed both the DB row and all three files (`source.mp4`, `audio.wav`, `exports/*.mp4`) were gone from disk |
| Cancellation of deletion | **PASS** — clicked Cancel in the dialog; project remained in Trash and every file remained on disk |
| Relaunch after deletion | **PASS** — closed and relaunched the app; the deleted project stayed permanently gone; all 3 real projects (including the Gujarati one) survived with correct languages and READY/EXPORTED status intact |
| Existing projects untouched | **PASS** — verified at every step above; also confirmed `rishab guj`'s and `Hindi/hinglish test`'s own files were never touched by the unrelated project's deletion |

One incidental finding during QA, not a regression: `form_input`-style programmatic value-setting on the new confirmation dialog's text field closed the dialog unexpectedly in the browser-automation tool used for this QA pass; typing character-by-character (as any real user does) worked correctly and is what's reflected in the PASS above. This is very likely an artifact of the automation tool's synthetic-event handling interacting with Radix's controlled-input dialog, not an application bug — real keyboard input was never affected — but it's noted here for completeness since it was observed live.

---

## Remaining limitations

- **Route-level HTTP tests aren't automated** for the same structural reason noted earlier in this engagement: this codebase's zero-dependency Node-native test convention can't invoke a Next.js route handler directly (it needs `@/...` alias resolution the native runner doesn't have). The validation logic itself is fully unit-tested; the route wiring is verified live against the packaged app instead, as shown above.
- **The AI-translate feature and post-transcription LanguageSwitcher remain unrestricted** (by design — see the policy file's scoping note). If the product later wants translation targets restricted too, that's a separate, deliberate decision, not an oversight.
- **Cleanup of storage files is best-effort**, not transactional with the database delete — a project could theoretically end up with its DB row removed but a locked file left behind on a very unlucky timing (e.g., another process briefly holding the file open). This mirrors the existing project-wide convention of "never let cleanup failures block the more important operation" (the same pattern used for export/transcription cleanup), and is logged when it happens.
- **Historical Trash accumulation from earlier QA sessions** (pre-existing, unrelated to this fix) was left alone except for the two items created during this session's own testing, which were cleaned up.

---

**Stopping here per instructions — P0 complete, no P1 work started.**
