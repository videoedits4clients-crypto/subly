import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from "fs";
import os from "os";
import path from "path";

/**
 * A small local diagnostics log (P23.1): one JSON object per line in `<SUBLY data>/logs/transcription.log`
 * (the desktop app sets SUBLY_LOG_DIR; elsewhere the OS temp dir). It exists so that when a customer reports
 * "transcription doesn't work" we can tell WORKER from MODEL from FFMPEG from PERMISSIONS from PATH from INPUT without
 * asking them to install anything — they can attach this one file.
 *
 * What is logged: timestamps, app/worker version, the transcription stage and error code, process exit codes, the tail of the
 * worker's stderr, the model's status, durations, language and the *shape* of the input (extension, size, duration).
 * What is never logged: transcript text, the video's file name, credentials/tokens, or user-identifying path segments
 * (see sanitize()). Failure to write the log never affects transcription.
 */

const MAX_LOG_BYTES = 1_000_000; // rotate to .1 above this — keeps the newest ~1 MB twice over

export interface DiagnosticEntry {
  event: string;
  [key: string]: unknown;
}

export function logDirectory(): string {
  return process.env.SUBLY_LOG_DIR || path.join(os.tmpdir(), "subly-logs");
}

export function transcriptionLogPath(): string {
  return path.join(logDirectory(), "transcription.log");
}

/** Replaces the user's home directory and the app data directory with tokens, and reduces any other absolute path to its extension — so a log can be shared without leaking a user name or a private file name. */
export function sanitize(text: string): string {
  if (!text) return text;
  let out = text;
  const replacements: [string | undefined, string][] = [
    [process.env.SUBLY_DATA_DIR, "<data>"],
    [process.env.SUBLY_UPLOADS_DIR, "<uploads>"],
    [process.env.SUBLY_MODEL_DIR, "<models>"],
    [process.env.SUBLY_LOG_DIR, "<logs>"],
    [process.env.SUBLY_APP_DIR, "<app>"],
    [os.homedir(), "~"],
    [os.tmpdir(), "<tmp>"],
  ];
  for (const [value, token] of replacements) {
    if (!value) continue;
    for (const variant of new Set([value, value.replace(/\\/g, "/"), value.replace(/\//g, "\\")])) out = out.split(variant).join(token);
  }
  // Any remaining absolute path keeps only its extension (a file name can identify a person or a project).
  // User folders and file names contain spaces, so first match up to the first "<something>.<ext>" boundary, then fall back to
  // "up to the next whitespace" for paths without a file name.
  const bare = (m: string) => "<path>" + (/\.[A-Za-z0-9]{1,5}$/.exec(m)?.[0] ?? "");
  out = out.replace(/(?:[A-Za-z]:|~)[\\/][^"'<>|\r\n]*?\.[A-Za-z0-9]{1,5}(?=$|[\s"',;:)\]])/g, bare);
  out = out.replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g, bare);
  out = out.replace(/\/(?:Users|home)\/[^\s"')]+/g, bare);

  // The OS account name can still appear on its own (as a whole word only — "User" must not eat "Users").
  try {
    const user = os.userInfo().username;
    if (user && user.length >= 3) {
      const escaped = user.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
      out = out.replace(new RegExp("(?<![A-Za-z0-9])" + escaped + "(?![A-Za-z0-9])", "g"), "<user>");
    }
  } catch {
    // no user info available — fine
  }
  return out;
}

/** The last `maxChars` of a stderr capture, sanitised. */
export function sanitizeTail(text: string | undefined, maxChars = 2000): string | undefined {
  if (!text) return undefined;
  const tail = text.length > maxChars ? text.slice(-maxChars) : text;
  return sanitize(tail.trim());
}

export function logDiagnostic(entry: DiagnosticEntry): void {
  try {
    const file = transcriptionLogPath();
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
    const line = JSON.stringify({ ts: new Date().toISOString(), appVersion: process.env.SUBLY_APP_VERSION, ...entry });
    appendFileSync(file, line + "\n", "utf-8");
  } catch {
    // diagnostics are best-effort; never let logging break (or mask) the real operation
  }
}
