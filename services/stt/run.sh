#!/usr/bin/env bash
# The speech-to-text process (or a command in its environment). The yamt server's transcribe jobs
# start it once per batch; it reads the request from stdin and answers with NDJSON on stdout.
#   ./run.sh transcribe      one batch: request JSON on stdin (see yamt_stt/__main__.py)
#   ./run.sh check           ruff + pytest (stub backend; never downloads a model)
#   ./run.sh smoke           a real transcription with Whisper tiny (~75 MB download), outside the gate
#   ./run.sh <cmd...>        run a command in the venv, e.g. ./run.sh python -m yamt_stt --help
# uv comes from PATH, else from nix (linked as .uv). The venv is synced on every start (fast when
# nothing changed); uv provides Python 3.12 itself.
set -euo pipefail
cd "$(dirname "$0")"

UV=$(command -v uv || true)
if [ -z "$UV" ]; then
  if [ ! -x .uv/bin/uv ]; then
    command -v nix >/dev/null || { echo "stt: uv is not installed (https://docs.astral.sh/uv/) and nix is not available to provide it" >&2; exit 127; }
    echo "stt: linking uv from nixpkgs (first run)…" >&2
    nix build nixpkgs#uv -o .uv >&2
  fi
  UV=$PWD/.uv/bin/uv
fi
[ -d .venv ] || echo "stt: creating the Python environment (first run, ~300 MB of wheels)…" >&2
"$UV" sync --frozen --quiet >&2

case "${1:-}" in
  transcribe) shift; exec "$UV" run --frozen --no-sync python -m yamt_stt "$@" ;;
  check)
    "$UV" run --frozen --no-sync ruff check .
    "$UV" run --frozen --no-sync ruff format --check .
    exec "$UV" run --frozen --no-sync pytest -q -p no:cacheprovider ;;
  smoke) exec env YAMT_STT_SMOKE=1 "$UV" run --frozen --no-sync pytest -q -p no:cacheprovider tests/test_smoke.py ;;
  "") echo "usage: run.sh transcribe | check | smoke | <cmd...>" >&2; exit 2 ;;
  *) exec "$UV" run --frozen --no-sync "$@" ;;
esac
