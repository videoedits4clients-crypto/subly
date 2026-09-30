/**
 * Task 121684 (P19.2) — long-timeline performance regression: proves that zoom/fit/virtualization
 * stay bounded by the VIEWPORT, never by the project's own duration, at realistic 30s/5m/30m
 * scales. Pure math only — no React, no DOM, no real canvas (waveform.tsx's own canvas-sizing
 * formula is replicated here directly, the same "test a component's own inline arithmetic without
 * requiring it to be exported first" precedent already used for timeline.tsx's zoom min/max clamp
 * in fit-view.test.ts — extracting it purely to gain this one test would be unnecessary
 * abstraction for a two-line formula).
 *
 * Run with: node --test src/lib/timeline/__tests__/long-timeline-performance.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { filterVisibleSubtitles } from "../visible-range.ts";
import { computeFitView } from "../fit-view.ts";
import type { Subtitle } from "../../../types/subtitle.ts";

const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 220;

function buildProject(durationSec: number, captionSpacingSec: number): Pick<Subtitle, "id" | "index" | "start" | "end">[] {
  const count = Math.floor(durationSec / captionSpacingSec);
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    index: i,
    start: i * captionSpacingSec,
    end: i * captionSpacingSec + captionSpacingSec * 0.8,
  }));
}

/** Mirrors waveform.tsx's own `buffer`/`drawStart`/`drawEnd`/`drawWidth` formula exactly — see
 * that component's own doc comment for why it's bounded by the viewport, never total duration. */
function computeWaveformDrawWidth(viewportScrollLeft: number, viewportWidth: number, totalWidth: number): number {
  const buffer = Math.max(200, viewportWidth);
  const drawStart = Math.max(0, viewportScrollLeft - buffer);
  const drawEnd = Math.min(totalWidth, viewportScrollLeft + viewportWidth + buffer);
  return Math.max(1, Math.ceil(drawEnd - drawStart));
}

for (const [label, durationSec] of [["30s", 30], ["5m", 300], ["30m", 1800]] as const) {
  test(`${label} project: filterVisibleSubtitles returns a small, viewport-bounded subset, not the whole project`, () => {
    const subs = buildProject(durationSec, 2); // one caption every 2s
    const t0 = performance.now();
    const visible = filterVisibleSubtitles(subs, { scrollLeft: (durationSec / 2) * MAX_PX_PER_SEC, viewportWidth: 1200, pxPerSec: MAX_PX_PER_SEC });
    const elapsedMs = performance.now() - t0;
    assert.ok(visible.length < subs.length, `at ${label}, virtualization must return fewer than all ${subs.length} captions`);
    assert.ok(visible.length < 50, `at ${label}, the visible window should stay small (viewport-bounded), got ${visible.length}`);
    assert.ok(elapsedMs < 50, `filterVisibleSubtitles took ${elapsedMs.toFixed(1)}ms at ${label} — expected well under 50ms`);
  });

  test(`${label} project: Fit to Project stays within the existing zoom range and produces a valid, fast result`, () => {
    const t0 = performance.now();
    const result = computeFitView({ range: { start: 0, end: durationSec }, duration: durationSec, viewportWidth: 1200, minPxPerSec: MIN_PX_PER_SEC, maxPxPerSec: MAX_PX_PER_SEC });
    const elapsedMs = performance.now() - t0;
    assert.ok(result, `Fit to Project must succeed for a real ${label} duration`);
    assert.ok(result!.pxPerSec >= MIN_PX_PER_SEC && result!.pxPerSec <= MAX_PX_PER_SEC, "pxPerSec stays within the existing, unmodified zoom range");
    assert.equal(result!.scrollLeft, 0, "project start visible, no unnecessary empty area before it");
    assert.ok(elapsedMs < 5, `computeFitView took ${elapsedMs.toFixed(1)}ms at ${label} — must be near-instant (pure arithmetic, not a loop over captions)`);
  });

  test(`${label} project: the waveform's own canvas draw width stays bounded by the viewport (+ buffer), never by total duration — no giant canvas`, () => {
    const totalWidth = Math.max(800, durationSec * MAX_PX_PER_SEC); // MAX zoom — the worst case for canvas size
    const viewportWidth = 1200;
    // Deeply scrolled — worst case for "did we accidentally draw the whole track."
    const scrollLeft = Math.max(0, totalWidth - viewportWidth);
    const drawWidth = computeWaveformDrawWidth(scrollLeft, viewportWidth, totalWidth);
    assert.ok(drawWidth <= viewportWidth + 2 * Math.max(200, viewportWidth) + 1, `draw width must stay viewport-bounded, got ${drawWidth}px for a ${label} project`);
    assert.ok(drawWidth < totalWidth, `at ${label} and max zoom, the full track is ${totalWidth}px — the canvas must never approach that`);
    // Chromium's own per-side canvas dimension cap — see waveform.tsx's own doc comment.
    assert.ok(drawWidth < 32767, "must stay well under the browser's own canvas dimension limit");
  });
}

test("30m project at MAX zoom: the full un-virtualized track width would be huge, confirming virtualization is doing real work (not just technically correct at a small scale)", () => {
  const totalWidth = 1800 * MAX_PX_PER_SEC;
  assert.ok(totalWidth > 300000, `sanity check: a 30-minute track at max zoom is ${totalWidth}px wide — comfortably past what any of the above tests would tolerate rendering directly`);
});
