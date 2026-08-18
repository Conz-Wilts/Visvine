---
id: 038
title: A hand-made tools/<name>/index.md must still become a real Tool (node-first gap)
status: done
kind: build
size: s
wave: 3
depends_on: []
touches: [apps/web/lib/notes/store.ts, apps/web/lib/notes/entityLinks.ts, apps/web/lib/notes/shared/indexNote.ts, apps/web/tests/tools-entity-folder.test.ts]
created_by: 010
session: ff48a88c-5c43-4cb3-9eb6-2928785659fd
model: sonnet
effort: high
---

## Task

Task 010 found that `tools/<name>/index.md` is an ENTITY FOLDER INDEX, so store.ts#enforceIndexContract holds it to the entity contract: with a `tool:<name>` node behind it the note keeps `type: tool` and gains `node: tool:<name>`; WITHOUT one, enforceIndexFrontmatter rewrites the frontmatter to `type: Index` and the config never parses again. lib/tools/service.ts#createTool therefore creates the node first (syncEntityNode, id pinned to `tool:<name>`, refusing when that global id belongs to another space), and that path is verified working against the local DB.

Every OTHER door into `tools/` is still broken: the notes UI create-note flow, the REST note write, a restore from trash, an import — anything that writes `tools/x/index.md` without going through createTool silently loses `type: tool`. (Generic MCP writes are already refused, but only because `tools/` is frozen for AI origins.)

Decide and implement one of: (a) lib/notes/entityLinks.ts#syncNoteNode grows a tool branch that creates the node from a `type: tool` index write — note the ordering problem: enforceIndexContract runs BEFORE syncContextLinks in store.writeNote, so the node must be created inside the store's index-contract path, not after it; or (b) store.ts refuses an index write under `tools/` when no node exists, with a message naming createTool; or (c) enforceIndexContract falls back to preserving a declared entity type for folder-only kinds. Whichever is chosen, add a test that a note written straight at `tools/x/index.md` either ends up parseable by parseToolConfig or is refused with a message that says how to create a Tool.

Also worth covering here: renameFolder refuses to move an entity folder at all ("its path is the entity's identity and can't change"), so renaming a Tool is currently impossible — decide whether that is the intended answer for Tools or whether the service needs a rename that moves the node too.

## Outcome

Implemented option (a): a hand-made `tools/<name>/index.md` now gets its `tool:<name>` node created inline, closing the gap where every door besides `lib/tools/service.ts#createTool` (create-note UI, REST write, MCP write, restore from trash, import) silently lost `type: tool` to `store.ts#enforceIndexContract`'s plain-Index fallback.

Fix: `lib/notes/entityLinks.ts` gains `ensureToolNode(spaceId, path, content)` — creates the `tool:<name>` node (via `syncEntityNode`, mirroring `syncConnectorNode`/`syncAgentNode`) when the write declares `type: tool` and no node exists yet, no-ops if one already exists in this space, and throws a denial naming `createTool` when the node id is already claimed by another space (matching `createTool`'s own clash refusal). `store.ts#enforceIndexContract` calls it BEFORE deciding the frontmatter contract — solving the ordering problem: `enforceIndexContract` runs ahead of `syncContextLinks` in both `writeNote` and `createNote`, so waiting for `syncNoteNode` (reached only via `syncContextLinks`) would be one save too late, since the type would already have been rewritten to `Index`. `syncNoteNode` also gained a `tool` branch (checked before the generic `isIndexPath` skip, since a Tool's entity note is always an index path) so restore-from-trash and any other `syncContextLinks` caller stay consistent.

The create/decide logic that's genuinely new is DB-backed (creates a Node row) and this repo's `tests/*.test.ts` convention is zero DB access (confirmed: no existing test touches Prisma; `pnpm test` runs the whole glob unconditionally). So I extracted the pure decision surface into `lib/notes/shared/indexNote.ts` — `declaredFolderOnlyEntity` (does this write even claim to be the folder-only entity kind, and what name/subtitle would its node get) and `entityNameClashDenial` (the refusal message) — and wrote `tests/tools-entity-folder.test.ts` (8 tests) against those plus `enforceEntityIndexFrontmatter`/`enforceIndexFrontmatter`/`parseToolConfig`, proving: a hand-made write with `type: tool` ends up parseable by `parseToolConfig` once a node is known, an ordinary index write is untouched, and a name clash is refused with a message naming `createTool`.

Also reviewed the renameFolder question: Tools already inherit the generic entity-folder rule (`isEntityFolder` in `store.ts` refuses renaming any folder-only entity, tool included, since FOLDER_ONLY_ENTITY_KINDS already covers `tool`) — no code change needed there; renaming a Tool stays refused, consistent with every other entity folder.

Verified: `tests/tools-entity-folder.test.ts` (8/8 pass), full suite `node --import tsx --test tests/*.test.ts` (927/927 pass), `tsc --noEmit` clean, `eslint . --max-warnings=0` clean, `knip` shows only pre-existing unused exports from other in-flight wave tasks (none of my new exports).
