// The brain-service core — the port of blackbird-brain's src/server/brainService.ts,
// re-based on Visvine's Prisma note store. The single door for the REST routes,
// the MCP tools, and the internal maintenance passes: every function takes an
// explicit BrainPrincipal, reads apply the folder-visibility lens BEFORE
// search/index building, private-folder reads are audited, and writes go through
// an apply-or-deny gate on the target folder. Personal brains bypass the folder
// layer entirely (owner-only by brain scoping in lib/notes/brain.ts).

import * as store from './store'
import { SHARED_OWNER_KEY, type Brain, type Actor } from './store'
import * as sourceStore from './sourceStore'
import { ingestSource, reingestSource, type IngestInput } from './sources/ingest'
import { logAudit } from './audit'
import { createVectorStage } from './vectorStage'
import { createSourceStage } from './sourceStage'
import { getVault, vaultFor } from './vaultCache'
import { splitFrontmatter } from './shared/markdown'
import { rewriteLinks } from './shared/linkRewrite'
import { fusedSearch, type FusedResult, type SearchFilters } from './shared/retrieval'
import { pathVisibleTo } from './shared/visibility'
import { folderIdOfPath } from './shared/placement'
import {
  principalCanWrite,
  principalIsSuperAdmin,
  principalLevelName,
} from './shared/permissions'
import { isRestrictedPath } from './shared/authz'
import { replicaDenial } from './publications'
import { appendNoteLogEntry, toDateString } from './shared/noteLog'
import type { BrainPrincipal, WriteResult } from './shared/brainTypes'
import type { NoteMeta, NoteRevisionOrigin, RawNote } from './shared/types'
import type { ContextSourceMeta } from './shared/sourceTypes'

function isShared(brain: Brain): boolean {
  return brain.ownerKey === SHARED_OWNER_KEY
}

function actorOf(p: BrainPrincipal): Actor {
  return { id: p.userId, name: p.name, email: p.email || null }
}

/** Whether a shared-brain read of this path must be recorded for compliance:
 *  reads inside a restricted boundary are the sensitive ones. */
function isAuditedRead(p: BrainPrincipal, brain: Brain, path: string): boolean {
  if (p.system || !isShared(brain)) return false
  return isRestrictedPath(p.access.restricted, path)
}

// --- read surface ---------------------------------------------------------------

export interface VisibleVault {
  raws: RawNote[]
  metas: NoteMeta[]
}

/**
 * The visibility-filtered vault. The index is rebuilt over only the visible raws,
 * so a link into a folder the caller can't read degrades to an unresolved link —
 * no title leak. Personal brains (and admins) see everything unfiltered.
 * Served from the per-brain vault memo (lib/notes/vaultCache.ts), so the routes
 * that fan out on a Context-tab open share one corpus load and one index build.
 */
export async function visibleVault(p: BrainPrincipal, brain: Brain): Promise<VisibleVault> {
  return vaultFor(await getVault(brain), p, brain)
}

/** Whether the principal may read one note path in this brain. */
export function canReadPath(p: BrainPrincipal, brain: Brain, path: string): boolean {
  return !isShared(brain) || pathVisibleTo(path, p)
}

/**
 * Read one note through the lens; returns null when absent or inaccessible
 * (indistinguishable, so nothing leaks). Private-folder reads are audited.
 */
export async function readVisible(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
): Promise<string | null> {
  if (!canReadPath(p, brain, path)) return null
  let content: string
  try {
    content = await store.readNote(brain, path)
  } catch {
    return null
  }
  if (isAuditedRead(p, brain, path)) {
    void logAudit(p.communityId, { userId: p.userId, name: p.name, action: 'read', path })
  }
  return content
}

/**
 * Fused search (frontmatter filter → BM25 → pgvector → link graph, RRF) over
 * everything the principal can read in this brain. Private-folder hits are audited.
 */
