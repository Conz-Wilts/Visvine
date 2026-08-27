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
apps/web/lib/actions/  every action the platform offers — the one MCP tool's
                       registry, and POST /api/actions/<name>
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

## Spaces nest

`docs/sub-spaces.md` is the model. The parts that constrain code:

- A child is a full `Space` row with `parentId` — its own context, members,
  aliases, tool rail. Nothing is keyed by folder. Depth ≤ 3
  (`lib/spaces/hierarchy.ts`, pure; `lib/spaces/tree.ts`, DB).
- `visibility` is `public | private | inherit`; `inherit` (children only) means
  the parent's active members. A root can't inherit; a public child needs a
  public parent; sibling names are unique (partial index
  `prisma/sql/sibling-space-name-unique.sql`).
- **A child's member is a member of its parent.** Every join path enforces it
  and removal from a parent removes from every descendant
  (`removeFromDescendants`). Admin of a space is admin of everything below it
  (`adminSpaceIds` walks ancestors).
- **Every `space` node carries `metadata.spaceRef` to a real space.** Create →
  Space links an existing one or provisions a child of the current space
  (`createEntity`); its note carries `space: <id>`. `db:spaces:records` is the
  idempotent backfill, `db:notes:verify` asserts it. Creating a space always
  goes through `lib/spaces/provision.ts`.
- **A record is not a tenant.** An organisation you only track — a portfolio
  company, say — is a directory record of its own type (`Company` in the
  Blackbird seed) whose note still lives in `communities/`; `company` folds onto
  `space` in `TYPE_SYNONYMS`, so the entity machinery is unchanged while
  `db:spaces:records` leaves it alone. Reserve `type: space` for the things that
  really nest: in the seed, Blackbird's three teams.
- **A sub-space's record is a folder at the ROOT of the parent's context** —
  `operations/index.md`, beside `deals/` and `data/`, so the tree shows one
  folder per team. The discriminator is the node id: `subspace:<slug>` is a
  space nested inside this one, anything else (`space:`, `community:`, `org:`) is
  a record of the outside world and stays in `communities/`. It is the id and
  not `metadata` because every surface deriving a path holds `{ id, type }` and
  many are client components that never load metadata
  (`lib/notes/entities.ts#isChildSpaceNode`).
- **That record folder carries the child's OWN tree, federated in.** The child
  is a separate context, so the folder would otherwise sit empty and read as
  broken. `GET /api/notes/tree` resolves each folder whose index declares
  `space: <id>` through the ordinary `resolveContext` for that session — a
  viewer who can't see the child gets its 403 and the folder stays empty — and
  grafts its tree under the record (`lib/notes/shared/federation.ts`, pure and
  tested). Grafted nodes are rebased under the record folder so their paths are
  unique in THIS tree, and carry `foreign: { spaceId, path }`: they are
  read-only here (no move, delete, share or drop target, and never a Move
  destination) and opening one switches space rather than navigating in this
  one. The child's own `index.md` is dropped — the parent's record note is that
  folder's home page — and a note the parent wrote under the record folder wins
  its path.
- **A new space starts with every toggleable tool off** — `defaultFeatureConfig()`,
  never the parent's rail. Both create routes, `provisionSpace` and the seed
  write it; the people in the space opt in from the console.
- Listings (Discover, `/communities`) show roots; children are reached through
  the switcher tree.

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
  path, and **the entity is a folder**: `person:craig` → `people/craig/index.md`,
  where the index IS the person (`type: Person`, `node:`) and everything else in
  `people/craig/` is a sub-note about them. Person, organisation (`space`), event,
  resource, channel and tool are folder-only from the first write
  (`lib/notes/entities.ts#FOLDER_ONLY_ENTITY_KINDS`); the flat path
  `people/craig.md` is an alias a stale link or client reaches the note through
  (`canonicalEntityPath`), never where it lives. The config kinds — connector,
  agent, section — are read by name by the runtime and stay one flat note until
  a sub-note converts them. Never add a separate "general info" note beside an
  index: the index is that note.
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
  `people/<slug>/index.md` per `Identity` that is public anywhere, gathered from public
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

