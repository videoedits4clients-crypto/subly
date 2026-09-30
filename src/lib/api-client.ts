import type { AnimationConfig, AspectRatio, ProjectData, SubtitleStyle } from "@/types/subtitle";
import type { CustomPresetRecord } from "@/lib/custom-presets";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  aspectRatio: AspectRatio;
  language: string;
  duration: number;
  width: number;
  height: number;
  thumbnailUrl: string | null;
  subtitleCount: number;
  exportStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  listProjects: () => fetch("/api/projects").then((r) => json<ProjectSummary[]>(r)),

  createProject: (input: { name: string; aspectRatio: AspectRatio; language?: string; presetId?: string }) =>
    fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((r) =>
      json<{ id: string }>(r),
    ),

  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<ProjectData>(r)),

  patchProject: (id: string, patch: Record<string, unknown>) =>
    fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(
      (r) => json<ProjectData>(r),
    ),

  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true; trashed: true }>(r)),

  duplicateProject: (id: string) => fetch(`/api/projects/${id}/duplicate`, { method: "POST" }).then((r) => json<{ id: string }>(r)),

  listTrash: () =>
    fetch("/api/projects/trash").then((r) => json<{ id: string; name: string; thumbnailUrl: string | null; deletedAt: string }[]>(r)),
  restoreProject: (id: string) => fetch(`/api/projects/${id}/trash`, { method: "POST" }).then((r) => json<{ ok: true }>(r)),
  deleteProjectForever: (id: string) => fetch(`/api/projects/${id}/trash`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),

  retryProcessing: (id: string) => fetch(`/api/projects/${id}/retry`, { method: "POST" }).then((r) => json<{ ok: true }>(r)),

  getSystemStatus: () =>
    fetch("/api/system/status").then((r) =>
      json<{ transcriptionDemo: boolean; aiToolsDemo: boolean; storagePath: string | null; databasePath: string | null }>(r),
    ),

  getSystemFonts: () =>
    fetch("/api/system/fonts").then((r) => json<{ families: { name: string; faces: { weight: number; italic: boolean }[] }[] }>(r)),

  getStatus: (id: string) =>
    fetch(`/api/projects/${id}/status`).then((r) =>
      json<{
        status: string;
        errorMessage: string | null;
        language: string;
        subtitleCount: number;
        progress: number;
        elapsedSeconds: number | null;
      }>(r),
    ),

  cancelProcessing: (id: string) => fetch(`/api/projects/${id}/cancel`, { method: "POST" }).then((r) => json<{ ok: true; cancelled: boolean }>(r)),

  // `peaks` is null when there's no audio yet (still processing) or waveform generation
  // failed — see api/projects/[id]/waveform/route.ts, which always returns 200 rather than an
  // error for either case so a missing waveform is just "nothing to draw," never a thrown error.
  getWaveform: (id: string) =>
    fetch(`/api/projects/${id}/waveform`).then((r) => json<{ peaks: string | null; peaksPerSecond?: number; duration?: number }>(r)),

  uploadVideo: (projectId: string, file: File, onProgress?: (pct: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          // /api/upload returns { error: { code, message } } (see lib/upload-validation.ts);
          // a handful of shared, non-upload-specific rejections (e.g. rate limiting) still
          // return the older { error: "..." } string shape — handle both rather than assuming
          // one, so neither ever surfaces as a raw [object Object] or a silent failure.
          try {
            const body = JSON.parse(xhr.responseText);
            const message = typeof body.error === "string" ? body.error : (body.error?.message as string | undefined);
            reject(new Error(message || "Upload failed."));
          } catch {
            reject(new Error("Upload failed."));
          }
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
      xhr.send(form);
    }),

  subtitlesDownloadUrl: (id: string, format: "srt" | "vtt" | "txt") => `/api/projects/${id}/subtitles?format=${format}`,

  startExport: (
    id: string,
    options: {
      resolution: string;
      fps: number;
      quality: string;
      videoVisible?: boolean;
      backgroundColor?: string;
      canvasWidth?: number;
      canvasHeight?: number;
      /** Explicit opt-in to proceed even if the font preflight found an unresolvable font —
       * see lib/fonts/font-preflight.ts and export-dialog.tsx's "Export with a substitute
       * font" action. Omit/false for a normal export attempt. */
      allowFontFallback?: boolean;
    },
  ) =>
    fetch(`/api/projects/${id}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) }).then(
      (r) => json<{ id: string }>(r),
    ),

  listExportJobs: (projectId: string) =>
    fetch(`/api/projects/${projectId}/export`).then((r) =>
      json<
        {
          id: string;
          status: string;
          resolution: string;
          format: string;
          fps: number;
          outputUrl: string | null;
          errorMessage: string | null;
          createdAt: string;
        }[]
      >(r),
    ),

  getExportJob: (projectId: string, jobId: string) =>
    fetch(`/api/projects/${projectId}/export/${jobId}`).then((r) =>
      json<{ id: string; status: string; stage: string; progress: number; outputUrl: string | null; errorMessage: string | null }>(
        r,
      ),
    ),

  cancelExport: (projectId: string, jobId: string) =>
    fetch(`/api/projects/${projectId}/export/${jobId}/cancel`, { method: "POST" }).then((r) => json<{ ok: true; cancelled: boolean }>(r)),

  aiFixPunctuation: (subtitles: { id: string; text: string }[]) =>
    fetch("/api/ai/fix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtitles }) }).then((r) =>
      json<{ texts: Record<string, string> }>(r),
    ),

  aiRephrase: (subtitles: { id: string; text: string }[], mode: "shorten" | "rephrase") =>
    fetch("/api/ai/rephrase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtitles, mode }) }).then(
      (r) => json<{ texts: Record<string, string> }>(r),
    ),

  aiRemoveFillers: (words: unknown[], timingRules: unknown) =>
    fetch("/api/ai/remove-fillers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words, timingRules }),
    }).then((r) => json<{ subtitles: ProjectData["subtitles"]; removedCount: number }>(r)),

  aiMeta: (fullText: string) =>
    fetch("/api/ai/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullText }) }).then((r) =>
      json<{ title: string; description: string }>(r),
    ),

  translate: (subtitles: { id: string; text: string }[], targetLanguage: string) =>
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtitles, targetLanguage }),
    }).then((r) => json<{ texts: Record<string, string>; demo: boolean }>(r)),

  // Project-aware translation: saves the pre-translation transcript as its
  // own SubtitleTrack (see prisma/schema.prisma) instead of overwriting it,
  // and returns the full updated project so the caller can just `load()` it.
  translateProject: (projectId: string, targetLanguage: string) =>
    fetch(`/api/projects/${projectId}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLanguage }),
    }).then((r) => json<{ project: ProjectData; demo: boolean }>(r)),

  detectSilence: (projectId: string, minDuration: number) =>
    fetch(`/api/projects/${projectId}/detect-silence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minDuration }),
    }).then((r) => json<{ ranges: { start: number; end: number }[] }>(r)),

  listTracks: (projectId: string) =>
    fetch(`/api/projects/${projectId}/tracks`).then((r) =>
      json<{ language: string; label: string; subtitleCount: number; isActive: boolean }[]>(r),
    ),

  switchTrack: (projectId: string, language: string) =>
    fetch(`/api/projects/${projectId}/tracks/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    }).then((r) => json<ProjectData>(r)),

  // Custom (user-saved) caption presets — see src/lib/custom-presets.ts and
  // src/app/api/presets/route.ts. Built-in presets (src/lib/presets.ts) never go through
  // this API; they're a separate, hardcoded, local-only list.
  listCustomPresets: () => fetch("/api/presets").then((r) => json<CustomPresetRecord[]>(r)),

  createCustomPreset: (input: { name: string; style: SubtitleStyle; animation: AnimationConfig }) =>
    fetch("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => json<CustomPresetRecord>(r)),

  updateCustomPreset: (id: string, patch: { name?: string; style?: SubtitleStyle; animation?: AnimationConfig }) =>
    fetch(`/api/presets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<CustomPresetRecord>(r)),

  deleteCustomPreset: (id: string) => fetch(`/api/presets/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
};
