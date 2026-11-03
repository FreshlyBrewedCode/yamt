# Spike #4: German speech-to-text, CPU vs GPU

Phase 1 harness: speed, memory and practicality of candidate STT models on this VM's CPU vs
km-pc's GPU, measured on public German speech (Google FLEURS `de_de`). No personal data: all
audio and results live outside the repo, under `/tmp/yamt-stt/` (`YAMT_STT_OUT` to change it).
This directory holds only scripts and the numbers in `FINDINGS.md`.

Phase 2 (real meal memos, once the user has recorded some) re-runs the same scripts against a
directory of recordings with optional reference transcripts — see "Phase 2" below.

## Setup

```sh
cd spikes/4-german-stt
nix shell nixpkgs#uv -c uv sync          # creates .venv/, installs datasets, faster-whisper,
                                           # onnx-asr, onnxruntime, jiwer, psutil, requests, ...
```

Everything below runs through `nix shell nixpkgs#uv -c uv run ...` (ffmpeg is only needed if you
bring your own audio files for phase 2 that aren't already 16 kHz mono WAV).

## 1. Build the fixtures (once)

```sh
uv run scripts/fetch_fleurs.py --n-utterances 40
```

Downloads google/fleurs `de_de` (test split, streaming — no need to pull the whole dataset),
keeps 40 individual utterances with their reference transcripts for WER, and concatenates the
next ~56 utterances (with 0.5s silence gaps) into three long files (~1 / 3 / 10 minutes) with a
concatenated reference, to exercise long-file behaviour. Writes to
`/tmp/yamt-stt/audio/{utterances,long}/` plus `utterances.json` / `long.json` manifests.

## 2. CPU benchmarks (this VM, 6 vCPU / 15 GB RAM — run one at a time, this VM is shared)

```sh
uv run scripts/run_cpu_whisper.py --model large-v3-turbo --compute-type int8
uv run scripts/run_cpu_onnx_asr.py --model nemo-parakeet-tdt-0.6b-v3 --quantization int8
uv run scripts/run_cpu_onnx_asr.py --model nemo-canary-1b-v2 --quantization int8 --language de
```

Each prints progress per utterance/long file and writes `/tmp/yamt-stt/results/<model>.json`:
WER (corpus-level and per-utterance average) on the 40 FLEURS utterances, wall time + RTF + peak
RSS + average CPU% per long file, model load time and on-disk size.

Canary is an encoder-decoder (AED) model and does not detect the language itself: pass
`--language de` explicitly (the catalog note in vibe-center's `catalog.py` and `README.md`).
Parakeet v3 detects the language per utterance, so no `--language` is passed.

`--quantization fp32` (i.e. omit `--quantization`, or pass `None`) uses the full-precision ONNX
export instead of the int8 one, if you want the accuracy/speed trade-off at the other end.

## 3. GPU benchmarks (km-pc, RTX 3070 — read the `gpu` skill first)

```sh
# time the wake -> speech.sh up lifecycle (also usable standalone when just testing readiness)
scripts/gpu_lifecycle.sh up

# in another shell, once /v1/audio/transcriptions answers (gpu_lifecycle.sh up waits for it):
cd spikes/4-german-stt
uv run scripts/run_gpu.py --model parakeet-tdt-0.6b-v3 --language de
uv run scripts/run_gpu.py --model canary-1b-v2 --language de
uv run scripts/run_gpu.py --model whisper-large-v3-turbo --language de

scripts/gpu_lifecycle.sh down   # speech.sh down, then gpu sleep
```

`run_gpu.py` downloads+activates the requested model on the server if it isn't already serving
(first time per model: the download, a few minutes; `gpu_lifecycle.sh up`'s wall time already
captures `speech.sh up`'s own first-run cost separately). The server's utterance window is
0.5-15s, so long files are chunked first with a small energy-based VAD
(`scripts/vad_chunks.py`, no extra ML dependency) into <=14s pieces, each transcribed
separately and joined with spaces; the chunk boundaries are recorded in the result JSON so a
accuracy hit from a bad cut is visible.

`gpu status` before running: if km-pc is in Windows, asleep and won't wake, or someone is
sitting at it locally, stop here — don't force `--force` on speech.sh without asking first.

## 4. Report

```sh
uv run scripts/report.py     # renders every results/*.json as the markdown tables in FINDINGS.md
```

## Phase 2: real meal memos

Once the user has recorded 5-10 real German meal memos (and, ideally, corrected reference
transcripts for at least the model that looked best in phase 1):

1. Put them (never in the repo) under a directory, e.g. `~/.yamt/spikes/stt/memos/`, as 16 kHz
   mono WAV (`ffmpeg -i in.m4a -ar 16000 -ac 1 out.wav`, or point `fetch_memos.py` — TODO phase 2
   — at the raw files and it normalises them the same way `yamt`'s own pipeline would).
2. Reference transcripts, if the user provides corrections rather than fresh transcriptions, go
   next to each file as `<name>.txt` (or `<name>.reference.txt`).
3. Point the same `run_cpu_*` / `run_gpu.py` scripts at that directory instead of
   `/tmp/yamt-stt/audio` (`YAMT_STT_OUT=~/.yamt/spikes/stt` with the same `audio/utterances/` +
   `utterances.json` layout `fetch_fleurs.py` produces — build that manifest by hand or with a
   small adapter script for the real files; the harness itself (`common.py`, the WER/resource
   code, `report.py`) is unchanged).
4. Add the downstream check from the issue: feed the best and worst model's transcript of each
   memo to Claude with a short "extract ingredients with grams" prompt (the `log-meal` skill's
   extraction prompt is a reasonable starting point) and compare the extracted items. If
   accuracy-on-paper differences don't change the extraction, the cheaper model wins.

## Gotchas / implementation notes

See `FINDINGS.md` for the numbers; notes on the harness itself:

- WER normalises case and punctuation (`common.normalize`) but does **not** convert between
  digits and number words ("42" vs "zweiundvierzig") or split German compounds — a model that
  writes numbers as digits (Parakeet, per vibe-center's notes) will show a WER penalty against
  FLEURS' spelled-out references that doesn't reflect a real transcription error for this
  product's purposes (a downstream LLM extracting grams handles "zweihundert" and "200"
  equally well). Flagged per-model in FINDINGS.md rather than normalised away, since it's a
  genuine, visible difference between models.
- Peak RSS is sampled every 250ms during the call (`common.ResourceSampler`, via `psutil`,
  process tree included) plus `getrusage` at the end; short, fast calls can under-sample the
  true peak.
- The GPU chunker is a phase-1 approximation (fixed max length, breaks at the longest nearby
  silence by RMS energy) — not the real Silero VAD vibe-center's voice pipeline uses. It's good
  enough to stay inside the server's 0.5-15s contract and to see whether chunking costs
  accuracy at all; a soft/short word right at a bad cut can still be dropped, the same class of
  issue as vibe-center's own turn-fragmentation finding (BENCHMARKS.md).
