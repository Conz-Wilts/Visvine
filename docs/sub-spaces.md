# Sub-spaces

A space may hold sub-spaces, one level deep. A sub-space is a full tenant of
its own — its own members, its own admins, its own tools, its own context —
that lives under a parent space. What ties it to the parent is a short list
of **named flows across the boundary**, each read at read time and each
stated for one parent and one child: a public sub-space's context and public
events flow **up**; a parent's flagged connectors and agents flow **down**;
and a sub-space may open two doors to the house it sits in — let the parent's
members walk in, and let the parent's admins hold its keys. Nothing is
inherited by default. The rule under all of them: **a sub-space's visibility
is its own, and what crosses is decided by the side that owns it.**

`AGENTS.md` carries the short form; `docs/sub-space-model.md` is the model
and the reasons; this is the code map.

## The four dials, as code

| dial | column(s) on `spaces` | pure rule (`lib/spaces/subspaces.ts`) | set where |
|---|---|---|---|
| Listing — `secret` \| `house` \| `world` | `listing`, with `visibility` derived (world ⇔ public) | `listingOf`, `visibilityForListing`, `listedToHouse` | the room's Settings; `PUT …/settings { listing }` |
| Doors — `invite` \| `ask` \| `open`, one for the house's members, one for the world | `house_door`, `world_door` | `doorsOf` (world clamped to house; both `invite` on a secret room), `joinOutcome` | the room's Settings |
| Flows up — context, events, people | `flow_context`, `flow_events`, `flow_people` | `flowsContext` / `flowsEvents` / `flowsPeople` (all false for a secret room) | the room's Settings |
| Governance | `parent_admins` | `parentAdministers`; one step in `lib/auth.ts#isAdmin` | the room's Settings; ON when a house admin creates it; only a holder of the room's own admin alias may switch it back on |
| Down (the house's) | per note: `share: all` \| `[room ids]` on `connectors/`, `agents/`, `tools/`; `share_as: use` \| `run-in` on agents; `subspace_config.modelKeys` | `shareTargets`, `isSharedDown(path, fm, roomId)`, `reachesRoom`, `subspaceConfigOf` | the connector / agent / Tool page; Console → Sub-spaces for model keys |

`visibility` stays the column every gate reads; `listing` only adds the
secret/house distinction inside private and is derived for a top-level
space. Presets (`PRESETS`) are the same dials filled in — Department,
Programme, Committee, Council, Tenant, Topic room — chosen in the New
sub-space dialog and passed to `provisionSpace` as `preset`.

## What a sub-space is

One new column: `spaces.parent_id`, a self-reference with `ON DELETE
RESTRICT` and an index (`prisma/migrations/20260910120000_space_parent`).
Every other table keeps working because a sub-space *is* a space — it has its
own rows in all of them. Ids stay opaque global slugs (`founders-network`,
`founders-network-2`) and never encode the parent.

| | top-level space | sub-space |
|---|---|---|
| members, aliases, admins | its own | its own — the creator holds its Admin alias; the parent's admins are not admins of it unless it says so (`parentAdmins`, below) |
| tools, connectors, agents, Drive | its own | its own, starting from `defaultFeatureConfig()` like any new space |
| visibility | `public` \| `private` | `public` \| `private`, **independent of the parent's** |
| can hold sub-spaces | yes | **no** — one level (`parentDenial`) |
| name | unique among public spaces | unique among its siblings too (partial index `spaces_sibling_name_unique`) |

Personal spaces and the global record (`visvine`) can neither hold nor be a
sub-space.

### Visibility is the sub-space's own

A public sub-space inside a private space is listed on Discover and joinable
without joining the parent. A private sub-space inside a public space is
invite-only like any private space. Membership of a sub-space is not
membership of its parent, and vice versa — there is no membership invariant
between the two.

Discover and the space list show "in *Parent*" beside a sub-space only when
the parent is in the viewer's own list, so a private parent's name never
leaks through its public child.

## Context flows up — a folder in `Sub-spaces`, addressed `subspaces/<id>/`

**A room whose `flowContext` is on (and which is not secret) appears in the
parent's context tree as a folder of its own inside one `Sub-spaces` folder
(`subspaces.ts#ensureSubspacesFolder`), beside the other rooms — two levels
under the space, and the folder is drawn only when there is a room to draw
(`pruneEmptySubspacesFolder`). A room that does not flow here is not drawn at
all.**

The tree's top is drawn in tiers (`lib/notes/shared/rootTiers.ts#tierRoot`):

```
Visvine          the space — the root row
  Main           everything this space holds, its own context
  Finance        a room, read into this tree
  HR
  Operations
```

`Main` is drawn, never stored. It carries the reserved path `:main:` and
stands for the context root, so the space's own `index.md` folds into its row
exactly as it folded into the root's; `drawn: 'main'` keeps it out of drag,
drop, Share and Delete. A space with no rooms has one tier and gets no `Main`
row. `tierRoot` runs on the DRAWN tree, after the search prune — every read of
a real path (the drag rules, the Move to… list, placement) still sees the tree
the server sent, and no note's address changes.

The `Sub-spaces` folder and `parent/` are stamped `federated`, and that stamp
is a TIER: `context.ts#sortTree` puts them after every folder the space
actually holds, and `NoteSidebar#TierSeam` draws one hairline above the first
of them. Sorted by title they landed between the space's own folders, which is
what made a room read as one more folder here rather than a window into
another space. A room's folder itself is not stamped — inside `Sub-spaces` the
rooms sort by name like anything else.

A room's row offers **Open &lt;room&gt;** in its menu, wired to
`setCurrentSpace`. Expanding the folder reads the room's context from here;
opening it stands you in the room. Two different acts, and the row is the one
place they look the same. Its paths live under the
reserved address `subspaces/<id>/`, which is also where it is drawn: nothing
of the parent's is ever stored there, and a write there is a write *in the
sub-space* (below). The `Sub-spaces` folder and each room's folder can be
**placed** under a folder of the parent's own — see *Structural folders are
placed, not moved*. Nothing is copied: the tree, the note index, a single-note read and search
each have a *federated* form (`lib/notes/federation.ts`) that answers over
the parent's own context plus every flowing sub-space's, rebased under that
folder, as of now. A change in the sub-space is a change at the parent on
the next read; a sub-space turned private disappears from the parent on the
next read; a private sub-space shows nothing at the parent but **its name**
(see *A private sub-space is closed, not secret* below).

Which surfaces federate:

| surface | route / action | what changes |
|---|---|---|
| tree | `GET /api/notes/tree` | a top-level folder (path `subspaces/<id>`) grafted in, its root index as the folder's index, the folder stamped `space: <id>` |
| note index | `GET /api/notes`, `list_context`, an agent's `list_context` | the sub-space's `NoteMeta[]` with `path`, `folder` and `linkTargets` rebased |
| one note | `GET /api/notes/item`, `read_context`, an agent's `read_context` | read through the sub-space's reader; body links rewritten to `/subspaces/<id>/…` |
| search | `POST /api/notes/search`, `search_context`, an agent's `search_context` | the sub-space searched with the same plan (no second rewrite call), hits fused by score |
| access | `GET /api/notes/access?path=subspaces/…` | `canRead` / `canWrite` per the reader (below), never `canManage`, never `gated`, plus `subspace: {id, name, member}` for the editor's one-line banner |
| write | `POST`/`PUT`/`PATCH`/`DELETE /api/notes/item`, `POST`/`PATCH`/`DELETE /api/notes/folders` | hopped into the sub-space by `federation.ts#writeTarget` / `moveTargets` (below); response paths rebased back |

### Who sees what through the parent — you are who you are in the room

Access is not weakened to do this. Through the folder a person is exactly
who they are **in the sub-space** (`federation.ts#subspaceReader`):

- someone who **stands in it** — an active member, or an admin of it (its
  own, or the parent's where `parentAdmins` is on) — reads under their own
  grants and their own admin standing there, as if they had switched to it;
- everyone else reads under the sub-space's **space-wide grants**
  (`subjectType: 'space'` — what it shows everyone in it), **capped to
  view** (`access.ts#spaceWideAccessFor`), with **no admin standing** whatever
  they hold in the parent.

So a restricted folder of the sub-space is as hidden at the parent as it is
in the sub-space, and a member of the parent who is not in the room sees only
what the room shows all of its members.

**Writes go the same way.** A write asked for under `subspaces/<id>/` is a
write *in the sub-space*, at the inner path, under the caller's own standing
there: `federation.ts#writeTarget` hops the context, principal and path
across, the route runs the ordinary gates (`writeDenial`, `canRemove`,
`principalCanWrite`, the namespace and replica checks) against the
sub-space, and the paths in the response are rebased back onto the parent's
tree. A caller who does not stand in the sub-space is refused with *"You are
not in \<room\>, so its context is read-only here. Join it to edit."* A move
is resolved at both ends (`moveTargets`) and refused when they land in
different spaces — nothing crosses the wall by being dragged over it. Never
hopped: `parent/` (changed in the parent), the `subspaces` folder itself and
a sub-space's root folder (a sub-space is renamed or removed from its own
settings), and access management — who sees what in a sub-space is its
admins' act, made there, so the parent's SharePanel does not open on its
rows. The tree route stamps a grafted folder `writable` when the viewer
stands in the sub-space, and the sidebar offers Move and Delete under it
exactly as it does under the space's own folders; every other federated row
is drawn read-only.

A public sub-space is born with one grant so that it flows something: a
space-wide **view** grant at its root, written by `provisionSpace` (and by the
seed). Its admins can narrow or revoke it like any grant, and what they leave
is exactly what the parent sees.

A sub-space is usually born *private* and made public later, so the same grant
is written by the visibility patch — `subspaceAccess.ts#ensureFlowUpGrant`,
called from `PATCH /api/spaces/<id>/settings` when `visibility` becomes
`public` on a space with a parent. It is idempotent and never widens a grant
that is already there, so a later toggle cannot undo a narrowing its admins
chose. Without it a sub-space made public after creation grafted an empty
`subspaces/<id>/` at the parent with nothing to explain it.

### Events flow up the same way

A room with `flowEvents` on has its **public** events (`visibility: public`
on the event) appear in the parent's upcoming events — the space hub's card and
`GET /api/events?spaceId=<parent>&includeSubspaces=1` — each carrying
`viaSpace: { id, name }`, which is both the badge and the read-only signal.
An event scoped to the sub-space's members (`visibility: space`) is the
sub-space's own declaration and stays there. Opening one from the parent goes
to `/events/<id>?space=<sub>`: the detail route reads it through
`requireSpaceMemberOrParent` — a member of the sub-space as before, else an
active member of the parent, for a public event of a public sub-space, and
never for a write. Nothing new needs a feature key; events are a node type.

## What flows down — the `parent/` folder

The mirror of flow-up, narrower on purpose. **A parent's `connectors/<name>.md`,
`agents/<name>/index.md` or `tools/<name>/index.md` marked `share: all` or
`share: [room, room]` in its frontmatter is read into each named sub-space as
one read-only top-level folder addressed under the reserved `parent/`, drawn
with the parent's name** (`graftParent`; `subspaces` is the older spelling of
`all`). Only those namespaces can be shared, only the note carrying the flag
(never a subtree), only into the rooms it names, and the folder exists only
while there is something in it. A
private parent shares down like a public one: the sub-space's members are
inside the house already, so the gate is the flag on each note, not the
parent's door.

