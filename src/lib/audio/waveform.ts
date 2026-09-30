/**
 * Pure waveform-peak computation from a WAV file's raw bytes — no ffmpeg subprocess, no
 * network, no filesystem access in this module (the route that calls it owns I/O). Operates
 * directly on the mono 16-bit PCM `audio.wav` the transcription pipeline already extracts for
 * every project (see lib/pipeline.ts's extractAudio call) — this module never touches or
 * duplicates that extraction step, it only reads the file it already produces.
 *
 * Deliberately downsampled rather than exposing raw samples to the client: a naive "one sample
 * per pixel" approach would mean shipping (and the browser drawing) tens of millions of points
 * for a 60-minute recording. Instead this reduces the whole file to a small, fixed-resolution
 * "peak per time bucket" array (see computePeaks) — the standard technique waveform UIs use
 * (Audacity, DAWs, audio editors) — cheap to compute once, cheap to cache, cheap to redraw at
 * any zoom level.
 */

export interface WavPcm16Mono {
  sampleRate: number;
  /** Number of interleaved channels in the source file — samples are already
   * downmixed to mono by the caller's expectations (extractAudio always requests
   * 1 channel), but this is recorded for a sanity check, not assumed blindly. */
  channels: number;
  samples: Int16Array;
}

/** Parses a canonical PCM WAV file (16-bit signed, little-endian — exactly what
 * lib/ffmpeg's extractAudio produces) into its sample rate and raw samples. Walks the RIFF
 * chunk list rather than assuming a fixed 44-byte header, since an encoder can legally place
 * other chunks (e.g. "LIST") before "data". Throws a descriptive error for anything that isn't
 * a well-formed PCM WAV — callers must treat that as "couldn't generate a waveform for this
 * file" (see the /waveform route), never as a reason to fail the whole project. */
