/**
 * P23.1 — the local diagnostics log: useful for support, safe to share, and never able to break transcription.
 *
 * Run with: node --test src/lib/__tests__/diagnostics.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { logDiagnostic, sanitize, sanitizeTail, transcriptionLogPath } from "../diagnostics.ts";

const savedEnv = { log: process.env.SUBLY_LOG_DIR, data: process.env.SUBLY_DATA_DIR, ver: process.env.SUBLY_APP_VERSION };
test.after(() => {
  for (const [k, v] of [["SUBLY_LOG_DIR", savedEnv.log], ["SUBLY_DATA_DIR", savedEnv.data], ["SUBLY_APP_VERSION", savedEnv.ver]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("1. entries are JSON lines with a timestamp and the app version", () => {
  process.env.SUBLY_LOG_DIR = path.join(mkdtempSync(path.join(os.tmpdir(), "subly-diag-")), "logs");
  process.env.SUBLY_APP_VERSION = "9.9.9";
  logDiagnostic({ event: "transcription-failed", code: "WORKER_CRASHED", stage: "transcribe", exitCode: 3 });
  logDiagnostic({ event: "transcription-start", language: "hi" });
  const lines = readFileSync(transcriptionLogPath(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].code, "WORKER_CRASHED");
  assert.equal(lines[0].appVersion, "9.9.9");
  assert.ok(!Number.isNaN(Date.parse(lines[0].ts)));
});

test("2. a log that cannot be written never throws (logging must not break transcription)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "subly-diag-"));
  const asFile = path.join(dir, "not-a-dir");
  writeFileSync(asFile, "x");
  process.env.SUBLY_LOG_DIR = path.join(asFile, "logs"); // parent is a file → mkdir fails
  assert.doesNotThrow(() => logDiagnostic({ event: "x" }));
});

test("3. the log rotates past 1 MB instead of growing forever", () => {
  process.env.SUBLY_LOG_DIR = path.join(mkdtempSync(path.join(os.tmpdir(), "subly-diag-")), "logs");
  logDiagnostic({ event: "first" });
  const file = transcriptionLogPath();
  writeFileSync(file, "x".repeat(1_100_000));
  logDiagnostic({ event: "after-rotation" });
  assert.ok(existsSync(`${file}.1`));
  assert.match(readFileSync(file, "utf8"), /after-rotation/);
  assert.ok(readFileSync(file, "utf8").length < 1000);
});

test("4. sanitize removes the user's home dir, the data dir and any other absolute path / file name", () => {
  process.env.SUBLY_DATA_DIR = "D:\\Subly Data";
  const s = sanitize(
    `failed ${path.join(os.homedir(), "Videos", "My Secret Client Cut.mp4")} and D:\\Subly Data\\uploads\\a.wav and C:\\Users\\Jane Doe\\Desktop\\x.mov and /home/jane/clip.mkv`,
  );
  assert.doesNotMatch(s, new RegExp(os.homedir().replace(/\\/g, "\\\\").replace(/[.*+?^${}()|[\]]/g, "\\$&")));
  assert.doesNotMatch(s, /Jane|Secret|Client|Subly Data/);
  assert.match(s, /<data>/);
  assert.match(s, /\.mov/); // only the extension survives
});

test("5. sanitizeTail keeps only the last N characters, sanitised", () => {
  const text = "A".repeat(5000) + " C:\\Users\\Jane\\a.wav end";
  const tail = sanitizeTail(text, 100)!;
  assert.ok(tail.length <= 100);
  assert.match(tail, /end$/);
  assert.doesNotMatch(tail, /Jane/);
  assert.equal(sanitizeTail(undefined), undefined);
  assert.equal(sanitizeTail(""), undefined);
});

test("6. the pipeline logs structured metadata only — never the transcript text or the video's file name", () => {
  const src = readFileSync(path.join(import.meta.dirname, "..", "pipeline.ts"), "utf8");
  const calls = src.match(/logDiagnostic\(\{[\s\S]*?\}\);/g) ?? [];
  assert.ok(calls.length >= 3, "start, complete and failed are all logged");
  for (const call of calls) {
    assert.doesNotMatch(call, /fullText|\.text\b|originalName|filename|fileName|videoPath/, `diagnostic call leaks content: ${call}`);
  }
});
