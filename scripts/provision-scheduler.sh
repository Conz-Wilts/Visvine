#!/usr/bin/env bash
#
# Create or update the Cloud Scheduler jobs that drive this deployment.
#
# There are two, and neither is optional:
#
#   agent-tick        every minute. Claims due agent runs and dispatches them,
#                     and drains the note projection outbox on the way past.
#   nightly-maintenance  once a day. Embedding sweep, link reasons, storage drift
#                     audit, rate-limit bucket reclamation. On a scale-to-zero
#                     runtime this CANNOT be an in-process timer — at 3am there
#                     is generally no instance alive holding one — so the job is
#                     the only thing that runs it (lib/notes/shared/nightly.ts).
#
# Both endpoints authenticate the caller as Google OIDC from a dedicated service
# account, with the audience pinned to the endpoint's own URL. That pinning is
# why each job needs its own --oidc-token-audience: a token minted for the tick
# is refused by the nightly endpoint and vice versa.
#
# Idempotent — `create` falls back to `update`, so re-running after a change to
# the schedule or the URL converges rather than erroring.
#
# Usage:  bash scripts/provision-scheduler.sh
set -euo pipefail

PROJECT="${PROJECT:-visvine-platform}"
REGION="${REGION:-australia-southeast1}"
APP_URL="${APP_URL:-https://visvine.com}"
# Must match the AGENT_TICK_SERVICE_ACCOUNT the service is deployed with —
# the app compares the token's verified email against it.
SA="${AGENT_TICK_SERVICE_ACCOUNT:-visvine-agent-tick@${PROJECT}.iam.gserviceaccount.com}"
# Server-local hour for the nightly sweep. Cloud Scheduler needs the zone named
# explicitly; the app's own default (3am) is only used by the in-process driver.
TIMEZONE="${SCHEDULER_TIMEZONE:-Pacific/Auckland}"

# Job names are matched exactly. If a tick job already exists under a DIFFERENT
# name, creating one here does not replace it — it adds a second job hitting the
# same endpoint, and the tick then runs twice a minute. Override to adopt the
# existing name rather than duplicate it.
TICK_JOB="${TICK_JOB:-visvine-agent-tick}"
NIGHTLY_JOB="${NIGHTLY_JOB:-visvine-nightly-maintenance}"

echo "Existing jobs in $PROJECT/$REGION:"
gcloud scheduler jobs list --location="$REGION" --project="$PROJECT" \
  --format='table(name.basename():label=NAME, schedule, state, httpTarget.uri:label=URI)' || true
echo
echo "About to upsert: $TICK_JOB, $NIGHTLY_JOB"
echo "If a job above already targets one of these endpoints under a different"
echo "name, re-run with TICK_JOB=<that name> so it is updated, not duplicated."
read -r -p "Continue? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || { echo "aborted"; exit 1; }
echo

upsert() {
  local name="$1" schedule="$2" path="$3" deadline="$4"
  local url="${APP_URL}${path}"
  local common=(
    --location="$REGION"
    --project="$PROJECT"
    --schedule="$schedule"
    --time-zone="$TIMEZONE"
    --uri="$url"
    --http-method=POST
    --oidc-service-account-email="$SA"
    --oidc-token-audience="$url"
    --attempt-deadline="$deadline"
    --headers="Content-Type=application/json"
    --message-body={}
  )

  if gcloud scheduler jobs describe "$name" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
    echo "updating $name -> $url"
    gcloud scheduler jobs update http "$name" "${common[@]}"
  else
    echo "creating $name -> $url"
    gcloud scheduler jobs create http "$name" "${common[@]}"
  fi
}

# The tick awaits every run it fans out, so its deadline has to clear the
# longest agent run plus dispatch overhead (see the route's maxDuration).
upsert "$TICK_JOB" "* * * * *" "/api/internal/agents/tick" "1800s"

# 03:10 rather than 03:00: nothing else is scheduled on the hour, and a sweep
# that starts on a clean minute boundary is harder to tell apart from a tick in
# the logs.
upsert "$NIGHTLY_JOB" "10 3 * * *" "/api/internal/maintenance/nightly" "1800s"

echo
echo "Jobs provisioned. Verify with:"
echo "  gcloud scheduler jobs list --location=$REGION --project=$PROJECT"
echo "Force one now (it is safe — every stage is idempotent):"
echo "  gcloud scheduler jobs run $NIGHTLY_JOB --location=$REGION --project=$PROJECT"
