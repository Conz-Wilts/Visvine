# Operations runbook

What production is made of, how it is released, and what to do when it breaks.
Everything here is a command you can run — nothing in this file is a description
of clicks in a console.

Production is one Cloud Run service (`visvine-web`, `australia-southeast1`) in
front of one Cloud SQL Postgres instance (`visvine-pgdata`), with two Cloud
Scheduler jobs driving background work and two GCS buckets holding media and
resources. Local dev runs against Docker Postgres and shares zero data with it.

---

## Release

`push to main` → `.github/workflows/deploy.yml`. The order is deliberate:

1. **Capture the serving revision.** The rollback target, recorded before
   anything changes.
2. **Build and push the image.** Everything after this mutates production, so a
   build failure has to happen while production is still untouched.
3. **Snapshot the database.** An on-demand Cloud SQL backup labelled with the
   commit. Non-blocking — PITR still covers the window if it fails.
4. **Migrate.** `prod-schema-presync` → `baseline-migrations` → `migrate deploy`
   → `apply-sql-functions`.
5. **Deploy the candidate with `--no-traffic`.** It starts, warms and gets a
   tagged URL while every user is still on the previous revision.
6. **Smoke test it.** `GET /api/health?deep=1` on the candidate URL, asserting
   both `ok: true` and that the answering revision is the one just built. Ten
   attempts, ten seconds apart.
7. **Route traffic**, and only then.

A failure at any step leaves production on the previous revision. The
`Roll back on failure` step re-pins traffic explicitly, for the one case
`--no-traffic` does not already cover (a partially-applied traffic update).

### Requiring an approval

`deploy.yml` names the `Production` GitHub environment, which gives the deploy a
deployment activity log and a place to scope secrets and variables.