There is **no principal on the parent side.** A sub-space's member may hold
nothing in the parent, and a parent's space-wide grant would leak notes nobody
flagged, so `lib/notes/federation.ts#parentShare` reads the parent's notes raw,
keeps the flagged ones as the allow-list, and every read under `parent/` —
tree, index, one note, search, the access route — answers from that list and
nothing else. The write gate refuses `parent/` before every other clause
(`federatedWriteDenial`), and the sidebar draws its rows with a space's glyph
and no Share, Move or Delete.

What the two shared kinds do in the sub-space:

- **A shared connector runs with the parent's secrets, in the parent's
  perimeter, on the parent's quota.** `readConnectorNote` resolves a name in
  the sub-space first, then the parent's shared list, then the caller's
  personal space; a hit from the parent loads with `spaceId` = the parent, so
  secrets, OAuth connections, quota, state and audit all land there with no
  further branching. The caller is still the person, so `identity:` names
  them. A sub-space's admin cannot set its secrets, edit its note or its
  permissions — those routes refuse with the parent's name — and its
  webhook inbox stays the parent's. A sub-space agent's `connectors:` may
  name it, and the machine policy opens its hosts.
- **A shared agent (`share_as: use`, the default) can be started from the
  sub-space.** `run_agent` resolves the name in the calling space first, then
  in the parent's briefs shared with it; a parent hit starts the run **in the
  parent, as the parent brief's author** (`claimManualRun` with `runAs:
  'author'`), so it acts with the parent's reach and never the caller's.
  Child → parent only. The sub-space's `agents:` picker lists shared parent
  agents as "from *Parent*".
- **A shared agent with `share_as: run-in` runs a copy inside each room it
  names** — over that room's context, as the house brief's author — and only
  in rooms the house governs (`parentAdmins`), because that is what gives the
  author standing there. The copy is an `agent_state` row in the room stamped
  `shared_from`, fanned out by `syncAgentState` on every save of the house
  brief and retired when the brief is unshared, deleted, or the room goes
  autonomous. Naming an ungoverned room is refused at write time.
- **A shared Tool is installed in the rooms it names**, its code loaded from
  the house and its data read through the bridge under the room member's own
  grants.
- **The house's model keys reach the rooms it chooses** (`subspace_config
  .modelKeys: 'all' | [ids]`): a room with no key of its own for a provider
  runs on the house's, never sees it, and its readiness says whose key it is.

### Triggers cross upward

A parent agent whose brief watches `on: { context: ['subspaces/**'] }` is
woken by a save in a **public** sub-space: `fireNoteTriggers` fans out to the
sub-space's own agents with the child-local path, then to the parent's with
the path rebased under `subspaces/<id>/` — the same address its
`read_context` already answers, so the event is directly actionable. Saves
under a sub-space's `agents/` never cross (a glob cannot watch a child's
briefs), `flowsUp` is checked at fire time, and self-loop suppression is not
forwarded because names are per space. Chain depth still holds across the
boundary.

## A private sub-space is closed, not secret

**Members of the parent see a private sub-space's NAME, and can ask to join
it.** Hiding it entirely left a member with no way to discover the room they
were meant to be in, let alone ask for it — so the door is drawn, and only the
door.

`subspaceAccess.ts#listLockedSubspaces(userId)` is the one read: private
sub-spaces of a space the caller is an **active member** of, that they are not
a member of themselves. It returns its own shape (`LockedSubspace` — id, name,
description, image, member count, and whether this caller has already asked)
rather than a `Space` with fields blanked, because a `Space` carries the
aliases, the type vocabulary and the tool config, and none of that may cross.
Discovering the parent (public, unjoined) earns nothing; standing in it does.

