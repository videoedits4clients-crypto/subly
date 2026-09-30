"use client";

import { motion } from "framer-motion";
import { Upload, Wand2, Palette, Download } from "lucide-react";

const STEPS = [
  { icon: Upload, title: "Upload your video", desc: "Drag in any MP4, MOV, WebM, AVI or MKV file — landscape, square, or vertical." },
  { icon: Wand2, title: "AI transcribes instantly", desc: "Word-level timestamps are generated automatically, ready to caption." },
  // Task 146220 (P19.17): fixes the P19.16-flagged overclaim — "fonts, colors, animation" all
  // implied per-word support that doesn't exist (per-word font family and animation are both
  // unsupported today; see word-style-capabilities.ts). Presets/fonts/animation are chosen for
  // the whole caption; color, size and automatic highlighting are what's genuinely word-level.
  { icon: Palette, title: "Style every word", desc: "Pick a preset for the whole caption, then fine-tune individual words — color, size and automatic highlighting." },
  { icon: Download, title: "Export & download", desc: "Burn styled captions directly into your video, ready for Reels, Shorts or YouTube." },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">From upload to export in four steps</h2>
        <p className="mt-4 text-muted">No timeline scrubbing. No manual syncing. SUBLY handles the tedious part so you can focus on the message.</p>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="relative rounded-2xl border border-border bg-surface p-6"
          >
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent/20 to-accent-cyan/10 text-accent">
              <step.icon className="size-5" />
            </div>
            <span className="absolute right-6 top-6 text-3xl font-bold text-white/5">{i + 1}</span>
            <h3 className="font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm text-muted">{step.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
