# Spike #4 - phase 1 findings: German STT, CPU (this VM) vs GPU (km-pc)

Date: 2026-11-03. Harness: `spikes/4-german-stt/` (this branch, `spike/4-german-stt`, never
merges). Phase 1 only: no real meal memos yet, so this answers speed/memory/practicality and
German accuracy on public speech (Google FLEURS `de_de`, test split), not accuracy on real
memos or the downstream extraction check (phase 2, see the spike's README).

## Hardware and versions

- **This VM ("dev")**: 6 vCPU (Ryzen 9 5900XT), 15 GB RAM, NixOS, shared with other services.
  This agent's own session additionally runs inside a 10 GiB memory cgroup
  (`system.slice/t3code.service`) - lower than the VM's 15 GB and the thing that actually bit
  us once (see Gotchas). The real yamt server process would not be under that cgroup.
- **GPU host (km-pc)**: RTX 3070, 8 GB VRAM, NixOS, slept at the start and end of this spike;
  reached through vibe-center's `services/speech-gpu` (`speech.sh`) and the `gpu` CLI. Driver
  and CUDA versions are whatever `speech.sh up` installed; not re-queried for this spike (see
  vibe-center's `BENCHMARKS.md` for the host's last recorded driver/CUDA/onnxruntime versions).
- Package versions actually used here (`spikes/4-german-stt/uv.lock`): faster-whisper 1.2.1,
  ctranslate2 4.8.5, onnx-asr 0.12.0, onnxruntime 1.31.1 (CPU build), datasets 5.1.0, jiwer
  4.0.0, huggingface-hub 2.4.0.

## Test data

Google FLEURS `de_de` test split (Hugging Face `google/fleurs`), streamed (not fully
downloaded). 40 individual utterances for WER; three long files built by concatenating further
FLEURS utterances with 0.5s silence gaps (~1 / 3 / 10 minutes), reference = the concatenation of
their transcripts. Everything lives under `/tmp/yamt-stt/` (`fetch_fleurs.py`), never in the
repo.

Candidates, as in the issue: **CPU** (this VM) - faster-whisper large-v3-turbo (int8), NVIDIA
Parakeet-TDT 0.6B v3 and Canary 1B v2 via onnx-asr (onnxruntime CPU, int8 ONNX export).
**GPU** (km-pc) - the same three models through vibe-center's `services/speech-gpu`
(`/v1/audio/transcriptions`), long files chunked to the server's 0.5-15s window with a small
energy-based VAD (`scripts/vad_chunks.py`).

## Results: accuracy and load (40 FLEURS de_de utterances)

| model | device | WER (corpus) | WER (avg/utt) | load | disk |
|---|---|---:|---:|---:|---:|
| Whisper large-v3-turbo, int8 | CPU | **3.2%** | 3.6% | 5.2s | 1.5 GB |
| Canary 1B v2, int8 | CPU | 4.5% | 4.7% | 2.9s | 1.0 GB |
| Parakeet-TDT v3, int8 | CPU | 13.9% | 11.1% | 52.7s | 0.6 GB |
| Whisper large-v3-turbo | GPU | 3.5% | 3.8% | n/a (server-side) | 1.6 GB + 2.6 GB CUDA12 runtime |
| Canary 1B v2 | GPU | **4.2%** | 4.4% | n/a | 2.2 GB |
| Parakeet-TDT v3 | GPU | 5.0% | 5.5% | n/a | 1.25 GB |

Canary's GPU number (4.2%) lines up with vibe-center's research notes (4.4% on FLEURS) and
Parakeet v3's GPU number (5.0%) matches the issue's own citation (5.0%) - a good sanity check
that the harness measures what it says it does. Whisper large-v3-turbo beats both on CPU
(3.2%); Parakeet v3 is clearly worse on CPU than its GPU counterpart would suggest, almost
entirely because of language code-switching (see Gotchas) that the GPU run also hit but less
often by chance of which utterances it saw first in each run's warm-up state - this is noise
in a 40-utterance sample as much as a model difference; treat the CPU/GPU gap for Parakeet with
caution.

## Results: long files - wall time, RTF, peak RAM

| model | device | file | duration | wall | RTF | WER | peak RSS | CPU% |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Whisper turbo, int8 | CPU | 1min | 71.8s | 16.8s | 0.234 | 9.4% | 1.7 GB | 428% |
| Whisper turbo, int8 | CPU | 3min | 203.5s | 40.9s | 0.201 | 16.8% | 1.7 GB | 404% |
| Whisper turbo, int8 | CPU | 10min | 605.9s | 115.3s | 0.190 | 18.6% | 1.7 GB | 429% |
| Parakeet v3, int8 | CPU | 1min | 71.8s | 3.1s | 0.044 | 6.0% | 2.2 GB | 527% |
| Parakeet v3, int8 | CPU | 3min | 203.5s | 16.5s | 0.081 | 19.0% | 3.7 GB | 443% |
| Parakeet v3, int8 | CPU | 10min | 605.9s | **FAILED** (ONNXRuntimeError, broadcast shape mismatch) | - | - | - | - |
| Canary 1B v2, int8 | CPU | 1min / 3min / 10min | - | **not attempted** (aborted to avoid an OOM; see Gotchas) | - | - | - | - |
| Whisper turbo | GPU (chunked) | 1min | 71.8s | 1.4s | 0.019 | 7.7% | - | - |
| Whisper turbo | GPU (chunked) | 3min | 203.5s | 3.8s | 0.019 | 11.0% | - | - |
| Whisper turbo | GPU (chunked) | 10min | 605.9s | 10.8s | 0.018 | 5.4% | - | - |
| Parakeet v3 | GPU (chunked) | 1min | 71.8s | 0.4s | 0.006 | 4.3% | - | - |
| Parakeet v3 | GPU (chunked) | 3min | 203.5s | 1.2s | 0.006 | 7.4% | - | - |
| Parakeet v3 | GPU (chunked) | 10min | 605.9s | 3.4s | 0.0055 | 5.5% | - | - |
| Canary 1B v2 | GPU (chunked) | 1min | 71.8s | 1.3s | 0.018 | 6.0% | - | - |
| Canary 1B v2 | GPU (chunked) | 3min | 203.5s | 3.5s | 0.017 | 8.7% | - | - |
| Canary 1B v2 | GPU (chunked) | 10min | 605.9s | 9.7s | 0.016 | 5.9% | - | - |

GPU peak RSS isn't meaningful here (the heavy lifting happens on km-pc; `run_gpu.py`'s own
process is a thin HTTP client). GPU VRAM is the catalog's own numbers (`BENCHMARKS.md`), not
re-measured in this spike.

