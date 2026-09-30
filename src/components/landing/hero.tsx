"use client";

import { motion } from "framer-motion";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroPreview } from "./hero-preview";
import { SUBLY_DOWNLOAD_URL, SUBLY_RELEASE_NOTES_URL } from "@/lib/release-info";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />
      <div className="absolute -top-40 left-1/2 -z-10 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]" />

      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-6 pb-24 pt-20 lg:grid-cols-2 lg:pt-28">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-muted"
          >
            <span className="size-1.5 rounded-full bg-accent-cyan" />
            Windows desktop app
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl"
          >
            Professional subtitle editing
            <br />
            <span className="text-gradient">for Windows.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 max-w-md text-lg text-muted"
          >
            Transcribe, edit, style, review, and export subtitles with a local-first desktop
            workflow. Local transcription works offline after the one-time model download.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Button size="lg" variant="accent" asChild>
              <a href={SUBLY_DOWNLOAD_URL}>
                <Download className="size-4" /> Download SUBLY for Windows
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={SUBLY_RELEASE_NOTES_URL}>
                <FileText className="size-4" /> View release notes
              </a>
            </Button>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-6 text-xs text-muted-2"
          >
            SUBLY 0.1.20 · Windows · ~566 MB · Free during preview · Works with MP4, MOV, WebM, AVI, MKV
          </motion.p>
        </div>

        <HeroPreview />
      </div>
    </section>
  );
}
