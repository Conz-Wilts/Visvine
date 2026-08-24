# Sub-spaces

Spaces nest. A space can hold other spaces, and a `Space`-typed node is only
ever a pointer at a space that really exists. This document is the model and
the rules; `AGENTS.md` carries the short form.

## What changes, in one paragraph

Today `spaces` is a flat table and "Space" is a node type anyone can stamp on a
directory card — Blackbird has ~182 `space` nodes (its portfolio) and not one of
them is a space. After this change every `space` node carries `metadata.spaceRef`
pointing at a real `spaces` row, and the way you get one is either **link** a
space that already runs here or **create** one — which, from inside a space,
creates it *inside* that space. A child space is a full tenant: its own context,
members, admin aliases, tool rail, connectors and agents. In the parent's
context it is a folder. The switcher at the top becomes a tree.

## Model

### One new column

```prisma
model Space {
  parentId  String?  @map("parent_id")
  parent    Space?   @relation("SpaceChildren", fields: [parentId], references: [id], onDelete: Restrict)
  children  Space[]  @relation("SpaceChildren")
  @@index([parentId])
}
```

Plus one SQL partial index applied out of band like the public-name one
(`prisma/sql/sibling-space-name-unique.sql`, via `apply-sql-functions`):

```sql
CREATE UNIQUE INDEX spaces_sibling_name_unique
  ON spaces (parent_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
  WHERE parent_id IS NOT NULL;
```

That is the whole schema change. Every one of the 33 `space_id` tables keeps
working because a child *is* a space — it has its own rows in all of them.

Ids stay opaque global slugs (`operations`, `operations-2`), never encode the parent.
`spaceNodeId`, `/communities/[spaceId]`, `me:` and `visvine` checks are untouched.

### Visibility gains one value

`visibility: 'public' | 'private' | 'inherit'`

| value | who can see and read the space |
|---|---|
| `public` | anyone (unchanged). Name must be unique across *all* public spaces, any depth — the existing partial index already does this. |
| `private` | active members only (unchanged). Names free. |
| `inherit` | **children only.** Every active member of the parent. This is the default for a child. |

Rules that follow:

- A root space may not be `inherit`.
- A child may be `public` only if its parent is `public` (a public door inside a
  private house leads nowhere).
- Sibling names are unique (the partial index), case-insensitive. Private
  spaces at *different* levels or under different parents may share a name —
  Blackbird's `Operations` and Icehouse's `Operations` coexist.

### Membership invariant

**A member of a child is an active member of its parent.** Enforced at every
door (`join`, `join-via-invite`, `respondToInvitation`, admin add) and on the
way out (removing someone from a parent removes them from every descendant —
`removeMemberAccess` grows a descendant walk). Joining a public child auto-joins
a public parent; a private parent 403s with "join `<parent>` first".

Personal spaces (`me:*`) and the global space (`visvine`) never have children
and can never be a child.

### Admin

A child has its own `aliases` JSON and its own `UserAlias` rows — its own admin
list, exactly as today. Additionally **an admin of an ancestor is an admin of
the descendant** (`isAdmin` walks `parentId` upward, batched in `adminSpaceIds`).
Ancestor admins do not appear in the child's members panel as admins; they are
structural authority, shown as "managed by Blackbird Ventures admins" the way
super-admins are invisible now. Without this a child with zero members (every
migrated portfolio record) is unmanageable.

Depth is capped at **3** (root → child → grandchild). Reparenting is not in v1.

### Tools

Falls out of "a child is a space": own `featureConfig`, own `AppToolInstall`,
own connectors, secrets, agents. At creation the child's `featureConfig` is
seeded from `defaultFeatureConfig()` — *not* copied from the parent, so an Operations
sub-space starts with the core rail only and its admins switch things on. (Copy
is a one-line change if it turns out wrong in use.)

### Delete

