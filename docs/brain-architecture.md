# The Visvine Brain — Context feature architecture

> How blackbird-brain's knowledge-store architecture was integrated into Visvine's
> **Context** tab (the notes feature), what was kept from each side, and how the
> combined system works. Produced during the July 2026 integration session; the
> full decision log and session record live in
> [brain-integration-log.md](./brain-integration-log.md).

## 1. What the brain is

Every community in Visvine has exactly **one brain**: a store of markdown notes
with YAML frontmatter, connected by standard OKF markdown links
(`[text](/path.md)`), explorable as a force-directed context, with backlinks,
related-notes, revision history, trash, pins, and AI assist. A brain is the
`ownerKey='shared'` row-space of `(communityId, ownerKey)`.

**Your personal context lives in your personal-space community** (`me:<userId>`,
the private single-member Community created at onboarding) — its Context page
IS your personal brain. There are no per-community personal brains. Only you
can enter your personal space (`communityReadForbidden` guards it), so the
whole brain is yours.

**Community brains are private by default.** The registry's root entry (folder
id `''`) is the *brain gate*: joining a community does **not** grant brain
access. When the gate first materializes, current members are grandfathered
(write; community admins get admin); anyone who joins later sees nothing until
a root/folder admin grants access or approves their request.

Knowledge moves **up the tree**: capture privately in your space → distill /
promote (a one-time provenance-stamped copy) into any community's brain, with
gating and audit at the boundary.

```
community brain (one per community)
├── ROOT GATE ('')    ← who can access the brain at all (grandfathered members;
│                       new joiners request access)
├── deals/            ← REGISTERED folder — refines the root: its own members,
│                       public or private 🔒
└── …unregistered/    ← governed by the root gate

your personal space (me:<userId> community) ← your whole private brain;
                       capture log lives at log/YYYY-MM.md

## 2. What came from where

| Capability | Source | Adaptation |
|---|---|---|
| Note store (rows, revisions, trash, folders, pins) | Visvine (`CommunityNote*`, `lib/notes/store.ts`) | unchanged — already a faithful port of blackbird's vault/history |
| Community + shared/personal scoping, session auth | Visvine | unchanged |
| Directory-entity ↔ note bridge (`people/<slug>.md`) | Visvine (`lib/notes/entities.ts`) | unchanged |
| Folder permission tree (levels, visibility, registry) | blackbird (`permissions.ts`, `visibility.ts`, `folders.ts`) | members keyed by **userId** (not email); registry in DB sidecar; **unregistered folders stay open** (see §4) |
| Principal-gated service core ("one door") | blackbird (`brainService.ts`) | re-based on Prisma store; REST + MCP + maintenance all share it |
| Fused retrieval (BM25 → vector → context, RRF) | blackbird (`retrieval.ts`, `search.ts`) | vector stage re-backed by **pgvector** (was a JSON sidecar) |
| Embeddings (`gemini-embedding-001`, 768-dim) | blackbird (`embeddings.ts`) | same OpenAI-compatible endpoint config as Visvine's existing `lib/notes/ai.ts` |
| Join requests, promotion proposals, read audit | blackbird (`joinRequests.ts`, `brainAudit.ts`) | JSONL records in the DB sidecar |
| Quick capture + `## Log` stamping | blackbird (`capture.ts`, `contextLog.ts`) | personal log at `log/YYYY-MM.md` |
| Review agent (checks + reversible auto-fixes) | blackbird (`review.ts`) | schema checks adapted to Visvine frontmatter (`type`/`title`/`timestamp`/`description`) |
| Enrichment (abstract personal → shared insight) | blackbird (`enrichment.ts`) | **privacy re-scope**: runs only over the *caller's own* personal brain (see §4) |
| MCP tool surface | blackbird (`brainMcp.ts`) | mounted on Visvine's existing OAuth 2.1 MCP server under `content:read/write` scopes |
| AI refactor / reorganize | both (already ported) | unchanged |

**Deliberately not ported** (and why):

- **Managed Agents (Anthropic beta API)** — Visvine's MCP server already gives
  external agents governed access to the brain; an embedded agent runner +
  streaming UI is a separate product decision.
- **The always-on nightly scheduler** — a serverless Next.js deployment has no
  resident process. Review and enrichment run on demand from the UI (or can be
  triggered by an external cron hitting the same routes).
- **The full self-improve pipeline** — depends on the scheduler and heavy admin
  UI. Its safety trust boundaries (`preserve.ts` fact-preservation,
  `coerceOps`) are the pieces to port first if this is revisited.
- **sql.js storage / Electron bridge / blackbird auth** — superseded by
  Postgres/Prisma and Visvine sessions.

## 3. Data model

Two new tables (Prisma, `apps/web/prisma/schema.prisma`):

