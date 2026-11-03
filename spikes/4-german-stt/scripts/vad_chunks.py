"""A small energy-based VAD, good enough to chunk a long memo into the GPU STT server's
0.5-15s utterance window without extra dependencies (no torch/silero on the client side).

Not a real VAD model: it classifies 20ms frames as speech/silence by RMS energy relative to a
rolling noise floor, then merges speech runs into chunks capped at max_chunk_s, breaking at the
longest nearby silence. This is noted as a phase-1 approximation in FINDINGS.md: a short, quiet
word right at a cut can be clipped, same as the real STT server's own padding/segmentation
caveats (see vibe-center's BENCHMARKS.md).
"""
import numpy as np


def energy_vad_chunks(
    audio: np.ndarray, sr: int = 16000, *, frame_ms: float = 20, max_chunk_s: float = 14.0,
    min_silence_ms: float = 250, energy_margin_db: float = 10.0,
) -> list[tuple[int, int]]:
    """Return a list of (start_sample, end_sample) spans, each <= max_chunk_s long, that try
    to start/end in silence."""
    frame = int(sr * frame_ms / 1000)
    n_frames = len(audio) // frame
    if n_frames == 0:
        return [(0, len(audio))]
    frames = audio[: n_frames * frame].reshape(n_frames, frame)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-9)
    db = 20 * np.log10(rms + 1e-9)
    noise_floor = np.percentile(db, 10)  # robust-ish estimate of the silence level
    is_speech = db > (noise_floor + energy_margin_db)

    # find silence runs (frame indices) to use as candidate cut points
    silence_runs = []
    i = 0
    while i < n_frames:
        if not is_speech[i]:
            j = i
            while j < n_frames and not is_speech[j]:
                j += 1
            if (j - i) * frame_ms >= min_silence_ms:
                silence_runs.append((i, j))
            i = j
        else:
            i += 1

    cut_frames = sorted({(a + b) // 2 for a, b in silence_runs})
    max_chunk_frames = int(max_chunk_s * 1000 / frame_ms)

    spans = []
    start = 0
    while start < n_frames:
        limit = min(start + max_chunk_frames, n_frames)
        # the latest cut point within (start, limit], else just cut at the limit
        candidates = [c for c in cut_frames if start < c <= limit]
        end = candidates[-1] if candidates else limit
        if end <= start:
            end = limit
        spans.append((start * frame, min(end * frame, len(audio))))
        start = end
    # drop near-empty trailing span
    if len(spans) > 1 and spans[-1][1] - spans[-1][0] < frame:
        spans.pop()
    return spans
