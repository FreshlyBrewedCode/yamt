#!/usr/bin/env python
"""Phase 2 entry point: point this at a directory of real recordings and it builds the same
utterances.json manifest fetch_fleurs.py produces for FLEURS, so run_cpu_whisper.py /
run_cpu_onnx_asr.py / run_gpu.py and report.py all work unchanged.

Each audio file becomes one "utterance" (phase 1's long/short split doesn't apply: a real memo
can be anywhere from a few seconds to ~10 minutes, which is exactly the case this harness should
exercise). A reference transcript is optional (WER is skipped for files without one) - it can be
the user's correction of the best phase-1 model's output.

Input layout, anywhere outside the repo (e.g. ~/.yamt/spikes/stt/memos/):
    memo1.wav  (or .m4a, .mp3, .mp4, anything ffmpeg reads)
    memo1.txt            <- optional reference transcript (plain text)
    memo2.m4a
    memo2.reference.txt  <- `.reference.txt` also recognised

Usage:
  uv run scripts/build_manifest.py ~/.yamt/spikes/stt/memos --out ~/.yamt/spikes/stt
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

import soundfile as sf

AUDIO_EXTS = {".wav", ".m4a", ".mp3", ".mp4", ".ogg", ".flac", ".aac", ".webm"}


def ffmpeg_to_wav16k(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", str(dst)],
        check=True, capture_output=True,
    )


def find_reference(audio_path: Path) -> str | None:
    for suffix in (".txt", ".reference.txt"):
        cand = audio_path.parent / (audio_path.stem + suffix)
        if cand.exists():
            return cand.read_text(encoding="utf-8").strip()
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_dir", help="directory of real recordings (kept outside the repo)")
    ap.add_argument("--out", default="/tmp/yamt-stt-phase2", help="where to write audio/utterances.json")
    args = ap.parse_args()

    in_dir = Path(args.input_dir).expanduser()
    out = Path(args.out).expanduser()
    utt_dir = out / "audio" / "utterances"
    utt_dir.mkdir(parents=True, exist_ok=True)

    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg not on PATH: nix shell nixpkgs#ffmpeg, or run this inside it")

    manifest = []
    files = sorted(p for p in in_dir.iterdir() if p.suffix.lower() in AUDIO_EXTS)
    if not files:
        raise SystemExit(f"no audio files found in {in_dir} (looked for {sorted(AUDIO_EXTS)})")

    for i, f in enumerate(files):
        wav = utt_dir / f"{i:03d}_{f.stem}.wav"
        print(f"normalising {f.name} -> {wav.name}")
        ffmpeg_to_wav16k(f, wav)
        data, sr = sf.read(str(wav))
        reference = find_reference(f)
        manifest.append({
            "id": i,
            "file": f"utterances/{wav.name}",
            "reference": reference or "",
            "duration_s": round(len(data) / sr, 3),
            "source_file": f.name,
            "has_reference": reference is not None,
        })
        if reference is None:
            print(f"  no reference transcript for {f.name} (WER will be skipped for it)")

    (out / "audio" / "utterances.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    # no long-file split for phase 2: real memos are used as-is, whatever their length
    (out / "audio" / "long.json").write_text("[]")
    print(f"wrote manifest for {len(manifest)} files to {out / 'audio' / 'utterances.json'}")
    print(f"run with: YAMT_STT_OUT={out} uv run scripts/run_cpu_whisper.py ...")


if __name__ == "__main__":
    main()