- **`CommunityBrainFile`** `(communityId, ownerKey, name) → content` — the DB
  port of blackbird's `.brain/` control sidecar. Files in use:
  `folders.json` (the shared brain's folder registry), `audit.jsonl`
  (read-audit + governance trail), `join-requests.jsonl`,
  `move-proposals.jsonl` (queued promotions), `enrichment-state.json`
  (per-personal-brain sha256 ledger).
- **`CommunityNoteEmbedding`** `(communityId, ownerKey, path) → vector(768)` —
  cached whole-note embeddings (pgvector, finally in use). `mtime` mirrors the
  note's `updatedAt`; a mismatch marks the row stale and it re-embeds lazily on
  the next search. Written/read via raw SQL (Prisma can't type `vector`).

## 4. The permission model (and where it deviates from blackbird)

Pure predicates in `lib/notes/shared/permissions.ts` + `visibility.ts`; the
registry shape in `shared/brainTypes.ts`.

- The **root gate** (registry entry with folder id `''`) governs the whole
  brain: any path not under a registered folder falls back to it, and having no
  entry in it means seeing nothing. `ensureBrainGate` materializes it on first
  touch, grandfathering current members (write) and community admins (admin) —
  so an existing community never locks itself out, and *members who join later
  are gated by default* (this is blackbird's "no file, no access", arriving
  softly). Only with no root entry at all does the legacy member-open behavior
  apply (personal spaces — never gated).
- A **registered folder** (top-level path segment) refines the root:
  `visibility: public|private` and members with `read ⊂ write ⊂ admin`.
  Public → every gated-in member reads, write+ members change it. Private →
  its own members only; others can **request to join** (folder admin approves
  → read). A join request on folder id `''` is a request for brain access.
- **Community admins** (and the internal system principal) bypass all gates.
- **Deviation — enrichment privacy:** blackbird's nightly pass reads *all*
  users' personal spaces as a system principal. In multi-tenant Visvine that
  would violate the personal-space contract, so enrichment runs only when a
  user triggers it **over their own personal space**, writing into the chosen
  community through the gate *as them* (one enrichment ledger per target
  community).
- The **visibility lens** (`filterVisible`) is applied *before* index/context/
  search construction, so a link into a folder you can't read degrades into an
  unresolved link — titles never leak. Reads of private-folder notes are
  recorded to `audit.jsonl`.

## 5. The one door: `lib/notes/brainService.ts`

Every surface — REST routes, MCP tools, and the internal maintenance passes —
calls the same functions, each taking an explicit `BrainPrincipal` (identity is
never implicit):

- Reads: `visibleVault` (lens-filtered raws + index), `readVisible`
  (null for absent *and* inaccessible — indistinguishable), `searchBrain`.
- Writes: `writeGated` / `appendLogGated` / `moveGated` — apply-or-deny
  (`WriteResult`), with `## Log` role attribution and inbound-link rewriting on
  moves.

## 6. Retrieval

`searchBrain` runs blackbird's fused stack (`shared/retrieval.ts`):

1. **Frontmatter filter** (type / folder / tags / mtime bounds) — cheapest, most precise.
2. **BM25** (`shared/bm25.ts`) — field-boosted (title 3×, tags/aliases 2×),
   light plural stemming, AND relaxing to OR.
3. **Vector stage** (`lib/notes/vectorStage.ts`) — pgvector cosine over cached
   whole-note embeddings; stale notes embed lazily (≤100/query, one round-trip
   with the query embedding); relative floor 0.85 keeps noise out of fusion;
   any failure/unconfigured key returns `[]`.
4. **Context expansion** — link neighborhood of the top BM25 hits.

Stages fuse by Reciprocal-Rank Fusion (k=60). No key configured → BM25 + context,
silently.

## 7. Knowledge flows

- **Capture** (`lib/notes/capture.ts`): one-liner from anywhere → dated,
  attributed line in `log/YYYY-MM.md` of your PERSONAL SPACE (provisioned on
  demand), whatever community you captured from. Note-bound capture appends a
  `## Log` entry through the gate.
- **Promote / share** (`lib/notes/promote.ts`): a note from your personal
  space → any community's brain, as a **one-time copy** (the personal original
  stays yours; the shared copy evolves in the community). Write access →
  applies immediately (provenance-stamped `sources: brain:me:<userId>/…`,
  audited). No write access → queued in the target's `move-proposals.jsonl`
  for a folder admin, who approves/denies; approval writes the snapshot.
- **Enrich** (`lib/notes/enrich.ts`): LLM pass over your personal space —
  *synthesise, never copy* — proposing `new_note` or `append_log` outputs into
  a chosen community, guardrail-coerced (`shared/enrichment.ts`),
  provenance-stamped, applied through the gate as you. Idempotent via a
  per-target-community sha256 ledger.
- **Review** (`lib/notes/reviewRun.ts` + `shared/review.ts`): health checks
  (broken links, orphans, staleness, schema gaps, unlinked mentions; full mode
  adds duplicates + oversized). Safe reversible fixes are allow-listed and
  revision-recorded; everything else is a finding for a human. Locked folders
  are frozen.

## 7b. Context Sources (non-note knowledge)

Uploaded files/tables (v1: csv, md, txt; ≤5 MB) attached to a brain **without
becoming context Nodes** — they live only in the Context. A source is keyed
`(communityId, ownerKey, path)` exactly like a note (`deals/pricing.csv`), so
the folder gate, visibility lens, and read audit govern it unchanged; `.md`
uploads are stored as `.markdown` to keep the note namespace disjoint.

- **Data**: `ContextSource` (metadata + GCS pointer + status) and
  `ContextSourceChunk` (extracted text chunks + pgvector embeddings). Original
  file in `GCS_RESOURCES_BUCKET` under `context-sources/…`; storage degrades to
  off when unconfigured (chunks still serve read/search, no download URL).
- **Ingestion** (`lib/notes/sources/ingest.ts`, in-request): extract
  (`sources/extract.ts` — the pdf/xlsx extension seam) → chunk
  (`shared/chunking.ts`: prose ~1.5k chars with overlap; CSV rows with repeated
  header context; caps 500k chars / 300 chunks, `truncated` flagged) → embed
  (batched) → `ready`/`failed` (+ gated `reingest` retry).
- **Retrieval**: `searchBrain` passes a chunk-vector stage
  (`lib/notes/sourceStage.ts`) over the caller's visible source paths into the
  RRF fusion; hits come back as `FusedResult{kind:'source', seq}`. No BM25 over
  chunks in v1 (extension point: Postgres FTS). Note/type/tag filters skip
  sources.
- **Surfaces**: REST `app/api/notes/sources` (+ `/item`); MCP
  `brain_sources_list` / `brain_source_read` (paged, audited), source hits in
  `brain_search`; UI Sources section in the context tree + `SourcePreviewPanel`
  at `/directory/source/<path>`.

**AI-write labeling**: every AI/agent write path now stamps revisions —
`ai-refactor` (editor AI), `ai-enrich` (enrichment), `agent` (MCP writes, model
`mcp`), `maintenance` (review auto-fixes) — and AI `## Log` appends carry an
`ai: <model>` role, so human vs AI edits stay distinguishable end to end.

## 8. Surfaces

- **REST** — `app/api/notes/*`: existing CRUD routes now lens reads and gate
  writes; new routes: `search`, `registry`, `join-requests`, `promote`,
  `capture`, `review`, `ai/enrich`, `audit`.
- **MCP** — `lib/mcp/tools/brain.ts` on the existing OAuth server
  (`content:read|write` scopes): `brain_search`, `brain_read`, `brain_index`,
  `brain_backlinks`, `brain_write`, `brain_append_log`, `brain_capture`,
  `brain_folders`. Same principal + gate as the UI.
- **UI** — `features/notes/`: server-powered fused search, folder access
  management (register/visibility/members/lock/join requests), promote dialog,
  quick capture, brain-health panel (review + fixes + proposals + audit +
  enrichment trigger).

## 9. Configuration

| Env | Effect |
|---|---|
| `GEMINI_API_KEY` (or `GEMMA_API_KEY` + `GEMMA_BASE_URL`) | chat AI (refactor/reorganize/enrich) **and** the embeddings vector stage |
| `EMBED_MODEL` | override the embedding model (default `gemini-embedding-001`, 768-dim) |

Everything AI degrades to off when unconfigured; the brain runs fully as a
linked, permissioned, BM25-searchable store without any keys.

## 10. Testing & verification

Pure modules carry `node:test` suites in `apps/web/tests/`
(`brain-permissions`, `brain-retrieval`, `brain-maintenance` — 41 tests;
full suite 167/167 green; `tsc --noEmit` clean).

The full loop was also exercised end-to-end against the dev server with the two
seeded users: capture → personal log; gated shared create; fused search with
snippets; registering `deals` as private (member's reads 404/vanish from
search, writes 403); join request → admin approve → read granted, write still
denied; promote → proposal → admin approve → provenance-stamped note in the
folder; review dry-run reporting fixes/issues; audit trail recording private
reads, folder governance, and promotions.

## 11. Known limitations

- **Private folders are invisible to non-members** (matching blackbird's
  `list_folders`: public + private-you-belong-to). A non-member therefore can't
  discover a private folder in the UI to request access — they need the folder
  id (e.g. told out-of-band). Brain-level access is different: the registry's
  `gate` field lets the UI offer "request brain access" to gated-out members.
- **Deploy note:** run `node apps/web/scripts/migrate-personal-brains.mjs
  --apply` once against any database that predates the personal-space
  restructure (it moves old per-community personal notes into each user's
  `me:<userId>` community; idempotent, dry-run by default).
- **Orphan check flags root/index notes too** — any note with zero backlinks is
  reported, including a vault's own entry note.
- **Vector stage requires an embeddings key** — without `GEMINI_API_KEY`/
  `GEMMA_*`, search silently runs BM25 + context only (by design).
- **Review/enrichment are on-demand** — schedule them by hitting the routes
  from an external cron if desired.
