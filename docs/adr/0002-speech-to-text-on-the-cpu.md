# 0002. Speech-to-text: faster-whisper on this VM's CPU, one Python process per batch

## Status

Accepted, 2026-11-03 (#9), on spike #4's phase 1 evidence. Phase 2 (the user's real memos) may
tune the settings or bring back the GPU host as a second backend; this ADR then gets a successor.

## Context

Voice memos are the main capture: German, dictated while cooking or eating, from a few seconds to
about ten minutes, transcribed asynchronously (minutes are fine). Epic #2 left open whether to
transcribe on this always-on VM (6 vCPU, 15 GB RAM, shared with other services) or on the
user's gaming PC (RTX 3070) through vibe-center's `services/speech-gpu`, woken and put back to
sleep with the `gpu` CLI.

Spike #4 measured both on public German speech (FLEURS): Whisper large-v3-turbo int8 on the CPU
was the most accurate configuration (3.2 % WER), handled every length with a flat ~1.7 GB, at a
real-time factor of ~0.2 (a 3-minute memo in ~40 s). The GPU path is faster (RTF ≤ 0.02, ~37 s
end to end for a 3-minute memo including wake and sleep) but adds a wake/sleep lifecycle, a
"someone is using the PC" check, chunking to the server's ≤ 15 s inputs and a second code path,
for no accuracy gain. The good models are Python (CTranslate2); the server is Bun.

## Decision

1. **faster-whisper large-v3-turbo, int8, `language="de"`, on the VM's CPU**, with Silero VAD,
   greedy decoding and timestamps on. Model, compute type, threads, beam size, VAD, language
   and an initial prompt are configuration, and every transcript records what it ran with.
2. **A Python sidecar, `services/stt`**, a uv project in vibe-center's style (pinned, locked,
   ruff, pytest, its own `check:stt` gate step), invoked by the Bun worker. No Python in the
   server process, no Bun bindings to CTranslate2.
3. **One short-lived process per batch, not a resident server.** The `transcribe` handler
   claims the due jobs, normalises each original with ffmpeg to 16 kHz mono WAV, and runs one
   process that loads the model once, answers each file as NDJSON on stdout and exits. The model's
   memory is held only while there is work; the ~3–5 s load per batch is negligible for an async
   job. The process runs niced with 4 of 6 threads.
4. **The backend sits behind one small interface** (`SttBackend`: a batch of WAVs in, results
   out), so the GPU host's OpenAI-style `/v1/audio/transcriptions` can become a second backend
   (or a fallback) without touching the job, the queue or the data model.
5. **Tools are found, not assumed**: uv and ffmpeg from PATH, else linked from nixpkgs on first
   use (this VM is NixOS), else a configured path; a missing tool fails transcripts with a clear
   error rather than blocking analyses.

## Consequences

- No second machine is involved: a memo is transcribed whether or not the gaming PC is on, in
  Windows or in use, and nothing has to be woken or put to sleep.
- A 10-minute memo takes about two minutes and ~1.7 GB while it runs; several memos arriving
  together share one model load. The VM's other services keep two cores.
- The first memo downloads the model (~1.6 GB) and the first start of the sidecar installs its
  wheels; both are logged. Models live in `<data>/models`, not in the repo.
- The repo now has a Python project with its own toolchain and CI job, and a JSON-lines protocol
  between Bun and Python that both sides must keep in step (tests on each side: a fake STT process
  for Bun, a stub backend for Python).
- If phase 2 shows that CPU Whisper's errors change what gets logged, the GPU backend is an
  addition behind `SttBackend`, not a rewrite.
