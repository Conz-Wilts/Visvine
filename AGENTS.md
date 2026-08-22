# Visvine — agent guide

Multi-tenant relationship-context platform. Next.js 16 web app (`apps/web`) +
native iOS/Android clients (`apps/mobile`), Postgres + pgvector via Prisma 7.
pnpm workspace, Node ≥ 20.

`README.md` is the human-facing setup/seed reference — commands, anchor users,
seed layers. This file is the parts an agent needs before editing code.

## Working rules

- Local dev runs against the Docker Postgres; production is Cloud SQL. They
  share zero data. Never point the local app at production.
- `apps/web/AGENTS.md` is written by `next dev` — do not hand-edit it. Next 16
  differs from older training data: read `apps/web/node_modules/next/dist/docs/`
  before writing framework code.
- Verify with `pnpm typecheck`, `pnpm lint` (`--max-warnings=0`), `pnpm test`,
  and `pnpm --filter @visvine/web knip` before calling work done.
- Building while `pnpm dev` runs was fatal before Next 16; 16.3 splits
  `.next/dev`, but prefer typecheck/lint over a build to check work.
- Nothing you create by clicking through the UI survives to another machine. If
  it matters, codify it in the seed (`apps/web/prisma/seed.ts` + the
  `db:blackbird:*` layers).
- **A schema change is a migration.** Edit `schema.prisma`, then
  `pnpm db:migrate:new` to write the SQL, and read what it wrote — a rename it
  guessed as drop + create is a wipe. `prisma/migrations/0_init` is the baseline
  (the whole schema as one migration); everything before it is in
  `prisma/migrations-archive`, kept to read, never to run. Deploy replays
  migrations; it does not diff. Never `prisma db push` against prod.

## Layout

```
apps/web/app/          routes; app/api/* handlers only — no domain logic
apps/web/features/<domain>/{components,hooks,lib}   domain UI
apps/web/components/ui/                             the ONLY shared UI
apps/web/lib/          domain + server logic (the real code lives here)
apps/web/tests/        node:test + tsx, one file per concern
apps/web/prisma/       schema.prisma (52 models), seed, migrations
scripts/               repo-level db/env tooling (dump, restore, proxy, guards)
```

Import alias `@/*` → `apps/web/*`. An eslint boundary rule enforces that only
`@/components/ui` is shared; domain UI belongs in
`@/features/<domain>/components`.

## Conventions

- **Route handlers are thin.** Use `lib/api/route.ts`: `requireApiSession`,
  `requireSpaceAdmin`, `parseBody(request, zodSchema)`, and `ApiError(status,
  msg)` for throws. Each returns either a value or a `NextResponse` — check
  `instanceof NextResponse` and return it.
- **Reuse the shared helpers** rather than re-rolling: `lib/fetchJson.ts`,
  `lib/date.ts`, `components/ui/Modal.tsx`, `lib/logger.ts`.
- Zod v4 for all input validation. Prisma client is the singleton in
  `lib/prisma.ts`.
- **A table is named after the tool that owns it** — `context_*`, `connector_*`,
  `event_*`, `resource_*`, `message_*`. Only genuinely cross-tool things go
  unprefixed (`spaces`, `users`, `people`, `identities`, `nodes`, `links`,
  `oauth_*`). `prisma/TABLES.md` is the plain-English map of all of them.
  The notes surface is **Context**, everywhere — in the schema, the code and the
  UI. Don't reintroduce another word for it.
- Tests: `node --import tsx --test tests/*.test.ts`. Prefer testing the pure
  layer (`lib/notes/shared/*`, `lib/connectors/perimeter.ts`) over routes.

## Auth and permissions

- Sessions are 30-day HS256 JWTs (`lib/session.ts`). Web sends cookie
  `auth_session`; mobile sends `Authorization: Bearer <jwt>`. One system, two
  transports.
- **There is no role column.** What someone can do comes from the aliases they
  hold. "Admin" has exactly one definition: a Person alias flagged `admin`
  (`lib/auth.ts#isAdmin`); `SUPER_ADMIN_EMAILS` bypasses per-space checks.
- Context access is grant-based (`lib/notes/access.ts` for DB,
  `lib/notes/shared/authz.ts` for the pure checks). Grants apply to **shared**
  contexts only; personal spaces bypass the model (`lib/notes/principal.ts`).
- Account deletion (`lib/account/deleteAccount.ts`, `DELETE /api/account`) is the
  one place a person erases themselves. Cascades cover only half of it — the
  personal-context tables key `owner_key`, aliases/grants/OAuth tokens key a bare
  `user_id`, and `Person.userId` is SET NULL — so anything new keyed that way must
  be added there. `tests/delete-account.test.ts` reads the schema and fails if it
  isn't.
- Dev auth bypass (`/dev/login`, `/api/dev/*`) 404s unless `NODE_ENV=development`
  **and** `ENABLE_DEV_AUTH=true`. Production builds cannot open it via env alone.

## The notes/context model

- An **entity** = a typed `Node` + one canonical context note at a deterministic
  path (`person:craig` → `people/craig.md`).
