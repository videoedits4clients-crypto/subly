"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/ui/color-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FONT_NAMES, slugFont } from "@/lib/fonts";
import { toast } from "sonner";

interface BrandKit {
  id?: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
}

const DEFAULT_KIT: BrandKit = {
  name: "My Brand",
  primaryColor: "#7C3AED",
  secondaryColor: "#22D3EE",
  accentColor: "#F472B6",
  fontFamily: "Inter",
};

export default function BrandKitPage() {
  const [kit, setKit] = useState<BrandKit>(DEFAULT_KIT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/brand-kit")
      .then((r) => r.json())
      .then((data) => data && setKit(data))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/brand-kit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kit) });
      toast.success("Brand kit saved.");
    } catch {
      toast.error("Couldn't save your brand kit.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Brand Kit</h1>
      <p className="mt-1 text-sm text-muted">
        Save your brand colors and font once, then apply them to any project&apos;s caption style from the editor&apos;s Style panel.
      </p>

      <div className="mt-8 space-y-6 rounded-2xl border border-border bg-surface p-6">
        <div className="space-y-1.5">
          <Label>Brand name</Label>
          <Input value={kit.name} onChange={(e) => setKit({ ...kit, name: e.target.value })} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Primary color</Label>
            <ColorPicker value={kit.primaryColor} onChange={(v) => setKit({ ...kit, primaryColor: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>Secondary color</Label>
            <ColorPicker value={kit.secondaryColor} onChange={(v) => setKit({ ...kit, secondaryColor: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>Accent color</Label>
            <ColorPicker value={kit.accentColor} onChange={(v) => setKit({ ...kit, accentColor: v })} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Brand font</Label>
          <Select value={kit.fontFamily} onValueChange={(v) => setKit({ ...kit, fontFamily: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_NAMES.map((f) => (
                <SelectItem key={f} value={f}>
                  <span style={{ fontFamily: `var(--font-${slugFont(f)})` }}>{f}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border border-border bg-surface-2 p-5 text-center">
          <p
            className="text-2xl font-bold"
            style={{ fontFamily: `var(--font-${slugFont(kit.fontFamily)})`, color: kit.primaryColor }}
          >
            {kit.name || "Your Brand"}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            {[kit.primaryColor, kit.secondaryColor, kit.accentColor].map((c) => (
              <span key={c} className="size-6 rounded-full border border-border-strong" style={{ background: c }} />
            ))}
          </div>
        </div>

        <Button variant="accent" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save brand kit
        </Button>
      </div>
    </div>
  );
}
