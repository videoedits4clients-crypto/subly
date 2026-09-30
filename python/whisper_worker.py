"""
Local transcription sidecar for SUBLY's desktop build.

Runs faster-whisper (CTranslate2, CPU/int8 by default — see section 5/21 of the
desktop spec: GPU is never auto-selected) as a long-lived process so the model
loads once and stays warm across many transcription requests, instead of
paying the ~30-60s model-load cost on every video. Communicates with the
Electron main process over stdin/stdout using line-delimited JSON — no HTTP
server, no extra port to manage.

Protocol (one JSON object per line):
  Node -> Python:
    {"cmd":"load","id":"1","model":"small","device":"cpu","computeType":"int8","modelDir":"C:/.../models","cpuThreads":4}
    {"cmd":"transcribe","id":"2","audioPath":"C:/.../audio.wav","language":null}
    {"cmd":"cancel","id":"2"}
  Python -> Node:
    {"type":"ready","id":"1"}
    {"type":"progress","id":"2","percent":42}
    {"type":"result","id":"2","data":{"language":"en","words":[...],"segments":[...],"fullText":"..."}}
    {"type":"error","id":"2","message":"..."}
    {"type":"model-download-progress","percent":37}

Never touches the GPU: `device` defaults to "cpu" and this script does not
call anything that would implicitly initialize CUDA.
"""
import sys
import json
import threading

_model = None
_model_lock = threading.Lock()
_cancel_flags = set()
# id of the transcription currently running on the background thread (see main()) — guards
# against a second "transcribe" overlapping the first if the caller ever misbehaves; None when
# idle. Plain attribute reads/writes are safe here under the GIL for this single-writer-at-a-
# time usage (only main() sets it, only the worker thread clears it).
_active_transcribe_id = None