**A query is planned before any stage runs** (`lib/notes/shared/queryPlan.ts`,
pure and deterministic): time words ("last week", "in June 2024", "since March",
"2026-03-15") become the `updatedAfter/Before` filter and are stripped from the
text the stages rank on; a query with nothing topical left ("what happened
yesterday") is *temporal-only* and is answered by recency inside the range with
no text stage at all; a history phrasing ("why did we stop…", "used to") turns
the lifecycle down-ranking off, because the retired note IS the answer. The
server widens the plan with one structured LLM call (`lib/notes/queryRewrite.ts`,
GEMINI_API_KEY, skipped for ≤3-word queries and temporal-only asks): up to three
alternate phrasings, each run through BM25 and the vector stages as its own
stage at weight 0.7, and a date range used only when the parser found none. The
rewrite is untrusted output (`coerceQueryRewrite`) and can only add phrasings
and bounds; a caller's explicit time bound disables inference entirely. Every
result reports its `plan` — phrasings, range, `temporal_only`, `intent`, and
whether the rewrite ran — the way `semantic` reports the vector half.

**Derived memories are the answer-sized tier.** The nightly sweep
(`lib/notes/memorySweep.ts`, also `pnpm db:memories`, 50 notes a run) asks the
chat model for the one-sentence claims a note states — self-contained, subject
named — and stores them in `context_memories` keyed like the note vectors
(`(space, owner, path)`, `mtime` of the save they came from, no foreign key,
pruned on delete/rename in `projections.ts#dropEmbedding`, reconciled by the
sweep). Which notes yield them and what an extraction may become is the pure
half, `lib/notes/shared/memories.ts`. `lib/notes/memoryStage.ts` ranks claims
(cosine + Postgres full text) for the visible notes **at their current mtime**
only, and `fusedSearch` folds every hit onto its note at weight 1 — a memory is
evidence for a note, never a result of its own — keeping the best claim as the
hit's `claim`. That field is what an agent reads instead of the note.

An optional rerank of the over-fetched head (3×k, at most 30) sits after fusion
behind the injected `Reranker`; `lib/notes/rerank.ts` is a listwise LLM judge,
on only with `CONTEXT_RERANK=llm`, and its scores are lifecycle-weighted like
fused ones. `pnpm eval:retrieval` is the regression gate for all of it.

Vector stages need `OPENAI_API_KEY` (`text-embedding-3-small`, 768 dims). Without
it the response reports `semantic: "no-key"` rather than silently degrading.
After setting the key run `pnpm db:embed` once to backfill. Directory search
itself is fuzzy/keyword only — the old semantic directory search was removed.

## Actions, and the one MCP tool

**Everything Visvine can be asked to do is an Action.** One definition, two
doors, and it is the same definition either way:

```
HTTP   POST /api/actions/<name>       session-authenticated, curl-able
MCP    the single `visvine` tool      lib/mcp/gateway.ts
```

Both go through `runAction` (`lib/actions/run.ts`) — same registry lookup, same
scope gate, same Zod validation, same body — so neither can drift and a
behaviour proved through one holds through the other. `GET /api/actions` is the
catalogue; `GET /api/actions/<name>` is that action's manual.

The MCP servers register **one tool each**, and it has three modes:

```
visvine({ request })                  the plan for that ask, plus the catalogue
visvine({ action })                   that action's manual
visvine({ action, input })            run it
```

**Supplying `input` is what runs something.** That is the safety property worth
having on a single-tool surface: naming an action to find out what it does
cannot accidentally do it, and there is no mode flag to get wrong. An action
taking no arguments is still run with `input: {}`.

### The action notes

The guidance lives in the **Visvine global space** as notes — `actions/<name>.md`
and `recipes/<id>.md` — read at run time by `lib/actions/notes.ts`. That is the
point of the shape: this platform's premise is that context notes are how you
direct an agent, so its own capabilities are declared in notes rather than in a
protocol. Connecting costs one tool schema whatever the catalogue grows to, and
the manual is fetched when there is a reason to.

`pnpm --filter @visvine/web db:actions:sync` renders the shipped catalogues
(`lib/actions/defs/*`, `lib/actions/recipes.ts`) into those notes. It is an
**enhancement, not a prerequisite**: with none written the guide answers from
the same content in code, so the order of two deploy steps can never decide whether
the surface routes at all. Syncing is what makes the content editable in the
app, by the admin of the Visvine space (`connor@visvine.com` in production).

**A note can describe an action; it can never invent one.** `runAction` resolves
names against the registry, the required scope is read from the definition, and
the `params:` an action's note advertises are regenerated from its Zod schema
into a `<!-- action:contract -->` block on every sync. Prose outside that block
is the maintainer's and survives untouched. So the half a model relies on to
make a correct call cannot drift from the code, and the half explaining *when*
to make it can be improved without a deploy — the same split connectors make
between frontmatter and body.

Recipes are how a request is routed. Matching is a weighted term
overlap over each note's `keywords:` (`lib/actions/shared/match.ts`) — pure,
deterministic, free, and keywords rather than regular expressions so a recipe
survives the round trip through YAML and nothing ever compiles a pattern
supplied by content. A recipe is advice, never authorization: every step still
runs through the same gates, so a wrong recipe costs a refusal, never an escape.

### Adding an action

1. Wrap a `contextService.*` (or other domain) function that already takes a
   `ContextPrincipal`, as a `defineAction({ … })` in `lib/actions/defs/*`.
2. Declare its `scope` there. That is the only place it is written — both the
   `insufficient_scope` challenge and `runAction` read `scopeForAction`.
3. Give it a `summary` (its catalogue line) and a `description` (the note's
   default prose), and describe every argument — an undescribed argument in a
   catalogue is one a caller has to guess at.
4. Run `db:actions:sync` so the notes say so.

### One server

**One endpoint, `/api/mcp`**, on `mcp-handler` 2 + the official TS SDK v2
(FastMCP was evaluated and rejected), and one OAuth protected resource. Every
action is behind the one tool — context, Drive, events, connectors, agents and
the Tool authoring loop — because which one a request needs is a question the
action notes answer better than a client picking an endpoint could.

**Scopes carry the boundary**, and they are the only thing that does. What
separates reading someone's notes from writing executable code into their space
is that authoring rides `tools:author` and never `context:write`, that a client
must ASK for a scope, and that the person approving sees each one spelled out
(`SCOPE_DESCRIPTIONS`). `DEFAULT_SCOPES` is read-only, so a client that requests
nothing gets nothing but reads. There is no per-server ceiling above
`negotiateScopes` any more — if a scope is ever widened, nothing else is
standing behind it.

`/api/mcp/creator` 308s to `/api/mcp`, and `legacyResourceUrl()` keeps the
tokens and `resource` parameters of connections made before the merge
verifying. Both are deletable once nothing is configured that way. The
`oauth_auth_codes.resource` column is now constant (`'context'`) rather than
migrated away: codes live five minutes, so one issued before the merge is still
in flight, and re-splitting later would want the binding back.

The identity clients render — name, title, website, logo — is
`lib/mcp/config.ts#mcpServerInfo`. The logo is the favicon PNG, but served from
`public/images/brand-icon.png` rather than Next's hashed `app/icon.png` route,
because a client fetches it cross-origin and unauthenticated long after that
build. Keep the two files identical.

Locally there is no auth at all. `pnpm mcp:dev` (root `scripts/mcp-dev.mjs`) is
`pnpm dev` plus a banner, the committed `.mcp.json` points at the endpoint with
no token, and `mcpBearerVerifier` turns a request with no bearer token into the
seeded dev user with every scope (`lib/mcp/devIdentity.ts`;
`--user`/`DEV_MCP_USER` picks which one). The guard is `isDevAuthEnabled()` —
`ENABLE_DEV_AUTH=true` AND `NODE_ENV=development`, which `next build` cannot
satisfy. A token that *is* presented is verified normally, so `insufficient_scope`
step-up is still reproducible locally.

Production is the full OAuth 2.1 flow and nothing else. There is no refresh
grant: an access token is a stateless **30-day** JWT and that is the whole life
of a grant, so `grant_types_supported` is `['authorization_code']`, there is no
revocation endpoint (nothing is stored to revoke) and the `oauth_refresh_tokens`
table is dropped (migration `20260830120000`). The reason that is tolerable is
that the token carries identity, never authorization — `lib/actions/resolve.ts`
re-resolves the principal and their per-space access from the database on every
call, so removing someone bites immediately regardless of what they hold.
`ACCESS_TTL_SECONDS` is the only lever on the window.

Scope challenges are per ACTION, read out of `params.arguments.action`
(`lib/mcp/challenge.ts`). Discovery — the plan, the catalogue, an action's
manual — is never challenged, so a token that cannot yet do the work can still
find out what to ask for and step up once.

### The Drive feeds the record

`list_drive` is the Drive as things to USE, not text to search: it returns a
`resource_id` per file and, unlike `list_files`/`search_context`, it shows
IMAGES — which carry no text and so reach retrieval nowhere. That id is the
currency: `create_event` / `update_event` take `cover_resource_id` and
`lib/events/cover.ts` copies those bytes into the event's own image variants
(`mediaPrefixBare('event', …)`, the same prefix `/api/upload` writes and
`purgeNodeObjects` collects). A file is used by id **inside** the tenant — a
signed download URL is a bearer capability for the bytes and is never handed to
a caller, which is why that action queries `Resource` rows directly rather
than through `listResources`.

An event created this way is a **draft** unless `status: 'published'` is passed:
publishing is what makes it visible, and at `visibility: 'public'` it is on the
open web at `/e/<slug>`. The marketing copy belongs in the event's own folder
(`events/<slug>/marketing.md`), written with `edit_context` — the `run_event`
recipe in `lib/actions/recipes.ts` is that whole loop, and the composer's "From
Drive" button is the same cover call for a person
(`POST /api/events/<id>/cover`). Both doors build the record through
`lib/events/build.ts`; nothing else may derive an event id or its defaults.

Reads default to the **shared** context, writes to your **personal** one. Notes
created in a real space's shared context are private by default (author gets FULL,
then the path is restricted); pass `visibility: 'inherit'` to follow the folder.

