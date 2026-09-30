"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { UploadCloud, FileVideo, Loader2, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { TranscriptionSettingsDialog, type TranscriptionSettings } from "@/components/dashboard/transcription-settings-dialog";
import { DEFAULT_TIMING_RULES } from "@/types/subtitle";
import { ACCEPTED_VIDEO_MIME_TYPES, ACCEPTED_FORMATS_LABEL, DEFAULT_MAX_UPLOAD_MB, validateUploadFile } from "@/lib/upload-validation";

// Same accepted-format list the upload API route enforces (see lib/upload-validation.ts) —
// react-dropzone just wants it reshaped as {mime: [".ext"]}. This is a client-side convenience
// check only; the server performs the same check again, authoritatively.
const ACCEPT: Record<string, string[]> = Object.fromEntries(
  Object.entries(ACCEPTED_VIDEO_MIME_TYPES).map(([mime, ext]) => [mime, [`.${ext}`]]),
);
const CLIENT_MAX_BYTES = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;

export default function UploadPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // react-dropzone silently drops anything it rejects unless BOTH callback arguments are read —
  // the original version of this handler only read `accepted`, so a wrong-type or oversized
  // file (whether dropped or picked via the file input, which shares this same handler)
  // produced no feedback at all: the dropzone just sat there looking untouched. Every rejection
  // now gets the exact same message the backend would give for the same problem, by running it
  // through the identical validateUploadFile() check the API route uses authoritatively.
  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    if (accepted[0]) {
      setFile(accepted[0]);
      setUploadError(null);
      return;
    }
    const rejected = rejections[0];
    if (!rejected) return;
    const validation = validateUploadFile({ name: rejected.file.name, type: rejected.file.type, size: rejected.file.size }, CLIENT_MAX_BYTES);
    const message = !validation.ok ? validation.message : (rejected.errors[0]?.message ?? "This file couldn't be used. Please try a different file.");
    setFile(null);
    setUploadError(message);
    toast.error(message);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: false,
    maxSize: CLIENT_MAX_BYTES,
  });

  // Transcription must not start until these are confirmed — see
  // TranscriptionSettingsDialog. Language reaches the local Whisper worker directly;
  // maxWordsPerCaption/linesPerCaption/smartSegmentation only affect how the resulting
  // word-level transcript gets grouped into captions afterward (segmentWords), so they're
  // persisted into the SAME project.timingRules the editor's own Settings tab already reads
  // and writes — no schema change, and changing them later never re-runs Whisper.
  async function confirmSettingsAndUpload(settings: TranscriptionSettings) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.patchProject(params.id, {
        language: settings.language,
        timingRules: {
          ...DEFAULT_TIMING_RULES,
          maxWordsPerCaption: settings.maxWordsPerCaption,
          maxLines: settings.linesPerCaption,
          smartSegmentation: settings.smartSegmentation,
        },
      });
      await api.uploadVideo(params.id, file, setProgress);
      router.push(`/editor/${params.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setUploadError(message);
      toast.error(message);
      setUploading(false);
      setShowSettings(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-grid px-6">
      <div className="w-full max-w-xl">
        <h1 className="text-center text-2xl font-semibold">Upload your video</h1>
        <p className="mt-1 text-center text-sm text-muted">
          {ACCEPTED_FORMATS_LABEL} — up to {Math.round(DEFAULT_MAX_UPLOAD_MB / 1024)}GB.
        </p>

        {uploadError && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1">{uploadError}</p>
            <button onClick={() => setUploadError(null)} className="shrink-0 rounded p-0.5 hover:bg-danger/10" aria-label="Dismiss error">
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {!file ? (
          <div
            {...getRootProps()}
            className={`mt-8 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-16 text-center transition-colors ${
              isDragActive ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:bg-surface-2"
            }`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="size-10 text-muted" />
            <p className="font-medium">Drag & drop your video here</p>
            <p className="text-sm text-muted-2">or click to browse your files</p>
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <FileVideo className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-2">{formatBytes(file.size)}</p>
              </div>
              {!uploading && (
                <button
                  onClick={() => {
                    setFile(null);
                    setUploadError(null);
                  }}
                  className="rounded-md p-1.5 text-muted hover:bg-surface-2"
                  aria-label="Remove file"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {uploading && (
              <div className="mt-5">
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted-2">Uploading… {progress}%</p>
              </div>
            )}

            {!uploading && (
              <Button variant="accent" className="mt-5 w-full" onClick={() => setShowSettings(true)}>
                Upload & auto-generate subtitles
              </Button>
            )}
            {uploading && (
              <Button variant="accent" className="mt-5 w-full" disabled>
                <Loader2 className="size-4 animate-spin" /> Uploading…
              </Button>
            )}
          </div>
        )}
      </div>

      <TranscriptionSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        onConfirm={confirmSettingsAndUpload}
        confirming={uploading}
      />
    </div>
  );
}
