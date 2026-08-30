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

# Brings up the docker Postgres, applies migrations, generates client, seeds data.
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

## MCP locally

```bash
pnpm mcp:dev                    # Postgres + Next, acting as admin@local.dev
pnpm mcp:dev --user member      # …as member@local.dev instead
```

Then connect. There is no token and no sign-in: the server is in the committed
`.mcp.json`, and a request with no `Authorization` header is treated as the
chosen dev user with every scope.

```json
"visvine": { "type": "http", "url": "http://localhost:3000/api/mcp" }
```

One server, one tool — `visvine` — and every action behind it. Call it with no
`action` to get the plan and the catalogue.

Picking the user is the only local decision. `--user` takes a bare name, an
email or a user id; `DEV_MCP_USER` in `apps/web/.env` does the same thing
persistently. `pnpm mcp:dev` prints whoever it resolved, and says so when it
couldn't find who you asked for.

This holds only while `ENABLE_DEV_AUTH=true` **and** `NODE_ENV=development`
(`apps/web/lib/mcp/devIdentity.ts`). `next build` bakes `NODE_ENV=production`,
so no deployed artifact can honour it however the environment is set — the same
guard, and the same argument, as the rest of `/api/dev`.

## MCP in production

Full OAuth 2.1: authorization code + PKCE, our own authorization server
(`app/api/oauth/*`), a token bound to this one resource by its `aud`, and a
consent screen naming the scopes — which is where it is decided what a
connection may do, since one server offers everything. A request without a valid
token gets a 401 whose `WWW-Authenticate` points at the protected-resource
metadata; one whose token lacks an action's scope gets a 403 it can step up
from.

An access token lasts **30 days**, and that is the whole life of a grant —
there is no refresh token, no rotation and no revocation endpoint. Sign in once
a month; nothing runs in between.

The trade: a stateless JWT can't be called back before it expires. What limits
the blast radius is that authorization is never carried in the token — every
tool re-resolves the user and their per-space access from the database on each
call, so a deleted account or a removed space membership takes effect at once.
`ACCESS_TTL_SECONDS` in `lib/mcp/tokens.ts` is the lever if 30 days ever feels
long.

The same flow runs locally if you want to exercise it — point a client at
`/api/oauth/authorize` and, under `ENABLE_DEV_AUTH`, it lands on the
`/dev/login` user picker instead of Google.

Third-party MCP servers in `.mcp.json` (`context7`, `playwright`, …) run over
stdio and need no auth at all; vendor-hosted ones reached through connectors are
a different mechanism entirely — see `docs/connectors.md`.

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
pnpm db:migrate         # apply pending migrations + hand-written SQL
pnpm db:migrate:new     # author a migration from a schema.prisma change
pnpm db:seed            # base seed: the space, aliases + anchor users (WIPES the DB)
pnpm db:blackbird:full  # db:seed + portfolio + context + extras + connectors
pnpm db:nz              # load the NZ startup ecosystem demo content
pnpm db:fresh           # rebuild from migrations + db:blackbird:full (volume preserved)
pnpm db:reset           # destroy volume + rebuild + db:blackbird:full (prompts)

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
| `db:blackbird:notes` | the shared context (companies, sectors, people, team, deals, data) + the admin's personal context |
| `db:blackbird:extras` | events + attendees, the resource library, channels + messages + a DM, feed posts |
| `db:connectors:demo` | two working connectors in the shared context |
| `db:entities:folders` | moves any entity note still at its flat path (`people/<slug>.md`) into its folder (`people/<slug>/index.md`) — idempotent; the seed writes the folder form already |
| `db:context-links` | directory links derived from the shared-context entity notes |
| `db:index-notes:rebuild` | creates any missing folder index and refreshes every index's managed child list |
| `db:notes:verify` | fails the seed if the context breaks a structural rule |
| `db:global:rebuild` | rebuilds every Visvine global record from public spaces + profiles (`docs/global-records.md`) |
| `db:actions:sync` | renders the action and recipe catalogues into the Visvine space — the notes an agent reads to learn what Visvine can do |

Other demo content (the NZ startup ecosystem) loads separately via `pnpm db:nz`.

**An index note IS a folder.** Every folder carries an `index.md` whose `title`
is the folder's display name and whose body is curated prose plus a
machine-maintained list of the folder's notes and subfolders (between
`<!-- index:children -->` markers).

