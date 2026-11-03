#!/usr/bin/env python
"""Benchmark an onnx-asr model (Parakeet-TDT or Canary) on CPU (CPUExecutionProvider).

Usage:
  uv run scripts/run_cpu_onnx_asr.py --model nemo-parakeet-tdt-0.6b-v3 --quantization int8
  uv run scripts/run_cpu_onnx_asr.py --model nemo-canary-1b-v2 --quantization int8 --language de
"""
import argparse
import time

import jiwer
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


# model name -> substring of its HF repo id (istupakov's onnx exports), for disk-size reporting
_REPO_HINT = {
    "nemo-parakeet-tdt-0.6b-v3": "parakeet-tdt-0.6b-v3",
    "nemo-parakeet-tdt-0.6b-v2": "parakeet-tdt-0.6b-v2",
    "nemo-canary-1b-v2": "canary-1b-v2",
}


def hf_repo_disk_mb(model_name: str) -> float | None:
    try:
        from huggingface_hub import scan_cache_dir
        hint = _REPO_HINT.get(model_name, model_name)
        cache = scan_cache_dir()
        total = sum(r.size_on_disk for r in cache.repos if hint in r.repo_id)
        return round(total / 2**20, 1) if total else None
    except Exception as e:
        print(f"could not measure disk size: {e}")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="onnx-asr model name, e.g. nemo-parakeet-tdt-0.6b-v3")
    ap.add_argument("--quantization", default="int8")
    ap.add_argument("--language", default=None, help="explicit language, e.g. de (Canary needs this)")
    ap.add_argument("--intra-op-threads", type=int, default=6)
    ap.add_argument("--skip-long", action="store_true", help="skip the long files (e.g. known to hang/OOM)")
    ap.add_argument("--no-mem-arena", action="store_true", help="disable onnxruntime's CPU memory arena (lower peak RSS, a bit slower)")
    args = ap.parse_args()

    import onnxruntime as ort
    import onnx_asr

    name = f"{args.model}-cpu-{args.quantization or 'fp32'}"
    print(f"=== {name} (language={args.language}) ===")

    so = ort.SessionOptions()
    so.intra_op_num_threads = args.intra_op_threads
    so.log_severity_level = 3
    # the arena otherwise grows to the largest shape seen and never shrinks; conservative growth
    # trades a little speed for a much lower peak, which matters on a memory-constrained host
    so.enable_cpu_mem_arena = not args.no_mem_arena

    import os
    os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))

    t0 = time.perf_counter()
    model = onnx_asr.load_model(
        args.model, quantization=args.quantization,
        providers=["CPUExecutionProvider"], sess_options=so,
    )
    load_s = time.perf_counter() - t0
    print(f"loaded in {load_s:.1f}s")

    kw = {"language": args.language} if args.language else {}

    # warm up
    noise = (np.random.default_rng(0).standard_normal(16000) * 0.01).astype(np.float32)
    model.recognize(noise, sample_rate=16000, **kw)

    def transcribe(audio: np.ndarray) -> tuple[str, float]:
        t = time.perf_counter()
        text = model.recognize(audio, sample_rate=16000, **kw)
        return text, time.perf_counter() - t

    # --- utterances: WER -------------------------------------------------------------------
    utterances = load_utterances()
    utt_results = []
    with ResourceSampler() as sampler_utt:
        for u in utterances:
            audio = read_f32(AUDIO_DIR / u["file"])
            try:
                text, dt = transcribe(audio)
            except Exception as e:
                print(f"  utt {u['id']}: FAILED {e}")
                utt_results.append({"id": u["id"], "reference": u["reference"], "hypothesis": "",
                                     "duration_s": u["duration_s"], "wall_s": None, "wer": 1.0,
                                     "error": str(e)})
                continue
            w = wer_or_none(u["reference"], text)
            utt_results.append({
                "id": u["id"], "reference": u["reference"], "hypothesis": text,
                "duration_s": u["duration_s"], "wall_s": round(dt, 3),
                "wer": round(w, 4) if w is not None else None,
            })
            print(f"  utt {u['id']}: {dt*1000:.0f}ms  wer={utt_results[-1]['wer']}")
    ok = [r for r in utt_results if r.get("wall_s") is not None and r.get("wer") is not None]
    avg_wer = sum(r["wer"] for r in ok) / len(ok) if ok else None
    corpus_wer = jiwer.wer(
        [normalize(r["reference"]) for r in ok], [normalize(r["hypothesis"]) for r in ok],
    ) if ok else None

    # --- long files: RTF, wall time ---------------------------------------------------------
    long_results = []
    if not args.skip_long:
        for lf in load_long_files():
            audio = read_f32(AUDIO_DIR / lf["file"])
            try:
                with ResourceSampler() as sampler_long:
                    text, dt = transcribe(audio)
                stats = sampler_long.stats()
                rtf = dt / lf["duration_s"]
                w = wer(lf["reference"], text)
                long_results.append({
                    "label": lf["label"], "duration_s": lf["duration_s"], "wall_s": round(dt, 2),
                    "rtf": round(rtf, 4), "wer": round(w, 4),
                    "peak_rss_mb": round(stats.peak_rss_mb, 1),
                    "cpu_percent_avg": round(stats.cpu_percent_avg, 1) if stats.cpu_percent_avg else None,
                    "hypothesis_preview": text[:200],
                })
                print(f"  {lf['label']}: wall={dt:.1f}s rtf={rtf:.3f} wer={w:.3f} peak_rss={stats.peak_rss_mb:.0f}MB")
            except Exception as e:
                print(f"  {lf['label']}: FAILED {e}")
                long_results.append({"label": lf["label"], "duration_s": lf["duration_s"], "error": str(e)})

    disk_mb = hf_repo_disk_mb(args.model)

    save_result(name, {
        "model": name, "backend": "onnx-asr (onnxruntime CPU)", "device": "cpu",
        "quantization": args.quantization, "language": args.language,
        "intra_op_threads": args.intra_op_threads,
        "load_s": round(load_s, 2), "disk_mb": disk_mb,
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
