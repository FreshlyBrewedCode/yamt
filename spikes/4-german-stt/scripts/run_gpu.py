#!/usr/bin/env python
"""Benchmark a model served by vibe-center's services/speech-gpu on km-pc (RTX 3070), reached
through speech.sh's SSH tunnel at http://127.0.0.1:8401.

Does NOT call speech.sh itself (run that separately, see spikes/4-german-stt/README.md), so
this script can be re-run against an already-up server without re-paying wake/start time.

The server expects 0.5-15s utterances. Long files are chunked with a simple energy-based VAD
(vad_chunks.py) and the per-chunk transcripts are joined with spaces.

Usage:
  uv run scripts/run_gpu.py --model nemo-parakeet-tdt-0.6b-v3 --language de
  uv run scripts/run_gpu.py --model canary-1b-v2 --language de
  uv run scripts/run_gpu.py --model whisper-large-v3-turbo --language de
"""
import argparse
import io
import sys
import time

import numpy as np
import requests
import soundfile as sf

from common import (
    AUDIO_DIR, ResourceSampler, load_long_files, load_utterances, normalize, save_result, wer,
    wer_or_none,
)
from vad_chunks import energy_vad_chunks

BASE = "http://127.0.0.1:8401"


def read_i16(path):
    data, sr = sf.read(str(path), dtype="int16")
    assert sr == 16000, f"expected 16kHz, got {sr}"
    return data, sr


def post_wav(audio_i16: np.ndarray, sr: int, language: str | None) -> tuple[str, float]:
    buf = io.BytesIO()
    sf.write(buf, audio_i16, sr, format="WAV", subtype="PCM_16")
    buf.seek(0)
    files = {"file": ("chunk.wav", buf, "audio/wav")}
    data = {"response_format": "json"}
    if language:
        data["language"] = language
    t = time.perf_counter()
    r = requests.post(f"{BASE}/v1/audio/transcriptions", files=files, data=data, timeout=120)
    dt = time.perf_counter() - t
    r.raise_for_status()
    return r.json()["text"], dt


def ensure_model(model_id: str, timeout_s: float = 600) -> None:
    status = requests.get(f"{BASE}/v1/stt/models", timeout=10).json()
    entry = next((m for m in status["models"] if m["id"] == model_id), None)
    if entry is None:
        print(f"model {model_id} not in the catalog served here", file=sys.stderr)
        sys.exit(1)
    if entry["status"] == "active":
        return
    if entry["status"] not in ("ready",):
        print(f"downloading {model_id} ...")
        requests.post(f"{BASE}/v1/stt/models/{model_id}/download", timeout=10)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            s = next(m for m in requests.get(f"{BASE}/v1/stt/models", timeout=10).json()["models"] if m["id"] == model_id)
            if s["status"] == "ready":
                break
            if s.get("error"):
                print(f"download failed: {s['error']}", file=sys.stderr)
                sys.exit(1)
            time.sleep(3)
        else:
            print(f"{model_id} did not finish downloading after {timeout_s}s", file=sys.stderr)
            sys.exit(1)
    print(f"activating {model_id} ...")
    t0 = time.perf_counter()
    requests.post(f"{BASE}/v1/stt/models/{model_id}/activate", timeout=10)
    deadline = time.time() + 120
    while time.time() < deadline:
        s = next(m for m in requests.get(f"{BASE}/v1/stt/models", timeout=10).json()["models"] if m["id"] == model_id)
        if s["status"] == "active":
            print(f"activated in {time.perf_counter() - t0:.1f}s")
            return
        if s.get("error"):
            print(f"activation failed: {s['error']}", file=sys.stderr)
            sys.exit(1)
        time.sleep(2)
    print(f"{model_id} did not become active in time", file=sys.stderr)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True,
                    help="speech-gpu catalog id: parakeet-tdt-0.6b-v3, canary-1b-v2 or whisper-large-v3-turbo")
    ap.add_argument("--language", default="de")
    ap.add_argument("--max-chunk-s", type=float, default=14.0)
    args = ap.parse_args()

    try:
        requests.get(f"{BASE}/health", timeout=5).raise_for_status()
    except Exception as e:
        print(f"speech-gpu STT server not reachable at {BASE}: {e}\nrun speech.sh up first.", file=sys.stderr)
        sys.exit(1)

    ensure_model(args.model)
    name = f"{args.model}-gpu"
    print(f"=== {name} (language={args.language}) ===")

    # --- utterances: WER (single request each, well within 0.5-15s) ------------------------
    utterances = load_utterances()
    utt_results = []
    with ResourceSampler() as sampler_utt:  # this process barely uses CPU; mostly for symmetry
        for u in utterances:
            audio, sr = read_i16(AUDIO_DIR / u["file"])
            text, dt = post_wav(audio, sr, args.language)
            w = wer_or_none(u["reference"], text)
            utt_results.append({
                "id": u["id"], "reference": u["reference"], "hypothesis": text,
                "duration_s": u["duration_s"], "wall_s": round(dt, 3),
                "wer": round(w, 4) if w is not None else None,
            })
            print(f"  utt {u['id']}: {dt*1000:.0f}ms  wer={utt_results[-1]['wer']}")
    import jiwer
    scored = [r for r in utt_results if r["wer"] is not None]
    avg_wer = sum(r["wer"] for r in scored) / len(scored) if scored else None
    corpus_wer = jiwer.wer(
        [normalize(r["reference"]) for r in scored], [normalize(r["hypothesis"]) for r in scored],
    ) if scored else None

    # --- long files: chunk, transcribe each chunk, join --------------------------------------
    long_results = []
    for lf in load_long_files():
        audio, sr = read_i16(AUDIO_DIR / lf["file"])
        spans = energy_vad_chunks(audio, sr, max_chunk_s=args.max_chunk_s)
        t0 = time.perf_counter()
        texts = []
        for a, b in spans:
            text, _ = post_wav(audio[a:b], sr, args.language)
            texts.append(text)
        dt = time.perf_counter() - t0
        joined = " ".join(t for t in texts if t)
        rtf = dt / lf["duration_s"]
        w = wer(lf["reference"], joined)
        long_results.append({
            "label": lf["label"], "duration_s": lf["duration_s"], "wall_s": round(dt, 2),
            "rtf": round(rtf, 4), "wer": round(w, 4), "n_chunks": len(spans),
            "chunk_lengths_s": [round((b - a) / sr, 1) for a, b in spans],
            "hypothesis_preview": joined[:200],
        })
        print(f"  {lf['label']}: {len(spans)} chunks, wall={dt:.1f}s rtf={rtf:.3f} wer={w:.3f}")

    save_result(name, {
        "model": name, "backend": "speech-gpu (km-pc, RTX 3070)", "device": "gpu",
        "language": args.language, "chunking": f"energy-VAD, max_chunk_s={args.max_chunk_s}",
        "utterance_avg_wer": round(avg_wer, 4) if avg_wer is not None else None,
        "utterance_corpus_wer": round(corpus_wer, 4) if corpus_wer is not None else None,
        "n_utterances": len(utt_results),
        "long_files": long_results,
        "utterances": utt_results,
    })


if __name__ == "__main__":
    main()