One surface draws it, from `SpaceContext.lockedSubspaces`: the space
switcher, as `LockedSubspaceRow` on the parent's branch, after the sub-spaces
you are in — the name dimmed, a lock, "Asked" once you have.

The context tree does NOT draw it. That tree is where a room's context is
read and written; a locked room has no context to read here and refuses every
write (`federation.ts#writeTarget`), so a folder for it is a row that can only
ever fail. Naming the room is the switcher's job, because the switcher is
where the door already is.

Pressing the row opens `RequestSubspaceAccessDialog`: what the space is, how
many people are in it, and one button.

**The door decides.** `POST /api/spaces/<id>/join` asks one question,
`subspaceAccess.ts#selfJoinOutcome` → `subspaces.ts#joinOutcome`: an active
member of the parent goes through the room's **house door**, everyone else
through its **world door** (which exists only on a `world` room and is never
wider than the house door). `open` writes an active membership; `ask` writes
a `pending` row — the same status an invite link's request lands in, so
admins of the room answer both in one place (Members → *Wants to join*);
`invite` is nothing to press. A pending ask from before the door opened is
honoured. A pending join creates no person node, no alias and no cache bust,
because nothing about the space has opened. A secret room is not on this
route at all: nobody who cannot see it can press anything.

### The parent's admins, by invitation