`onDelete: Restrict` on the self-relation. `purgeSpaceObjects` and
`DELETE /api/data/communities` delete depth-first, children before parent, and
the admin UI says how many descendants go with it. A cascade here would be a
silent tenant wipe.

## Alignment with context notes — a sub-space is a folder

This is the part that makes the whole thing coherent rather than a second
hierarchy bolted on.

In the **parent's** shared context, a child space is an entity exactly like a
person: a `space` node with `metadata.spaceRef = <childId>` and a canonical note
carrying the spaceRef in its frontmatter, so the note is self-describing.

Where that note lives is the one place the two kinds of `space` node part ways,
and the discriminator is the **node id**:

| Node id | What it is | Note |
| --- | --- | --- |
| `space:<slug>` (or legacy `community:`/`org:`/`group:`) | a record of an organisation out in the world — a portfolio company, a firm you met | `communities/<slug>.md`, converting to `communities/<slug>/index.md` like any entity |
| `subspace:<slug>` | a space nested inside this one — one of its teams | `<slug>/index.md`, a folder at the **root** of the parent's context, from the moment it exists |

```yaml
title: Operations
type: Space
node: subspace:operations
space: blackbird-operations   # the spaceRef, so the note is self-describing
```

A record of the outside world belongs in the directory namespace with the rest
of the directory. A sub-space is not a record of the outside world: it is part
of how *this* space is organised, so it sits beside `deals/` and `data/` and the
context tree shows one folder per team. `lib/notes/entities.ts` owns the
derivation (`isChildSpaceNode`, `childSpaceNodeId`); a sub-space is
folder-only, like a Tool, so it never has a flat form. The signal is the id
rather than `metadata` deliberately — every surface that derives a path holds
`{ id, type }`, and half of them are client components that never load metadata,
so reading the id keeps the derivation total. `isOwnSpaceNode` already reads an
id the same way.

Either way the folder is where the parent keeps its notes *about* the child —
Blackbird's view of Canva, or a partner's notes on the operations team —
governed by the parent's grants like any folder. The child's *own* context is a
separate tree, rooted in the child. Nothing is mounted or mirrored between them
in v1; `ContextPublication` is already the mechanism for a child to publish a
note upward when that is wanted (phase 2, one tool).

Every `space` node in every space follows the same rule, including the space's
own root node (`isOwnSpaceNode`): `spaceRef` is its own id. So the invariant
is simply **`type = 'space'` ⇒ `metadata.spaceRef` is the id of an existing
`spaces` row**, checked in one place — `lib/directory/createEntity.ts` and the
note-side `entityNodes.ts` record path — and asserted by `db:notes:verify`.
A portfolio company is *not* one of these: it is a `Company` record, its own
type, with no tenant behind it (see the seed below).

