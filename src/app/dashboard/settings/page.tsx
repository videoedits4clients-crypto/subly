"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

function PathRow({ label, path }: { label: string; path: string | null }) {
  async function copy() {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Path copied.");
    } catch {
      toast.error("Couldn't copy the path.");
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input value={path ?? "Cloud storage — no local path"} disabled className="font-mono text-xs" />
        {path && (
          <Button variant="outline" size="icon-sm" onClick={copy} aria-label={`Copy ${label} path`}>
            <Copy className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [databasePath, setDatabasePath] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSystemStatus()
      .then((s) => {
        setStoragePath(s.storagePath);
        setDatabasePath(s.databasePath);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-muted">Manage your account.</p>

      <Card className="mt-8 space-y-4 p-6">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={session?.user?.name ?? ""} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={session?.user?.email ?? ""} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>Plan</Label>
          <div>
            <Badge variant="accent">Free</Badge>
          </div>
        </div>
      </Card>

      <h2 className="mt-8 text-lg font-semibold">Data location</h2>
      <p className="mt-1 text-sm text-muted">
        Everything SUBLY stores stays on this machine — no cloud upload. These are the exact folders on disk, useful for backups or
        troubleshooting.
      </p>
      <Card className="mt-4 space-y-4 p-6">
        <PathRow label="Project files (videos, exports)" path={storagePath} />
        <PathRow label="Database" path={databasePath} />
      </Card>
    </div>
  );
}
