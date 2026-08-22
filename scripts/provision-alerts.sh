#!/usr/bin/env bash
#
# Create the alert policies that turn "the error is in the logs" into "someone
# is told". Structured logging (lib/logger.ts) is what makes these possible —
# every logger.error() lands as a ReportedErrorEvent — but a log nobody reads is
# not monitoring, and these policies are the difference.
#
# Four things worth being woken for:
#
#   1. server errors     a sustained rate of logger.error() — the app failing
#   2. 5xx responses     Cloud Run answering with errors, including the ones
#                        that never reach app code (OOM, cold-start failure)
#   3. uptime            the site not answering /api/health at all, checked from
#                        outside the project
#   4. scheduler failure the agent tick or the nightly sweep not completing —
#                        the silent failures, which no user will report
#
# Idempotent by name: an existing policy of the same display name is left alone
# rather than duplicated. Delete it first to change one. Nothing here needs the
# console — the uptime check and the policy that notifies on it are separate
# objects, and both are created.
#
# Usage:
#   NOTIFY_EMAIL=you@example.com bash scripts/provision-alerts.sh
set -euo pipefail

PROJECT="${PROJECT:-visvine-platform}"
SERVICE="${SERVICE:-visvine-web}"
HOST="${HOST:-visvine.com}"
NOTIFY_EMAIL="${NOTIFY_EMAIL:?set NOTIFY_EMAIL to the address alerts should go to}"

echo "Project: $PROJECT   Service: $SERVICE   Notify: $NOTIFY_EMAIL"

# ── notification channel ──────────────────────────────────────────────────────
# Both sides must be quoted: unquoted, the Monitoring filter parser reads
# `email` as a field reference rather than the literal string, and rejects it.
CHANNEL=$(gcloud beta monitoring channels list --project="$PROJECT" \
  --filter="type=\"email\" AND labels.email_address=\"$NOTIFY_EMAIL\"" \
  --format='value(name)' | head -1)

if [ -z "$CHANNEL" ]; then
  echo "Creating email notification channel…"
  CHANNEL=$(gcloud beta monitoring channels create \
    --project="$PROJECT" \
    --display-name="Visvine alerts" \
    --type=email \
    --channel-labels="email_address=$NOTIFY_EMAIL" \
    --format='value(name)')
fi
echo "Channel: $CHANNEL"

policy_exists() {
  gcloud alpha monitoring policies list --project="$PROJECT" \
    --filter="displayName=\"$1\"" --format='value(name)' | grep -q .
}

create_policy() {
  local name="$1" file="$2"
  if policy_exists "$name"; then
    echo "· $name already exists — leaving it alone"
    rm -f "$file"
    return
  fi
  echo "· creating $name"
  gcloud alpha monitoring policies create --project="$PROJECT" --policy-from-file="$file"
  rm -f "$file"
}

# The X's must be the LAST characters of the template — a suffix after them is
# not a portable mktemp, and fails outright on macOS. JSON is valid YAML, so
# gcloud sniffs the policy file's format without needing an extension.
tmp() { mktemp "${TMPDIR:-/tmp}/visvine-alert.XXXXXXXX"; }

# ── log-based metrics ─────────────────────────────────────────────────────────
# Two different filter languages are in play and confusing them is the easy
# mistake here. A log-based METRIC is defined with the Logging query language,
# which understands `severity>=ERROR`. A monitoring POLICY filters over the
# resulting time series with the Monitoring filter language, where every term
# must start with metric/resource/project/group/metadata — `severity` is not a
# term it knows. So the severity test belongs in the metric, and the policy
# alerts on the counter the metric produces.
log_metric() {
  local name="$1" description="$2" filter="$3"
  if gcloud logging metrics describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    echo "· log metric $name already exists"
  else
    echo "· creating log metric $name"
    gcloud logging metrics create "$name" \
      --project="$PROJECT" \
      --description="$description" \
      --log-filter="$filter"
  fi
}

log_metric visvine_server_errors \
  "ERROR-severity entries from the $SERVICE Cloud Run service (every logger.error())" \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND severity>=ERROR"

log_metric visvine_scheduler_failures \
  "Cloud Scheduler job attempts that did not succeed" \
  "resource.type=\"cloud_scheduler_job\" AND severity>=ERROR"

# A freshly created log-based metric has no time series until it first matches,
# and a policy cannot be created against a metric type that does not exist yet.
sleep 10

