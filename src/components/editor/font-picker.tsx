"use client";

import { useMemo, useState } from "react";
import { Search, Check, ChevronDown, AlertTriangle } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { FONT_REGISTRY, FONT_NAMES, slugFont, type FontCategory } from "@/lib/fonts";
import { useSystemFonts } from "@/hooks/use-system-fonts";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER: FontCategory[] = ["Sans", "Impact", "Editorial", "Rounded", "Devanagari", "Gujarati"];

/** Same var()-with-inline-fallback pattern as resolveFontFamilyCss (see lib/subtitles/preview-style.ts)
 * — without the fallback INSIDE the var() call, an undefined --font-x variable (any system font
 * has no such variable) makes the whole property invalid rather than falling through to `name`. */
function previewFontFamilyCss(name: string): string {
  return `var(--font-${slugFont(name)}, ${name}), ${name}, sans-serif`;
}

/** Searchable, categorized font combobox (section 7 of the desktop UX pass; system fonts added in
 * the follow-up pass). Each font name renders in its own typeface so choosing one is a visual
 * decision, not a guess from plain text. Bundled (Google, self-hosted) fonts and Windows system
 * fonts are clearly separated — same family name can exist in both, and only the one actually
 * picked determines how export sources the font file (see lib/fonts/system-font-export.ts). */
export function FontPicker({
  value,
  fontSource,
  onChange,
}: {
  value: string;
  fontSource?: "bundled" | "system";
  onChange: (font: string, source: "bundled" | "system") => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { families: systemFamilies } = useSystemFonts();

  const isBundled = FONT_NAMES.includes(value) && fontSource !== "system";
  const isSystemInstalled = systemFamilies.some((f) => f.name === value);
  const isMissing = !isBundled && !isSystemInstalled;

  const groupedBundled = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? FONT_REGISTRY.filter((f) => f.name.toLowerCase().includes(q)) : FONT_REGISTRY;
    const byCategory = new Map<FontCategory, typeof FONT_REGISTRY>();
    for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
    for (const font of matches) byCategory.get(font.category)?.push(font);
    return CATEGORY_ORDER.map((cat) => ({ category: cat, fonts: byCategory.get(cat) ?? [] })).filter((g) => g.fonts.length > 0);
  }, [query]);

  const matchingSystemFonts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? systemFamilies.filter((f) => f.name.toLowerCase().includes(q)) : systemFamilies;
  }, [query, systemFamilies]);

  const noMatches = groupedBundled.length === 0 && matchingSystemFonts.length === 0;

  function choose(name: string, source: "bundled" | "system") {
    onChange(name, source);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), !o && setQuery(""))}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface-2 px-3 text-sm hover:bg-surface-3"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {isMissing && <AlertTriangle className="size-3.5 shrink-0 text-warning" />}
            <span style={isMissing ? undefined : { fontFamily: previewFontFamilyCss(value) }} className="truncate">
              {value}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center gap-2 border-b border-border p-2">
          <Search className="size-3.5 shrink-0 text-muted-2" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fonts..."
            className="h-7 border-none bg-transparent px-0 text-sm focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {isMissing && (
            <div className="mb-1.5 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
              <AlertTriangle className="size-3.5 shrink-0 translate-y-0.5" />
              <span>
                &quot;{value}&quot; isn&apos;t installed on this computer. Pick a replacement below, or reinstall it and reopen the project.
              </span>
            </div>
          )}
          {noMatches && <p className="p-3 text-center text-xs text-muted-2">No fonts match &quot;{query}&quot;.</p>}

          {groupedBundled.length > 0 && (
            <div className="mb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">SUBLY Fonts</p>
              {groupedBundled.map(({ category, fonts }) => (
                <div key={category} className="mb-1">
                  <p className="px-2 py-1 text-[10px] font-medium text-muted-2/80">{category}</p>
                  {fonts.map((f) => (
                    <button
                      key={f.name}
                      onClick={() => choose(f.name, "bundled")}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3",
                        f.name === value && isBundled && "bg-accent-soft text-accent",
                      )}
                    >
                      <span style={{ fontFamily: previewFontFamilyCss(f.name) }} className="truncate">
                        {f.name}
                      </span>
                      {f.name === value && isBundled && <Check className="size-3.5 shrink-0" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {matchingSystemFonts.length > 0 && (
            <div className="mb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">System Fonts</p>
              {matchingSystemFonts.map((f) => (
                <button
                  key={f.name}
                  onClick={() => choose(f.name, "system")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3",
                    f.name === value && isSystemInstalled && "bg-accent-soft text-accent",
                  )}
                >
                  <span style={{ fontFamily: previewFontFamilyCss(f.name) }} className="truncate">
                    {f.name}
                  </span>
                  {f.name === value && isSystemInstalled && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
