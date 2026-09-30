/**
 * Regression tests for the waveform peak-generation pipeline (src/lib/audio/waveform.ts) — pure
 * functions operating on real (synthetic, in-memory) WAV bytes, no real audio files or ffmpeg
 * needed, so these run in milliseconds and never depend on anything external.
 *
 * Run with: node --test src/lib/audio/__tests__/waveform.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseWavPcm16, computePeaks, computeWaveformFromWav, encodeWaveform, decodeWaveform, DEFAULT_PEAKS_PER_SECOND } from "../waveform.ts";

/** Builds a minimal, valid canonical PCM WAV file (16-bit signed, little-endian) from raw
 * samples — the same shape lib/ffmpeg's extractAudio produces (mono, 16kHz by default here,
 * but parameterized since one test below exercises a different rate). */
function buildWav(samples: Int16Array, sampleRate = 16000, channels = 1): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  buffer.writeUInt16LE(channels * 2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(samples[i], 44 + i * 2);
  return buffer;
}

function sineWave(seconds: number, sampleRate: number, freqHz: number, amplitude: number): Int16Array {
  const n = Math.round(seconds * sampleRate);
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.round(amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
  return samples;
}

test("1. waveform generation: a real (synthetic) WAV file produces a non-empty peaks array with a sensible duration", () => {
  const samples = sineWave(2, 16000, 440, 20000);
  const wav = buildWav(samples);
  const result = computeWaveformFromWav(wav);
  assert.ok(result.peaks.length > 0);
  assert.ok(Math.abs(result.duration - 2) < 0.01);
  assert.equal(result.peaksPerSecond, DEFAULT_PEAKS_PER_SECOND);
  // A 440Hz tone at amplitude 20000 should produce peaks well above silence, not clipped to 0.
  const maxPeak = Math.max(...result.peaks);
  assert.ok(maxPeak > 100, `expected a clearly audible peak, got ${maxPeak}`);
});

test("2. deterministic: computing the waveform twice from the exact same bytes always produces identical peaks", () => {
  const samples = sineWave(3, 16000, 220, 15000);
  const wav = buildWav(samples);
  const a = computeWaveformFromWav(wav);
  const b = computeWaveformFromWav(wav);
  assert.deepEqual(Array.from(a.peaks), Array.from(b.peaks));
  assert.equal(a.duration, b.duration);
});

test("parseWavPcm16 correctly reads sample rate/channels and walks past a non-fmt/data chunk before the data chunk", () => {
  const samples = new Int16Array([100, -100, 200, -200]);
  const base = buildWav(samples, 8000, 1);
  // Splice in a fake "LIST" chunk (with odd length, to also exercise word-alignment padding)
  // between fmt and data, as some real-world encoders legally do.
  const fmtEnd = 36;
  const fakeChunkBody = Buffer.from("hello"); // odd length (5) -> 1 byte padding required
  const fakeChunk = Buffer.concat([Buffer.from("LIST", "ascii"), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(fakeChunkBody.length, 0); return b; })(), fakeChunkBody, Buffer.alloc(1)]);
  const withExtraChunk = Buffer.concat([base.subarray(0, fmtEnd), fakeChunk, base.subarray(fmtEnd)]);

  const parsed = parseWavPcm16(withExtraChunk);
  assert.equal(parsed.sampleRate, 8000);
  assert.equal(parsed.channels, 1);
  assert.deepEqual(Array.from(parsed.samples), [100, -100, 200, -200]);
});

test("parseWavPcm16 rejects a non-WAV buffer with a clear error rather than crashing or misreading it", () => {
  assert.throws(() => parseWavPcm16(Buffer.from("not a wav file at all")), /RIFF\/WAVE/);
});

test("7. missing/corrupt audio: a file truncated mid-header (before the fmt chunk body even fully fits) throws a clean, descriptive error rather than a raw Buffer RangeError", () => {
  const wav = buildWav(new Int16Array([1, 2, 3, 4]));
  const truncated = wav.subarray(0, 20); // cuts off mid-"fmt " chunk body
  assert.throws(() => parseWavPcm16(truncated), /Malformed or truncated WAV file/);
});