# faster-whisper model repos on the Hub, keyed by the short names SUBLY's UI
# offers (see section 6 of the desktop spec) — avoids downloading every size.
MODEL_REPOS = {
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3": "Systran/faster-whisper-large-v3",
    "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def make_progress_tqdm(req_id):
    """A tqdm subclass that also relays byte-level download progress over the
    pipe, so the desktop UI can show a real percentage/downloaded-of-total
    instead of an indeterminate spinner (section 7 of the desktop spec)."""
    from tqdm.auto import tqdm as base_tqdm

    class PipeTqdm(base_tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._last_emit = 0

        def update(self, n=1):
            super().update(n)
            # total is None for some auxiliary files (e.g. small config jsons) —
            # only report percentage for the real weighted transfers.
            if self.total:
                percent = min(100, round((self.n / self.total) * 100))
                if percent != self._last_emit:
                    self._last_emit = percent
                    emit({
                        "type": "model-download-progress",
                        "id": req_id,
                        "percent": percent,
                        "downloadedBytes": self.n,
                        "totalBytes": self.total,
                    })

    return PipeTqdm


def model_is_cached(model_name, model_dir):
    from huggingface_hub import try_to_load_from_cache

    repo = MODEL_REPOS.get(model_name, model_name)
    # model.bin is the actual weights file — if it resolves to a real cached
    # path (not a cache "miss" sentinel), the model doesn't need downloading.
    hit = try_to_load_from_cache(repo, "model.bin", cache_dir=model_dir)
    return isinstance(hit, str)


def ensure_model(req):
    """Downloads the model into modelDir if not already cached, with real
    progress relayed over the pipe. Safe to call even when already cached —
    huggingface_hub no-ops (fast local check) in that case."""
    req_id = req["id"]
    model_name = req.get("model", "small")
    model_dir = req.get("modelDir")
    repo = MODEL_REPOS.get(model_name, model_name)

    try:
        already_cached = model_is_cached(model_name, model_dir)
        if not already_cached:
            emit({"type": "model-download-progress", "id": req_id, "percent": 0, "status": "starting"})

        from huggingface_hub import snapshot_download

        # This docstring has always claimed "huggingface_hub no-ops (fast local check)" when
        # already cached, but nothing enforced that: without local_files_only, snapshot_download
        # still reaches out to huggingface.co (an etag/metadata check) before falling back to the
        # cache on failure — confirmed against huggingface_hub's own behavior, not assumed. For
        # SUBLY (local-first, no-account desktop transcription) that means every single
        # transcription of an already-fully-cached model attempted a network call first, silently
        # relying on it failing fast. Passing local_files_only once the cache hit is confirmed
        # makes this call genuinely offline, matching what this function already claimed to do.
        snapshot_download(
            repo,
            cache_dir=model_dir,
            tqdm_class=make_progress_tqdm(req_id),
            local_files_only=already_cached,
        )
        emit({"type": "model-ready", "id": req_id, "alreadyCached": already_cached})
    except Exception as e:  # noqa: BLE001 — network failure, disk full, corrupted cache, etc.
        emit({"type": "error", "id": req_id, "message": f"Model download failed: {e}"})


def load_model(req):
    global _model
    from faster_whisper import WhisperModel

    model_name = req.get("model", "small")
    device = req.get("device", "cpu")  # never default to "cuda" — see module docstring
    compute_type = req.get("computeType", "int8")
    model_dir = req.get("modelDir")
    cpu_threads = req.get("cpuThreads", 0)  # 0 = let CTranslate2 pick a sensible default

    with _model_lock:
        _model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            download_root=model_dir,
            cpu_threads=cpu_threads or 0,
        )
    emit({"type": "ready", "id": req["id"]})


def transcribe(req):
    global _active_transcribe_id
    req_id = req["id"]
    if _model is None:
        emit({"type": "error", "id": req_id, "message": "Model not loaded yet."})
        return

    audio_path = req["audioPath"]
    language = req.get("language") or None

    try:
        segments_iter, info = _model.transcribe(
            audio_path,
            word_timestamps=True,
            language=language,
            vad_filter=True,  # skip long silences — also gives cleaner segment boundaries
        )

        duration = info.duration or 1.0
        segments = []
        words = []
        full_text_parts = []

        for seg in segments_iter:
            if req_id in _cancel_flags:
                emit({"type": "error", "id": req_id, "message": "Cancelled."})
                _cancel_flags.discard(req_id)
                return

            full_text_parts.append(seg.text.strip())
            segments.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
            for w in seg.words or []:
                words.append({
                    "text": w.word.strip(),
                    "start": w.start,
                    "end": w.end,
                    "confidence": round(w.probability, 3),
                })
            percent = min(99, round((seg.end / duration) * 100))
            emit({"type": "progress", "id": req_id, "percent": percent})

        emit({
            "type": "result",
            "id": req_id,
            "data": {
                "language": info.language,
                "languageProbability": round(info.language_probability, 3),
                "fullText": " ".join(full_text_parts),
                "segments": segments,
                "words": words,
            },
        })
    except Exception as e:  # noqa: BLE001 — must always report back over the pipe, never crash silently
        emit({"type": "error", "id": req_id, "message": str(e)})
    finally:
        _active_transcribe_id = None


def main():
    global _active_transcribe_id
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        cmd = req.get("cmd")
        if cmd == "ensure_model":
            ensure_model(req)
        elif cmd == "load":
            try:
                load_model(req)
            except Exception as e:  # noqa: BLE001
                emit({"type": "error", "id": req.get("id"), "message": f"Model load failed: {e}"})
        elif cmd == "transcribe":
            # Dispatched on a background thread rather than run inline: this loop is the ONLY
            # thing reading stdin, so if transcribe() ran here directly, a "cancel" sent by
            # Node while decoding is in progress would sit unread in the pipe until transcribe()
            # returned on its own — i.e. cancellation could never actually interrupt a running
            # transcription (confirmed by reproducing it: cancel was requested but progress kept
            # advancing to completion regardless). Running it on its own thread lets this loop
            # keep reading and add to _cancel_flags — checked between segments by transcribe()
            # itself — while decoding is still underway.
            # Still one transcription at a time per sidecar process (matching one video
            # processing at a time in the existing pipeline) — reject a second overlapping
            # request outright rather than silently interleave two decodes.
            if _active_transcribe_id is not None:
                emit({"type": "error", "id": req.get("id"), "message": "Another transcription is already running."})
            else:
                _active_transcribe_id = req.get("id")
                threading.Thread(target=transcribe, args=(req,), daemon=True).start()
        elif cmd == "cancel":
            _cancel_flags.add(req.get("id"))
        elif cmd == "ping":
            emit({"type": "pong", "id": req.get("id")})


if __name__ == "__main__":
    main()
