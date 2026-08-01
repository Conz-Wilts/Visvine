// Context-driven context links: an entity context note (people/<slug>.md or
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
import { upsertLink } from '@/lib/context/links'
import { pairKeyFor } from '@/lib/context/relationships'
import { communityNodeId, removeEntityNode, syncEntityNode } from '@/lib/context/entityNodes'
import { parseFrontmatter } from './shared/markdown'
import { isIndexPath } from './shared/indexNote'
import { entityKindOfPath, entityMentionPaths, entityNotePath } from './entities'

// Matches store.ts's SHARED_OWNER_KEY — redeclared here (not imported) so the
// store can call into this module without a circular import.
const SHARED_OWNER_KEY = 'shared'

const CONTEXT_RELATIONSHIP = 'mentioned'
export const CONTEXT_ORIGIN = 'context'

interface BrainRef {
  communityId: string
  ownerKey: string
}

interface EntityMaps {
  idByPath: Map<string, string>
  pathById: Map<string, string>
}

function bustContextCache(): void {
  try {
    revalidateTag('context-data-v2')
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
    select: { id: true, type: true, metadata: true },
  })
  const idByPath = new Map<string, string>()
  const pathById = new Map<string, string>()
  for (const node of nodes) {
    // A plain note is its own node, and its path lives in metadata rather than
    // being derivable from the id — the id is a slug of the path, which is lossy.
    // A connector is the same: its id slugifies the filename (`my_api` →
    // `connector:my-api`), so metadata is the only exact path.
    const path =
      node.type === 'note' || node.type === 'connector'
        ? notePathOfNode(node.metadata)
        : entityNotePath(node)
    if (!path) continue
    idByPath.set(path, node.id)
    pathById.set(node.id, path)
  }
  return { idByPath, pathById }
}

/** The brain path a `note:` node stands for, off its metadata. */
function notePathOfNode(metadata: unknown): string | null {
  const value = (metadata as Record<string, unknown> | null)?.notePath
  return typeof value === 'string' && value ? value : null
}

/**
 * A note that isn't the canonical note for some other entity is its own thing,
 * so it gets its own `note:` node — that's what lets an ordinary note appear in
 * the context view and own the `mentioned` edges it draws.
 *
 * Two exclusions. An entity note (people/craig.md) is already represented by the
 * entity's node; giving it a second one would draw Craig twice. A folder's
 * index.md is brain scaffolding rather than content — see shared/indexNote.ts.
 *
 * `content: null` means the note is gone, so its node goes with it. Returns true
 * when anything changed.
 */
async function syncNoteNode(
  communityId: string,
  path: string,
  content: string | null,
): Promise<boolean> {
  if (isIndexPath(path)) return false
  // A connector is the one entity whose note comes first, so it's the one
  // entity namespace this function owns rather than skips (see entities.ts).
  if (entityKindOfPath(path) === 'connector') return syncConnectorNode(communityId, path, content)
  if (entityKindOfPath(path)) return false
  if (content === null) return removeEntityNode(communityId, 'note', path)

  const title = String(parseFrontmatter(content).title ?? '').trim()
  await syncEntityNode({
    communityId,
    type: 'note',
    name: title || path.replace(/\.md$/i, '').split('/').pop() || path,
    recordId: path,
    slugSource: path.replace(/\.md$/i, ''),
    metadata: { notePath: path },
    parentNodeId: communityNodeId(communityId),
    revalidate: false,
  })
  return true
}

/**
 * The `connector:` node standing for a `connectors/<name>.md` note.
 *
 * The node id is `connector:<name>`, which is exactly what entityNotePath maps
 * back to the note — so the connector participates in backlinks and
 * `[[mentions]]` like any other entity. Its `alias` mirrors the note's
 * frontmatter (`http` / `postgres`), which is what makes the type chip read
 * "http" wherever the node is drawn; an unparseable or missing alias leaves the
 * column null and the chip falls back to the base "Connector" label.
 */
