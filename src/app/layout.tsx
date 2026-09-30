import type { Metadata } from "next";
import "./globals.css";
import { FONT_VARIABLE_CLASS } from "@/lib/fonts";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "SUBLY — Professional Subtitle Editor for Windows",
  description:
    "SUBLY is a Windows desktop subtitle editor with local transcription, word-level timing, professional caption styling and MP4/SRT/VTT/TXT export.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${FONT_VARIABLE_CLASS} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