export async function searchBrain(
  p: BrainPrincipal,
  brain: Brain,
  query: string,
  filters: SearchFilters = {},
  k?: number,
): Promise<FusedResult[]> {
  const { raws, metas } = await visibleVault(p, brain)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  const notes = metas.map((meta) => ({ meta, body: bodyByPath.get(meta.path) ?? '' }))
  // Context-source chunks rank alongside notes, over only the VISIBLE (and
  // folder-filtered) source paths — the lens applies before the stage exists.
  const sourcePaths = (await sourceStore.listSources(brain))
    .filter((s) => s.status === 'ready' && canReadPath(p, brain, s.path))
    .filter((s) => filters.folderId === undefined || folderIdOfPath(s.path) === filters.folderId)
    .map((s) => s.path)
  const hits = await fusedSearch(notes, query, filters, {
    k,
    vector: createVectorStage(brain),
    sources: createSourceStage(brain, sourcePaths),
  })
  for (const h of hits) {
    if (isAuditedRead(p, brain, h.path)) {
      void logAudit(p.communityId, { userId: p.userId, name: p.name, action: 'read', path: h.path })
    }
  }
  return hits
}

// --- write gate -----------------------------------------------------------------

/**
 * The write gate. Personal brains are always writable by their owner (scoping
 * guarantees the caller IS the owner). Shared-brain writes require EDIT level
 * at the target path — a grant that reaches it (through any restricted cuts)
 * at edit or full. Returns null when allowed, else the denial reason.
 */
export function writeDenial(p: BrainPrincipal, brain: Brain, path: string): string | null {
  if (!isShared(brain)) return null
  if (principalCanWrite(p, path)) return null
  const level = principalLevelName(p, path)
  const where = folderIdOfPath(path) || 'the brain root'
  return level
    ? `You have ${level} access in "${where}" — edit access is required.`
    : `You don't have access to write in "${where}".`
}

/**
 * The full async write check: the folder gate plus the replica block — an
 * ACTIVE publication target is read-only in its destination (the next source
 * save would clobber any local edit). Every content write goes through this.
 */
export async function writeDenialFull(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
): Promise<string | null> {
  const denial = writeDenial(p, brain, path)
  if (denial) return denial
  if (isShared(brain)) return replicaDenial(brain.communityId, path)
  return null
}

/** Gated whole-note write, recording revision history. */
export async function writeGated(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
  content: string,
  origin: Parameters<typeof store.writeNote>[4] = 'edit',
  model?: string,
): Promise<WriteResult> {
  const denial = await writeDenialFull(p, brain, path)
  if (denial) return { status: 'denied', reason: denial }
  await store.writeNote(brain, path, content, actorOf(p), origin, model)
  return { status: 'applied', path }
}

/**
 * Gated dated `## Log` append (creating the section when absent). AI/agent
 * appends pass `origin`/`model` so the revision AND the log entry's role are
 * stamped with how the entry arose — human vs AI edits stay distinguishable.
 */
export async function appendLogGated(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
  entry: string,
  origin: NoteRevisionOrigin = 'edit',
  model?: string,
): Promise<WriteResult> {
  const denial = await writeDenialFull(p, brain, path)
  if (denial) return { status: 'denied', reason: denial }
  const current = await store.readNote(brain, path)
  const role =
    origin === 'edit' || origin === 'restore'
      ? roleLabel(p, brain, path)
      : model
        ? `ai: ${model}`
        : origin
  const md = appendNoteLogEntry(current, {
    date: toDateString(Date.now()),
    actor: p.name,
    role,
    summary: entry,
  })
  await store.writeNote(brain, path, md, actorOf(p), origin, model)
  return { status: 'applied', path }
}

/** The authority label stamped into `## Log` entries. */
function roleLabel(p: BrainPrincipal, brain: Brain, path: string): string {
  if (p.system) return 'maintenance'
  if (!isShared(brain)) return 'owner'
  if (principalIsSuperAdmin(p)) return 'admin'
  return principalLevelName(p, path) ?? 'member'
}

// --- move (gated on BOTH ends, inbound links rewritten) ---------------------------

/**
 * Move/rename a note within a brain: gated on write access to the source and the
 * destination folder, then every inbound link in the brain is rewritten to the
 * new path so nothing breaks. Returns the new path or a denial.
 */
export async function moveGated(
  p: BrainPrincipal,
  brain: Brain,
  from: string,
  to: string,
): Promise<WriteResult> {
  for (const end of [from, to]) {
    const denial = writeDenial(p, brain, end)
    if (denial) return { status: 'denied', reason: denial }
  }
  const moved = await store.renameNote(brain, from, to)
  await rewriteInboundLinks(brain, from, moved)
  if (isShared(brain)) {
    void logAudit(p.communityId, {
      userId: p.userId,
      name: p.name,
      action: 'move',
      path: moved,
      detail: `from ${from}`,
    })
  }
  return { status: 'applied', path: moved }
}