`parentAdmins` (Settings → "Managed by *Parent*'s admins too") makes
`isAdmin(user, sub)` answer yes for whoever holds an admin alias in the
parent — one step, never a chain. It is **on** when a house admin creates the
room (they hold its admin alias anyway); any admin of the room may switch it
off; only a holder of the room's **own** admin alias may switch it back on
(`settings/route.ts` checks `adminSpaceIds`, the direct answer), so a house
cannot reclaim a room that chose autonomy. It reaches the client the same
way: a private sub-space with it on appears in a parent admin's space list
and switcher without a membership, so the space they manage is one they can
open. Federation follows it: a parent's admin who administers the room
through it *stands in* the room (`isAdmin` says so), and so reads and writes
its folder in the parent's tree as the room's admin.

### `subspaces/` is reserved

Nothing of the parent's own is ever stored under `subspaces/`
(`subspaces.ts#subspaceWriteDenial`, applied in `contextService.writeDenial`
before every other clause) — a note of the parent's there would look like a
sub-space's and be governed by neither space. The routes hop a write there
into the sub-space first (above), so the denial is only ever seen by a caller
that did not (an agent's or MCP `write_context`, which stay read-only across
the wall), and for the `subspaces` folder itself and a sub-space's root. The
sidebar draws the folder with a space's glyph and never offers Share on
anything under it; the editor shows one line naming the sub-space, and says
"read-only" only when it is.

