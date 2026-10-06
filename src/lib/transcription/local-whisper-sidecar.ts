import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import readline from "readline";
import { TranscriptionError, classifyTranscriptionError, type TranscriptionStage } from "./transcription-error.ts";
import { logDiagnostic } from "../diagnostics.ts";

/**
 * Manages the long-lived Python (faster-whisper) sidecar process — see
 * python/whisper_worker.py for the wire protocol. One process is spawned
 * lazily on first use and kept warm for the life of the app (model load is
 * the expensive part, ~10-60s depending on model size; re-paying that per
 * video would make local transcription feel broken).
 *
 * Two ways to launch the worker, chosen automatically:
 *   SUBLY_WHISPER_WORKER_EXE - a frozen, standalone whisper-worker.exe (PyInstaller —
 *                              see python/build-worker.* ) that needs no system Python at
 *                              all. This is what the packaged desktop build uses.
 *   SUBLY_PYTHON_BIN + SUBLY_WHISPER_SCRIPT - interpreter + script, for local development
 *                              (defaults: "python" + repo's python/whisper_worker.py).
 */

export interface LocalWhisperConfig {
  model: string; // "small" | "medium" | "large-v3" | "large-v3-turbo"
  device: "cpu"; // GPU is intentionally not offered yet — see desktop spec section 5/21
  computeType: "int8";
  modelDir: string;
  cpuThreads?: number;
}

type PendingResolver = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (percent: number) => void;
  /** Watchdog: killed and rejected if no progress/completion is seen for STALL_TIMEOUT_MS.
   * Reset on every progress event so a genuinely long (30-60 min) video never trips it as
   * long as it's still making progress — only a truly unresponsive worker does. */
  stallTimer?: ReturnType<typeof setTimeout>;
  /** Armed only by cancelTranscriptionRequest() — see its doc comment for why this exists
   * alongside the cooperative _cancel_flags check on the Python side. */
  cancelGraceTimer?: ReturnType<typeof setTimeout>;
  cancelled?: boolean;
  /** Which sidecar process (see sidecarGeneration) this entry's request was actually sent to —
   * lets that process's own "exit" handler recognize entries as its own, see ensureProcess. */
  generation: number;
  /** Which step of the pipeline this request is (for structured errors / the diagnostics log). */
  stage: TranscriptionStage;
};

/** No progress event (or completion) for this long is treated as an unresponsive worker —
 * see call()'s stall watchdog. Deliberately generous: model loading alone can take up to
 * ~60s, and this must never fire on a legitimate long video that's still progressing, only
 * on a worker that has genuinely stopped responding. Overridable via env for tests, which
 * can't afford to wait out a real 5-minute timeout. */
function stallTimeoutMs(): number {
  const override = process.env.SUBLY_WHISPER_STALL_TIMEOUT_MS;
  return override ? Number(override) : 5 * 60 * 1000;
}

/** How long to wait, after sending "cancel", for the worker's own cooperative check
 * (python/whisper_worker.py's _cancel_flags — checked between decode chunks) to actually
 * respond before escalating to a hard process kill — see cancelTranscriptionRequest.
 * Overridable via env for tests. */
function cancelGraceMs(): number {
  const override = process.env.SUBLY_WHISPER_CANCEL_GRACE_MS;
  return override ? Number(override) : 3000;
}

let sidecar: ChildProcessWithoutNullStreams | null = null;
let sidecarReadyForModel: string | null = null; // which model is currently loaded, if any
let loadPromise: Promise<void> | null = null;
const pending = new Map<string, PendingResolver>();
let nextId = 1;
/** Bumped every time ensureProcess() spawns a new process. Exists to fix a real race: killing a
 * process (stopSidecar) nulls out `sidecar` and lets a new one spawn immediately, but the OLD
 * process's own "exit" event only fires once the OS actually reports it gone — which can lag
 * behind that respawn. Without tagging which generation a pending entry belongs to, that late
 * exit event's cleanup (which iterates the single shared `pending` map) can reject/clear
 * entries that actually belong to the NEW process, and — worse — an entry whose cancelGraceTimer
 * later checks `pending.get(id) === entry` finds it already gone and skips killing the (actually
 * still-hung) new process, leaking it as a live orphan holding stdio pipes open forever. See
 * ensureProcess's "exit" handler. */
let sidecarGeneration = 0;

