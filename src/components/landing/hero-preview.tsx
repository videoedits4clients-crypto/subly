"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Play, Volume2, Maximize2 } from "lucide-react";

const WORDS = ["THIS", "IS", "HOW", "YOUR", "CAPTIONS", "COULD", "LOOK"];
const HIGHLIGHT = "#FACC15";

export function HeroPreview() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive((i) => (i + 1) % WORDS.length), 420);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
      className="relative mx-auto w-full max-w-sm"
    >
      <div className="absolute -inset-10 -z-10 rounded-[3rem] bg-gradient-to-br from-accent/30 via-accent-cyan/10 to-transparent blur-3xl" />

      <div className="relative rounded-[2rem] border border-border-strong bg-surface p-2 shadow-2xl glow-accent">
        <div className="relative aspect-9/16 overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-[#1b1030] via-[#0e1730] to-[#031014]">
          {/* fake footage */}
          <div className="absolute inset-0 bg-grid opacity-40" />
          <motion.div
            className="absolute inset-0"
            animate={{ background: ["radial-gradient(circle at 30% 30%, rgba(124,58,237,0.35), transparent 60%)", "radial-gradient(circle at 70% 60%, rgba(34,211,238,0.3), transparent 60%)"] }}
            transition={{ duration: 6, repeat: Infinity, repeatType: "mirror" }}
          />

          {/* top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 text-[10px] text-white/70">
            <span className="rounded bg-black/40 px-1.5 py-0.5">0:07 / 0:24</span>
            <span className="rounded bg-black/40 px-1.5 py-0.5">9:16</span>
          </div>

          {/* caption */}
          <div className="absolute inset-x-0 bottom-16 flex justify-center px-6">
            <p className="text-center text-2xl font-extrabold uppercase leading-tight tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
              {WORDS.map((w, i) => (
                <span key={w} className="mx-1 inline-block" style={{ color: i === active ? HIGHLIGHT : "white", transform: i === active ? "scale(1.15)" : "scale(1)", transition: "all 150ms ease" }}>
                  {w}
                </span>
              ))}
            </p>
          </div>

          {/* controls */}
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
            <Play className="size-4 text-white" fill="white" />
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
              <motion.div
                className="h-full rounded-full bg-white"
                animate={{ width: ["30%", "72%"] }}
                transition={{ duration: 3, repeat: Infinity, repeatType: "mirror" }}
              />
            </div>
            <Volume2 className="size-4 text-white" />
            <Maximize2 className="size-4 text-white" />
          </div>
        </div>
      </div>

      {/* floating style chip */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.9, duration: 0.6 }}
        className="absolute -right-6 top-16 hidden rounded-xl border border-border bg-surface-2/95 p-3 text-xs shadow-xl backdrop-blur sm:block"
      >
        <p className="font-medium text-foreground">Style: Bold</p>
        <p className="mt-1 text-muted-2">Anton · 84px · Yellow highlight</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.1, duration: 0.6 }}
        className="absolute -left-8 bottom-24 hidden rounded-xl border border-border bg-surface-2/95 p-3 text-xs shadow-xl backdrop-blur sm:block"
      >
        <p className="font-medium text-foreground">Word timing</p>
        <p className="mt-1 text-muted-2">0.24s → 0.61s</p>
      </motion.div>
    </motion.div>
  );
}