The context tree renders such a folder with a space glyph instead of the folder
glyph (`TreeNode.space`, read off the index's `space:` key by `buildTree`); the
directory card for a `spaceRef` node already opens the space itself.

## Creating a space: one flow, two outcomes

Create → Space (directory, draft surface, MCP `record`/capture, agent tools) all
go through `createEntity`, which today accepts `spaceRef: null` and writes a
card. That becomes:

1. **Match.** The name is searched against spaces the actor can see
   (`listVisibleSpaces` + children). A hit is offered as **Link** — the
   existing `MatchPanel` row, now mandatory rather than optional.
2. **Create.** No link chosen → a child space is provisioned *inside the
   current space* (name, `visibility: 'inherit'`, no members — the ancestors'
   admins manage it — `parentId = current`) and the card links to it. Requires the actor to be able to write `communities/` in the current
   space — the same gate as recording a person there. Depth cap, sibling-name and personal/global
   rules apply; a refusal is a normal `writeDenial` message.
3. There is no third option. `spaceRef: null` is rejected.

The switcher's "Create space" keeps making a **root** space; a second entry,
"Create space inside `<current>`", appears for the current space's admins. Both
call `POST /api/communities` with an optional `parentId`; that path makes the
creator the child's admin and writes the record in the parent.

For the MCP/agent path `add_context` says exactly this — recording an
organisation creates a space inside the current one unless `space_id_ref` links
an existing space — so an agent capturing "met with Canva" creates one Canva
record, and the next capture matches it.

## The switcher

`SpaceSelector` shows a tree: root spaces the user belongs to, each expandable
into the children the user can access (`inherit` → parent member; `private` →
member; `public` → anyone). The trigger reads as a path — **Blackbird Ventures /
Operations** — and the search matches any level. Selecting a child sets it as
`currentSpace`; every surface already reads that, so Operations' own home, context,
tools and admin appear with no route changes. `nb_current_community` keeps
storing a bare id.

`GET /api/user/communities` returns memberships plus `parentId`; `SpaceContext`
builds the tree client-side. A stale child id (parent removed you) falls back to
the first root, as an unknown id does today.

## Migration

Two steps, in this order:

1. **Schema** — `pnpm db:migrate:new`: the column, FK, index, the sibling-name
   partial index. Read the SQL; it is additive only.
2. **Data** — a script (`scripts/migrate-space-records.ts`, `db:spaces:records`, idempotent, wired
   into `db:blackbird:full`, run once against prod through the proxy): for
   every `space` node without a valid `spaceRef`, excluding own-root nodes
   (which get `spaceRef = own id`), provision a child of the node's space —
   `inherit`, no members, `featureConfig` default — set `spaceRef`, and give
   `communities/<slug>.md` its `space:` key (writing the note if it is missing). Blackbird
   gains ~182 children. They are visible to Blackbird members, manageable by
   Blackbird admins, and each is an empty tenant until someone opens it.

Listings filter `parentId IS NULL` (Discover, `/communities`, admin CRUD,
`listMySpaces` on MCP gets a `parent_id` field) so 182 new rows do not flood
anything; they surface only under their parent.

## Seed

`seed.ts` adds Blackbird's three teams as hand-written children:
**Investments Team**, **Operations** and **Building Blackbird** — all
`inherit`, no member rows of their own, run by whoever admins Blackbird. Each
starts from `defaultFeatureConfig()`, so every toggleable tool is OFF and the
people in the space opt in; a rail is not something a parent imposes.

The 182 portfolio companies are deliberately **not** children. A company you
have backed is a record, not a tenant — it is `type: Company` (its own type in
Blackbird's vocabulary, folding onto `space` in `TYPE_SYNONYMS` so the entity
machinery is unchanged) and `db:spaces:records` leaves it alone.

`db:notes:verify` asserts the `spaceRef` invariant and the sibling-name check.

## Tests

`tests/sub-spaces.test.ts` covers the pure rules (`lib/spaces/hierarchy.ts`) and
the `space:` key in a record's note. `db:notes:verify` asserts the `spaceRef`
invariant against real data.

## Decisions taken here, and why

- **Child = real `Space` row, not a folder with extras.** "Own admins" and "own
  tools" are per-`space_id` in 33 tables; re-keying any of them by folder path
  would be a second permission model. The folder is the child's *record in the
  parent*, which is the same shape a person already has.
- **`inherit` visibility instead of copying memberships.** Copying 182 × N
  `SpaceMember` rows into every record is write amplification for a fact that
  is one predicate.
- **Ancestor admins are admins.** Otherwise a memberless child is orphaned and
  an ex-parent-admin could keep a foothold in a child.
- **Create-inside is the default for a `space` node, not create-at-root.**
  Recording "Canva" from Blackbird is Blackbird's Canva; a real Canva that joins
  later is linked by the match step, and the local record can bind to it then
  — the same follow/fork shape people already have with the global record,
  which is the phase-2 extension if it is wanted.
- **Not done in v1:** reparenting, mounting a child's context into the parent
  tree, ancestor-wide search, cross-level grants. All have a clear home and none
  is needed for Operations-inside-Blackbird to work.
