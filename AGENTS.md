# Visvine — agent guide

Multi-tenant relationship-context platform. Next.js 16 web app (`apps/web`) +
native iOS/Android clients (`apps/mobile`), Postgres + pgvector via Prisma 7.
pnpm workspace, Node ≥ 20.

`README.md` is the human setup/seed reference. This file is the rules an agent
needs before editing. Deeper detail lives in `docs/` — this file points there
rather than repeating it.

## Working rules

- Local dev is Docker Postgres + local disk; production is Cloud SQL + GCS.
  They share zero data, bytes included. Never point local at production.
- `apps/web/AGENTS.md` is written by `next dev` — do not hand-edit. Next 16
  differs from older training data: read `apps/web/node_modules/next/dist/docs/`
  before writing framework code.
- Verify with `pnpm typecheck`, `pnpm lint` (`--max-warnings=0`), `pnpm test`,
  `pnpm --filter @visvine/web knip`. Prefer these over a build.
- **A schema change is a migration.** Edit `schema.prisma`, run
  `pnpm db:migrate:new`, then READ the SQL — a rename it guessed as drop+create
  is a wipe. `migrations/0_init` is the baseline; `migrations-archive` is
  read-only history. Deploy replays migrations, never diffs. Never
  `prisma db push` against prod.
- Nothing created by clicking through the UI survives to another machine. If it
  matters, codify it in the seed (`apps/web/scripts/seed/`, run by `pnpm db:seed`).
- Commit freely; **push only when the user asks**. `main` is the deployed branch.

## Layout

```
apps/web/app/          routes; app/api/* handlers only — no domain logic
apps/web/features/<domain>/{components,hooks,lib}   domain UI
apps/web/lib/          domain + server logic (the real code lives here)
apps/web/lib/actions/  every action the platform offers — the MCP registry
                       and POST /api/actions/<name>
apps/web/tests/        node:test + tsx, one file per concern
apps/web/prisma/       schema.prisma (52 models), seed, migrations
packages/tokens/       design tokens (DTCG) → CSS, TS, Swift, Kotlin
packages/ui/           @visvine/ui — the ONLY shared UI, built on the tokens
scripts/               repo-level db/env tooling
```

`@/*` → `apps/web/*`. An eslint boundary rule enforces that shared UI comes
from `@visvine/ui`; domain UI lives in `@/features/<domain>/components`.

## Conventions

- **Route handlers are thin.** Use `lib/api/route.ts`: `requireApiSession`,
  `requireSpaceAdmin`, `parseBody(request, zodSchema)`, `ApiError(status, msg)`.
  Each returns a value or a `NextResponse` — check `instanceof NextResponse`.
- Reuse `lib/fetchJson.ts`, `lib/date.ts`, `@visvine/ui` (`Modal`, `Button`,
  `Tabs`, `useToasts`…), `lib/logger.ts` rather than re-rolling them.
- **One read per fact.** A client read that outlives a mount goes through
  `features/shared/lib/requestCache.ts` (`swrFetch` / `cachedFetch`, or
  `inflightFetch` for must-be-fresh lists) so a sibling, a tab toggle or a
  back-navigation never re-asks; a write invalidates its keys. The session is
  `useAuth()`, never a bare `useSession()`. Polls take `usePageVisible`. On the
  server, per-request authority reads (space row, aliases, membership,
  feature config) are `lib/requestMemo.ts` — React `cache()` is a no-op in a
  Route Handler — and a writer calls `.forget()` before reading again.
- Zod v4 for all input validation. Prisma client is the singleton in
  `lib/prisma.ts`.