test("7. missing/corrupt audio: a file truncated right after a complete fmt chunk but before any data chunk throws a descriptive 'missing data' error", () => {
  const wav = buildWav(new Int16Array([1, 2, 3, 4]));
  const truncated = wav.subarray(0, 36); // fmt chunk fully present, data chunk header never starts
  assert.throws(() => parseWavPcm16(truncated), /Missing data chunk/);
});

test("8. silent audio: an all-zero sample buffer produces an all-zero peaks array without crashing (no division-by-zero, no NaN)", () => {
  const silence = new Int16Array(16000 * 2); // 2s of digital silence
  const wav = buildWav(silence);
  const result = computeWaveformFromWav(wav);
  assert.ok(result.peaks.length > 0);
  for (const p of result.peaks) assert.equal(p, 0);
});

test("very short audio: sub-one-bucket-length audio still produces at least one peak, never an empty/broken array", () => {
  const samples = sineWave(0.05, 16000, 440, 10000); // 50ms — much shorter than one 10ms-ish bucket at 100 peaks/sec
  const wav = buildWav(samples);
  const result = computeWaveformFromWav(wav);
  assert.ok(result.peaks.length >= 1);
  assert.ok(result.peaks[0] > 0);
});

test("computePeaks on a truly empty sample array returns an empty (not crashed) result with zero duration", () => {
  const result = computePeaks(new Int16Array(0), 16000, DEFAULT_PEAKS_PER_SECOND);
  assert.equal(result.peaks.length, 0);
  assert.equal(result.duration, 0);
});

test("9. long-duration handling: a 60-minute equivalent sample count produces a bounded, correctly-sized peaks array quickly", () => {
  const sampleRate = 16000;
  const seconds = 60 * 60; // 60 minutes
  const totalSamples = sampleRate * seconds;
  // A real Int16Array this large (115.2M samples) is fine to allocate for a test — this proves
  // the peak computation itself is a single linear pass, not something that blows up
  // super-linearly with duration. Filled with a cheap repeating pattern rather than a real sine
  // computation for every sample, to keep the test itself fast; the peak-detection code path
  // being exercised doesn't care what the samples represent.
  const samples = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i += sampleRate) samples[i] = 12345; // one clear peak per second
  const start = Date.now();
  const result = computePeaks(samples, sampleRate, DEFAULT_PEAKS_PER_SECOND);
  const elapsedMs = Date.now() - start;

  const expectedBucketCount = Math.ceil(totalSamples / Math.round(sampleRate / DEFAULT_PEAKS_PER_SECOND));
  assert.equal(result.peaks.length, expectedBucketCount);
  assert.ok(Math.abs(result.duration - seconds) < 1);
  // Not a hard performance SLA, just a sanity bound that this stays a fast, linear operation —
  // a real 60-minute file's peak computation happens once (cached afterward, see the /waveform
  // route), so even a generous ceiling here is far better than what production needs.
  assert.ok(elapsedMs < 5000, `expected well under 5s for a 60-minute sample count, took ${elapsedMs}ms`);
});

test("encodeWaveform/decodeWaveform round-trip preserves peaks exactly", () => {
  const samples = sineWave(1, 16000, 300, 25000);
  const wav = buildWav(samples);
  const original = computeWaveformFromWav(wav);
  const roundTripped = decodeWaveform(encodeWaveform(original));
  assert.deepEqual(Array.from(roundTripped.peaks), Array.from(original.peaks));
  assert.equal(roundTripped.peaksPerSecond, original.peaksPerSecond);
  assert.equal(roundTripped.duration, original.duration);
});

test("a stereo file is downmixed to mono rather than misread as twice as many mono samples", () => {
  // Left channel loud, right channel silent — averaging must produce a clearly non-zero,
  // non-doubled result, not garbage from reading interleaved stereo as if it were mono.
  const frames = 16000; // 1 second
  const interleaved = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    interleaved[i * 2] = 20000; // left
    interleaved[i * 2 + 1] = 0; // right
  }
  const wav = buildWav(interleaved, 16000, 2);
  const result = computeWaveformFromWav(wav);
  assert.ok(Math.abs(result.duration - 1) < 0.01);
  const maxPeak = Math.max(...result.peaks);
  // Averaged (20000 + 0) / 2 = 10000 -> normalized ~78/255, clearly present but not full-scale.
  assert.ok(maxPeak > 50 && maxPeak < 150, `expected a downmixed mid-range peak, got ${maxPeak}`);
});
