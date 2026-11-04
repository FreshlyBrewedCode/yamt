"""Speech-to-text backends behind one small interface: load once, then transcribe arrays."""

import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np

from .audio import SAMPLE_RATE
from .protocol import Events, Settings


@dataclass
class Segment:
    start_ms: int
    end_ms: int
    text: str


@dataclass
class Transcription:
    text: str
    language: str | None
    duration_ms: int
    segments: list[Segment] = field(default_factory=list)


class Backend(Protocol):
    #: what the transcript records as its model, e.g. "faster-whisper large-v3-turbo int8"
    name: str

    def load(self) -> None: ...

    def transcribe(self, audio: np.ndarray, on_progress: Callable[[int], None]) -> Transcription:
        """`on_progress(position_ms)` after every segment."""
        ...


class StubBackend:
    """For tests: no model. Says how long the audio was and whether it was silent."""

    name = "stub"

    def __init__(self, settings: Settings):
        self.settings = settings

    def load(self) -> None:
        pass

    def transcribe(self, audio: np.ndarray, on_progress: Callable[[int], None]) -> Transcription:
        duration_ms = round(len(audio) * 1000 / SAMPLE_RATE)
        peak = float(np.abs(audio).max()) if len(audio) else 0.0
        text = f"stub transcript, {duration_ms} ms, peak {peak:.2f}" if peak > 0 else ""
        on_progress(duration_ms)
        return Transcription(
            text=text,
            language=self.settings.language,
            duration_ms=duration_ms,
            segments=[Segment(0, duration_ms, text)] if text else [],
        )


class WhisperBackend:
    """faster-whisper (CTranslate2) on the CPU, the setup spike #4 picked: large-v3-turbo, int8, `de`.

    Long files need no chunking of ours: Whisper decodes 30 s windows and, with timestamps on,
    moves each window to the end of the last complete segment, so no word is cut at a boundary.
    VAD filtering (Silero) drops silence first, where Whisper would otherwise hallucinate.
    """

    def __init__(self, settings: Settings, events: Events):
        self.settings = settings
        self.events = events
        self.name = f"faster-whisper {settings.model} {settings.compute_type}"
        self.model = None

    def load(self) -> None:
        from faster_whisper import WhisperModel

        path = ensure_model(self.settings, self.events)
        self.model = WhisperModel(
            path, device="cpu", compute_type=self.settings.compute_type, cpu_threads=self.settings.threads
        )

    def transcribe(self, audio: np.ndarray, on_progress: Callable[[int], None]) -> Transcription:
        assert self.model is not None, "load() first"
        s = self.settings
        segments, info = self.model.transcribe(
            audio,
            language=s.language,
            beam_size=s.beam_size,
            vad_filter=s.vad,
            initial_prompt=s.initial_prompt,
            # a hallucinated phrase must not feed the next window (spike #4 setting)
            condition_on_previous_text=False,
        )
        out: list[Segment] = []
        for seg in segments:  # a generator: decoding happens while iterating
            text = seg.text.strip()
            if text:
                out.append(Segment(round(seg.start * 1000), round(seg.end * 1000), text))
            on_progress(round(seg.end * 1000))
        return Transcription(
            text=" ".join(x.text for x in out),
            language=info.language,
            duration_ms=round(info.duration * 1000),
            segments=out,
        )


def ensure_model(settings: Settings, events: Events) -> str:
    """The model's local path; downloads it into `modelsDir` first if needed, reporting progress
    (large-v3-turbo is ~1.6 GB, minutes on a slow link), so a first-run delay isn't a mystery."""
    from faster_whisper.utils import download_model

    cache = settings.models_dir
    if cache:
        Path(cache).mkdir(parents=True, exist_ok=True)
    if os.path.isdir(settings.model):  # a local CTranslate2 model dir
        events.emit("model", state="cached", model=settings.model, dir=settings.model)
        return settings.model
    try:
        path = download_model(settings.model, cache_dir=cache, local_files_only=True)
        events.emit("model", state="cached", model=settings.model, dir=path)
        return path
    except Exception:  # not in the cache (huggingface_hub raises various errors for that)
        pass
    events.emit("model", state="downloading", model=settings.model, dir=cache)
    stop = threading.Event()

    def report() -> None:
        while not stop.wait(5):
            events.emit("download", bytes=dir_bytes(Path(cache)) if cache else None)

    t = threading.Thread(target=report, daemon=True)
    t.start()
    started = time.monotonic()
    try:
        path = download_model(settings.model, cache_dir=cache)
    finally:
        stop.set()
        t.join(timeout=1)
    events.emit(
        "download",
        bytes=dir_bytes(Path(cache)) if cache else None,
        done=True,
        elapsedMs=round((time.monotonic() - started) * 1000),
    )
    return path


def dir_bytes(path: Path) -> int:
    """Bytes under `path`, each inode once (the HF cache hardlinks/symlinks snapshots to blobs)."""
    seen: set[tuple[int, int]] = set()
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                st = os.lstat(os.path.join(root, f))
            except OSError:
                continue
            if (st.st_dev, st.st_ino) not in seen and not os.path.islink(os.path.join(root, f)):
                seen.add((st.st_dev, st.st_ino))
                total += st.st_size
    return total
