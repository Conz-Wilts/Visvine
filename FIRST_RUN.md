# First-run guide — local dev environment

One-time walkthrough to migrate from the old Cloud-SQL-proxy flow to the new Docker-based flow. Delete this file once you're set up — `README.md` is the long-term doc.

All commands assume **PowerShell** in `C:\Users\Connor\dev\Projects\Visvine`.

---

## Why two `.env` files?

| File | Read by | Contains | Ships where? |
|---|---|---|---|
| `apps/web/.env` | Next.js server (Node) | DB password, `AUTH_SECRET`, OAuth secret | Server only — never bundled to client unless `NEXT_PUBLIC_*` |
| `apps/mobile/.env` | Expo / Metro bundler | API URL, `EXPO_PUBLIC_DEV_AUTH`, public OAuth client ID | **Inlined into every phone's JS bundle** |

Two files, two trust levels. Don't merge them — and don't put real secrets in the mobile one.

---

## Step 1 — Back up your existing prod credentials

Your current `apps/web/.env` points at production Cloud SQL. Save it before overwriting — you'll want it back if you ever need `pnpm db:proxy:cloud` for prod debugging.

```powershell
Copy-Item apps/web/.env apps/web/.env.cloud-backup
```

`.env.cloud-backup` is gitignored by the existing `.env*` rule. Keep it on each machine.

---

## Step 2 — Copy the new templates

```powershell
Copy-Item apps/web/.env.example apps/web/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

---

## Step 3 — Replace the placeholder `AUTH_SECRET`

The template has a placeholder. Generate a real value (one per machine is fine, but the same one across machines means dev sessions transfer):

```powershell
# Quick way using PowerShell:
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the output and paste it as the `AUTH_SECRET=` value in `apps/web/.env`.

If `AUTH_SECRET` is missing or empty, every login throws `AUTH_SECRET environment variable is not set`.

---

## Step 4 — Make sure Docker Desktop is running

Open Docker Desktop. Wait for the whale icon to stop animating in the system tray. Verify:

```powershell
docker ps
```

If you see `Cannot connect to the Docker daemon`, Docker Desktop isn't ready yet.

---

## Step 5 — One-shot setup

This brings up Postgres in Docker, generates the Prisma client, pushes the schema, applies the `match_nodes` SQL function, and seeds ~1000 users.

```powershell
pnpm setup
```

Expected output ending with something like:

```
Seeding with SEED=42, USER_COUNT=1000
Wiping existing data…
Creating community…
Creating anchor users…
Creating 991 background users…
Building Barabási–Albert connection graph…
  generated 1996 links
Creating conversations and messages…
  created 7XXX messages
Creating edge cases…
Seed complete in 30-60s. 1000 users.
Anchor users (sign in via /dev/login):
  admin@local.dev      → Dev Admin (admin)
  ...
```

Common failures:

| Symptom | Fix |
|---|---|
| `port 5432 is already allocated` | Something else is bound to 5432 (likely a leftover cloud-sql-proxy). `Get-Process cloud-sql-proxy \| Stop-Process` then retry. |
| `docker: command not found` | Docker Desktop installed but not on PATH. Restart PowerShell after install, or open a new terminal. |
| `P1001: Can't reach database server` | Docker Postgres didn't come up healthy. `pnpm db:logs` to see why. Usually a stale volume from a previous schema — `pnpm db:reset` rebuilds from scratch. |
| `relation "user" does not exist` during seed | Schema push silently failed. Re-run `pnpm db:migrate` directly to see the real error. |

---

## Step 6 — Daily-use verification

Start the dev server:

```powershell
pnpm dev
```

In a browser:

1. Open <http://localhost:3000/dev/login>
2. You should see the 9 anchor users listed
3. Click `Dev Admin` → redirected to `/` and signed in
4. Visit any authenticated page (`/directory`, `/messages`, etc.) without being kicked to `/signin`

If `/dev/login` shows "Not Found", check `apps/web/.env`:
- `NODE_ENV=development` (not unset)
- `ENABLE_DEV_AUTH=true` (literal string `true`, not `1`)

Both must be set; the guard requires both.

---

## Step 7 — Verify the production guard

Confirm dev-auth cannot leak into a prod build:

```powershell
$env:NODE_ENV = "production"
pnpm build
$env:NODE_ENV = "development"   # restore for normal dev
```

Build should succeed. The `/dev/login` page and `/api/dev/*` routes will all return 404 in the built output regardless of env vars at runtime, because `NODE_ENV` is baked into Next.js bundles at build time.

You can also run the unit tests for the guard:

```powershell
pnpm test
```

Look for the 5 tests starting `isDevAuthEnabled is …` — all should pass.

---

## Step 8 — Mobile (optional, when you next touch the app)

Only do this when you actually need to run mobile. Web works without it.

### iOS simulator

```powershell
pnpm mobile:ios
```

`apps/mobile/.env` defaults to `EXPO_PUBLIC_API_URL=http://localhost:3000` which the simulator can reach directly. Tap **Dev login (skip Google)** on the login screen → pick a seeded user.

### Android emulator

Edit `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

Then `pnpm mobile:android`. (`10.0.2.2` is the Android emulator's alias for the host machine's `localhost`.)

### Physical phone

The phone can't reach `localhost`. Use a Cloudflare tunnel — but with the dev-auth bypass, you no longer need it for OAuth/HTTPS, only for reachability:

```powershell
# Install cloudflared if you haven't:
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

It prints a URL like `https://<random>.trycloudflare.com`. Set it in `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://<random>.trycloudflare.com
```

Restart Expo. The dev login button will fetch from the tunnel URL.

---

## Step 9 — Sanity check that you can't accidentally hit prod

With your new local-only `apps/web/.env`, nothing should be talking to Cloud SQL:

```powershell
Get-NetTCPConnection -LocalPort 5432 | Select-Object -First 5
```

The owning process should be Docker (`com.docker.backend.exe` or similar), not `cloud-sql-proxy`.

`pnpm db:proxy:cloud` still exists for explicit prod debugging — it just isn't part of `pnpm dev` anymore. To use it, restore `apps/web/.env` from `apps/web/.env.cloud-backup` first.

---

## Common ongoing operations

| What you want | Command |
|---|---|
| Start the day | `pnpm dev` |
| Wipe the DB and reseed (preserves volume) | `pnpm db:fresh` |
| Nuke the volume completely (prompts for confirmation) | `pnpm db:reset` |
| Browse the DB | `pnpm prisma:studio` or `pnpm db:psql` |
| Stop Postgres (data preserved) | `pnpm db:down` |
| See Postgres logs | `pnpm db:logs` |
| Different seed size | `$env:SEED_USER_COUNT="200"; pnpm db:seed` |

---

## Switching to your other machine

Same steps 1–6 on the other machine (the `.env.cloud-backup` is per-machine; just regenerate the prod `.env` there if you ever need it). The Docker volume is per-machine too — the seed produces identical data because it's deterministic, so this is a non-issue.

---

## When you're done with this guide

Delete `FIRST_RUN.md`. The long-term doc is `README.md`.
