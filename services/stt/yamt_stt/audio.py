"""The normalised audio the server hands over: 16 kHz mono 16-bit PCM WAV (ffmpeg made it)."""

import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000


class AudioError(Exception):
    """The file is not the WAV the server promised (a bug on its side, or a truncated file)."""


def read_wav(path: str | Path) -> np.ndarray:
    """The samples as float32 in [-1, 1], which is what Whisper expects.

    Read as int16 and scaled: reading float WAVs as int16 (or the other way round) silently
    zeroes the audio, and Whisper then hallucinates "Vielen Dank." on the silence (spike #4).
    """
    try:
        with wave.open(str(path), "rb") as w:
            if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise AudioError(
                    f"{path}: expected 16 kHz mono 16-bit PCM, got {w.getframerate()} Hz, "
                    f"{w.getnchannels()} channel(s), {8 * w.getsampwidth()}-bit"
                )
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as e:
        raise AudioError(f"{path}: not a PCM WAV file ({e})") from e
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
