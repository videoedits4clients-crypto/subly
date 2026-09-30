# P1 Fix Report — Upload Validation & Failure Surfacing

**Date:** 2026-09-18
**Scope:** Ensure a user is never left without a visible explanation for a rejected/failed video upload. No changes to the waveform, dashboard search/filter/sort, custom presets, Whisper/ASR, Gujarati Script, language policy, transcription segmentation, or export rendering.

---

## 1. Current upload architecture discovered

Traced the complete flow before writing any code:

- **Entry points**: dashboard "Upload video" and "New project" buttons both create a project (`NewProjectDialog`) and route to `/projects/[id]/upload`, a single page that owns one `react-dropzone` instance handling both the click-to-browse file input and drag-and-drop — there is only one upload UI component in the whole app, not three separate ones.
- **Client → server**: `api.uploadVideo()` ([src/lib/api-client.ts](src/lib/api-client.ts)) POSTs multipart form data to `POST /api/upload` via a raw `XMLHttpRequest` (for upload-progress events), separate from the app's shared `json<T>()` fetch helper used by every other endpoint.
- **Server validation** ([src/app/api/upload/route.ts](src/app/api/upload/route.ts), pre-existing): MIME-type allowlist → size cap → `storage.put()` → `probeVideo()` (ffprobe) → `VideoAsset` + `Project` DB writes → fire-and-forget `processVideo()`.
- **Media processing** ([src/lib/pipeline.ts](src/lib/pipeline.ts), P0/P0.5, untouched): `extractAudio()` → transcription → segmentation → `Subtitle` rows, all inside one try/catch that already sets `status: "ERROR"` with a specific `errorMessage` on any failure (including a corrupt file that passed the upload-time probe but fails later), and already distinguishes cancellation/stall from a generic failure. **This existing reliability layer already correctly prevents a misleading READY project and already provides Retry** ([src/components/editor/processing-screen.tsx](src/components/editor/processing-screen.tsx)) — nothing here needed to change.

## 2. Existing validation rules (the source of truth — none invented)

| Rule | Value |
|---|---|
| Accepted video extensions/MIME | `.mp4` (video/mp4), `.mov` (video/quicktime), `.webm` (video/webm), `.avi` (video/x-msvideo), `.mkv` (video/x-matroska) |
| Accepted audio extensions | **None.** Audio-only upload has never been supported anywhere in this app — confirmed by a full-repo search for any audio MIME type in upload-related code. Documented as such rather than added. |
| Maximum file size | `MAX_UPLOAD_MB` env var, default **2048 MB**, enforced server-side |
| Duration/resolution limits | None enforced — any duration/resolution `probeVideo` can read is accepted |
| FFmpeg limitations already enforced | A file must produce a readable `ffprobe` result (container/stream metadata); an unreadable/corrupt/wrong-content file is rejected at upload time. No video stream is technically required by `probeVideo` itself (only used as a video-only gate via the MIME/extension check upstream of it) |

Frontend and backend previously each hardcoded this same MIME/extension list and the same `2048MB` number independently (real duplication, no drift found in practice, but a latent risk). Consolidated into one shared module per the task's instruction.

## 3. Exact files changed

**New:**
- `src/lib/upload-validation.ts` — the single source of truth: `ACCEPTED_VIDEO_MIME_TYPES`, `ACCEPTED_FORMATS_LABEL`, `DEFAULT_MAX_UPLOAD_MB`, and the pure `validateUploadFile()` function (type → empty → size, in that deterministic order), used identically by the frontend (UX-only) and the backend (authoritative).
- `src/lib/__tests__/upload-validation.test.ts` — 10 tests (see §8).

**Modified:**
- `src/app/api/upload/route.ts` — now calls `validateUploadFile()` instead of its own inline checks; wraps the ffprobe call in a 20s timeout (a malformed file can otherwise make ffprobe hang scanning for stream info instead of failing, which would leave the upload silently spinning forever); wraps the post-probe DB writes (`VideoAsset` + `Project` update) in a try/catch that deletes the just-written file on failure, so a DB error can never leave an orphaned source file with no project record pointing at it; every rejection now returns the structured `{ error: { code, message } }` contract (see §4).
- `src/app/projects/[id]/upload/page.tsx` — **the core bug fix**: `useDropzone`'s `onDrop(accepted, rejections)` previously only read `accepted`, so any file react-dropzone itself rejected (wrong type, too large, or more than one file) produced silent, total non-feedback — the dropzone just sat there. Now reads `rejections` too and shows the exact same message `validateUploadFile()` would produce for that file, via both a toast and a new dismissible inline error banner. Also switched the hardcoded format list/size copy to the shared constants.
- `src/lib/api-client.ts` — `uploadVideo()`'s XHR error handling now parses either the new `{ error: { code, message } }` shape or the older shared `{ error: "string" }` shape (still used by, e.g., the rate limiter, which is intentionally untouched), so neither ever surfaces as `[object Object]` or a silent failure.
- `package.json` — added `test:upload` and appended the new test file to `test`.

