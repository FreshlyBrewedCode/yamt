"""Shared helpers for the phase-1 German STT harness: text normalisation, WER, resource
measurement and the fixture layout under OUT (default /tmp/yamt-stt).
"""
import json
import os
import re
import resource
import threading
import time
from dataclasses import dataclass, asdict
from pathlib import Path

import jiwer

OUT = Path(os.environ.get("YAMT_STT_OUT", "/tmp/yamt-stt"))
AUDIO_DIR = OUT / "audio"
RESULTS_DIR = OUT / "results"
MODELS_DIR = OUT / "models"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# German-aware normalisation: lowercase, expand ß, drop punctuation, collapse whitespace.
# Numbers are NOT expanded to words (and vice versa): that mismatch is noted as a gotcha,
# not silently normalised away, since it's a real accuracy difference between models.
_PUNCT_RE = re.compile(r"[.,!?;:\"'„“”‚‘’()\[\]{}«»\-–—/]")
_WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    text = text.strip().lower()
    text = text.replace("ß", "ss")
    text = _PUNCT_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def wer(reference: str, hypothesis: str) -> float:
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    return jiwer.wer(ref, hyp)


def wer_or_none(reference: str | None, hypothesis: str) -> float | None:
    """Like wer(), but None when there is no reference at all (phase 2: a memo without a
    corrected transcript yet) rather than scoring it as 100% wrong."""
    if not reference:
        return None
    return wer(reference, hypothesis)


def load_utterances() -> list[dict]:
    return json.loads((AUDIO_DIR / "utterances.json").read_text())


def load_long_files() -> list[dict]:
    return json.loads((AUDIO_DIR / "long.json").read_text())


@dataclass
class RunStats:
    wall_s: float
    peak_rss_mb: float
    cpu_percent_avg: float | None = None


class ResourceSampler:
    """Samples this process' (+ children's) RSS and CPU% in the background while a block runs.

    Peak RSS comes from getrusage (includes children reaped so far) and from periodic sampling
    of the live process tree (psutil), since getrusage only reflects a child after it exits.
    """

    def __init__(self, interval: float = 0.25):
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.peak_rss_mb = 0.0
        self.cpu_samples: list[float] = []

    def __enter__(self):
        self._t0 = time.perf_counter()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        self.wall_s = time.perf_counter() - self._t0
        # also fold in getrusage's view (covers short-lived children already reaped)
        ru = resource.getrusage(resource.RUSAGE_SELF)
        ru_children = resource.getrusage(resource.RUSAGE_CHILDREN)
        # ru_maxrss is KB on Linux
        self.peak_rss_mb = max(self.peak_rss_mb, (ru.ru_maxrss + ru_children.ru_maxrss) / 1024)
        return False

    def _run(self):
        try:
            import psutil
            proc = psutil.Process()
            proc.cpu_percent(None)  # prime
            while not self._stop.is_set():
                try:
                    rss = proc.memory_info().rss
                    for child in proc.children(recursive=True):
                        try:
                            rss += child.memory_info().rss
                        except Exception:
                            pass
                    self.peak_rss_mb = max(self.peak_rss_mb, rss / 2**20)
                    self.cpu_samples.append(proc.cpu_percent(None))
                except Exception:
                    pass
                time.sleep(self.interval)
        except ImportError:
            pass

    def stats(self) -> RunStats:
        avg_cpu = sum(self.cpu_samples) / len(self.cpu_samples) if self.cpu_samples else None
        return RunStats(wall_s=self.wall_s, peak_rss_mb=self.peak_rss_mb, cpu_percent_avg=avg_cpu)


def dir_size_mb(path: Path) -> float:
    """Total size, counting each inode once (huggingface_hub's cache hardlinks a model's
    snapshot files to its shared blobs/ store, so a naive walk double-counts them)."""
    total = 0
    if path.is_file():
        return path.stat().st_size / 2**20
    seen_inodes: set[tuple[int, int]] = set()
    for root, _, files in os.walk(path):
        for f in files:
            try:
                st = os.lstat(os.path.join(root, f))
                key = (st.st_dev, st.st_ino)
                if key in seen_inodes:
                    continue
                seen_inodes.add(key)
                total += st.st_size
            except OSError:
                pass
    return total / 2**20


def save_result(name: str, data: dict) -> Path:
    p = RESULTS_DIR / f"{name}.json"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=lambda o: asdict(o) if hasattr(o, "__dataclass_fields__") else str(o)))
    print(f"wrote {p}")
    return p