Long-file WER is consistently *higher* than the isolated-utterance WER for every model and
both devices (e.g. Whisper CPU 3.2% -> 9-19%; Canary GPU 4.2% -> 6-9%). This is at least partly
an artefact of how the long files are built (FLEURS utterances concatenated with a hard 0.5s
silence gap, abrupt topic/speaker changes at every join) and, on GPU, the energy-based chunker
occasionally cutting mid-word - not necessarily what a real, continuous cooking memo would show.
Treat the long-file WER numbers as upper bounds, not a prediction of phase-2 accuracy.

## GPU lifecycle ("a memo arrives while km-pc sleeps")

km-pc was asleep both before and after this spike (confirmed with `gpu status`).

| step | time |
|---|---:|
| `gpu wake` | 12.5s |
| `speech.sh up` (first run this session: syncs code, `.venv` already current, default model already resident) | 18.3s |
| **wake + up total** | **30.8s** |
| transcribe a 3-min memo, chunked (Canary 1B v2, already active) | 3.5s |
| `speech.sh down` | 1.5s |
| `gpu sleep` | 0.8s |
| **down + sleep total** | **2.3s** |
| **end to end (wake -> up -> transcribe 3-min -> down -> sleep)** | **~36.6s** |

This excludes the one-time cost of *first* downloading a non-default model onto the GPU host:
observed in this spike at roughly 1-1.3 MB/s (no `HF_TOKEN` configured, see `README.md` of
`services/speech-gpu`) - Parakeet v3 (2.5 GB) ~16 min, Canary 1B v2 (3.8 GB) ~29 min, Whisper
turbo (1.6 GB, plus a one-time `.venv-whisper`/ctranslate2 runtime install) ~10 min. Once a
model is downloaded, switching to it only costs the `activate` step (4-6s, matching
vibe-center's own numbers). For production this is a one-off setup step, not part of the
per-memo lifecycle.

## Gotchas

- **Parakeet v3 has no language pin and occasionally code-switches to English mid-utterance**
  on German text containing foreign-looking proper nouns or quoted phrases (e.g. "Arizona",
  "USGS", a film title in quotes). This produced the handful of 30-76% WER outliers that drag
  its average up; most utterances were fine (sub-10% WER). Canary and Whisper don't have this
  failure mode here because both take an explicit `language=de`.
- **Parakeet v3's CPU ONNX export (onnx-asr, via istupakov's export) cannot transcribe the
  10-minute file at all**: it fails with an onnxruntime broadcast shape error
  (`axis == 1 || axis == largest was false ... 2575 by 7575`) inside the encoder's self-attention,
  seemingly a limit in this particular ONNX export's positional handling for very long single-pass
  audio, not a resource exhaustion (the 1/3-minute files work fine, just with rising peak RSS:
  2.2 -> 3.7 GB). The GPU path never hits this because the server's own 0.5-15s contract forces
  chunking regardless of model - a point in favour of chunking even a CPU path, rather than relying
  on any of these models' nominal "up to N minutes in one pass" capability.
