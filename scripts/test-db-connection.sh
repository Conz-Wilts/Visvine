#!/usr/bin/env bash
# =============================================================================
# test-db-connection.sh
#
# Tests that PostgreSQL is reachable through the Cloud SQL Auth Proxy.
# Requires: psql CLI installed, proxy already running, .env loaded.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:?DB_USER not set}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD not set}"
DB_NAME="${DB_NAME:?DB_NAME not set}"

echo "Testing connection to PostgreSQL..."
echo "  Host    : $DB_HOST:$DB_PORT"
echo "  User    : $DB_USER"
echo "  Database: $DB_NAME"
echo ""

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install with: brew install libpq && brew link libpq --force"
  exit 1
fi

PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "SELECT version();" \
  && echo "" \
  && echo "✓ Connection successful!"
