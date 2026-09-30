import { sanitizeFilename } from "./utils.ts";
import { isExportCancelledMessage } from "./export-status-message.ts";

/** The filename a downloaded export video is saved as — the project's own name (not the job's
 * opaque cuid, which is all the raw output URL's own path segment would otherwise give the
 * browser), sanitized the same way the SRT/VTT/TXT sidecar downloads already are (see
 * api/projects/[id]/subtitles/route.ts) so every download from this project looks like it
 * belongs together instead of one being "MyProject.srt" and the other "cmxyz123.mp4". Pulled
 * out of export-dialog.tsx (a "use client" component) into its own plain module so it has a
 * direct unit test — see components/editor/subtitle-overlay.tsx's animation-render.ts for the
 * same "extract the pure logic so it's testable outside JSX" precedent. */
export function exportDownloadFilename(projectName: string, resolution: string): string {
  return `${sanitizeFilename(projectName)}_${resolution}.mp4`;
}

/** A compact, factual label for one export-history row's outcome — distinguishes a deliberate
 * Cancel (still technically ExportJob.status "ERROR" — there's no separate status value for it,
 * see lib/export-status-message.ts) from a genuine failure, so "what did I export?" doesn't
 * lump every non-success attempt into the same ambiguous "error" word. */
export function historyStatusLabel(item: { status: string; errorMessage: string | null }): string {
  if (item.status === "ERROR" && isExportCancelledMessage(item.errorMessage)) return "cancelled";
  return item.status.toLowerCase();
}
