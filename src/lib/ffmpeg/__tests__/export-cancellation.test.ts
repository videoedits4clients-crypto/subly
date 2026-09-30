/**
 * End-to-end tests for renderExport's cancellation/stall handling (src/lib/ffmpeg/index.ts) —
 * runs the REAL bundled ffmpeg-static binary against a tiny solid-color lavfi source (no input
 * video fixture needed — see ExportOptions.videoVisible: false) so the actual spawn/kill/
 * progress-event wiring is exercised for real, not mocked.
 *
 * Run with: node --test src/lib/ffmpeg/__tests__/export-cancellation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { renderExport, ExportCancelledError, ExportStalledError, type ExportOptions } from "../index.ts";

const MINIMAL_ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 64
PlayResY: 64

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

let tmpDir: string;
let assPath: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-export-test-"));
  assPath = path.join(tmpDir, "captions.ass");
  await fs.writeFile(assPath, MINIMAL_ASS, "utf-8");
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

function baseOptions(name: string, overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    inputPath: "",
    assPath,
    outputPath: path.join(tmpDir, `${name}.mp4`),
    canvasWidth: 100,
    canvasHeight: 100,
    resolution: "720p",
    fps: 24,
    quality: "low",
    videoVisible: false,
    backgroundColor: "#000000",
    duration: 0.3,
    ...overrides,
  };
}

test("7. an already-aborted signal rejects immediately with ExportCancelledError, without ever spawning ffmpeg", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    renderExport(baseOptions("already-aborted", { signal: controller.signal })),
    ExportCancelledError,
  );
});

test("7. aborting mid-render kills ffmpeg and rejects with ExportCancelledError instead of completing", async () => {
  const controller = new AbortController();
  const promise = renderExport(
    baseOptions("mid-render-cancel", {
      // Large enough that encoding takes measurably longer than the kill signal's latency —
      // see the test file's doc comment; a source this size at "veryfast" won't finish before
      // the abort lands on the very first progress event.
      resolution: "4k",
      duration: 20,
      fps: 30,
      quality: "maximum",
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  );
  await assert.rejects(promise, ExportCancelledError);
});

test("8. a render with no progress within the stall timeout rejects with ExportStalledError (recoverable, not a hang)", async () => {
  const prevTimeout = process.env.SUBLY_EXPORT_STALL_TIMEOUT_MS;
  process.env.SUBLY_EXPORT_STALL_TIMEOUT_MS = "1";
  try {
    await assert.rejects(renderExport(baseOptions("stall")), ExportStalledError);
  } finally {
    if (prevTimeout === undefined) delete process.env.SUBLY_EXPORT_STALL_TIMEOUT_MS;
    else process.env.SUBLY_EXPORT_STALL_TIMEOUT_MS = prevTimeout;
  }
});

test("10. an ordinary export with no cancellation/stall still completes and writes a real output file (existing successful export still works)", async () => {
  const outputPath = path.join(tmpDir, "success.mp4");
  await renderExport(baseOptions("success", { outputPath }));
  const stat = await fs.stat(outputPath);
  assert.ok(stat.size > 0, "expected a non-empty rendered output file");
});
