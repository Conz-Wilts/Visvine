# The MCP tool surface

Twelve tools over the context layer, served at `/api/mcp`
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
| `list_communities` | `context:read` | Your communities, your role in each, which is your personal space. Entry point: everything else needs a `community_id`. |
| `list_context` | `context:read` | One community's bearings: entities by type, the note index, and where you can write (`writable_folders` + `writable_notes`). |
| `search_context` | `context:read` | Fused search over notes, uploaded files and directory entities. See below. |
| `read_context` | `context:read` | One entity in full: fields, note markdown, links (with origin), notes that mention it. By `node_id` or `note_path`. |
| `list_files` | `context:read` | The uploaded files in this context, with extraction status. |
| `read_file` | `context:read` | The extracted text of one uploaded file, paged. |
| `add_context` | `context:write` | A typed node + its context note. `person` / `community` (= organisation) / `resource` only. |
| `edit_context` | `context:write` | Create or overwrite one note (history keeps the prior version). Defaults to your **personal** brain. |
| `append_context` | `context:write` | Append a dated, attributed entry to a note's `## Log`. The lossless way to add one fact. |
| `move_context` | `context:write` | Move/rename a note, rewriting every inbound link so the graph survives. |
| `list_connectors` | `context:read` | Admin-configured gateways to external systems: docs, allowed hosts, env var names. |
| `run_connector` | `connectors:use` | JavaScript in that connector's QuickJS isolate (`fetch`, `sql`, `mcp`, `sleep`, `env`, `console`). |

Scopes live in `lib/mcp/scopes.ts` (`TOOL_SCOPES`) — the single map read by both
the transport's `insufficient_scope` challenge (`lib/mcp/challenge.ts`) and
`withCtx`, so the two can never disagree. Scopes are the coarse gate on a token;
per-community membership and grants are still re-derived live on every call.

Reads default to the **shared** brain, writes default to your **personal** one.

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
`GEMINI_API_KEY` (`gemini-embedding-001`, 768 dimensions); without it the tool
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
