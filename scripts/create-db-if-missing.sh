#!/usr/bin/env bash
# =============================================================================
# create-db-if-missing.sh
#
# Connects to the PostgreSQL instance through the proxy (as the configured user)
# and creates the target database if it does not already exist.
#
# Requires: proxy running, psql installed, .env loaded.
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

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install with: brew install libpq && brew link libpq --force"
  exit 1
fi

echo "Checking whether database '$DB_NAME' exists..."

EXISTS=$(PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "postgres" \
  -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';")

if [[ "$EXISTS" == "1" ]]; then
  echo "✓ Database '$DB_NAME' already exists — nothing to do."
else
  echo "Database '$DB_NAME' not found. Creating..."
  PGPASSWORD="$DB_PASSWORD" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "postgres" \
    -c "CREATE DATABASE \"$DB_NAME\";"
  echo "✓ Database '$DB_NAME' created successfully."
fi