Actions call the domain layer directly and **never re-implement authorization** —
`lib/actions/resolve.ts` resolves the context through the same `resolveContext` /
`principalOf` the web routes use. A scope is necessary, never sufficient.

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

**Connectors is a section of the Space Console**, not a sidebar tool: it is
admins-only by nature, so `/admin?section=connectors` IS the surface
(`features/connectors/components/ConnectorsPanel.tsx`). The key is core and
nav-hidden (`lib/featureAccess.ts`) — there is no rail row and no on/off
switch. The section is the catalog (`lib/connectors/catalog.ts`): one
searchable list of known services (All / Connected / Not connected), each a
recipe — fields to fill in, the note that comes out. Saving writes the ordinary
`connectors/<name>.md` and PUTs each secret field to
`/api/communities/<space>/secrets`; nothing else changes. Connected rows get
Manage — what it reaches, which secrets it names, where the note is, plus
**Turn off** and **Delete**. The row itself goes to the connector's page: the
note IS the connector, so that is where it is read and edited. A connector the
space wrote itself is a row too, under a plug rather than a logo, and is still
authored on the draft surface.

**Off is `enabled: false` in the frontmatter** (`isConnectorEnabled`), written
by `PATCH …/connectors/<name>`; turning one back on deletes the key rather than
writing the default. The note, its secrets and its perimeter are untouched —
`loadConnector` refuses every run, and a disabled `provider: custom` model
connector stops being the Space's endpoint (`lib/agents/providers.ts`). It is
configuration held in reserve, not a thing to delete and rebuild.

