# Visvine

Multi-tenant graph visualization platform. Next.js web app + React Native (Expo) mobile, backed by Cloud SQL Postgres with pgvector.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 — `npm install -g pnpm`
- gcloud CLI — authenticated against the GCP project
- Cloud SQL Auth Proxy v2 — [download](https://cloud.google.com/sql/docs/postgres/sql-proxy#install)

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env   # then fill in values
gcloud auth application-default login
```

Open a second terminal and start the proxy (keep it running):

```bash
pnpm db:proxy
```

Back in the first terminal, initialize the database:

```bash
pnpm db:create        # creates the DB if it doesn't exist
pnpm db:migrate       # pushes the Prisma schema, enables pgvector
pnpm prisma:generate
```

## Run

```bash
pnpm dev
```

This starts the proxy and the Next.js dev server together. Open http://localhost:3000.

## Commands

```
pnpm dev                # proxy + web dev server
pnpm build              # production build
pnpm test               # run tests
pnpm typecheck          # typecheck all packages

pnpm db:proxy           # Cloud SQL proxy on 127.0.0.1:5432
pnpm db:migrate         # push Prisma schema
pnpm db:seed            # seed initial data
pnpm prisma:studio      # open DB browser

pnpm mobile:dev         # Expo dev server
pnpm mobile:ios         # iOS simulator
pnpm mobile:android     # Android emulator
```

## Mobile

The Expo app talks to the web backend over a public HTTPS URL (Google OAuth requires HTTPS, and your phone can't reach `localhost`). Use a Cloudflare tunnel:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

Set the tunnel URL in `apps/mobile/.env` as `EXPO_PUBLIC_API_URL` and in `apps/web/.env.local` as `NEXT_PUBLIC_APP_URL`, then add `<tunnel>/api/auth/callback/google-mobile` to the OAuth client's authorized redirect URIs in Google Cloud Console.

## Notes

- If your DB password contains `@ # % /`, percent-encode it in `DATABASE_URL`.
- Embeddings use OpenAI `text-embedding-3-small` (1536 dims) and are stored in `Node.embedding`. Set `OPENAI_API_KEY` to enable semantic search.
