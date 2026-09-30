"use client";

import { useSearchParams } from "next/navigation";

/**
 * Task 111026 (P18.4) Phase 4 — a development-only, controlled way to deliberately throw a
 * render error, so the ErrorBoundary can be QA'd against a real React exception instead of only
 * unit-tested. `process.env.NODE_ENV === "production"` is a compile-time constant Next.js
 * dead-code-eliminates: in a production build this whole component's body — including the
 * `useSearchParams`/`throw` below — is stripped from the bundle, not merely gated behind a
 * runtime check, so no query string can ever trigger it once built for production. Nothing is
 * rendered, and no query param is even read, unless already in a dev build.
 */
export function DevCrashTest() {
  if (process.env.NODE_ENV === "production") return null;
  return <DevCrashTestTrigger />;
}

function DevCrashTestTrigger() {
  const params = useSearchParams();
  if (params.get("__crashTest") === "1") {
    throw new Error("P18.4 controlled failure test — deliberate, development-only render error.");
  }
  return null;
}
