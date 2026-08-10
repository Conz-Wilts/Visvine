# The MCP tool surface

Thirteen tools over the context layer, served at `/api/mcp`
(`apps/web/app/api/mcp/route.ts`, registered in `apps/web/lib/mcp/tools.ts`).

The shape of the surface follows the shape of the model:

- An **entity** is a typed `Node` plus one canonical context note at a
  deterministic path (`person:craig` → `people/craig.md`).
- The **type** decides what you can create and which fields it has.
- **Links are derived, not authored.** A markdown link to an entity's note,
  inside another shared-brain note, is what creates a `mentioned` edge. There is
  no `create_link` tool because there is no such operation — which is why every
  tool that returns an entity also returns a ready-to-paste `mention` string
  (the leading slash is load-bearing).

Tools call the domain layer directly rather than the app's own HTTP routes, and
never re-implement authorization: `lib/mcp/context.ts` resolves the brain via
`resolveBrain`/`principalOf` — the same functions the web routes use — so every
read goes through the visibility lens and every write through the folder gate.

## Tools

| Tool | Scope | Does |
|---|---|---|
| `list_communities` | `context:read` | Your spaces, your role in each, which is your personal space. Entry point: everything else needs a `community_id` (the wire name for a space id — tool and field names are frozen for client compat). |
| `list_context` | `context:read` | One space's bearings: entities by type, the note index, where you can write (`writable_folders` + `writable_notes`, each with an `audience` line), who you are there (`you`), and the node-type catalog (`types`). |
| `search_context` | `context:read` | Fused search over notes, uploaded files and directory entities. See below. |
| `read_context` | `context:read` | One entity in full: fields, note markdown, links (with origin), notes that mention it. By `node_id` or `note_path`. |
| `list_files` | `context:read` | The uploaded files in this context, with extraction status. |
| `read_file` | `context:read` | The extracted text of one uploaded file, paged. |
| `add_context` | `context:write` | A typed node + its context note. `person` / `space` (= a group/organisation recorded in the directory) / `resource` only. The note is private by default (`visibility`). |
| `edit_context` | `context:write` | Create or overwrite one note (history keeps the prior version). Defaults to your **personal** brain; a NEW shared note is private by default (`visibility`). |
| `append_context` | `context:write` | Append a dated, attributed entry to a note's `## Log`. The lossless way to add one fact. |
| `move_context` | `context:write` | Move/rename a note, rewriting every inbound link so the graph survives. Note-level sharing/restriction does not travel with the note. |
| `clean_context` | `context:write` | Role-aware cleanup: `analyze` (default, read-only) returns safe mechanical fixes + a worklist the agent executes with the write tools; `apply_fixes` applies the reversible allow-list (attributed to the caller, origin `maintenance`); `trash` soft-deletes with a 7-day restore. Members clean the notes they authored; admins clean the space (with a `structure` block for reorganisation ideas); `path` targets a folder; "Freeze for AI" folders are reported but never touched. |
| `list_connectors` | `context:read` | Admin-configured gateways to external systems: docs, allowed hosts, env var names. |
| `run_connector` | `connectors:use` | JavaScript in that connector's QuickJS isolate (`fetch`, `sql`, `mcp`, `sleep`, `env`, `console`). |

Scopes live in `lib/mcp/scopes.ts` (`TOOL_SCOPES`) — the single map read by both
the transport's `insufficient_scope` challenge (`lib/mcp/challenge.ts`) and
`withCtx`, so the two can never disagree. Scopes are the coarse gate on a token;
per-space membership and grants are still re-derived live on every call.

Reads default to the **shared** brain, writes default to your **personal** one.

Folders marked **"Freeze for AI"** in the Share panel now bind the write gate
for autonomous origins (`agent`, `ai-enrich`, `maintenance`): MCP writes, moves
and enrichment into a locked folder are denied with a clear message, while
human edits (and human-applied refactors) pass. Previously only the review pass
honoured the lock.

## Context awareness

