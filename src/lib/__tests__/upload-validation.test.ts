/**
 * Regression tests for upload validation (src/lib/upload-validation.ts) — pure functions, no
 * network, no filesystem, no ffmpeg. This is the SAME logic the upload API route uses
 * authoritatively; the dropzone only ever gets an earlier, non-authoritative look at it.
 *
 * Run with: node --test src/lib/__tests__/upload-validation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateUploadFile, ACCEPTED_VIDEO_MIME_TYPES, DEFAULT_MAX_UPLOAD_MB } from "../upload-validation.ts";

const MAX_BYTES = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;

test("1. valid supported video accepted (one per accepted MIME type)", () => {
  for (const [mime, ext] of Object.entries(ACCEPTED_VIDEO_MIME_TYPES)) {
    const result = validateUploadFile({ name: `clip.${ext}`, type: mime, size: 10_000_000 }, MAX_BYTES);
    assert.deepEqual(result, { ok: true, extension: ext });
  }
});

test("2. audio uploads are not currently supported by this app — a valid-looking audio MIME/extension is rejected as unsupported, not silently allowed", () => {
  const result = validateUploadFile({ name: "clip.mp3", type: "audio/mpeg", size: 1_000_000 }, MAX_BYTES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "UNSUPPORTED_TYPE");
});

test("3. unsupported extension rejected", () => {
  const result = validateUploadFile({ name: "notes.txt", type: "text/plain", size: 100 }, MAX_BYTES);
  assert.deepEqual(result, { ok: false, code: "UNSUPPORTED_TYPE", message: "Unsupported file type. Please upload MP4, MOV, WebM, AVI or MKV." });
});

test("4. unsupported MIME rejected even with an accepted-looking extension mismatch", () => {
  // A file genuinely reported as e.g. image/gif by the browser, regardless of its name, must
  // not be accepted just because MIME lookup partially succeeds elsewhere.
  const result = validateUploadFile({ name: "clip.gif", type: "image/gif", size: 1000 }, MAX_BYTES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "UNSUPPORTED_TYPE");
});

test("MIME-registration gap fallback: an empty/unknown MIME type with a supported extension is still accepted (e.g. .mkv on Windows, which has no default registered Content-Type)", () => {
  const result = validateUploadFile({ name: "clip.mkv", type: "", size: 5_000_000 }, MAX_BYTES);
  assert.deepEqual(result, { ok: true, extension: "mkv" });
});

test("5. oversized file rejected", () => {
  const result = validateUploadFile({ name: "clip.mp4", type: "video/mp4", size: MAX_BYTES + 1 }, MAX_BYTES);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "FILE_TOO_LARGE");
    assert.match(result.message, /too large/i);
    assert.match(result.message, new RegExp(String(DEFAULT_MAX_UPLOAD_MB)));
  }
});

test("a file exactly at the size limit is accepted (boundary)", () => {
  const result = validateUploadFile({ name: "clip.mp4", type: "video/mp4", size: MAX_BYTES }, MAX_BYTES);
  assert.equal(result.ok, true);
});

test("6. empty file rejected with a distinct message from 'unsupported type' or 'too large'", () => {
  const result = validateUploadFile({ name: "clip.mp4", type: "video/mp4", size: 0 }, MAX_BYTES);
  assert.deepEqual(result, { ok: false, code: "EMPTY_FILE", message: "This file is empty. Please choose a different file." });
});

test("a negative size (defensive — should never happen from a real File object) is treated the same as empty", () => {
  const result = validateUploadFile({ name: "clip.mp4", type: "video/mp4", size: -1 }, MAX_BYTES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EMPTY_FILE");
});

test("validation order is deterministic: an unsupported type that is ALSO empty is reported as unsupported type, not empty", () => {
  const result = validateUploadFile({ name: "notes.txt", type: "text/plain", size: 0 }, MAX_BYTES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "UNSUPPORTED_TYPE");
});
