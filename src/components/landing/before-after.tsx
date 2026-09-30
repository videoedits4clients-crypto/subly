"use client";

import { motion } from "framer-motion";

export function BeforeAfter() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">See the difference styling makes</h2>
        <p className="mt-4 text-muted">Plain auto-generated captions vs. a SUBLY preset — same transcript, completely different feel.</p>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="overflow-hidden rounded-2xl border border-border bg-surface"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="text-xs font-medium text-muted-2">BEFORE</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted-2">default export</span>
          </div>
          <div className="flex aspect-video items-center justify-center bg-black/40 p-8">
            <p className="text-center font-mono text-sm text-white/70">
              welcome to our channel today were going to show you something amazing
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="overflow-hidden rounded-2xl border border-accent/40 bg-surface glow-accent"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="text-xs font-medium text-accent">AFTER — SUBLY</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">Bold preset</span>
          </div>
          <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1b1030] to-[#031014] p-8">
            <p className="text-center text-2xl font-black uppercase tracking-tight text-white">
              Welcome to <span className="text-[#FACC15]">our channel</span>
            </p>
            <p className="text-center text-2xl font-black uppercase tracking-tight text-white/90">
              today we&apos;re going to show you
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
