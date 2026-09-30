import type { NextConfig } from "next";
import path from "path";

// Task 182741 (P19.26): independent static marketing site — imports components from
// ../src/components/landing/* (see tsconfig.json's "@/*" path) but is otherwise fully separate
// from the main SUBLY application: no API routes, no auth, no Prisma, so `output: "export"`
// (which the main app cannot use — see research/p19_23 and P19.24 audits) works cleanly here.
//
// GitHub Pages will serve this at https://videoedits4clients-crypto.github.io/subly/, so the
// site needs to know it isn't at the domain root. `basePath` is the mechanism Next.js's own docs
// recommend for sub-path hosting (node_modules/next/dist/docs/.../assetPrefix.md explicitly says
// not to use a custom assetPrefix for this — basePath alone already prefixes /_next/static
// assets, next/font output, and next/link hrefs).
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/subly",
  // Silences Next's workspace-root auto-detection warning (there are two lockfiles: this
  // directory's own, and the parent repo's one level up). Root must be the PARENT directory, not
  // this one — Turbopack treats `root` as a hard file-access boundary, and this app imports
  // ../src/components/landing/* from outside its own directory.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