Folder-ness is the **path**, never a type. A note's `type:` says what it is
about, so a person's context folder is `type: Person` and a folder that just
groups notes carries no type at all; `Index` is not a type and no note may
declare it. You make a folder by writing a note inside it — add `a/b/c.md` and
`a/b.md` becomes `a/b/index.md`, still the same note, now also the folder's home
page. A directory entity — a person, an organisation, an event, a resource, a
channel — is a folder from the start: `people/<slug>/index.md` IS the person,
and anything else written under `people/<slug>/` is a note about them. `db:notes:verify` is what keeps the seeded data honest about all of that;
run it any time you hand-edit a seed layer. The rules live in
`apps/web/lib/notes/shared/indexNote.ts`.

Anchor users (always present, listed in the dev login pickers). There is no role
column — what someone can do comes entirely from the aliases they hold:

| email                | aliases          | notes |
|----------------------|------------------|-------|
| `admin@local.dev`    | Admin, Partner   | manages the space; also super admin via env |
| `member@local.dev`   | Founder          | view on companies/ |

The alias vocabulary is wider than the two anchors: `Investor`, `Employee` and
`LP` are seeded with their grants but held by nobody. Hand one out from
Console → Aliases to exercise a narrower reach — `LP` carries view on a single
note, the tightest grant the model can express.

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

## Desktop

`apps/desktop` is the Electron desktop app: a hardened Chromium shell that loads
the web app (dev: `http://localhost:3000`, packaged: `https://visvine.com`;
override with `--url=` or `VISVINE_DESKTOP_URL`). Sign-in is the normal web
session — including `/dev/login` locally.

```bash
pnpm dev:desktop     # Postgres + Next.js dev + the Electron window
pnpm desktop:test    # unit tests;  pnpm desktop:e2e = Playwright electron smoke run (needs pnpm dev)
pnpm desktop:pack    # unpacked build in apps/desktop/release/;  pnpm desktop:dist = installers
```

See `apps/desktop/README.md`.

## Documentation

Feature guides live in `docs/`. Each one is the full reference for a subsystem
this README only names:

| Doc | Covers |
|---|---|
| [`docs/runbook.md`](docs/runbook.md) | **Production.** How a release goes out and how to roll one back, what is alerting and where, backups and the restore drill, rotating `SECRETS_KEY`, and the limits that are decisions rather than oversights. |
| [`docs/data-architecture.md`](docs/data-architecture.md) | **Read this first when adding storage.** When something becomes a context note, a Postgres table, or a GCS blob — and the note-write outbox that keeps derived state honest. |
| [`docs/agents.md`](docs/agents.md) | Scheduled and event-driven agents: the brief/activation note pair, the trigger mailbox, the tool set, the Cloud Scheduler tick. |
| [`docs/machines.md`](docs/machines.md) | An agent's machine: the Cloudflare edge, the egress boundary and its policy grammar, the workspace archive, the window and takeover, teaching, quota. |
| [`docs/connectors.md`](docs/connectors.md) | Connector notes: the declared perimeter, the JS isolate, secrets vs identity vs OAuth connections, inbound webhooks. |
| [`docs/tools.md`](docs/tools.md) | User-created Tools: the note layout, the bridge, the sandboxed iframe, the marketplace and its review queue. |
| [`docs/notifications.md`](docs/notifications.md) | Notification kinds, the navbar bell, and why there is deliberately no email channel. |
| [`docs/icons.md`](docs/icons.md) | The owned icon set and its three codegen targets. No icon library — importing one is a lint error. |
| [`apps/desktop/README.md`](apps/desktop/README.md) | The Electron desktop shell: which server it talks to, security posture, packaging. |

## Production debugging escape hatch

`pnpm db:proxy:cloud` still starts the Cloud SQL Auth Proxy if you need to inspect prod data. Connect with a read-only IAM identity and a separate SQL client — do not point the local app at production.

## Notes

- Directory search is fuzzy/keyword only (client-side relevance matching + server-side ILIKE pickers). The former *directory* semantic search was removed; context/notes search still uses pgvector embeddings when `OPENAI_API_KEY` is set.
- Cookie name `auth_session`. Mobile sends `Authorization: Bearer <jwt>`. Same JWT system, two transports — see `apps/web/lib/session.ts`.
- The dev auth bypass routes (`/dev/login`, `/api/dev/*`) return 404 unless both `NODE_ENV=development` and `ENABLE_DEV_AUTH=true`. Production builds compile `NODE_ENV=production` so the guard cannot be opened by env vars alone.
- User-built Tools render in a sandboxed iframe served from `TOOLS_ORIGIN` (see `apps/web/.env.example`; default local value already set) — a separate, cookie-less origin so the Tool sandbox can never read the app's session. See `docs/tools.md`.
