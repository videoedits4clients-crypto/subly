/**
 * Regression tests for computeExportDimensions/planExportRender (src/lib/ffmpeg/index.ts) —
 * these two pure functions are the ONE source of truth for what pixel size an export actually
 * renders at (see export-pipeline.ts, which also sizes the ASS document's PlayResX/PlayResY from
 * computeExportDimensions so captions map 1:1 onto pixels) and existed with no direct unit test
 * before this phase, despite being exactly what Phase 2/4/11's "does resolution/aspect-ratio
 * actually reach ffmpeg, and does the output match what was requested" audit is about.
 *
 * Run with: node --test src/lib/ffmpeg/__tests__/export-dimensions.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeExportDimensions, planExportRender, type ExportOptions } from "../index.ts";

function baseOpts(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    inputPath: "/tmp/in.mp4",
    assPath: "/tmp/captions.ass",
    outputPath: "/tmp/out.mp4",
    canvasWidth: 1080,
    canvasHeight: 1920,
    resolution: "1080p",
    fps: 30,
    quality: "high",
    ...overrides,
  };
}

// --- computeExportDimensions: aspect ratio must be preserved, scaled by the SHORTER edge -----

test("9:16 (1080x1920) at 1080p stays exactly 1080x1920 — resolution tier matches the canvas's own shorter edge 1:1", () => {
  assert.deepEqual(computeExportDimensions(1080, 1920, "1080p"), { width: 1080, height: 1920 });
});

test("9:16 (1080x1920) at 720p scales down proportionally, preserving the exact 9:16 ratio", () => {
  const { width, height } = computeExportDimensions(1080, 1920, "720p");
  assert.deepEqual({ width, height }, { width: 720, height: 1280 });
  assert.equal(height / width, 1920 / 1080, "aspect ratio must be preserved exactly");
});

test("9:16 (1080x1920) at 4k scales up proportionally to a 2160-short-edge frame", () => {
  assert.deepEqual(computeExportDimensions(1080, 1920, "4k"), { width: 2160, height: 3840 });
});

test("16:9 (1920x1080) at 1080p stays exactly 1920x1080 — landscape canvases are never force-rotated to portrait", () => {
  assert.deepEqual(computeExportDimensions(1920, 1080, "1080p"), { width: 1920, height: 1080 });
});

test("16:9 (1920x1080) at 720p scales down proportionally", () => {
  assert.deepEqual(computeExportDimensions(1920, 1080, "720p"), { width: 1280, height: 720 });
});

test("1:1 (1080x1080) stays square at every resolution tier", () => {
  assert.deepEqual(computeExportDimensions(1080, 1080, "1080p"), { width: 1080, height: 1080 });
  assert.deepEqual(computeExportDimensions(1080, 1080, "720p"), { width: 720, height: 720 });
  assert.deepEqual(computeExportDimensions(1080, 1080, "4k"), { width: 2160, height: 2160 });
});

test("output dimensions are always even (h264 requirement), even for an odd-pixel source canvas", () => {
  const { width, height } = computeExportDimensions(1081, 1921, "720p");
  assert.equal(width % 2, 0);
  assert.equal(height % 2, 0);
});

test("4:5 (1080x1350, the app's own 'Portrait' composition preset) scales correctly at every tier", () => {
  assert.deepEqual(computeExportDimensions(1080, 1350, "1080p"), { width: 1080, height: 1350 });
  const at720 = computeExportDimensions(1080, 1350, "720p");
  assert.equal(at720.width, 720);
  assert.equal(Math.abs(at720.height / at720.width - 1350 / 1080) < 0.01, true);
});

// --- planExportRender: the actual ffmpeg filter chain and input selection ---------------------

test("videoVisible: true fits+pads the real video and burns captions, sized from computeExportDimensions", () => {
  const plan = planExportRender(baseOpts({ canvasWidth: 1920, canvasHeight: 1080, resolution: "1080p" }));
  assert.equal(plan.useVideo, true);
  assert.equal(plan.lavfiInput, undefined);
  assert.deepEqual({ width: plan.width, height: plan.height }, { width: 1920, height: 1080 });
  assert.match(plan.filter, /scale=1920:1080/);
  assert.match(plan.filter, /pad=1920:1080/);
  assert.match(plan.filter, /subtitles='/);
});

test("videoVisible: false renders a solid-color lavfi source sized identically to the video-on path, with no scale/pad filter", () => {
  const plan = planExportRender(baseOpts({ videoVisible: false, duration: 12.5, backgroundColor: "#112233", canvasWidth: 1920, canvasHeight: 1080 }));
  assert.equal(plan.useVideo, false);
  assert.deepEqual({ width: plan.width, height: plan.height }, { width: 1920, height: 1080 }, "video-off path must size identically to video-on for the same canvas/resolution");
  assert.match(plan.lavfiInput!, /color=c=0x112233:s=1920x1080:d=12\.5:r=30/);
  assert.doesNotMatch(plan.filter, /scale=/, "no video to fit/pad when there's no video");
  assert.match(plan.filter, /subtitles='/);
});

test("the video-on filter chain always forces a 1:1 pixel aspect ratio (setsar=1) — regression test for a confirmed bug where libx264's own default SAR was slightly off (observed 1216:1215) for several canvas sizes, including a perfectly square one", () => {
  const plan = planExportRender(baseOpts({ canvasWidth: 1080, canvasHeight: 1080, resolution: "1080p" }));
  assert.match(plan.filter, /setsar=1/);
  // setsar must come after pad (so it applies to the FINAL padded frame) and before subtitles.
  assert.ok(plan.filter.indexOf("pad=") < plan.filter.indexOf("setsar=1"));
  assert.ok(plan.filter.indexOf("setsar=1") < plan.filter.indexOf("subtitles="));
});

test("the video-off (lavfi solid-color) filter chain also forces setsar=1, for the same reason", () => {
  const plan = planExportRender(baseOpts({ videoVisible: false, duration: 1, canvasWidth: 1080, canvasHeight: 1080 }));
  assert.match(plan.filter, /setsar=1/);
});

test("fontsDir, when provided, is passed to the subtitles filter as :fontsdir=", () => {
  const plan = planExportRender(baseOpts({ fontsDir: "/tmp/fonts" }));
  assert.match(plan.filter, /subtitles='[^']+':fontsdir='\/tmp\/fonts'/);
});

test("fontsDir omitted leaves the subtitles filter with no :fontsdir= clause (libass falls back to system fontconfig)", () => {
  const plan = planExportRender(baseOpts());
  assert.doesNotMatch(plan.filter, /fontsdir/);
});

test("keepRanges (trim/cut) become a select= expression ANDed with setpts, ahead of the scale/pad chain", () => {
  const plan = planExportRender(
    baseOpts({ keepRanges: [{ start: 0, end: 2 }, { start: 5, end: 8 }] }),
  );
  assert.match(plan.filter, /select='between\(t,0,2\)\+between\(t,5,8\)'/);
  assert.match(plan.filter, /setpts=N\/FRAME_RATE\/TB/);
  // The select/setpts stage must come BEFORE scale/pad, not after.
  assert.ok(plan.filter.indexOf("select=") < plan.filter.indexOf("scale="));
});

test("no keepRanges means no select filter at all — the whole source plays", () => {
  const plan = planExportRender(baseOpts());
  assert.doesNotMatch(plan.filter, /select=/);
});

test("resolution tier changes the plan's actual pixel size without changing the canvas's aspect ratio", () => {
  const p720 = planExportRender(baseOpts({ resolution: "720p" }));
  const p1080 = planExportRender(baseOpts({ resolution: "1080p" }));
  const p4k = planExportRender(baseOpts({ resolution: "4k" }));
  for (const p of [p720, p1080, p4k]) {
    assert.equal(Math.abs(p.height / p.width - 1920 / 1080) < 0.01, true, "9:16 ratio preserved at every tier");
  }
  assert.notEqual(p720.width, p1080.width);
  assert.notEqual(p1080.width, p4k.width);
});
