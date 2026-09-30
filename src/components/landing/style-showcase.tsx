"use client";

import { motion } from "framer-motion";
import { BUILT_IN_PRESETS } from "@/lib/presets";
import { slugFont } from "@/lib/fonts";

const SHOWCASE = BUILT_IN_PRESETS.filter((p) =>
  ["tiktok", "mrbeast", "news", "elegant", "karaoke", "gaming"].includes(p.id),
);

export function StyleShowcase() {
  return (
    <section id="styles" className="mx-auto max-w-7xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">A style for every platform</h2>
        <p className="mt-4 text-muted">Start from a preset built for TikTok, Reels, YouTube or podcasts — or design your own from scratch.</p>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {SHOWCASE.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className="flex aspect-4/5 flex-col justify-end overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-2 to-surface-3 p-5"
          >
            <p
              className="mb-3 leading-tight"
              style={{
                fontFamily: `var(--font-${slugFont(p.style.fontFamily)})`,
                fontWeight: p.style.fontWeight,
                fontSize: "clamp(1.1rem, 2.4vw, 1.6rem)",
                color: p.style.color,
                textTransform: p.style.textCase === "uppercase" ? "uppercase" : "none",
                textShadow: `0 2px 12px rgba(0,0,0,0.6)`,
                WebkitTextStroke: p.style.outlineEnabled ? `2px ${p.style.outlineColor}` : undefined,
              }}
            >
              <span style={{ color: p.style.highlightColor }}>{p.name.split(" ")[0]}</span>{" "}
              {p.name.split(" ").slice(1).join(" ") || "style"}
            </p>
            <p className="text-xs text-muted-2">{p.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
