import type { NextConfig } from "next";
import { readFileSync } from "fs";
import path from "path";

// Release-identity gap confirmed by grepping the whole app: nothing anywhere exposes the
// installed app's version to the user (no About screen, no footer, nothing) — a genuine
// release-readiness issue for a desktop app with no auto-updater, since a user or support
// contact has no way to say which build they're running. Baked in at build time (the same
// version electron-builder itself reads from this same package.json for the installer/exe
// metadata) so it needs no Electron-specific IPC plumbing and works identically in web mode.
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf-8"));

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // These ship native binaries (ffmpeg.exe / ffprobe.exe) and must be required
  // at runtime from node_modules rather than traced/bundled by the compiler.
  serverExternalPackages: ["fluent-ffmpeg", "ffmpeg-static", "@ffprobe-installer/ffprobe"],
  // Produces .next/standalone — a self-contained server (only the node_modules
  // it actually needs) that the Electron desktop shell runs directly via
  // Electron's own bundled Node, so a packaged build never depends on a
  // separately-installed Node.js or a manually-started dev server.
  output: "standalone",
  // @ffprobe-installer/ffprobe resolves its platform binary via a fully
  // dynamic `require.resolve(computedPackageName + '/' + binary)` string (see
  // node_modules/@ffprobe-installer/ffprobe/index.js) — Next's file tracer
  // can't follow that statically, so without this the standalone build
  // silently ships without ffprobe.exe and every upload fails to probe.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@ffprobe-installer/win32-x64/**"],
  },
  // Confirmed by actually inspecting .next/standalone's contents: Next's file
  // tracer (used for `output: "standalone"`) sweeps sibling top-level
  // directories into the bundle when it can't fully statically resolve a
  // dynamic path (electron/main.js and the whisper sidecar both build paths
  // from process.cwd() at runtime) — so a stale desktop-packaging output
  // folder sitting in the repo root got copied INTO itself on the next build,
  // ballooning it from ~250MB to several GB. Explicitly excluding electron
  // packaging output (belt-and-suspenders alongside `npm run clean`, which
  // deletes these folders outright before every package build) closes this
  // regardless of whether they happen to exist at build time.
  outputFileTracingExcludes: {
    "/**": ["**/release*/**"],
  },
};

export default nextConfig;
