// The brain-service core — the port of blackbird-brain's src/server/brainService.ts,
// re-based on Visvine's Prisma note store. The single door for the REST routes,
// the MCP tools, and the internal maintenance passes: every function takes an
// explicit BrainPrincipal, reads apply the folder-visibility lens BEFORE
// search/index building, private-folder reads are audited, and writes go through
// an apply-or-deny gate on the target folder. Personal brains bypass the folder
// layer entirely (owner-only by brain scoping in lib/notes/brain.ts).

import * as store from './store'
import { SHARED_OWNER_KEY, type Brain, type Actor } from './store'
import { logAudit } from './audit'
import { createVectorStage } from './vectorStage'
import { buildNoteIndex } from './shared/graph'
import { splitFrontmatter } from './shared/markdown'
import { rewriteLinks } from './shared/linkRewrite'
import { fusedSearch, type FusedResult, type SearchFilters } from './shared/retrieval'
import { filterVisible, pathVisibleTo } from './shared/visibility'
import { folderIdOfPath } from './shared/placement'
import { folderById, memberLevel, principalCanWrite, principalIsSuperAdmin } from './shared/permissions'
import { appendNoteLogEntry, toDateString } from './shared/noteLog'
import type { BrainPrincipal, WriteResult } from './shared/brainTypes'
import type { NoteMeta, RawNote } from './shared/types'

function isShared(brain: Brain): boolean {
  return brain.ownerKey === SHARED_OWNER_KEY
}

function actorOf(p: BrainPrincipal): Actor {
  return { id: p.userId, name: p.name, email: p.email || null }
}

/** Whether a shared-brain read of this path must be recorded for compliance. */
function isAuditedRead(p: BrainPrincipal, brain: Brain, path: string): boolean {
  if (p.system || !isShared(brain)) return false
  const folder = folderById(p.folders, folderIdOfPath(path))
  return folder?.visibility === 'private'
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
 */
export async function visibleVault(p: BrainPrincipal, brain: Brain): Promise<VisibleVault> {
  const raws = await store.listRaw(brain)
  if (!isShared(brain)) {
    return { raws, metas: buildNoteIndex(raws) }
  }
  const visible = filterVisible(raws, p)
  return { raws: visible, metas: buildNoteIndex(visible) }
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
  const hits = await fusedSearch(notes, query, filters, { k, vector: createVectorStage(brain) })
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
 * guarantees the caller IS the owner). Shared-brain writes are gated on the
 * target folder: registered folders enforce membership levels, unregistered
 * ones keep Visvine's member-writable default. Returns null when allowed, else
 * the denial reason.
 */
export function writeDenial(p: BrainPrincipal, brain: Brain, path: string): string | null {
  if (!isShared(brain)) return null
  const folderId = folderIdOfPath(path)
  if (principalCanWrite(p, folderId)) return null
  const folder = folderById(p.folders, folderId)
  const level = folder ? memberLevel(folder, p.userId) : undefined
  return level
    ? `You have ${level} access to "${folder!.name}" — write access is required.`
    : `You don't have write access to "${folder?.name ?? folderId}".`
}

/** Locked folders are frozen for AI maintenance passes (review fixes, enrichment). */
export function isFrozenForMaintenance(p: BrainPrincipal, path: string): boolean {
  return folderById(p.folders, folderIdOfPath(path))?.locked === true
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
  const denial = writeDenial(p, brain, path)
  if (denial) return { status: 'denied', reason: denial }
  await store.writeNote(brain, path, content, actorOf(p), origin, model)
  return { status: 'applied', path }
}

/** Gated dated `## Log` append (creating the section when absent). */
export async function appendLogGated(
  p: BrainPrincipal,
  brain: Brain,
  path: string,
  entry: string,
): Promise<WriteResult> {
  const denial = writeDenial(p, brain, path)
  if (denial) return { status: 'denied', reason: denial }
  const current = await store.readNote(brain, path)
  const role = roleLabel(p, brain, path)
  const md = appendNoteLogEntry(current, {
    date: toDateString(Date.now()),
    actor: p.name,
    role,
    summary: entry,
  })
  await store.writeNote(brain, path, md, actorOf(p))
  return { status: 'applied', path }
}

/** The authority label stamped into `## Log` entries. */
function roleLabel(p: BrainPrincipal, brain: Brain, path: string): string {
  if (p.system) return 'maintenance'
  if (!isShared(brain)) return 'owner'
  if (principalIsSuperAdmin(p)) return 'admin'
  const folder = folderById(p.folders, folderIdOfPath(path))
  return (folder && memberLevel(folder, p.userId)) ?? 'member'
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

/** Rewrite every note that links to `fromPath` so it points at `toPath`. */
export async function rewriteInboundLinks(
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
