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

### Data backfills a release depends on

A schema migration replays on deploy; a *data* shape change does not. When a
release changes where the app expects data to live, the backfill is a one-off
run **after** traffic is routed, through the proxy, with the local-DB guard's
override — the way `db:spaces:records` was run. The app reads the old shape in
between, so the order is deploy first, then backfill.

The one outstanding: entity notes became folders (`people/<slug>/index.md`,
not `people/<slug>.md`). After that release ships:

```
pnpm --filter @visvine/web db:entities:folders --dry-run   # counts, moves nothing
pnpm --filter @visvine/web db:entities:folders             # moves every flat entity note
pnpm --filter @visvine/web db:index-notes:rebuild
pnpm --filter @visvine/web db:global:rebuild
```

Reads through the old flat path keep answering throughout (the alias), so the
window costs nothing but stale child lists. A node it reports as *ambiguous*
holds both forms; merge that one by hand before re-running.

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

## Identities

Two service accounts, and the split is the point.

| | Used by | Holds |
|---|---|---|
| `visvine-deployer@` | GitHub Actions, via workload identity federation | `run.admin`, `artifactregistry.writer`, `cloudsql.client`, `cloudsql.editor`; `iam.serviceAccountUser` scoped to the runtime SA; `secretmanager.secretAccessor` on `DATABASE_URL` alone |
| `visvine-cloudrun@` | the running service | `cloudsql.client`, `secretmanager.secretAccessor`, `storage.objectAdmin` on the two buckets only, and `iam.serviceAccountTokenCreator` **on itself** |
| `visvine-agent-tick@` | Cloud Scheduler, to mint OIDC tokens | no project roles at all |

The runtime holds no deploy authority, so a compromise of the app is not a
compromise of the pipeline. `iam.serviceAccountTokenCreator` on itself is what
`getSignedUrl` needs: with no key file in the environment, `@google-cloud/storage`
signs through the IAM SignBlob API, and without that role every resource
download URL fails at the moment someone opens one.

Storage is granted per bucket (`visvine-media`, `visvine-resources`) rather than
project-wide, so a new bucket is not automatically readable by the app.

To rotate the deploy identity, point `WIF_SERVICE_ACCOUNT` at a new account that
holds the table above and has `iam.workloadIdentityUser` for the repo's
principalSet. Reverting is one `gh secret set`.

## The action notes

What an agent reads to learn what Visvine can do — one note per action
(`actions/<name>.md`) and per recipe (`recipes/<id>.md`) in the `visvine` global
space. The MCP surface is a single tool; this is everything behind it.

**They are not on the critical path.** With none of them written, the surface
still routes and runs: the catalogue comes from the registry in code and the
recipes fall back to the shipped catalogue (`lib/actions/notes.ts`). Un-synced
notes cost the *editable* half of the documentation, nothing more. So there is no
deploy step to get wrong and no ordering hazard between a release and a sync.

**Production syncs itself, nightly.** `runNightlyMaintenance` calls
`syncActionNotes` — around forty idempotent note writes. A release that adds an action is
therefore fully documented within a day, and immediately usable before that. To
pull it forward, trigger the sweep by hand:

```bash
gcloud scheduler jobs run visvine-nightly-maintenance \
  --location=australia-southeast1 --project=visvine-platform
```

**Editing them.** The prose in each note is maintained in the app by an admin of
the Visvine space — in production `connor@visvine.com`, which requires either a
Person alias flagged `admin` in that space or membership of
`SUPER_ADMIN_EMAILS`. Everything outside the `<!-- action:contract -->` markers
survives every sync; everything inside them is regenerated from the Zod schema
and hand edits there are overwritten by design, because that block is what stops
the documentation drifting from what an action will actually accept.

Adding or improving a *recipe* needs no deploy at all: write a note under
`recipes/`, give it `when:` and a `keywords:` list, and it joins the routing on
the next request.

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

## Content-Security-Policy

Built per request in `proxy.ts` from `lib/security/csp.ts`, and **not** in
`next.config.ts` — it carries a nonce, so it cannot be a constant. Setting it in
both places would emit two CSP headers, which browsers enforce as the
INTERSECTION of the two; the nonce'd policy and a static one would cancel out and
leave the app with no working scripts.

`script-src` is `'self' 'nonce-…' 'strict-dynamic'`, with `'unsafe-eval'` added
only in development (React uses `eval` there to rebuild server stack traces).
Next reads the nonce back off the request header during rendering and stamps its
own bootstrap and bundles with it, so no app code has to know about nonces.

Two surfaces are deliberately exempt, and both leave the proxy before it can
stamp anything:

