import type { NextConfig } from "next";
import path from "path";
import fs from "fs";

// Task 194632 (P19.27): reuses components from ../src/components/landing/* (the main SUBLY
// app's own source, not a copy) via a `src/shared` symlink into that directory rather than a
// widened Turbopack root. The earlier approach (turbopack.root pointed at the parent repo, so
// Turbopack could read ../src/* directly) had a fatal side effect discovered when actually
// testing a clean CI checkout: with the effective project root widened to the parent, Next's
// own middleware/proxy convention-file discovery found the MAIN APP's ../src/proxy.ts (which
// imports next-auth/bcryptjs/Prisma) and tried to bundle it as if it were this site's own
// middleware — something that only "worked" locally by accident, because the parent repo's own
// node_modules (already installed for the main app) happened to satisfy those imports. In a
// real clean checkout (exactly what CI does), the build failed outright.
//
// The symlink keeps every file this build touches physically "inside" website/ from the
// bundler's perspective — Turbopack's root can stay narrow (this directory only), so it never
// scans ../src/proxy.ts or ../src/auth.ts as a convention file, and it also means files reached
// through the symlink resolve bare-package imports (lucide-react, framer-motion, etc.) against
// THIS project's own node_modules, not the parent's — so `npm ci` inside website/ alone is
// enough, exactly as the deployment workflow does. See tsconfig.json's "@/*" path, which points
// at "./src/shared/*" (through the symlink) instead of "../src/*".
const sharedLinkPath = path.join(__dirname, "src", "shared");
const sharedLinkTarget = path.join(__dirname, "..", "src");
if (!fs.existsSync(sharedLinkPath)) {
  fs.symlinkSync(sharedLinkTarget, sharedLinkPath, process.platform === "win32" ? "junction" : "dir");
}

// GitHub Pages will serve this at https://videoedits4clients-crypto.github.io/subly/, so the
// site needs to know it isn't at the domain root. `basePath` is the mechanism Next.js's own docs
// recommend for sub-path hosting (node_modules/next/dist/docs/.../assetPrefix.md explicitly says
// not to use a custom assetPrefix for this — basePath alone already prefixes /_next/static
// assets, next/font output, and next/link hrefs).
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/subly",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
