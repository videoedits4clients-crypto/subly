/**
 * Regression tests for the export output verifier (src/lib/export-output-verification.ts) —
 * the gate between "ffmpeg's process exited without error" and "this export is actually safe
 * to hand to the user" (see lib/export-pipeline.ts, which previously treated the former as
 * sufficient proof of the latter). Every case here is exercised with injected fake stat/probe
 * functions — no real file, no real ffmpeg/ffprobe binary, no network — per the P1 task's
 * explicit instruction not to depend on a real Windows installation.
 *
 * Run with: node --test src/lib/__tests__/export-output-verification.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verifyExportOutput } from "../export-output-verification.ts";
import type { VideoProbe } from "../ffmpeg/index.ts";

const VALID_PROBE: VideoProbe = { duration: 12.5, width: 1080, height: 1920, fps: 30, hasAudio: true };

function fakeStat(size: number) {
  return () => Promise.resolve({ size });
}

function fakeProbe(result: VideoProbe) {
  return () => Promise.resolve(result);
}

test("1. missing output file fails", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/missing.mp4",
    stat: () => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, "Export failed: the output file was not created.");
});

test("2. zero-byte output fails", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/empty.mp4",
    stat: fakeStat(0),
  });
  assert.equal(result.ok, false);
  assert.match(result.message!, /could not be verified/);
});

test("3. ffprobe failure (rejects) fails", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/unreadable.mp4",
    stat: fakeStat(1024),
    probe: () => Promise.reject(new Error("ffprobe: invalid data found when processing input")),
  });
  assert.equal(result.ok, false);
  assert.match(result.message!, /incomplete or corrupted/);
});

test("4. valid video succeeds", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/good.mp4",
    stat: fakeStat(5_000_000),
    probe: fakeProbe(VALID_PROBE),
  });
  assert.equal(result.ok, true);
  assert.equal(result.message, undefined);
});

test("5. valid video with a sane duration succeeds", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/good-long.mp4",
    stat: fakeStat(50_000_000),
    probe: fakeProbe({ ...VALID_PROBE, duration: 183.2 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.metadata?.duration, 183.2);
});

test("6. missing video stream (zero width/height) fails", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/no-video-stream.mp4",
    stat: fakeStat(1024),
    probe: fakeProbe({ ...VALID_PROBE, width: 0, height: 0 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message!, /could not be verified/);
});

test("7. malformed ffprobe response (probe throws synchronously) fails, not crashes", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/malformed.mp4",
    stat: fakeStat(1024),
    probe: () => {
      throw new TypeError("Cannot read properties of undefined (reading 'streams')");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message!, /incomplete or corrupted|could not be verified/);
});

test("8. ffprobe that never resolves times out instead of hanging the export worker", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/hangs.mp4",
    stat: fakeStat(1024),
    probe: () => new Promise(() => {}), // never settles
    timeoutMs: 20,
  });
  assert.equal(result.ok, false);
  assert.match(result.message!, /incomplete or corrupted/);
});

test("9. verification never throws an uncontrolled exception, even for wildly malformed inputs", async () => {
  await assert.doesNotReject(
    verifyExportOutput({
      outputPath: "/fake/weird.mp4",
      stat: () => Promise.resolve({ size: Number.NaN } as { size: number }),
      probe: fakeProbe(VALID_PROBE),
    }),
  );
  await assert.doesNotReject(
    verifyExportOutput({
      outputPath: "/fake/weird2.mp4",
      stat: fakeStat(1024),
      probe: fakeProbe({ duration: Number.NaN, width: -1, height: -1, fps: 0, hasAudio: false }),
    }),
  );
});

test("10. every failure message is user-readable — no ffmpeg/ffprobe jargon, no filesystem paths, no stack traces", async () => {
  const cases = [
    await verifyExportOutput({ outputPath: "/fake/a.mp4", stat: () => Promise.reject(new Error("ENOENT")) }),
    await verifyExportOutput({ outputPath: "/fake/b.mp4", stat: fakeStat(0) }),
    await verifyExportOutput({ outputPath: "/fake/c.mp4", stat: fakeStat(1024), probe: () => Promise.reject(new Error("boom")) }),
    await verifyExportOutput({ outputPath: "/fake/d.mp4", stat: fakeStat(1024), probe: fakeProbe({ ...VALID_PROBE, width: 0 }) }),
    await verifyExportOutput({ outputPath: "/fake/e.mp4", stat: fakeStat(1024), probe: fakeProbe({ ...VALID_PROBE, duration: 0 }) }),
  ];
  for (const result of cases) {
    assert.equal(result.ok, false);
    assert.ok(result.message && result.message.length > 0);
    assert.doesNotMatch(result.message!, /ffmpeg|ffprobe|libass|stack|ENOENT|\/fake\/|[A-Za-z]:\\/i);
  }
});

test("11. valid output returns the probed metadata the pipeline needs", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/good.mp4",
    stat: fakeStat(1024),
    probe: fakeProbe(VALID_PROBE),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.metadata, VALID_PROBE);
});

test("12. invalid output is never reported as ok:true — every failure path returns ok:false with a message, never a partial success", async () => {
  const failureCases = [
    { stat: () => Promise.reject(new Error("ENOENT")) },
    { stat: fakeStat(0) },
    { stat: fakeStat(1024), probe: () => Promise.reject(new Error("bad")) },
    { stat: fakeStat(1024), probe: fakeProbe({ ...VALID_PROBE, width: 0, height: 0 }) },
    { stat: fakeStat(1024), probe: fakeProbe({ ...VALID_PROBE, duration: 0 }) },
    { stat: fakeStat(1024), probe: fakeProbe({ ...VALID_PROBE, duration: -5 }) },
  ];
  for (const overrides of failureCases) {
    const result = await verifyExportOutput({ outputPath: "/fake/x.mp4", ...overrides });
    assert.equal(result.ok, false);
    assert.equal(result.metadata, undefined);
    assert.ok(result.message);
  }
});

test("duration exactly zero is treated as incomplete, not a valid zero-length clip", async () => {
  const result = await verifyExportOutput({
    outputPath: "/fake/zero-duration.mp4",
    stat: fakeStat(1024),
    probe: fakeProbe({ ...VALID_PROBE, duration: 0 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message!, /incomplete or corrupted/);
});
