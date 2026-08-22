#!/usr/bin/env bash
#
# Rehearse the restore. A backup nobody has ever restored is a belief, not a
# capability, and the moment you discover which is during the outage.
#
# This clones production to a THROWAWAY instance at a point in time, connects to
# the clone, and checks it is a real, complete database — then deletes it. It
# never touches the production instance: `gcloud sql instances clone` reads the
# backup and transaction logs and builds a new instance from them, which is
# exactly the operation a real recovery performs.
#
# What it proves, in order of what actually goes wrong:
#   • point-in-time recovery is genuinely enabled and the logs cover the window
#   • the clone reaches RUNNABLE (the backup is not corrupt)
#   • the schema is there and migration tracking came with it
#   • the tables that hold irreplaceable data are non-empty
#
# Run it quarterly, and after any change to the backup configuration. It costs
# one instance-hour and about fifteen minutes of waiting.
#
# Usage:
#   bash scripts/restore-drill.sh                 # clone to "now minus 10 min"
#   RESTORE_POINT=2026-08-20T14:32:00Z bash scripts/restore-drill.sh
#   KEEP_CLONE=1 bash scripts/restore-drill.sh    # leave it up to poke at
set -euo pipefail

PROJECT="${PROJECT:-visvine-platform}"
INSTANCE="${SQL_INSTANCE_NAME:-visvine-pgdata}"
DB="${DB_NAME:-visvine}"
CLONE="${CLONE_NAME:-${INSTANCE}-drill-$(date +%Y%m%d-%H%M%S)}"
KEEP_CLONE="${KEEP_CLONE:-}"

# Ten minutes back, so the transaction logs certainly cover it. A drill that
# asks for "this exact instant" tests the clock, not the backups.
RESTORE_POINT="${RESTORE_POINT:-$(date -u -v-10M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)}"

cleanup() {
  if [ -n "$KEEP_CLONE" ]; then
    echo
    echo "KEEP_CLONE set — leaving $CLONE up. Delete it when you are done:"
    echo "  gcloud sql instances delete $CLONE --project=$PROJECT"
    return
  fi
  if gcloud sql instances describe "$CLONE" --project="$PROJECT" >/dev/null 2>&1; then
    echo
    echo "Deleting the clone…"
    # Clones inherit deletion protection from the source, so it has to come off
    # before this can succeed. The source instance is never touched.
    gcloud sql instances patch "$CLONE" --project="$PROJECT" --no-deletion-protection --quiet >/dev/null 2>&1 || true
    gcloud sql instances delete "$CLONE" --project="$PROJECT" --quiet
  fi
}
trap cleanup EXIT

echo "Restore drill"
echo "  source:        $PROJECT:$INSTANCE"
echo "  restore point: $RESTORE_POINT"
echo "  clone:         $CLONE"
echo

echo "→ Cloning (this takes several minutes)…"
gcloud sql instances clone "$INSTANCE" "$CLONE" \
  --project="$PROJECT" \
  --point-in-time="$RESTORE_POINT"

state=$(gcloud sql instances describe "$CLONE" --project="$PROJECT" --format='value(state)')
echo "→ Clone state: $state"
if [ "$state" != "RUNNABLE" ]; then
  echo "FAIL: the clone did not reach RUNNABLE. The backup or the transaction logs are not usable."
  exit 1
fi

echo "→ Verifying the restored database…"
# Run the checks through the proxy against the clone. A password is needed only
# for this session; the drill user is created and dropped inside the clone.
PORT="${DRILL_PORT:-5439}"
PW="$(openssl rand -hex 16)"
gcloud sql users create drill --instance="$CLONE" --project="$PROJECT" --password="$PW" --quiet

curl -sL "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.15.2/cloud-sql-proxy.$(uname -s | tr '[:upper:]' '[:lower:]').amd64" -o /tmp/cloud-sql-proxy-drill
chmod +x /tmp/cloud-sql-proxy-drill
/tmp/cloud-sql-proxy-drill --address 127.0.0.1 --port "$PORT" "$PROJECT:$(gcloud sql instances describe "$CLONE" --project="$PROJECT" --format='value(region)'):$CLONE" &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null || true; cleanup' EXIT
sleep 8

export PGPASSWORD="$PW"
psql_q() { psql -h 127.0.0.1 -p "$PORT" -U drill -d "$DB" -tAc "$1"; }

fail=0
check() {
  local label="$1" query="$2" min="$3"
  local n
  n=$(psql_q "$query" || echo 0)
  if [ "${n:-0}" -ge "$min" ]; then
    echo "  ✓ $label: $n"
  else
    echo "  ✗ $label: $n (expected at least $min)"
    fail=1
  fi
}

check "tables"                "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 40
check "migrations tracked"    "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"       1
check "spaces"                "SELECT count(*) FROM spaces"                                                 1
check "users"                 "SELECT count(*) FROM users"                                                  1
# The notes ARE the product. A restore that brings back an empty context tree is
# a restore that has not worked, however healthy the instance looks.
check "context notes"         "SELECT count(*) FROM context_notes"                                          1

gcloud sql users delete drill --instance="$CLONE" --project="$PROJECT" --quiet >/dev/null 2>&1 || true

echo
if [ "$fail" -ne 0 ]; then
  echo "DRILL FAILED — the restored database is not complete. Investigate before relying on backups."
  exit 1
fi
echo "DRILL PASSED — production is restorable to an arbitrary point in time."