**Deliberately not changed:** `src/lib/pipeline.ts`, `local-whisper-sidecar.ts`, `processing-screen.tsx`, or anything else in the P0/P0.5 reliability path — no genuine bug was found there that an upload-specific integration change could fix; it already does its job correctly.

## 4. Error contract

`{ error: { code: UploadErrorCode, message: string } }`, scoped to `/api/upload` only (not an application-wide framework). Codes: `MISSING_FIELDS`, `PROJECT_NOT_FOUND`, `UNSUPPORTED_TYPE`, `EMPTY_FILE`, `FILE_TOO_LARGE`, `INVALID_MEDIA`, `INTERNAL_ERROR`. `message` is always safe, user-facing prose — no stack traces, paths, Prisma errors, or ffmpeg command lines ever reach it (confirmed by reading every response the route can produce). Shared infrastructure this route also calls into (`checkRateLimit`, used by many unrelated routes) keeps its existing plain `{ error: "string" }` shape unchanged — the frontend parser handles both.

## 5. Frontend error behavior

- **Dropzone rejection** (wrong type, oversized, or a client-side multi-file drop): dismissible red banner above the dropzone + a toast, both showing the same message the backend would give for the identical file. Verified live: dropping an unsupported file previously did nothing at all; now it's immediately obvious.
- **Backend upload failure** (after clicking "Upload & auto-generate subtitles"): same banner + toast, populated from the actual backend `message` (via the updated `uploadVideo()` parser) rather than a generic string, and the "file selected" card stays visible with the upload button re-enabled so retrying is just clicking it again.
- Never surfaces: stack traces, filesystem paths, internal error objects, Prisma/ffmpeg internals — confirmed by inspecting every code path that can set `uploadError`.

## 6. Backend validation behavior

Order: **unsupported type → empty file → oversized** (deterministic — a file failing more than one check always reports the same reason). Type check falls back from MIME to file extension when the MIME is missing or unrecognized — this matters concretely for `.mkv` on Windows, which has no default registered Content-Type, so Chromium/Electron's File API can report `file.type === ""` for a perfectly valid Matroska file; without the fallback, an already-supported format could be wrongly rejected purely due to an OS MIME-registration gap. This does not expand the supported-format list, only prevents a false rejection of one already on it.

## 7. Cleanup/orphan handling

- **Type/size rejection**: nothing is ever written to disk (checked before `storage.put()`) — nothing to clean up.
- **`probeVideo` failure** (pre-existing behavior, preserved): the just-written file is deleted immediately.
- **DB-write failure after a valid probe** (new): the just-written file is now also deleted, closing a gap where a rare DB error could previously leave an orphaned source file with no project record.
- **Media processing failure after upload succeeds** (extractAudio/transcription): handled entirely by the existing, untouched P0/P0.5 path — project lands in `ERROR` with a specific message and Retry, never a misleading `READY`.
- Verified live (both dev server and the packaged app): after every rejected-upload scenario tested, the project's storage directory was empty and its status remained `EMPTY` — no orphaned files, no misleading state.

## 8. Tests added

10 new tests in `src/lib/__tests__/upload-validation.test.ts`:
1. Valid supported video accepted (one per accepted MIME type).
2. Audio uploads are not currently supported — a valid-looking audio file is rejected as unsupported, not silently allowed.
3. Unsupported extension rejected.
4. Unsupported MIME rejected (even with an accepted-looking extension mismatch elsewhere).
5. MIME-registration-gap fallback: empty/unknown MIME with a supported extension (e.g. `.mkv`) is still accepted.
6. Oversized file rejected, with the configured limit reflected in the message.
7. Boundary: a file exactly at the size limit is accepted.
8. Empty file rejected with a message distinct from "unsupported"/"too large".
9. A defensive negative-size case is treated as empty.
10. Validation order is deterministic (type beats empty when a file fails both).

## 9. Full test result

`npm run test` — **195/195 pass** (185 pre-existing + 10 new). Zero regressions.

## 10. Typecheck

`npx tsc --noEmit` — clean, no errors.

## 11. Lint

`npm run lint` — **0 errors** (5 pre-existing warnings, all in files this phase never touched).

## 12. Fresh installer result

`npm run electron:pack` completed successfully; installed cleanly to `%LOCALAPPDATA%\Programs\SUBLY`. Startup log shows `db migrations: applied=[]` (no schema change, as expected — this phase never touched Prisma).

## 13. Packaged QA results for every test file

Performed against the real packaged app (fresh install):

