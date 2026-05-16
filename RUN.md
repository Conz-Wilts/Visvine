# RUN.md — switching between the dev DB and the production DB

Both database modes still work. They share TCP port `127.0.0.1:5432`, so only
one can be active at a time. Pick a mode, set up the right `.env`, then run
the matching commands.

| Mode | Backed by | Started by | Source of `apps/web/.env` |
|---|---|---|---|
| **Dev** | Local Postgres in Docker (seeded, throwaway) | `pnpm dev` | Top half of `apps/web/.env.example` (dev defaults, uncommented) |
| **Prod** | Cloud SQL Postgres via the Cloud SQL Auth Proxy | `pnpm dev:cloud` (proxy + Next in one terminal) | Bottom half of `apps/web/.env.example` — uncomment + fill in real values |

> There is one template per app (`apps/web/.env.example`,
> `apps/mobile/.env.example`). The dev defaults are uncommented at the top;
> the production / Cloud SQL block is commented out at the bottom. Switching
> modes is a matter of which block is active in your local `apps/web/.env`.

> Production credentials live in Google Secret Manager. Pull values from there
> when filling out `.env`; never commit a `.env` with real secrets.

---

## Mode A — Dev database (Docker, seeded)

Use this for normal day-to-day development. Data is throwaway, the seed is
deterministic, and `/dev/login` works.

```powershell
# One-time: copy the dev template
Copy-Item apps/web/.env.example apps/web/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env

# Make sure nothing else is bound to 5432
Get-NetTCPConnection -LocalPort 5432 -ErrorAction SilentlyContinue

# Start everything: docker compose up + Next.js
pnpm dev
```

Behind `pnpm dev`:

- `docker compose up -d --wait` brings up the `visvine-postgres` container
  defined in `docker-compose.yml` and waits for the healthcheck.
- `pnpm --filter @visvine/web dev` starts Next.js on `http://localhost:3000`.

Then open `http://localhost:3000/dev/login` and pick a seeded user.

Common DB ops in dev mode:

```powershell
pnpm db:up        # bring container up (idempotent)
pnpm db:down      # stop container, keep volume
pnpm db:logs      # tail Postgres logs
pnpm db:psql      # psql into the container
pnpm db:migrate   # prisma db push (apply schema.prisma)
pnpm db:seed      # re-run the seed (faker rows, NO embeddings)
pnpm db:fresh     # drop + push + seed (volume preserved)
pnpm db:reset     # destroy volume entirely, then setup (prompts)

# Shared fixtures via GCS (skips the OpenAI embedding regen):
pnpm db:restore   # pull seed-latest.dump from GCS, restore locally
pnpm db:dump      # local-only snapshot to tmp/fixtures/
pnpm db:publish   # maintainer-only: dump + upload as new latest
pnpm setup:fixture  # fresh-clone equivalent of `pnpm setup`, using GCS
```

`db:restore` / `db:publish` need `GCS_DUMP_BUCKET` set in `apps/web/.env`
and `gcloud auth application-default login`. See **SETUP.md §6** for the
bucket provisioning + maintainer playbook. The team-shared fixture is
the only way to get OpenAI-generated embeddings into your local DB
without spending your own API quota.

---

## Mode B — Production database (Cloud SQL Auth Proxy)

Use this only when you genuinely need to inspect or operate on production
data. Treat every write as if it were live, because it is. Strongly prefer a
read-only IAM identity unless you're consciously doing a write.

### Prerequisites (one-time per machine)

1. Install `cloud-sql-proxy` to `~/bin/cloud-sql-proxy(.exe)` — see the
   install hint inside `scripts/start-cloud-sql-proxy.sh` for the download URL.
2. Authenticate gcloud ADC:
   ```powershell
   gcloud auth application-default login
   ```