export function parseWavPcm16(buffer: Buffer): WavPcm16Mono {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file.");
  }

  let offset = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let dataStart: number | undefined;
  let dataLength: number | undefined;

  // A file truncated or corrupted mid-chunk (e.g. a declared "fmt " chunk whose 16 bytes of
  // body don't actually all fit before the buffer ends) must be reported as the same clean,
  // catchable "not readable" error every other malformed case below produces — never a raw
  // Buffer RangeError bubbling out of a `read*LE` call. Wrapping the whole walk means every
  // new way a file could be truncated is handled by construction, not by enumerating them.
  try {
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkBodyStart = offset + 8;

      if (chunkId === "fmt ") {
        if (chunkBodyStart + 16 > buffer.length) throw new Error("Truncated fmt chunk.");
        channels = buffer.readUInt16LE(chunkBodyStart + 2);
        sampleRate = buffer.readUInt32LE(chunkBodyStart + 4);
        bitsPerSample = buffer.readUInt16LE(chunkBodyStart + 14);
      } else if (chunkId === "data") {
        dataStart = chunkBodyStart;
        // Guard against a truncated/corrupt file claiming more data than actually follows —
        // clamp to what's really in the buffer rather than reading out of bounds.
        dataLength = Math.min(chunkSize, Math.max(0, buffer.length - chunkBodyStart));
      }

      // Chunks are word-aligned: an odd-sized chunk has one byte of padding after it.
      offset = chunkBodyStart + chunkSize + (chunkSize % 2);
    }
  } catch {
    throw new Error("Malformed or truncated WAV file.");
  }

  if (sampleRate === undefined || channels === undefined || bitsPerSample === undefined) {
    throw new Error("Missing fmt chunk.");
  }
  if (dataStart === undefined || dataLength === undefined) {
    throw new Error("Missing data chunk.");
  }
  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported bit depth: ${bitsPerSample} (expected 16-bit PCM).`);
  }

  const sampleCount = Math.floor(dataLength / 2);
  // Int16Array requires an even byte offset — the data chunk body always starts at an even
  // offset in practice (RIFF headers are word-aligned by construction above), but slice a
  // fresh, aligned copy rather than assume it, so this never throws on an unusual encoder.
  const dataBytes = buffer.subarray(dataStart, dataStart + sampleCount * 2);
  const aligned = dataBytes.byteOffset % 2 === 0 ? dataBytes : Buffer.from(dataBytes);
  const samples = new Int16Array(aligned.buffer, aligned.byteOffset, sampleCount);

  return { sampleRate, channels, samples };
}

export interface WaveformData {
  /** One amplitude value per time bucket, 0-255 (0 = silence, 255 = full scale) — the peak
   * (max absolute sample, normalized) within that bucket. Symmetric by construction (rendered
   * as a bar reflected around a center line), not a true min/max envelope — enough to
   * communicate "where is the audio, how loud is it" without over-decorating a bar meant for
   * quick visual reference during editing, not precise waveform analysis. */
  peaks: Uint8Array;
  /** How many entries of `peaks` correspond to one second of audio — the ONE piece of
   * information needed to map any timestamp to a peak index (see lib/timeline/time-scale.ts),
   * and vice versa. */
  peaksPerSecond: number;
  /** Total audio duration in seconds, computed from the actual sample count (not trusted from
   * anywhere else) — `peaks.length` is `Math.ceil(duration * peaksPerSecond)`. */
  duration: number;
}

/** Default resolution: fine enough to look smooth at the timeline's own maximum zoom
 * (MAX_PX_PER_SEC = 220 in components/editor/timeline.tsx) without shipping/storing more
 * points than that — see components/editor/waveform.tsx, which draws at most one canvas
 * column per screen pixel regardless of how many peaks exist per second. */
export const DEFAULT_PEAKS_PER_SECOND = 100;

/** Reduces raw PCM samples to one peak-per-bucket at `peaksPerSecond` resolution. Always
 * produces at least one peak for any non-empty sample array, even sub-bucket-length audio (a
 * one-word, half-second clip must still render something, not an empty/broken waveform — see
 * the "very short audio" handling requirement). Pure and deterministic: the same samples always
 * produce the same peaks, with no reliance on timing, randomness, or external state. */
export function computePeaks(samples: Int16Array, sampleRate: number, peaksPerSecond: number = DEFAULT_PEAKS_PER_SECOND): WaveformData {
  const duration = samples.length / sampleRate;
  if (samples.length === 0) {
    return { peaks: new Uint8Array(0), peaksPerSecond, duration: 0 };
  }

  const samplesPerBucket = Math.max(1, Math.round(sampleRate / peaksPerSecond));
  const bucketCount = Math.max(1, Math.ceil(samples.length / samplesPerBucket));
  const peaks = new Uint8Array(bucketCount);

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = bucket * samplesPerBucket;
    const end = Math.min(samples.length, start + samplesPerBucket);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    // Int16 range is -32768..32767 — normalize against the full-scale magnitude to 0-255.
    peaks[bucket] = Math.min(255, Math.round((peak / 32768) * 255));
  }

  return { peaks, peaksPerSecond, duration };
}

/** End-to-end: WAV bytes in, downsampled peaks out. What the /waveform route actually calls —
 * split out from parseWavPcm16/computePeaks individually only so each step is independently
 * testable (a malformed-WAV test doesn't need real audio; a peak-math test doesn't need a real
 * WAV header). */
export function computeWaveformFromWav(buffer: Buffer, peaksPerSecond: number = DEFAULT_PEAKS_PER_SECOND): WaveformData {
  const { samples, sampleRate, channels } = parseWavPcm16(buffer);
  if (channels !== 1) {
    // extractAudio always requests mono — a stereo/multi-channel file here would mean
    // something upstream changed formats. Downmix defensively (average channels) rather than
    // silently reading interleaved samples as if they were mono, which would produce a
    // meaningless, noisy-looking waveform instead of a clear error or a correct downmix.
    const frames = Math.floor(samples.length / channels);
    const mono = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += samples[i * channels + c];
      mono[i] = Math.round(sum / channels);
    }
    return computePeaks(mono, sampleRate, peaksPerSecond);
  }
  return computePeaks(samples, sampleRate, peaksPerSecond);
}

/** Compact wire format: base64 of the raw peak bytes rather than a JSON number array — a
 * 60-minute recording at DEFAULT_PEAKS_PER_SECOND is ~360,000 bytes; as a JSON array of
 * comma-separated small integers that would be several times larger for no benefit on a
 * localhost-only round trip, but there's no reason to pay it. */
export function encodeWaveform(data: WaveformData): { peaks: string; peaksPerSecond: number; duration: number } {
  return { peaks: Buffer.from(data.peaks).toString("base64"), peaksPerSecond: data.peaksPerSecond, duration: data.duration };
}

export function decodeWaveform(encoded: { peaks: string; peaksPerSecond: number; duration: number }): WaveformData {
  const binary = atob(encoded.peaks);
  const peaks = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) peaks[i] = binary.charCodeAt(i);
  return { peaks, peaksPerSecond: encoded.peaksPerSecond, duration: encoded.duration };
}