### Structural folders are placed, not moved

A space's built-in folders (`people/`, `agents/`, `connectors/`, … — every
row of `lib/notes/shared/namespaces.ts`), the `Sub-spaces` folder and each
room's folder have paths the runtime resolves against, so they are never
renamed. They can be **organised**: a structural folder is *placed* under a
folder of the space's own and the tree draws it there, path unchanged
(`lib/notes/shared/placedFolders.ts`). The tree is the only surface that
follows a placement — note paths, URLs, the note index, search and the index
child blocks (which list what is filed under a folder *by path*) are as they
were. Each namespace row carries an `icon`, so a built-in folder is drawn with
its tool's glyph rather than a folder's, wherever it sits.

- **Where it is recorded:** on the containing folder's index note —
  `ops/index.md` gets `holds: [agents, subspaces/design-partners]`. That is
  the whole record: hand-editable, revisioned, follows `ops/` through a rename
  or the trash, and written under `ops/`'s own edit gate. The top holds by
  default and records nothing; a room's default home is the `Sub-spaces`
  folder.
- **The rules** (`placementDenial`): a folder of the space's own or the top,
  never another built-in folder, an entity's folder or `parent/`; within its
  own space (a room's `agents/` stays in the room — placed there through the
  parent's tree by someone who stands in it — and a room's *folder* is the
  parent's); never inside itself, by path or by drawing.
- **How:** drag the folder in the sidebar, or "Place in…" from its row menu →
  `POST /api/notes/folders/place { path, container }`, which removes the
  entry from whoever held it and adds it to the container, each an ordinary
  `writeGated` note write. The tree route reads `placementsFrom(metas)` and
  `applyPlacements` per context — a room's own layout before it is rebased
  into the parent, the parent's after the graft.

## Surfaces

- **The Directory draws no sub-space UI.** Sub-spaces are not directory
  nodes: they are reached from the switcher and the context tree, and
  managed from the console. (A band of sub-space cards at the top of the
  grid, and the house-side `hiddenFromBand` preference that went with it,
  were removed 2026-09-15.)

- **Console → Settings → Sub-spaces** (`SubspacesSection`): the sub-spaces of
  this space, the model-key preference, and **New sub-space** —
  a name and a preset (the dials are editable afterwards in the room's own
  Settings, which shows all four).
  Creating one is an act of the parent's admins (`POST /api/spaces` with
  `parentId`, refused otherwise); the creator becomes the sub-space's admin.
  A sub-space's own Settings names its parent and says what its visibility
  means there.