export class TranscriptionCancelledError extends Error {
  constructor() {
    super("Transcription cancelled.");
    this.name = "TranscriptionCancelledError";
  }
}

export class TranscriptionStalledError extends Error {
  constructor() {
    super("Transcription worker stopped responding.");
    this.name = "TranscriptionStalledError";
  }
}

function pythonBin(): string {
  return process.env.SUBLY_PYTHON_BIN || "python";
}

function workerScriptPath(): string {
  return process.env.SUBLY_WHISPER_SCRIPT || path.join(process.cwd(), "python", "whisper_worker.py");
}

/** The frozen executable takes no arguments and needs no Python — see python/build-worker.ps1. */
function frozenWorkerPath(): string | null {
  return process.env.SUBLY_WHISPER_WORKER_EXE || null;
}

/** The pipeline stage a worker command belongs to — used to classify a failure. */
function stageOf(cmd: string): TranscriptionStage {
  return cmd === "ensure_model" ? "model-prepare" : cmd === "load" ? "model-load" : "transcribe";
}

/** How much worker stderr is kept for diagnostics (the tail is what explains a crash). */
const STDERR_KEEP_CHARS = 8000;

function ensureProcess(): ChildProcessWithoutNullStreams {
  if (sidecar && !sidecar.killed) return sidecar;

  sidecarGeneration++;
  const myGeneration = sidecarGeneration;
  const frozenExe = frozenWorkerPath();
  const proc = frozenExe
    ? spawn(frozenExe, [], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn(pythonBin(), [workerScriptPath()], { stdio: ["pipe", "pipe", "pipe"] });
  const rl = readline.createInterface({ input: proc.stdout });
  let stderrTail = "";
  let spawnError: (Error & { code?: string }) | null = null;

  function settle(id: string, fn: (entry: PendingResolver) => void) {
    const entry = pending.get(id);
    if (!entry) return;
    if (entry.stallTimer) clearTimeout(entry.stallTimer);
    if (entry.cancelGraceTimer) clearTimeout(entry.cancelGraceTimer);
    pending.delete(id);
    fn(entry);
  }

  rl.on("line", (line) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // stray non-JSON output (shouldn't happen — worker only prints JSON lines)
    }
    const id = msg.id as string | undefined;
    if (!id) return;
    const entry = pending.get(id);
    if (!entry) return;

    if (msg.type === "progress" || msg.type === "model-download-progress") {
      armStallWatchdog(id, entry); // real progress just arrived — the worker is alive, push the deadline out
      entry.onProgress?.(msg.percent as number);
      return;
    }
    if (msg.type === "ready" || msg.type === "model-ready" || msg.type === "pong") {
      settle(id, (e) => e.resolve(msg));
      return;
    }
    if (msg.type === "error") {
      const message = (msg.message as string) || "Local transcription failed.";
      settle(id, (e) =>
        e.reject(
          message === "Cancelled." || e.cancelled
            ? new TranscriptionCancelledError()
            : classifyTranscriptionError(new Error(message), e.stage),
        ),
      );
      return;
    }
    if (msg.type === "result") {
      settle(id, (e) => e.resolve(msg.data));
      return;
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    // faster-whisper/huggingface_hub write informational + tqdm progress text here; the real progress signal comes over
    // stdout as JSON (see above). It is not echoed to the server log (noisy), but the TAIL is kept: when the worker dies,
    // it is the only thing that says why — it goes into the structured error and the diagnostics log.
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_KEEP_CHARS);
  });

  // A spawn that fails (the executable is missing, blocked by security software, not permitted…) emits 'error' and NO usable
  // process. Unhandled, that crashed the server or left the request hanging until the 5-minute stall watchdog — and said
  // nothing about why. stdin errors (EPIPE after a dead child) are swallowed here for the same reason.
  proc.stdin.on("error", () => {});
  proc.on("error", (err: Error & { code?: string }) => {
    spawnError = err;
    if (sidecar === proc) {
      sidecar = null;
      sidecarReadyForModel = null;
      loadPromise = null;
    }
    for (const [id, entry] of pending) {
      if (entry.generation !== myGeneration) continue;
      pending.delete(id);
      if (entry.stallTimer) clearTimeout(entry.stallTimer);
      if (entry.cancelGraceTimer) clearTimeout(entry.cancelGraceTimer);
      entry.reject(classifyTranscriptionError(err, "worker-start"));
    }
    logDiagnostic({ event: "worker-spawn-failed", stage: "worker-start", systemCode: err.code, message: err.message });
  });

  proc.on("exit", (exitCode: number | null, signal: NodeJS.Signals | null) => {
    // Only touch shared state this generation actually owns — stopSidecar() may already have
    // nulled `sidecar`/spawned a replacement before the OS gets around to reporting THIS
    // process as gone (this "exit" event is inherently async, lagging behind the kill call
    // that caused it), so `sidecar === proc` is not a reliable check here. See sidecarGeneration.
    if (sidecar === proc) {
      sidecar = null;
      sidecarReadyForModel = null;
      loadPromise = null;
    }
    for (const [id, entry] of pending) {
      if (entry.generation !== myGeneration) continue; // belongs to a different process generation — not ours to touch
      pending.delete(id);
      if (entry.stallTimer) clearTimeout(entry.stallTimer);
      if (entry.cancelGraceTimer) clearTimeout(entry.cancelGraceTimer);
      if (entry.cancelled) {
        entry.reject(new TranscriptionCancelledError());
        continue;
      }
      if (spawnError) continue; // already rejected by the 'error' handler with the real reason
      entry.reject(
        new TranscriptionError("WORKER_CRASHED", "Local transcription process exited unexpectedly.", {
          stage: entry.stage,
          details: { exitCode, signal, stderrTail },
        }),
      );
      logDiagnostic({ event: "worker-exited-unexpectedly", stage: entry.stage, exitCode, signal });
    }
  });

  sidecar = proc;
  return proc;
}

