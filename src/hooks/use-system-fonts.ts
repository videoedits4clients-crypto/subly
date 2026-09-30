import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

export interface SystemFontFamily {
  name: string;
  faces: { weight: number; italic: boolean }[];
}

// Module-level cache so every consumer (FontPicker, StylePanel) shares one
// fetch instead of each re-requesting the same list — fonts don't change
// mid-session, and the server itself already caches the filesystem scan
// (see lib/fonts/system-fonts.ts), but there's no reason to repeat even the
// HTTP round-trip more than once per editor session.
let cached: SystemFontFamily[] | null = null;
let inflight: Promise<SystemFontFamily[]> | null = null;

function loadSystemFonts(): Promise<SystemFontFamily[]> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .getSystemFonts()
      .then((r) => {
        cached = r.families;
        return cached;
      })
      .catch(() => {
        cached = [];
        return cached;
      });
  }
  return inflight;
}

/** Windows fonts installed on this machine — empty array (not loading forever) on the web build or on any non-Windows host. */
export function useSystemFonts(): { families: SystemFontFamily[]; loading: boolean } {
  const [families, setFamilies] = useState<SystemFontFamily[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    loadSystemFonts().then((f) => {
      if (!cancelled) {
        setFamilies(f);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { families, loading };
}