- **Canary 1B v2 on CPU needs careful onnxruntime settings to load at all here.** With the
  default settings (6 intra-op threads, onnxruntime's growing memory arena) *loading the model*
  alone pushed this agent's own 10 GiB memory cgroup over its limit and the kernel OOM-killed the
  process before a single utterance was transcribed. Reducing to 2 threads and disabling the CPU
  memory arena (`--intra-op-threads 2 --no-mem-arena`) fixed loading and let all 40 utterances run
  cleanly (4.5% WER, ~1.9 GB peak RSS). Even so, re-running with the long files included, memory
  grew from a ~6 GB session baseline to ~8.3-8.5 GB after only the 1- and 3-minute files - we
  stopped the process there rather than risk another OOM on the 10-minute file. **Canary's
  long-file numbers on CPU are missing from this spike for that reason.** This is itself a real
  practicality finding, not just an artefact of the agent's cgroup: a 1B-parameter encoder-decoder
  processing several minutes of audio in one non-chunked pass is memory-hungry in a way Whisper and
  Parakeet (whose peak RSS stayed flat regardless of file length) are not, and a 15 GB *shared* VM
  (this spike's actual target machine) has less headroom than it looks once other services and the
  yamt server itself are counted. If Canary is wanted on CPU, it should be chunked like the GPU
  path, not run as a single pass on long memos.
- Canary needs `language="de"` passed explicitly (confirmed in onnx-asr's NeMo AED model code);
  it does not auto-detect. Parakeet v3 does detect per utterance (and that's the source of its
  own failure mode above); Whisper was told `language="de"` throughout for a fair comparison.
- `huggingface_hub`'s cache hardlinks a model's snapshot files to a shared, content-addressed
  `blobs/` store. A naive directory-size walk (our first cut at measuring disk usage) counts
  each hardlinked file twice; `common.dir_size_mb` now dedupes by inode. Worth remembering if
  anyone else measures on-disk model size this way.
- Google FLEURS' WAV files are 32-bit float PCM (`soundfile` reports subtype `FLOAT`), not
  int16. Reading them with `dtype="int16"` silently truncates every sample (amplitudes are in
  `[-1, 1]`) to zero - caught here because every model "transcribed" silence as Whisper's classic
  hallucination, "Vielen Dank." Fixed in `fetch_fleurs.py` by reading as float32 throughout.
- Downloads from Hugging Face without an `HF_TOKEN` ran at roughly 1-1.3 MB/s on this VM and on
  km-pc, slower than vibe-center's own benchmarks (6-9 MB/s) - possibly rate limiting or just
  this network path. Worth setting an `HF_TOKEN` for phase 2 if re-downloading is needed.

## Recommendation

For transcribing async German meal memos (minutes are fine, no real-time constraint), on this
phase-1 evidence: **CPU-only with faster-whisper large-v3-turbo (int8) as the default**, not the
GPU path, and not Parakeet or Canary on CPU as currently packaged.

- Whisper CPU was the most accurate of all six configurations on isolated utterances (3.2%),
  handled all three long files without incident (RTF ~0.19-0.23, i.e. a 10-minute memo
  transcribes in ~2 minutes on this VM's CPU), and used a flat, modest ~1.7 GB peak RAM
  regardless of file length. It needs no explicit chunking and no GPU lifecycle.
- Parakeet v3 CPU is faster (RTF 0.04-0.08) but noticeably less accurate here (13.9%, pulled up
  by code-switch outliers) and cannot safely transcribe a 10-minute memo in one pass at all on
  CPU. Canary CPU is accurate (4.5%) but risky to run on anything beyond short clips in this
  VM's memory budget, and we could not validate it on long files at all in this spike.
- The GPU path is fast and accurate for every model (Canary 4.2%, Whisper 3.5%, Parakeet 5.0%,
  all with RTF well under 0.02 once chunked) and the full wake-to-sleep lifecycle for a 3-minute
  memo is only ~37s - genuinely not a problem for an async flow. But it adds real operational
  complexity for a modest accuracy gain over CPU Whisper (4.2% vs 3.2%, in the *other*
  direction - CPU Whisper actually won on accuracy in this run): a wake/sleep lifecycle, a
  "someone's using the GPU" courtesy check, chunking logic, and a second code path to maintain
  in the transcription worker (#9). Given CPU Whisper is already the accuracy leader, the GPU
  path's case rests on raw speed, which doesn't matter for an async job measured in minutes.

If phase 2's real-memo accuracy or the downstream "extract ingredients with grams" check shows
Whisper's CPU errors actually change what gets logged (the issue's own bar: "if the extraction
is equivalent, the cheaper STT wins"), that would be the reason to revisit the GPU path - not
raw FLEURS WER or speed, both of which already favour staying on CPU for wave 1.

## Open questions for phase 2

- Phase 1 used clean, read, single-speaker FLEURS audio. The user's real memos are
  spontaneous, cooking-noise-adjacent, sometimes long single takes with corrections
  ("nee warte, doch 200 Gramm") - WER on FLEURS may not predict WER on those at all, and the
  long-file WER inflation seen here (concatenation-boundary artefacts) may not apply, or may be
  replaced by different real-world problems (overlapping speech with a TV/radio, pots clattering).
- Does Whisper's CPU transcript actually produce a better downstream "ingredients + grams"
  extraction than Parakeet's or Canary's, or does the LLM extraction step smooth over STT
  differences either way? (The issue's downstream check, deferred to phase 2.)
- Voice Memos `.m4a` vs Safari `MediaRecorder` `audio/mp4`: do both decode/resample the same
  through ffmpeg, and does either show audio artefacts (AAC bitrate, mono downmix) that change
  the picture?
- Does Canary's CPU memory problem (this spike) disappear with different onnxruntime settings
  we didn't try (e.g. `execution_mode` sequential vs parallel, a smaller chunk size even on
  CPU to bound memory the way the GPU path already does), or is it inherent to a 1B-parameter
  AED model run single-pass on CPU? Worth a quick follow-up before ruling Canary out entirely,
  since its accuracy (4.5% CPU, matching the GPU number) was otherwise the best German-specific
  result in this spike.
- German numbers and compounds: FLEURS references spell numbers as words ("zweihundert") while
  Parakeet writes digits ("200"); our WER normalisation does not reconcile this (see the spike's
  README), so part of Parakeet's WER gap may be cosmetic rather than a real transcription error
  for yamt's purposes (a downstream LLM extracting grams handles either form). Worth checking
  directly once phase 2 has real transcripts to feed to the extraction step.