function send(proc: ChildProcessWithoutNullStreams, msg: Record<string, unknown>): void {
  // the child is gone: its 'error' / 'exit' handler rejects the request with the real reason
  if (proc.stdin.destroyed || !proc.stdin.writable) return;
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

/** (Re-)starts the stall watchdog for `id`: if no progress/completion is seen within
 * STALL_TIMEOUT_MS, the worker is presumed unresponsive — kill it (a stuck Python process
 * can't be reasoned with) and reject with TranscriptionStalledError so the caller can mark
 * the job failed and offer Retry, per the "no aggressive fixed timeout, detect lack of
 * heartbeat instead" requirement. */
function armStallWatchdog(id: string, entry: PendingResolver) {
  if (entry.stallTimer) clearTimeout(entry.stallTimer);
  entry.stallTimer = setTimeout(() => {
    pending.delete(id);
    entry.reject(new TranscriptionStalledError());
    stopSidecar(); // the process is presumed hung — kill it so the NEXT job gets a fresh one, not stuck behind this one forever
  }, stallTimeoutMs());
}

function call(cmd: string, extra: Record<string, unknown>, onProgress?: (percent: number) => void, onRequestId?: (id: string) => void): Promise<unknown> {
  const proc = ensureProcess(); // may spawn fresh and bump sidecarGeneration — read it after, not before
  const id = String(nextId++);
  onRequestId?.(id);
  return new Promise((resolve, reject) => {
    const entry: PendingResolver = { resolve, reject, onProgress, generation: sidecarGeneration, stage: stageOf(cmd) };
    pending.set(id, entry);
    armStallWatchdog(id, entry);
    send(proc, { cmd, id, ...extra });
  });
}

/** Sends the worker's cooperative "cancel" command for an in-flight request (see
 * python/whisper_worker.py's _cancel_flags — checked between decode chunks) — the preferred,
 * low-cost path, since it lets the sidecar finish cleanly and stay warm for the next job. No-op
 * quietly if the id is no longer pending (already finished/failed) or no sidecar is running —
 * cancelling a job that just completed on its own is not an error.
 *
 * CTranslate2 (the C++ engine faster-whisper decodes with) has no API to interrupt a decode
 * call already in flight — confirmed by inspecting its Python bindings (`generate()`'s only
 * concurrency option is `asynchronous`, whose result object exposes just `done()`/`result()`,
 * no `cancel()`). A decode call covers up to ~30s of audio in one blocking step, so on audio
 * with few natural pauses the cooperative check can go unobserved for a while — reproduced
 * taking up to ~70s on a real test clip. Rather than reach for anything unsafe (killing a
 * thread mid-C-call can corrupt CTranslate2's internal state), this arms a bounded grace
 * timer: if the cooperative path hasn't resolved the request within cancelGraceMs(), the
 * ENTIRE sidecar process is killed the same safe way the stall watchdog already does (a clean
 * OS-level process kill, not a thread abort) — the exit handler above sees `entry.cancelled`
 * and rejects with TranscriptionCancelledError rather than a generic "exited unexpectedly".
 * Trade-off: a cancel that needed the hard-kill path costs the next transcription a fresh
 * model load, since the warm sidecar is gone — an accepted cost for bounded responsiveness.
 */
export function cancelTranscriptionRequest(id: string): void {
  const entry = pending.get(id);
  if (!entry || !sidecar) return;
  entry.cancelled = true;
  send(sidecar, { cmd: "cancel", id });
  entry.cancelGraceTimer = setTimeout(() => {
    if (pending.get(id) === entry) stopSidecar();
  }, cancelGraceMs());
}

/** Downloads the model to `config.modelDir` if not already cached. Safe to call every time —
 * no-ops quickly when already present (matching faster-whisper's own cheap cache check), which
 * is the common case and is unaffected by `onRequestId` — cancelling a call that settles almost
 * immediately anyway has nothing meaningful to interrupt.
 * `onRequestId` lets a caller register this call for cancellation (see
 * cancelTranscriptionRequest) — needed for a first-ever, genuinely long model download to be
 * cancellable rather than a silent no-op while status is LOADING. */
export async function ensureModelDownloaded(
  config: LocalWhisperConfig,
  onProgress?: (percent: number) => void,
  onRequestId?: (id: string) => void,
): Promise<void> {
  await call("ensure_model", { model: config.model, modelDir: config.modelDir }, onProgress, onRequestId);
}

/** Loads the model into the sidecar if it isn't already the active one. Cheap no-op if
 * unchanged. `onRequestId` (see ensureModelDownloaded) is only invoked for the caller that
 * actually triggers the underlying "load" call — concurrent callers awaiting the same shared
 * `loadPromise` don't get their own id, since cancelling would cancel the one shared load for
 * all of them anyway. */
export async function ensureModelLoaded(config: LocalWhisperConfig, onRequestId?: (id: string) => void): Promise<void> {
  const key = `${config.model}:${config.device}:${config.computeType}:${config.modelDir}`;
  if (sidecarReadyForModel === key) return;
  if (!loadPromise) {
    loadPromise = call(
      "load",
      {
        model: config.model,
        device: config.device,
        computeType: config.computeType,
        modelDir: config.modelDir,
        cpuThreads: config.cpuThreads ?? 0,
      },
      undefined,
      onRequestId,
    ).then(
      () => {
        sidecarReadyForModel = key;
      },
      (err) => {
        // A FAILED load must not be remembered: this promise is shared by every later call, so a stale rejection made
        // Retry fail instantly with the old error without ever trying to load the model again.
        loadPromise = null;
        throw err;
      },
    );
  }
  await loadPromise;
}

export interface SidecarTranscription {
  language: string;
  languageProbability: number;
  fullText: string;
  segments: { start: number; end: number; text: string }[];
  words: { text: string; start: number; end: number; confidence: number }[];
}

export async function transcribeLocal(
  audioPath: string,
  language: string | undefined,
  onProgress?: (percent: number) => void,
  /** Called synchronously with the sidecar's internal request id as soon as the transcribe
   * command is sent — before this function's own promise resolves — so a caller (pipeline.ts)
   * can register it for cancellation (see cancelTranscriptionRequest) while the request is
   * still in flight. */
  onRequestId?: (id: string) => void,
): Promise<SidecarTranscription> {
  const result = await call("transcribe", { audioPath, language: language ?? null }, onProgress, onRequestId);
  return result as SidecarTranscription;
}

/** For desktop app shutdown / tests — not needed in normal long-running server operation.
 *
 * Kills the ENTIRE process tree, not just the direct child: PyInstaller's
 * --onefile bootloader on Windows launches a second, inner process to do the
 * actual work, so a plain `child.kill()` leaves that inner whisper-worker.exe
 * running as an orphan (confirmed by actually killing the outer process and
 * finding the inner one still alive in Task Manager). `taskkill /t` walks the
 * whole descendant tree; plain POSIX `kill()` has no such gap since it has no
 * such two-process pattern to begin with. */
export function stopSidecar(): void {
  if (sidecar?.pid) killProcessTree(sidecar.pid);
  sidecar = null;
  sidecarReadyForModel = null;
  loadPromise = null;
}

function killProcessTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // best-effort cleanup only — already dead is fine
  }
}
