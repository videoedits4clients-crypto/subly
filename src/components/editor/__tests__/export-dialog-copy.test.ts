/**
 * Task 203921 (P19.29) — the Export dialog used to tell users "Captions are burned directly
 * into the video using server-side FFmpeg rendering." That was accurate for a hosted SaaS
 * product; it's misleading for the actual desktop app, where FFmpeg is bundled and export runs
 * entirely on the user's own machine (see docs/DESKTOP.md and the download page's own "runs
 * locally" claims, already fixed to match in P19.21). Found live during the P19.28 launch smoke
 * test.
 *
 * This project has no React-rendering test infrastructure (see
 * ai-menu-translate-targets.test.ts's own note) — this reads the component's raw source, matching
 * that established convention, and asserts the invariant that actually matters: the export
 * dialog's copy must never claim server-side/cloud/remote rendering again, regardless of the
 * exact wording chosen.
 *
 * Run with: node --test src/components/editor/__tests__/export-dialog-copy.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_DIALOG_FILE = path.join(__dirname, "..", "export-dialog.tsx");

test("export dialog copy never claims server-side/cloud/remote rendering", () => {
  const text = readFileSync(EXPORT_DIALOG_FILE, "utf-8");
  const claimsRemoteRendering = [/server-side/i, /\bcloud\b/i, /\bremote(ly)?\b/i, /uploaded to (our|a) server/i];
  for (const pattern of claimsRemoteRendering) {
    assert.ok(
      !pattern.test(text),
      `export-dialog.tsx matched ${pattern} — export runs entirely locally via SUBLY's bundled FFmpeg, never on a server`,
    );
  }
});

test("export dialog copy correctly attributes rendering to SUBLY's own bundled FFmpeg", () => {
  const text = readFileSync(EXPORT_DIALOG_FILE, "utf-8");
  assert.match(text, /bundled FFmpeg/i, "export-dialog.tsx should credit SUBLY's own bundled FFmpeg, not an unspecified/external renderer");
});
