/**
 * Pure, Node-free helper for telling a genuinely CANCELLED export apart from one that FAILED —
 * both end up with ExportJob.status === "ERROR" (see lib/export-pipeline.ts's catch block,
 * which has no separate status value for "the user cancelled this on purpose" vs "something
 * broke"), so the only signal available to a client component is the errorMessage text itself.
 * Mirrors the same "match a fixed, recognizable message prefix" pattern
 * lib/fonts/font-preflight-message.ts already uses for isFontUnavailableMessage — no new
 * ExportJob column needed for this.
 */
export const EXPORT_CANCELLED_MESSAGE = "Export cancelled.";

export function isExportCancelledMessage(message: string | null | undefined): boolean {
  return message === EXPORT_CANCELLED_MESSAGE;
}
