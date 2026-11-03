import io
import json

from yamt_stt import __main__ as cli
from yamt_stt.protocol import Events


def run(request: dict, backend: str = "stub") -> tuple[int, list[dict]]:
    out = io.StringIO()
    code = cli.run(json.dumps(request), Events(out), backend)
    return code, [json.loads(line) for line in out.getvalue().splitlines()]


def test_a_batch_loads_once_and_answers_every_item(tone, tmp_path):
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"RIFF....")
    code, events = run(
        {
            "items": [
                {"id": "a", "path": str(tone)},
                {"id": "b", "path": str(broken)},
                {"id": "c", "path": str(tone)},
            ]
        }
    )
    assert code == 0
    kinds = [e["event"] for e in events]
    assert kinds.count("loaded") == 1 and kinds[-1] == "end"
    results = {e["id"]: e for e in events if e["event"] == "result"}
    assert results["a"]["ok"] and results["c"]["ok"]
    assert results["a"]["durationMs"] == 1000
    assert results["a"]["language"] == "de"
    assert results["a"]["segments"] == [{"startMs": 0, "endMs": 1000, "text": results["a"]["text"]}]
    assert "peak 0.50" in results["a"]["text"]
    assert results["b"]["ok"] is False and "not a PCM WAV" in results["b"]["error"]
    assert any(e["event"] == "progress" and e["id"] == "a" for e in events)


def test_a_bad_request_is_fatal():
    code, events = run({"items": "nope"})
    assert code == 1
    assert events == [{"event": "fatal", "error": "items: expected a list"}]


def test_a_model_that_cannot_load_is_fatal(monkeypatch, tone):
    class Broken:
        name = "broken"

        def load(self):
            raise RuntimeError("no such model")

    monkeypatch.setattr(cli, "make_backend", lambda *_: Broken())
    code, events = run({"items": [{"id": "a", "path": str(tone)}]}, backend="whisper")
    assert code == 1
    assert events[-1]["event"] == "fatal" and "no such model" in events[-1]["error"]
