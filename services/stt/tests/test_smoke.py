"""A real transcription with Whisper tiny (~75 MB download into a temp dir). Outside the gate:
`./run.sh smoke`. Needs ffmpeg (PATH, YAMT_FFMPEG or ../.ffmpeg-bin) to decode the test memo."""

import io
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from yamt_stt import __main__ as cli
from yamt_stt.protocol import Events

MEMO = Path(__file__).parents[3] / "packages/server/test/fixtures/memo-de.m4a"

pytestmark = pytest.mark.skipif(not os.environ.get("YAMT_STT_SMOKE"), reason="set YAMT_STT_SMOKE=1")


def ffmpeg() -> str:
    for c in (
        os.environ.get("YAMT_FFMPEG"),
        shutil.which("ffmpeg"),
        str(Path(__file__).parents[1] / ".ffmpeg-bin/bin/ffmpeg"),
    ):
        if c and Path(c).exists():
            return c
    pytest.skip("no ffmpeg")


def test_whisper_tiny_transcribes_the_made_up_memo(tmp_path):
    wav = tmp_path / "memo.wav"
    subprocess.run(
        [
            ffmpeg(),
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(MEMO),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(wav),
        ],
        check=True,
    )
    out = io.StringIO()
    req = {
        "settings": {"model": "tiny", "threads": 2, "modelsDir": str(tmp_path / "models")},
        "items": [{"id": "m", "path": str(wav)}],
    }
    assert cli.run(json.dumps(req), Events(out)) == 0
    events = [json.loads(line) for line in out.getvalue().splitlines()]
    assert events[0] == {
        "event": "model",
        "state": "downloading",
        "model": "tiny",
        "dir": str(tmp_path / "models"),
    }
    result = next(e for e in events if e["event"] == "result")
    assert result["ok"], result
    assert result["language"] == "de" and 8000 < result["durationMs"] < 10_000
    assert "gramm" in result["text"].lower(), result["text"]
