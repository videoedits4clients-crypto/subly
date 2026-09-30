import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-border/60 py-28">
      <div className="absolute left-1/2 top-1/2 -z-10 h-[400px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[130px]" />
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Your next video deserves <span className="text-gradient">better captions.</span>
        </h2>
        <p className="mt-5 text-lg text-muted">Upload a video and see your first styled subtitles in under a minute.</p>
        <Button size="lg" variant="accent" className="mt-8" asChild>
          <Link href="/register">
            Create subtitles <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
