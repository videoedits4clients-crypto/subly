import { NextResponse } from "next/server";
import { getSystemFonts } from "@/lib/fonts/system-fonts";

/**
 * Windows fonts actually installed on the machine running this server. Only
 * meaningful in the packaged desktop build — in the web/SaaS product this
 * server runs on a remote machine, so "installed fonts" would describe the
 * server's fonts, not the end user's, which would be actively misleading.
 * Gated the same way the rest of the desktop-only surface is (SUBLY_DESKTOP,
 * set by electron/main.js — see lib/api-auth.ts).
 */
export async function GET() {
  if (process.env.SUBLY_DESKTOP !== "1") {
    return NextResponse.json({ families: [] });
  }
  const families = await getSystemFonts();
  // File paths are a server-side implementation detail (used only when
  // resolving a font for ffmpeg at export time) — no reason to send them
  // to the client, which only needs names and weights to render the picker.
  return NextResponse.json({
    families: families.map((f) => ({ name: f.name, faces: f.faces.map((face) => ({ weight: face.weight, italic: face.italic })) })),
  });
}
