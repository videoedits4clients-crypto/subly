// A stand-in worker for the FAILURE paths of local-whisper-sidecar.ts (P23.1). The scenario comes from the environment of the
// spawned process (SUBLY_FAKE_SCENARIO) and, where a worker has to behave differently on its first and second call (Retry),
// from a counter file (SUBLY_FAKE_COUNTER).
//
//   ensure-model-fails   ensure_model → { error: "Model download failed: …" }              (no internet / blocked Hugging Face)
//   load-fails-once      load fails the FIRST time ("Model load failed: …"), succeeds afterwards (a Retry that must really retry)
//   crash-on-transcribe  writes to stderr, then exits with code 3 when asked to transcribe
//   crash-on-start       writes to stderr and exits with code 7 before answering anything
//   garbage-result       answers transcribe with a "result" that is not a transcription
//   ok                   a normal worker
const fs = require("fs");
const readline = require("readline");

const scenario = process.env.SUBLY_FAKE_SCENARIO || "ok";
const counterFile = process.env.SUBLY_FAKE_COUNTER;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function bump(name) {
  if (!counterFile) return 1;
  let counts = {};
  try {
    counts = JSON.parse(fs.readFileSync(counterFile, "utf8"));
  } catch {
    // first call
  }
  counts[name] = (counts[name] || 0) + 1;
  fs.writeFileSync(counterFile, JSON.stringify(counts));
  return counts[name];
}

if (scenario === "crash-on-start") {
  process.stderr.write("Traceback (most recent call last):\n  File \"whisper_worker.py\", line 1\nImportError: DLL load failed while importing ctranslate2\n");
  process.exit(7);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.cmd === "ensure_model") {
    bump("ensure_model");
    if (scenario === "ensure-model-fails") {
      emit({ type: "error", id: req.id, message: "Model download failed: Got: ConnectError: [WinError 10061] No connection could be made" });
    } else {
      emit({ type: "model-ready", id: req.id, alreadyCached: true });
    }
  } else if (req.cmd === "load") {
    const n = bump("load");
    if (scenario === "load-fails-once" && n === 1) emit({ type: "error", id: req.id, message: "Model load failed: could not open model.bin" });
    else emit({ type: "ready", id: req.id });
  } else if (req.cmd === "transcribe") {
    bump("transcribe");
    if (scenario === "crash-on-transcribe") {
      process.stderr.write("RuntimeError: CUDA/CPU kernel failed\n".repeat(3));
      process.exit(3);
    }
    if (scenario === "garbage-result") {
      emit({ type: "result", id: req.id, data: { nothing: "useful" } });
      return;
    }
    emit({
      type: "result",
      id: req.id,
      data: { language: "en", languageProbability: 0.99, fullText: "hello", segments: [{ start: 0, end: 1, text: "hello" }], words: [{ text: "hello", start: 0, end: 1, confidence: 0.9 }] },
    });
  }
});
