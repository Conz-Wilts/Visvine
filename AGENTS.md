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
  unprefixed (`spaces`, `users`, `identities`, `nodes`, `links`,
  `oauth_*`). `prisma/TABLES.md` is the plain-English map of all of them.
  The notes surface is **Context**, everywhere — in the schema, the code and the
  UI. Don't reintroduce another word for it.
- Tests: `node --import tsx --test tests/*.test.ts`. Prefer testing the pure
  layer (`lib/notes/shared/*`, `lib/connectors/perimeter.ts`) over routes.

## A space is a tenant, and may hold sub-spaces

Every space is a full `Space` row: its own context, members, aliases and tool
rail. `visibility` is `public | private` and nothing else. Creating one always
goes through `lib/spaces/provision.ts`. Spaces nest **one level**
(`docs/sub-spaces.md`): a sub-space is a full row that names its parent in
`parent_id` and is its own tenant in every other table. The parts that
constrain code:

- **A record is not a tenant.** An organisation a space tracks — a portfolio
  company, say — is a directory record whose note lives in `communities/`
  (`Company` in the Blackbird seed; `company` folds onto `space` in
  `TYPE_SYNONYMS`, so the entity machinery is unchanged). Creating one
  provisions nothing.
- **A `space` node MAY name a space that runs here.** The create flow writes
  `metadata.spaceRef` (and `space: <id>` in the note's frontmatter) when the
  picker matched a live space, which is what sends its page to
  `/communities/<id>`; a record of the outside world carries neither.
  `db:notes:verify` only checks that a ref that IS set points at a real row.
- **A new space starts with every toggleable tool off** —
  `defaultFeatureConfig()`. Both create routes, `provisionSpace` and the seed
  write it; the people in the space opt in from the console.
- **A sub-space's visibility is its own.** A public sub-space inside a private
  space is on Discover and joinable without joining the parent; a private one
  inside a public space is invite-only. Membership and admin standing do not
  cross the boundary: the creator holds the sub-space's Admin alias, and the
  parent's admins are not admins of it. Creating one is an act of the
  parent's admins (`POST /api/communities` with `parentId`); a sub-space
  cannot hold sub-spaces (`lib/spaces/subspaces.ts#parentDenial`), and
  sibling names are unique (`spaces_sibling_name_unique`).
- **A public sub-space's context flows up.** It appears in the parent's
  context tree as the read-only folder `spaces/<id>/`, federated at read time
  by `lib/notes/federation.ts` — tree, note index, single-note read and search
  each have a federated form, and the routes, the actions and an agent's
  tools call those. The sub-space is read under its **everyone-principal**:
  no admin standing, only its space-wide grants, capped to view
  (`access.ts#spaceWideAccessFor`), so a restricted folder there is hidden
  here too. A public sub-space is born with a space-wide view grant at its
  root so it flows something. A private sub-space shows nothing at the
  parent. `spaces/` is reserved in every space's own context
  (`subspaceWriteDenial`, first clause of `writeDenial`).
- Deleting a space with sub-spaces is a children-first delete in
  `DELETE /api/data/communities` (the parent relation is Restrict); the
  seed's wipe deletes sub-spaces before parents for the same reason.
- Listings (Discover, `/communities`) are flat lists of the spaces you can
  see, with "in *Parent*" beside a sub-space only when the parent is in your
  own list; the switcher lists top-level spaces and opens a parent's
  sub-spaces under its row on a click of its chevron, hung on the tree spine
  (`subspaces.ts#spaceBranches`, `SpaceListRow#SubspaceRow`, `TreeSpine`).

## Creating things

**Create new is a panel of the rail, and one table says where every kind is
made.** The rail's Create new slides the panel column out beside the rail (the
way the space switcher does): a search, then a row per kind — the built-ins
the space's tools own, a hairline, the space's own note types, and a **New
type** row while the search names something nobody has used. Ordering, search
and the row list are `lib/create/rows.ts#createRows` (pure, tested); the
current page's kinds sort first (`suggestedType.ts`), and that order is the
whole suggestion — nothing renders a reason. Picking a row does one of three
things, and `rows.ts#flowFor` is the only place that decides:

- `inline` — a short form in the panel itself (`features/create/components/forms/`):
  Person, Space (a directory record), Resource, Folder, File, Channel, Section,
  Tool, New type, and the Agent **starter** list. Placeholder text is the
  label; one **Create** button; creating navigates and the panel closes on the
  route change. Person / Space / Resource render their rows from
  `lib/create/typeFields.ts`, so the form, the note's property rows and the
  Directory table are one schema.
- `route` — the kind's own surface: Event → the composer at `/events/new`,
  Connector → the console catalogue, Model → the Models dialog.
