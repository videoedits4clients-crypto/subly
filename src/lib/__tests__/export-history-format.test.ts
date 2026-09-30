/**
 * Regression tests for the export-history/download-filename helpers (src/lib/export-history-format.ts,
 * src/lib/export-status-message.ts, src/lib/utils.ts's sanitizeFilename) — covers two confirmed
 * Phase 6/7 gaps this task fixed: a downloaded export video previously had no filename of its
 * own (the browser fell back to the raw output URL's opaque job-id basename), and a cancelled
 * export was indistinguishable from a genuinely failed one in the export-history list (both just
 * showed the literal ExportJob.status string "error").
 *
 * Run with: node --test src/lib/__tests__/export-history-format.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFilename } from "../utils.ts";
import { EXPORT_CANCELLED_MESSAGE, isExportCancelledMessage } from "../export-status-message.ts";
import { exportDownloadFilename, historyStatusLabel } from "../export-history-format.ts";

test("sanitizeFilename strips characters that aren't safe in a filename, keeping letters/digits/underscore/hyphen", () => {
  assert.equal(sanitizeFilename("My Cool Project!"), "My_Cool_Project_");
  assert.equal(sanitizeFilename("hindi/hinglish test"), "hindi_hinglish_test");
  assert.equal(sanitizeFilename("already-safe_name123"), "already-safe_name123");
});

test("exportDownloadFilename combines the sanitized project name, resolution, and .mp4 extension", () => {
  assert.equal(exportDownloadFilename("My Project", "1080p"), "My_Project_1080p.mp4");
  assert.equal(exportDownloadFilename("Hindi/hinglish test", "4k"), "Hindi_hinglish_test_4k.mp4");
});

test("exportDownloadFilename never produces the bare job-id-only name a raw output URL basename would", () => {
  // The whole point of this helper: given ANY project name, the result must be recognizably
  // project-derived, never something that could be confused with a cuid like "cm1a2b3c4d5e.mp4".
  const filename = exportDownloadFilename("Untitled project", "720p");
  assert.match(filename, /^Untitled_project_720p\.mp4$/);
});

test("isExportCancelledMessage matches only the exact cancellation message export-pipeline.ts produces", () => {
  assert.equal(isExportCancelledMessage(EXPORT_CANCELLED_MESSAGE), true);
  assert.equal(isExportCancelledMessage("Export cancelled."), true);
  assert.equal(isExportCancelledMessage("Something went wrong while exporting your video."), false);
  assert.equal(isExportCancelledMessage(null), false);
  assert.equal(isExportCancelledMessage(undefined), false);
});

test("historyStatusLabel shows 'cancelled' for a deliberately cancelled export, not the generic 'error'", () => {
  assert.equal(historyStatusLabel({ status: "ERROR", errorMessage: EXPORT_CANCELLED_MESSAGE }), "cancelled");
});

test("historyStatusLabel shows the plain lowercase status for a genuine failure", () => {
  assert.equal(historyStatusLabel({ status: "ERROR", errorMessage: "Something went wrong while exporting your video." }), "error");
  assert.equal(historyStatusLabel({ status: "ERROR", errorMessage: null }), "error");
});

test("historyStatusLabel shows the plain lowercase status for every non-error state", () => {
  assert.equal(historyStatusLabel({ status: "DONE", errorMessage: null }), "done");
  assert.equal(historyStatusLabel({ status: "QUEUED", errorMessage: null }), "queued");
  assert.equal(historyStatusLabel({ status: "RUNNING", errorMessage: null }), "running");
});
