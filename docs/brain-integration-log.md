# Brain integration — session & decision log

> Record of the working session (2026-07-08) that integrated the architecture and
> features of the `blackbird-brain/` reference app into Visvine's **Context**
> feature. Companion to [brain-architecture.md](./brain-architecture.md).

## The brief

> "I've added a `blackbird-brain/` that has exactly the functionality I want for
> the context brain feature in my Visvine app. Please take the architecture and
> features of that brain and integrate them into my context tag. Be smart about
> this — work out how to get the best of both worlds to create the best possible
> brain/context infrastructure for our app. Once you've come up with a plan, keep
> working until you've fully executed it. Finally, please document all the chat."

## How the session ran

1. **Recon (parallel).** Two exploration agents mapped the codebases end-to-end:
   one produced a complete architecture report of `blackbird-brain/web`
   (storage layers, the brain-service core, permission/visibility model, fused
   retrieval, capture→enrichment→review pipelines, managed agents, MCP surface,
   test layout); the other mapped Visvine (stack, Prisma schema, the existing
   `/context` notes port, auth/session model, MCP OAuth server, conventions).
2. **Key discovery.** Visvine's Context tab already *was* a partial port of
   blackbird-brain (`CommunityNote*` tables + `lib/notes/store.ts` +
   `lib/notes/shared/*` mirror blackbird's vault/history/pure pipeline; the
   header comment in `app/(auth)/context/page.tsx` says so). The task therefore
   became: **complete the port** — bring over the knowledge-infrastructure
   layers the first pass dropped (retrieval, permissions, governance,
   capture/enrichment/review, MCP tools) — rather than start over.
3. **Plan.** Keep Visvine's multi-tenant store/auth/UI/MCP; port blackbird's
   permission tree, one-door service core, fused retrieval (re-based on the
   provisioned-but-unused pgvector), governance sidecar, capture/promote/
   enrich/review, and MCP tool surface. Skip Managed Agents, the resident
   scheduler, self-improve, and all Electron/sql.js machinery.
4. **Execution.** Schema first (two new tables), then the pure shared layer,
   then the server layer (one door + runners) — written directly. Routes, MCP
   tools, UI, and tests were then fanned out to four parallel implementation
   agents with fixed file-ownership boundaries and the REST contracts specified
   up front. Typecheck + full test suite gates at the end.
5. **Documentation** — this pair of files.

## Decisions (with reasoning)

