import numpy as np
import pytest

from tests.conftest import wav_bytes
from yamt_stt.audio import AudioError, read_wav


def test_reads_pcm_as_float32_in_range(tone):
    audio = read_wav(tone)
    assert audio.dtype == np.float32
    assert len(audio) == 16_000
    # not silently zeroed (the spike's "Vielen Dank" bug), and scaled to [-1, 1]
    assert 0.49 < float(np.abs(audio).max()) <= 0.5


def test_refuses_anything_but_16k_mono(tmp_path):
    stereo = tmp_path / "stereo.wav"
    stereo.write_bytes(wav_bytes(np.zeros(32_000), channels=2))
    with pytest.raises(AudioError, match="mono"):
        read_wav(stereo)
    cd = tmp_path / "cd.wav"
    cd.write_bytes(wav_bytes(np.zeros(44_100), rate=44_100))
    with pytest.raises(AudioError, match="44100 Hz"):
        read_wav(cd)
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"\x00\x00\x00 ftypM4A not a wav")
    with pytest.raises(AudioError, match="not a PCM WAV"):
        read_wav(junk)
