import io
import wave

import numpy as np
import pytest


def wav_bytes(samples: np.ndarray, rate: int = 16_000, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


@pytest.fixture
def tone(tmp_path):
    """A 1 s 440 Hz tone at half scale, as ffmpeg would hand it over (16 kHz mono s16)."""
    t = np.arange(16_000) / 16_000
    path = tmp_path / "tone.wav"
    path.write_bytes(wav_bytes(0.5 * np.sin(2 * np.pi * 440 * t)))
    return path
