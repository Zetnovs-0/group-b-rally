#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to serve the game locally." >&2
  exit 1
fi

echo ""
echo "  GROUP B — RALLY LEGENDS"
echo "  http://localhost:${PORT}/"
echo "  Press Ctrl+C to stop the server."
echo ""

python3 -m http.server "$PORT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

sleep 0.7
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${PORT}/" >/dev/null 2>&1 || true
fi

wait "$SERVER_PID"
