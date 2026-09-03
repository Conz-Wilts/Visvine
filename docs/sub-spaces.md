# Sub-spaces

A space may hold sub-spaces, one level deep. A sub-space is a full tenant of
its own — its own members, its own admins, its own tools, its own context —
that lives under a parent space. Two things tie it to the parent, and both
follow one rule: **a sub-space's visibility is its own, and a public
sub-space's context flows up.**

`AGENTS.md` carries the short form; this is the model and the reasons.

## What a sub-space is

One new column: `spaces.parent_id`, a self-reference with `ON DELETE
RESTRICT` and an index (`prisma/migrations/20260910120000_space_parent`).
Every other table keeps working because a sub-space *is* a space — it has its
own rows in all of them. Ids stay opaque global slugs (`founders-network`,
`founders-network-2`) and never encode the parent.

| | top-level space | sub-space |
|---|---|---|
| members, aliases, admins | its own | its own — the creator holds its Admin alias; the parent's admins are not admins of it |
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

## Context flows up — the folder `spaces/<id>/`

**A public sub-space's context appears in the parent's context tree as the
read-only folder `spaces/<id>/`.** Nothing is copied: the tree, the note
index, a single-note read and search each have a *federated* form
(`lib/notes/federation.ts`) that answers over the parent's own context plus
every public sub-space's, rebased under that folder, as of now. A change in
the sub-space is a change at the parent on the next read; a sub-space turned
private disappears from the parent on the next read; a private sub-space
shows nothing at the parent — not its notes, not its name.

Which surfaces federate:

| surface | route / action | what changes |
|---|---|---|
| tree | `GET /api/notes/tree` | `spaces/<id>/` grafted in, its root index as the folder's index, the folder stamped `space: <id>` |
| note index | `GET /api/notes`, `list_context`, an agent's `list_context` | the sub-space's `NoteMeta[]` with `path`, `folder` and `linkTargets` rebased |
| one note | `GET /api/notes/item`, `read_context`, an agent's `read_context` | read through the sub-space's reader; body links rewritten to `/spaces/<id>/…` |
| search | `POST /api/notes/search`, `search_context`, an agent's `search_context` | the sub-space searched with the same plan (no second rewrite call), hits fused by score |
| access | `GET /api/notes/access?path=spaces/…` | `canRead` per the reader, `canWrite: false`, never `gated`, plus `subspace: {id, name}` for the editor's banner |

### Who sees what through the parent

Access is not weakened to do this. A sub-space is read under a principal of
its own (`federation.ts#subspaceReader`): the person's identity, **no admin
standing**, and only the sub-space's **space-wide grants** (`subjectType:
'space'` — what it shows everyone in it), **capped to view**
(`access.ts#spaceWideAccessFor`). So:

- a restricted folder of the sub-space is as hidden at the parent as it is
  in the sub-space;
- an admin of the parent sees no more through it than any member of the
  parent does;
- nothing read through the parent can be written through it.

A public sub-space is born with one grant so that it flows something: a
space-wide **view** grant at its root, written by `provisionSpace` (and by the
seed). Its admins can narrow or revoke it like any grant, and what they leave
is exactly what the parent sees.

### `spaces/` is reserved

Nothing of the parent's own may be written under `spaces/`
(`subspaces.ts#subspaceWriteDenial`, applied in `contextService.writeDenial`
before every other clause and in the folders route). A note written there
would look like a sub-space's and be governed by neither space. The sidebar
draws the folder with a space's glyph, offers no Share, Move or Delete on
anything under it, and the editor shows a banner naming the sub-space.

## Surfaces

- **Console → Settings → Sub-spaces** (`SubspacesSection`): the sub-spaces of
  this space and **New sub-space** — name plus a public/private toggle.
  Creating one is an act of the parent's admins (`POST /api/communities` with
  `parentId`, refused otherwise); the creator becomes the sub-space's admin.
  A sub-space's own Settings names its parent and says what its visibility
  means there.
- **Switcher**: a sub-space you are in sits indented under its parent when
  the parent is in your list too (`subspaces.ts#nestSpaces`). A search
  flattens.
- **Discover / `/communities`**: "in *Parent*" when the parent is visible.
- **`GET /api/communities/<id>/subspaces`**: every sub-space for an admin;
  the public ones and the ones they are in for a member.
- **`list_spaces`** (MCP): `parent_id` per space.
- **Delete**: the parent relation is Restrict, so deleting a space with
  sub-spaces is a deliberate children-first delete in
  `DELETE /api/data/communities`, and the console's confirmation says how
  many go with it.

## Seed

Blackbird has two sub-spaces so the rule is on screen from the first seed:
**Founders Network** (public — its `playbooks/` show in Blackbird's tree
under `spaces/blackbird-founders-network/`) and **Investment Committee**
(private — nothing of it shows above). Dev Admin administers both; Dev Member
is in the public one only.

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
- **The everyone-principal, capped to view.** The alternative — the viewer's
  own standing in the sub-space — would show a parent's admin more than a
  parent's member, and there is no way to say that on a folder in the
  parent's tree. What the sub-space shares with all of its members is a
  single, explainable answer.
- **One level.** Every rule above is stated for a parent and a child. A
  grandchild would need each stated for a chain.
- **Not done:** reparenting; a sub-space's directory nodes in the parent's
  directory (only its context flows); grants that cross the boundary.
