#!/usr/bin/env python
"""Download a slice of Google FLEURS de_de (test split) and build the phase-1 fixtures:

  - individual utterances (WAV + reference text) for WER measurement
  - three long files (~1/3/10 min) built by concatenating utterances, with a concatenated
    reference, to measure long-file behaviour

Everything is written outside the repo, under OUT (default /tmp/yamt-stt).

Usage: uv run scripts/fetch_fleurs.py [--n-utterances 40] [--out /tmp/yamt-stt]
"""
import argparse
import json
import io
import os
from pathlib import Path

import soundfile as sf
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-utterances", type=int, default=40, help="single utterances to keep for WER")
    ap.add_argument("--out", default="/tmp/yamt-stt")
    ap.add_argument("--long-targets-s", type=int, nargs=3, default=[60, 180, 600],
                     help="target durations in seconds for the 1/3/10-min files")
    args = ap.parse_args()

    out = Path(args.out)
    audio_dir = out / "audio"
    utt_dir = audio_dir / "utterances"
    long_dir = audio_dir / "long"
    for d in (utt_dir, long_dir):
        d.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("HF_HOME", str(out / "hf"))
    from datasets import load_dataset, Audio

    print("loading google/fleurs de_de test split (streaming)...")
    ds = load_dataset("google/fleurs", "de_de", split="test", streaming=True, trust_remote_code=False)
    ds = ds.cast_column("audio", Audio(decode=False))

    need = max(args.n_utterances, 1) + 60  # extra utterances to build the long files from
    rows = []
    for i, row in enumerate(ds):
        rows.append(row)
        if len(rows) >= need:
            break
    print(f"fetched {len(rows)} utterances")

    # --- individual utterances for WER -------------------------------------------------------
    # FLEURS' WAVs are 32-bit float PCM (soundfile reports subtype FLOAT), not int16: reading
    # with dtype="int16" silently truncates every sample (amplitudes are in [-1, 1]) to zero.
    # Read as float32 and let sf.write's PCM_16 subtype do the int16 scaling on the way out.
    utt_meta = []
    for row in rows[: args.n_utterances]:
        audio_bytes = row["audio"]["bytes"]
        data, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
        assert sr == 16000, f"expected 16kHz, got {sr}"
        fname = f"{row['id']:06d}.wav"
        sf.write(str(utt_dir / fname), data, sr, subtype="PCM_16")
        utt_meta.append({
            "id": row["id"],
            "file": f"utterances/{fname}",
            "reference": row["raw_transcription"],
            "duration_s": round(len(data) / sr, 3),
        })
    (audio_dir / "utterances.json").write_text(json.dumps(utt_meta, ensure_ascii=False, indent=2))
    print(f"wrote {len(utt_meta)} utterances to {utt_dir}")

    # --- long files: concatenate the remaining utterances with short silence gaps -----------
    remaining = rows[args.n_utterances :]
    gap_s = 0.5
    sr = 16000
    gap = np.zeros(int(gap_s * sr), dtype=np.float32)

    long_meta = []
    idx = 0
    for target_s, label in zip(args.long_targets_s, ["1min", "3min", "10min"]):
        chunks = []
        refs = []
        total_s = 0.0
        while total_s < target_s and idx < len(remaining):
            row = remaining[idx]
            idx += 1
            data, sr2 = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
            assert sr2 == sr
            chunks.append(data)
            chunks.append(gap)
            refs.append(row["raw_transcription"])
            total_s += len(data) / sr + gap_s
        if idx >= len(remaining):
            print(f"WARNING: ran out of utterances before reaching {target_s}s for {label}")
        full = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
        fname = f"{label}.wav"
        sf.write(str(long_dir / fname), full, sr, subtype="PCM_16")
        long_meta.append({
            "label": label,
            "file": f"long/{fname}",
            "reference": " ".join(refs),
            "duration_s": round(len(full) / sr, 1),
            "n_utterances": len(refs),
        })
        print(f"{label}: {len(refs)} utterances, {len(full)/sr:.1f}s -> {long_dir / fname}")

    (audio_dir / "long.json").write_text(json.dumps(long_meta, ensure_ascii=False, indent=2))
    print("done.")


if __name__ == "__main__":
    main()