Deployment **protection rules** — required reviewers, wait timers, branch
policies — are not available on this repo: they need GitHub Pro or Team for a
private repository, and the API refuses them with
`Please ensure the billing plan supports the required reviewers protection rule`.
Until the repo is on a plan that supports them, main→production is unattended,
and the canary + smoke test + rollback in the pipeline are what stand between a
bad commit and users. Once it is:

    gh api -X PUT repos/Conz-Wilts/Visvine/environments/Production \
      --input - <<'JSON'
    { "wait_timer": 0,
      "can_admins_bypass": false,
      "reviewers": [{ "type": "User", "id": 264718781 }],
      "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
    JSON

### Rolling back a release that passed the smoke test

Traffic is a pointer; the old revision is still there.

```bash
gcloud run revisions list --service=visvine-web --region=australia-southeast1 --project=visvine-platform
gcloud run services update-traffic visvine-web \
  --region=australia-southeast1 --project=visvine-platform \
  --to-revisions=visvine-web-<sha8>=100
```

This does **not** roll back the database. If the release included a migration
that the previous code cannot tolerate, restore instead — see *Recovery* below.
Migrations should be written expand-then-contract so this stays rare.

---

## After the FIRST deploy of the canary pipeline

Two things are deliberately switched off because they point at
`/api/health` and `/api/internal/maintenance/nightly`, which do not exist in
production until that deploy lands. Leaving them armed would just mean a night
of false alarms.

```bash
# The uptime alert — the check itself is already running and recording.
POLICY=$(gcloud alpha monitoring policies list --project=visvine-platform \
  --filter='displayName="Visvine — site unreachable"' --format='value(name)')
gcloud alpha monitoring policies update "$POLICY" --project=visvine-platform --enabled

# The nightly maintenance job, created paused.
gcloud scheduler jobs resume visvine-nightly-maintenance \
  --location=australia-southeast1 --project=visvine-platform

# Then prove it end to end. Look for notes.nightly.done in the logs.
gcloud scheduler jobs run visvine-nightly-maintenance \
  --location=australia-southeast1 --project=visvine-platform
```

Also worth doing once the pipeline is known good: **split the deploy and runtime
service accounts** (see Known limits), and run `pnpm ops:restore-drill` now that
point-in-time recovery is on.

---

## Health and monitoring

| | |
|---|---|
| `GET /api/health` | Liveness. Touches nothing external. Cloud Run's startup and liveness probes use this, which is why it must not depend on the database — a Cloud SQL outage would otherwise kill and restart every instance into the same outage. |
| `GET /api/health?deep=1` | Readiness. Round-trips Postgres. 503 when it cannot. Used by the deploy smoke test. |

Both are public and deliberately thin: they name which check failed, never why.
The reason is logged.

Every `logger.error()` is emitted as a Cloud Error Reporting `ReportedErrorEvent`
(`lib/logger.ts`), so errors are grouped by stack signature and are an alerting
source rather than text in a file. Next's own caught errors — a Server Component
that threw, a rejected route handler, a failed Server Action — reach the same
place through `onRequestError` in `instrumentation.ts`.

```
Errors     https://console.cloud.google.com/errors?project=visvine-platform
Logs       https://console.cloud.google.com/logs?project=visvine-platform
Alerting   https://console.cloud.google.com/monitoring/alerting?project=visvine-platform
```

Provision the alerts (idempotent; safe to re-run):

```bash
NOTIFY_EMAIL=you@example.com pnpm ops:alerts
```

That creates: server error rate, 5xx rate, an external uptime check on
`/api/health`, and scheduler-job failure. The uptime check needs its
notification channel attached in the console — gcloud cannot do both in one
step.

---

## Scheduled work

Two Cloud Scheduler jobs. Provision or update both with `pnpm ops:scheduler`.

| Job | Schedule | Endpoint |
|---|---|---|
| `visvine-agent-tick` | every minute | `/api/internal/agents/tick` |
| `visvine-nightly-maintenance` | 03:10 daily | `/api/internal/maintenance/nightly` |

Both authenticate as Google OIDC from `AGENT_TICK_SERVICE_ACCOUNT`, with the
audience pinned per-endpoint, so a token minted for one is refused by the other.

**The nightly job is not optional.** Cloud Run scales to zero, so the in-process
3am timer that a long-lived server would use is a sweep that never runs — at 3am
there is usually no instance holding it. The app detects this itself
(`K_SERVICE` is set by Cloud Run) and refuses to arm the timer, logging
`notes.nightly.delegated`. If you see that line and the scheduler job does not
exist, maintenance is running nowhere: embeddings go stale, link reasons stop
being generated, storage drift goes unreported, and rate-limit buckets are never
reclaimed. Override with `NIGHTLY_MAINTENANCE_DRIVER=in-process` only on a
deployment that genuinely stays up.

Force a run — every stage is idempotent, so this is safe at any time:

```bash
gcloud scheduler jobs run visvine-nightly-maintenance \
  --location=australia-southeast1 --project=visvine-platform
```

---

## Backups and recovery

Configuration lives in `scripts/backup-config.mjs` and is asserted, not assumed:

```bash
pnpm ops:backups:check   # exits 1 on drift, and if no recent backup succeeded
pnpm ops:backups:apply   # converge the configuration
```

Intended state: daily automated backups at 14:00 UTC (outside NZ hours), 14
retained, point-in-time recovery on with 7 days of transaction logs, deletion
protection on. The check also fails if the most recent backup is older than 36
hours or did not succeed — configuration being right is not evidence that a
backup happened.

### Rehearse it

```bash
pnpm ops:restore-drill
```

Clones production to a throwaway instance at a point in time, verifies the
schema, migration tracking and that the tables holding irreplaceable data are
non-empty, then deletes the clone. Production is never touched. **Run quarterly,
and after any change to the backup configuration** — a backup nobody has
restored is a belief, not a capability.

### Actually recovering

```bash
# 1. What are we restoring to? A moment BEFORE the damage.
RESTORE_POINT=2026-08-20T14:32:00Z

# 2. Clone to a new instance. Never restore over the live one — the clone is
#    where you confirm the data is what you think it is.
gcloud sql instances clone visvine-pgdata visvine-pgdata-recovered \
  --project=visvine-platform --point-in-time="$RESTORE_POINT"

# 3. Verify it (the drill script's checks, against the clone).
# 4. Point the service at it by updating the DATABASE_URL secret and
#    --add-cloudsql-instances, then deploy.
```

---

## Secrets

Managed in Secret Manager and injected at deploy time (`--set-secrets`). Nothing
secret is in the repo; `pnpm env:check` and the CI step guard that.

| Secret | What it protects |
|---|---|
| `DATABASE_URL` | Cloud SQL connection |
| `AUTH_SECRET` | Session JWTs, and the internal agent-run tokens |
| `SECRETS_KEY` | At-rest encryption of every connector secret and stored OAuth token |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google sign-in |
| `SUPER_ADMIN_EMAILS` | Per-space admin bypass |
| `GCS_MEDIA_BUCKET` / `GCS_RESOURCES_BUCKET` | Object storage |

### Rotating `SECRETS_KEY`

This one is different: it is the key that connector secrets and OAuth tokens are
encrypted under, so rotating it carelessly makes every stored secret
unrecoverable. There is a key ring (`lib/crypto/secrets.ts`) precisely so the
rotation is a procedure:

```bash
NEW=$(openssl rand -hex 32)

# 1. Accept both keys. Old ciphertext still reads; new writes use the new key.
gcloud secrets create SECRETS_KEY_PREVIOUS --data-file=<(gcloud secrets versions access latest --secret=SECRETS_KEY) --project=visvine-platform
printf '%s' "$NEW" | gcloud secrets versions add SECRETS_KEY --data-file=- --project=visvine-platform
# Add SECRETS_KEY_PREVIOUS to --set-secrets in deploy.yml, then deploy.

# 2. Re-encrypt everything under the new key. Idempotent; --dry-run first.
SECRETS_KEY="$NEW" SECRETS_KEY_PREVIOUS="<old>" pnpm db:secrets:rotate --dry-run
SECRETS_KEY="$NEW" SECRETS_KEY_PREVIOUS="<old>" pnpm db:secrets:rotate

# 3. Remove SECRETS_KEY_PREVIOUS from deploy.yml and deploy. The old key is inert.
```

Step 2 reports any value that decrypts under neither key and **leaves it
untouched** — an unreadable secret needs re-entering, an overwritten one is gone.

### Rotating the others

`AUTH_SECRET` invalidates every session and every in-flight internal run token;
users sign in again. The rest are ordinary: add a new version in Secret Manager
and redeploy, since `--set-secrets` resolves `:latest` at revision creation.

---

## Repository hardening

Applied to `Conz-Wilts/Visvine`, and worth re-checking after any settings change:

| Setting | State | Why |
|---|---|---|
| Actions `allowed_actions` | `selected` — GitHub-owned, verified, and `google-github-actions/*` | The deploy federates into GCP. Any third-party action that runs here can reach for those credentials, so the set of actions that may run is an allowlist, not "all". |
| Default workflow token | `read`, cannot approve PRs | Least privilege. Each workflow declares the permissions it actually needs. |
| WIF attribute condition | `assertion.repository=='Conz-Wilts/Visvine'` | The control that stops any other repository on GitHub from impersonating the service account. Never remove it. |
| Dependabot alerts + automated fixes | enabled | Complements the `pnpm audit` CI gate, which only sees what is in the lockfile at merge time. |
| `delete_branch_on_merge` | true | Hygiene. |
| Deploy keys / collaborators | none / owner only | |

Not available on this repo's plan: branch protection, rulesets, environment
protection rules, and `allow_forking=false` (org-owned private repos only).

## CI gates

`.github/workflows/ci.yml`, three jobs:

- **verify** — typecheck, lint (`--max-warnings=0`), the full test suite against
  a real pgvector Postgres, and knip. Migrations are replayed into the empty
  service container, which makes it a migration test too: SQL that only works
  against a database already carrying the shape it assumes fails in the PR.
- **desktop** — the Electron shell's own typecheck and tests, which no root
  script reaches.
- **audit** — `pnpm audit --prod --audit-level=high`, as a gate.

Transitive advisories are fixed with `pnpm.overrides` in the root
`package.json` wherever a patched version exists. One is allowlisted in
`pnpm.auditConfig.ignoreCves`, and package.json cannot carry the reason:

- **CVE-2026-40345** (`deepmerge-ts` stack exhaustion on recursive object
  graphs). Reached only via `@prisma/client → prisma → @prisma/config`, which is
  CLI tooling — it is not traced into the `output: "standalone"` runtime image
  and never sees untrusted input. The fix is a major bump inside Prisma's own
  config loader; remove this entry when Prisma ships it.

Re-check the allowlist whenever it is touched:

```bash
pnpm audit --prod --audit-level=high
```

---

## Known limits

Written down because they are decisions, not oversights.

- **Deploy and runtime share one service account.** GitHub Actions impersonates
  `visvine-cloudrun@` through workload identity federation, and that is also the
  Cloud Run service's own identity — so the running container holds `run.admin`,
  `iam.serviceAccountUser` and `artifactregistry.writer` and could redeploy
  itself. The connector isolate's SSRF guard blocks the metadata server, so this
  is defence in depth rather than an open hole, but it is more authority than
  the runtime needs. The split, in an order that cannot lock deploys out:

      # 1. New deployer, alongside the existing binding — nothing breaks yet.
      gcloud iam service-accounts create visvine-deployer --project=visvine-platform
      DEP=visvine-deployer@visvine-platform.iam.gserviceaccount.com
      for r in run.admin artifactregistry.writer cloudsql.client cloudsql.editor; do
        gcloud projects add-iam-policy-binding visvine-platform \
          --member="serviceAccount:$DEP" --role="roles/$r" --condition=None
      done
      # Act-as, scoped to the runtime SA rather than project-wide.
      gcloud iam service-accounts add-iam-policy-binding \
        visvine-cloudrun@visvine-platform.iam.gserviceaccount.com \
        --member="serviceAccount:$DEP" --role=roles/iam.serviceAccountUser
      # Read only the one secret the deploy itself opens.
      gcloud secrets add-iam-policy-binding DATABASE_URL \
        --member="serviceAccount:$DEP" --role=roles/secretmanager.secretAccessor
      gcloud iam service-accounts add-iam-policy-binding "$DEP" \
        --role=roles/iam.workloadIdentityUser \
        --member='principalSet://iam.googleapis.com/projects/612301752988/locations/global/workloadIdentityPools/github-pool/attribute.repository/Conz-Wilts/Visvine'

      # 2. Point GitHub at it, deploy, confirm green.
      gh secret set WIF_SERVICE_ACCOUNT --body "$DEP"

      # 3. ONLY THEN strip the deploy powers off the runtime identity.
      for r in run.admin artifactregistry.writer iam.serviceAccountUser; do
        gcloud projects remove-iam-policy-binding visvine-platform \
          --member=serviceAccount:visvine-cloudrun@visvine-platform.iam.gserviceaccount.com \
          --role="roles/$r"
      done

  Reverting is one `gh secret set` back to the old account.
- **`storage.objectAdmin` is project-wide** on the runtime identity rather than
  scoped to the two buckets it actually uses.
- **Single region.** `australia-southeast1` only. A regional outage is an outage.
- **No CDN in front of Cloud Run.** Static assets are served from the container.
  Fine at current traffic; the first thing to change if it is not.
- **CSP keeps `unsafe-inline`/`unsafe-eval` on scripts**, because Next injects an
  inline bootstrap without a nonce. Everything else in the policy is enforced —
  see the reasoning in `next.config.ts`.
- **Rate limiting fails open.** If Postgres is unreachable the limiter drops to a
  per-process bucket rather than rejecting traffic (`lib/rateLimit/`). A weaker
  limit during a database blip beats converting a degradation into an outage.
- **DNS rebinding** remains possible between `assertPubliclyRoutable` and the
  socket in the connector host fetch. Documented in `AGENTS.md`.
