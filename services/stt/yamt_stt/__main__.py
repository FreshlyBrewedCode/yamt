"""One batch: read the request from stdin, load the model once, transcribe every item, exit.

    python -m yamt_stt [--backend whisper|stub] < request.json

The protocol is in protocol.py. A broken item fails on its own (`result` with `ok: false`); a
model that can't be loaded is `fatal` for the whole batch (exit 1). The process lowers its own
priority and is capped at `threads` threads, so the VM stays responsive while it works; it holds
the model (~1.7 GB) only while it runs.
"""

import argparse
import os
import sys
import time
import traceback

from .audio import AudioError, read_wav
from .protocol import Events, RequestError, Settings, parse_request


def make_backend(kind: str, settings: Settings, events: Events):
    from .backends import StubBackend, WhisperBackend

    if kind == "stub":
        return StubBackend(settings)
    return WhisperBackend(settings, events)


def run(stdin: str, events: Events, backend_kind: str = "whisper") -> int:
    try:
        settings, items = parse_request(stdin)
    except RequestError as e:
        events.emit("fatal", error=str(e))
        return 1
    # before numpy/ctranslate2 spin up their thread pools
    os.environ.setdefault("OMP_NUM_THREADS", str(settings.threads))
    if settings.models_dir:
        os.environ.setdefault("HF_HOME", os.path.join(settings.models_dir, ".hf"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

    backend = make_backend(backend_kind, settings, events)
    started = time.monotonic()
    try:
        backend.load()
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        events.emit("fatal", error=f"loading {settings.model} failed: {type(e).__name__}: {e}")
        return 1
    events.emit("loaded", model=backend.name, loadMs=round((time.monotonic() - started) * 1000))

    for item in items:
        t0 = time.monotonic()
        try:
            audio = read_wav(item.path)
            duration_ms = round(len(audio) / 16)

            def progress(pos: int, item_id: str = item.id, total: int = duration_ms) -> None:
                events.emit("progress", id=item_id, positionMs=pos, durationMs=total)

            t = backend.transcribe(audio, progress)
        except AudioError as e:
            events.emit("result", id=item.id, ok=False, error=str(e))
            continue
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            events.emit("result", id=item.id, ok=False, error=f"{type(e).__name__}: {e}")
            continue
        events.emit(
            "result",
            id=item.id,
            ok=True,
            text=t.text,
            language=t.language,
            durationMs=t.duration_ms,
            segments=[{"startMs": s.start_ms, "endMs": s.end_ms, "text": s.text} for s in t.segments],
            model=backend.name,
            elapsedMs=round((time.monotonic() - t0) * 1000),
        )
    events.emit("end")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="yamt_stt", description=__doc__.split("\n\n")[0])
    ap.add_argument("--backend", choices=["whisper", "stub"], default="whisper")
    args = ap.parse_args()
    try:
        os.nice(10)
    except OSError:
        pass
    return run(sys.stdin.read(), Events(), args.backend)


if __name__ == "__main__":
    sys.exit(main())