- `draft` — `/directory/new`, the context-note surface, for the things that
  ARE prose: a Note, an Agent's brief (`?template=` seeds a starter), and a
  note wearing one of the space's own types (`?type=<Name>`). The draft's own
  Type menu offers only Note, Folder, Agent and the custom types; it never
  commits an entity, a channel, a file or a connector.

`useCreateSurface(kind, { folder })` is the one entry point for code (the
tree's "+", the channel list): it asks `flowFor` and either opens the panel on
that form or routes. Starting a space you run stays on the switcher
(`NewSpaceDialog`) and is not a create kind.

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
  section — are read by name by the runtime and stay one flat note until a
  sub-note converts them. Never add a separate "general info" note beside an
  index: the index is that note.
- **An agent is ONE note in a folder that is its home.** `agents/<name>/index.md`
  is the whole agent: what it is (model, connectors, tools, the brief in the
  body) AND whether and when it runs (`active`, `schedule`/`every`/`on`,
  `debounce`, `timezone`) in the same frontmatter — because both are written by
  the same people, anyone who can edit the folder (`agentManageDenial`). Only
  `runs_as` is held back for admins (`writeGated#activationRunsAsDenial`), and
  budget stays admin-only, on the row. Editing a brief does NOT switch the agent
  off. Everything else in the folder is the agent's own — the ONE place under
  `agents/` a run stamped `agent:<name>` may write
  (`contextService.lockedDenial`), never its brief or another agent's folder.
  The run prompt (`lib/agents/shared/prompt.ts`) names that folder as the
  default output location and teaches the markdown/link contract;
  `create_agent` and its recipe quote the same text so an authoring model
  knows what a brief can ask for.
  Nothing under `agents/` ever fires a trigger. `db:agents:folders` moves the two
  earlier shapes into the folder; `db:agents:activation` folds a pre-merge
  `agents/<name>/activation.md` into the brief (it is still READ until then, so
  an older agent keeps running).
- **Memory is a note with a shape; a run's trace is a row.** What an agent
  CONCLUDED lives in `agents/<name>/memory.md` — four sections, `What I know`,
  `Decisions`, `Open threads`, `Last run` (`lib/agents/shared/memory.ts`, pure)
  — because the next run and the person checking what it believes both read
  it, and a note gets revisions with the agent as author, the clean pass and
  grants for free. What it DID is `agent_runs.events`, never a note: a
  transcript in the context would flood search and accumulate the way every
  naive agent memory does. The runner hands the note to every run as a system
  message, so no turn is spent reading it; the agent adds with `remember`
  (one line under one of the first three sections, deduped, capped per
  section) and never rewrites the file; the runner replaces `Last run` itself
  when a run succeeds. A cursor or high-water mark is a line under
  `What I know`. Structured values an agent tracks are tracked fields on
  nodes, through the ordinary write, like everything else structured.
- **Agents are grouped by the brief's `tags:`.** The first tag is the group
  the roster files it under (Investments, Operations); every tag lands on the
  `agent:<name>` node (`entityLinks.ts#syncAgentNode`), so the Directory's tag
  filter reaches agents like anything else. The settings dialog's Group field
  writes the same key (`briefEdit.ts`). No second vocabulary, no folder move.
- **A name is not an identity.** `agent_state` is keyed by `(space, name)` and
  outlives the note, so the row carries `brief_note_id` — the `context_notes`
  row it was derived from. A DIFFERENT note at the same name is a new agent, and
  `syncAgentState` retires the previous incarnation: its runs, its subscribers
  and the mail still addressed to it, so nothing is inherited by an agent nobody
  wrote it for. A restore keeps the note's id, so it is the same agent and keeps
  everything; what stays either way is the space's own record — the month's
  spend, the egress and machine logs. `db:agents:stamp` binds rows written
  before the column (`--drop-stale` also clears runs that predate their brief).
- **What an agent can do is its `tools:` plus what the space has.** Notes,
  `run_agent` and the people tools are always on; `web` is `fetch_url` and
  nothing else — **searching is fetching a search engine's results URL**, so
  there is no search vendor, no `SEARCH_KEY` and no per-provider code to keep
  current; `actions` is the whole Action registry through `runAction` as the
  author (every scope but `secrets:write`); `sandbox`, `messages` and
  `directory` are as before — and a machine comes with any space that has one,
  no brief key needed, which is what reads a page `fetch_url` cannot
  (`docs/machines.md` holds the boundary that makes that safe).
- **One agent can run FOR many people.** The brief stays one note; identity is
  per RUN (`agent_runs.run_as_user_id`). A scheduled fire runs first as the
  brief's author (or `runs_as`), then once per **subscriber** — a member who put
  their name down on the agent's page (`agent_subscriptions`, self-service for
  anyone who can read the brief; capped by `MAX_FANOUT_SUBSCRIBERS`) — each
  under that person's principal, so a `mode: user` connector spends THEIR
  linked account. A manual run acts as whoever pressed Run. Event payloads ride
  only the author's run; fan-out runs carry the summaries. The page's Runs-for
  section and Turn-on line surface **connector readiness** per person
  (`lib/connectors/service.ts#connectorReadiness`): missing/disabled notes and
  unconnected or broken OAuth accounts, with the connect link — checked before
  a 3am run discovers it. Bare `user_id`, so `deleteAccount` clears it.
