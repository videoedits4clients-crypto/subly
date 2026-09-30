"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const FAQS = [
  // Task 161847 (P19.21): first-run/offline explanation added per this task's own Step 6.
  {
    q: "Why does SUBLY need internet the first time?",
    a: "A new installation needs a one-time network connection to download the local transcription model. Once the model is available, local transcription can run offline.",
  },
  { q: "How accurate is the automatic transcription?", a: "SUBLY uses Whisper-compatible speech recognition with word-level timestamps. Accuracy is very high for clear speech in supported languages, and every word is fully editable afterward." },
  { q: "Can I edit the subtitles after they're generated?", a: "Yes — click any subtitle to edit its text, drag its boundaries on the timeline, split or merge segments, and adjust word-level timing." },
  { q: "What video formats are supported?", a: "MP4, MOV, WebM, AVI and MKV on upload. Exports are H.264 MP4 at 720p, 1080p or 4K." },
  { q: "Do captions stay in sync if I change the styling?", a: "Yes — styling never touches timing. Word timestamps are stored independently from font, color and animation settings." },
  // Task 161847 (P19.21): added the word-level-timing caveat — translation preserves CAPTION
  // timing but regenerates WORD-level timing as evenly-spaced values, a nuance the old answer
  // didn't disclose (flagged in research/p19_11_release_candidate_gap_audit.md §13).
  {
    q: "Can I translate my captions?",
    a: "Yes — translation is a cloud-dependent feature that preserves the original caption-level segmentation and timing, not a single translated block. Word-level (karaoke) timing for the translated text is regenerated as evenly-spaced values rather than the original speech rhythm.",
  },
  { q: "How does export work?", a: "Captions are burned directly into the video using SUBLY's bundled FFmpeg, so the final MP4 has real styled subtitles — not just a preview screenshot." },
];

export function FAQ() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Frequently asked questions</h2>

      <div className="mt-12 divide-y divide-border rounded-2xl border border-border bg-surface">
        {FAQS.map((item, i) => (
          <div key={item.q}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
            >
              <span className="text-sm font-medium">{item.q}</span>
              <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open === i && "rotate-180")} />
            </button>
            <div className={cn("grid transition-all", open === i ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden px-6 text-sm text-muted">{item.a}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