- **A type's structured facts are a row; its note is prose.** What a machine
  enforces or schedules on (an agent's model, reach, schedule, identity) is a
  column in its tool's table, written through one service function with its
  gates; the note holds what a person or model reads as meaning. Agents are
  the first (`lib/agents/shared/agentConfig.ts`); connectors, models and tools
  follow the same shape.
- **A table is named after the tool that owns it** — `context_*`, `connector_*`,
  `event_*`, `resource_*`, `message_*`. Only cross-tool things go unprefixed
  (`spaces`, `users`, `identities`, `nodes`, `links`, `oauth_*`).
  `prisma/TABLES.md` maps them all.
- The notes surface is **Context**, in the schema, the code and the UI. No
  synonyms.
- Tests: `node --import tsx --test tests/*.test.ts`. Prefer the pure layer
  (`lib/notes/shared/*`, `lib/connectors/perimeter.ts`) over routes.

## Design

Clean, simple, intentional. **If a screen needs text to explain itself, the
screen is wrong** — fix the design, don't caption it.

- **Labels name, they don't explain.** One to three words: `Fixes`, `Semantic
  search`, `Run now`. No section descriptions, no sentences under a checkbox,
  no "(off = …)" in a label, no restating what a control already shows.
- **A section's switch sits in its header**, beside its title — not as a
  second labelled row underneath saying the same thing.
- **Say only the exceptional.** No "No folder is frozen", "Nothing is
  scheduled", "Nothing has run yet": an empty section is hidden, a normal state
  is silent. A warning line appears only when something is actually wrong.
- **State is data, joined by `·`**: `Runs as Ana · sees 73 of 73 notes · next
  in 5h` — one muted line, not a paragraph per fact.
- **How it works belongs in `docs/` and code comments**, never on the page.
  The guarantees a feature keeps (gates, scope, what it never writes) are
  enforced by the server; the UI does not recite them.
- Surfaces are flat: hairline sections, no cards, shadows only on things that
  float.
- **Every value is a design token** (`packages/tokens`; the whole system —
  token names, scales, components, native mirroring — is `packages/ui/DESIGN.md`). Paint with the role utilities — `bg-surface`,
  `text-fg-muted`, `border-line-subtle`, `bg-accent`, `text-danger`,
  `bg-hue-blue-wash` — or `color` / `palette` from `@visvine/tokens` where a
  class cannot go. Never a Tailwind palette class, never a hex:
  `tests/design-tokens.test.ts` fails on both. A new value is a token first
  (`pnpm tokens:build` regenerates web, desktop, iOS and Android).

## A space is a tenant, and may hold sub-spaces

Every space is a `Space` row with its own context, members, aliases and tool
rail. `visibility` is `public | private`. Creation always goes through
`lib/spaces/provision.ts` — from the switcher, the console, and the
`create_space` action (`lib/actions/defs/spaces.ts`), never `add_context`. Spaces nest **one level** (`docs/sub-spaces.md`).

- **A record is not a tenant.** An organisation a space tracks is a directory
  record whose note lives in `spaces/`; `company` folds onto `space` in
  `TYPE_SYNONYMS`. Creating one provisions nothing.
- **A `space` node MAY name a space that runs here** via `metadata.spaceRef`
  (and `space: <id>` in frontmatter), which routes its page to
  `/spaces/<id>`. `db:notes:verify` only checks that a ref that IS set
  resolves.
- **A new space starts with every toggleable tool off** —
  `defaultFeatureConfig()`, written by both create routes, `provisionSpace` and
  the seed. `channels` is the only toggleable key; there is no `notes` key, because
  context is not a feature of a space but what a space IS.
- **A sub-space's visibility is its own**, and membership never crosses the
  boundary: the creator holds its Admin alias, the parent's admins do not.
  Created by the parent's admins (`POST /api/spaces` with `parentId`, or
  the `create_space` action with `parent_id`); a
  sub-space cannot hold sub-spaces (`subspaces.ts#parentDenial`); sibling names
  are unique (`spaces_sibling_name_unique`).
- **The tree's top is the space, then `Main`, then the rooms** —
  `lib/notes/shared/rootTiers.ts#tierRoot`, pure, applied to the DRAWN tree
  last (after the search prune), so every read of a real path still sees the
  tree the server sent. `Main` holds the space's own context and stands for the
  context root: its path is the reserved `:main:` (a `:` prefix is not a note
  path, the trick `TRASH_PATH` uses), the root's `index.md` folds into its row,
  and `drawn: 'main'` is what keeps it out of drag, drop, Share and Delete. A
  space with no rooms has one tier and gets no `Main` row, and a `Sub-spaces`
  folder a space has PLACED under a folder of its own stays put. Nothing moves:
  a room's notes are still addressed `subspaces/<id>/`.
- **Another space's context is its own TIER, never a folder of this one's.**
  A room row and `parent/` are stamped `federated`, which sorts them after
  every folder the space holds (`context.ts#sortTree`) and draws one hairline
  above the first of them (`NoteSidebar#TierSeam`). A room's row offers **Open
  <room>**, because expanding it (reading the room's context from here) and
  standing in it are two different acts that otherwise look identical — and in
  the tree a room is READ ONLY (`writableSpaces` is empty by construction; the
  write-hop through `federation.ts#writeTarget` still serves API callers).
- **A listed sub-space's context flows up** as the folder `subspaces/<id>/`,
  federated at read time by `lib/notes/federation.ts` (tree, index, single
  read, search each have a federated form). **Through it you are who you are
  in the sub-space** (`subspaceReader`): a member or admin of it reads AND
  writes under their own standing there — the item, folders and access routes
  hop a write across with `federation.ts#writeTarget` / `moveTargets` and run
  the ordinary gates against the sub-space, rebasing response paths back;
  the tree stamps the grafted folder `writable` so the sidebar offers Move /
  Delete under it. Anyone else reads under the sub-space's
  **everyone-principal** — no admin standing, space-wide grants only, capped
  to view (`access.ts#spaceWideAccessFor`) — and is refused a write with
  "join it to edit". Never hopped: `parent/`, the `subspaces` folder, a
  sub-space's root, access management, and an agent's / MCP `write_context`.
  A public sub-space is born with a space-wide view grant at its root, and
  one made public LATER gets the same grant from `ensureFlowUpGrant` —
  without it the parent grafts a folder it can read nothing through.
  `subspaces/` is reserved in every space's own context
  (`subspaceWriteDenial`) — the graft has its own root precisely so that
  `spaces/` is free to hold the space RECORDS, whose slugs would otherwise
  shadow a sub-space id.
- **A private sub-space is closed, not secret: the parent's members see its
  NAME.** `listLockedSubspaces` returns its own thin shape (never a `Space`,
  which carries aliases and tool config) for private sub-spaces of a space the
  caller actively belongs to. Drawn in ONE place — a locked row on the
  switcher's branch. The context tree draws only rooms whose context flows
  here: a locked folder there holds nothing and can take nothing, so it is a
  row that only ever fails. A secret room (`listing: 'secret'`) is named
  nowhere. Pressing the row goes through the room's **door**: `POST …/join`
  writes what `selfJoinOutcome` → `subspaces.ts#joinOutcome` says — the house
  door for the parent's members, the world door for everyone else, each
  `invite` | `ask` | `open`, the world door never wider than the house's.
  `ask` = **pending**, answered on Members → Wants to join beside the
  invite-link requests. A pending join writes no person node, no alias, no
  cache bust.
- **A room answers four dials, each owned by the side that owns the thing;
  nothing is inherited** (`docs/sub-space-model.md`, code map in
  `docs/sub-spaces.md`). `listing` (secret/house/world; `visibility` stays
  the gate column, derived world ⇔ public — `listingOf`), two doors, two
  upward flows (`flowContext` / `flowEvents`; none from a secret room), and
  `parentAdmins`. Up: context as the `subspaces/<id>/` folder (editable by
  the room's members, read-only for the rest) and **public events**
  (`viaSpace`; hub card and `GET /api/events?includeSubspaces=1`; detail
  through `requireSpaceMemberOrParent`). **People never flow: a space's
  directory is what that space records.** A room's person is a record of the
  room, reached in the room; the one join across the family is the identity —
  a person added anywhere in the family with no email/LinkedIn takes the
  identity the family already uses for that name, when exactly one does
  (`lib/identity/family.ts`, applied by `attachIdentity` and note adoption) —
  and `GET /api/nodes/<id>` carries the family's other records of it as
  `same_person`, only for spaces the viewer belongs to
  (`lib/directory/shared/samePerson.ts`). Action reads stamp every entity with
  `identity_id` so an agent sees two spaces' records as one person. Down, per note and per room: a house's
  `connectors/`, `agents/` or `tools/` note with `share: all | [rooms]` is
  read into those rooms as the read-only `parent/` folder (`graftParent`,
  `federation.ts#parentShare`) — **no principal on that side; the flag is the
  whole grant.** A shared connector runs with the house's secrets on the
  house's quota (`readConnectorNote`: own space → parent's shared →
  personal) and refuses a room admin's writes; a shared agent (`share_as:
  use`) starts from `run_agent` **in the house, as the house brief's author**
  (`claimManualRun` `runAs: 'author'`), child → parent only, while
  `share_as: run-in` fans an `agent_state` row stamped `shared_from` into each
  governed room so a copy runs over that room's context; a shared Tool is
  installed in the room; the house's model keys reach the rooms
  `subspace_config.modelKeys` names. A parent agent watching `subspaces/**`
  is woken by a save in a flowing room (`fireNoteTriggers`). `parentAdmins`
  is one step in `isAdmin`, on when a house admin creates the room; off is
  any room admin's act, back on only a holder of the room's own admin alias.
  Nothing of a space's own is stored under either reserved address
  (`federatedWriteDenial`, in `writeDenial`); the routes hop a
  `subspaces/<id>/` write into the sub-space before that gate is asked.
  Presets (`PRESETS`) are dial settings, chosen at creation.
- **The Directory draws no sub-space UI** — sub-spaces are not directory
  nodes; they are reached from the switcher and the context tree and managed
  from Console → Sub-spaces (`SubspacesSection` over
  `GET /api/spaces/<id>/subspaces`, which carries the dials, `viewerStatus`
  and `upcomingEvents` per row). The old `/directory` band and its
  `hiddenFromBand` preference are gone (2026-09-15).
- Deleting a space with sub-spaces is children-first in
  `DELETE /api/data/spaces` (the parent relation is Restrict).
- Listings are flat lists with "in *Parent*" beside a sub-space only when the
  parent is also visible to you; the switcher opens a parent's sub-spaces on its
  chevron (`subspaces.ts#spaceBranches`, `SpaceListRow`, `TreeSpine`).

## The space is in the URL

Every page that renders inside a space is addressed `/s/<space>/<page>`, or
`/s/<house>/<room>/<page>` in a sub-space (`lib/spaces/shared/spaceUrl.ts`,
pure and tested). A link is the whole address: shared, bookmarked or restored
it opens the same space, and two tabs stand in two spaces.

- **The routes do not move.** `proxy.ts` rewrites a space URL onto the
  unprefixed route and hands the page the prefix (`x-visvine-space-prefix`);
  `redirectInSpace` keeps a server `redirect()` under it. The page roots are
  `SPACE_ROUTE_ROOTS`; `/spaces`, `/discover`, `/e/<slug>` and the rest sit
  outside every space.
- **The URL decides the space.** `SpaceContext` resolves `currentSpace` from the
  path and never falls back to another space under a space URL. A room named
  without its house is re-addressed under it; a space the viewer is not in goes
  to `/spaces/<id>`, whose overview answers 404 to anyone its listing hides it
  from. `localStorage` and the `vv_space` cookie only answer a page reached
  with no space in it.
- **Navigation goes through the wrappers**: `Link` from
  `features/shared/components/SpaceLink`, `useSpaceRouter`, `spaceHref` /
  `useSpaceHref`, `useRoutePathname` for "which page is this". Lint refuses raw
  `next/link` and `useRouter`. An unprefixed in-app href still works — the proxy
  sends it under the space of the page it came from — but costs a hop and copies
  without a space.
- **Switching is a navigation**: `setCurrentSpace(space, path?)` goes to `path`
  in that space, or to the same section (`sameSectionIn`).
- **Server hrefs name the space by id** (`inSpace`) — an action's `watch`,
  `page`, `href`, `preview_url`. The client re-addresses a room under its house.
- **No space id may be a page name** (`isSpaceRouteName`, in
  `isReservedSpaceId`): a room's id sits where the page does.

## The Feed

`/feed` is the rail row above Discover: one stream of posts from every space a
person is in, outside every space like `/discover`. **A post is a top-level
message in a FEED-mode channel; a comment is a reply to it** — there are no
feed tables. `lib/messages/feedService.ts#listFeedForUser` is the one read
(`GET /api/feed`, keyset-paged): channels the caller has JOINED, in spaces they
are an active member of, where Channels is a tool they can open
(`canAccessFeature`). The first page carries `targets`, the same set, which is
where the composer may post. Every act — post, comment, react, star, edit,
delete — goes to the post's own channel through the messages routes, so their
gates and broadcasts are the only ones. Live is `/api/messages/stream` patched
through `lib/messages/shared/feed.ts#applyFeedEvent` (pure, tested); because
that stream fans out inside one process, the first page is re-read on
reconnect and when the tab comes back.

## Creating things

**Nothing in the apps creates anything. Every new thing is asked of an AI over
the Visvine MCP server**, which runs the action for it; web, desktop, iOS and
Android are where what it made is read, edited, published and switched on.
There is no Create button, no draft surface, no `/events/new`. The exceptions
are a file or link posted in a channel, as in Slack, and **Build a tool** in
the rail's More sheet: the in-app builder (`lib/tools/builder.ts`) is still
an AI doing the creating — a chat on the space's model whose tools are the
authoring actions, run as the person — for someone with no AI client of
their own. The Directory's
Resources tab adds nothing — a resource comes in over MCP so its note is
written with it.

| Kind | Action |
|---|---|
| Note, folder, custom-typed note | `edit_context` (a folder is its `index.md`) |
| Person, organisation record | `add_context` |
| Resource (a file or a link) | `upload_file` (with `channel_id` it is posted there), `add_context` with a `url`, `share_resource` to post one into a channel — **and** a file or link posted in a channel |
| Event | `create_event` → edited and published at `/events/<id>/edit` |
| Space, sub-space | `create_space` — **and** New space on the switcher (`NewSpaceDialog`), the one create the app keeps, because a new account has no space to act in |
| Agent | `create_agent`, then `activate_agent` |
| Tool | `create_tool` → `write_tool` → `publish_tool` — **and** Build a tool in More (the builder, over the same actions) |
| Channel, section | `create_channel`, `create_section` (`lib/actions/defs/channels.ts`) |
| Type | `add_type` |
| A file (image, PDF, document) | `upload_file`, or `request_upload` for a chat attachment the model can only see |
| Connector, model | `edit_context` on `connectors/<name>.md` / `models/<name>.md`; the key is pasted, or the sign-in pressed, on the connector's or model's own page — a credential never passes through the AI |

**A build asks first.** Every recipe that makes something carries an intake
(`lib/actions/shared/intake.ts`: agent, connector, event, space, tool — at
most four questions, one message, each saying what it decides and when to
skip it), and the action's own description opens with `intakeSummary` for a
client that never reads the recipe. The intake is the form the app no longer
has.

## Auth and permissions

- Sessions are 30-day HS256 JWTs (`lib/session.ts`). Web sends cookie
  `auth_session`; mobile sends `Authorization: Bearer <jwt>`.
- **There is no role column.** Authority comes from aliases. "Admin" means a
  Person alias flagged `admin` (`lib/auth.ts#isAdmin`); `SUPER_ADMIN_EMAILS`
  bypasses per-space checks.
- Context access is grant-based (`lib/notes/access.ts` for DB,
  `lib/notes/shared/authz.ts` for pure checks). Grants apply to **shared**
  contexts only; a `me:<userId>` space bypasses the model
  (`lib/notes/principal.ts`).
- **Nobody is given a space.** A new account holds no space until the person
  creates one (`provisionSpace`) or joins one; `currentSpace` is null until
  then and `/home` sends them to the directory. `me:<userId>` rows
  (`personalOwnerId` set) exist only from before this rule: still private to
  their owner, never grant-gated, and nothing provisions one. Every action
  that writes, runs or lists ONE space targets the space named in `space_id`
  — there is no `scope` argument. **The reads may omit it** — `search_context`,
  `list_events`, `list_agents`, `list_connectors`, `list_resources` (`inSpaces` in
  `lib/actions/searchEverywhere.ts`; `list_context` is bearings in ONE space
  and keeps it). `search_context` without one runs the same federated search
  in every space the caller can act in
  (`lib/actions/searchEverywhere.ts`, each under `resolveTarget`, one plan
  shared, capped at `MAX_SEARCH_SPACES`) and folds the rankings
  (`shared/everywhere.ts`, pure: a room the caller is in is searched directly,
  so the house's `subspaces/<id>/` hop into it is dropped). Every hit and
  entity carries `space`, `read_with` carries `space_id`, and `spaces` says
  what was searched; the list reads stamp every row with `space`. A write with no `space_id` is refused by `runAction` with
  the caller's spaces named, so the model asks the person which space rather
  than guess — nothing server-side ever picks a tenant for a write.
- Account deletion (`lib/account/deleteAccount.ts`, `DELETE /api/account`) is
  the one place a person erases themselves. Cascades cover only half — personal
  context tables key `owner_key`, aliases/grants/OAuth key a bare `user_id`,
  `Person.userId` is SET NULL — so anything new keyed that way must be added
  there. `tests/delete-account.test.ts` reads the schema and fails if it isn't.
- Dev auth (`/dev/login`, `/api/dev/*`) 404s unless `NODE_ENV=development` AND
  `ENABLE_DEV_AUTH=true`. A production build cannot open it via env alone.

## The notes/context model

- An **entity** = a typed `Node` + one canonical note, and **the entity is a
  folder**: `person:craig` → `people/craig/index.md`, where the index IS the
  person (`type: Person`, `node:`). Person, space, event, resource, channel and
  tool are folder-only from the first write
  (`entities.ts#FOLDER_ONLY_ENTITY_KINDS`); the flat path is an alias stale
  links resolve through (`canonicalEntityPath`). Config kinds (connector,
  section) stay flat until a sub-note converts them. Never add a "general info"
  note beside an index — the index IS that note.
- **A kind's namespace is named after the kind, and one table says so** —
  `lib/notes/shared/namespaces.ts` (pure, leaf): `people/`, `spaces/`,
  `events/`, `resources/`, `sections/`, `channels/`, `connectors/`, `agents/`,
  `tools/`, `models/`, plus `subspaces/` and `parent/`, which belong to no
  kind and which NOTHING may write. A space's configuration is the `spaces`
  row alone. Each row carries the folder, its kind, the feature that owns it, how it
  appears, who writes it and the line its index says it holds — so `ENTITY_DIRS`,
  the tree's graft, the reserved descriptions and the tool gate are four reads
  of one row. A space RECORD lives in `spaces/`; the sub-space graft is
  `subspaces/`. A note path is link identity, so a namespace is renamed only by
  moving every note and rewriting every link — `db:rename:spaces` is the one
  that did it. **Two kinds of namespace folder.** A LANDING folder —
  `agents/`, `tools/`, `connectors/`, `models/` (`landing: true` on the row) —
  is only where a new thing of its kind is written, because each of those is
  found by what its note declares (`lib/agents/location.ts`,
  `lib/tools/location.ts`, `lib/connectors/locate.ts`,
  `lib/models/locate.ts`). It may be MOVED into a folder of the space's own —
  the index of wherever it went says `home: agents`, new things land there,
  and a new note addressed `agents/…` is written there (`lib/notes/landing.ts`,
  `contextService#landingPath`) — and DELETED while empty, which the root
  index records as `hidden: [agents]` so it stops standing. The rest are
  FIXED: their paths are identity or another space's context, and they are
  **placed, never moved** (`lib/notes/shared/placedFolders.ts`): the tree
  draws one under a folder of the space's own when that folder's index note
  says `holds: [events]`, and the path stays. Sub-spaces sit
  in one `Sub-spaces` folder (`subspaces/`) and are placed the same way;
  `POST /api/notes/folders/place` is the one door.
- **A folder appears because there is something in it**, and a new space holds
  only its root `index.md`. Two exceptions: a namespace a person writes into
  FROM the tree stands there empty — `agents/` for anyone, `connectors/` for an
  admin (`standingFolders`, grafted by `GET /api/notes/tree`) — and a namespace
  whose TOOL is off is not created at all. That second one is
  `namespaceFeatureRefusal`, enforced in `contextService.writeDenialFull` and at
  the three create paths that use the sync gate (`POST /api/notes/item`,
  `POST /api/notes/folders`, `moveGated`'s destination), plus the Channels
  routes' own `featureAccessForbidden`. It refuses only while the namespace
  holds NOTHING: switching a tool off freezes its folder, it never strands it.
  Today that is `channels/` and `sections/`; the next toggleable tool is a row,
  not a special case.
- **An index note IS a folder, and folder-ness is the PATH.** Every folder has
  an `index.md` in ONE shape, held by `indexNote.ts#normalizeIndexNote` on every
  write: frontmatter (`type` only when the folder is about something, `title`,
  `node`, `description`, `tags`, then the type's own keys), prose, then the
  machine-maintained child list between `<!-- index:children -->` markers, LAST.
  No `# Title` in the body. The block is the **Open Knowledge Format's index**
  (OKF v0.2 §8): `## Section` headings — `Subdirectories`, then one per child
  `type:` (pluralised), then `Notes` — over rows
  `* [Title](relative-path.md) - description`, hrefs relative to the folder, so
  a space's context reads as an OKF bundle checked out of git. Every direct
  child is listed, with its own `description:`. `Index` and `Note` name a shape, not a
  subject, and are stripped from a plain folder's `type:`. Writing `a/b/c.md`
  turns `a/b.md` into `a/b/index.md` by itself. Rules:
  `lib/notes/shared/indexNote.ts`. `db:index-notes:rebuild` migrates old shapes;
  `db:notes:verify` keeps seeds honest — run it after hand-editing a seed layer.
- **A note is an entity because of what it DECLARES, not where it was filed.**
  A note anywhere carrying `type: Person` (or Space, Resource, Event) is
  adopted: it gets a node, a profile page, backlinks and `[[mentions]]` exactly
  as one written under `people/`. The node records where its note lives in
  `metadata.notePath`, and that path is then the only path naming it — the
  derived `people/<slug>.md` is never registered, so it stays free.
  `entities.ts#adoptedNotePath` is the one read of the pointer as an adoption;
  `entityLinks.ts#syncAdoptedNode` makes the node on write and drops it when the
  `type:` or the note goes. Only the record kinds adopt
  (`ADOPTABLE_ENTITY_KINDS`) and never under `connectors/`, `models/`,
  `agents/`, `tools/`, `settings/` or `spaces/` — a note that could mint one of
  those is a way around an admin-only write gate, not a convenience. A rename
  carries the node (`repointAdoptedNodes`); an adopted folder's index carries
  `node:` like any entity index.
- **A connector is what a note declares too, and the gate follows the
  declaration** (`lib/notes/shared/configKinds.ts`, pure). The built-in
  folders are where a new thing LANDS, not the only place it may be: a space
  that files its connectors by team keeps `teams/growth/hubspot.md` with
  `type: connector`, and that IS the connector — same name (the file name),
  same node (`connector:<name>`, carried through a move by
  `repointConnectorNodes`), same secrets, same runs. Because the
  declaration is what makes it one, `contextService.configKindDenial` asks
  it on every write, move and delete, of the note being written AND the note
  already there: a note declaring `type: connector` or `type: model` is a
  space admin's wherever it sits, so a member who can edit `teams/` can
  neither mint a connector there nor strip the type off one; a folder
  holding one is renamed or deleted by an admin only
  (`folderConfigKindDenial`). A connector sits in `connectors/<name>.md` or a
  folder of the space's own — never inside another built-in folder, never an
  index, never under `subspaces/` or `parent/` (`connectorHomeDenial`) — and
  changes folder, never file name, because briefs, connections and secrets
  key on the name. **Nothing finds a connector by building its path**:
  `lib/connectors/locate.ts` (`connectorNotePathIn`, `connectorNoteRows`) is
  the one read, the runtime, the console, the machine policy, the webhook
  door, the agent options and the house's share-down (`isSharedDown`) all go
  through it, and `connectors/<name>.md` wins its name over a copy elsewhere.
  The path gate on `connectors/` and `models/` stays as well. The tree stamps
  `declares` on such a note so the sidebar offers the moves the server would
  allow. A model is the same: `type: model` in `models/<name>.md` or a folder
  of the space's own, found by `lib/models/locate.ts`.
- **Links are derived, not authored.** A markdown link to an entity's note,
  inside another shared-context note, creates the `mentioned` edge. There is no
  create-link operation anywhere.
- Folders marked **"Freeze for AI"** bind the write gate for autonomous origins
  (`agent`, `ai-enrich`, `maintenance`); human edits still pass.
- **The Visvine space (`visvine`) is the global record**: one person node +
  `people/<slug>/index.md` per `Identity` public anywhere (`lib/global/*`,
  `docs/global-records.md`). Everyone reads it; a person writes only their own.
  Spaces bind person nodes with `metadata.globalMode` `follow` | `fork`; private
  spaces never feed it. Run `db:global:rebuild` after hand-editing seeds.
- The node-type vocabulary is **closed**. Agents pick an existing type and may
  only suggest a new one in prose.

## Agents

`docs/agents.md` is the full reference. The invariants:

- **An agent is a folder, and it may be filed anywhere.** `agents/<name>/`
  is where a new one lands; a folder of the space's own whose index declares
  `type: agent` (`teams/growth/digest/`) is the same agent. The folder's name
  is the agent's name and its identity, so it moves between folders and is
  never renamed; one name per space. Nothing builds an agent's path:
  `lib/agents/location.ts` finds it (home, then the state row's
  `brief_note_id`, then the declaration), `lib/agents/shared/folder.ts` holds
  the pure rules, and the gate keeps `agents/`'s AI freeze and own-folder
  opening for a filed agent (`contextService#agentPlaceDenial`).
- **The note is what an agent IS; the row is how it RUNS.** The folder's `index.md`
  holds `type`, `title`, `description`, `tags` and the brief. Model, connectors,
  tools, `agents`, share, dry run, turn cap, `runs_as`, who it runs for and the
  activation (`active`, the clock, `on` triggers, `debounce`, `timezone`) are
  COLUMNS — `agent_state` + `agent_subscriptions`, every change kept in
  `agent_config_changes` (`lib/agents/shared/agentConfig.ts`, pure). One write,
  `service.ts#configureAgent` (`PUT …/agents/<name>/config`, `configure_agent`,
  activation, subscribers), each field keeping its gate: anyone who can edit the
  folder (`agentManageDenial`), `runs_as` naming someone else an admin's,
  runs-for self-only; budget admin-only. One read, `briefs.ts#readAgent` /
  `composeAgent`: the note with the record rendered as the frontmatter keys the
  parsers in `config.ts` validate, so a rule has one definition. The gate refuses
  run keys in a brief (`contextService#briefRunKeyDenial`); a brief still
  carrying them (older data, a seed, a script) is ADOPTED by the store hook —
  folded into the record, stripped from the note (`hooks.ts#adoptNoteConfig`;
  `db:agents:to-rows` does every agent at once). A row with `configured_at` null
  is pre-record and still read from its note. Editing a brief does NOT switch
  the agent off.
  Everything else in the folder is the agent's own — the ONE place under
  `agents/` a run stamped `agent:<name>` may write (`contextService.lockedDenial`).
  Nothing under `agents/` ever fires a trigger. The run prompt is
  `lib/agents/shared/prompt.ts`; `create_agent` and its recipe quote it.
- **Memory is a note with a shape; a run's trace is a row.** Conclusions live in
  `agents/<name>/memory.md` — four sections, `What I know`, `Decisions`,
  `Open threads`, `Last run` (`lib/agents/shared/memory.ts`, pure) — so they get
  revisions, authorship and grants for free. What it DID is `agent_runs.events`,
  never a note (a transcript would flood search). The runner hands the note to
  every run as a system message; the agent adds one line with `remember` (deduped,
  capped per section) and never rewrites the file; the runner replaces `Last run`.
  Cursors go under `What I know`; structured values are tracked fields on nodes.
- **Agents are grouped by the brief's `tags:`.** The first tag is the group; every
  tag lands on the `agent:<name>` node (`entityLinks.ts#syncAgentNode`), so the
  Directory's tag filter reaches agents. Config's Group field writes the same key
  (`briefEdit.ts`) — tags stay in the note because they classify what it IS.
- **A name is not an identity.** `agent_state` is keyed `(space, name)` and
  outlives the note, so it carries `brief_note_id`. A DIFFERENT note at the same
  name is a new agent, and `syncAgentState` retires the previous incarnation
  (runs, subscribers, mail). A restore keeps the note id, so it is the same
  agent. The space's own record — spend, egress, machine logs — survives either
  way. `db:agents:stamp` binds pre-column rows.
- **Capabilities are the brief's `tools:` plus what the space has.** Notes,
  `run_agent` and the people tools are always on. `web` is `fetch_url` and
  nothing else — **searching is fetching a search engine's results URL**, so
  there is no search vendor and no per-provider code. `actions` is the whole
  Action registry through `runAction` as the author (every scope but
  `secrets:write`). `directory` as named (`sandbox` and `messages` still parse
  and add nothing). A machine comes with any space that has one, no brief key
  needed (`docs/machines.md`) — **but its reach is the brief's `connectors:`**:
  every lease passes those connectors' hosts as the narrowing `taskAllow`
  (`connectorReachFor` → `machineAllow`), so the browser and `run_connector`
  answer to one declaration and a brief declaring none gets a machine with no
  network. Anything judging an agent's reach outside a run goes through
  `lib/agents/machineReach.ts`. The split is a **secrets boundary, not a cost
  one**: the isolate hands connector JS the plaintext of its env inside one
  connector's perimeter; the machine never holds plaintext at all. The
  preamble says the ladder — `fetch_url`, then `run_connector`, then
  `run_command`, then `open_page` — cheapest door that does the job. An open
  page is read with `page_snapshot` and worked with `page_act` or
  `browse_task`, never a hand-written script (`docs/machines.md`).
- **One agent can run FOR many people, and who is in the brief.** Identity is
  per RUN (`agent_runs.run_as_user_id`). The record's **runs-for** lists the
  people (`agent_subscriptions`; `lib/agents/shared/runsFor.ts`, pure): the user,
  and optionally their own `at`, `timezone` and `model`. A fire runs as the brief's author (or
  `runs_as`), then once per person under THEIR principal — so a `mode: user`
  connector spends their account, on their model (`modelFor`, read by the
  runner and the preflight). A person with their own time on a daily/weekly
  agent fires then: `next_run_at` is the earliest of everyone's next occurrence
  and a fire runs only those whose time came round; an event-woken fire is for
  everyone (`shared/fanout.ts#nextFire` / `dueIdentities`, pure). A `local/*`
  person is never fired by the tick. **An entry is a principal, so it is the
  person's own to add**: `configureAgent` (`runsForDenial`) lets a writer
  remove anyone and add or change only themselves (an admin anyone); a reader
  adds themselves through `POST …/subscribers`, which writes that one entry
  for them. `deleteAccount` drops their rows and re-saves each record
  (`dropRunsFor`). Capped by `MAX_FANOUT_SUBSCRIBERS`.
  A manual run acts as whoever pressed Run. Event payloads ride only the first
  run. `connectorReadiness` surfaces per-person readiness before a 3am run
  discovers it. **One run is one person's accounts, and what is theirs is an
  input**: the record declares `inputs`, the agent's own identity holds
  `input_values`, each runs-for entry its own; the brief names one as
  `{{key}}` (`lib/agents/shared/inputs.ts`, pure). A run for a person with a
  required input empty or a declared connector not signed in fails `config`
  before a model is paid (`needs.ts#signInsOwed`), uncounted when it was for
  someone else; Run and `run_agent` ask for the presser's missing values.
- **A brief says what it still needs.** `create_agent` and `rehearse_agent`
  answer with `needs` and `plan` (`lib/agents/shared/needs.ts`, pure;
  `lib/agents/needs.ts` gathers inputs): no model in the space, a declared
  connector missing/off/invalid/not signed in, or a catalogue service the
  instructions NAME but the brief never declared. `create_agent` still writes a
  brief declaring a connector the space lacks; `activate_agent` refuses on a
  **hard** need (`hardNeeds`) and warns on a sign-in the runner owes.
  `AgentNeeds.tsx` shows the same list to a viewer.
- **A run that only TALKED about its tools is a failure, not a success.** A model
  that answers a tool-calling turn with the call written out as text —
  `default_api.fetch_url(...)` in a fenced block, a plan, a JSON envelope —
  made no call, so nothing ran. `lib/notes/shared/narratedToolCall.ts` (pure)
  spots the shape when it names a tool the run actually has; `runToolLoop`
  says so and hands the turn back twice, then ends `narrated`, which the runner
  fails and counts. Recording it as success is what let a digest agent produce
  nothing for days while its own plan went into `memory.md` as what it did.
- **A run finishes the job, or fails `incomplete`.** Before a plain answer
  ends a run, `runToolLoop`'s `review` has the judge read it against the trace
  (`runCheck.ts`): a write it claims but never made, or an answer saying the
  job is half done or blocked, gets the turn back with what is missing
  (`shared/runCheck.ts#nudgeFor`, at most `MAX_REVIEWS`). One still short then
  fails `incomplete` (`incompleteBecause`) — counted, and never written into
  `memory.md`. With no judge an answer that stops on "now I'll …" is handed
  back once (`announcedNextStep`). A verdict only ever adds a turn or marks a
  failure; it never widens reach.
- **A run that falls short gets one more go, on its fallback, and a failed
  run says why.** The record's `fallback_model` is tried ONCE, from the top, in
  the same run, when the first model ends short (`incomplete` or `narrated`) —
  a second model's cost only ever follows a first that did not do the job.
  Every hand-back is a `Handed back — …` line on the run's page. A run that
  fails `incomplete`, `narrated`, `timeout`, `error` or `upstream` is read once
  by the judge for its likely cause (`lib/agents/diagnose.ts`, `RUN_CAUSE_QUESTION`)
  and the page says what to change (`shared/advice.ts#causeAdvice`). The agent
  page and `create_agent` recommend a better-suited model of the space's —
  from how each has done on this space's runs, and with no record from the
  judge's reading of how much the brief asks (`JOB_SHAPE_QUESTION`) —
  as its model or its fallback (`recommendModel`). Advice only; nothing is
  switched on it.
- **What a run reads is kept small.** `fetch_url` returns readable text
  (`lib/links/shared/readable.ts`: HTML as text with `[text](url)` links, JSON
  without highlight copies or long id lists); a page past 20k with no `find`
  returns its opening and how to narrow it; tool results older than six turns
  go out trimmed (`lib/notes/shared/compactMessages.ts`). A model's page shows
  how often each model finished its jobs (`lib/models/shared/trackRecords.ts`).
- **Switching an agent on is approval to run UNATTENDED, and nothing else.** A
  person asking for one run now — Run, the box, `run_agent` — runs an INACTIVE
  agent, as themselves, leaving the row untouched (`claimManualRun`'s
  `allowInactive`, set only where a person stands; a chain and a Tool's
  `agents.run` keep the gate). Trying an agent must not require turning it loose.
- **With no model there is no engine, so `run_agent` hands the round back.** It
  answers `ran: false` + a `stand_in` — preamble, brief, rules — and the caller
  does it on its own subscription. Same shape as `rehearse_agent`, one rule
  different: a rehearsal writes nothing, a stand-in writes through the ordinary
  actions under the caller's name (`rehearsalPlan`'s `mode`).
- **A brief is rehearsed before it is switched on.** `rehearse_agent` runs
  NOTHING: it returns the preamble, brief, model and `connectorReadiness` for
  the CALLER, and the asking model carries that one round itself, on its own
  subscription (`lib/agents/shared/rehearsal.ts`, pure). Nothing billed, no run
  recorded. Rules: one round, write nothing, use only what the brief declares,
  report what is out of reach.
- **A person can chat with an agent, and a chat is not a run.**
  `lib/agents/chat.ts`: a thread per (person, space, agent) in `agent_chat_*`,
  each message one tool-loop turn on the space's model with the brief as system
  prompt, the memory note read-only (no `remember`), the last 20 messages
  replayed, the tools running AS the person. No mailbox, no `agent_runs`, no
  schedule; spend is metered under the agent's name. Gate = can read the
  brief. `docs/agents.md § Chat`; the phone's surface is `docs/mobile.md`.
- **An agent is watched on its own node page** — `/directory/agent:<name>`, the
  Agent tab beside Context and Raw (`AgentPageContent.tsx`). There is no agents
  tool: no rail row, no feature key, no console section. **The roster is the
  Directory's Agents table** (`/directory?view=table&type=agent`): the shared
  `DirectoryTable` with one row per agent — status, on, schedule, next and last
  run, model (edited in place, to the record), connectors, tools, runs for,
  tags (`columnsForType('agent')`, `features/agents/lib/agentRows.ts`) — and
  **the clock** over it (`AgentsClock.tsx`): the next 24 hours, the nightly
  clean, and what is running with its current step
  (`lib/agents/shared/roster.ts` pure, `runs.ts#currentStepOf`). The tab is ONE
  COLUMN with three doors at the right end of the tab row — **Config · History ·
  Share** (`AgentTrail`, `?view=`): the name with the switch and Run; one status line
  (pressing it opens the schedule); then THE RUN as a short numbered list —
  **a step per turn, titled in the model's own first sentence, opening onto the
  calls it made** (`trace.ts#groupSteps`, pure; `RunSteps`), each call opening
  onto its result or the machine's record (`trace.ts#attachMachine` joins
  `agent_vm_events` by run id). The model's narration is never on the page,
  only inside an opened step. **History is its own screen** (`AgentHistory`): the runs, a row opening
  one, over the memory note read a section at a time
  (`memory.ts#memorySections`). **Config is its own screen** (`AgentConfig`):
  one row per brief key — when, model, tools, connectors, group, the admin's
  cap — saved as it is changed, with the machine under it for admins. Anything
  else about an agent (description, sub-space share, dry run, turn cap, skills)
  is edited in the note; there is no settings dialog and no Skills surface. **Who it runs for is part
  of sharing it**: Share on the tab row opens the brief's `SharePanel` with a
  Runs for section (`RunsForSection`) — your own switch, time and model.
  There is no box on the page: a person starts a run with Run; `run_agent`
  still takes a `message` and `send_to_agent` still fills the mailbox
  (`lib/agents/summon.ts`). Actions return `watch` hrefs (`config.ts#agentPageHref`).
  Polling, never a stream.

## Mobile

`docs/mobile.md`. Two native clients (`apps/mobile`), three tabs — Home (space
switcher, feed, People/Events rows), Messages (Agents = chat threads, Contacts = DMs; `POST
/api/messages/conversations { userId }` makes a DM), Activity
(`GET /api/activity`: runs for you, mentions, replies, requests you can
answer with the existing routes, upcoming events — `lib/activity/`, pure fold
tested). `GET /api/feed?spaceId=` is one space's feed. Responses camelCase;
action inputs snake_case; the clients mirror each handler by hand. The
resources surface (files and link cards in messages, the viewer, QuickLook /
`FileProvider` opens) is specced in `docs/resources/mobile.md` and not yet
built. **Tools are web and desktop only**: the server refuses a Bearer session
or a `cl: 'mobile'` one wherever a Tool runs, and the phones are sent none
(`lib/tools/clientClass.ts`, `docs/mobile.md`).

## The Directory

`/directory` is one page, four tabs — Grid · Context · Table · Resources —
with the view on the URL (`?view=table&type=person`, `?view=resources`). Grid and Table share
`useDirectoryBrowse`; Table is per TYPE because the columns are, picked from
`table/TypeStrip.tsx`. `?type=all` is the one cross-type table (core columns
only).

- **A type's columns come from three places, in order**
  (`lib/directory/table.ts#columnsForType`, pure and tested): the core every
  entity has, the property rows the type shows on its note
  (`lib/create/typeFields.ts`), and the space's **tracked fields**.
- **A tracked field is space config; its values are node data.**
  `NodeTypeConfig.fields[]` (`{ key, label, kind, options? }`) rides the space's
  type vocabulary, validated on the way in by `PUT /api/data/spaces`. The value is
  `node.metadata[key]`, written through `PATCH /api/nodes/<id>` and **mirrored
  into the entity note's frontmatter** (`entityNodes.ts#mirroredFields`). Adding
  a field touches no node; removing one leaves values in place, unlisted. Admins
  only (`useTrackedFields`); the key is minted from the label and may never
  collide with a platform key.
- **A member-made type can be deleted; a built-in cannot.** The whole-record PUT
  merges type lists additively (`mergeNodeTypeList`), so shortening needs
  `DELETE /api/spaces/<id>/node-types` — admin-only, and `removeNodeType`
  refuses anything not `scope: 'note'`. Notes keep their `type:`, they just stop
  being coloured.
- **A type is named singular and said plural by rule.** A chip labels one
  thing (`Person`); a tab over a table, a Type filter row and a folder index's
  heading name the set (`People`) — `lib/types/plural.ts` is the one rule
  (`pluralizeTypeWord`, head-word inflection + a short irregular table), read by
  `pluralTypeName(name, nodeTypes)` on every such surface and by
  `indexNote.ts#pluralizeType`. `NodeTypeConfig.plural` is the override for the
  name the rule gets wrong, cleaned in `mergeNodeTypeList`
  (`normalizeTypePlural` drops a blank, malformed or redundant one so a rename
  keeps deriving) and edited as one optional field on Console → Types. A
  heading never reads the override — changing it must not rewrite notes.
- **One resource, many shares** (`docs/resources/README.md`; the design record
  is `docs/resources/PLAN.md`). A `Resource` is an upload or a link
  (`source`), one per canonical URL per space; `resource_shares` says where it
  was shared — the space itself (`conversation_id` null) or a channel, with the
  message that carried it. **Every resource is an entity**: `resources.node_id`
  names its `resource:<slug>` node and `resources/<slug>/index.md`, made by
  `lib/resources/entity.ts#ensureResourceEntity` for every upload, channel file
  and link alike. The Grid hides `resource` unless that type is picked.
- **`resources/` is a file system** (`lib/resources/shared/resourceTree.ts`,
  `lib/resources/tree.ts`): a folder is an index note there with no `type:`,
  a resource is an index declaring `type: Resource` at any depth, and a
  resource never leaves `resources/` (`contextService#resourceHomeDenial`,
  `store.renameFolder`). One filed below the top is adopted — its node's
  `metadata.notePath` follows it through a move, under its own folder name
  (`resourceMoveDenial`); a folder holding resources is not deleted. The
  Resources tab walks it (`?folder=`, the list's `folder`), files with Move
  to… or a drag (`PATCH /api/resources/<id> { folder }` → `fileResource`),
  and folders are made over MCP (`edit_context` on
  `resources/<path>/index.md`). The row-based `resource_folders` /
  `resources.folder_id` are unused, awaiting a drop migration after
  `db:resources:folders-to-notes` has run.
- **Visibility is the union of shares** (`lib/resources/shared/visibility.ts`,
  pure; `visibility.ts` the SQL and `requireVisibleResource`, every byte door's
  and action's one check): admins see all; a space share reaches every member,
  a channel share that channel's members; no share, or trashed, is the
  creator's. The note follows through the `channel` grant subject, written only
  by `grants.ts#syncResourceGrants`. Refused is a 404, like absent. Bytes come
  only through `/api/resources/<id>/raw` (the original) and `/thumb?kind=` (a
  rendition) — the gate, then a five-minute signed URL; a signed URL is never
  stored or returned by an action.
- **Channels may be private** (`Conversation.visibility`): listed to members
  only, joined only by being added, their note restricted to the channel.
  Every resource read inherits it.
- **Uploads are resumable and never re-encoded**
  (`/api/resources/uploads` → chunks → `…/complete`, `lib/resources/upload.ts`):
  the name refused by `shared/uploadPolicy.ts`, the bytes sniffed, then
  `service.ts#finishUpload` makes the entity, the share, the grants and the owed
  jobs. Renditions and text are `resource_jobs` rows drained inline within a
  budget, by `POST /api/resources/jobs/pull`, and by the minute tick — never a
  promise left running after the response. The tick also reaps unfinished
  uploads and deletes what has been 30 days in the trash.
- **A link is a resource wearing its unfurl.** `sendMessage`/`editMessage`
  canonicalise each URL (`lib/links/shared/providers.ts`), upsert the space's
  resource and share it; the card draws from the row at once and fills in on
  `resource.updated`. The unfurl (`lib/resources/unfurl.ts`): the sharer's
  connected Google account for a Drive file, a known provider's oEmbed, the
  page's oEmbed, JSON-LD, Open Graph, Twitter, `<title>` — head only, every hop
  SSRF-checked, images and favicons re-hosted, an oEmbed `html` never stored.
  Embeds are ours, for the allowlist in `providers.ts`, which is also the CSP's
  `frame-src`.
- **One viewer** (`features/resources/viewer/`, chrome in `@visvine/ui`):
  full screen on `?resource=<id>`, stepped down to a side panel with `&panel=1`, a renderer per kind
  from a pure registry. **One list** (`lib/resources/list.ts`) behind
  Directory → Resources, a channel's Files tab, the pickers and
  `list_resources`.
- **A viewer's arrangement is theirs**: column order, hidden columns, widths and
  sort live in `localStorage` per space and type (`useTableView`), never on the
  space record. An unknown column appears at its canonical place.
- Cells edit in place; a refused value is never stored as text. Edits are held
  optimistically because the directory response is cached 30s.

## The nightly clean

**A space cleans and embeds itself on a clock, as a person.** Console →
General → **Nightly** is three controls: a time, **Clean**, and **Embed new or
edited notes**. Clean on runs the role-aware clean (`lib/notes/clean.ts`, the
same code `clean_context` runs) and then the embed if that is on; Embed on alone
only runs `embedSweep`, which touches nothing but new or edited notes. No Run
now, no depth/folder/fix pickers — a scheduled clean is always light,
whole-space, every safe fix. The schedule row holds no authority of its own.

- **A clean runs as the admin who last saved the schedule** (`run_as_user_id`),
  under their principal: their lens decides what is analysed, their gate what
  is written, origin `maintenance`. If that person stops being an admin the run
  is recorded `skipped`.
- **Only the mechanical allow-list is applied**
  (`shared/cleanSchedule.ts#CLEAN_FIX_KINDS` is the ceiling): frontmatter fill,
  one-match link repair, unambiguous mention linking, stale, expiry,
  supersession. Duplicates, contradictions and orphans come back as the
  worklist. Frozen folders are reported, never written. It never changes a
  type, an alias or a folder.
- **Cleaning happens in the space that OWNS the notes, at the top level.** A
  sub-space holds no schedule and a parent never cleans one: `buildCleanScope`
  puts `subspaces/` out of scope.
- **The minute tick fires it** when `enabled` OR `embed_enabled`, claiming due
  rows with a conditional UPDATE that advances `next_run_at` itself — N
  instances racing produce one run, and a night the deployment was down is
  skipped, never replayed. One tick runs at most `MAX_CLEANS_PER_TICK`.
- **The same row owns embedding.** `embed_enabled` is the space's switch for the
  semantic half — off stops the nightly sweep, the query-time catch-up and the
  vector stages alike (`searchContext` reports `semantic: 'off'`, distinct from
  `no-key`); no row means on. The scheduled embed is capped at
  `POST_CLEAN_EMBED_NOTES`, with its own column (`embed_status`) so an embedding
  failure never fails a clean that wrote.

Every pass writes a `context_clean_runs` row (`mode: 'embed'` for an embed-only
pass). `saveCleanSchedule` merges a patch, so the console can save one field.
Deleting the admin it runs as switches the clean off. `mode`, `target_path`,
`apply_fixes`, `fix_kinds` and `embed_after_clean` are unused columns awaiting
a drop migration.

## Search

`contextService.searchContext` → `lib/notes/shared/retrieval.ts#fusedSearch`.
Six stages fused by weighted RRF: frontmatter filter, BM25 over note text
(title ×3, tags ×2), pgvector cosine over whole-note embeddings, cosine over
note chunks, source-chunk cosine + Postgres full-text, and link-context
neighbours of the top BM25 hits (recall net, weight 0.4). Cosine hits must clear
both a relative floor (85% of top) and 0.55 absolute. `pnpm eval:retrieval` is
the regression gate.

- **A note is embedded twice: whole, and by section.**
  `lib/notes/shared/noteChunks.ts` (pure, tested) splits at headings — fenced
  code never opens one, the index child list is dropped — then packs paragraphs
  to `NOTE_CHUNK_CHARS` with overlap inside a section, never past
  `NOTE_CHUNK_MAX_CHARS`. What is embedded is breadcrumb + prose; what is stored
  as `text` is the prose alone. Chunks live in `context_note_chunks`, pruned
  like note vectors (`projections.ts#dropEmbedding`); `chunkStage.ts` ranks them
  against the visible notes' `(path, mtime)` so a stale chunk is never served,
  and `fusedSearch` folds every hit onto its note at weight 1, keeping the best
  as `passage: { heading, text }`. Chunks are written only by `embedSweep`,
  never at query time.
- **Derived memories are the answer-sized tier.** The nightly sweep
  (`lib/notes/memorySweep.ts`, `pnpm db:memories`, 50 notes a run) asks the chat
  model for the self-contained claims a note states and stores them in
  `context_memories`, keyed like note vectors and reconciled by the sweep. Pure
  half: `lib/notes/shared/memories.ts`. `memoryStage.ts` ranks claims at the
  note's current mtime only; `fusedSearch` folds each onto its note at weight 1
  — a memory is evidence, never a result — keeping the best as `claim`, which is
  what an agent reads instead of the note.
- **A query is planned before any stage runs** (`lib/notes/shared/queryPlan.ts`,
  pure, deterministic): time words become `updatedAfter/Before` and are stripped
  from the ranked text; a query with nothing topical left is *temporal-only* and
  answered by recency with no text stage; a history phrasing turns lifecycle
  down-ranking off, because the retired note IS the answer. No model rewrites
  the query: the caller searching (an agent, a model over MCP) rephrases and
  searches again itself. A caller's explicit bound disables inference. Every
  result reports its `plan`.
- **The head of the ranking is judged, and what is not about the query is
  dropped** (`lib/notes/rerank.ts`, behind the injected `Reranker`; the judge is
  below). A `Reranker` with a `floor` drops; one without only reorders. So a
  search may return fewer than `k` hits, each with `relevance`, and
  `answerable: false` means nothing the caller can read is about the query. It
  sits out history and temporal-only plans, and the web search route (a person
  scanning rows) unless asked. Hits from different searches — a house and its
  rooms, several spaces — order by `relevance` (`compareAcrossSearches`), the
  one number that compares across corpora; the all-spaces search judges once,
  after the fold. `CONTEXT_RERANK=llm` swaps in a listwise chat rerank that
  only reorders; `off` runs neither. `pnpm eval:judge` is the live harness.
- **The deployment's own AI is ONE key: `OPENROUTER_API_KEY`.** Chat
  (`lib/notes/ai.ts`, default `deepseek/deepseek-v4-flash-0731`, override
  `OPENROUTER_MODEL`), the judge (`lib/judge/`, `JUDGE_MODEL`) and embeddings (`lib/notes/embeddings.ts`,
  `openai/text-embedding-3-small` at 768 dims, `EMBED_MODEL`) both go through
  OpenRouter. Without it the response reports `semantic: "no-key"` rather than
  degrading silently; after setting it run `pnpm db:embed` once. A space's
  AGENTS never touch this key — they run on the space's `models/` notes and
  `MODEL_KEY_<PROVIDER>` secrets. Directory search is fuzzy/keyword only.

## The judge

`lib/judge/` asks TypeSafe's Jev — a model that answers typed questions with a
probability and writes no text — through OpenRouter's Decisions endpoint, on
`OPENROUTER_API_KEY`. `docs/jev.md` is the reference and the record of what each
use measured. The invariants:

- **Every call is bounded and fails open.** `decide` / `decideMany` return null
  for no key, `JUDGE=off`, a rate limit, a timeout or an upstream error, and
  every caller then behaves as if no judge existed. `warn`, never `error`. The
  allowance is a row spent per batch of at most `MAX_BATCH`; nightly passes are
  `patient`.
- **A verdict never widens REACH.** It drops a search hit, declines a
  wake, vetoes an auto-fix, or attaches a suggestion a person accepts. No
  permission, scope, perimeter or write gate reads one. To the clean's
  auto-fixes it can only REMOVE (`shared/cleanJudge.ts`). **The one place it
  CAUSES something is `browse_task`** (`lib/agents/browseTask.ts`): in the
  machine's browser the judge picks the next operation and the row it lands
  on, a step a second, instead of the agent's model spending a turn per click.
  It picks a row of a table code built (`lib/vm/shared/pageScript.ts`,
  `shared/pageTable.ts`) — never a selector, a URL or text: what is typed is one
  of the `inputs` the model supplied, a password field is never a row, the
  browser reaches only the brief's connectors' hosts, an answer under the floor
  presses nothing and hands the page back, and DONE is a claim the model checks.
  `page_snapshot` / `page_act` are the same table driven by the agent's own
  model, and the fallback when there is no judge.
- **An agent may ask the judge itself** — `decide`: its own yes/no, choice and
  scale questions over a list, numbers back. It writes, grants and gates
  nothing, and is metered per space (`takeSpaceJudgeAllowance`) because it is a
  tenant spending the deployment's key.
- **Every question and floor lives in `lib/judge/shared/questions.ts`**, each
  checked against the live model before its floor was set. The model is
  literal: a question is a plain statement with criteria that agree with it. It
  is weak at dates, numbers and intent, so which note is newer, what a query's
  time words mean and whether a run wrote anything are read in code.
- **The judge does not need embeddings.** With `embed_enabled` off a search is
  keyword-only and the judge still reads its head; the clean and the check
  before a write run without vectors too. `embed_enabled` is a cost switch
  over vectors, never a privacy one.
- Where it sits: search (above); the wake gate at the tick
  (`lib/agents/wakeGate.ts` — a `note_written` event the brief would do nothing
  about is declined and audited, `on.wake: always` opts out); the clean
  (mention and stale vetoes, duplicates and conflicts by meaning, in `light`
  mode so the nightly sees them); the memory sweep (claims checked against
  their note, an edit that changed no fact restamped instead of re-extracted);
  `edit_context` on a new path (`similar`, `suggested`, `check_only` —
  `lib/notes/beforeWrite.ts`); recipe and skill routing (`lib/judge/route.ts`,
  keywords the fallback); a finished run's claims against its trace
  (`lib/agents/shared/runCheck.ts` — unbacked keeps the summary out of
  `memory.md`); `find` on the agent's `fetch_url` / `read_context`; `browse_task` and
  `decide` (above); an injection
  SIGNAL on fetched pages and room notes (`lib/judge/risk.ts`, never on the
  space's own notes — a brief reads as one); implied services in `needs`;
  `suggested` on MCP tools and on an empty select cell.

## Actions, and the one MCP tool

**Everything Visvine can be asked to do is an Action** — one definition, three
doors, all through `runAction` (`lib/actions/run.ts`) with the same registry
lookup, scope gate, Zod validation and body:

```
HTTP   POST /api/actions/<name>            session-authenticated, curl-able
MCP    the `visvine` router                lib/mcp/gateway.ts#registerGateway
MCP    `visvine_<name>`, one per action    gateway.ts#registerActionTools
```

`GET /api/actions` is the catalogue; `GET /api/actions/<name>` is one manual.
Router modes: `{ request }` → the plan + catalogue; `{ action }` → its manual;
`{ action, input }` → run it. **Supplying `input` is what runs something**, so
naming an action to read it cannot accidentally do it; an action with no
arguments still needs `input: {}`. **A named tool always runs** — it exists so a
client can permit or deny per name, log which action ran, and gate on the MCP
hints (`readOnlyHint`, `destructiveHint`, `openWorldHint` — `actionAnnotations`).
The scope challenge reads the action from the tool name, or from
`params.arguments.action` for the router (`challenge.ts#actionToRun`).

### The action notes

Guidance lives in the **Visvine global space** as notes — `actions/<name>.md`,
`recipes/<id>.md`, `guides/<id>.md` — read at run time by `lib/actions/notes.ts`.
`pnpm --filter @visvine/web db:actions:sync` renders the shipped catalogues
(`lib/actions/defs/*`, `lib/actions/recipes.ts`) into them. It is an
**enhancement, not a prerequisite**: with no notes the guide answers from the
same content in code, so deploy order can never decide whether the surface
routes. Syncing makes the content editable in-app by the Visvine space's admin.

- **What several actions share is a guide, written once**
  (`lib/actions/shared/guides.ts`). `add_context`, `edit_context`,
  `append_context` and `clean_context` name `writing_notes` in `guides:`.
  `buildActionDoc` appends each named guide; `visvine({ action: 'writing_notes' })`
  reads one alone; `db:actions:sync` writes `guides/<id>.md` once and never
  overwrites. A guide id is never an action and cannot be run.
- **A note can describe an action; it can never invent one.** Names resolve
  against the registry, the scope comes from the definition, and `params:` is
  regenerated from the Zod schema into a `<!-- action:contract -->` block on
  every sync. Prose outside that block is the maintainer's and survives.
- **A recipe that BUILDS something asks first.** `create_agent` and
  `create_connector` carry an `intake` (`lib/actions/shared/intake.ts`, pure):
  at most four questions, in one message, each saying what it decides and when
  to skip it. "You decide" is valid — pick the safe default, build, name it.
- Recipes route a request by weighted term overlap over `keywords:`
  (`lib/actions/shared/match.ts`) — pure, deterministic, free, and keyword-based
  so nothing ever compiles a pattern supplied by content. A recipe is advice,
  never authorization: a wrong one costs a refusal, never an escape.

### Adding an action

1. Wrap a `contextService.*` (or other domain) function that already takes a
   `ContextPrincipal`, as `defineAction({ … })` in `lib/actions/defs/*`.
2. Declare its `scope` there — the only place it is written; both the
   `insufficient_scope` challenge and `runAction` read `scopeForAction`.
3. Give it a `summary` (catalogue line), a `description`, and describe every
   argument.
4. Run `db:actions:sync`.

### One server

**One endpoint, `/api/mcp`**, on `mcp-handler` 2 + the official TS SDK v2
(FastMCP was evaluated and rejected), one OAuth protected resource. Every action
is behind the router AND is its own named tool.

**Scopes carry the boundary, and nothing else does.** Authoring rides
`tools:author`, never `context:write`; a client must ASK for a scope; the person
approving sees each spelled out (`SCOPE_DESCRIPTIONS`). `DEFAULT_SCOPES` is
read-only. There is no per-server ceiling above `negotiateScopes`.

- `/api/mcp/creator` 308s to `/api/mcp`; `legacyResourceUrl()` keeps pre-merge
  tokens verifying. Both are deletable once nothing is configured that way.
- Client-facing identity is `lib/mcp/config.ts#mcpServerInfo`. The logo is
  served from `public/images/brand-icon.png`, not Next's hashed `app/icon.png`
  route, because clients fetch it cross-origin long after that build. Keep the
  two files identical.
- Locally there is no auth: `pnpm mcp:dev`, the committed `.mcp.json` with no
  token, and `mcpBearerVerifier` turning a token-less request into the seeded
  dev user with every scope (`lib/mcp/devIdentity.ts`; `--user`/`DEV_MCP_USER`
  picks which). Guarded by `isDevAuthEnabled()`, which `next build` cannot
  satisfy. A token that IS presented is verified normally.
- Production is OAuth 2.1 and nothing else. **No refresh grant**: an access
  token is a stateless 30-day JWT, so `grant_types_supported` is
  `['authorization_code']`, there is no revocation endpoint and
  `oauth_refresh_tokens` is dropped. Tolerable because the token carries
  identity, never authorization — `lib/actions/resolve.ts` re-resolves the
  principal and per-space access on every call. `ACCESS_TTL_SECONDS` is the only
  lever.
- Scope challenges are per ACTION (`lib/mcp/challenge.ts`). Discovery is never
  challenged, so a token that cannot do the work can still learn what to ask for.

### The Drive feeds the record

`list_resources` returns things to USE: a `resource_id` per file or link the
caller can see, and unlike `list_files`/`search_context` it shows IMAGES
(`list_drive` is its old name, kept as a registry alias).
`read_resource` reads one; `share_resource` posts one into a channel under
`messages:write`. That id is the currency —
`create_event`/`update_event` take `cover_resource_id` and `lib/events/cover.ts`
copies the bytes into the event's own variants (`mediaPrefixBare('event', …)`,
the prefix `/api/upload` writes and `purgeNodeObjects` collects). A file is used
by id **inside** the tenant: a signed download URL is a bearer capability and is
never handed to a caller. Using one asks `requireVisibleResource` — a private
channel's image is its members' to use — and writes a `use` row to
`resource_access` with the door (`ActionCaller.via`: mcp, agent, api) and the
agent's name and run, as every action read, share and upload does.

**Files come in through the actions too.** `upload_file` takes one of a
public `url`, a chat client's attached `file` (ChatGPT's `openai/fileParams`,
declared through `ActionDef.mcpMeta`), or small `content_base64`; the server
fetches links through `publicFetch.ts#fetchPublicBytes`, every hop SSRF-gated.
A file the model can only SEE (an image in a Claude chat) goes through
`request_upload`: a 15-minute token (`lib/resources/uploadToken.ts`, its own
audience) behind two doors, `PUT /api/uploads/<token>` for a sandbox's curl and
the `/drop/<token>` page for the person. Every door lands in
`lib/resources/receive.ts#receiveFile` — membership and Drive gates re-asked at
upload time, the name settled from type or bytes (`shared/incomingName.ts`).
`set_image` / `add_context`'s `image_resource_id` make a Drive image a person's
photo or an organisation's logo (`lib/directory/nodeImage.ts`, the same gates
as `PATCH /api/nodes/<id>`).

An event created this way is a **draft** unless `status: 'published'`; at
`visibility: 'public'` it is on the open web at `/e/<slug>`. Marketing copy
belongs in `events/<slug>/marketing.md` (the `run_event` recipe is that loop).
Both doors build the record through `lib/events/build.ts`; nothing else may
derive an event id or its defaults.

Every call reads and writes the named space's **shared** context. Notes
created in a real space's shared context are private by default (author gets
FULL, then the path is restricted); pass `visibility: 'inherit'` to follow the
folder. Actions call the domain layer directly and **never re-implement
authorization** — `lib/actions/resolve.ts` uses the same `resolveContext` /
`principalOf` the web routes use. A scope is necessary, never sufficient.

## Connectors

A connector is a note — `connectors/<name>.md` by default, or wherever an
admin filed it (see *A connector is what a note declares* above) — and the two
halves are the security model (`docs/connectors.md`):

- **Frontmatter = perimeter.** Machine-enforced: `hosts:` (literal,
  SSRF-checked, never from a secret), `env:` (`{{secret:NAME}}` refs only),
  optional method+path `allow:` rules, `timeout_ms`. Stays YAML so prose — a
  prompt-injected note, say — can never widen reach.
- **Body = behavior.** Free prose teaching an agent how to call the service. No
  platform code per vendor.

`alias` is display-only. Secrets live encrypted in `ConnectorSecret`, never in
notes. `connectors/` is admin-only for writes regardless of grants
(`contextService.writeDenial`).

**Connectors is a section of the Space Console** (`/admin?section=connectors`),
not a rail row — the key is core and nav-hidden (`lib/featureAccess.ts`). It
lists one row per CONNECTOR, plus the strip of services members asked for.
Connectors are written by an AI (the `create_connector` recipe, from
`lib/connectors/catalog.ts`); the connector's page is where its secrets are
set and its OAuth sign-in pressed. Manage offers Disable, Edit, Delete; the
row itself goes to the connector's page, because the note IS the connector.

- **A connector is a space's or a person's, and what decides is whether
  connecting it asks the space for anything**
  (`lib/connectors/accountRecipes.ts#isAccountRecipe`, pure): a service signed
  into with one press — a platform OAuth client, or an MCP server that registers
  Visvine itself — is each person's own **account**; everything else (a key, a
  login, an OAuth app the space registered) is the space's connector.
- **An account is connected once, in Settings → Accounts, and spent in every
  space the person acts in** (`AccountsPanel`, `GET /api/account/connectors`,
  `connector_accounts`). It has NO note: the perimeter is the catalogue
  recipe's, rendered at load (`accountNoteContent`), so nothing anyone writes
  can widen it, and it binds no secret. It is the third look of
  `readConnectorNote` — the space's own note, then the parent's shared one,
  then the caller's account — so a space's `gmail` still wins its name. It runs
  in the space the caller is in (that space's quota and audit line), only ever
  for the principal it belongs to (`service.ts#connectionFor`), with
  `visvine.state` keyed per person (`accountStatePath`). Never for a Tool or a
  system pass (`personal: false`). The person keeps it out of a space with
  `off_spaces`; `<recipe>-2` is a second account. The sign-in is
  `/api/connectors/oauth/start?account=<recipe>` — same cookie, same callback,
  landing in `saveAccount`. The token lifecycle is written once
  (`connections.ts#resolveStored`) over a `TokenStore`, which both tables
  implement. A brief declaring an account service nobody here has added is not
  a hard need: `needs` words it as the runner's sign-in.
- **A member meets the space's connectors in the Directory**
  (`/directory?view=table&type=connector` — `ConnectorsPanel` pinned to a
  view): Sign in where a connector holds an account per member, **Request
  access** on rows no grant reaches (`service.ts#listHiddenConnectors` exposes
  name, title and recipe — never hosts, secrets or body), a
  `ContextAccessRequest` answered on Members → Waiting, and the catalogue's
  **Request** for a service the space lacks (`connector_requests`,
  `lib/connectors/requests.ts`), shown in the console as a **Requested** strip.
  A request names a catalogue id, never free text. An account service's
  catalogue row signs the PERSON in, admin or member alike.
- **Connecting an OAuth service is one press.** A catalog row whose fields are
  all optional and `advanced:`, riding a platform client
  (`clientId: platform:google`, `lib/connectors/platformClients.ts`), skips the
  form: Connect writes the note and sends the browser to the provider
  (`connectsInOneClick`, pure — the list route reports which platform clients
  exist, so a deployment without one shows the form instead of a dead end). The
  round trip returns where it started via `connectorConnectUrl(space, name,
  returnTo)`, validated by `safeReturnTo` at both ends and held in a signed
  cookie, never echoed through the provider.
- **The link a browser is sent to is relative** (`connectorConnectPath`).
  `appOrigin()` reads `NEXT_PUBLIC_APP_URL`, which Next inlines at BUILD time
  while the deployment sets it at RUN time — so a client component building an
  absolute connect URL ships the `localhost:3000` fallback to production.
  `connectorConnectUrl` stays for contexts with no page (an agent's step-up
  message, a scheduled run's error).
- **A service is not a slot.** A space may connect one service many times, so a
  catalog row never becomes "connected": it offers Connect, then **Add another**.
  Three consequences, all in `connectorFromCatalog`: the note is named
  `<recipe>`, then `<recipe>-2` (`suggestConnector`), so **`recipe:`** is what
  says which service it is (`catalogEntryFor` reads it first; display only, no
  perimeter or permission is read from it); **secret names carry the connector**
  (`SLACK_BOT_TOKEN__SLACK_2`), since sharing one would silently leave the first
  workspace on the second's token; **`auth.provider` is the connector's name**,
  because `ConnectorConnection` keys on `(space, provider, member)`. Model
  providers are not in this catalogue at all — see Models below.
- **Off is `enabled: false` in the frontmatter** (`isConnectorEnabled`), written
  by `PATCH …/connectors/<name>`; turning one back on deletes the key. The note,
  its secrets and its perimeter are untouched — `loadConnector` refuses every
  run, and a disabled `provider: custom` model connector stops being the space's
  endpoint. Configuration in reserve, not a thing to delete and rebuild.
- **A website login is a connector, and that is the vault.** The `website-login`
  recipe writes a `login:` block (the sign-in page, whose host must be one of its
  `hosts:` — `config.ts#parseConnectorLogin`) with the account in its env
  (`LOGIN_USER`, `LOGIN_PASSWORD` as `{{secret:…}}`), so the same store,
  redaction, audit and machine policy cover it. Nothing runs it in the isolate.
  An agent declaring it, on a space with a machine, gets `sign_in`:
  `lib/vm/signin.ts` decrypts on the control plane and hands the password to one
  command as that command's environment — never the command line, disk, trace or
  model context (`docs/machines.md` § Secrets). The session then lives in the
  machine's browser profile.
- **An MCP server's reach is a list of NAMES, so it has a tool gate.** A
  `shape: mcp` note carries `mcp.url` and a `tools:` block, gated by the pure
  `lib/connectors/toolPolicy.ts`. Three verdicts: `allow`, `ask` (**only a run a
  person started** — Visvine cannot interrupt an unattended run, so the setting
  promises presence the runtime can keep), `deny`. Absent means everything
  allowed, so older connections keep working; `recipe:` resolves the URL for a
  note written before `mcp:` (`service.ts#mcpEndpoint`). Enforced in `hostMcp.ts`
  before the session opens, and `mcpListTools` drops what the gate would refuse
  so a model is never taught to ask for a tool it cannot have (`mcpAllTools` is
  the unfiltered read the permissions screen uses). `attended` rides
  `executeConnectorScript(loaded, run, { attended })`, false unless a caller says
  otherwise: true for the console's Test, a direct `run_connector` call, and a
  `manual`-trigger agent run. The screen is a VIEW inside the connectors panel
  (`ConnectorToolPermissions.tsx`), written back into the note's frontmatter.
- A connector's mark is `ConnectorLogo` on both surfaces: the recipe's logo via
  `catalogEntryFor`, the plug for a connector the space wrote itself. Nothing is
  stamped into the note — a miss is a plug, and no behaviour hangs off it. Logos
  in `public/images/connectors/`. `tests/connector-catalog.test.ts` runs every
  recipe through the real parsers.
- After the caller's accounts, the runtime still reads a note in the caller's
  own space (`me:<userId>`) when the current space has none of that name
  (`readConnectorNote`, off with
  `{ personal: false }` for the Tools bridge and the console's test run) — a
  space's own note always wins its name, and `LoadedConnector` carries the space
  it came from so secrets, account and budget are the owner's. Nothing writes
  such a note any more; the lookup keeps notes written there earlier working.
- The admin gate on a `me:<userId>` space is `resolveContext(...).isAdmin`,
  never `isAdmin()`: it holds no aliases and its owner administers it by
  definition.

### Models

**A model is its own kind, and the space's models are the only models there
are.** `models/<name>.md`, `type: model` + `provider:` +
**`model:`, the id it runs** (`lib/models/config.ts`), keyed by the reserved
`MODEL_KEY_<PROVIDER>` secret (one per provider per space), with the base URL
from `lib/agents/registry.ts` (never the note). It is NOT a connector: no
perimeter, outside `connectors/`, and nothing runs it directly — `run_connector`
hands caller-authored JS the plaintext of every secret its env binds, so a
runnable model would let any `connectors:use` member spend or exfiltrate the key.
`models/` is admin-only for writes, sealed to Tools, and skipped by the memory
sweep.

- **A brief's `model:` is OPTIONAL and usually absent.** An agent runs on the
  SPACE's model — the first runnable model in note order. A brief pins one only
  when it needs a different one the space also has; `parseAgentBrief` gives
  `modelRef: null` otherwise, and a malformed pin is refused at parse.
- **There is no platform default.** `create_agent` writes no `model:` and
  reports `model_problem` when the space has none; the picker offers the space's
  models, not the registry's providers; `noModelReason` is the one sentence
  every surface says.
- **`lib/agents/spaceModels.ts` is the one read of those notes** →
  `defaultModelOf` / `noModelReason` / `customEndpointOf` / `declaredPricingFor`,
  all pure over the parsed rows. It still reads the pre-`models/` shape
  (`connectors/<name>.md` with `kind: model`) until `db:models:migrate` has run,
  so deploy order never decides whether agents run; a `models/` note wins its
  name. That legacy shape is not a connector anywhere else
  (`isLegacyModelConnector`).
- A run records the model it ACTUALLY used, not the brief's absent pin.
- **A model has a node and a page**: `model:<name>` synced like a connector's
  node, `/directory/model:<name>` the Model tab (`ModelPageContent.tsx`), admins
  only — provider and id (editable), the key (write-only), and **who ran on
  it** (the recent runs and their tokens, folded per person). A note stands for
  its PROVIDER, so a sibling model on the same key appears here too.
  `GET/PATCH /api/spaces/<id>/models/<name>` + `lib/models/service.ts`;
  `list_models` is the action.
- **Nothing reports what was spent.** There is no bill on a model's page, no
  cost on a run, no Usage section: what a provider key was billed is that
  provider's account to show, and a second copy inside Visvine is a number to
  reconcile rather than one to trust. `agent_model_usage` is still written and
  `registry.ts` still carries `pricing` — the BUDGET CAP is computed from them
  (`lib/agents/budget.ts`), and removing either would silently uncap every
  space. The cap is declared on the model note itself (`budget_monthly:`, US
  dollars a month for that provider's key) — there is no console Budget section.
- **A member's own plan is a model only the desktop app can run.** A brief may
  pin `model: local/claude` or `local/codex` (`lib/agents/local.ts`). The server
  can name it and never call it: `resolveAgentChatConfig` answers
  `local_runtime`, activation refuses it, the tick never tries it. It runs when a
  person presses Run in the desktop app: the page fetches the prompt from
  `GET …/agents/<name>/local-runs`, the shell spawns the vendor's binary
  (`apps/desktop/src/runtimes`, signed in by the member), events stream over the
  preload bridge into `LocalRunPane`, and `POST …/local-runs` records the run
  with `model: local/<runtime>`, tokens metered, `costMicros` null — the plan
  paid, not the space. `LOCAL_RUNTIMES_OFF=claude,codex` is the kill switch,
  surfaced by `GET …/models`; the vendors changed position on this four times in
  2026, so it stays env rather than a release.
- **Models is its own section of the Space Console**
  (`/admin?section=models`), beside Connectors — `ModelsPanel`, a list; the
  note is written by an AI and the key pasted on the model's page. Not a section of the
  connectors list, and not in Settings: Settings holds only what follows the
  person, and a model is the space's.

### The isolate

One QuickJS-WASM isolate (`lib/connectors/isolate.ts`) — no filesystem, no
process, no require/import, no timers, no real fetch. Agents run
`run_connector(name, code)`; globals are `fetch`, `sql`, `mcp`, `sleep`, `env`,
`console`. Host capabilities: `hostFetch.ts` (order is load-bearing: scheme →
method → path → host → allow rules → SSRF → socket; `redirect: 'manual'`),
`hostSql.ts` (read-only single SELECT in a `READ ONLY` transaction),
`hostMcp.ts` (JSON-RPC over `hostFetch`, inheriting the gate), `marshal.ts`
(`redactDeep` walks structures; string-based redaction breaks on secrets ending
in a backslash).

Three traps, all learned the hard way:

1. **Never asyncify.** Host capabilities must be sync functions returning a
   QuickJS promise (`ctx.newPromise()`) the host settles. The asyncify transform
   corrupts after one or two calls — and an OAuth dance is two before it does
   anything useful.
2. **Ownership.** Create the context with `module.newContext()` so it owns its
   runtime, and keep capability/console handles alive for the context's
   lifetime. Breaking either aborts the WASM module, not throws.
3. **Pin the singlefile variant.** `@jitl/quickjs-singlefile-cjs-release-sync` —
   the meta-package resolves a `wasmfile` variant that loads `.wasm` by runtime
   path, untraced by `output: "standalone"`: works in dev, `ENOENT`s on Cloud
   Run. Listed in `next.config.ts#serverExternalPackages` with `pg`/`mysql2`.

Accepted trade-offs: non-HTTP protocols need a new host function; a timed-out
run leaks one context deliberately rather than taking the process down; DNS
rebinding remains possible between `assertPubliclyRoutable` and the socket.

Verification: `tests/connector-isolate.test.ts` (escape battery, perimeter,
timeout/memory/leak, 25-sequential-calls regression). Live against `pnpm dev`:
`pnpm db:connectors:demo` / `:funds` / `:oauth` to seed, then
`connectors:verify:funds` / `:oauth` through the real MCP server. The OAuth
suite is the one that matters — token expiry + refresh, 429 backoff, cursor
pagination.

## Tools

A Tool is three notes (`tools/<name>/{index.md,ui.tsx,data.js}`) compiled on
write, run in a sandboxed iframe on a cookie-less origin. `docs/tools.md` is the
guide. The invariants:

- **A Tool belongs to the space that wrote it.** Publishing ships it there and
  NOWHERE else. `AppToolVersion` carries two independent verdicts, both asked in
  order (`registry.ts#installability`, pure): `status` is the source space's
  admin (`approved` = installable there; its rooms get it only through `share:`),
  and `marketplaceStatus` is Visvine's — **null until an admin explicitly
  submits it**, and only `approved` lists it or lets an unrelated space install
  it. Never widen a query over versions without deciding which verdict it asks
  about. **Approval is not forever**: a version withdrawn by its space
  (`revokedAt`) or a listing Visvine suspends (`app_tool_listings.state`) stops
  at its next bridge call, and the host removes the frame
  (`lib/tools/verdicts.ts`) — read wherever a version is chosen or run.
- **Publishing is a member act; approving is the admin's.** An admin's publish
  lands approved; a member's lands pending and notifies the space's admins —
  that queue is `/admin?section=approvals`. There is no `/tools` destination:
  the console owns tools (Tools = rail placement + installed versions,
  Approvals = the queue; a working copy is published from its own Tool tab),
  and cross-space install is the `install_tool` action; `update_install` is
  the admin's other four decisions (on/off, type claims, upgrade, uninstall).
  An admin installs without MCP through the install sheet (`InstallSheet`:
  Rail or More, Page · Tab · None per declared type), opened from Approvals and
  from the Tool tab. A re-publish supersedes the author's earlier pending
  submission rather than being refused. **A draft runs with its authors' reach**: a preview's principal is
  the viewer intersected with everyone who wrote it since its last approval
  (`lib/tools/draftAuthors.ts`), and it starts by itself only for them.
- **Checks run before powers.** Every publish runs the compatibility and
  static security stages inline (`lib/tools/checks/`) — for an admin exactly
  as for a member — and a blocking finding writes no version. Each run is an
  `app_tool_check_runs` row the author, the admins and Visvine's reviewers
  read as written. The trusted-publisher fast path needs an empty
  `manifestDiff.ts#diffManifest` and a clean scan; a new manifest field must
  be classified there before it lands (`tests/tools-diff-coverage.test.ts`).
- **A Tool is its folder, filed anywhere.** `tools/<name>/` is where one
  lands; a folder of the space's own whose index declares `type: tool` is the
  same Tool. The folder name is its name (build, installs, versions and node
  key on it), so it moves and is never renamed. `lib/tools/location.ts` finds
  it; `toolIndexPath(name, folder)` and its siblings take the found folder.
- **The app draws a Tool's chrome; the Tool draws its content.** On
  `/t/<slug>` its own sections (`surfaces.nav`) are tabs on the shell's band or
  a side list, its ≤2 `surfaces.actions` are band buttons, and ⋯ holds About,
  Edit, Manage and Report. The section is `?section=`, pushed into the frame as
  `visvine:route` — a tab press never reloads the frame. Nav and actions are
  surfaces, so changing them is reviewed like a new rail row.
- **`/tools/preview/<name>` is the Workbench** for anyone who can edit the
  Tool — files, the builder, checks and the kit's Components on the left, the
  working copy running on the right, Publish on the band — and the preview
  alone for anyone who can only read it. That path is load-bearing:
  `create_tool`, `write_tool` and `preview_tool` all hand it back, and the
  desktop deep link resolves to it. A Workbench save is `writeToolFile`, the
  write `write_tool` makes. `/tools/build` is the same page before the Tool
  has a name.
- **The builder is agent chat with authoring tools** (`lib/agents/chat.ts#runThreadTurn`,
  thread `:tool-builder` per person per space): `context:read` +
  `tools:author` only, the space id filled in by the server, no publish or
  install. With no model in the space it shows the MCP address instead.
- **The kit's catalog is one list** (`lib/tools/catalog.ts`): `get_tool_sdk`,
  the `tool_design` guide on `create_tool`/`write_tool`, the builder's prompt
  and the Workbench's Components panel all read it, and
  `tests/tools-catalog.test.ts` holds it to the kit's exports.

## Production

`docs/runbook.md` is the operational reference. The parts that constrain code:

- **The runtime scales to zero**, so nothing may rely on a long-lived process.
  An in-process `setInterval`/`setTimeout` on Cloud Run silently never happens.
  Background work belongs on a Cloud Scheduler job hitting `/api/internal/*`,
  authenticated with Google OIDC pinned to its own path
  (`lib/agents/internalAuth.ts`). `nightly.ts#nightlyDriver` is the pattern for
  detecting which world you are in.
- **The runtime is N processes**, so no cross-request state may live in a Map.
  Rate limits are rows (`lib/rateLimit/`); a per-process limiter on
  `--max-instances=10` is ten limits, reset on every cold start.
- **No request may run to the runtime's ceiling.** Cloud Run's `--timeout` is
  1800s because the agent tick awaits its dispatches, and it bills instance time
  for every second a connection is held — an SSE or chunked response lasts until
  the CLIENT hangs up, which is how `/api/mcp` came to hold half-hour requests
  for answers already delivered. Every long-lived path carries its own shorter
  bound: `lib/mcp/deadline.ts`, `RUN_AWAIT_MS`, `/api/messages/stream`'s own
  clock. Anything new that streams, polls or awaits needs the same.
- **`logger.error()` is the alerting surface** — in production every call is a
  Cloud Error Reporting event grouped by stack signature. Use `error` for a
  genuine fault and `warn` for the app working as designed. Always pass the
  caught value (`{ err }`) so the record carries a real stack.
- **The CSP is per request, in `proxy.ts`.** It carries a nonce, so it cannot
  live in `next.config.ts#headers()` — both places emits two CSP headers, which
  browsers enforce as the intersection, and the app loses every script.
  `script-src` has no `'unsafe-inline'`; an inline script needs the nonce, not a
  policy change (`lib/security/csp.ts`).
- **`/api/health` must never grow a dependency.** It is Cloud Run's liveness
  probe, so requiring the database means an outage kills and restarts every
  instance into that same outage. Deep checks go behind `?deep=1`.
- **Ciphertext is under a key ring**, not a key (`lib/crypto/secrets.ts`). Any
  new column holding an encrypted value must be added to
  `apps/web/scripts/rotate-secrets-key.ts` or the next rotation strands it.
- **Object storage has two drivers** behind `lib/gcs.ts`: `gcs` (production
  default) and `local` (a folder under `apps/web/.storage`, the dev default,
  refused when `NODE_ENV=production`). `STORAGE_DRIVER` picks. Bucket env names
  are the logical names under both. Every path is minted in
  `lib/storage/objectPaths.ts`, which is why a prefix delete can never cross a
  tenant boundary.

## Gotchas

- A stale space id in `localStorage` gives "Unknown space" 404s after a reseed.
  Reload the tab before debugging anything else.
- `pnpm db:seed` **wipes the local DB**. `db:fresh` drops and rebuilds tables;
  `db:reset` destroys the docker volume (both guarded by
  `scripts/guard-local-db.mjs`).
- Never commit `.env` — `pnpm env:check` / `env:check:staged` guard this.
- CI runs against a real pgvector Postgres, so a test may talk to a database.
  Guard it the way `tests/agents-tick.test.ts` does — localhost-only, and skip
  loudly rather than pass silently when there is none.