- **An agent is watched on its own node page** — `/directory/agent:<name>`, the
  Agent tab beside Context and Raw (`features/profile/components/AgentPageContent.tsx`),
  the way Profile is a tab of a person node. There is no agents tool: no rail
  row, no feature key, and no console section. **The roster is the Directory's
  Agents table** — `/directory?view=table&type=agent` renders
  `features/agents/components/AgentsRoster.tsx` in place of the cell grid,
  because every column of an agent is live state, not a record — with **the
  clock** over it: the next 24 hours across every agent and the nightly clean,
  what is running first with its current step (`lib/agents/shared/roster.ts`,
  pure; `agent_runs`' last tool event via `runs.ts#currentStepOf`), then the
  agents filed under their groups. The `agents/` folder in the tree is the
  same roster as files. The tab is the status line and its switch, when it
  runs, then THE RUN — the one in flight, else the one `?run=<id>` names, else
  the latest — as ONE LINE of steps with the machine's record nested under
  each `run_command` / `open_page` (`tools: [machine]` gives a run its own
  machine; the run id rides every command so `agent_vm_events` joins the trace
  through the pure `lib/agents/shared/trace.ts#attachMachine`), and for admins
  the live screen and terminal beside them; **under the line, the box** — say
  something and a run starts now, as you, and the line follows it
  (`lib/agents/summon.ts`: the same delivery every channel uses, then the
  same manual claim; when it is already running the words wait in the
  mailbox). Its answer is the run's summary, and "Adjust the brief" sits
  under it, because the run is where you learn what the brief should have
  said. `run_agent` takes the same `message`. The sidebar is when it runs,
  who for, memory at a glance, history and setup. Actions return `watch`
  hrefs into it (`lib/agents/config.ts#agentPageHref(name, runId?)`).
  Polling, never a stream.
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

## The Directory

`/directory` is one page with four tabs — Grid · Table · Context · Resources —
and the view rides the URL (`?view=table&type=person`). Grid and Table share
`useDirectoryBrowse` (search, alias and tag filters, the nodes-only
`/api/communities/<id>/directory` feed); Table is per TYPE, because the
columns are.

- **A type's columns come from three places, in order**
  (`lib/directory/table.ts#columnsForType`, pure and tested): the core every
  entity has (name, alias, tags, added), the property rows the type already
  shows on its note (`lib/create/typeFields.ts` — a Person's role, company,
  location…), and the **tracked fields** the space added to the type.
- **A tracked field is space config, its values are node data.**
  `NodeTypeConfig.fields[]` (`{ key, label, kind, options? }`) rides the
  space's type vocabulary — saved by the same whole-record PUT the console
  uses, round-tripped by the `settings/types.md` config note — and the value
  is `node.metadata[key]`, written through the existing
  `PATCH /api/nodes/<id>` merge and **mirrored into the entity note's
  frontmatter** under the same key (`entityNodes.ts#mirroredFields`), so an
  agent reading `people/craig/index.md` sees what the space tracks. Adding a
  field touches no node; removing one leaves the values in place, unlisted.
  Only admins add or remove fields (`useTrackedFields`); the key is minted from
  the label and may never be a column the type has or a key the platform owns.
- **A member-made type can be deleted; a built-in cannot.** The whole-record PUT
  merges the type list additively (`mergeNodeTypeList`), so shortening it needs
  its own deliberate call: `DELETE /api/communities/<id>/node-types`, admin-only,
  and `removeNodeType` refuses anything that isn't `scope: 'note'`. Notes already
  declaring the type keep their `type:` — they just stop being coloured and
  chipped by it — the same way removing a tracked field leaves its values.
- **A viewer's arrangement is theirs.** Column order, hidden columns, widths
  and sort live in `localStorage` per space and type (`useTableView`), never on
  the space record. A column the viewer has never met appears at its canonical
  place, so a field an admin just added shows up without being switched on.
- Cells edit in place with an editor matching the column's kind; a refused
  value (a number that isn't one) is never stored as text. Edits are held
  optimistically over the fetched rows because the directory response is
  cached for 30 seconds.

## The nightly clean

**A space cleans itself on a clock, as a person.** The Space Console's **Clean**
section (`/admin?section=clean`) turns it on, sets the hour, and shows every
pass. It is the existing role-aware clean (`lib/notes/clean.ts`, the same code
`clean_context` runs) put behind a schedule row — it holds no authority of its
own:

- **It runs as the admin who turned it on** (`run_as_user_id`), under their
  ordinary principal. Their visibility lens decides what is analysed, their
  write gate what is written, origin `maintenance`, audited like any edit. A
  manual **Run now** acts as whoever pressed it. If the person it names stops
  being an admin the run is recorded `skipped` — an unattended pass acts for a
  named person or it does not act.
- **Only the mechanical allow-list is applied**, narrowed further by what the
  schedule opted into (`shared/cleanSchedule.ts#CLEAN_FIX_KINDS` is the
  ceiling; a hand-edited row cannot widen it). Duplicates, contradictions and
  orphans are never applied — they come back as the worklist the panel shows.
  Folders frozen for AI are reported and never written, as always.
- **Cleaning happens in the space that OWNS the notes, at the top level.** A
  sub-space holds no schedule and a parent never cleans one: its context is the
  parent's read-only `spaces/<id>/` folder, so `buildCleanScope` puts every
  `spaces/` path out of scope and `normalizeCleanTarget` refuses one as a
  target. A personal space is cleaned by its owner, not on a clock
  (`cleanScheduleDenial`).
- **The tick fires it, not the nightly sweep.** A schedule is a wall-clock hour
  in the space's own zone, so the minute tick claims due rows with a conditional
  UPDATE that advances `next_run_at` itself — N instances racing at 3:30am
  produce one run, and a night the deployment was down is skipped, never
  replayed.

- **What it applies is narrow, and that is the design.** The allow-list is
  frontmatter fill, one-match link repair, unambiguous mention linking, stale,
  expiry and supersession. It never changes a type, an alias or a folder: a
  restructure is judgment, and judgment comes back as the worklist (with the
  first `WORKLIST_ITEMS_KEPT` paths per kind on the run row) for a person or
  an agent to do through the ordinary gated writes.
- **The same row owns embedding.** `embed_enabled` is the space's one switch
  for the semantic half — off stops the nightly sweep, the query-time
  catch-up and search's vector stages alike (`searchContext` reports
  `semantic: 'off'`, distinct from the deployment's `no-key`), and a space
  with no row is on. `embed_after_clean` makes a pass re-embed what it changed
  in the same run, capped at `POST_CLEAN_EMBED_NOTES` with the rest left to
  the nightly; the outcome is its own column (`embed_status`), so an embedding
  failure never fails a clean that already wrote. `embedSweep(spaceId)` is the
  one implementation behind all three callers.
- **One tick runs at most `MAX_CLEANS_PER_TICK`**, oldest due first. The claim
  advances `next_run_at` before the pass, so a deferred row is still due next
  minute — the cap bounds one request, never the night's work.

Every pass writes a `context_clean_runs` row: what it could see, what was in
scope, what it wrote by kind, what a gate refused, what it left for a person,
whether full mode hit its note cap, and what the embed did. That history is
the dashboard, and it is how a schedule that quietly reaches nothing becomes
visible. `saveCleanSchedule` merges a patch over the stored row, so the
console can save one field at a time. Deleting the admin it runs as switches
it off (`deleteAccount`) rather than leaving a nightly skipped row.

## Search

`contextService.searchContext` → `lib/notes/shared/retrieval.ts#fusedSearch`. Six
stages fused by weighted RRF: frontmatter filter, BM25 over note text (title ×3,
tags ×2), pgvector cosine over whole-note embeddings, cosine over **note
chunks** (folded onto their note, below), source-chunk cosine + Postgres
full-text, and link-context neighbours of the top BM25 hits (recall net, weight
0.4). Cosine hits must clear both a relative floor (85% of top) and 0.55
absolute.

**A note is embedded twice: whole, and by section.** `lib/notes/shared/noteChunks.ts`
(pure, tested) splits a note at its headings — fenced code never opens one, an
index note's machine child list is dropped — then packs paragraphs to
`NOTE_CHUNK_CHARS` with a short overlap inside a section, cutting a giant
paragraph at sentence ends and never past `NOTE_CHUNK_MAX_CHARS`. What is
embedded is the breadcrumb plus the prose (`Portfolio > Halter > Q3 targets`
then the section), so a section's vector knows what it is about; what is
stored as `text` is the prose alone, for snippets. Chunks live in
`context_note_chunks`, keyed and pruned like note vectors and dropped with
the note in `projections.ts#dropEmbedding`; `lib/notes/chunkStage.ts` ranks
them against the visible notes' `(path, mtime)` so a chunk of an older save
is never served, and `fusedSearch` folds every hit onto its note at weight 1
— several matching sections collapse to the note's best rank — keeping the
best as the hit's `passage: { heading, text }`. Where `claim` is what the
note asserts, `passage` is where it says it. Chunks are written only by
`embedSweep` (nightly, post-clean, `pnpm db:embed`), never at query time: the
whole-note vector's lazy catch-up stays, chunks cost several vectors a note
and are done in bulk, one embeddings call per batch of notes.

**A query is planned before any stage runs** (`lib/notes/shared/queryPlan.ts`,
pure and deterministic): time words ("last week", "in June 2024", "since March",
"2026-03-15") become the `updatedAfter/Before` filter and are stripped from the
text the stages rank on; a query with nothing topical left ("what happened
yesterday") is *temporal-only* and is answered by recency inside the range with
no text stage at all; a history phrasing ("why did we stop…", "used to") turns
the lifecycle down-ranking off, because the retired note IS the answer. The
server widens the plan with one structured LLM call (`lib/notes/queryRewrite.ts`,
OPENROUTER_API_KEY, skipped for ≤3-word queries and temporal-only asks): up to three
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

**The deployment's own AI is ONE key: `OPENROUTER_API_KEY`.** Both halves go
through OpenRouter — chat (`lib/notes/ai.ts`, default
`deepseek/deepseek-v4-flash-0731`, overridable with `OPENROUTER_MODEL`) and
embeddings (`lib/notes/embeddings.ts`, `openai/text-embedding-3-small` at 768
dims, `EMBED_MODEL`) — so there is one account to bill and one key to rotate,
and adding a model is picking a slug rather than plumbing a provider. Without
it the response reports `semantic: "no-key"` rather than silently degrading;
after setting the key run `pnpm db:embed` once to backfill. This key is the
*platform's* — a space's AGENTS never touch it: they run on the space's own
`models/` notes and `MODEL_KEY_<PROVIDER>` secrets, and Gemini is still one of
the providers they may choose. Directory search itself is fuzzy/keyword only —
the old semantic directory search was removed.

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

**A brief is rehearsed before it is switched on.** `rehearse_agent` runs
NOTHING: it hands back what a run is given — the preamble, the brief, the model
a real run would use, and `connectorReadiness` for the CALLER — and the model
that asked carries that one round out itself, on its own subscription and its
own access (`lib/agents/shared/rehearsal.ts` is the wording, pure and tested).
Nothing is billed, no run is recorded, and the rules hold the stand-in honest:
one round, write nothing (the notes it would have written go in the reply), use
only what the brief declares, and report what is out of reach rather than
substituting for it. It is the only look at an agent's output anyone gets before
an unattended run makes it, and it is where a missing model or an unconnected
account surfaces instead of in a 3am failure. `create_agent` offers it in
`try_it`, and it is step 4 of the recipe, before `activate_agent`.

**A recipe that BUILDS something asks first.** `create_agent` and
`create_connector` carry an `intake` (`lib/actions/shared/intake.ts`, pure and
rendered into the note above the steps): at most four questions, in one message,
each carrying what it decides and when to skip it — because an agent and a
connector are configuration that then runs unattended, and the eager failure
(writing a plausible one nobody asked for, at a time nobody chose) is worse than
one message. "You decide" is a valid answer: pick the safe default, build, and
name the default. `create_agent`'s own description carries the one-paragraph
version for clients that never read a recipe.

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
verifying. Both are deletable once nothing is configured that way.

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
switch. It has two tabs, and they list different things: **In this space** is
one row per CONNECTOR, and **Add a connector** is the catalog
(`lib/connectors/catalog.ts`) — one row per SERVICE, each a recipe (fields to
fill in, the note that comes out). Saving writes the ordinary
`connectors/<name>.md` and PUTs each secret field to
`/api/communities/<space>/secrets`; nothing else changes. Manage — on a
connector's row — shows which service it is to, what it reaches, which secrets
it names and where the note is, plus **Disable**, **Edit** and **Delete**. The
row itself goes to the connector's page: the note IS the connector, so that is
where it is read and edited. A connector the space wrote itself is a row in the
first tab too, under a plug rather than a logo, and is still authored on the
draft surface.

**Connecting an OAuth service is one press.** A catalog row whose every field
is optional and `advanced:`, riding a client the deployment itself holds
(`clientId: platform:google`, resolved from env in
`lib/connectors/platformClients.ts`), skips the form entirely: Connect writes
the recipe's note with no input and sends the browser to the provider
(`connectsInOneClick`, pure — the list route reports which platform clients
exist, so a deployment with no Google client shows the form instead of a dead
end). The own-OAuth-app fields are still there, behind "Use your own OAuth app";
a service that genuinely needs credentials (Microsoft) keeps its form, and
saving it hands over to the provider rather than to a page whose only useful
control is Connect. The round trip lands back where it started —
`connectorConnectUrl(space, name, returnTo)` carries a `return` path, validated
by `safeReturnTo` at both ends and held in the signed pending cookie, never
echoed through the provider.

**The space's admins decide what is connected; a member connects themselves
to it.** The whole catalogue is the console's to connect from. What a member
gets is **Connectors on the account menu** — a dialog over whatever page they
were on (`ConnectorsDialog`), not a settings section, because `?connectors=`
on ANY page opens it and that is what the OAuth round trip returns to — with
three lists of the space they are in, and it is the console's own panel
pinned to a view (`ConnectorsPanel view=`), so an admin sees their acts in the
same places a member sees asks:

- **Connected** — the first tab — is what works for this person now
  (`worksForCaller`): a connector that holds no account is connected the moment
  its note is readable; one that signs in is connected once THEIR account is
  linked and not broken.
- **Not connected** is the rest of what the space has, one row per connector. A
  row a grant reaches goes to the connector's page and offers **Sign in** where
  the connector holds an account per member (`mode: user`). A row no grant
  reaches is still listed — the list route's `hidden`, from
  `service.ts#listHiddenConnectors`: name, title and recipe, never hosts,
  secrets or body — and offers **Request access**, a `ContextAccessRequest` on
  the note answered on Members → Waiting like any other.
- **All connectors** is the catalogue. A service the space holds says so; one
  it does not offers **Request**, a row in `connector_requests`
  (`lib/connectors/requests.ts`, `/api/communities/<id>/connector-requests`),
  which the console's Connectors section shows as a **Requested** strip with a
  badge. **Add** there is the recipe's own path — one press or the form — and
  the note it writes closes the request with its name stamped on the row;
  Dismiss closes it with nothing written. A request names a catalogue id,
  never free text.

The runtime still reads a note in the caller's own space (`me:<userId>`) when
the space it is in has none of that name (`readConnectorNote`, off with
`{ personal: false }` for the Tools bridge and the console's test run) — a
space's own note always wins its name, and `LoadedConnector` carries the
space it came from so secrets, account and budget are the owner's. No UI
writes such a note any more; the lookup is what keeps a note an action wrote
there working.

**A website login is a connector, and that is the vault.** The `website-login`
recipe writes a note with a `login:` block (the sign-in page, whose host must
be one of its `hosts:` — `config.ts#parseConnectorLogin`) and the account in
its env (`LOGIN_USER`, `LOGIN_PASSWORD` as a `{{secret:…}}`), so the same
store, redaction, audit and machine policy cover it as any other connector.
Nothing runs it in the isolate. An agent whose brief declares it, on a space
with a machine, gets `sign_in`: `lib/vm/signin.ts` decrypts the password on
the control plane and hands it to one command on the machine as that
command's environment, never on the command line, the disk, the trace or the
model's context (`docs/machines.md` § Secrets has the exact window). The
session then lives in the machine's browser profile like one a person made
during a takeover.

**The catalogue has four shapes**, and the fourth is `mcp` — a remote MCP
server by URL, built by `mcpServer(...)` in `lib/connectors/catalog.ts`: the
note's `auth.discover` is the URL, the host is the whole perimeter, there are
no fields, and Visvine registers itself as the OAuth client at first connect
(RFC 7591), so the press is one click on every deployment with no platform
client behind it. Each member signs in with their own account. Every URL on
the list was checked to publish OAuth metadata with a registration endpoint
and to answer streamable HTTP at that path; adding one is adding an
`mcpServer` entry after the same check. A row says whether an account is
actually linked (`connection` on the list route, keyed by provider = the
note's name), so a note left behind by an abandoned dance offers the sign-in
rather than claiming to be connected.

**The link a browser is sent to is relative** (`connectorConnectPath`).
`appOrigin()` reads `NEXT_PUBLIC_APP_URL`, which Next inlines when the image is
BUILT while the deployment sets it when the container is RUN — so a client
component that builds an absolute connect URL in production ships the
`http://localhost:3000` fallback and sends the person to their own machine.
`connectorConnectUrl` stays for the contexts with no page: an agent's step-up
message, a scheduled run's error.

`GET /api/user/personal-space` provisions the space and hands back the id (it
is derivable, but a personal space is created lazily and every space-scoped
route 404s on one that has not been). The admin gate on those routes is
`resolveContext(...).isAdmin`, never `isAdmin()`: a personal space holds no
aliases and never will, and its owner administers it by definition.

**The catalogue says how a service connects before you press anything.** One
press, a sign-in, or a credential you have to go and fetch
(`catalogConnectStyle`), and a row you paste a credential into is named for
what it is — "Slack API" — with the plain name left to the ones you just press
Connect on (`catalogRowLabel`; a database, a model provider and the catch-alls
keep their names, because "Postgres API" would be worse than Postgres).

**A service is not a slot.** A space may connect one service many times — the
team's Drive beside your own, two Slack workspaces — so a catalog row never
becomes "connected": it offers Connect, then **Add another**, whatever the space
holds. Three things follow, all in `connectorFromCatalog`:

- The note's name is `<recipe>`, then `<recipe>-2` (`suggestConnector`), so it
  no longer says which service it is to. The note's **`recipe:`** does, and
  `catalogEntryFor` reads it first (name, then model provider, are the fallbacks
  for a note written before it). Display only — no perimeter, key or permission
  is read from it.
- **Secret names carry the connector**, `SLACK_BOT_TOKEN__SLACK_2`: a secret
  name is the space's namespace, so sharing one would leave the first workspace
  running on the second's token, silently, with both notes still parsing.
- **`auth.provider` is the connector's name**, not the recipe's, because
  `ConnectorConnection` keys linked accounts on `(space, provider, member)`.
- The exception is a **model provider**: `MODEL_KEY_<PROVIDER>` is one row per
  space and a registry base URL is pinned in code, so a second note would name
  the same key and the same endpoint. `allowsManyConnectors` is false for it and
  its row offers Manage instead.

**Off is `enabled: false` in the frontmatter** (`isConnectorEnabled`), written
by `PATCH …/connectors/<name>`; turning one back on deletes the key rather than
writing the default. The note, its secrets and its perimeter are untouched —
`loadConnector` refuses every run, and a disabled `provider: custom` model
connector stops being the Space's endpoint (`lib/agents/providers.ts`). It is
configuration held in reserve, not a thing to delete and rebuild.

**An MCP server's reach is a list of NAMES, so it has a tool gate.** `hosts:`
and `allow:` say nothing useful about a server that is one host and one path —
what a caller picks is a TOOL — so a `shape: mcp` note carries `mcp.url` and a
`tools:` block, and `lib/connectors/toolPolicy.ts` is the pure gate on it. Three
verdicts: `allow` (anything, including a 3am fire), `ask` (**only a run a person
started** — Visvine cannot interrupt an unattended run to ask, so the setting
promises presence, which the runtime can keep), `deny` (never). Absent means
everything allowed, so a connection made before the block existed keeps working;
`recipe:` resolves the URL for one written before `mcp:` did
(`service.ts#mcpEndpoint`), so no backfill gates the surface. Enforcement is in
`hostMcp.ts`, before the session opens — and `mcpListTools` drops what the gate
would refuse right now, so a model is never taught to ask for a tool it cannot
have (`mcpAllTools` is the unfiltered read the permissions screen uses).
`attended` rides `executeConnectorScript(loaded, run, { attended })`, false
unless a caller says otherwise: true for the console's Test, for a direct
`run_connector` action call, and for an agent run whose `trigger` is `manual`.
The screen is a VIEW inside the connectors panel, not a dialog over it
(`ConnectorToolPermissions.tsx`), and the verdicts are written back into the
note's own frontmatter — the note stays the connector.

A connector's mark is one component on both surfaces
(`ConnectorLogo` — the list row and the connector's own page header): the
recipe's logo, resolved by `catalogEntryFor` on the note name, and the plug
for a connector the space wrote itself; a model's is its own catalogue's. Nothing is
stamped into the note to make that exact — a miss is a plug, and no behaviour
hangs off it. Logos live in `public/images/connectors/`. `tests/connector-catalog.test.ts`
runs every recipe through the real parsers, so a new entry that would write an
invalid note fails there.

**A model is its own kind, and the space's models are the only models there are.**
`models/<name>.md`, `type: model` + `provider: gemini|openai|anthropic|openrouter|custom`
+ **`model:`, the id it runs** (`lib/models/config.ts`) — keyed by the reserved
`MODEL_KEY_<PROVIDER>` secret (in `connector_secrets`, one per provider per
space), with the base URL from `lib/agents/registry.ts` (never the note). It
is NOT a connector: it has no perimeter, lives outside `connectors/`, and
nothing runs it directly — `run_connector` hands caller-authored JS the
plaintext of every secret its env binds, so a runnable model would let any
`connectors:use` member exfiltrate or spend the key. `models/` is admin-only
for writes like `connectors/` (`writeDenial`), sealed to Tools, and skipped by
the memory sweep. Consequences, all load-bearing:

- **A brief's `model:` is OPTIONAL and usually absent.** An agent runs on the
  SPACE's model — the first runnable model in note order — because which model
  a space runs on is one decision it makes once, beside the key that pays for
  it. A brief pins one only when it needs a different one the space also has;
  `parseAgentBrief` gives `modelRef: null` otherwise, and a pin that is
  malformed is still refused at parse.
- **There is no platform default.** `DEFAULT_AGENT_MODEL` is gone.
  `create_agent` writes no `model:` and reports `model_problem` when the space
  has none, the settings picker offers the space's models rather than the
  registry's providers, and `noModelReason` is the one sentence every surface
  says. A space with no model had briefs written pointing at Gemini — a
  provider it had never signed up for — which is what all of this is for.
- **`lib/agents/spaceModels.ts` is the one read of those notes.** The custom
  endpoint, the declared pricing and the options surface each swept the
  folder separately before, which is how they came to disagree about what
  "configured" meant. `spaceModels()` → `defaultModelOf` / `noModelReason`
  / `customEndpointOf` / `declaredPricingFor`, all pure over the parsed rows.
  It still reads the shape before `models/` existed — `connectors/<name>.md`
  with `kind: model` — until `db:models:migrate` has moved it, so the order
  of the deploy and the script never decides whether agents run; a `models/`
  note wins its name. That legacy shape is NOT a connector anywhere else
  (`isLegacyModelConnector`): the connectors list, `loadConnector` and the
  brief's `connectors:` picker all skip it.
- A run records the model it ACTUALLY used, not the brief's (absent) pin.
- **A model has a node and a page.** `model:<name>` is synced like a
  connector's node (alias = the provider id), and `/directory/model:<name>`
  is the Model tab beside Context and Raw
  (`features/profile/components/ModelPageContent.tsx`), admins only like a
  connector's: the provider and id (editable), the key (write-only), **the
  bill** — the last six months of `agent_model_usage` under `<provider>/`,
  this month by model id and by agent — and **who ran on it**: the recent
  `agent_runs` rows named (run for / started by), folded per person.
  Spend is keyed by `<provider>/<modelId>`, and a note stands for its
  PROVIDER (one key), so a brief pinning a sibling model on the same key
  is on this page too. `GET/PATCH /api/communities/<id>/models/<name>` and
  `lib/models/service.ts` are the read; `list_models` is the action.
- **A member's own plan is a model only the desktop app can run.** A brief
  may pin `model: local/claude` or `local/codex` (`lib/agents/local.ts`,
  `LOCAL_PROVIDER` in `parseModelRef`). The server can name it and never call
  it: `resolveAgentChatConfig` answers `local_runtime`, activation refuses
  it, the tick never tries it, and nothing is deactivated for it. It runs
  when a person presses Run in the desktop app: the page fetches the prompt
  from `GET …/agents/<name>/local-runs` (local preamble + brief + memory),
  the shell spawns the vendor's own binary (`apps/desktop/src/runtimes`,
  signed in by the member in the binary's own login — the one route Anthropic
  permits and OpenAI blesses), events stream over the preload bridge into
  `LocalRunPane`, and `POST …/local-runs` records the run under the agent
  with `model: local/<runtime>`, tokens metered, `costMicros` null — the plan
  paid, not the space. The Models dialog's **Your plan** section shows
  whether each binary is installed and signed in (in a browser, it says to use
  the desktop app). `LOCAL_RUNTIMES_OFF=claude,codex` is the kill switch,
  surfaced by `GET …/models`; the vendors changed their position on this
  four times in 2026, so it stays an env change rather than a release.
- **Models is its own row in the account band**, beside Connectors — the same
  dialog holding `ModelsPanel` (`features/models/components/`) with no tab bar
  and a `+` offering the five providers of `lib/models/catalog.ts`. Adding one
  writes `models/<name>.md` and PUTs the key to `/secrets`. It is not a section
  of the connectors list and not a console section: what agents run on is one
  decision a space makes once, not a row among forty services.

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
  the space's admins — that is the update queue, in the Space Console
  (`/admin?section=approvals`). There is no `/tools` destination and no rail
  row: the console owns tools (Tools = rail placement + the installed versions,
  Build = the working copies written here, Approvals = the queue), and
  cross-space install is the `install_tool` action rather than a catalogue. A
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
- **No request may run to the runtime's ceiling.** Cloud Run's `--timeout` is
  1800s because the agent tick awaits its dispatches, and it bills instance
  time for every second a connection is held — an SSE or chunked response has
  no length, so the exchange lasts until the CLIENT hangs up, which is how
  `/api/mcp` came to hold half-hour requests for answers it had already
  delivered. Every long-lived path carries its own shorter bound:
  `lib/mcp/deadline.ts` settles each MCP body and gives it a length,
  `RUN_AWAIT_MS` bounds what a caller waits for a run it triggered, and
  `/api/messages/stream` closes on its own clock (`EventSource` reconnects).
  Anything new that streams, polls or awaits needs the same.
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
