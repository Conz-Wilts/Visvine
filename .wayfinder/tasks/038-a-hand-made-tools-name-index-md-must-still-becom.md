---
id: 038
title: A hand-made tools/<name>/index.md must still become a real Tool (node-first gap)
status: todo
kind: build
size: s
wave: 3
depends_on: []
touches: [apps/web/lib/notes/store.ts, apps/web/lib/notes/entityLinks.ts, apps/web/lib/notes/shared/indexNote.ts, apps/web/tests/tools-entity-folder.test.ts]
created_by: 010
session: null
model: null
effort: null
---

## Task

Task 010 found that `tools/<name>/index.md` is an ENTITY FOLDER INDEX, so store.ts#enforceIndexContract holds it to the entity contract: with a `tool:<name>` node behind it the note keeps `type: tool` and gains `node: tool:<name>`; WITHOUT one, enforceIndexFrontmatter rewrites the frontmatter to `type: Index` and the config never parses again. lib/tools/service.ts#createTool therefore creates the node first (syncEntityNode, id pinned to `tool:<name>`, refusing when that global id belongs to another space), and that path is verified working against the local DB.

Every OTHER door into `tools/` is still broken: the notes UI create-note flow, the REST note write, a restore from trash, an import — anything that writes `tools/x/index.md` without going through createTool silently loses `type: tool`. (Generic MCP writes are already refused, but only because `tools/` is frozen for AI origins.)

Decide and implement one of: (a) lib/notes/entityLinks.ts#syncNoteNode grows a tool branch that creates the node from a `type: tool` index write — note the ordering problem: enforceIndexContract runs BEFORE syncContextLinks in store.writeNote, so the node must be created inside the store's index-contract path, not after it; or (b) store.ts refuses an index write under `tools/` when no node exists, with a message naming createTool; or (c) enforceIndexContract falls back to preserving a declared entity type for folder-only kinds. Whichever is chosen, add a test that a note written straight at `tools/x/index.md` either ends up parseable by parseToolConfig or is refused with a message that says how to create a Tool.

Also worth covering here: renameFolder refuses to move an entity folder at all ("its path is the entity's identity and can't change"), so renaming a Tool is currently impossible — decide whether that is the intended answer for Tools or whether the service needs a rename that moves the node too.
