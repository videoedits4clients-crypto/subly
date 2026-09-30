const PLATFORMS = [
  { label: "Instagram Reels", ratio: "9:16" },
  { label: "YouTube Shorts", ratio: "9:16" },
  { label: "TikTok", ratio: "9:16" },
  { label: "YouTube", ratio: "16:9" },
  { label: "LinkedIn", ratio: "16:9 / 1:1" },
  { label: "Square posts", ratio: "1:1" },
];

export function Formats() {
  return (
    <section className="border-y border-border/60 bg-surface/40 py-16">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-2">Optimized for every platform</p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {PLATFORMS.map((p) => (
            <div key={p.label} className="rounded-xl border border-border bg-surface px-4 py-5 text-center">
              <p className="text-sm font-semibold">{p.label}</p>
              <p className="mt-1 text-xs text-muted-2">{p.ratio}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
