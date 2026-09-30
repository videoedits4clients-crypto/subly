"use client";

import { motion } from "framer-motion";
import { Type, Sparkles, Languages, Zap, MousePointerClick, History, Palette, Wand } from "lucide-react";
import { supportedLanguageSummary } from "@/lib/language-policy";

// The multi-language feature description is GENERATED from lib/language-policy.ts's
// supported-language list, not hand-typed — see that file's doc comment. This is the fix for
// a real incident: this copy used to hard-code "10 languages, including Hindi, Gujarati,
// Arabic and Japanese," none of which (beyond Hindi) were ever actually validated for
// transcription, directly contradicting the V1 language-policy freeze. Deriving it from the
// policy makes that specific class of drift structurally impossible going forward.
const FEATURES = [
  { icon: Type, title: "Word-level timing", desc: "Every word carries its own start/end timestamp — the foundation for karaoke-style animated captions." },
  { icon: Palette, title: "Full style control", desc: "Font, size, weight, color, background, outline, shadow, position — all live-updating in preview." },
  // Task 146220 (P19.17): "typewriter" renamed to "word fade" (matches the in-app label fix in
  // animation-panel.tsx — it's a quick fade, not a true character-by-character reveal), and
  // "per-word animations" replaced with an accurate description — animation presets apply per
  // caption, not per individual word (see word-style-capabilities.ts, which has no "animation"
  // entry at all); the real per-word effect is the automatic word-by-word highlight.
  { icon: Sparkles, title: "Animation presets", desc: "Fade, pop, bounce, slide, word fade — entrance and exit animations, with automatic word-by-word highlighting." },
  { icon: Wand, title: "AI text tools", desc: "Fix punctuation, remove filler words, rephrase, shorten — one click." },
  {
    icon: Languages,
    title: "Multi-language",
    desc: `Transcribe in ${supportedLanguageSummary()}, with deterministic Hinglish (Romanized Hindi) conversion built in.`,
  },
  { icon: MousePointerClick, title: "Precise timeline editing", desc: "Drag, split, merge, resize and reorder subtitle blocks like a pro NLE." },
  { icon: History, title: "Full undo/redo", desc: "Every edit — text, timing, style, animation — is tracked and reversible." },
  { icon: Zap, title: "Fast exports", desc: "Server-side FFmpeg rendering burns your captions in at up to 4K, without touching your browser's CPU." },
];

export function Features() {
  return (
    <section id="features" className="border-t border-border/60 bg-surface/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything a caption editor should be</h2>
          <p className="mt-4 text-muted">Built for creators who need speed without giving up control.</p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.4, delay: (i % 4) * 0.06 }}
              className="group bg-surface p-6 transition-colors hover:bg-surface-2"
            >
              <f.icon className="size-5 text-accent" />
              <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
