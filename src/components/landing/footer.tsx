import Link from "next/link";
import { Sparkles } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/60 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-cyan">
            <Sparkles className="size-3.5 text-white" />
          </span>
          SUBLY
        </Link>
        <p className="text-xs text-muted-2">© {new Date().getFullYear()} SUBLY. Professional subtitle editing for Windows.</p>
        <div className="flex gap-6 text-xs text-muted-2">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#pricing" className="hover:text-foreground">Pricing</a>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
          <a href="/download" className="hover:text-foreground">Download</a>
        </div>
      </div>
    </footer>
  );
}