- **Links are derived, not authored.** A markdown link to an entity's note,
  inside another shared-context note, is what creates a `mentioned` edge. There is
  no create-link operation anywhere in the system.
- **An index note IS a folder, and folder-ness is the PATH.** Every folder
  carries an `index.md`; its `title` is the folder's display name, its body is
  prose plus a machine-maintained child list between `<!-- index:children -->`
  markers. Its `type:` says what the folder is ABOUT — `Person` on a person's
  context folder, nothing at all on a folder that just groups notes. `Index` is
  not a type and no note may declare it. A folder appears when one is needed:
  write `a/b/c.md` and `a/b.md` becomes `a/b/index.md` by itself. Rules live in
  `lib/notes/shared/indexNote.ts`; `pnpm --filter @visvine/web db:notes:verify`
  is what keeps seeded data honest — run it after hand-editing any seed layer.
- Folders marked **"Freeze for AI"** bind the write gate for autonomous origins
  (`agent`, `ai-enrich`, `maintenance`); human edits still pass.
- **The Visvine space (`visvine`) is the global record.** One person node +
  `people/<slug>.md` per `Identity` that is public anywhere, gathered from public
  spaces and claimed profiles (`lib/global/*`, `docs/global-records.md`).
  Everyone reads it; a person writes only their own record; nothing is created
  there by hand. Spaces bind person nodes to the record (`metadata.globalMode`
  `follow` | `fork`) instead of needing a member; private spaces never feed it.
  `pnpm --filter @visvine/web db:global:rebuild` after hand-editing seeds.
- The node-type vocabulary is **closed**. Agents pick an existing type and may
  only suggest a new one in prose.
- Context-tree UI invariants (2026-08 redesign): shared expansion hook, no
  global graphs.

## Search

`contextService.searchContext` → `lib/notes/shared/retrieval.ts#fusedSearch`. Five
stages fused by weighted RRF: frontmatter filter, BM25 over note text (title ×3,
tags ×2), pgvector cosine over note embeddings, source-chunk cosine + Postgres
full-text, and link-context neighbours of the top BM25 hits (recall net, weight
0.4). Cosine hits must clear both a relative floor (85% of top) and 0.55
absolute.

Vector stages need `OPENAI_API_KEY` (`text-embedding-3-small`, 768 dims). Without
it the response reports `semantic: "no-key"` rather than silently degrading.
After setting the key run `pnpm db:embed` once to backfill. Directory search
itself is fuzzy/keyword only — the old semantic directory search was removed.

## MCP surface

Two endpoints, on `mcp-handler` 2 + the official TS SDK v2 (FastMCP was
evaluated and rejected). `/api/mcp` is the everyday context server — eighteen
tools: sixteen from `lib/mcp/tools.ts` plus `list_tools`/`install_tool` from
`lib/mcp/appTools.ts`. `/api/mcp/creator` is the Tool authoring loop — nine
tools, `list_spaces` plus the rest of `appTools.ts`. Each has its own OAuth
protected resource, so a token for one is refused by the other.

The identity clients render — name, title, website, logo — is
`lib/mcp/config.ts#mcpServerInfo`. The logo is the favicon PNG, but served from
`public/images/brand-icon.png` rather than Next's hashed `app/icon.png` route,
because a client fetches it cross-origin and unauthenticated long after that
build. Keep the two files identical.

Reads default to the **shared** context, writes to your **personal** one. Notes
created in a real space's shared context are private by default (author gets FULL,
then the path is restricted); pass `visibility: 'inherit'` to follow the folder.

Tools call the domain layer directly and **never re-implement authorization** —
`lib/mcp/context.ts` resolves the context through the same `resolveContext` /
`principalOf` the web routes use. Adding a tool:

1. Wrap a `contextService.*` function that already takes a `ContextPrincipal`.
2. Register the name in `TOOL_SCOPES` (`lib/mcp/scopes.ts`) — the single map read
   by both the `insufficient_scope` challenge and `withCtx`.
3. Update the count assertion in `tests/mcp.test.ts`.

## Connectors

A connector is a note. Two halves, and the split is the security model:

- **Frontmatter = perimeter.** Deterministic, machine-enforced: `hosts:` (literal,
  SSRF-checked, never from a secret), `env:` (`{{secret:NAME}}` refs only),
  optional method+path `allow:` rules, `timeout_ms`. Stays YAML so prose — e.g. a
  prompt-injected note — can never widen reach.
- **Body = behavior.** Free prose teaching an agent how to call the service.
  No platform code per vendor.

`alias` is display-only. Secrets live encrypted in `ConnectorSecret`, never in
notes. The `connectors/` folder is admin-only for writes regardless of grants
(`contextService.writeDenial`).

**Model connectors** (`kind: model`, `provider: gemini|openai|anthropic|custom`;
`lib/connectors/model.ts`) are the one non-perimeter kind: they represent the
LLM provider a Space's agents run on, keyed by the reserved `MODEL_KEY_<PROVIDER>`
secret, with the base URL from `lib/agents/registry.ts` (never the note). They
list beside HTTP connectors and may appear in a brief's `connectors:`, but
`loadConnector` refuses them — `run_connector` hands caller-authored JS the
plaintext of every secret its env binds, so a runnable model connector would let
any `connectors:use` member exfiltrate or spend the key. Keep it that way.

