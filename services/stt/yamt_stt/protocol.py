"""The request the server sends on stdin and the NDJSON events this process answers with.

Request (one JSON object):
    {"settings": {"model": "large-v3-turbo", "computeType": "int8", "threads": 4, "beamSize": 1,
                  "vad": true, "language": "de", "initialPrompt": null, "modelsDir": "/…/models"},
     "items": [{"id": "<capture id>", "path": "/tmp/…/<capture id>.wav"}]}

Events (one JSON object per stdout line, flushed at once):
    {"event": "model", "state": "cached" | "downloading", "model": …, "dir": …}
    {"event": "download", "bytes": n}                    every few seconds while downloading
    {"event": "loaded", "model": "<name>", "loadMs": n}
    {"event": "progress", "id": …, "positionMs": n, "durationMs": n}
    {"event": "result", "id": …, "ok": true, "text": …, "language": …, "durationMs": n,
     "segments": [{"startMs", "endMs", "text"}], "model": …, "elapsedMs": n}
    {"event": "result", "id": …, "ok": false, "error": …}
    {"event": "fatal", "error": …}                       nothing more follows; exit code 1
    {"event": "end"}
"""

import json
import sys
from dataclasses import dataclass
from typing import Any, TextIO


class RequestError(Exception):
    pass


@dataclass(frozen=True)
class Settings:
    model: str = "large-v3-turbo"
    compute_type: str = "int8"
    threads: int = 4
    beam_size: int = 1
    vad: bool = True
    language: str = "de"
    initial_prompt: str | None = None
    models_dir: str | None = None


@dataclass(frozen=True)
class Item:
    id: str
    path: str


def _get(d: dict[str, Any], key: str, kind: type | tuple[type, ...], default: Any) -> Any:
    v = d.get(key, default)
    if v is None:
        return default
    # bool is an int in Python: don't let `true` pass as a thread count
    if not isinstance(v, kind) or (kind is int and isinstance(v, bool)):
        raise RequestError(f"settings.{key}: expected {getattr(kind, '__name__', kind)}, got {v!r}")
    return v


def parse_request(raw: str) -> tuple[Settings, list[Item]]:
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RequestError(f"the request is not JSON: {e}") from e
    if not isinstance(req, dict):
        raise RequestError("the request must be a JSON object")
    s = req.get("settings") or {}
    if not isinstance(s, dict):
        raise RequestError("settings: expected an object")
    d = Settings()
    settings = Settings(
        model=_get(s, "model", str, d.model),
        compute_type=_get(s, "computeType", str, d.compute_type),
        threads=_get(s, "threads", int, d.threads),
        beam_size=_get(s, "beamSize", int, d.beam_size),
        vad=_get(s, "vad", bool, d.vad),
        language=_get(s, "language", str, d.language),
        initial_prompt=_get(s, "initialPrompt", str, None) or None,
        models_dir=_get(s, "modelsDir", str, None),
    )
    if settings.threads < 1 or settings.beam_size < 1:
        raise RequestError("settings: threads and beamSize must be at least 1")
    items_raw = req.get("items")
    if not isinstance(items_raw, list):
        raise RequestError("items: expected a list")
    items: list[Item] = []
    for i, it in enumerate(items_raw):
        if (
            not isinstance(it, dict)
            or not isinstance(it.get("id"), str)
            or not isinstance(it.get("path"), str)
        ):
            raise RequestError(f"items[{i}]: expected {{id, path}} strings")
        items.append(Item(id=it["id"], path=it["path"]))
    return settings, items


class Events:
    """Writes events to stdout (or another stream), one line each, flushed immediately."""

    def __init__(self, out: TextIO | None = None):
        self.out = out or sys.stdout

    def emit(self, event: str, **fields: Any) -> None:
        self.out.write(json.dumps({"event": event, **fields}, ensure_ascii=False) + "\n")
        self.out.flush()
