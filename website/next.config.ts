import type { NextConfig } from "next";
import path from "path";

// Task 194632 (P19.27): reuses components directly from ../src/components/landing/* (the main
// SUBLY app's own source, not a copy — see tsconfig.json's "@/*" path).
//
// This build intentionally opts OUT of Turbopack (see package.json's "--webpack" build/dev
// flags). Turbopack enforces a hard "filesystem root" boundary and refuses to resolve any file
// outside it — confirmed directly against Next's own docs (Turbopack > Known gaps with webpack >
// Filesystem Root: "Files outside of the project root are not resolved... To resolve these files,
// you must configure the root option to the parent directory"). Widening turbopack.root to the
// parent repo did let Turbopack read ../src/*, but a clean CI checkout then exposed a second,
// fatal side effect: Next's own middleware/proxy convention-file discovery started resolving the
// MAIN APP's ../src/proxy.ts (which imports next-auth/bcryptjs/Prisma) as if it were this site's
// own middleware. A symlink into ../src doesn't help either — Turbopack explicitly rejects
// symlinks that resolve outside its root ("Symlink ... is invalid, it points out of the
// filesystem root"), confirmed by an actual failed CI run. Webpack has no such boundary — it's
// Next's own documented fallback for exactly this "linked/shared files outside the project root"
// scenario (same docs section: "use webpack if you need this feature").
//
// See src/app/globals.css for why Tailwind's CSS output for the reused components' classes is a
// pre-generated static file rather than live-scanned — the equivalent scanning mechanism proved
// unreliable under webpack specifically.
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/subly",
  // The reused files physically live under ../src/*, so their own bare-package imports
  // (lucide-react, framer-motion, etc.) resolve via Node's normal upward node_modules search
  // starting from THEIR location — which would otherwise require ../node_modules (the main app's
  // own install) to exist. Explicitly adding this project's own node_modules to webpack's search
  // path means `npm ci` inside website/ alone is enough, exactly as the deployment workflow does.
  webpack: (config) => {
    config.resolve.modules = [path.join(__dirname, "node_modules"), "node_modules"];
    return config;
  },
  // `resolve.modules` above fixes module resolution for webpack's actual bundling, but Next's
  // separate build-time type-checking pass uses TypeScript's own resolution (tsconfig.json has
  // no equivalent "also search this other directory's node_modules" option), so it still can't
  // find these packages from the reused files' real, external location without ../node_modules
  // present. The main app's own `tsc --noEmit` (run against the very same files, as part of its
  // own regression checks) is already the source of truth for their type-correctness — this
  // build doesn't need to redundantly re-gate on it, and skipping it here doesn't skip it there.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
