# Visvine

Multi-tenant graph visualization platform. Next.js web app + React Native (Expo) mobile, backed by Postgres with pgvector.

> For dev-vs-prod database setup (Docker locally, Cloud SQL in production),
> see [SETUP.md](./SETUP.md).

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 — `npm install -g pnpm`
- Docker Desktop (running)

That's it. No gcloud, no Cloud SQL Auth Proxy, no Google OAuth setup needed for local dev.

## First-time setup

```bash
git clone <repo-url>
cd Visvine

# Copy env templates (Windows PowerShell: Copy-Item)
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env

# Brings up the docker Postgres, pushes schema, generates client, seeds data.
pnpm setup
```

## Daily workflow

```bash
pnpm dev              # ensures Postgres container is up, then starts Next.js
                      # open http://localhost:3000
                      # then http://localhost:3000/dev/login to pick a seeded user
```

To run the mobile app in a second terminal:

```bash
pnpm mobile:ios       # or mobile:android / mobile:start
```

The mobile login screen has a "Dev login (skip Google)" button that lists the same seeded users.

## Commands

```
pnpm setup              # first-time machine bootstrap
pnpm dev                # docker up + Next.js dev server
pnpm build              # production build
pnpm test               # run tests
pnpm typecheck          # typecheck all packages
pnpm lint               # lint all packages

pnpm db:up              # start Postgres container (idempotent)
pnpm db:down            # stop container (data preserved in named volume)
pnpm db:logs            # tail Postgres logs
pnpm db:psql            # open psql in the container
pnpm db:migrate         # prisma db push (sync schema)
pnpm db:seed            # run the generative seed
pnpm db:fresh           # drop tables + push + seed (volume preserved)
pnpm db:reset           # destroy volume + rebuild + push + seed (prompts)

pnpm prisma:studio      # open Prisma Studio
pnpm prisma:generate    # regenerate Prisma client

pnpm mobile:dev         # Expo dev server
pnpm mobile:ios         # iOS simulator
pnpm mobile:android     # Android emulator

pnpm db:proxy:cloud     # start Cloud SQL Auth Proxy (prod debugging only — see below)
```

## Seed

`pnpm db:seed` produces a deterministic CRM/social graph (fixed random seed):

- 1000 users by default — set `SEED_USER_COUNT` to override
- Power-law (Barabási–Albert) connection distribution
- ~30% of users have DM conversations, ~5% are in groups
- Messages spread over 16 months, with a few in the last 7 days
- Edge cases baked in: zero connections, mutual blocks, pending invites, soft-deleted users, unicode/emoji names, very long names, hub user with many connections, self-link, orphan Person

Anchor users (always present, listed in the dev login pickers):

| email                    | role        | notes |
|--------------------------|-------------|-------|
| `admin@local.dev`        | admin       | also super admin via env |
| `moderator@local.dev`    | moderator   | |
| `alice@local.dev`        | member      | mutual block with `blocked@` |
| `bob@local.dev`          | member      | |
| `hub@local.dev`          | member      | many connections |
| `isolated@local.dev`     | member      | zero connections |
| `blocked@local.dev`      | member      | mutual block with alice |
| `pending@local.dev`      | member      | pending invite from admin |
| `unicode@local.dev`      | member      | name `李明 🌸 Тест` |

To add a saved bug-repro scenario, see the comment block at the bottom of `apps/web/prisma/seed.ts`.

## Multi-machine

Travels via git: schema, migrations, seed, docker-compose.yml, .env.example, scripts. Stays machine-local: docker volume `visvine_postgres_data`, `apps/web/.env`, `apps/mobile/.env`. Nothing you click through and create lives across machines — if it matters, codify it in the seed.

## Mobile

Default daily-driver: simulator/emulator (reaches localhost directly).

For testing on a physical phone, the cleanest option is a Cloudflare tunnel — the dev auth bypass already removes the Google-OAuth-needs-HTTPS reason, but the phone still can't reach `localhost`:

```bash
brew install cloudflared        # Mac; on Windows use the official installer
cloudflared tunnel --url http://localhost:3000
```

Then set the tunnel URL as `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`.

## Production debugging escape hatch

`pnpm db:proxy:cloud` still starts the Cloud SQL Auth Proxy if you need to inspect prod data. Connect with a read-only IAM identity and a separate SQL client — do not point the local app at production.

## Notes

- Embeddings use OpenAI `text-embedding-3-small` (1536 dims) and are stored in `Node.embedding`. Set `OPENAI_API_KEY` to enable semantic search; otherwise the seed leaves embeddings NULL and search falls back to keyword.
- Cookie name `auth_session`. Mobile sends `Authorization: Bearer <jwt>`. Same JWT system, two transports — see `apps/web/lib/session.ts`.
- The dev auth bypass routes (`/dev/login`, `/api/dev/*`) return 404 unless both `NODE_ENV=development` and `ENABLE_DEV_AUTH=true`. Production builds compile `NODE_ENV=production` so the guard cannot be opened by env vars alone.
