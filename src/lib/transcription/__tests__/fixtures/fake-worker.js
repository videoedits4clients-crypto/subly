// A minimal stand-in for python/whisper_worker.py's wire protocol, used to test
// local-whisper-sidecar.ts's progress/cancel/stall handling without needing a real
// faster-whisper install. Spawned via `node fake-worker.js` (see cancellation.test.ts,
// which points SUBLY_PYTHON_BIN at `process.execPath` and SUBLY_WHISPER_SCRIPT at this file).
//
// Behavior, controlled by the `audioPath` field of the "transcribe" command (repurposed here
// as a scenario selector since the real field is meaningless to this fake worker):
//   "progress-then-result" -> emits progress 25/50/75 then a result
//   "wait-for-cancel"      -> emits one progress event, then waits for a "cancel" for this id
//                             before ever responding (mirrors the real worker's per-segment
//                             cancel check)
//   "ignore-cancel"        -> emits one progress event, then never responds again regardless of
//                             any "cancel" sent for it — simulates the real worker being deep
//                             inside a single long decode chunk where the cooperative
//                             _cancel_flags check has no opportunity to run (see
//                             local-whisper-sidecar.ts's cancelGraceMs escalation, which this
//                             is meant to exercise)
//   "never-respond"        -> emits nothing at all after "load" — exercises the stall watchdog
//
// "ensure_model" always hangs (never responds) regardless of input — used to test cancellation
// during the model-download/loading phase (see local-provider.ts's onRequestId threading into
// ensureModelDownloaded). No existing test needs ensure_model to actually complete.
const readline = require("readline");

const cancelled = new Set();
const rl = readline.createInterface({ input: process.stdin });

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.cmd === "load") {
    emit({ type: "ready", id: req.id });
  } else if (req.cmd === "ensure_model") {
    // deliberately never responds — see module doc comment above
  } else if (req.cmd === "cancel") {
    cancelled.add(req.id);
  } else if (req.cmd === "transcribe") {
    const scenario = req.audioPath;
    if (scenario === "never-respond" || scenario === "ignore-cancel") {
      if (scenario === "ignore-cancel") emit({ type: "progress", id: req.id, percent: 5 });
      return;
    }
    if (scenario === "wait-for-cancel") {
      emit({ type: "progress", id: req.id, percent: 10 });
      const check = setInterval(() => {
        if (cancelled.has(req.id)) {
          clearInterval(check);
          cancelled.delete(req.id);
          emit({ type: "error", id: req.id, message: "Cancelled." });
        }
      }, 20);
      return;
    }
    // default: progress-then-result
    let percent = 25;
    const tick = setInterval(() => {
      if (percent <= 75) {
        emit({ type: "progress", id: req.id, percent });
        percent += 25;
      } else {
        clearInterval(tick);
        emit({
          type: "result",
          id: req.id,
          data: { language: "en", languageProbability: 0.99, fullText: "hello", segments: [], words: [] },
        });
      }
    }, 15);
  }
});
