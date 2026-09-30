import { Download, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SUBLY_VERSION,
  SUBLY_INSTALLER_SIZE_LABEL,
  SUBLY_SHA256,
  SUBLY_DOWNLOAD_URL,
  SUBLY_RELEASE_NOTES_URL,
  SUBLY_INSTALL_GUIDE_URL,
} from "@/lib/release-info";

const LIMITATIONS = [
  "New-project transcription currently supports English and Hindi, plus Auto Detect.",
  "AI text tools and Translate require a cloud connection; otherwise they run in Demo mode.",
  "Translation regenerates word-level timing as evenly-spaced values, not the original speech rhythm.",
  "No cloud sync or real-time collaboration.",
  "No automatic updater — new versions are installed manually.",
  "No file-type associations.",
  "Uninstalling does not remove your project data automatically.",
];

/**
 * Task 182741 (P19.26): extracted from src/app/download/page.tsx so the main app's /download
 * and the independent static site under website/ render byte-identical download content from
 * one source — version, SHA-256, and every URL keep coming from lib/release-info.ts, so neither
 * copy of the page can drift from the other.
 */
export function DownloadContent() {
  return (
    <>
      <section className="border-b border-border/60 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <p className="text-sm font-medium text-accent">SUBLY for Windows</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">Version {SUBLY_VERSION}</h1>
          <p className="mt-4 text-muted">Professional subtitle editing and local transcription for Windows.</p>

          <Button size="lg" variant="accent" className="mt-8" asChild>
            <a href={SUBLY_DOWNLOAD_URL}>
              <Download className="size-4" /> Download for Windows
            </a>
          </Button>
          <p className="mt-3 text-xs text-muted-2">
            SUBLY {SUBLY_VERSION} · Windows · {SUBLY_INSTALLER_SIZE_LABEL}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
            <a href={SUBLY_RELEASE_NOTES_URL} className="inline-flex items-center gap-1.5 text-muted hover:text-foreground">
              <FileText className="size-3.5" /> Release notes
            </a>
            <a href={SUBLY_INSTALL_GUIDE_URL} className="inline-flex items-center gap-1.5 text-muted hover:text-foreground">
              <ShieldCheck className="size-3.5" /> Installation guide
            </a>
          </div>
        </div>
      </section>

      <section className="border-b border-border/60 py-16">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-lg font-semibold">Verify your download (optional)</h2>
          <p className="mt-2 text-sm text-muted">
            SHA-256:{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{SUBLY_SHA256}</code>
          </p>
          <p className="mt-3 text-sm text-muted">
            On Windows, open PowerShell in the folder where you saved the installer and run:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-xs">
            <code>{`Get-FileHash "SUBLY Setup ${SUBLY_VERSION}.exe" -Algorithm SHA256`}</code>
          </pre>
          <p className="mt-2 text-xs text-muted-2">
            The result should match the value above. If it doesn&apos;t, download the installer again rather than running it.
          </p>
        </div>
      </section>

      <section className="border-b border-border/60 py-16">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-lg font-semibold">Why does SUBLY need internet on first use?</h2>
          <p className="mt-2 text-sm text-muted">
            SUBLY&apos;s local transcription model needs to be downloaded once on a new installation — this requires an
            internet connection. Once that one-time download completes, transcription runs locally, with no ongoing
            internet requirement. AI text tools and Translate remain cloud-dependent every time they&apos;re used.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-lg font-semibold">Known limitations</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {LIMITATIONS.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-2" />
                {l}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
