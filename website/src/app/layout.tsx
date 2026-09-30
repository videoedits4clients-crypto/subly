import type { Metadata } from "next";
import "./globals.css";
import { FONT_VARIABLE_CLASS } from "@/lib/fonts";

/**
 * Task 182741 (P19.26): independent static-site layout. Applies the same FONT_VARIABLE_CLASS
 * the main app's layout uses (imported directly from the shared src/lib/fonts.ts — not
 * duplicated) so style-showcase.tsx's preset previews resolve the same --font-* CSS variables
 * here as they do in the main app.
 */
export const metadata: Metadata = {
  title: "SUBLY — Professional Subtitle Editor for Windows",
  description:
    "SUBLY is a Windows desktop subtitle editor with local transcription, word-level timing, professional caption styling and MP4/SRT/VTT/TXT export.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${FONT_VARIABLE_CLASS} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