Four behaviours make the write tools context-aware rather than blind
(`lib/mcp/typeCatalog.ts`, `lib/notes/shared/audience.ts`):

- **Identity** — `list_context` returns `you`: the caller's name, whether they
  are a space admin there, and the aliases they hold. Every write is
  attributed to that identity (revision origin `agent`/`mcp`).
- **Types** — `list_context` returns `types`, the space's node-type catalog:
  each type's enabled state (a type gated on a switched-off feature says which
  feature), its exact field keys, its entity-note directory, live usage counts,
  and guidance on how it is created (connector = admin-authored note, event =
  events surface, index = a folder's `index.md`). The vocabulary is **closed** —
  agents pick the best existing type and may only *suggest* a new one in prose.
- **Audience** — each writable folder/note carries a one-line `audience` summary
  computed purely from grant rows (`audienceSummary`): `everyone in <space>`,
  `admins only`, `aliases: A, B + admins`, `restricted — you + admins only`, and
  so on. Aliases are named; individual members are only ever **counted** — the
  function never receives member names, so the summary stays cheap and
  non-enumerating however large the space is.
- **Private by default** — a note *created* in a real space's shared brain
  via `edit_context` or `add_context` is restricted to space admins + the
  author (author gets an explicit FULL grant first, then the note path is
  restricted — the same mechanism as the Share panel's "Make private"). Pass
  `visibility: 'inherit'` to let the note follow its folder instead. Edits of
  existing notes never change sharing; personal-space writes are untouched (they
  are private already); for `add_context` the directory card stays visible to
  everyone — only the note body is gated, and the restrict step failing is
  reported as a non-fatal `visibility_error`, like `note_error`. Space
  admins can always read everything (`principalIsSuperAdmin`), so "the admin can
  access all context" holds by construction.

## How `search_context` ranks

`brainService.searchBrain` → `shared/retrieval.fusedSearch`. Five stages, fused
by weighted Reciprocal Rank Fusion (`STAGE_WEIGHTS`):

1. **Filter** — frontmatter `type`, `tags`, `folder`, `updated_after/before`.
   Exact and cheap; prefer narrowing over hoping the ranking cooperates.
2. **BM25** over note text (`shared/bm25.ts`), title ×3 and tags ×2, AND
   semantics relaxing to OR. Weight 1.0.
3. **Note vectors** — pgvector cosine over `community_note_embeddings`,
   embedded lazily and invalidated by note mtime. Weight 1.0.
4. **Source chunks** — the same cosine over `context_source_chunks` (weight
   0.8), plus a Postgres full-text ranking of the same chunks (weight 0.9).
   BM25 above only ever sees notes, so without the keyword half an upload that
   was never embedded would be unfindable by any means.
5. **Link context** — neighbours of the top-5 BM25 hits, since a mention is an
   edge and the note next door is often the answer. Weight 0.4: these were
   never matched against the query, so they are a recall net, not evidence.

Ties break on the best per-stage score, and cosine hits must clear both a
relative floor (85% of the top hit) and an absolute one (0.55).

**`semantic` in the response says whether stages 3–4 actually ran.** They need
`OPENAI_API_KEY` (`text-embedding-3-small`, truncated to 768 dimensions via the
`dimensions` param); without it the tool
returns `semantic: "no-key"` and the results are keyword + link context only —
reported rather than hidden, because a degraded search is indistinguishable from
a thorough one that found nothing. After setting the key, run `pnpm db:embed`
once to backfill vectors, including source chunks whose embedding failed at
ingest. The HNSW and GIN indexes these queries need are applied by
`pnpm db:migrate` (`prisma/migrations/20260810_add_retrieval_indexes/`).

## Adding a tool

1. Wrap a function that already takes a `BrainPrincipal` and enforces access
   (`brainService.*`) — do not re-implement a route handler's gate in a tool.
2. Register the name in `TOOL_SCOPES`.
3. Update the count assertion in `apps/web/tests/mcp.test.ts` and this table.