# ── 1. application error rate ─────────────────────────────────────────────────
# The threshold is a RATE, not a single event: one error is normal operation
# somewhere in any system; a sustained five per minute for five minutes is not.
f=$(tmp); cat > "$f" <<JSON
{
  "displayName": "Visvine — server error rate",
  "combiner": "OR",
  "conditions": [{
    "displayName": "logger.error() > 5/min for 5 min",
    "conditionThreshold": {
      "filter": "metric.type=\"logging.googleapis.com/user/visvine_server_errors\" AND resource.type=\"cloud_run_revision\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 5,
      "duration": "300s",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_SUM",
        "crossSeriesReducer": "REDUCE_SUM"
      }]
    }
  }],
  "notificationChannels": ["$CHANNEL"],
  "alertStrategy": { "autoClose": "3600s" }
}
JSON
create_policy "Visvine — server error rate" "$f"

# ── 2. 5xx response rate ──────────────────────────────────────────────────────
# Catches what app-level logging cannot: a container that died before it could
# log, a request that timed out, a revision that never became ready.
f=$(tmp); cat > "$f" <<JSON
{
  "displayName": "Visvine — 5xx responses",
  "combiner": "OR",
  "conditions": [{
    "displayName": "5xx > 3/min for 5 min",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 3,
      "duration": "300s",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_RATE",
        "crossSeriesReducer": "REDUCE_SUM"
      }]
    }
  }],
  "notificationChannels": ["$CHANNEL"],
  "alertStrategy": { "autoClose": "3600s" }
}
JSON
create_policy "Visvine — 5xx responses" "$f"

# ── 3. uptime check ───────────────────────────────────────────────────────────
# Checked from outside the project, because every in-project signal shares a
# failure domain with the thing it is watching. Hits the shallow probe: this
# asks "is the site answering", and a database outage has its own alert.
CHECK_ID=$(gcloud monitoring uptime list-configs --project="$PROJECT" \
  --filter="displayName=\"Visvine — health\"" --format='value(name)' | head -1)

if [ -z "$CHECK_ID" ]; then
  echo "· creating uptime check"
  gcloud monitoring uptime create "Visvine — health" \
    --project="$PROJECT" \
    --resource-type=uptime-url \
    --resource-labels="host=$HOST,project_id=$PROJECT" \
    --path="/api/health" \
    --port=443 \
    --protocol=https \
    --period=5 \
    --timeout=10
  CHECK_ID=$(gcloud monitoring uptime list-configs --project="$PROJECT" \
    --filter="displayName=\"Visvine — health\"" --format='value(name)' | head -1)
else
  echo "· uptime check already exists"
fi
# The check only records a metric; the POLICY is what notifies. They are separate
# objects, so the check's id has to be looked up and threaded in here.
CHECK_ID="${CHECK_ID##*/}"
f=$(tmp); cat > "$f" <<JSON
{
  "displayName": "Visvine — site unreachable",
  "combiner": "OR",
  "conditions": [{
    "displayName": "/api/health not answering",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.labels.check_id=\"$CHECK_ID\"",
      "comparison": "COMPARISON_LT",
      "thresholdValue": 0.5,
      "duration": "300s",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_FRACTION_TRUE",
        "crossSeriesReducer": "REDUCE_MEAN",
        "groupByFields": ["resource.label.host"]
      }]
    }
  }],
  "notificationChannels": ["$CHANNEL"],
  "alertStrategy": { "autoClose": "3600s" }
}
JSON
create_policy "Visvine — site unreachable" "$f"

# ── 4. scheduler job failures ─────────────────────────────────────────────────
# The agent tick and the nightly sweep have no user to notice they stopped. This
# is the only thing that will.
f=$(tmp); cat > "$f" <<JSON
{
  "displayName": "Visvine — scheduler job failing",
  "combiner": "OR",
  "conditions": [{
    "displayName": "a Cloud Scheduler job errored",
    "conditionThreshold": {
      "filter": "metric.type=\"logging.googleapis.com/user/visvine_scheduler_failures\" AND resource.type=\"cloud_scheduler_job\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0,
      "duration": "600s",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_SUM",
        "crossSeriesReducer": "REDUCE_SUM"
      }]
    }
  }],
  "notificationChannels": ["$CHANNEL"],
  "alertStrategy": { "autoClose": "3600s" }
}
JSON
create_policy "Visvine — scheduler job failing" "$f"

echo
echo "Done. Review at https://console.cloud.google.com/monitoring/alerting?project=$PROJECT"
echo "Error Reporting groups every logger.error() at:"
echo "  https://console.cloud.google.com/errors?project=$PROJECT"
