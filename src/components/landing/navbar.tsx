"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, Sparkles, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SUBLY_DOWNLOAD_URL } from "@/lib/release-info";

// Task 161847 (P19.21) — "Download" added, linking to the in-app /download page (full details:
// release notes, install guide, checksum) rather than jumping straight to the binary — the
// primary top-right button below is the direct one-click download instead.
const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#styles", label: "Styles" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
  { href: "/download", label: "Download" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-cyan">
            <Sparkles className="size-4 text-white" />
          </span>
          SUBLY
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) =>
            // Task 194632 (P19.27): internal page navigation ("/download") must use next/link so
            // it picks up basePath under GitHub Pages (see website/next.config.ts) — plain <a>
            // tags don't. Same-page hash anchors stay as <a>, which is what they actually are.
            l.href.startsWith("/") ? (
              <Link
                key={l.href}
                href={l.href}
                prefetch={false}
                className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                {l.label}
              </Link>
            ) : (
              <a
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                {l.label}
              </a>
            ),
          )}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button variant="accent" size="sm" asChild>
            <a href={SUBLY_DOWNLOAD_URL}>
              <Download className="size-3.5" /> Download for Windows
            </a>
          </Button>
        </div>

        <button
          className="p-2 text-foreground md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <div className={cn("border-t border-border/60 md:hidden", open ? "block" : "hidden")}>
        <div className="flex flex-col gap-1 px-6 py-4">
          {LINKS.map((l) =>
            l.href.startsWith("/") ? (
              <Link key={l.href} href={l.href} prefetch={false} className="rounded-md px-2 py-2 text-sm text-muted" onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} className="rounded-md px-2 py-2 text-sm text-muted" onClick={() => setOpen(false)}>
                {l.label}
              </a>
            ),
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="accent" size="sm" className="flex-1" asChild>
              <a href={SUBLY_DOWNLOAD_URL}>
                <Download className="size-3.5" /> Download for Windows
              </a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