// --- context sources (non-note files/tables; same gate + lens as notes) ----------

/** The sources the principal may see, optionally restricted to one top-level folder. */
export async function listVisibleSources(
  p: BrainPrincipal,
  brain: Brain,
  folderId?: string,
): Promise<ContextSourceMeta[]> {
  const all = await sourceStore.listSources(brain)
  return all
    .filter((s) => canReadPath(p, brain, s.path))
    .filter((s) => folderId === undefined || folderIdOfPath(s.path) === folderId)
}

/** Gated upload + ingestion of a new source file. */
export async function createSourceGated(
  p: BrainPrincipal,
  brain: Brain,
  input: IngestInput,
): Promise<WriteResult & { source?: ContextSourceMeta }> {
  const denial = writeDenial(p, brain, input.path)
  if (denial) return { status: 'denied', reason: denial }
  const source = await ingestSource(brain, input)
  if (isShared(brain)) {
    void logAudit(p.communityId, {
      userId: p.userId,
      name: p.name,
      action: 'write',
      path: source.path,
      detail: `source upload (${source.kind}, ${source.sizeBytes} bytes)`,
    })
  }
  return { status: 'applied', path: source.path, source }
}

/**
 * A page of a source's extracted text (concatenated chunks) through the lens.
 * Private-folder reads are audited exactly like note reads.
 */
export async function readSourceVisible(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
  opts: { offsetChars?: number; maxChars?: number } = {},
): Promise<{ meta: ContextSourceMeta; text: string; totalChars: number } | null> {
  if (!canReadPath(p, brain, path)) return null
  const row = await sourceStore.findSource(brain, path)
  if (!row) return null
  const full = (await sourceStore.listChunkTexts(row.id)).join('\n\n')
  if (isAuditedRead(p, brain, path)) {
    void logAudit(p.communityId, { userId: p.userId, name: p.name, action: 'read', path })
  }
  const offset = Math.max(0, opts.offsetChars ?? 0)
  const max = Math.max(1, opts.maxChars ?? 20_000)
  const meta = (await sourceStore.getSource(brain, path))!
  return { meta, text: full.slice(offset, offset + max), totalChars: full.length }
}

/** Gated hard delete of a source (row, chunks, and the GCS object). */
export async function deleteSourceGated(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
): Promise<WriteResult> {
  const denial = writeDenial(p, brain, path)
  if (denial) return { status: 'denied', reason: denial }
  const existed = await sourceStore.deleteSource(brain, path)
  if (!existed) return { status: 'denied', reason: `No source at: ${path}` }
  if (isShared(brain)) {
    void logAudit(p.communityId, {
      userId: p.userId,
      name: p.name,
      action: 'delete',
      path,
      detail: 'source delete',
    })
  }
  return { status: 'applied', path }
}

/** Gated re-ingestion (retry after failure / embedding-model change). */
export async function reingestSourceGated(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
): Promise<WriteResult & { source?: ContextSourceMeta }> {
  const denial = writeDenial(p, brain, path)
  if (denial) return { status: 'denied', reason: denial }
  const source = await reingestSource(brain, path)
  if (!source) return { status: 'denied', reason: `No source at: ${path}` }
  return { status: 'applied', path, source }
}

/** Rewrite every note that links to `fromPath` so it points at `toPath`. */
async function rewriteInboundLinks(
  brain: Brain,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const raws = await store.listRaw(brain)
  const targets = new Set([fromPath, fromPath.replace(/\.md$/i, '')])
  for (const raw of raws) {
    if (raw.path === toPath || raw.path === fromPath) continue
    const { frontmatter, body } = splitFrontmatter(raw.content)
    const next = rewriteLinks(body, raw.path, (t) => (targets.has(t) ? toPath : null))
    if (next !== body) {
      const content = frontmatter !== null ? `---\n${frontmatter}\n---\n\n${next}` : next
      await store.writeNote(brain, raw.path, content, { id: 'system', name: 'Link maintenance' })
    }
  }
}
