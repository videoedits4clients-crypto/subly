"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/error-boundary";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Task 111026 (P18.4) — the app-wide, last-resort boundary: catches a render crash
          anywhere NOT already inside the editor's own boundary (dashboard, auth, upload flow).
          Toaster stays a sibling, outside it, so toasts keep working even while this fallback is
          showing. */}
      <ErrorBoundary scope="app">{children}</ErrorBoundary>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          },
        }}
      />
    </SessionProvider>
  );
}
