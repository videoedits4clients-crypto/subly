import { codePointsOf, type FontMetricsData } from "./font-metrics.ts";

/**
 * Browser-side cache of font metrics (P20.4), fetched once per font from /api/fonts/metrics and then shared by
 * every preview calculation — never parsed per frame, never fetched twice. The preview's caption layout
 * (lib/subtitles/caption-layout.ts) reads it synchronously through `getClientFontMetrics`; React components
 * re-render when new metrics land by subscribing with `subscribeFontMetrics` / `getFontMetricsVersion`.
 *
 * A font the server can't supply is remembered as unavailable, so the preview quietly falls back to the
 * browser's own wrapping for it instead of retrying forever.
 */

export interface FontMetricsRequest {
  family: string;
  weight: number;
  source?: "bundled" | "system";
}

const keyOf = (r: FontMetricsRequest) => `${r.source ?? "bundled"}|${r.family}|${r.weight}`;

const store = new Map<string, FontMetricsData>();
const unavailable = new Set<string>();
/** Code points already requested per font key, so a later caption with a new character triggers one top-up. */
const requested = new Map<string, Set<number>>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribeFontMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getFontMetricsVersion = () => version;

/** Metrics for the font if loaded: exact weight, else the nearest loaded weight of the same family. */
export function getClientFontMetrics(family: string, weight: number, source: "bundled" | "system" = "bundled"): FontMetricsData | undefined {
  const exact = store.get(keyOf({ family, weight, source }));
  if (exact) return exact;
  let best: FontMetricsData | undefined;
  let bestDistance = Infinity;
  for (const [key, data] of store) {
    const [s, f, w] = key.split("|");
    if (s !== source || f !== family) continue;
    const d = Math.abs(Number(w) - weight);
    if (d < bestDistance) {
      best = data;
      bestDistance = d;
    }
  }
  return best;
}

/** True when every font was either loaded or is known to be unavailable (nothing left to wait for). */
export function fontMetricsSettled(fonts: FontMetricsRequest[]): boolean {
  return fonts.every((f) => store.has(keyOf(f)) || unavailable.has(keyOf(f)));
}

let inflight: Promise<void> = Promise.resolve();

/**
 * Makes sure metrics for `fonts` covering the characters of `text` are in the cache. Requests are queued so
 * concurrent callers never race on the same font; resolves once the cache is up to date.
 */
export function ensureFontMetrics(fonts: FontMetricsRequest[], text: string): Promise<void> {
  const chars = codePointsOf(text);
  const stillNeeded = () =>
    fonts.filter((f) => {
      const key = keyOf(f);
      if (unavailable.has(key)) return false;
      if (!store.has(key)) return true;
      const seen = requested.get(key);
      return chars.some((cp) => !seen?.has(cp));
    });
  if (stillNeeded().length === 0) return inflight;
  inflight = inflight.then(async () => {
    // re-evaluated when the queue reaches us: an earlier queued call may already have fetched these fonts
    const needed = stillNeeded();
    if (needed.length === 0) return;
    try {
      const res = await fetch("/api/fonts/metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fonts: needed.map((f) => ({ family: f.family, weight: f.weight, source: f.source })), text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { fonts: { family: string; weight: number; source?: "bundled" | "system"; data: FontMetricsData | null }[] };
      for (const f of body.fonts) {
        const key = keyOf(f);
        if (f.data) {
          // keep the advances of earlier requests: a top-up only returns the code points it was asked for
          const old = store.get(key);
          store.set(key, old ? { ...f.data, advances: { ...old.advances, ...f.data.advances } } : f.data);
          const seen = requested.get(key) ?? new Set<number>();
          chars.forEach((cp) => seen.add(cp));
          requested.set(key, seen);
        } else {
          unavailable.add(key);
        }
      }
    } catch {
      needed.forEach((f) => unavailable.add(keyOf(f)));
    }
    notify();
  });
  return inflight;
}
