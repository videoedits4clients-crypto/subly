"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useEditorStore } from "@/store/editor-store";
import { ProcessingScreen } from "@/components/editor/processing-screen";
import { EditorShell } from "@/components/editor/editor-shell";
import { readLocalSnapshot, clearLocalSnapshot } from "@/lib/local-snapshot";
import type { SavePayload } from "@/hooks/use-autosave";
import { toast } from "sonner";

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const load = useEditorStore((s) => s.load);
  const setAiToolsDemo = useEditorStore((s) => s.setAiToolsDemo);
  const setTranscriptionDemo = useEditorStore((s) => s.setTranscriptionDemo);
  const [phase, setPhase] = useState<"loading" | "processing" | "ready">("loading");

  const fetchAndLoad = useCallback(async () => {
    const data = await api.getProject(params.id);
    load(data);
    return data;
  }, [params.id, load]);

  useEffect(() => {
    api
      .getSystemStatus()
      .then((s) => {
        setAiToolsDemo(s.aiToolsDemo);
        setTranscriptionDemo(s.transcriptionDemo);
      })
      .catch(() => {});
  }, [setAiToolsDemo, setTranscriptionDemo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAndLoad();
        if (cancelled) return;
        if (data.status === "EMPTY") {
          router.replace(`/projects/${params.id}/upload`);
          return;
        }
        // Anything past the initial pipeline (READY/EDITING/EXPORTING/EXPORTED)
        // is editor-ready — only the pipeline states themselves (and ERROR,
        // which ProcessingScreen renders its own retry UI for) should show
        // the processing screen instead of the editor.
        const stillProcessing = data.status === "LOADING" || data.status === "TRANSCRIBING" || data.status === "ERROR";
        setPhase(stillProcessing ? "processing" : "ready");
        if (!stillProcessing) offerLocalSnapshotRestore(params.id, data.updatedAt);
      } catch {
        router.replace("/dashboard");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAndLoad, params.id, router]);

  const onReady = useCallback(() => {
    fetchAndLoad().then(() => setPhase("ready"));
  }, [fetchAndLoad]);

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }

  if (phase === "processing") {
    return <ProcessingScreen projectId={params.id} onReady={onReady} />;
  }

  return <EditorShell projectId={params.id} />;
}

/**
 * If a local crash-safety snapshot (see lib/local-snapshot.ts) exists and is
 * NEWER than what the server just returned, the last edit never made it to
 * the server — offer to restore it rather than silently discarding it. Never
 * overwrites the server's copy automatically: the user decides.
 */
function offerLocalSnapshotRestore(projectId: string, serverUpdatedAt: string) {
  const snapshot = readLocalSnapshot<SavePayload>(projectId);
  if (!snapshot) return;
  if (new Date(snapshot.savedAt) <= new Date(serverUpdatedAt)) {
    clearLocalSnapshot(projectId); // stale — server copy is already at least as new
    return;
  }

  toast.info("Found unsaved changes from a previous session.", {
    duration: 15000,
    action: {
      label: "Restore",
      onClick: () => {
        const project = useEditorStore.getState().project;
        if (!project) return;
        useEditorStore.setState({
          project: { ...project, ...snapshot.payload },
          dirty: true,
        });
        clearLocalSnapshot(projectId);
        toast.success("Restored — saving now.");
      },
    },
    cancel: {
      label: "Discard",
      onClick: () => clearLocalSnapshot(projectId),
    },
  });
}
