/**
 * Automated tests for the composition canvas (canvas dimensions, video-layer visibility,
 * solid background) — types/subtitle.ts resolveComposition, lib/ffmpeg/index.ts
 * planExportRender, and lib/subtitles/ass.ts buildAssDocument's independence from
 * video-visibility/playRes source.
 *
 * Run with: node --test src/lib/subtitles/__tests__/composition.test.ts
 * (or the "test:composition" package.json script)
 *
 * Same zero-dependency pattern as the other suites in this directory: Node's own built-in
 * test runner, explicit relative `.ts` import extensions.
 *
 * NOT covered here (documented rather than faked): undo/redo for composition changes.
 * `setComposition` in editor-store.ts is a plain `commit()`-wrapped patch merge — the exact
 * same mechanism `setTimingRules`/`splitSubtitle`/every other editing action already uses,
 * so it inherits undo/redo for free from that shared, already-battle-tested machinery rather
 * than needing its own bespoke logic. Verified live (dev + packaged app) instead of unit
 * tested, for the same reason importing the zustand store here isn't attempted: editor-store.ts
 * pulls in several other modules via the bundler-only "@/" alias, which plain `node --test`
 * cannot resolve without a custom loader.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveComposition, DEFAULT_COMPOSITION, ASPECT_RATIO_DIMS } from "../../../types/subtitle.ts";
import type { Subtitle } from "../../../types/subtitle.ts";
import { planExportRender, computeExportDimensions } from "../../ffmpeg/index.ts";
import { buildAssDocument } from "../ass.ts";

// --- resolveComposition -----------------------------------------------------------------

test("1. default canvas dimensions — no video, no stored composition", () => {
  const c = resolveComposition(null);
  assert.equal(c.canvasWidth, 1080);
  assert.equal(c.canvasHeight, 1920);
  assert.deepEqual(c, DEFAULT_COMPOSITION);
});

test("2. custom canvas dimensions round-trip through resolveComposition unchanged", () => {
  const c = resolveComposition({ canvasWidth: 1337, canvasHeight: 733 });
  assert.equal(c.canvasWidth, 1337);
  assert.equal(c.canvasHeight, 733);
});

test("3. 9:16 preset dimensions", () => {
  const dims = ASPECT_RATIO_DIMS["9:16"];
  const c = resolveComposition({ canvasWidth: dims.w, canvasHeight: dims.h });
  assert.deepEqual([c.canvasWidth, c.canvasHeight], [1080, 1920]);
});

test("4. 16:9 preset dimensions", () => {
  const dims = ASPECT_RATIO_DIMS["16:9"];
  const c = resolveComposition({ canvasWidth: dims.w, canvasHeight: dims.h });
  assert.deepEqual([c.canvasWidth, c.canvasHeight], [1920, 1080]);
});

test("5. 1:1 preset dimensions", () => {
  const dims = ASPECT_RATIO_DIMS["1:1"];
  const c = resolveComposition({ canvasWidth: dims.w, canvasHeight: dims.h });
  assert.deepEqual([c.canvasWidth, c.canvasHeight], [1080, 1080]);
});

test("6. 4:5 preset dimensions", () => {
  const dims = ASPECT_RATIO_DIMS["4:5"];
  const c = resolveComposition({ canvasWidth: dims.w, canvasHeight: dims.h });
  assert.deepEqual([c.canvasWidth, c.canvasHeight], [1080, 1350]);
});

test("7. video visibility defaults to true", () => {
  assert.equal(resolveComposition(null).videoVisible, true);
  assert.equal(resolveComposition({}).videoVisible, true);
});

test("8. turning video off leaves every other composition setting untouched", () => {
  const before = resolveComposition({ canvasWidth: 1920, canvasHeight: 1080, backgroundColor: "#123456", videoVisible: true });
  const after = resolveComposition({ ...before, videoVisible: false });
  assert.equal(after.canvasWidth, before.canvasWidth);
  assert.equal(after.canvasHeight, before.canvasHeight);
  assert.equal(after.backgroundColor, before.backgroundColor);
  assert.equal(after.videoVisible, false);
  // Caption rendering itself (SubtitleOverlay / buildAssDocument) never receives a
  // videoVisible flag at all — see tests 15/16 below, which show caption timing and
  // word-highlight tags are identical regardless of what playRes/video state produced them.
});

test("9. background color persists through resolveComposition", () => {
  assert.equal(resolveComposition({ backgroundColor: "#1A1A1A" }).backgroundColor, "#1A1A1A");
  assert.equal(resolveComposition(null).backgroundColor, "#000000");
});

test("10. existing projects without composition settings still load — falls back to the source video's own dimensions, not a generic default", () => {
  const withVideo = resolveComposition(null, { width: 640, height: 360 });
  assert.equal(withVideo.canvasWidth, 640);
  assert.equal(withVideo.canvasHeight, 360);
  assert.equal(withVideo.videoVisible, true);
  assert.equal(withVideo.backgroundColor, "#000000");

  const withoutVideo = resolveComposition(null, undefined);
  assert.equal(withoutVideo.canvasWidth, DEFAULT_COMPOSITION.canvasWidth);
  assert.equal(withoutVideo.canvasHeight, DEFAULT_COMPOSITION.canvasHeight);

  // A project that already saved SOME composition JSON (even from a future version that
  // only wrote a subset of fields) must keep its own saved dimensions, not silently jump to
  // the video's — this is what actually distinguishes "never saved" from "saved".
  const partiallySaved = resolveComposition({ canvasWidth: 999 }, { width: 640, height: 360 });
  assert.equal(partiallySaved.canvasWidth, 999);
});

// --- planExportRender --------------------------------------------------------------------

const baseExportOpts = {
  inputPath: "in.mp4",
  assPath: "a.ass",
  outputPath: "out.mp4",
  canvasWidth: 1080,
  canvasHeight: 1920,
  resolution: "1080p" as const,
  fps: 30 as const,
  quality: "high" as const,
};

test("11. video-on export uses the real video input, fit (not cropped) inside the canvas", () => {
  const plan = planExportRender(baseExportOpts);
  assert.equal(plan.useVideo, true);
  assert.equal(plan.lavfiInput, undefined);
  // Never crops: "decrease" fits the source inside width x height, shrinking to fit rather
  // than filling by cutting off part of the frame — the same "contain" model as the live
  // preview's object-contain, then pads any leftover canvas area with the background color.
  assert.doesNotMatch(plan.filter, /crop=/);
  assert.match(plan.filter, /force_original_aspect_ratio=decrease/);
  assert.match(plan.filter, /pad=1080:1920/);
  assert.match(plan.filter, /subtitles=/);
  assert.equal(plan.width, 1080);
  assert.equal(plan.height, 1920);
});

test("12. video-off export does not use the video — solid-color lavfi source instead", () => {
  const plan = planExportRender({
    ...baseExportOpts,
    videoVisible: false,
    backgroundColor: "#112233",
    duration: 12,
  });
  assert.equal(plan.useVideo, false);
  assert.ok(plan.lavfiInput);
  assert.match(plan.lavfiInput!, /^color=/);
  assert.match(plan.lavfiInput!, /c=0x112233/);
  // No crop/scale/pad/select — a color source is already exactly the target size and duration.
  assert.doesNotMatch(plan.filter, /crop=/);
  assert.doesNotMatch(plan.filter, /scale=/);
  assert.doesNotMatch(plan.filter, /pad=/);
  assert.doesNotMatch(plan.filter, /select=/);
  assert.match(plan.filter, /subtitles=/);
});

test("13. video-off export uses the project's actual canvas dimensions (rounded to even)", () => {
  // canvasWidth (1080) already matches the "1080p" tier's short edge exactly (scale = 1), so
  // canvasHeight's odd->even rounding is isolated from the quality-scaling arithmetic.
  const plan = planExportRender({ ...baseExportOpts, videoVisible: false, canvasWidth: 1080, canvasHeight: 1921, duration: 5 });
  assert.equal(plan.width, 1080);
  assert.equal(plan.height, 1922);
  assert.match(plan.lavfiInput!, /s=1080x1922/);
});

test("14. video-off export preserves the project's edited-timeline duration", () => {
  const plan = planExportRender({ ...baseExportOpts, videoVisible: false, duration: 30 });
  assert.match(plan.lavfiInput!, /d=30(?!\d)/);

  const shortened = planExportRender({ ...baseExportOpts, videoVisible: false, duration: 12.5 });
  assert.match(shortened.lavfiInput!, /d=12\.5/);
});

test("17. mismatched canvas (1080x1080 square canvas, 9:16 source) fits without cropping — video-on and video-off report the same output dimensions", () => {
  const videoOn = planExportRender({ ...baseExportOpts, canvasWidth: 1080, canvasHeight: 1080, backgroundColor: "#39FF14" });
  assert.equal(videoOn.width, 1080);
  assert.equal(videoOn.height, 1080);
  assert.match(videoOn.filter, /scale=1080:1080:force_original_aspect_ratio=decrease/);
  assert.match(videoOn.filter, /pad=1080:1080.*color=0x39FF14/);

  const videoOff = planExportRender({ ...baseExportOpts, canvasWidth: 1080, canvasHeight: 1080, videoVisible: false, duration: 10 });
  assert.equal(videoOff.width, 1080);
  assert.equal(videoOff.height, 1080);
  // Same canvas -> same output frame size in both branches, so a caption authored against
  // one renders identically positioned in the other (see tests 15/16).
  assert.equal(videoOn.width, videoOff.width);
  assert.equal(videoOn.height, videoOff.height);
});

test("18. 16:9 source into a 9:16 canvas — export quality scales the canvas, never changes its ratio", () => {
  const portrait1080 = computeExportDimensions(1080, 1920, "1080p");
  assert.deepEqual(portrait1080, { width: 1080, height: 1920 });

  // Picking a different export-quality tier scales both dimensions by the same factor —
  // the ratio (width/height) is identical before and after, never substituted with a
  // different one the way the old aspectRatio selector could.
  const portrait720 = computeExportDimensions(1080, 1920, "720p");
  const portrait4k = computeExportDimensions(1080, 1920, "4k");
  const ratio = (d: { width: number; height: number }) => d.width / d.height;
  assert.ok(Math.abs(ratio(portrait720) - ratio(portrait1080)) < 0.001);
  assert.ok(Math.abs(ratio(portrait4k) - ratio(portrait1080)) < 0.001);
  assert.deepEqual(portrait720, { width: 720, height: 1280 });
  assert.deepEqual(portrait4k, { width: 2160, height: 3840 });

  // A landscape 16:9 canvas at the same quality tiers keeps ITS OWN ratio too — the two
  // orientations never bleed into each other.
  const landscape1080 = computeExportDimensions(1920, 1080, "1080p");
  assert.deepEqual(landscape1080, { width: 1920, height: 1080 });
});

// --- buildAssDocument: captions are identical regardless of what produced playResX/Y -----

function makeSubtitle(): Subtitle {
  return {
    id: "s1",
    index: 0,
    start: 1.5,
    end: 3.75,
    text: "hello world",
    words: [
      { text: "hello", start: 1.5, end: 2.1 },
      { text: "world", start: 2.1, end: 3.75 },
    ],
  };
}

test("15. caption timestamps are identical whether playRes came from the legacy aspect-ratio tiers or the video-off canvas", () => {
  const subtitle = makeSubtitle();
  const globalStyle = { ...DEFAULT_STYLE_FOR_TEST() };
  const globalAnimation = { entrance: "fade" as const, exit: "none" as const, word: "highlight" as const, durationSec: 0.2 };

  // Different playRes (as if one came from the legacy 9:16 aspect-ratio tiers and the other
  // from an unrelated custom video-off canvas) — buildAssDocument has no "video visible"
  // concept at all, so the Dialogue line's start/end timestamps must be identical either way.
  const videoOnAss = buildAssDocument({ subtitles: [subtitle], globalStyle, globalAnimation, playResX: 1080, playResY: 1920 });
  const videoOffAss = buildAssDocument({ subtitles: [subtitle], globalStyle, globalAnimation, playResX: 1600, playResY: 900 });

  const timestamps = (doc: string) =>
    doc
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"))
      .map((l) => l.match(/\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d/)![0]);
  const on = timestamps(videoOnAss);
  const off = timestamps(videoOffAss);
  assert.ok(on.length > 0);
  assert.deepEqual(on, off); // every Dialogue event's start/end is identical regardless of playRes
  assert.ok(on.some((t) => t.startsWith("0:00:01.50"))); // subtitle's own start is unaffected by playRes source
  assert.ok(on.some((t) => t.endsWith("0:00:03.75"))); // subtitle's own end is unaffected by playRes source
});

test("16. word-highlight override tags render the same regardless of playRes source", () => {
  const subtitle = makeSubtitle();
  const globalStyle = { ...DEFAULT_STYLE_FOR_TEST(), wordHighlight: true, highlightColor: "#FF00FF" };
  const globalAnimation = { entrance: "none" as const, exit: "none" as const, word: "color" as const, durationSec: 0.2 };

  const a = buildAssDocument({ subtitles: [subtitle], globalStyle, globalAnimation, playResX: 1920, playResY: 1080 });
  const b = buildAssDocument({ subtitles: [subtitle], globalStyle, globalAnimation, playResX: 1080, playResY: 1080 });

  // The word-color override tag itself (\c&HFF00FF&-style) doesn't depend on PlayRes at
  // all — only position/size fields scale with it — so the same highlight color appears
  // in both regardless of which canvas produced the document.
  assert.ok(a.includes("FF00FF"));
  assert.ok(b.includes("FF00FF"));
});

function DEFAULT_STYLE_FOR_TEST() {
  return {
    fontFamily: "Inter",
    fontSource: "bundled" as const,
    fontSize: 64,
    fontWeight: 800 as const,
    letterSpacing: 0,
    lineHeight: 1.15,
    textCase: "none" as const,
    color: "#FFFFFF",
    highlightColor: "#7C3AED",
    opacity: 1,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    backgroundRadius: 12,
    backgroundPaddingX: 20,
    backgroundPaddingY: 10,
    boxWidthPercent: 82,
    outlineEnabled: true,
    outlineColor: "#000000",
    outlineWidth: 6,
    shadowEnabled: false,
    shadowColor: "#000000",
    shadowBlur: 12,
    shadowOffsetX: 0,
    shadowOffsetY: 2,
    shadowOpacity: 0.5,
    x: 50,
    y: 82,
    align: "center" as const,
    vAlign: "bottom" as const,
    wordHighlight: false,
    activeWordScale: 1.12,
  };
}