A connector's mark is one component on both surfaces
(`ConnectorLogo` — the list row and the connector's own page header): the
recipe's logo, resolved by `catalogEntryFor` on the note name and then the
model provider, and the plug for a connector the space wrote itself. Nothing is
stamped into the note to make that exact — a miss is a plug, and no behaviour
hangs off it. Logos live in `public/images/connectors/`. `tests/connector-catalog.test.ts`
runs every recipe through the real parsers, so a new entry that would write an
invalid note fails there.

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

## Tools

A Tool is three notes (`tools/<name>/{index.md,ui.tsx,data.js}`) compiled on
write, run in a sandboxed iframe on a cookie-less origin. `docs/tools.md` is the
guide. The one invariant to hold before touching any of it:

- **A Tool belongs to the space that wrote it.** Publishing a version ships it
  to that space and NOWHERE else. `AppToolVersion` carries two independent
  verdicts and both are asked, in order (`registry.ts#installability`, pure):
  `status` is the source space's admin — `approved` makes it installable in that
  space and its descendants — and `marketplaceStatus` is Visvine's, **null until
  an admin explicitly submits it**, and only `approved` there lists it or lets an
  unrelated space install it. Never widen a query over versions without deciding
  which verdict it is asking about.
- **Publishing is a member act; approving is the admin's.** An admin's publish
  lands approved (they are the approver); a member's lands pending and notifies
  the space's admins — that is the update queue, on `/tools?tab=approvals`. A
  re-publish supersedes the author's earlier pending submission rather than
  being refused.
- The working copy renders live at `/tools/preview/<name>` for anyone who can
  read the note. That path is load-bearing: `create_tool`, `write_tool` and
  `preview_tool` all hand it back, and the desktop deep link resolves to it.

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
