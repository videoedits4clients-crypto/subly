/**
 * Single source of truth for what POST /api/upload accepts. Both the upload API route
 * (authoritative — this is what actually enforces the rules) and the upload dropzone
 * (client-side, immediate-UX only) import from here, so the two can never silently drift apart.
 *
 * The accepted formats themselves are NOT new — this is exactly the list the upload route
 * already enforced (video/mp4, video/quicktime, video/webm, video/x-msvideo,
 * video/x-matroska). Audio-only uploads are not currently supported anywhere in the app (no
 * audio MIME type has ever been accepted here), so none are added.
 */

export const ACCEPTED_VIDEO_MIME_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
};

/** Extension (no dot, lowercase) -> itself, derived from the map above — used as a fallback
 * when a browser/OS reports no (or a generic) MIME type for a file whose extension is
 * otherwise supported. This matters in practice for .mkv specifically: Windows has no default
 * registered Content-Type for it, so Chromium/Electron's File API can report `file.type === ""`
 * for a perfectly valid Matroska file. Falling back to the extension does not expand the
 * supported-format list — it only stops an already-supported format from being rejected purely
 * because of an OS MIME-registration gap (a real, packaged-Windows-app-specific concern, not a
 * hypothetical one). */
const EXTENSION_TO_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.values(ACCEPTED_VIDEO_MIME_TYPES).map((ext) => [ext, ext]),
);

export const ACCEPTED_EXTENSIONS = Object.values(ACCEPTED_VIDEO_MIME_TYPES).map((ext) => `.${ext}`);

/** Human-readable list for copy shown to the user (dropzone hint text, error messages) — kept
 * in one place so the wording only ever needs to change here. */
export const ACCEPTED_FORMATS_LABEL = "MP4, MOV, WebM, AVI or MKV";

/** Default cap, in megabytes. The server route resolves the REAL effective limit from
 * `process.env.MAX_UPLOAD_MB ?? DEFAULT_MAX_UPLOAD_MB` (unchanged from before this phase); the
 * client only ever uses this constant, since a browser bundle can't read a server-only env var
 * without a round trip — it exists so the two don't hardcode the same number in two places, not
 * to make the frontend authoritative (it isn't; see validateUploadFile's doc comment). */
export const DEFAULT_MAX_UPLOAD_MB = 2048;

export type UploadErrorCode =
  | "MISSING_FIELDS"
  | "PROJECT_NOT_FOUND"
  | "UNSUPPORTED_TYPE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_MEDIA"
  | "INTERNAL_ERROR";

export interface UploadErrorBody {
  error: { code: UploadErrorCode; message: string };
}

export type UploadValidation = { ok: true; extension: string } | { ok: false; code: UploadErrorCode; message: string };

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Pure validation of a file's own metadata (name/type/size) — no filesystem or network access,
 * so it runs identically in the browser (immediate UX) and on the server (authoritative). The
 * server is the only one that can actually reject an upload; the client only ever gets to
 * short-circuit the same checks earlier, using the exact same rules.
 *
 * Order: type first (an unsupported file is unsupported regardless of its size), then empty,
 * then oversized — deterministic so a file that fails more than one check always produces the
 * same message.
 */
export function validateUploadFile(file: { name: string; type: string; size: number }, maxBytes: number): UploadValidation {
  const byMime = ACCEPTED_VIDEO_MIME_TYPES[file.type];
  const byExtension = EXTENSION_TO_CANONICAL[extensionOf(file.name)];
  const extension = byMime ?? byExtension;
  if (!extension) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: `Unsupported file type. Please upload ${ACCEPTED_FORMATS_LABEL}.` };
  }
  if (file.size <= 0) {
    return { ok: false, code: "EMPTY_FILE", message: "This file is empty. Please choose a different file." };
  }
  if (file.size > maxBytes) {
    return { ok: false, code: "FILE_TOO_LARGE", message: `File is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))}MB.` };
  }
  return { ok: true, extension };
}
