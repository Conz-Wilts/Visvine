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
apps/web/prisma/       schema.prisma (37 models), seed, migrations
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
  hold. "Admin" has exactly one definition: a Person alias flagged `owner`
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
- **An index note IS a folder.** Every folder carries an `index.md` typed
  `Index`; its `title` is the folder's display name, its body is prose plus a
  machine-maintained child list between `<!-- index:children -->` markers.
  Nothing else may claim `type: Index`. Rules live in
  `lib/notes/shared/indexNote.ts`; `pnpm --filter @visvine/web db:notes:verify`
  is what keeps seeded data honest — run it after hand-editing any seed layer.
- Folders marked **"Freeze for AI"** bind the write gate for autonomous origins
  (`agent`, `ai-enrich`, `maintenance`); human edits still pass.
- The node-type vocabulary is **closed**. Agents pick an existing type and may
  only suggest a new one in prose.
- Context-tree UI invariants (2026-08 redesign): shared expansion hook,
  keep-set prune, no global graphs.

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

Thirteen tools at `/api/mcp` (`app/api/mcp/route.ts`, registered in
`lib/mcp/tools.ts`), on `mcp-handler` 2 + the official TS SDK v2. FastMCP was
evaluated and rejected.

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

`alias` is display-only. Secrets live encrypted in `SpaceSecret`, never in
notes. The `connectors/` folder is admin-only for writes regardless of grants
(`contextService.writeDenial`).

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

## Gotchas

- A stale space id in `localStorage` produces "Unknown space" 404s after
  a reseed. Reload the tab first before debugging anything else.
- `pnpm db:seed` **wipes the local DB**. `db:fresh` drops and rebuilds tables;
  `db:reset` destroys the docker volume (both guarded by
  `scripts/guard-local-db.mjs`).
- Never commit `.env` — `pnpm env:check` / `env:check:staged` guard this.