| File | Result |
|---|---|
| **A. Valid supported MP4** | Uploaded via the real endpoint; project reached `READY` (48 subtitles); editor opened with waveform and captions intact — full success path unregressed. |
| **B. Unsupported file type** (`.txt`, and a synthetic `.pdf` drop in the live UI) | API: `415 UNSUPPORTED_TYPE` with a clear message. Live UI drop: dismissible banner + toast appeared immediately (previously: nothing at all). No orphaned files; project stayed `EMPTY`. |
| **C. Oversized file** | Verified via the identical code path with `MAX_UPLOAD_MB` temporarily lowered on a dev-server instance (a literal 2GB+ test file was impractical to construct/upload for this QA pass): `413 FILE_TOO_LARGE`, limit correctly reflected in the message. Not independently re-run against the packaged `.exe`'s un-modified 2048MB default (see Limitations) — the route code is identical either way. |
| **D. Empty file** | `422 EMPTY_FILE`, "This file is empty." No orphaned files; project stayed `EMPTY`. |
| **E. Corrupt/truncated media** (real MP4 truncated mid-file, confirmed via ffprobe to fail with "moov atom not found") | `422 INVALID_MEDIA`, "Unable to read this media file…" No orphaned files; project stayed `EMPTY`. |
| **F. Valid supported audio** | N/A — not currently supported by this app (see §2); correctly still rejected as `UNSUPPORTED_TYPE` rather than silently accepted. |

**Also verified on the packaged app:** Dashboard search/filter/sort (search-by-name confirmed working), Custom Presets panel (renders correctly, no regression), Waveform (visible and rendering in the editor after a successful upload), Trash (full historical list intact and unaffected), and P0/P0.5 transcription cancellation (cancel → `ERROR` / "Transcription cancelled." → Retry → resumes processing, all confirmed working end-to-end on a real in-progress transcription).

All test projects created for this QA pass were cleaned up (trashed and permanently deleted) — the dashboard ended exactly where it started (3 real projects).

## 14. Bugs found/fixed

1. **Silent upload rejection (the core bug).** `onDrop` only read its first callback argument, so react-dropzone's own client-side rejections (wrong type, oversized, multiple files) produced zero feedback — no toast, no banner, dropzone looked untouched. This is exactly the failure mode the task described. Fixed by reading `rejections` and running the rejected file through the same `validateUploadFile()` the backend uses, so the message is identical either way.
2. **Potential orphaned file on a DB-write failure.** Between a successful `storage.put()`/`probeVideo()` and the `VideoAsset`/`Project` DB writes, there was no cleanup if the DB writes themselves failed. Low-probability (local SQLite), but closed with a try/catch that deletes the file on that failure.
3. **Unbounded ffprobe hang risk.** A sufficiently malformed file can make `ffprobe` hang scanning for stream info rather than erroring out, which would leave the upload request (and the UI's spinner) hanging indefinitely instead of surfacing a rejection. Bounded with a 20s timeout, scoped to this one call site.
4. **`.mkv` MIME-registration gap.** Windows has no default registered Content-Type for `.mkv`, so the browser can report `file.type === ""` for an otherwise perfectly valid, already-supported file — which the original MIME-only lookup would have rejected. Added an extension-based fallback (same supported-format list, not expanded).
5. **Inconsistent error response shapes / raw error passthrough risk.** The upload route previously returned a bare `{ error: "string" }`; a hypothetical future change to return a nested object would have broken the frontend's `.error` string assumption silently ( `[object Object]`). Formalized the `{ code, message }` contract and updated the one parser that needed to understand both shapes.

## 15. Remaining limitations

- The literal 2048MB size limit was not re-tested against a real 2GB+ file in the packaged app specifically (impractical to construct/transfer for this QA pass); it was verified against the identical code path with the limit temporarily lowered, which exercises the exact same `validateUploadFile()` logic and the exact same route response.
- The `.mkv` MIME-registration-gap fix is based on well-known, real Chromium/Windows behavior and is covered by a unit test, but this session has no way to drive the native OS file picker to empirically confirm what MIME string this specific Windows machine's Electron build reports for a real `.mkv` file (synthetic drag-and-drop events, used for the other live UI tests, let the test construct the `File` object's `type` directly rather than exercising real OS MIME sniffing).
- Duration/resolution limits remain unenforced, matching the pre-existing architecture — not introduced or changed by this phase.

## 16. Final status: **P1 UPLOAD VALIDATION & FAILURE SURFACING PASS**

Every upload rejection — client-side or server-side, type/size/empty/corrupt — now produces a visible, human-readable, dismissible explanation instead of a silent failure; the distinction between an upload validation error and a media processing error is preserved (and the latter continues to be handled entirely by the existing, unmodified P0/P0.5 reliability path); no failed upload leaves an orphaned file or a misleading project state; the valid-upload success path is fully unregressed; and dashboard search/filter/sort, custom presets, waveform, trash, and transcription cancellation were all confirmed intact. No other P1 feature was started.
