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
apps/web/components/ui/                             the ONLY shared UI
apps/web/lib/          domain + server logic (the real code lives here)
apps/web/lib/actions/  every action the platform offers — the MCP registry
                       and POST /api/actions/<name>
apps/web/tests/        node:test + tsx, one file per concern
apps/web/prisma/       schema.prisma (52 models), seed, migrations
scripts/               repo-level db/env tooling
```

`@/*` → `apps/web/*`. An eslint boundary rule enforces that only
`@/components/ui` is shared; domain UI lives in `@/features/<domain>/components`.

## Conventions

- **Route handlers are thin.** Use `lib/api/route.ts`: `requireApiSession`,
  `requireSpaceAdmin`, `parseBody(request, zodSchema)`, `ApiError(status, msg)`.
  Each returns a value or a `NextResponse` — check `instanceof NextResponse`.
- Reuse `lib/fetchJson.ts`, `lib/date.ts`, `components/ui/Modal.tsx`,
  `lib/logger.ts` rather than re-rolling them.
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
- Surfaces are flat: hairline sections, no cards, tokens not `gray-*`, shadows
  only on things that float.

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
  the gate column, derived world ⇔ public — `listingOf`), two doors, three
  upward flows (`flowContext` / `flowEvents` / `flowPeople`; none from a
  secret room), and `parentAdmins`. Up: context as the `subspaces/<id>/`
  folder (editable by the room's members, read-only for the rest), **public events** (`viaSpace`; hub card and
  `GET /api/events?includeSubspaces=1`; detail through
  `requireSpaceMemberOrParent`), and **people** (`via_space` nodes in the
  house's directory, read-only — one row per `identity_id`, the house's own
  record winning, with the other rooms as `also_in`: `peopleFlow.ts#mergePeopleFlow`;
  a person added anywhere in the family with no email/LinkedIn takes the
  identity the family already uses for that name, when exactly one does —
  `lib/identity/family.ts`, applied by `attachIdentity` and note adoption). Down, per note and per room: a house's
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

## Creating things

**Create new is a panel of the rail, and `lib/create/rows.ts#createRows` is the
one table saying where every kind is made** (pure, tested). The current page's
kinds sort first (`suggestedType.ts`). `rows.ts#flowFor` is the only place that
decides what a row does:

- `inline` — a form in the panel (`features/create/components/forms/`): Person,
  Space, Resource, Folder, File, Channel, Section, Tool, New type, Agent
  starters. Person/Space/Resource render from `lib/create/typeFields.ts`, so the
  form, the note's property rows and the Directory table share one schema.
- `route` — the kind's own surface: Event → `/events/new`, Connector → the
  console catalogue, Model → the Models panel.
- `draft` — `/directory/new`, for things that ARE prose: a Note, an Agent brief
  (`?template=`), or a note wearing a custom type (`?type=<Name>`). The draft's
  Type menu offers only Note, Folder, Agent and custom types.

`useCreateSurface(kind, { folder })` is the one entry point for code. Starting a
space stays on the switcher (`NewSpaceDialog`) and is not a create kind.

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
  — there is no `scope` argument. **`search_context` alone may omit it**: it
  then runs the same federated search in every space the caller can act in
  (`lib/actions/searchEverywhere.ts`, each under `resolveTarget`, one plan
  shared, capped at `MAX_SEARCH_SPACES`) and folds the rankings
  (`shared/everywhere.ts`, pure: a room the caller is in is searched directly,
  so the house's `subspaces/<id>/` hop into it is dropped). Every hit and
  entity carries `space`, `read_with` carries `space_id`, and `spaces` says
  what was searched. A write with no `space_id` is refused by `runAction` with
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
  `tools/`, `models/`, plus `settings/` and `subspaces/`, which belong to no
  kind and which NOTHING may write — a space's configuration is the `spaces`
  row alone (`db:settings:drop` removed the notes an earlier mirror left). Each row carries the folder, its kind, the feature that owns it, how it
  appears, who writes it and the line its index says it holds — so `ENTITY_DIRS`,
  the tree's graft, the reserved descriptions and the tool gate are four reads
  of one row. A space RECORD lives in `spaces/`; the sub-space graft is
  `subspaces/`. A note path is link identity, so a namespace is renamed only by
  moving every note and rewriting every link — `db:rename:spaces` is the one
  that did it. A namespace folder is **placed, never moved**
  (`lib/notes/shared/placedFolders.ts`): the tree draws it under a folder of
  the space's own when that folder's index note says `holds: [agents]`, the
  path stays, and the row's `icon` marks it as a tool's shape. Sub-spaces sit
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
  allow. Models keep their home for now: the gate follows their declaration,
  the readers do not yet.
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

- **An agent is ONE note in a folder that is its home.** `agents/<name>/index.md`
  holds what it is (model, connectors, tools, the brief) AND whether/when it runs
  (`active`, `schedule`/`every`/`on`, `debounce`, `timezone`) in one frontmatter,
  editable by anyone who can edit the folder (`agentManageDenial`). Only
  `runs_as` is admin-held (`writeGated#activationRunsAsDenial`); budget is
  admin-only, on the row. Editing a brief does NOT switch the agent off.
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
  Directory's tag filter reaches agents. The settings dialog's Group field writes
  the same key (`briefEdit.ts`).
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
  `run_command`, then `open_page` — cheapest door that does the job.
- **One agent can run FOR many people.** Identity is per RUN
  (`agent_runs.run_as_user_id`). A scheduled fire runs as the brief's author (or
  `runs_as`), then once per **subscriber** (`agent_subscriptions`, self-service
  for anyone who can read the brief, capped by `MAX_FANOUT_SUBSCRIBERS`), each
  under that person's principal — so a `mode: user` connector spends THEIR
  account. A manual run acts as whoever pressed Run. Event payloads ride only
  the author's run. `connectorReadiness` (`lib/connectors/service.ts`) surfaces
  per-person readiness before a 3am run discovers it. Bare `user_id`, so
  `deleteAccount` clears it.
- **A brief says what it still needs.** `create_agent` and `rehearse_agent`
  answer with `needs` and `plan` (`lib/agents/shared/needs.ts`, pure;
  `lib/agents/needs.ts` gathers inputs): no model in the space, a declared
  connector missing/off/invalid/not signed in, or a catalogue service the
  instructions NAME but the brief never declared. `create_agent` still writes a
  brief declaring a connector the space lacks; `activate_agent` refuses on a
  **hard** need (`hardNeeds`) and warns on a sign-in the runner owes.
  `AgentNeeds.tsx` shows the same list to a viewer.
- **A brief is rehearsed before it is switched on.** `rehearse_agent` runs
  NOTHING: it returns the preamble, brief, model and `connectorReadiness` for
  the CALLER, and the asking model carries that one round itself, on its own
  subscription (`lib/agents/shared/rehearsal.ts`, pure). Nothing billed, no run
  recorded. Rules: one round, write nothing, use only what the brief declares,
  report what is out of reach.
- **An agent is watched on its own node page** — `/directory/agent:<name>`, the
  Agent tab beside Context and Raw (`AgentPageContent.tsx`). There is no agents
  tool: no rail row, no feature key, no console section. **The roster is the
  Directory's Agents table** (`/directory?view=table&type=agent` →
  `AgentsRoster.tsx`) with **the clock** over it: the next 24 hours, the nightly
  clean, and what is running with its current step
  (`lib/agents/shared/roster.ts` pure, `runs.ts#currentStepOf`). The tab shows
  the status line and switch, when it runs, then THE RUN as ONE LINE of steps
  (`RunSteps`) with the machine's record nested under each `run_command` /
  `open_page` (`trace.ts#attachMachine` joins `agent_vm_events` by run id), plus
  the live screen and terminal for admins. **Under the line, the box** — say
  something and a run starts now, as you (`lib/agents/summon.ts`; when already
  running the words wait in the mailbox). `run_agent` takes the same `message`.
  A gear opens one dialog: Settings · Memory · Skills · Machine. Actions return
  `watch` hrefs (`config.ts#agentPageHref`). Polling, never a stream.

## The Directory

`/directory` is one page, four tabs — Grid · Table · Context · Resources — with
the view on the URL (`?view=table&type=person`). Grid and Table share
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
- **A viewer's arrangement is theirs**: column order, hidden columns, widths and
  sort live in `localStorage` per space and type (`useTableView`), never on the
  space record. An unknown column appears at its canonical place.
- Cells edit in place; a refused value is never stored as text. Edits are held
  optimistically because the directory response is cached 30s.

## The nightly clean

**A space cleans itself on a clock, as a person.** `/admin?section=clean` turns
it on and shows every pass. It is the role-aware clean (`lib/notes/clean.ts`,
the same code `clean_context` runs) behind a schedule row, holding no authority
of its own.

- **It runs as the admin who turned it on** (`run_as_user_id`), under their
  principal: their lens decides what is analysed, their gate what is written,
  origin `maintenance`. **Run now** acts as whoever pressed it. If that person
  stops being an admin the run is recorded `skipped`.
- **Only the mechanical allow-list is applied**, narrowed by what the schedule
  opted into (`shared/cleanSchedule.ts#CLEAN_FIX_KINDS` is the ceiling; a
  hand-edited row cannot widen it): frontmatter fill, one-match link repair,
  unambiguous mention linking, stale, expiry, supersession. Duplicates,
  contradictions and orphans come back as the worklist. Frozen folders are
  reported, never written. It never changes a type, an alias or a folder —
  restructuring is judgment, and judgment goes to the worklist.
- **Cleaning happens in the space that OWNS the notes, at the top level.** A
  sub-space holds no schedule and a parent never cleans one: `buildCleanScope`
  puts `spaces/` out of scope, `normalizeCleanTarget` refuses one as a target.
- **The minute tick fires it**, claiming due rows with a conditional UPDATE that
  advances `next_run_at` itself — N instances racing produce one run, and a
  night the deployment was down is skipped, never replayed. One tick runs at
  most `MAX_CLEANS_PER_TICK`, oldest first.
- **The same row owns embedding.** `embed_enabled` is the space's switch for the
  semantic half — off stops the nightly sweep, the query-time catch-up and the
  vector stages alike (`searchContext` reports `semantic: 'off'`, distinct from
  `no-key`); no row means on. `embed_after_clean` re-embeds what a pass changed,
  capped at `POST_CLEAN_EMBED_NOTES`, with its own column (`embed_status`) so an
  embedding failure never fails a clean that wrote. `embedSweep(spaceId)` is the
  one implementation behind all three callers.

Every pass writes a `context_clean_runs` row: what it could see, what was in
scope, what it wrote by kind, what a gate refused, what it left, whether full
mode hit its cap, and what the embed did. `saveCleanSchedule` merges a patch, so
the console can save one field. Deleting the admin it runs as switches it off.

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
  down-ranking off, because the retired note IS the answer. The server widens
  the plan with one structured LLM call (`lib/notes/queryRewrite.ts`, skipped
  for ≤3-word and temporal-only queries): up to three phrasings, each its own
  stage at weight 0.7, plus a date range only if the parser found none. The
  rewrite is untrusted (`coerceQueryRewrite`) and can only add. A caller's
  explicit bound disables inference. Every result reports its `plan`.
- Optional rerank of the over-fetched head (3×k, max 30) sits after fusion
  behind the injected `Reranker`; `lib/notes/rerank.ts` is a listwise LLM judge,
  on only with `CONTEXT_RERANK=llm`.
- **The deployment's own AI is ONE key: `OPENROUTER_API_KEY`.** Chat
  (`lib/notes/ai.ts`, default `deepseek/deepseek-v4-flash-0731`, override
  `OPENROUTER_MODEL`) and embeddings (`lib/notes/embeddings.ts`,
  `openai/text-embedding-3-small` at 768 dims, `EMBED_MODEL`) both go through
  OpenRouter. Without it the response reports `semantic: "no-key"` rather than
  degrading silently; after setting it run `pnpm db:embed` once. A space's
  AGENTS never touch this key — they run on the space's `models/` notes and
  `MODEL_KEY_<PROVIDER>` secrets. Directory search is fuzzy/keyword only.

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

`list_drive` returns things to USE: a `resource_id` per file, and unlike
`list_files`/`search_context` it shows IMAGES. That id is the currency —
`create_event`/`update_event` take `cover_resource_id` and `lib/events/cover.ts`
copies the bytes into the event's own variants (`mediaPrefixBare('event', …)`,
the prefix `/api/upload` writes and `purgeNodeObjects` collects). A file is used
by id **inside** the tenant: a signed download URL is a bearer capability and is
never handed to a caller, which is why that action queries `Resource` rows
directly rather than through `listResources`.

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
not a rail row — the key is core and nav-hidden (`lib/featureAccess.ts`). Two
tabs listing different things: **In this space** is one row per CONNECTOR;
**Add a connector** is the catalog (`lib/connectors/catalog.ts`), one row per
SERVICE, each a recipe. Saving writes `connectors/<name>.md` and PUTs each
secret to `/api/spaces/<space>/secrets`. Manage offers Disable, Edit,
Delete; the row itself goes to the connector's page, because the note IS the
connector.

- **The space's admins decide what is connected; a member connects themselves.**
  Members get **Settings → Connectors** (`/settings?section=connectors`) — the
  console's own panel pinned to a view (`ConnectorsPanel view=`,
  `SettingsConnectors.tsx`). The OAuth round trip returns there with
  `?connectors=<tab>`; a `?connectors=` on any other page is sent on to it by
  the account band (`UserMenu`). **Connected** is what works for you now
  (`worksForCaller`). **Not connected** is the rest, including rows no grant
  reaches (`service.ts#listHiddenConnectors` exposes name, title and recipe —
  never hosts, secrets or body) which offer **Request access**, a
  `ContextAccessRequest` answered on Members → Waiting. **All connectors** is the
  catalogue, where a service the space lacks offers **Request**
  (`connector_requests`, `lib/connectors/requests.ts`), shown in the console as a
  **Requested** strip. A request names a catalogue id, never free text.
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
- The runtime reads a note in the caller's own space (`me:<userId>`) when the
  current space has none of that name (`readConnectorNote`, off with
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
  space. The cap alone is the console's **Budget** section
  (`/admin?section=budget`, `BudgetPanel`).
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
- **Models is its own section of Settings** (`/settings?section=models`),
  beside Connectors — `ModelsPanel` with a `+` offering
  `lib/models/catalog.ts`'s five providers. Not a section of the connectors list
  and not a console section: what agents run on is one decision a space makes
  once.

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
  admin (`approved` = installable there and in its descendants), and
  `marketplaceStatus` is Visvine's — **null until an admin explicitly submits
  it**, and only `approved` lists it or lets an unrelated space install it.
  Never widen a query over versions without deciding which verdict it asks about.
- **Publishing is a member act; approving is the admin's.** An admin's publish
  lands approved; a member's lands pending and notifies the space's admins —
  that queue is `/admin?section=approvals`. There is no `/tools` destination and
  no rail row: the console owns tools (Tools = rail placement + installed
  versions, Build = working copies, Approvals = the queue), and cross-space
  install is the `install_tool` action. A re-publish supersedes the author's
  earlier pending submission rather than being refused.
- The working copy renders live at `/tools/preview/<name>` for anyone who can
  read the note. That path is load-bearing: `create_tool`, `write_tool` and
  `preview_tool` all hand it back, and the desktop deep link resolves to it.

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
