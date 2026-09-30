/**
 * Phase 11 ("export settings <-> output verification") — technically-correct, non-mocked proof
 * that a REQUESTED resolution/aspect-ratio/fps actually reaches ffmpeg and shows up in the real
 * rendered file, not just in the pure planExportRender plan (see export-dimensions.test.ts for
 * that). Runs the real bundled ffmpeg-static binary against a tiny solid-color lavfi source (no
 * input video fixture needed) — same established pattern as export-cancellation.test.ts — then
 * probes the real output with the SAME probeVideo/verifyExportOutput functions the production
 * export pipeline uses, so this is the actual production verification path, not a reimplementation.
 *
 * Run with: node --test src/lib/ffmpeg/__tests__/export-settings-output.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import ffmpeg from "fluent-ffmpeg";
import { renderExport, probeVideo, type ExportOptions } from "../index.ts";
import { verifyExportOutput } from "../../export-output-verification.ts";

const MINIMAL_ASS = (w: number, h: number) => `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:00.30,Default,,0,0,0,,Hello
`;

let tmpDir: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subly-export-settings-test-"));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function renderAndVerify(name: string, canvasWidth: number, canvasHeight: number, resolution: ExportOptions["resolution"], fps: 24 | 30 | 60) {
  const assPath = path.join(tmpDir, `${name}.ass`);
  const outputPath = path.join(tmpDir, `${name}.mp4`);
  await fs.writeFile(assPath, MINIMAL_ASS(canvasWidth, canvasHeight), "utf-8");

  await renderExport({
    inputPath: "",
    assPath,
    outputPath,
    canvasWidth,
    canvasHeight,
    resolution,
    fps,
    quality: "low",
    videoVisible: false,
    backgroundColor: "#000000",
    duration: 0.3,
  });

  const verification = await verifyExportOutput({ outputPath });
  assert.ok(verification.ok, `verifyExportOutput must accept a real, freshly-rendered file: ${verification.message}`);
  return verification.metadata!;
}

test("requested 16:9 1920x1080 @1080p produces a real file that actually probes as 1920x1080", async () => {
  const meta = await renderAndVerify("landscape-1080p", 1920, 1080, "1080p", 30);
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 1080);
});

test("requested 9:16 1080x1920 @1080p produces a real file that actually probes as 1080x1920 (never accidentally swapped/stretched to landscape)", async () => {
  const meta = await renderAndVerify("portrait-1080p", 1080, 1920, "1080p", 30);
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
});

test("requested 1:1 720x720 @720p produces a real file that actually probes as square", async () => {
  const meta = await renderAndVerify("square-720p", 1080, 1080, "720p", 30);
  assert.equal(meta.width, 720);
  assert.equal(meta.height, 720);
});

test("requesting 720p on a 9:16 canvas produces a real file smaller than requesting 1080p on the same canvas, in the same 9:16 ratio", async () => {
  const at720 = await renderAndVerify("scale-720p", 1080, 1920, "720p", 30);
  const at1080 = await renderAndVerify("scale-1080p", 1080, 1920, "1080p", 30);
  assert.ok(at720.width < at1080.width, "720p tier must actually be smaller than 1080p, not just a label");
  assert.equal(Math.abs(at720.height / at720.width - at1080.height / at1080.width) < 0.01, true, "both tiers preserve the same 9:16 ratio");
});

test("a real rendered 1:1 (square) export has an exactly 1:1 pixel aspect ratio, not a slightly-off encoder default — regression test for a confirmed Phase-4 bug", async () => {
  const assPath = path.join(tmpDir, "sar-square.ass");
  const outputPath = path.join(tmpDir, "sar-square.mp4");
  await fs.writeFile(assPath, MINIMAL_ASS(1080, 1080), "utf-8");
  await renderExport({
    inputPath: "",
    assPath,
    outputPath,
    canvasWidth: 1080,
    canvasHeight: 1080,
    resolution: "1080p",
    fps: 30,
    quality: "low",
    videoVisible: false,
    backgroundColor: "#000000",
    duration: 0.3,
  });
  const meta = await probeVideo(outputPath);
  assert.equal(meta.width, meta.height, "a square canvas must produce a square-pixel-count output");
  // probeVideo doesn't surface SAR directly — read it straight from ffprobe's raw stream data,
  // the same field the bug was originally confirmed against.
  const sar = await new Promise<string | undefined>((resolve, reject) => {
    ffmpeg.ffprobe(outputPath, (err, data) => {
      if (err) return reject(err);
      const v = data.streams.find((s) => s.codec_type === "video") as { sample_aspect_ratio?: string } | undefined;
      resolve(v?.sample_aspect_ratio);
    });
  });
  assert.ok(sar === "1:1" || sar === "N/A" || sar === undefined, `expected an exact 1:1 (or unset/default) sample aspect ratio for a square export, got ${sar}`);
});

test("requested FPS is reflected in the real encoded output's own frame rate", async () => {
  const outputPath = path.join(tmpDir, "fps-check.mp4");
  const assPath = path.join(tmpDir, "fps-check.ass");
  await fs.writeFile(assPath, MINIMAL_ASS(320, 240), "utf-8");
  await renderExport({
    inputPath: "",
    assPath,
    outputPath,
    canvasWidth: 320,
    canvasHeight: 240,
    resolution: "720p",
    fps: 24,
    quality: "low",
    videoVisible: false,
    backgroundColor: "#000000",
    duration: 0.5,
  });
  const meta = await probeVideo(outputPath);
  // Not exact-equality (a CFR encode can legitimately report e.g. 24.0 vs 24/1 differently
  // depending on the container's rounding) — technically-correct verification per the task's own
  // "do not require exact FPS equality if the pipeline legitimately represents it differently"
  // instruction, while still catching a real regression (e.g. defaulting to 30 regardless of
  // the request).
  assert.ok(Math.abs(meta.fps - 24) < 0.5, `expected ~24fps, got ${meta.fps}`);
});
