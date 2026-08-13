# Visvine

Multi-tenant relationship-context visualization platform. Next.js web app + native iOS (SwiftUI) & Android (Jetpack Compose) mobile apps, backed by Postgres with pgvector.

> Local dev runs against a Docker Postgres; production runs against Cloud SQL.
> The two share zero data.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 — `npm install -g pnpm`
- Docker Desktop (running)

That's it. No gcloud, no Cloud SQL Auth Proxy, no Google OAuth setup needed for local dev.

## First-time setup

```bash
git clone <repo-url>
cd Visvine

# Copy env template (Windows PowerShell: Copy-Item)
cp apps/web/.env.example apps/web/.env

# Brings up the docker Postgres, pushes schema, generates client, seeds data.
pnpm setup
```

## Daily workflow

```bash
pnpm dev              # ensures Postgres container is up, then starts Next.js
                      # open http://localhost:3000
                      # then http://localhost:3000/dev/login to pick a seeded user
```

To run a native mobile app against the local backend (the web server must be running):

```bash
# iOS (macOS + Xcode): generate the project, then build/run in Xcode
cd apps/mobile/ios && xcodegen generate && open Visvine.xcodeproj

# Android (Android Studio or CLI): materialise the Gradle wrapper, then install
cd apps/mobile/android && gradle wrapper && ./gradlew :app:installDebug
```

The mobile login screen has a "Dev login (skip Google)" button that lists the same seeded users. See `apps/mobile/README.md` for per-platform details.

## Commands

```
pnpm setup              # first-time machine bootstrap
pnpm dev                # docker up + Next.js dev server
pnpm build              # production build
pnpm test               # run tests
pnpm typecheck          # tsc --noEmit (web app)
pnpm lint               # eslint (web app)
pnpm --filter @visvine/web knip   # dead-code / unused-dependency check

pnpm db:up              # start Postgres container (idempotent)
pnpm db:down            # stop container (data preserved in named volume)
pnpm db:logs            # tail Postgres logs
pnpm db:psql            # open psql in the container
pnpm db:migrate         # prisma db push (sync schema)
pnpm db:seed            # base seed: the space, aliases + anchor users (WIPES the DB)
pnpm db:blackbird:full  # db:seed + portfolio + brain + extras + connectors
pnpm db:nz              # load the NZ startup ecosystem demo content
pnpm db:fresh           # drop tables + push + db:blackbird:full (volume preserved)
pnpm db:reset           # destroy volume + rebuild + push + db:blackbird:full (prompts)

pnpm prisma:studio      # open Prisma Studio
pnpm prisma:generate    # regenerate Prisma client

pnpm db:proxy:cloud     # start Cloud SQL Auth Proxy (prod debugging only — see below)
```

The native mobile apps build with their own toolchains (Gradle / Xcode), not
pnpm — see `apps/mobile/README.md`.

## Seed

The seeded space is **Blackbird Ventures** (`community:blackbird-ventures`),
built in layers. `pnpm db:blackbird:full` runs all of them:

| step | what it adds |
|---|---|
| `db:seed` | the space, its node types and aliases, the four anchor users. **Wipes the whole local DB first.** |
| `db:blackbird:ventures` | ~182 portfolio companies + their founders, `founded` links, seven CRM columns |
| `db:blackbird:notes` | the shared brain (companies, sectors, people, team, deals, data) + the admin's personal brain |
| `db:blackbird:extras` | events + attendees, the resource library, channels + messages + a DM, feed posts |
| `db:connectors:demo` | two working connectors in the shared brain |
| `db:context-links` | directory links derived from the shared-brain entity notes |
| `db:index-notes:rebuild` | creates any missing folder index and refreshes every index's managed child list |
| `db:notes:verify` | fails the seed if the brain breaks a structural rule |

Other demo content (the NZ startup ecosystem) loads separately via `pnpm db:nz`.

**An index note IS a folder.** Every folder carries an `index.md` typed `Index`
whose `title` is the folder's display name and whose body is curated prose plus a
machine-maintained list of the folder's notes and subfolders (between
`<!-- index:children -->` markers). Nothing else may claim `type: Index` —
creating one creates a folder, and retyping a note to `Index` turns it into one.
`db:notes:verify` is what keeps the seeded data honest about that; run it any
time you hand-edit a seed layer. The rules live in
`apps/web/lib/notes/shared/indexNote.ts`.

Anchor users (always present, listed in the dev login pickers). There is no role
column — what someone can do comes entirely from the aliases they hold:

| email                | aliases          | notes |
|----------------------|------------------|-------|
| `admin@local.dev`    | Owner, Partner   | manages the space; also super admin via env |
| `partner@local.dev`  | Partner          | edit on companies/, deals/, data/ |
| `member@local.dev`   | Founder          | view on companies/ |
| `lp@local.dev`       | LP               | view on one note — the tightest grant there is |

## Multi-machine

Travels via git: schema, migrations, seed, docker-compose.yml, .env.example, scripts, and the native app sources. Stays machine-local: docker volume `visvine_postgres_data`, `apps/web/.env`, and generated mobile build artifacts (`apps/mobile/ios/Visvine.xcodeproj`, `apps/mobile/android/.gradle`). Nothing you click through and create lives across machines — if it matters, codify it in the seed.

## Mobile

The mobile apps are fully native — Kotlin/Jetpack Compose (`apps/mobile/android`)
and Swift/SwiftUI (`apps/mobile/ios`). Default daily-driver: simulator/emulator,
which reaches the dev backend at `http://localhost:3000` (iOS) /
`http://10.0.2.2:3000` (Android) directly.

For testing on a physical phone, the cleanest option is a Cloudflare tunnel — the dev auth bypass already removes the Google-OAuth-needs-HTTPS reason, but the phone still can't reach `localhost`:

```bash
brew install cloudflared        # Mac; on Windows use the official installer
cloudflared tunnel --url http://localhost:3000
```

Then point the app's API base at the tunnel URL: `visvine.apiBaseUrl` (Android
Gradle property) or `VisvineApiBaseURL` (iOS `Info.plist`). For real Google
OAuth, also set `NEXT_PUBLIC_APP_URL` (web) to the tunnel and register
`<tunnel>/api/auth/callback/google-mobile` + the `visvine://` scheme with the
OAuth client. See `apps/mobile/README.md`.

## Production debugging escape hatch

`pnpm db:proxy:cloud` still starts the Cloud SQL Auth Proxy if you need to inspect prod data. Connect with a read-only IAM identity and a separate SQL client — do not point the local app at production.

## Notes

- Directory search is fuzzy/keyword only (client-side relevance matching + server-side ILIKE pickers). The former OpenAI/pgvector semantic search was removed.
- Cookie name `auth_session`. Mobile sends `Authorization: Bearer <jwt>`. Same JWT system, two transports — see `apps/web/lib/session.ts`.
- The dev auth bypass routes (`/dev/login`, `/api/dev/*`) return 404 unless both `NODE_ENV=development` and `ENABLE_DEV_AUTH=true`. Production builds compile `NODE_ENV=production` so the guard cannot be opened by env vars alone.
