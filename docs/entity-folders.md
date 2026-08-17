# Entity folders — more than one context note per directory node

A directory node (person, org/space, resource, event, …) is bound to its context
note by path arithmetic: `entityNotePath(node)` → `people/<slug>.md`
(`apps/web/lib/notes/entities.ts`). There is no DB pointer to the note in the
common case; the path *is* the identity, and every `[[mention]]`, backlink,
profile Context tab, MCP `read_context` and the `mentioned` link sync resolve
against it.

When a node needs **more than one note** ("Sam's comms with Connor", "Phoebe's
comms with Connor"), its entity note **becomes an index**: the note moves from
`people/connor.md` to `people/connor/index.md` and `people/connor/` becomes the
node's *context folder*. Notes at `people/connor/<anything>.md` are the node's
**sub-notes**.

## The invariant

> A node's canonical note is `<dir>/<slug>.md` **or** `<dir>/<slug>/index.md`;
> which one is recorded on the node as `metadata.notePath`, set the moment the
> note becomes a folder. Notes at `<dir>/<slug>/**.md` (other than the index) are
> sub-notes owned by that node: not entities themselves, but rendered under the
> node's chrome, and their mentions attribute to the node.

"Two types" is expressed as **entity type in frontmatter + index by path**, not
`type: [Person, Index]`. An entity folder's index keeps `type: Person` (etc.) and
`node: person:connor`; index-ness comes from the path, exactly as the store
treats every index. Both path forms are canonical entity paths as far as links
are concerned — the reverse maps register both, so a link written before or
after the conversion resolves.

## Path helpers (`lib/notes/entities.ts`, pure)

| helper | `person:connor` → |
| --- | --- |
| `entityFlatPath` | `people/connor.md` |
| `entityFolderPathOf` | `people/connor` |
| `entityIndexPathOf` | `people/connor/index.md` |
| `entityNotePath` | the flat form, or the index form when `metadata.notePath` names it |
| `entityNotePaths` | both forms (what the reverse maps register) |
| `entityOwnerPathOf('people/connor/x.md')` | `people/connor` (null for entity notes / indexes / plain notes) |
| `isEntityFolderIndex` | true for `people/connor/index.md` |
| `parseEntityHref` | accepts `<dir>/<slug>.md` **and** `<dir>/<slug>/index.md`; a sub-note is *not* an entity href |
| `resolveEntityOwner(path, map)` | `{ id, subPath }` — sub-note → `subPath: 'x.md'`; entity note → `subPath: null` |
| `entityContextHref(id, subPath?)` | `/directory/<id>?tab=context[&note=<sub>]` |
| `hrefForNotePath(path, map)` | entity/sub-note → profile Context tab; else `noteHref` |

## Store (`lib/notes/store.ts`)

- `ensureEntityFolder(context, node, actor)` — idempotent. Moves the flat note
  to the index (row id kept, inbound links rewritten via `syncContextLinksBulk`,
  publications/grants follow, folder row upserted), or seeds the index from the
  entity stub when the node had no note yet; enforces the entity-index contract
  (`enforceEntityIndexFrontmatter`); sets `Node.metadata.notePath` (shared
  context only) and busts the context-data cache.
- **Auto-conversion:** `createNote` / `renameNote` / `moveNote` landing at a
  sub-note path convert the owning entity's note first (`ensureOwnerFolderFor`).
  No node with that slug → the write is refused (`"people/xyz" is not a directory
  entity — …`).
- A write to the flat path after conversion is redirected to the index
  (`canonicalEntityWritePath`), so a stale link/agent enriches the note rather
  than creating a second one. `GET /api/notes/item` reads through the same
  redirect and returns `path` = the canonical location.
- Retyping an entity note to `Index` converts it into its *own* folder; the type
  is put back to the entity type. Renaming an entity folder is refused (its name
  is the entity).

## Links (`lib/notes/entityLinks.ts`)

- `loadEntityMaps` registers **both** forms in `idByPath`; `pathById` is the
  canonical (metadata-aware) path.
- A sub-note's mentions attribute to its owner (`ownerIdOf`) — `originRef` stays
  the sub-note path, so each note owns its rows.
- Stale cleanup re-points an edge instead of deleting it when the counterpart
  (or one of *its* sub-notes) still mentions back, **or** a sibling note of the
  same node still mentions the counterpart (`heirFor`).

## UI

- URL: `/directory/<nodeId>?tab=context&note=<sub path relative to the folder>`.
  `useEntityNotePath` in `app/(auth)/directory/[nodeId]/page.tsx` reads `note`
  and hands the full path to the pane surface → `PaneSurfaceHost` →
  `EntityContextPanel notePath=…`. Every `NodeRoute` (person / org / event /
  space / resource / connector / agent) gets this for free.
- `EntityContextPanel` keeps the entity notch (avatar / rename / type / tags,
  from the **node**), shows a **notes strip** ("Context" = the entity's own note,
  then its sub-notes, then "+ New note"), and renders the sub-note's own title
  above its body (`NoteEditor showTitle`). "+ New note" creates
  `<folder>/<slug>.md` — the first one converts the note server-side; the panel
  patches the cached node with the new pointer and re-points via `router.replace`.
- Routing at origins (tree row, in-note links, connections rail,
  `/directory/note/[...path]`) goes through `resolveEntityOwner` /
  `hrefForNotePath`; a hand-typed entity or sub-note path on the plain note page
  redirects to the entity URL (tree-only chrome while the directory loads).
- Tree: an entity folder renders as its titled folder row with the sub-notes
  beneath (the index folds into the row). Dropping a loose note onto an entity
  folder files it under the entity (`moveDenial` allows *into* an entity folder;
  still refuses the namespace root, moving the index, moving the folder).

## MCP (`lib/mcp/tools.ts`)

- `read_context` `note_path` accepts both forms and sub-notes; a sub-note read
  returns that note with `sub_note_of` + `owner_node_id`; every entity read lists
  `sub_notes`. `mentioned_by` counts mentions of either form.
- `edit_context` at `people/<slug>/<x>.md` creates a sub-note (auto-conversion);
  the result carries `sub_note_of`. `INDEX_RULE` explains entity folders.

## Verification

- `scripts/verify-notes-rules.ts` rule 3: an entity-folder index must declare the
  entity type + `node:` (not `type: Index`); rule 6: `metadata.notePath` ⇔ the
  live index (drift both ways), and never both forms live at once.
- Unit tests: `tests/notes-entities.test.ts`, `tests/notes-index.test.ts`.

Non-goals: no automatic collapse back to a flat note when the last sub-note is
deleted; no entity folders nested inside entity folders; personal (`me:`)
contexts get the same path moves but no node pointer (there is one node).