- **the Tool runtime** (`/api/tools/runtime/*`, on either host) mints its own
  policy in `lib/tools/csp.ts` — its `connect-src 'none'` is the entire
  exfiltration control the sandbox rests on, and the app's policy would replace
  it rather than merge with it.
- **`/api/oauth/authorize`** gets `form-action 'self' https:`, because the
  consent form's approve response is a 303 to the client's registered callback on
  another origin.

No third-party origin may serve a script, style or font — every face is local,
and `tests/csp.test.ts` fails if an `http…` source appears in any of the three.
Check what is actually served with:

```bash
curl -sI https://visvine.com/ | grep -i content-security-policy
```

## Repository hardening

Applied to `Conz-Wilts/Visvine`, and worth re-checking after any settings change:

| Setting | State | Why |
|---|---|---|
| Actions `allowed_actions` | `selected` — GitHub-owned, verified, and `google-github-actions/*` | The deploy federates into GCP. Any third-party action that runs here can reach for those credentials, so the set of actions that may run is an allowlist, not "all". |
| Default workflow token | `read`, cannot approve PRs | Least privilege. Each workflow declares the permissions it actually needs. |
| WIF attribute condition | `assertion.repository=='Conz-Wilts/Visvine'` | The control that stops any other repository on GitHub from impersonating the service account. Never remove it. |
| Dependabot alerts + automated fixes | enabled | Complements the `pnpm audit` CI gate, which only sees what is in the lockfile at merge time. |
| Actions pinned to SHAs | all four | A tag is a pointer its owner can repoint at new code; a SHA is not. |
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
- **audit** — two gates, because they answer different questions. What ships is
  held to `moderate` (the production tree is clean, so there is no noise floor
  to tolerate). The whole tree is held to `high`, and that is the one worth
  having: `--prod` cannot see a build tool, so a critical sitting in
  electron-builder or the Prisma CLI stays invisible to it indefinitely — and a
  compromised build tool in a repo that federates into GCP is not a smaller
  problem than a compromised runtime dependency.

Every action is pinned to a commit SHA with the tag in a trailing comment. A tag
is a moving pointer the action's owner can repoint; a SHA is not. Re-pin with:

```bash
gh api repos/actions/checkout/git/ref/tags/v4 --jq '.object.sha'
```

### Dependency advisories

Fixed rather than tolerated, in this order of preference: upgrade the direct
dependency, else pin the transitive one through `pnpm.overrides` in the root
`package.json`. Both gates pass with nothing above `low` in the tree.

One advisory is allowlisted in `pnpm.auditConfig.ignoreGhsas`, and package.json
cannot carry the reason:

- **GHSA-w5hq-g745-h8pq** (`uuid`, missing buffer bounds check). Reached only
  via `@google-cloud/storage → gaxios@6 → uuid@9`. The flaw is in `v3()`,
  `v5()` and `v6()` when the caller supplies an output buffer; gaxios calls
  `v4()` and nothing else, on an internally generated multipart boundary, with
  no buffer argument. It is unreachable rather than merely unlikely. The fix
  would mean forcing a uuid major into Google's auth stack, which is a worse
  trade than documenting it. Drop this entry when gaxios 7 reaches
  `@google-cloud/storage`.

Re-check after touching either list:

```bash
pnpm audit --prod --audit-level=moderate   # what ships
pnpm audit --audit-level=high              # everything, build tools included
```

## Known limits

Written down because they are decisions, not oversights.

- **Single region.** `australia-southeast1` only. A regional outage is an outage.
- **No CDN in front of Cloud Run.** Static assets are served from the container.
  Fine at current traffic; the first thing to change if it is not.
- **CSP allows inline STYLES** (`style-src 'unsafe-inline'`). Scripts do not —
  they are nonce-gated with `strict-dynamic` (`lib/security/csp.ts`). The editor,
  the charts and the emoji picker all set element styles at runtime, so closing
  this would mean patching third-party render paths; an injected stylesheet can
  deface, an injected script owns the session, and only one of those is cheap to
  close.
- **The 404 page renders without client JS.** Nonces need dynamic rendering, and
  `/_not-found` is the one prerendered HTML route, so under `strict-dynamic` its
  scripts are not nonce-stamped. It still renders server-side; only client-side
  navigation from it is lost.
- **Rate limiting fails open.** If Postgres is unreachable the limiter drops to a
  per-process bucket rather than rejecting traffic (`lib/rateLimit/`). A weaker
  limit during a database blip beats converting a degradation into an outage.
- **DNS rebinding** remains possible between `assertPubliclyRoutable` and the
  socket in the connector host fetch. Documented in `AGENTS.md`.
