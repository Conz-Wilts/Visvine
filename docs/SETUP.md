# Visvine setup — dev and production databases

End-to-end guide for the dev/prod database split. README.md covers the
day-to-day; this doc covers everything around it: GCP provisioning, the
env-file map, prod debugging, and the safety scripts.

> **The rule:** dev runs against the Docker Postgres on `localhost:5432`.
> Production runs against Cloud SQL on GCP. They share **zero** data and
> the safety scripts (`guard-local-db.mjs`, `assertLocalTarget()` in the
> seed) will refuse to run destructive commands against anything that
> isn't local.

---

## 1. Local dev (Docker Postgres)

### Prerequisites
- Node ≥ 20, pnpm ≥ 9 (`npm install -g pnpm`)
- Docker Desktop, **running** (the `pnpm dev` script will wait on it)

### First time
```powershell
git clone <repo>
cd Visvine

Copy-Item apps/web/.env.example    apps/web/.env

pnpm setup
```

`pnpm setup` does: `pnpm install` → `docker compose up -d --wait` →
`prisma generate` → `prisma db push` → `tsx prisma/seed.ts`. End state:
Docker Postgres running with pgvector, schema synced, ~1000 fake users
in the `visvine` DB.

### Daily
```powershell
pnpm dev               # Docker up + Next dev server on :3000
                       # http://localhost:3000/dev/login to pick a user
pnpm db:check          # one-shot: SELECT 1 + pgvector check
pnpm db:psql           # psql in the container
pnpm db:logs           # tail Postgres logs
pnpm db:fresh          # drop + push + seed (volume preserved)
pnpm db:reset          # destroy volume + rebuild (prompts)
```

`pnpm db:fresh` and `pnpm db:reset` are gated by `scripts/guard-local-db.mjs`
— they'll refuse to run if your env points anywhere other than
`localhost`/`127.0.0.1`/`visvine-postgres`.

---

## 2. Production database (GCP Cloud SQL)

