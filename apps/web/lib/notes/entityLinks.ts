// Context-driven graph links: an entity context note (people/<slug>.md or
// companies/<slug>.md, shared brain only) that mentions another entity via
// `[[Name]]` owns a real directory Link between the two nodes — relationship
// 'mentioned', origin 'context', originRef = the note's path. Saving a note
// syncs its mention set; removing a mention (or trashing/renaming the note)
// removes the link, unless the counterpart's note still mentions back, in which
// case ownership re-points to the counterpart instead of dropping the edge.
// Manual links are never touched: upsertLink's provenance rules mean a manual
// edge absorbs a context write without demotion, and stale-cleanup only deletes
// rows whose origin is 'context'.
//
// Called best-effort from the note store (lib/notes/store.ts) — a sync failure
// must never fail the save itself.

import { revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { upsertLink } from '@/lib/graph/links'
import { pairKeyFor } from '@/lib/graph/relationships'
import { entityKindOfPath, entityMentionPaths, entityNotePath } from './entities'

// Matches store.ts's SHARED_OWNER_KEY — redeclared here (not imported) so the
// store can call into this module without a circular import.
const SHARED_OWNER_KEY = 'shared'

export const CONTEXT_RELATIONSHIP = 'mentioned'
export const CONTEXT_ORIGIN = 'context'

interface BrainRef {
  communityId: string
  ownerKey: string
}

interface EntityMaps {
  idByPath: Map<string, string>
  pathById: Map<string, string>
}

function bustGraphCache(): void {
  try {
    revalidateTag('graph-data-v2')
  } catch {
    /* outside request scope */
  }
}

// Both directions of the node ↔ canonical-note-path mapping for a community.
// Paths are NOT reconstructible from ids by string surgery (see entities.ts),
// so this map — entityNotePath over the real nodes — is the only sound bridge.
async function loadEntityMaps(communityId: string): Promise<EntityMaps> {
  const nodes = await prisma.node.findMany({
    where: { communityId },
    select: { id: true, type: true },
  })
  const idByPath = new Map<string, string>()
  const pathById = new Map<string, string>()
  for (const node of nodes) {
    const path = entityNotePath(node)
    if (!path) continue
    idByPath.set(path, node.id)
    pathById.set(node.id, path)
  }
  return { idByPath, pathById }
}

// The live shared-brain note at `path`, or null.
function readSharedNote(communityId: string, path: string) {
  return prisma.communityNote.findFirst({
    where: { communityId, ownerKey: SHARED_OWNER_KEY, path, deletedAt: null },
    select: { content: true },
  })
}

// Sync one entity note's context links to its current mention set. `content`
// null means the note is gone (trashed / renamed away) — desired set is empty.
// Returns true when any link row changed.
async function syncOne(
  communityId: string,
  path: string,
  content: string | null,
  maps: EntityMaps,
): Promise<boolean> {
  const selfId = maps.idByPath.get(path) ?? null
  const desiredIds =
    content !== null && selfId
      ? entityMentionPaths(path, content)
          .map((p) => maps.idByPath.get(p))
          .filter((id): id is string => Boolean(id) && id !== selfId)
      : []
  const desiredPairs = new Set(selfId ? desiredIds.map((id) => pairKeyFor(selfId, id)) : [])

  let changed = false

  // Stale links this note owns: re-point to the counterpart's note when it still
  // mentions back, otherwise delete. (Scoped to origin 'context', so a manual or
  // promoted edge between the same pair is never touched.)
  const owned = await prisma.link.findMany({
    where: { communityId, origin: CONTEXT_ORIGIN, originRef: path },
  })
  for (const row of owned) {
    if (desiredPairs.has(row.pairKey)) continue
    const otherId = [row.sourceId, row.targetId].find((id) => maps.pathById.get(id) !== path)
    const otherPath = (otherId ? maps.pathById.get(otherId) : null) ?? null
    const other = otherPath ? await readSharedNote(communityId, otherPath) : null
    const mentionedBack =
      other !== null && otherPath !== null && entityMentionPaths(otherPath, other.content).includes(path)
    if (mentionedBack && otherPath) {
      await prisma.link.update({ where: { id: row.id }, data: { originRef: otherPath } })
    } else {
      await prisma.link.delete({ where: { id: row.id } })
    }
    changed = true
  }

  for (const id of desiredIds) {
    if (!selfId) break
    await upsertLink({
      communityId,
      sourceId: selfId,
      targetId: id,
      relationship: CONTEXT_RELATIONSHIP,
      origin: CONTEXT_ORIGIN,
      originRef: path,
      revalidate: false,
    })
    changed = true
  }

  return changed
}

/**
 * Best-effort sync of the context links derived from one note. No-op for
 * personal brains and non-entity paths. Pass `content: null` when the note no
 * longer lives at `path` (trash, rename, folder delete).
 */
export async function syncContextLinks(
  brain: BrainRef,
  path: string,
  content: string | null,
): Promise<void> {
  if (brain.ownerKey !== SHARED_OWNER_KEY || !entityKindOfPath(path)) return
  try {
    const maps = await loadEntityMaps(brain.communityId)
    const changed = await syncOne(brain.communityId, path, content, maps)
    if (changed) bustGraphCache()
  } catch (err) {
    logger.error('notes.contextLinks.sync.failed', { err, path, communityId: brain.communityId })
  }
}

/**
 * Best-effort bulk sync after a folder rename/delete: `removed` paths lose
 * their links (counterpart re-point rules apply), `added` [path, content]
 * pairs gain theirs. Non-entity paths are skipped, so callers can pass every
 * affected note without pre-filtering.
 */
export async function syncContextLinksBulk(
  brain: BrainRef,
  removed: string[],
  added: Array<[path: string, content: string]> = [],
): Promise<void> {
  if (brain.ownerKey !== SHARED_OWNER_KEY) return
  const removedEntity = removed.filter((p) => entityKindOfPath(p))
  const addedEntity = added.filter(([p]) => entityKindOfPath(p))
  if (removedEntity.length === 0 && addedEntity.length === 0) return
  try {
    const maps = await loadEntityMaps(brain.communityId)
    let changed = false
    for (const path of removedEntity) {
      changed = (await syncOne(brain.communityId, path, null, maps)) || changed
    }
    for (const [path, content] of addedEntity) {
      changed = (await syncOne(brain.communityId, path, content, maps)) || changed
    }
    if (changed) bustGraphCache()
  } catch (err) {
    logger.error('notes.contextLinks.bulkSync.failed', { err, communityId: brain.communityId })
  }
}

/**
 * Rebuild every context link in a community's shared brain from its entity
 * notes — the backfill for notes written before context-driven links existed.
 * Returns the number of entity notes processed.
 */
export async function backfillContextLinks(communityId: string): Promise<number> {
  const maps = await loadEntityMaps(communityId)
  const notes = await prisma.communityNote.findMany({
    where: { communityId, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
    select: { path: true, content: true },
  })
  const entityNotes = notes.filter((n) => entityKindOfPath(n.path))
  let changed = false
  for (const note of entityNotes) {
    changed = (await syncOne(communityId, note.path, note.content, maps)) || changed
  }
  if (changed) bustGraphCache()
  return entityNotes.length
}