async function syncConnectorNode(
  communityId: string,
  path: string,
  content: string | null,
): Promise<boolean> {
  if (content === null) return removeEntityNode(communityId, 'connector', path)

  const name = path.replace(/\.md$/i, '').split('/').pop() || path
  const fm = parseFrontmatter(content)
  const alias = typeof fm.alias === 'string' && fm.alias.trim() ? fm.alias.trim() : null
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''

  await syncEntityNode({
    communityId,
    type: 'connector',
    name: String(fm.title ?? '').trim() || name,
    alias,
    subtitle: description || null,
    recordId: path,
    slugSource: name,
    metadata: { notePath: path },
    parentNodeId: communityNodeId(communityId),
    revalidate: false,
  })
  return true
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
 * Best-effort sync of one note's place in the graph: its own `note:` node, then
 * the context links its `[[mentions]]` own. Every shared-brain note goes through
 * here now, not just entity notes — an ordinary note that mentions three people
 * draws three edges, which is the whole point of notes being first-class.
 *
 * No-op for personal brains. Pass `content: null` when the note no longer lives
 * at `path` (trash, rename, folder delete).
 */
export async function syncContextLinks(
  brain: BrainRef,
  path: string,
  content: string | null,
): Promise<void> {
  if (brain.ownerKey !== SHARED_OWNER_KEY) return
  try {
    // The node must exist before syncOne runs — that's what makes `selfId`
    // resolve, and therefore what lets a plain note own edges at all.
    const nodeChanged = await syncNoteNode(brain.communityId, path, content)
    const maps = await loadEntityMaps(brain.communityId)
    const changed = await syncOne(brain.communityId, path, content, maps)
    if (changed || nodeChanged) bustContextCache()
  } catch (err) {
    logger.error('notes.contextLinks.sync.failed', { err, path, communityId: brain.communityId })
  }
}

/**
 * Best-effort bulk sync after a folder rename/delete: `removed` paths lose
 * their links (counterpart re-point rules apply), `added` [path, content]
 * pairs gain theirs, and each path's own `note:` node follows it.
 *
 * A rename is modelled as remove-then-add, so a renamed plain note gets a fresh
 * node keyed on the new path: its saved canvas position doesn't survive the
 * move. Entity notes are unaffected — their node is keyed on the entity, not the
 * path.
 */
export async function syncContextLinksBulk(
  brain: BrainRef,
  removed: string[],
  added: Array<[path: string, content: string]> = [],
): Promise<void> {
  if (brain.ownerKey !== SHARED_OWNER_KEY) return
  if (removed.length === 0 && added.length === 0) return
  try {
    let changed = false
    for (const path of removed) {
      changed = (await syncNoteNode(brain.communityId, path, null)) || changed
    }
    for (const [path, content] of added) {
      changed = (await syncNoteNode(brain.communityId, path, content)) || changed
    }
    // Loaded after the node writes so newly added notes resolve to their nodes.
    const maps = await loadEntityMaps(brain.communityId)
    for (const path of removed) {
      changed = (await syncOne(brain.communityId, path, null, maps)) || changed
    }
    for (const [path, content] of added) {
      changed = (await syncOne(brain.communityId, path, content, maps)) || changed
    }
    if (changed) bustContextCache()
  } catch (err) {
    logger.error('notes.contextLinks.bulkSync.failed', { err, communityId: brain.communityId })
  }
}

/**
 * Rebuild every context link in a community's shared brain from its notes — the
 * backfill for notes written before context-driven links existed, and for the
 * notes that only became graph-visible when notes gained their own nodes.
 * Returns the number of notes processed.
 */
export async function backfillContextLinks(communityId: string): Promise<number> {
  const notes = await prisma.communityNote.findMany({
    where: { communityId, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
    select: { path: true, content: true },
  })
  let changed = false
  // Nodes first, for the whole set: a note can only own an edge once its own
  // node exists, and the maps are loaded once afterwards rather than per note.
  for (const note of notes) {
    changed = (await syncNoteNode(communityId, note.path, note.content)) || changed
  }
  const maps = await loadEntityMaps(communityId)
  for (const note of notes) {
    changed = (await syncOne(communityId, note.path, note.content, maps)) || changed
  }
  if (changed) bustContextCache()
  return notes.length
}