This is the part you still need to do by hand — the codebase is ready
for it, but provisioning is a GCP-console / `gcloud` exercise. Pick a
project and region first (the codebase doesn't care which).

### 2a. Provision Cloud SQL

```bash
# Vars — adjust
PROJECT=visvine-prod
REGION=australia-southeast1
INSTANCE=visvine-pg
DB_NAME=visvine
APP_USER=visvine_app

gcloud config set project $PROJECT

# 1) Create the instance. db-custom-1-3840 = 1 vCPU / 3.75 GB; bump later.
gcloud sql instances create $INSTANCE \
  --database-version=POSTGRES_16 \
  --region=$REGION \
  --tier=db-custom-1-3840 \
  --storage-type=SSD \
  --storage-size=20GB \
  --storage-auto-increase \
  --backup-start-time=15:00 \
  --enable-point-in-time-recovery \
  --database-flags=cloudsql.iam_authentication=on

# 2) Create the app DB
gcloud sql databases create $DB_NAME --instance=$INSTANCE

# 3) Create the app user (use Secret Manager for the password)
APP_PASSWORD=$(openssl rand -base64 32)
gcloud sql users create $APP_USER --instance=$INSTANCE --password="$APP_PASSWORD"
echo -n "$APP_PASSWORD" | gcloud secrets create visvine-db-app-password --data-file=-

# 4) Enable pgvector — connect once with the proxy and run CREATE EXTENSION
gcloud sql connect $INSTANCE --user=postgres --database=$DB_NAME
# (in psql:)  CREATE EXTENSION IF NOT EXISTS vector;  \q
```

Take note of the instance connection name (`gcloud sql instances describe
$INSTANCE --format="value(connectionName)"`). It looks like
`visvine-prod:australia-southeast1:visvine-pg`. You'll need it as
`CLOUD_SQL_CONNECTION_NAME`.

### 2b. Apply the schema to prod

You have two options. Pick one and stick to it.

**Option A — `prisma db push` (what dev uses).** Fast, no migration
history, can drop columns silently on schema drift. Acceptable while
pre-launch and you're the only deployer.

```bash
# From your laptop, with the Cloud SQL Auth Proxy running:
pnpm db:proxy:cloud   # in a separate terminal

# In apps/web/.env, set DATABASE_URL to the prod URL (see §3 below),
# CLOUD_SQL_CONNECTION_NAME, and NODE_ENV=production.
cd apps/web
pnpm dlx prisma@7.4.0 db push
node scripts/apply-sql-functions.mjs   # hook for hand-written SQL (currently a no-op)
```

**Option B — `prisma migrate deploy` (recommended once you have users).**
Requires switching dev to `prisma migrate dev` too so a migrations folder
exists. This is a larger change; do it when you have data that can't be
re-seeded.

Either way, the legacy folder `apps/web/migrations/` is **reference
material** — `apply-sql-functions.mjs` no longer applies anything from it
automatically (its only entry, `create_match_nodes_function.sql`, was removed
with semantic search). The SQL in that folder is historical; their tables are
now owned by `schema.prisma`.

One exception: one-shot **data** cleanups live here too and must be run by
hand against any long-lived DB. `remove_moderator_and_profile_subentities.sql`
collapses stale `moderator` rows to `member` and drops the removed profile
sub-entity tables — apply it (`psql "$DATABASE_URL" -f …`) *before*
`prisma db push` so push sees no destructive drift.

### 2c. Service account for the deployed app

```bash
SA=visvine-app
gcloud iam service-accounts create $SA --display-name="Visvine app runtime"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# If the app reads from Secret Manager directly:
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Attach this SA to whatever runs the Next app (Cloud Run, GCE, GKE). The
deployment-time env should set `DATABASE_URL` to the prod connection
string and **not** include `ENABLE_DEV_AUTH`.

### 2d. How the app connects from production

Two transports, both supported by `apps/web/lib/prisma.ts`:

- **Unix socket (Cloud Run):** add the Cloud SQL Auth Proxy as a sidecar
  / Cloud SQL connection, then point at
  `postgresql://USER:PASS@localhost/visvine?host=/cloudsql/CONNECTION_NAME`.
- **TCP via proxy sidecar:** run the proxy in a sidecar listening on
  `127.0.0.1:5432`, then point at
  `postgresql://USER:PASS@127.0.0.1:5432/visvine`.

The `idleTimeoutMillis: 10_000` setting in `lib/prisma.ts:23` exists
specifically to outrun the Cloud SQL Auth Proxy's idle-socket cutoff —
don't increase it without understanding why.

---

## 3. Environment file map

All `.env*` files are gitignored except `*.example`. The `env:check`
script (run in CI or as a pre-commit hook) will fail the build if a real
`.env` ever gets staged.

| File | Committed? | What it's for |
|---|---|---|
| `apps/web/.env.example` | ✅ template | Single template covering both modes. Dev defaults are uncommented; the production / Cloud SQL block at the bottom is commented out — uncomment and fill in real values to switch modes. |
| `apps/web/.env` | ❌ gitignored | **Your active** config. Edit it (or swap from a backup) when switching between dev (Docker) and prod-debug (Cloud SQL). |

The native mobile apps don't use `.env` files — their config lives in Gradle
properties (`apps/mobile/android/gradle.properties`) and `Info.plist`
(`apps/mobile/ios/Visvine/Info.plist`). See `apps/mobile/README.md`.

### Switching local app between dev DB and prod DB

```powershell
# Day-to-day (dev DB, Docker):
Copy-Item apps/web/.env.example apps/web/.env -Force
pnpm dev

# Prod debug (Cloud SQL via the auth proxy, READ-ONLY MINDSET):
#   1. Start from a fresh copy of the template
#   2. At the top, flip NODE_ENV → production and ENABLE_DEV_AUTH → false
#   3. Comment out the dev DATABASE_URL and uncomment the production block
#      at the bottom, filling in real values from Secret Manager
#      (CLOUD_SQL_CONNECTION_NAME, DB creds, AUTH_SECRET, GOOGLE_*, GCS_*…).
# Easier path: keep a filled-in copy as apps/web/.env.prod-backup and swap.
Copy-Item apps/web/.env.prod-backup apps/web/.env -Force
pnpm dev:cloud                # runs the proxy + Next concurrently
```

Both `pnpm dev` (Docker) and `pnpm dev:cloud` (proxy) try to bind
`127.0.0.1:5432`, so they're mutually exclusive. If you `pnpm dev:cloud`
without first running `pnpm db:down`, the proxy will fail to bind.

**Do not run `pnpm db:fresh`, `pnpm db:seed`, or `pnpm db:reset` while
your `.env` is pointed at Cloud SQL.** The guard scripts will refuse,
but the cheapest safety is not to be in that state in the first place.

---

## 4. Validation commands (run these to confirm things)

```powershell
pnpm db:check               # SELECT 1 + pgvector check against current .env target
pnpm env:check              # fails if a real .env is tracked in git
pnpm env:check:staged       # fails if a real .env is staged (use in pre-commit)
pnpm lint                   # eslint . --max-warnings=0 (web app)
pnpm typecheck              # tsc --noEmit (web app)
pnpm test                   # Node built-in test runner (apps/web)
```

### Pre-commit hook (optional but recommended)

The repo doesn't ship a hook installer; wire it however you prefer. The
zero-dependency option:

```powershell
# .git/hooks/pre-commit  (chmod +x on macOS/Linux)
#!/usr/bin/env sh
pnpm env:check:staged || exit 1
```

Or use husky / lefthook if you're already using one elsewhere.

---

## 5. What's still missing on the GCP side

Everything in §2 above is GCP-only and not codified in the repo. Things
worth doing the first time and then forgetting about:

- [ ] Cloud SQL instance created, pgvector extension installed
- [ ] App DB user created, password in Secret Manager
- [ ] Service account for the app runtime, granted `roles/cloudsql.client`
- [ ] Schema pushed once (`prisma db push` via the proxy)
- [ ] App-runtime env wired: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_*`,
      `GCS_*`, `NEXT_PUBLIC_APP_URL`, no `ENABLE_DEV_AUTH`
- [ ] Cloud SQL backups + PITR confirmed (the `gcloud sql instances
      create` flags above set this up)

---

## 6. Sharing a dev database between teammates (pg_dump + GCS)

`pnpm db:seed` reseeds 1000 fake users locally. Rather than every dev
regenerating that on every fresh setup, the team can share one fixture
snapshot via a private GCS bucket.

One person (the "fixture maintainer") seeds + publishes; everyone else pulls.

### 6a. Provision the bucket (one-time)

```bash
PROJECT=visvine-platform
BUCKET=visvine-dev-fixtures
REGION=us-central1

gcloud storage buckets create gs://$BUCKET \
  --project=$PROJECT \
  --location=$REGION \
  --uniform-bucket-level-access \
  --soft-delete-duration=7d

# Maintainers (read + write):
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="user:cwiltshire@visvine.com" \
  --role="roles/storage.objectAdmin"

# Other devs (read only — pulls the fixture, can't overwrite it):
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="domain:visvine.com" \
  --role="roles/storage.objectViewer"
```

Adjust the second binding to a list of individual users or a Google
group if `domain:` is too broad for your taste.

### 6b. Maintainer workflow — publishing a new fixture

Run when seed.ts changes meaningfully, schema migrations land, or
embeddings drift. Cadence is up to you; once a sprint is plenty.

```powershell
# 1. ADC is all db:publish needs (GCS_* values aren't required for it).
gcloud auth application-default login   # if you haven't recently

# 2. Reset and reseed the local DB
pnpm db:fresh                            # ~5s; faker rows

# 3. Dump + upload (refuses unless GCS_DUMP_BUCKET is set in apps/web/.env)
pnpm db:publish

# Output should end with:
#   versioned: gs://visvine-dev-fixtures/seed-mig20260414-20260516-0357.dump
#   latest:    gs://visvine-dev-fixtures/seed-latest.dump
```

Tell the team in Slack that there's a new fixture. They run `pnpm db:restore`
at their leisure.

### 6c. Consumer workflow — pulling the fixture

**First-time onboarding** (replaces the `pnpm setup` step from §1):
```powershell
git clone … && cd Visvine
Copy-Item apps/web/.env.example apps/web/.env
# In apps/web/.env, uncomment:  GCS_DUMP_BUCKET=visvine-dev-fixtures
gcloud auth application-default login

pnpm setup:fixture        # install → docker → migrate → restore from GCS
pnpm dev
```

**Refreshing later** (when maintainer publishes a new fixture):
```powershell
pnpm db:restore           # downloads seed-latest.dump, drops+restores+pushes
```

### 6d. How filenames and `latest` work

Each publish creates two GCS objects:
- `seed-mig<MIGTS>-<UTCTIME>.dump` — immutable, archived per dump
- `seed-latest.dump` — overwritten on every publish; pointer to whatever
  was published most recently

`MIGTS` is the timestamp prefix of the newest folder in
`apps/web/prisma/migrations/`. It binds the dump's schema to a known
migration so future tooling can refuse a restore if local migrations
are ahead of the dump.

To pin a specific version:
```powershell
pnpm db:restore -- --version=seed-mig20260414-20260512-0902.dump
```

### 6e. Schema drift

`db:restore` runs `prisma db push` after restoring the dump. This handles
**additive** schema drift (a new column landed in `schema.prisma` after
the dump was taken — `db push` adds it, NULL for restored rows).
**Destructive** drift (a column was removed) needs `--accept-data-loss`
on `db push`, which the script doesn't pass. If you're shipping a
destructive migration, re-publish the fixture in the same PR. (Example: the
removal of the `moderator` role and the profile sub-entity tables — pair it
with `apps/web/migrations/remove_moderator_and_profile_subentities.sql` and a
fresh `pnpm db:publish`.)

### 6f. Costs

| | |
|---|---|
| Bucket storage | ~10 MB per dump × keep history → ~$0.0002/month each |
| Egress (devs pulling) | $0 within same region; pennies cross-region |

Practically zero.

### 6g. Why not a shared Cloud SQL dev instance?

That was option 3 in the design discussion. It's faster to start with
but harder to recover from: any dev running `pnpm db:fresh` blows away
everyone's work. The fixture-bucket model gives each dev a private
Postgres they can `db:fresh` freely; the shared piece is the dump
artifact, which is immutable per-version.

---

## 7. Gotchas

- **The legacy `apps/web/migrations/` folder is historical.** Nothing in it
  is auto-applied anymore (`apply-sql-functions.mjs` has an empty `files` list
  since semantic search was removed). Don't add new migrations there — modify
  `schema.prisma` instead.
- **`apps/web/prisma/migrations/` is the new Prisma-managed folder.** It
  currently has one entry (`20260414_add_design_config`). If you adopt
  `prisma migrate` for prod, this folder becomes the source of truth.
- **`AUTH_SECRET` must be identical to whatever was deployed.** Rotating
  it in prod invalidates every active session.
- **Cloud SQL Proxy + Docker compete for `127.0.0.1:5432`.** Don't run
  them simultaneously.
- **Real-time messaging (`lib/messages/realtime.ts`) is in-process
  state.** It does not survive multiple Cloud Run instances — when you
  scale prod horizontally, you'll need to add Redis pub/sub or similar.
  Not a DB-split issue, but it'll bite you when you go multi-instance.
