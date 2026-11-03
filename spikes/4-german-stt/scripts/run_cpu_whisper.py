#!/usr/bin/env python
"""Benchmark faster-whisper (CTranslate2) on this VM's CPU: WER on FLEURS de_de utterances,
RTF/wall time on the 1/3/10-min files, peak RAM, model load time, disk size.

Usage: uv run scripts/run_cpu_whisper.py [--model large-v3-turbo] [--compute-type int8]
"""
import argparse
import time

import numpy as np
import soundfile as sf

from common import (
    AUDIO_DIR, MODELS_DIR, ResourceSampler, dir_size_mb, load_long_files, load_utterances,
    normalize, save_result, wer, wer_or_none,
)


def read_f32(path):
    data, sr = sf.read(str(path), dtype="float32")
    assert sr == 16000, f"expected 16kHz, got {sr}"
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--cpu-threads", type=int, default=6)
    ap.add_argument("--language", default="de")
    args = ap.parse_args()

    from faster_whisper import WhisperModel

    download_root = MODELS_DIR / "whisper"
    download_root.mkdir(parents=True, exist_ok=True)

    name = f"whisper-{args.model}-cpu-{args.compute_type}"
    print(f"=== {name} ===")

    t0 = time.perf_counter()
    model = WhisperModel(
        args.model, device="cpu", compute_type=args.compute_type,
        cpu_threads=args.cpu_threads, download_root=str(download_root),
    )
    load_s = time.perf_counter() - t0
    print(f"loaded in {load_s:.1f}s")

    # warm up (first call pays extra init cost not representative of steady state)
    noise = (np.random.default_rng(0).standard_normal(16000) * 0.01).astype(np.float32)
    list(model.transcribe(noise, language=args.language, beam_size=1, without_timestamps=True)[0])

    def transcribe(audio: np.ndarray) -> tuple[str, float]:
        t = time.perf_counter()
        segments, _ = model.transcribe(
            audio, language=args.language, beam_size=1, condition_on_previous_text=False,
            without_timestamps=True, vad_filter=False,
        )
        text = " ".join(s.text.strip() for s in segments)
        return text, time.perf_counter() - t

    # --- utterances: WER -------------------------------------------------------------------
    utterances = load_utterances()
    utt_results = []
    with ResourceSampler() as sampler_utt:
        for u in utterances:
            audio = read_f32(AUDIO_DIR / u["file"])
            text, dt = transcribe(audio)
            w = wer_or_none(u["reference"], text)
            utt_results.append({
                "id": u["id"], "reference": u["reference"], "hypothesis": text,
                "duration_s": u["duration_s"], "wall_s": round(dt, 3),
                "wer": round(w, 4) if w is not None else None,
            })
            print(f"  utt {u['id']}: {dt*1000:.0f}ms  wer={utt_results[-1]['wer']}")
    scored = [r for r in utt_results if r["wer"] is not None]
    avg_wer = sum(r["wer"] for r in scored) / len(scored) if scored else None
    # also a corpus-level WER (concatenated refs/hyps), more standard than averaging per-utt WER
    import jiwer
    corpus_wer = jiwer.wer(
        [normalize(r["reference"]) for r in scored], [normalize(r["hypothesis"]) for r in scored],
    ) if scored else None

    # --- long files: RTF, wall time ---------------------------------------------------------
    long_results = []
    for lf in load_long_files():
        audio = read_f32(AUDIO_DIR / lf["file"])
        with ResourceSampler() as sampler_long:
            text, dt = transcribe(audio)
        stats = sampler_long.stats()
        rtf = dt / lf["duration_s"]
        w = wer(lf["reference"], text)
        long_results.append({
            "label": lf["label"], "duration_s": lf["duration_s"], "wall_s": round(dt, 2),
            "rtf": round(rtf, 4), "wer": round(w, 4), "peak_rss_mb": round(stats.peak_rss_mb, 1),
            "cpu_percent_avg": round(stats.cpu_percent_avg, 1) if stats.cpu_percent_avg else None,
            "hypothesis_preview": text[:200],
        })
        print(f"  {lf['label']}: wall={dt:.1f}s rtf={rtf:.3f} wer={w:.3f} peak_rss={stats.peak_rss_mb:.0f}MB")

    disk_mb = dir_size_mb(download_root)

    save_result(name, {
        "model": name, "backend": "faster-whisper (ctranslate2)", "device": "cpu",
        "compute_type": args.compute_type, "cpu_threads": args.cpu_threads,
        "load_s": round(load_s, 2), "disk_mb": round(disk_mb, 1),
        "utterance_avg_wer": round(avg_wer, 4) if avg_wer is not None else None,
        "utterance_corpus_wer": round(corpus_wer, 4) if corpus_wer is not None else None,
        "n_utterances": len(utt_results),
        "utterance_peak_rss_mb": round(sampler_utt.stats().peak_rss_mb, 1),
        "utterance_cpu_percent_avg": round(sampler_utt.stats().cpu_percent_avg, 1) if sampler_utt.stats().cpu_percent_avg else None,
        "long_files": long_results,
        "utterances": utt_results,
    })


if __name__ == "__main__":
    main()
