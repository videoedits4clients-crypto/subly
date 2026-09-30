import path from "path";
import { NextResponse } from "next/server";
import { isDemoMode as isTranscriptionDemo } from "@/lib/transcription";
import { isAiDemoMode } from "@/lib/ai";
import { getStorage } from "@/lib/storage";

/** Strips the "file:" prefix Prisma's SQLite connection string uses and resolves a relative
 * path (as in dev's `file:./dev.db`) against the process cwd so Settings always shows a real,
 * openable absolute path rather than a connection-string fragment. */
function describeDatabaseLocation(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return null;
  const raw = url.slice("file:".length);
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

/**
 * Lets the client distinguish real AI from the mock/demo fallback so the UI
 * can say so explicitly, rather than letting a user believe a mock
 * transcription or a no-op "translation" came from real AI. Also surfaces
 * where project files and the database actually live on disk (see Settings
 * page) — desktop users asked where to find these for backup/troubleshooting.
 */
export async function GET() {
  return NextResponse.json({
    transcriptionDemo: isTranscriptionDemo(),
    aiToolsDemo: isAiDemoMode(),
    storagePath: getStorage().describeLocation?.() ?? null,
    databasePath: describeDatabaseLocation(),
  });
}
