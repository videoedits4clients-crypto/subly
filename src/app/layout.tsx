import type { Metadata } from "next";
import "./globals.css";
import { FONT_VARIABLE_CLASS } from "@/lib/fonts";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "SUBLY — Turn videos into styled subtitles in seconds",
  description:
    "AI auto subtitle generator and caption editor for Reels, TikTok, YouTube Shorts and more. Upload a video, get perfectly timed, beautifully styled captions in seconds.",
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
