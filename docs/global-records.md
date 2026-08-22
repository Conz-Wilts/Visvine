# Global records — the Visvine space

One public space, id `visvine` (`apps/web/lib/spaces/globalSpace.ts`), holds the
**canonical public record** of every person the platform knows about: one
`people/<slug>.md` note and one person node per `Identity` that appears
somewhere public. Other spaces bind their person nodes to that record instead
of connecting them to a member.

## The pieces

| Piece | Home | Role |
| --- | --- | --- |
| `Identity` | `identities` table | The key. One row per real person across the platform; `userId` set when a member has claimed it. Unchanged. |
| Global node | `nodes` where `space_id='visvine'`, `identity_id` set | The record's card: name, subtitle, location, url, image, tags — all **gathered**, never typed. |
| Global note | `context_notes` `visvine` / `people/<slug>.md` | The record's context. A machine block between `<!-- global:record -->` markers carries the gathered facts and an "Appears in" list; prose outside it belongs to the person. |
| Binding | `Node.identityId` + `Node.metadata.globalMode` | How a space's node relates to the record: `follow`, `fork`, or nothing. |
| Follow replica | `ContextPublication` `visvine` → space | The follower's note is a live replica of the global note (read-only, `published-from`), with `node:` rewritten to the follower. |

## Sources and survivorship (`lib/global/shared/aggregate.ts`)

Sources, in the order they win a field:

1. the member's own `Person` profile, when the identity is claimed;
2. the person's node in each **public** space (visibility `public`, not a
   personal space, directory not admins-only), most complete card first.

Tags are the union. A node that *follows* the record is never a source (it
would only echo). **Private spaces never feed the record** — the same rule the
finder applies. A person who exists only in private spaces has no global
record, which is the privacy guarantee, not a gap.

## When the record updates (`lib/global/hooks.ts`, `lib/global/record.ts`)

- a person's note is saved in a public space's shared context (projection hook);
- a person node is patched in a public space (`PATCH /api/nodes/[id]`);
- a member edits their profile (`PATCH /api/profile/[id]`);
- a node is connected to a member (`connectNodeToUser`);
- a node is created with an identity (`POST /api/data/nodes`, `createEntity`);
- `pnpm --filter @visvine/web db:global:rebuild` rebuilds every record (the seed
  runs the same function).

Each sync rewrites the global node's fields and the note's machine block, then
pushes the fields to every follower node; the follower notes update through
the publication hook as any replica does.

## Who writes in the Visvine space

- **Read:** every signed-in user (`spaceMemberForbidden` short-circuits). No
  members, no join (`/join` refuses), the id is reserved on space create.
- **Write:** super-admins and the platform. A member may write only their
  **own** record — the `people/<slug>` note whose node's identity they claimed
  (`lib/global/gate.ts`). Node fields there take no local edit at all
  (`PATCH /api/nodes` → 403): change the profile instead.

## Binding from a space (`lib/global/binding.ts`, `/api/nodes/[id]/global`)

- **Follow** — the node mirrors the record. Fields are pushed from the record;
  the note is a replica and refuses edits here ("detach to edit"); `PATCH
  /api/nodes` returns 409. One node per identity per space.
- **Fork** — bound to the same identity (finder de-duplicates, the Profile tab
  resolves if the identity is claimed) but local: its fields and note are the
  space's own. *Follow again* overwrites them with the record.
- **Unbind** — drops the identity with a `split` anti-match so the resolver
  does not quietly re-attach it.

The finder (`/api/nodes/search`) returns the Visvine row as the representative
of its identity (`global: true`, leads the list); picking it creates the new
card already following the record (`global_follow` / `followGlobal`).

Member connection (`/api/nodes/[id]/connection`) still exists: it is the
identity being **claimed** by a user. Binding and connection are the same
`identityId`; connecting adds `Identity.userId`.
