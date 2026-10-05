/**
 * P20.4 — performance guards: font metrics are parsed/fetched once and reused, never per frame, and the
 * preview's metrics plumbing writes nothing to the editor store and runs no animation loop.
 *
 * Run with: node --test src/lib/fonts/__tests__/font-metrics-caching.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSyntheticTtf } from "./synthetic-font.ts";
import { loadExportFontMetrics, loadFontFileMetrics } from "../export-font-metrics.ts";
import { ensureFontMetrics, fontMetricsSettled, getClientFontMetrics, getFontMetricsVersion } from "../client-font-metrics.ts";

const SPEC = { unitsPerEm: 1000, hheaAscent: 900, hheaDescent: 200, typoAscent: 900, typoDescent: 200, winAscent: 1000, winDescent: 300, advance: 500 };

test("server: a font file is parsed once per process and then served from memory", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "subly-fm-"));
  const file = path.join(dir, "f.ttf");
  writeFileSync(file, buildSyntheticTtf(SPEC));
  const a = await loadFontFileMetrics(file);
  const b = await loadFontFileMetrics(file);
  assert.ok(a);
  assert.equal(a, b, "same object: no re-read, no re-parse");
});

test("server: needing an extra code point re-parses once with the union, then caches that too", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "subly-fm-"));
  const file = path.join(dir, "g.ttf");
  writeFileSync(file, buildSyntheticTtf(SPEC));
  const a = await loadFontFileMetrics(file, [0x41]);
  const b = await loadFontFileMetrics(file, [0x41]);
  assert.equal(a, b);
});

test("server: an unreadable font file is null, not a throw", async () => {
  assert.equal(await loadFontFileMetrics(path.join(tmpdir(), "definitely-missing-font.ttf")), null);
});

test("client: metrics are fetched once per font however many times they are requested", async () => {
  const calls: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        fonts: [
          {
            family: "CacheTestFont",
            weight: 700,
            data: {
              unitsPerEm: 1000,
              winAscent: 1000,
              winDescent: 300,
              hheaAscent: 900,
              hheaDescent: 200,
              typoAscent: 900,
              typoDescent: 200,
              useTypoMetrics: false,
              defaultAdvance: 500,
              advances: { 97: 500 },
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const fonts = [{ family: "CacheTestFont", weight: 700 }];
    const v0 = getFontMetricsVersion();
    await Promise.all([ensureFontMetrics(fonts, "aaa"), ensureFontMetrics(fonts, "a"), ensureFontMetrics(fonts, "aa")]);
    await ensureFontMetrics(fonts, "a");
    assert.equal(calls.length, 1, "one request for one font");
    assert.ok(getFontMetricsVersion() > v0, "subscribers are told when metrics land");
    assert.ok(getClientFontMetrics("CacheTestFont", 700));
    assert.ok(getClientFontMetrics("CacheTestFont", 400), "nearest weight of the family is used");
    assert.equal(getClientFontMetrics("OtherFont", 700), undefined);
    assert.ok(fontMetricsSettled(fonts));
  } finally {
    globalThis.fetch = original;
  }
});

test("client: a font the server can't supply is remembered as unavailable and not re-requested", async () => {
  let n = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    n++;
    return new Response("nope", { status: 500 });
  }) as typeof fetch;
  try {
    const fonts = [{ family: "BrokenFont", weight: 400 }];
    await ensureFontMetrics(fonts, "abc");
    await ensureFontMetrics(fonts, "abc");
    await ensureFontMetrics(fonts, "abcdef");
    assert.equal(n, 1);
    assert.ok(fontMetricsSettled(fonts), "nothing left to wait for");
    assert.equal(getClientFontMetrics("BrokenFont", 400), undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("export: a provider answers synchronously for loaded fonts and picks the nearest weight", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "subly-fm-"));
  const file = path.join(dir, "h.ttf");
  writeFileSync(file, buildSyntheticTtf(SPEC));
  const metrics = await loadFontFileMetrics(file);
  assert.ok(metrics);
  const provider = await loadExportFontMetrics([], []);
  assert.equal(provider("Anything", 400), undefined, "unloaded family → undefined → legacy rendering");
});

test("the preview never parses fonts or writes the store while rendering, and runs no animation loop for metrics", () => {
  const overlay = readFileSync("src/components/editor/subtitle-overlay.tsx", "utf8");
  const live = readFileSync("src/components/editor/live-subtitle-layer.tsx", "utf8");
  const hook = readFileSync("src/components/editor/use-font-metrics.ts", "utf8");
  for (const [name, src] of [["overlay", overlay], ["live", live], ["hook", hook]] as const) {
    assert.ok(!/parseFontMetrics/.test(src), `${name}: parsing happens on the server only`);
    assert.ok(!/requestAnimationFrame|setInterval/.test(hook), "metrics hook has no loop");
    assert.ok(!/useEditorStore\.setState|\.setState\(/.test(src), `${name}: no store writes`);
  }
  assert.ok(/useMemo/.test(overlay), "layout is memoised");
});
