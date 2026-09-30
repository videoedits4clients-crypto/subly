"use client";

import { motion } from "framer-motion";
import { Languages, MousePointerClick, Palette, AudioWaveform, FileDown, ShieldCheck } from "lucide-react";

/**
 * Task 161847 (P19.21) — restructured into the six categories this task's own positioning
 * calls for (local transcription, professional editing, caption styling, timeline, export,
 * reliability), replacing the prior flatter feature-card list. "Local Transcription" hardcodes
 * "English and Hindi ... Auto Detect" rather than deriving it from
 * lib/language-policy.ts's supportedLanguageSummary() (as the old "Multi-language" card did) —
 * safe against language-claims.test.ts, which only fails on a DEFERRED language's name
 * appearing as copy, not on supported ones being spelled out directly; English and Hindi are
 * both `status: "supported"` in LANGUAGE_POLICY. "Word-level styling where supported" in Caption
 * Styling deliberately doesn't list font/animation as per-word properties — see
 * word-style-capabilities.ts (color/fontSize/fontWeight/letterSpacing are "supported"; font
 * family and animation are not per-word properties at all).
 */
const FEATURES = [
  {
    icon: Languages,
    title: "Local Transcription",
    desc: "English and Hindi transcription with Auto Detect and word-level timestamps, plus deterministic Hinglish (Romanized Hindi) conversion.",
  },
  {
    icon: MousePointerClick,
    title: "Professional Editing",
    desc: "Edit captions, timing, words, splits, merges, and timeline placement — with full undo/redo on every change.",
  },
  {
    icon: Palette,
    title: "Caption Styling",
    desc: "Presets, full caption styling, and word-level color, size, weight, and letter-spacing overrides where supported.",
  },
  {
    icon: AudioWaveform,
    title: "Timeline",
    desc: "Waveform-based timeline editing, playback, timing adjustment, and review tools.",
  },
  {
    icon: FileDown,
    title: "Export",
    desc: "MP4 with burned-in captions up to 4K, plus SRT, VTT, and TXT.",
  },
  {
    icon: ShieldCheck,
    title: "Reliability",
    desc: "Project persistence, autosave, and crash recovery.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-border/60 bg-surface/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything a caption editor should be</h2>
          <p className="mt-4 text-muted">Built for creators who need speed without giving up control.</p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.4, delay: (i % 3) * 0.06 }}
              className="group bg-surface p-6 transition-colors hover:bg-surface-2"
            >
              <f.icon className="size-5 text-accent" />
              <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Task 161847 (P19.21): local-vs-cloud explanation — deliberately NOT "everything stays
            on your computer" or "no internet required" (both false: the AI text tools/Translate
            below are cloud-dependent, and see the FAQ for the one-time model-download exception). */}
        <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-border bg-surface px-6 py-5 text-center text-sm text-muted">
          <p>Your transcription runs locally on your Windows PC after the model is downloaded.</p>
          <p className="mt-1.5">AI text tools and translation are separate, cloud-dependent features.</p>
        </div>
      </div>
    </section>
  );
}