Runtime: one QuickJS-WASM isolate (`lib/connectors/isolate.ts`) — no filesystem,
no process, no require/import, no timers, no real fetch. Agents run
`run_connector(name, code)`; globals are `fetch`, `sql`, `mcp`, `sleep`, `env`,
`console`. Host capabilities are `hostFetch.ts` (order is load-bearing: scheme →
method → path → host → allow rules → SSRF → socket; `redirect: 'manual'`),
`hostSql.ts` (read-only single SELECT in a `READ ONLY` transaction),
`hostMcp.ts` (JSON-RPC over `hostFetch`, inheriting the gate), and `marshal.ts`
(`redactDeep` walks structures; string-based redaction breaks on secrets ending
in a backslash).

Three traps, all learned the hard way:

1. **Never asyncify.** Host capabilities must be sync functions returning a
   QuickJS promise (`ctx.newPromise()`) that the host settles. The asyncify
   transform corrupts after one or two calls — and an OAuth dance is two before
   it does anything useful.
2. **Ownership.** Create the context with `module.newContext()` so it owns its
   runtime, and keep capability/console handles alive for the context's
   lifetime. Breaking either aborts the WASM module, not throws.
3. **Pin the singlefile variant.** `@jitl/quickjs-singlefile-cjs-release-sync`,
   because the meta-package resolves a `wasmfile` variant that loads `.wasm` by
   runtime path — untraced by `output: "standalone"`, works in dev, `ENOENT`s on
   Cloud Run. Listed in `next.config.ts#serverExternalPackages` with
   `pg`/`mysql2`.

Accepted trade-offs: non-HTTP protocols need a new host function; a timed-out run
leaks one context deliberately (a failed dispose is caught, module dropped) rather
than taking the process down; DNS rebinding remains possible between
`assertPubliclyRoutable` and the socket.

Verification: `tests/connector-isolate.test.ts` (escape battery, perimeter,
timeout/memory/leak, 25-sequential-calls regression). Live, against `pnpm dev`:
`pnpm db:connectors:demo` / `:funds` / `:oauth` to seed, then
`pnpm --filter @visvine/web connectors:verify:funds` / `:oauth` through the real
MCP server. The OAuth suite is the one that matters — token expiry + refresh, 429
backoff, cursor pagination, i.e. many host calls in one run.

## Production

`docs/runbook.md` is the operational reference — release, rollback, alerting,
backups, secret rotation. The parts that constrain how you write code:

- **The runtime scales to zero, so nothing may rely on a long-lived process.**
  An in-process `setInterval`/`setTimeout` schedule on Cloud Run is work that
  silently never happens. Background work belongs on a Cloud Scheduler job
  hitting an `/api/internal/*` endpoint that authenticates itself with Google
  OIDC pinned to its own path (`lib/agents/internalAuth.ts`), the way the agent
  tick and the nightly sweep do. `lib/notes/shared/nightly.ts#nightlyDriver` is
  the pattern for detecting which world you are in.
- **The runtime is also N processes, so no cross-request state may live in a
  Map.** Rate limits are rows (`lib/rateLimit/`); a per-process limiter on a
  service with `--max-instances=10` is ten limits, reset on every cold start.
- **`logger.error()` is the alerting surface.** In production every call is
  emitted as a Cloud Error Reporting event, grouped by stack signature. Use
  `error` for a genuine fault and `warn` for the app working as designed — a
  warn routed to error reporting buries the real failures. Always pass the
  caught value (`{ err }`) so the record carries a real stack.
- **The CSP is per request, in `proxy.ts`.** It carries a nonce, so it cannot
  live in `next.config.ts#headers()` — setting it in both places emits two CSP
  headers, which browsers enforce as the intersection, and the app loses every
  script. `script-src` has no `'unsafe-inline'`; if something needs an inline
  script, it needs the nonce, not a policy change (`lib/security/csp.ts`).
- **`/api/health` must never grow a dependency.** Cloud Run's liveness probe
  uses it; making it require the database means a database outage kills and
  restarts every instance into that same outage. Deep checks go behind `?deep=1`.
- **Ciphertext is under a key ring**, not a key (`lib/crypto/secrets.ts`). Any
  new column holding an encrypted value must be added to
  `scripts/rotate-secrets-key.ts`, or the next rotation strands it.

## Gotchas

- A stale space id in `localStorage` produces "Unknown space" 404s after
  a reseed. Reload the tab first before debugging anything else.
- `pnpm db:seed` **wipes the local DB**. `db:fresh` drops and rebuilds tables;
  `db:reset` destroys the docker volume (both guarded by
  `scripts/guard-local-db.mjs`).
- Never commit `.env` — `pnpm env:check` / `env:check:staged` guard this.
- CI runs against a real pgvector Postgres, so a test may talk to a database.
  Guard it the way `tests/agents-tick.test.ts` does — localhost-only, and skip
  loudly rather than pass silently when there is none.
