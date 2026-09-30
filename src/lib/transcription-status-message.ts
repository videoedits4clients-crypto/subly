/**
 * Pure, Node-free helper for recognizing the one specific, deliberate transcription failure
 * reason worth surfacing distinctly: python/whisper_worker.py rejects a second "transcribe"
 * command outright while one is already running on the sidecar (one decode at a time per
 * process, by design — see that file's own comment), and reports back this exact message.
 * Without checking for it, lib/pipeline.ts's catch block was collapsing it into the same
 * generic "Something went wrong" text used for a genuine, unexplained failure — which reads as
 * a bug and invites a pointless Retry, instead of "wait for the other one, or just try again."
 * Mirrors the same "match a fixed, recognizable message text" pattern
 * lib/export-status-message.ts already uses for isExportCancelledMessage.
 */
export const SIDECAR_BUSY_MESSAGE = "Another transcription is already running.";

export function isSidecarBusyMessage(message: string | null | undefined): boolean {
  return message === SIDECAR_BUSY_MESSAGE;
}