3. Switch `apps/web/.env` to prod mode:
   ```powershell
   # Back up your dev .env first so you can switch back later
   Copy-Item apps/web/.env apps/web/.env.dev-backup -Force

   # Easiest path: start from the template and edit it.
   Copy-Item apps/web/.env.example apps/web/.env -Force
   ```
   Then edit `apps/web/.env`:
   - At the top, flip `NODE_ENV=production` and `ENABLE_DEV_AUTH=false`.
   - Comment out the dev `DATABASE_URL`.
   - Uncomment the **Production / Cloud SQL** block at the bottom and paste in
     real values pulled from Secret Manager: `CLOUD_SQL_CONNECTION_NAME`,
     `DATABASE_URL` (or `DB_HOST`/`USER`/...), `AUTH_SECRET` (must match prod),
     `SUPER_ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`/`SECRET`, `GCS_*`,
     `OPENAI_API_KEY`.

   Once you've done this once, save the filled-in file as
   `apps/web/.env.prod-backup` so future switches are a single `Copy-Item`.

### Starting prod mode

If your `.env` puts the proxy on `5432` (the default), the Docker Postgres
will collide with it — **stop docker first**:

```powershell
pnpm db:down
```

If your `.env` uses a different `DB_PORT` (e.g. `5433`), Docker and the proxy
can coexist; you can skip the `db:down`.

Then start both the proxy and Next in one terminal:

```powershell
# Reads DB_PORT and CLOUD_SQL_CONNECTION_NAME from apps/web/.env, runs the
# Cloud SQL Auth Proxy and Next side-by-side under `concurrently`. Ctrl+C
# stops both. Do NOT use `pnpm dev` — that command starts docker compose.
pnpm dev:cloud
```

You can still run them in two terminals if you prefer (`pnpm db:proxy:cloud`
in one, `pnpm --filter @visvine/web dev` in the other) — `dev:cloud` is just
the one-shot wrapper.

Open `http://localhost:3000` and sign in with real Google OAuth.
`/dev/login` will return 404 because `NODE_ENV=production`.

### Useful checks

```powershell
# Confirm the proxy (not Docker) owns 5432
Get-NetTCPConnection -LocalPort 5432 | ForEach-Object {
  Get-Process -Id $_.OwningProcess | Select-Object Id, ProcessName
}
# Expect: cloud-sql-proxy.exe, NOT com.docker.backend
```

For ad-hoc inspection, prefer a separate SQL client (psql, DataGrip, Prisma
Studio) over the running app:

```powershell
# Prisma Studio against whatever DATABASE_URL is in apps/web/.env
pnpm prisma:studio
```

### DON'T

- **Do not run `pnpm db:fresh`, `pnpm db:reset`, `pnpm db:migrate`, or
  `pnpm db:seed` against production.** They will respectively wipe rows, drop
  the volume (no-op here, but still), push schema changes, and re-seed.
  `db:migrate` in particular runs `prisma db push` which can drop columns
  without warning. Schema changes against production should go through a
  reviewed migration, not a local `db push`.
- **Do not run `pnpm dev`** — it boots the Docker Postgres on 5432 and will
  fight the proxy for the port.

### Switching back to dev mode

```powershell
# Stop the proxy (Ctrl+C in its terminal). Then:
Copy-Item apps/web/.env.dev-backup apps/web/.env -Force
pnpm dev
```

---

## Quick reference

| You want… | Run |
|---|---|
| Daily dev work | `pnpm dev` (Docker DB) |
| Tail dev DB logs | `pnpm db:logs` |
| Reseed dev DB | `pnpm db:fresh` |
| Inspect prod data (read-only-ish) | `pnpm db:down` → `pnpm db:proxy:cloud` → `pnpm prisma:studio` in another terminal |
| Run the prod-pointing app locally | `pnpm dev:cloud` (after `pnpm db:down` if your `DB_PORT` is 5432) |
| Switch envs | Swap `apps/web/.env` between your `.env.dev-backup` and a prod-filled copy |
