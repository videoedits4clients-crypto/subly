import type { Metadata } from "next";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { DownloadContent } from "@/components/landing/download-content";
import { SUBLY_VERSION, SUBLY_INSTALLER_SIZE_LABEL } from "@/lib/release-info";

/**
 * Task 182741 (P19.26): mirrors the main app's src/app/download/page.tsx exactly, rendering the
 * same shared DownloadContent component so version/SHA-256/URLs can't drift between the two
 * copies of this page.
 */
export const metadata: Metadata = {
  title: "Download SUBLY for Windows",
  description: `Download SUBLY ${SUBLY_VERSION} for Windows — professional subtitle editing with local transcription. ${SUBLY_INSTALLER_SIZE_LABEL} installer, SHA-256 verified.`,
};

export default function DownloadPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <DownloadContent />
      </main>
      <Footer />
    </div>
  );
}
