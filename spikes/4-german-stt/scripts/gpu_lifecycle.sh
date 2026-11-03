#!/usr/bin/env bash
# Times the GPU host's wake -> speech.sh up -> health lifecycle, and (separately) down -> sleep,
# so phase-1's "memo arrives while km-pc sleeps" end-to-end number can be built from parts:
#   total = wake_s + up_s + transcribe_s (run_gpu.py) + down_s + sleep_s
#
# Usage: scripts/gpu_lifecycle.sh up | down
set -euo pipefail
SPEECH_SH=/data/src/vibe-center/services/speech-gpu/speech.sh

elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }

case "${1:-}" in
  up)
    echo "gpu status before:"
    gpu status || true
    t0=$(date +%s.%N)
    gpu wake
    t1=$(date +%s.%N)
    echo "wake_s=$(elapsed "$t0" "$t1")"
    "$SPEECH_SH" up
    t2=$(date +%s.%N)
    echo "speech_up_s=$(elapsed "$t1" "$t2")"
    echo "wake_plus_up_s=$(elapsed "$t0" "$t2")"
    ;;
  down)
    t0=$(date +%s.%N)
    "$SPEECH_SH" down
    t1=$(date +%s.%N)
    echo "speech_down_s=$(elapsed "$t0" "$t1")"
    gpu sleep
    t2=$(date +%s.%N)
    echo "sleep_s=$(elapsed "$t1" "$t2")"
    echo "down_plus_sleep_s=$(elapsed "$t0" "$t2")"
    gpu status || true
    ;;
  *)
    echo "usage: $0 up|down" >&2; exit 2 ;;
esac
