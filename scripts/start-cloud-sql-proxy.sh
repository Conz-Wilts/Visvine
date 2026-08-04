#!/usr/bin/env bash
# =============================================================================
# start-cloud-sql-proxy.sh
#
# Starts the Cloud SQL Auth Proxy for local development.
# The proxy listens on 127.0.0.1:5432 and forwards connections to Cloud SQL.
#
# Prerequisites:
#   1. cloud-sql-proxy installed (~/bin/cloud-sql-proxy)
#   2. gcloud CLI installed and authenticated:
#        gcloud auth application-default login
#   3. CLOUD_SQL_CONNECTION_NAME set in .env (loaded below)
#
# Usage:
#   ./scripts/start-cloud-sql-proxy.sh
#   pnpm db:proxy
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Load .env from repo root (one level up from scripts/)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../apps/web/.env"

if [[ -f "$ENV_FILE" ]]; then
  # Export variables from .env, skipping comments and blank lines
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: .env file not found at $ENV_FILE"
  exit 1
fi

# ---------------------------------------------------------------------------
# Validate required variables
# ---------------------------------------------------------------------------
if [[ -z "${CLOUD_SQL_CONNECTION_NAME:-}" ]]; then
  echo "ERROR: CLOUD_SQL_CONNECTION_NAME is not set in .env"
  echo "  Expected format: project:region:instance"
  echo "  Example: my-gcp-project:us-central1:my-instance"
  exit 1
fi

# PROXY_PORT is the local port the proxy listens on. It defaults to 5433 so the
# proxy can run alongside the Docker Postgres on 5432 (DB_PORT is only a
# fallback, for envs that still use the discrete DB_* form).
DB_PORT="${PROXY_PORT:-${DB_PORT:-5433}}"
DB_HOST="${DB_HOST:-127.0.0.1}"

# ---------------------------------------------------------------------------
# Locate cloud-sql-proxy binary
# ---------------------------------------------------------------------------
PROXY_BIN=""
for candidate in \
  "$HOME/bin/cloud-sql-proxy.exe" \
  "$HOME/bin/cloud-sql-proxy" \
  "/usr/local/bin/cloud-sql-proxy" \
  "$(which cloud-sql-proxy.exe 2>/dev/null || true)" \
  "$(which cloud-sql-proxy 2>/dev/null || true)"
do
  if [[ -n "$candidate" && -f "$candidate" ]]; then
    PROXY_BIN="$candidate"
    break
  fi
done

if [[ -z "$PROXY_BIN" ]]; then
  echo "ERROR: cloud-sql-proxy not found."
  echo ""
  echo "Install it with:"
  echo "  curl -o ~/bin/cloud-sql-proxy \\"
  echo "    https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.15.2/cloud-sql-proxy.darwin.arm64"
  echo "  chmod +x ~/bin/cloud-sql-proxy"
  exit 1
fi

# ---------------------------------------------------------------------------
# Check if port is already in use (portable: bash /dev/tcp, no lsof needed)
# ---------------------------------------------------------------------------
if (exec 3<>/dev/tcp/"$DB_HOST"/"$DB_PORT") 2>/dev/null; then
  exec 3>&- 3<&-
  echo "✓ Cloud SQL Proxy already running on $DB_HOST:$DB_PORT"
  echo ""
  echo "Proxy is running. Press Ctrl+C to stop monitoring."
  # Keep the script running so concurrently doesn't exit
  while true; do
    sleep 60
  done
fi

# ---------------------------------------------------------------------------
# Start proxy
# ---------------------------------------------------------------------------
echo "Starting Cloud SQL Auth Proxy..."
echo "  Instance : $CLOUD_SQL_CONNECTION_NAME"
echo "  Listening: $DB_HOST:$DB_PORT"
echo "  Binary   : $PROXY_BIN"
echo ""
echo "Press Ctrl+C to stop."
echo ""

exec "$PROXY_BIN" \
  --address "$DB_HOST" \
  --port "$DB_PORT" \
  "$CLOUD_SQL_CONNECTION_NAME"
