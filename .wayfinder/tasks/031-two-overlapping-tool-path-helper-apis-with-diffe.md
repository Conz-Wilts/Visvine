---
id: 031
title: Two overlapping tool-path helper APIs with different strictness (lib/tools/config.ts vs lib/notes/entities.ts)
status: done
kind: fix
size: s
wave: 1
depends_on: []
touches: [apps/web/lib/notes/entities.ts, apps/web/lib/tools/config.ts, apps/web/tests/notes-entities.test.ts, apps/web/tests/tools-config.test.ts]
created_by: 029
session: 92d39e30-d2b8-482c-9982-85aa103e4d76
model: sonnet
effort: high
---

## Task

Wave 1 landed two parallel sets of helpers that answer the same questions about a `tools/` path, from two different tasks:

- lib/tools/config.ts (task 003): `toolNameOfPath(path)`, `toolIndexPath(name)`, `toolFileKindOfPath(path)`, `isToolPath(path)` — `toolNameOfPath` validates the folder segment against `TOOL_NAME_RE` (/^[a-z0-9][a-z0-9-]{0,62}$/) and returns null otherwise.
- lib/notes/entities.ts (task 006): `isToolIndexPath(path)` (thin wrapper over `entityKindOfPath(path) === 'tool'`), `toolNameOfEntityPath(path)` — neither validates the name, because parseEntityHref accepts any `[^/]+` segment.

So they disagree on the same input: for `tools/Deal Pipeline/index.md`, `isToolIndexPath` returns true and `toolNameOfEntityPath` returns 'Deal Pipeline', while `toolNameOfPath` returns null and `toolFileKindOfPath` returns 'other'. Wave 2/3 has several consumers (store hook, bridge, registry, runtime routes, MCP handlers) and if two of them pick different helpers the store hook could refuse to compile a folder the entity layer happily treats as a Tool node — a Tool that exists in the graph but never builds. Task 003's outcome already flagged this pair for consolidation. knip does not catch it because tests/notes-entities.test.ts references the entities.ts pair.

Fix: keep ONE pair. Recommended: keep the strict lib/tools/config.ts helpers as the single source of truth for `tools/` path shape, and make lib/notes/entities.ts's `isToolIndexPath` / `toolNameOfEntityPath` either delegate to them or be deleted, with tests/notes-entities.test.ts updated to import from lib/tools/config.ts. Note the import direction: lib/tools/config.ts already imports `entityKindOf` from lib/notes/entities.ts, so entities.ts must NOT import from lib/tools/config.ts — resolve by deleting the entities.ts pair and pointing its tests at the config.ts helpers, or by inlining the TOOL_NAME_RE check in entities.ts and having config.ts re-export. Whichever way, after the change there must be exactly one function that answers "is this a Tool index path" and one that answers "which Tool does this path belong to", both rejecting a folder name TOOL_NAME_RE would reject. Verify with tsc/lint/`pnpm test`/knip all clean.

## Outcome

Consolidated the two duplicate "Tool path" helper pairs onto a single strict source of truth. Deleted lib/notes/entities.ts's `isToolIndexPath` and `toolNameOfEntityPath` (which never validated the folder segment, since parseEntityHref accepts any `[^/]+` segment) and left a comment pointing future readers at lib/tools/config.ts's `toolFileKindOfPath`/`toolNameOfPath`, which do validate against TOOL_NAME_RE. entities.ts still imports nothing from config.ts (import direction preserved: config.ts → entities.ts for `entityKindOf`). Updated tests/notes-entities.test.ts to drop the entities.ts imports and instead import `toolFileKindOfPath`/`toolNameOfPath` from lib/tools/config.ts, rewriting the affected test to use those and added an assertion showing the previously-disagreeing case (`tools/Deal Pipeline/index.md`) is now uniformly rejected. tests/tools-config.test.ts was already correct and needed no changes.

Verified: `tsc --noEmit` clean, `eslint` on the 4 touched files clean, `node --test tests/notes-entities.test.ts tests/tools-config.test.ts` → 52/52 pass, and `knip` reports zero unused exports/files.
