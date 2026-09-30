/**
 * Pure, Node-free pieces of the export font preflight — the missing-font type, the
 * human-readable message builder, the error class, and the message-detection helper the
 * export dialog (a client component) uses to decide whether to show the extra
 * "choose another font" / "export anyway" actions. Deliberately split out from
 * font-preflight.ts, which imports `fs`/`system-fonts.ts` and must stay server-only —
 * importing that into a "use client" component would pull Node built-ins into the browser
 * bundle. Nothing here touches the filesystem, network, or any Node built-in.
 */

export interface MissingFont {
  family: string;
  weight: number;
  source: "bundled" | "system";
}

/** Why this one font, specifically, couldn't be resolved — phrased for a caption editor, not
 * a developer (see the P1 task's explicit "avoid libass/fontconfig/ASS/ffmpeg/filesystem path"
 * instruction). */
function missingFontReason(font: MissingFont): string {
  return font.source === "system"
    ? "This font is no longer available on this computer."
    : "This font couldn't be prepared for export — it may require an internet connection the first time it's used.";
}

/** Builds the ExportJob.errorMessage for a blocked export — reuses the existing
 * ExportJob.errorMessage + export-dialog polling/failed-state UI (see export-dialog.tsx)
 * rather than any new error-transport mechanism. Always starts with a fixed, recognizable
 * phrase ("Font unavailable:" / "N fonts are unavailable:") that isFontUnavailableMessage()
 * below matches on, so the dialog can offer font-specific actions without a new DB column. */
export function buildMissingFontMessage(missing: MissingFont[]): string {
  if (missing.length === 1) {
    const font = missing[0];
    return `Font unavailable: "${font.family}"\n\n${missingFontReason(font)}`;
  }
  const names = missing.map((f) => `• ${f.family}`).join("\n");
  return `${missing.length} fonts are unavailable:\n${names}\n\nOne or more of these fonts could not be found for export — a system font may have been removed, or a bundled font could not be prepared (which may require an internet connection).`;
}

const FONT_UNAVAILABLE_PATTERN = /^(Font unavailable:|\d+ fonts are unavailable:)/;

/** True if this ExportJob.errorMessage was produced by buildMissingFontMessage() above —
 * lets the (unmodified for every other error) export-dialog failed-state branch specifically
 * for a font-preflight block, without a dedicated error-code column. */
export function isFontUnavailableMessage(message: string | null | undefined): boolean {
  return !!message && FONT_UNAVAILABLE_PATTERN.test(message);
}

export class FontResolutionError extends Error {
  readonly missing: MissingFont[];
  constructor(missing: MissingFont[]) {
    super(buildMissingFontMessage(missing));
    this.name = "FontResolutionError";
    this.missing = missing;
  }
}
