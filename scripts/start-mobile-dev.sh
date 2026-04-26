#!/usr/bin/env bash
# Start Cloud SQL proxy in the background, then run Expo in the foreground
# so Metro gets a real TTY and keyboard shortcuts (i/a/w/r) work.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_DIR="$REPO_ROOT/.logs"
mkdir -p "$LOG_DIR"
PROXY_LOG="$LOG_DIR/cloud-sql-proxy.log"

# Start proxy only if it's not already listening on 5433.
if lsof -iTCP:5433 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✓ Cloud SQL proxy already running on 127.0.0.1:5433"
  PROXY_PID=""
else
  echo "→ Starting Cloud SQL proxy (logs: $PROXY_LOG)"
  bash "$SCRIPT_DIR/start-cloud-sql-proxy.sh" >"$PROXY_LOG" 2>&1 &
  PROXY_PID=$!

  # Wait up to ~15s for proxy to come up
  for _ in $(seq 1 30); do
    if lsof -iTCP:5433 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.5
  done

  if ! lsof -iTCP:5433 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ Cloud SQL proxy failed to start. See $PROXY_LOG"
    exit 1
  fi
  echo "✓ Cloud SQL proxy listening on 127.0.0.1:5433 (pid $PROXY_PID)"
fi

cleanup() {
  if [[ -n "${PROXY_PID:-}" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "→ Stopping Cloud SQL proxy (pid $PROXY_PID)"
    kill "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "→ Starting Expo (press i for iOS, a for Android, w for web, r to reload)"
exec pnpm --filter @visvine/mobile start
