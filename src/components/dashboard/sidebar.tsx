"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Home, FolderKanban, LayoutTemplate, Palette, Settings, Sparkles, LogOut, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/dashboard/brand-kit", label: "Brand Kit", icon: Palette },
  { href: "/dashboard/trash", label: "Trash", icon: Trash2 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

declare global {
  interface Window {
    subly?: { isDesktop: boolean };
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isDesktop = typeof window !== "undefined" && window.subly?.isDesktop === true;

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center gap-2 px-5 font-semibold">
        <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-cyan">
          <Sparkles className="size-4 text-white" />
        </span>
        SUBLY
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map((item) => {
          const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm">
          <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-xs font-semibold text-white">
            {isDesktop ? "S" : (session?.user?.name?.[0]?.toUpperCase() ?? session?.user?.email?.[0]?.toUpperCase() ?? "U")}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">
              {isDesktop
                ? `SUBLY Desktop${process.env.NEXT_PUBLIC_APP_VERSION ? ` v${process.env.NEXT_PUBLIC_APP_VERSION}` : ""}`
                : (session?.user?.name ?? "Account")}
            </p>
            <p className="truncate text-[11px] text-muted-2">{isDesktop ? "Local — no account needed" : session?.user?.email}</p>
          </div>
          {!isDesktop && (
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-foreground"
              aria-label="Log out"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
