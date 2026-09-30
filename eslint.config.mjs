import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron packaging output — contains copied third-party node_modules,
    // not source this project owns.
    "release*/**",
    "python/build/**",
    "python/dist/**",
    // Task 182741 (P19.26)/194632 (P19.27): the independent static site under website/ is a
    // separate project with its own eslint-free build (see website/package.json — no lint
    // script). Ignoring the whole directory, not just its build output: website/src/shared is a
    // symlink into ../src (see website/next.config.ts) so the reused components resolve their
    // own node_modules correctly, but that means the same source files are reachable a second
    // time under website/ — without this ignore, `npx eslint .` from the repo root would lint
    // every file in src/ twice, once directly and once through the symlink.
    "website/**",
  ]),
  {
    // The Electron main/preload process and desktop build scripts are plain
    // Node CommonJS (no bundler, run directly via `node`/electron.exe) — the
    // app-wide `no-require-imports` rule is meant for the Next-bundled src/
    // code, not these.
    files: ["electron/**/*.js", "scripts/**/*.js", "python/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Test fixture spawned directly via `node fixtures/fake-worker.js` (see
    // src/lib/transcription/__tests__/cancellation.test.ts) — plain Node CommonJS, not
    // bundled by Next, same rationale as the Electron/scripts override above.
    files: ["src/**/__tests__/fixtures/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