- **Switcher**: the panel lists top-level spaces
  (`subspaces.ts#spaceBranches`); one that has sub-spaces you are in carries a
  chevron, and pressing it opens them under the row on the tree spine
  (`SubspaceRow`, `TreeSpine`). The branch you are in starts open. A search
  flattens.
- **Discover / `/spaces`**: "in *Parent*" when the parent is visible.
- **`GET /api/spaces/<id>/subspaces`**: every sub-space for an admin;
  the public ones and the ones they are in for a member.
- **`list_spaces`** (MCP): `parent_id` per space.
- **`create_space`** (MCP, `context:write`): `parent_id` makes a sub-space,
  under the same parent-admin check as the console, through the same
  `provisionSpace`.
- **Delete**: the parent relation is Restrict, so deleting a space with
  sub-spaces is a deliberate children-first delete in
  `DELETE /api/data/spaces`, and the console's confirmation says how
  many go with it.

## Seed

The seeded space has four rooms, named after the teams in them, so the dials are
on screen from the first seed (`scripts/seed/subspaces.ts`):

- **Engineering** — a *Department*: the house walks in, and its runbooks,
  services and decisions show in the parent's tree under
  `subspaces/engineering/`.
- **Marketing** — the room the world can find: listed, strangers ask at the
  door, its demo day flows up as a public event, and the agency and press
  records it keeps flow up as read-only people.
- **Finance** — a *Council* with `flowContext` off: the house's members see the
  door and ask; nothing of its packs shows above, its events would.
- **Compensation** — a *Committee*: secret, flowing nothing, named nowhere
  outside its own members.

Dev Admin administers all four. Dev Member is in Engineering and Marketing, is
pending at Finance's door, and is told nothing about Compensation.

## Tests

`tests/sub-spaces.test.ts` covers the pure rules (`lib/spaces/subspaces.ts`):
the one-level cap, the flow-up predicate, path parsing and rebasing, the
write denial, the tree graft, index rebasing, link rewriting, and the
switcher's nesting order.

## Decisions taken here, and why

- **A sub-space is a real `Space` row, not a folder with extras.** "Own
  admins" and "own tools" are per-`space_id` in thirty-odd tables; re-keying
  any of them by folder path would be a second permission model.
- **Visibility is independent; there is no `inherit`.** The ask is a public
  door inside a private house, and a private room inside a public one. A
  third visibility value would have been a third rule to explain.
- **Flow-up is read-time federation, not a copy.** A copy has to be kept in
  sync and can be edited in the wrong place. A read cannot drift.
- **Through the wall you are who you are in the room.** A member of the
  sub-space reads and writes its folder in the parent's tree exactly as they
  would after switching to it — the folder is a shortcut, not a second
  permission model. Anyone else gets the everyone-principal capped to view:
  what the sub-space shows all of its members is the one explainable answer
  for someone it has not let in. (Until 2026-09-15 everyone got the
  everyone-principal and the folder was read-only for all; the ask that
  changed it was the obvious one — a member of the room having to switch
  spaces to fix a typo in a note they could see.)
- **One level.** Every rule above is stated for a parent and a child. A
  grandchild would need each stated for a chain.
- **Flows are named, not inherited.** Each thing that crosses — context up,
  events up, connectors and agents down, the two doors — is its own switch
  with its own owner and its own read. There is no `inherit` and no
  "department" mode, because each would be a bundle of these that some space
  would want to unbundle.
- **Downward, there is no principal.** The flag on the note is the whole
  grant, and the allow-list is computed from content on every read. The
  alternative — a parent-side principal built from the person's standing —
  asks whether someone may read a space they may not belong to, and the
  honest answer is no.
- **A shared agent runs in the parent as its own author.** Running it as the
  caller would hand a sub-space's member the parent's reach; running it in the
  sub-space would need the parent's author to stand there. Neither is what
  "share" means.
- **Not done:** reparenting; a sub-space's directory nodes in the parent's
  directory (only its context flows); grants that cross the boundary; a shared
  connector's webhook fanning out to sub-space agents.
