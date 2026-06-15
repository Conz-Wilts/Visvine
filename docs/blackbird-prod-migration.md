# Migrating "Blackbird Ventures" to production

Pushes the Blackbird Ventures community (182 portfolio companies, ~435 founders,
~438 `founded` links, CRM columns + values) to the Cloud SQL production database
and makes **connor@visvine.com** its admin.

The work is done by `apps/web/scripts/seed-blackbird-prod.mjs`. It is the
prod-safe sibling of the local `db:blackbird` seed:

- **No local-db guard.** Instead it *refuses to run unless* `CONFIRM_PROD_SEED=blackbird`
  (or `--yes`) is set — the safety default flipped for a prod target. It logs the
  target host (never the password) on startup so runs are auditable.
- **Admin = a real human.** Upserts an **active** `user` row for
  `connor@visvine.com` and grants it `admin` on the community. Because the row is
  active and matched by email, Connor's first Google sign-in links his real
  Google identity to this row (see `app/api/auth/callback/google/route.ts`
  step 7), so the admin grant carries over — he does **not** need a separate
  claim/invite. He still must sign in once with Google to activate the account.
- **Idempotent + non-destructive.** On a community that already has nodes it only
  ensures the community + admin and leaves the data alone (won't clobber live
  edits). Pass `BLACKBIRD_RESEED=1` to force a full rebuild from the research JSON.
- **Schema-aware links.** Detects whether the `links` table has the new
  `pair_key`/provenance columns and inserts accordingly, so it works whether run
  against the current prod schema or after the provenance schema is pushed.

There are two ways to run it. **Pick one.**

---

## Option A — Automatic, on the next deploy (recommended; no local auth needed)

Already wired into `.github/workflows/deploy.yml`. The "Apply database migrations"
step starts the Cloud SQL proxy, reads the `DATABASE_URL` secret, runs
`prisma db push`, then runs the seed. So on the next push to `main` that triggers
a deploy, Blackbird is migrated automatically and stays in sync on every deploy
(cheap no-op after the first run).

> Note: pushing to `main` deploys the **whole app** from whatever is committed.
> Make sure the rest of your working tree is in the state you want to ship before
> relying on this path.

## Option B — Run it now, manually, via the Cloud SQL Auth Proxy

Use this to migrate Blackbird immediately without doing a full app deploy.

### 1. Refresh gcloud auth (interactive — run these yourself)

Your tokens have expired. In the Claude Code prompt, run each with the `!` prefix
so the output lands in the session:

```
! gcloud auth login
! gcloud auth application-default login
! gcloud config set project visvine-platform
```

### 2. Put the prod connection in `apps/web/.env`

Pull the DB URL from Secret Manager and adapt it to the TCP proxy form
(`@127.0.0.1:5432`, no `?host=/cloudsql/...`). Add to `apps/web/.env`:

```
CLOUD_SQL_CONNECTION_NAME=visvine-platform:australia-southeast1:visvine-pgdata
DATABASE_URL=postgresql://<PROD_DB_USER>:<PROD_DB_PASSWORD>@127.0.0.1:5432/visvine
```

(Get the user/password from `gcloud secrets versions access latest --secret=DATABASE_URL --project=visvine-platform`.)

### 3. Start the proxy in a separate terminal

```
pnpm db:proxy:cloud        # or: pnpm proxy
```

Leave it running. It listens on `127.0.0.1:5432` and forwards to Cloud SQL using
your ADC identity.

### 4. Run the seed (in your normal terminal)

```
CONFIRM_PROD_SEED=blackbird pnpm db:blackbird:prod
```

Add `BLACKBIRD_RESEED=1` to force a full rebuild on a community that already has
data. Override the admin with `BLACKBIRD_ADMIN_EMAIL=...` / `BLACKBIRD_ADMIN_NAME=...`.

### 5. When done

`Ctrl+C` the proxy, and **revert `apps/web/.env` to your dev/local values**
(remove `CLOUD_SQL_CONNECTION_NAME` and the prod `DATABASE_URL`) so the
local-db guards work again.

---

## Notes / caveats

- **Search is fuzzy/keyword only.** Directory search needs no embeddings or
  OpenAI key — the new nodes are searchable immediately.
- **Super-admin vs community-admin.** This grants community admin only. The
  deploy currently sets `SUPER_ADMIN_EMAILS` from a secret (the platform-wide
  bypass). If you also want connor@visvine.com to be a platform super admin, add
  it to that secret — separate from this migration.
- **Provenance schema — applied.** The link-provenance schema change (`pair_key`
  NOT NULL + the `(community_id, pair_key, relationship)` unique index) was
  applied to prod via the proxy during the local→prod migration, so prod is
  already in sync and the next `prisma db push` is a no-op for it. The one-off
  `add_link_provenance.sql` backfill helper (for upgrading a *populated* `links`
  table in place) was only ever a manual transition tool — never wired into the
  build/deploy — and has been removed now that the transition is done.
