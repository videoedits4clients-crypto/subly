import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { getStorage } from "@/lib/storage";
import { computeWaveformFromWav, encodeWaveform, decodeWaveform } from "@/lib/audio/waveform";

interface CachedWaveform {
  peaks: string;
  peaksPerSecond: number;
  duration: number;
  /** The source audio.wav's mtime (ms since epoch) at the time this cache entry was
   * generated — the staleness check compares this against the file's CURRENT mtime rather
   * than trusting the cache forever, so a re-uploaded/re-transcribed project (which rewrites
   * audio.wav in place — see lib/pipeline.ts) gets a fresh waveform instead of a stale one. */
  sourceMtimeMs: number;
}

const WAVEFORM_CACHE_FILE = "waveform.json";

/**
 * Returns downsampled waveform peaks for a project's extracted audio — generated once from
 * the same audio.wav the transcription pipeline already produces (lib/pipeline.ts's
 * extractAudio; this route never re-extracts or re-decodes anything from the source video) and
 * cached alongside it, so a project's waveform is computed at most once per audio version, not
 * once per editor session/render. Cache lives at <projectId>/waveform.json, under the same
 * storage prefix permanent deletion already removes wholesale (see
 * api/projects/[id]/trash/route.ts's delDir) — no separate cleanup path needed for it.
 *
 * Never fails the surrounding editor: a project with no audio yet, a corrupt/unreadable audio
 * file, or any other failure here returns `{ peaks: null }` with a 200, not an error status —
 * the timeline is expected to render normally without a waveform in that case (see
 * components/editor/waveform.tsx).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { video: true } });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (!project.video?.audioUrl) {
    // No audio extracted yet (still processing, or extraction never completed) — a real,
    // expected state, not an error. See the "missing audio" handling requirement.
    return NextResponse.json({ peaks: null });
  }

  const storage = getStorage();
  const audioKey = project.video.audioUrl.replace(/^\/api\/files\//, "");

  try {
    const audioAbsPath = await storage.getPath(audioKey);
    const audioStat = await fs.stat(audioAbsPath);

    const cacheKey = path.posix.join(projectId, WAVEFORM_CACHE_FILE);
    const cached = await readCache(storage, cacheKey, audioStat.mtimeMs);
    if (cached) return NextResponse.json({ peaks: cached.peaks, peaksPerSecond: cached.peaksPerSecond, duration: cached.duration });

    const audioBuffer = await fs.readFile(audioAbsPath);
    const waveform = computeWaveformFromWav(audioBuffer);
    const encoded = encodeWaveform(waveform);
    const toCache: CachedWaveform = { ...encoded, sourceMtimeMs: audioStat.mtimeMs };
    await storage.put(cacheKey, Buffer.from(JSON.stringify(toCache)), "application/json").catch(() => {
      // Best-effort cache write — a failure here (e.g. disk full) must not prevent returning
      // the waveform we already successfully computed; it just means next request recomputes.
    });

    return NextResponse.json({ peaks: encoded.peaks, peaksPerSecond: encoded.peaksPerSecond, duration: encoded.duration });
  } catch (err) {
    console.error(`[waveform] project ${projectId} failed:`, err);
    return NextResponse.json({ peaks: null });
  }
}

async function readCache(
  storage: ReturnType<typeof getStorage>,
  cacheKey: string,
  currentSourceMtimeMs: number,
): Promise<{ peaks: string; peaksPerSecond: number; duration: number } | null> {
  try {
    const cacheAbsPath = await storage.getPath(cacheKey);
    const raw = await fs.readFile(cacheAbsPath, "utf-8");
    const parsed = JSON.parse(raw) as CachedWaveform;
    if (parsed.sourceMtimeMs !== currentSourceMtimeMs) return null; // audio changed since caching — stale
    // Round-trip through decode/encode once as a cheap sanity check that the cached payload is
    // still well-formed (e.g. wasn't left half-written by a crash) rather than trusting raw
    // bytes blindly — cheap relative to a full recompute, and a corrupt cache silently falling
    // through to regeneration is much better than serving garbage peaks.
    decodeWaveform(parsed);
    return { peaks: parsed.peaks, peaksPerSecond: parsed.peaksPerSecond, duration: parsed.duration };
  } catch {
    return null;
  }
}
