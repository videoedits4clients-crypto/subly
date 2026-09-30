import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUBLY_DOWNLOAD_URL } from "@/lib/release-info";

/**
 * Task 137421 (P19.12, fixing the P0 finding in research/p19_11_release_candidate_gap_audit.md
 * §5) — this used to be a fake 3-tier pricing table (fictional project/duration limits, a
 * watermark, team seats, priority rendering — none of which exist anywhere in the product) plus
 * a literal developer-facing placeholder sentence ("wire up your billing provider of choice")
 * that was shipping to real visitors. There is no billing system in this product today, and this
 * task explicitly does not build one — so rather than inventing a new set of "believable" fake
 * tiers, this section now describes only what actually exists: every feature, free, during this
 * preview. `id="pricing"` and the section's general shape are kept so the navbar/footer "Pricing"
 * anchor links still land somewhere coherent.
 */
const INCLUDED = [
  // Task 161847 (P19.21): "AI transcription" reworded to "Local transcription" — accurate
  // either way (Whisper genuinely is AI-based), but this specific phrasing sat right next to
  // this same page's separate, cloud-dependent AI text tools with no distinguishing qualifier,
  // a wording ambiguity flagged in research/p19_20_distribution_channel_report.md §2.
  "Local transcription with word-level timestamps",
  "Full caption styling — fonts, colors, animation, word highlighting",
  "Timeline editing — trim, split, merge, reorder, ripple delete",
  "MP4, SRT, VTT and TXT export, up to 4K",
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-border/60 bg-surface/40 py-24">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Free during preview</h2>
        <p className="mt-4 text-muted">
          SUBLY is free to use while it&apos;s in preview — no plan tiers, no locked features.
        </p>

        <div className="mt-10 rounded-2xl border border-border bg-surface p-8 text-left">
          <ul className="space-y-3">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" /> {f}
              </li>
            ))}
          </ul>
          <Button variant="accent" className="mt-8 w-full" asChild>
            <a href={SUBLY_DOWNLOAD_URL}>
              <Download className="size-4" /> Download for Windows
            </a>
          </Button>
        </div>

        <p className="mt-6 text-sm text-muted-2">
          Paid plans aren&apos;t available yet — everything above is included at no cost today.
        </p>
      </div>
    </section>
  );
}