| # | Decision | Why |
|---|---|---|
| 1 | **Complete the existing port** instead of replacing `lib/notes` with blackbird's code | The store/pure-pipeline halves were already faithfully ported and DB-backed; blackbird's own architecture notes say the service layer sits cleanly on any store that implements the same surfaces. |
| 2 | Sidecar as **one generic table** (`CommunityBrainFile`) mirroring `.brain/` files | Ports the whole control-plane subsystem (registry, audit, join requests, proposals, ledger) with one schema addition; JSONL/JSON parsing stays in one module (`lib/notes/sidecar.ts`), matching blackbird's `brainStore.ts` shape. |
| 3 | Vector cache in **pgvector**, not a JSON blob | Visvine runs `pgvector/pgvector:pg16` and the schema already enables the extension (semantic search was removed earlier — `git 0d33b08`). Cosine ranking in SQL scales past blackbird's in-memory single-user assumption. This is the clearest "best of both worlds" move. |
| 4 | Folder members keyed by **userId**, registry per community | Visvine has stable user ids and multi-tenant scoping; blackbird's email-keyed, single-tenant `folders.yaml` doesn't. Name/email are stored as display snapshots only. |
| 5 | **Unregistered folders stay open** (inverts blackbird's "no file, no access") | Visvine ships with an open shared brain; flipping the default would lock existing communities out of their own notes on deploy. Registration = opting into enforcement, folder by folder. Community admins always bypass. |
| 6 | **Enrichment reads only the caller's own personal brain** | Blackbird's system-principal sweep over *all* personal spaces is fine on a personal machine, but violates Visvine's personal-space privacy contract (enforced elsewhere by `communityReadForbidden`). The pass runs on demand, as the user, through the write gate. |
| 7 | Promotion = gated write **+ proposal queue** | Preserves blackbird's "knowledge moves up, admin decides where shared knowledge lives" without blocking members who lack write access — their promotion parks as a reviewable proposal. |
| 8 | **No resident scheduler**; review/enrich are on-demand routes | Serverless Next.js has no long-lived process. The routes are cron-callable if a schedule is wanted later. |
| 9 | **Managed Agents not ported** | Heavy beta-API dependency + streaming UI; Visvine's existing OAuth MCP server already provides governed external-agent access to the brain — same capability, existing infrastructure. |
| 10 | MCP brain tools mounted on the **existing** `/api/mcp` OAuth server under `content:*` scopes | Two-layer enforcement (scope + live membership) already exists there; blackbird's separate MCP server would duplicate it. |
| 11 | Review schema checks target Visvine's OKF frontmatter (`type`/`title`/`timestamp`/`description`) | The port's frontmatter contract differs from blackbird's (`created`/`updated`/`status`/`review_by`); checks were adapted rather than transplanted. |
| 12 | Search: BM25 module added **alongside** the existing simple search | The lightweight client-side quick search stays for the palette; the fused stack (BM25 + vector + graph, RRF) powers the server search route. |

## Incidents / drift encountered

- The local dev database predated two already-committed schema changes
  (`links.pair_key`; dropped messaging/intro tables + `persons.open_to_work`).
  `pair_key` was backfilled manually (`LEAST||'|'||GREATEST`, no duplicate
  identities found), then `prisma db push --accept-data-loss` synced the rest.
  Nothing related to the brain work; `app_backup.local.sql` exists at the repo
  root.

## Follow-up restructure (same session, user-directed)

After the initial integration the user redirected the scoping model. Confirmed
via three questions, then rebuilt:

1. **One personal brain, in your personal community.** Per-community personal
   brains removed; a user's personal context is the brain of their
   personal-space community (`me:<userId>`), provisioned on demand
   (`resolvePersonalBrain`). The workspace Personal/Shared toggle is gone —
   which brain you're in is just which community's Context page you're on.
   The API `scope` parameter is accepted-and-ignored for compatibility.
2. **Community brains admin-gated by default.** The registry root entry
   (folder id `''`) is the brain gate, materialized on first touch by
   `ensureBrainGate` with current members grandfathered (write; admins admin).
   Users who join later see nothing until granted access (or their join
   request on folder `''` is approved). This re-adopts blackbird's
   "no file, no access" — the earlier open-by-default compromise was replaced
   at the user's direction, with grandfathering as the no-breakage mechanism.
3. **Sharing = one-time promote (copy).** Cross-community: personal space →
   target community brain, provenance-stamped `brain:me:<userId>/<path>`; the
   personal original stays. Live sync explicitly deferred.
4. Capture always lands in the personal space log; enrichment distills the
   personal space into a chosen community (ledger per target community).
5. Migration script `apps/web/scripts/migrate-personal-brains.mjs`
   (dry-run/--apply, local-guarded, idempotent): flips personal-community
   personal rows to `shared`, moves normal-community personal notes to
   `me:<userId>` under `imported/<community-slug>/…`, moves folder rows,
   drops stale personal sidecars + embeddings. Local DB had zero personal
   rows, so the local run was a validated no-op; run with `--apply` against
   prod data when deploying.

## Verification

- `tsc --noEmit`: clean. `pnpm test`: 167/167 (41 new brain tests).
- Live end-to-end smoke against the dev server (`admin@local.dev` /
  `member@local.dev`, `community:local-dev`): capture, gated create, fused
  search, private-folder registration (read hidden + write 403 for
  non-members), join-request approve (read granted, write still denied),
  promotion proposal → admin approval → provenance-stamped shared note,
  review dry-run (2 auto-fixes, 4 issues on the fixture notes), audit trail
  (private reads + folder governance + promotions). Smoke artifacts were
  removed from the local DB afterwards.

## What landed

See [brain-architecture.md](./brain-architecture.md) §2–§8 for the full map:
schema (2 tables), `lib/notes/shared/` (brainTypes, placement, permissions,
visibility, bm25, retrieval, linkRewrite, noteLog, review, enrichment),
`lib/notes/` (sidecar, registry, principal, audit, joinRequests, brainService,
embeddings, vectorStage, capture, promote, enrich, reviewRun), new + gated REST
routes, MCP brain tools, UI (search / folder access / promote / capture / brain
health), and `node:test` suites for the pure modules.
