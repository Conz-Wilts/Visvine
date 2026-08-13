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

import { createHash } from 'crypto'
import { revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { upsertLink } from '@/lib/notes/context/links'
import { pairKeyFor } from '@/lib/notes/context/relationships'
import { spaceNodeId, removeEntityNode, syncEntityNode } from '@/lib/notes/context/entityNodes'
import {
  mergeContextMeta,
  nextContextMeta,
  readLinkContextMeta,
} from '@/lib/notes/context/linkReason'
import { scheduleLinkReasons } from '@/lib/notes/linkReasons'
import { parseFrontmatter, splitFrontmatter } from './shared/markdown'
import { excerptsForTargets } from './shared/references'
import { isIndexPath } from './shared/indexNote'
import { entityKindOfPath, entityMentionPaths, entityNotePath } from './entities'

// Matches store.ts's SHARED_OWNER_KEY — redeclared here (not imported) so the
// store can call into this module without a circular import.
const SHARED_OWNER_KEY = 'shared'

const CONTEXT_RELATIONSHIP = 'mentioned'
export const CONTEXT_ORIGIN = 'context'

interface BrainRef {
  spaceId: string
  ownerKey: string
}

interface EntityMaps {
  idByPath: Map<string, string>
  pathById: Map<string, string>
}

function bustContextCache(): void {
  try {
    revalidateTag('context-data-v2', { expire: 0 })
  } catch {
    /* outside request scope */
  }
}

// Both directions of the node ↔ canonical-note-path mapping for a space.
// Paths are NOT reconstructible from ids by string surgery (see entities.ts),
// so this map — entityNotePath over the real nodes — is the only sound bridge.
async function loadEntityMaps(spaceId: string): Promise<EntityMaps> {
  const nodes = await prisma.node.findMany({
    where: { spaceId },
    select: { id: true, type: true, metadata: true },
  })
  const idByPath = new Map<string, string>()
  const pathById = new Map<string, string>()
  for (const node of nodes) {
    // A connector's id slugifies the filename (`my_api` → `connector:my-api`),
    // which is lossy, so its metadata is the only exact path back to the note.
    const path =
      node.type === 'connector' ? notePathOfNode(node.metadata) : entityNotePath(node)
    if (!path) continue
    idByPath.set(path, node.id)
    pathById.set(node.id, path)
  }
  return { idByPath, pathById }
}

/** The brain path a `connector:` node stands for, off its metadata. */
function notePathOfNode(metadata: unknown): string | null {
  const value = (metadata as Record<string, unknown> | null)?.notePath
  return typeof value === 'string' && value ? value : null
}

/**
 * The node a saved note owns, if any. Only connectors qualify: a connector is
 * the one entity whose note comes first, so this is the one entity namespace
 * the note store owns rather than skips (see entities.ts).
 *
 * Every other note is content in the brain, not a node in the graph — an entity
 * note (people/craig.md) is already drawn as that entity, and a plain note has
 * no node of its own, so it draws nothing and owns no edges.
 *
 * `content: null` means the note is gone, so its node goes with it. Returns true
 * when anything changed.
 */
async function syncNoteNode(
  spaceId: string,
  path: string,
  content: string | null,
): Promise<boolean> {
  if (isIndexPath(path)) return false
  if (entityKindOfPath(path) === 'connector') return syncConnectorNode(spaceId, path, content)
  return false
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
  spaceId: string,
  path: string,
  content: string | null,
): Promise<boolean> {
  if (content === null) return removeEntityNode(spaceId, 'connector', path)

  const name = path.replace(/\.md$/i, '').split('/').pop() || path
  const fm = parseFrontmatter(content)
  const alias = typeof fm.alias === 'string' && fm.alias.trim() ? fm.alias.trim() : null
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''

  await syncEntityNode({
    spaceId,
    type: 'connector',
    name: String(fm.title ?? '').trim() || name,
    alias,
    subtitle: description || null,
    recordId: path,
    slugSource: name,
    metadata: { notePath: path },
    parentNodeId: spaceNodeId(spaceId),
    revalidate: false,
  })
  return true
}

// The live shared-brain note at `path`, or null.
function readSharedNote(spaceId: string, path: string) {
  return prisma.spaceNote.findFirst({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, path, deletedAt: null },
    select: { content: true },
  })
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** An excerpt entry with its hash stamped, or null for empty text. */
function excerptEntry(text: string | null | undefined) {
  return text ? { text, hash: sha256(text) } : null
}

// Sync one entity note's context links to its current mention set. `content`
// null means the note is gone (trashed / renamed away) — desired set is empty.
// Returns true when any link row changed.
async function syncOne(
  spaceId: string,
  path: string,
  content: string | null,
  maps: EntityMaps,
): Promise<boolean> {
  const selfId = maps.idByPath.get(path) ?? null
  const desired =
    content !== null && selfId
      ? entityMentionPaths(path, content)
          .map((p) => ({ targetPath: p, id: maps.idByPath.get(p) }))
          .filter(
            (d): d is { targetPath: string; id: string } => Boolean(d.id) && d.id !== selfId,
          )
      : []
  const desiredPairs = new Set(selfId ? desired.map((d) => pairKeyFor(selfId, d.id)) : [])
  // The prose block around each mention — the deterministic "why linked" tier,
  // stored on the row under metadata.context (see lib/notes/context/linkReason.ts).
  const excerptByTarget =
    content !== null ? excerptsForTargets(path, splitFrontmatter(content).body) : new Map<string, string>()

  let changed = false

  // Stale links this note owns: re-point to the counterpart's note when it still
  // mentions back, otherwise delete. (Scoped to origin 'context', so a manual or
  // promoted edge between the same pair is never touched.)
  const owned = await prisma.link.findMany({
    where: { spaceId, origin: CONTEXT_ORIGIN, originRef: path },
  })
  for (const row of owned) {
    if (desiredPairs.has(row.pairKey)) continue
    const otherId = [row.sourceId, row.targetId].find((id) => maps.pathById.get(id) !== path)
    const otherPath = (otherId ? maps.pathById.get(otherId) : null) ?? null
    const other = otherPath ? await readSharedNote(spaceId, otherPath) : null
    const mentionedBack =
      other !== null && otherPath !== null && entityMentionPaths(otherPath, other.content).includes(path)
    if (mentionedBack && otherPath && other) {
      // Ownership moves to the counterpart, so the edge's excerpt does too:
      // this note's key is dropped and the counterpart's block around its
      // mention of `path` takes over as the "why".
      const keepKey = (key: string) => maps.idByPath.has(key)
      const otherExcerpt = excerptEntry(
        excerptsForTargets(otherPath, splitFrontmatter(other.content).body).get(path),
      )
      const prior = readLinkContextMeta(row.metadata)
      const dropped = nextContextMeta(prior, path, null, keepKey) ?? prior
      const repointed = nextContextMeta(dropped, otherPath, otherExcerpt, keepKey) ?? dropped
      await prisma.link.update({
        where: { id: row.id },
        data: {
          originRef: otherPath,
          ...(repointed ? { metadata: mergeContextMeta(row.metadata, repointed) as object } : {}),
        },
      })
    } else {
      await prisma.link.delete({ where: { id: row.id } })
    }
    changed = true
  }

  // Existing rows for the desired pairs, so each upsert can merge its excerpt
  // into the row's metadata instead of blindly replacing it (mutual mentions
  // share one row — each side owns only its own excerpt key).
  const existingByPair = selfId
    ? new Map(
        (
          await prisma.link.findMany({
            where: {
              spaceId,
              relationship: CONTEXT_RELATIONSHIP,
              pairKey: { in: [...desiredPairs] },
            },
            select: { pairKey: true, metadata: true },
          })
        ).map((row) => [row.pairKey, row.metadata]),
      )
    : new Map<string, unknown>()

  for (const { targetPath, id } of desired) {
    if (!selfId) break
    const rowMetadata = existingByPair.get(pairKeyFor(selfId, id))
    const context = nextContextMeta(
      readLinkContextMeta(rowMetadata),
      path,
      excerptEntry(excerptByTarget.get(targetPath)),
      (key) => maps.idByPath.has(key),
    )
    await upsertLink({
      spaceId,
      sourceId: selfId,
      targetId: id,
      relationship: CONTEXT_RELATIONSHIP,
      origin: CONTEXT_ORIGIN,
      originRef: path,
      ...(context ? { metadata: mergeContextMeta(rowMetadata, context) } : {}),
      revalidate: false,
    })
    changed = true
  }

  return changed
}

/**
 * Best-effort sync of one note's place in the graph: the node it owns (only a
 * connector note owns one), then the context links its `[[mentions]]` own.
 * Every shared-brain note goes through here, but only a note that IS a node —
 * an entity note or a connector — can own edges; a plain note has no node, so
 * its mentions draw nothing.
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
    // resolve, and therefore what lets the note own edges at all.
    const nodeChanged = await syncNoteNode(brain.spaceId, path, content)
    const maps = await loadEntityMaps(brain.spaceId)
    const changed = await syncOne(brain.spaceId, path, content, maps)
    if (changed || nodeChanged) bustContextCache()
    // AI tier: turn fresh excerpts into reason phrases, off the request path.
    if (changed) scheduleLinkReasons(brain.spaceId)
  } catch (err) {
    logger.error('notes.contextLinks.sync.failed', { err, path, spaceId: brain.spaceId })
  }
}

/**
 * Best-effort bulk sync after a folder rename/delete: `removed` paths lose
 * their links (counterpart re-point rules apply), `added` [path, content]
 * pairs gain theirs, and any node a path owns (connectors) follows it.
 *
 * A rename is modelled as remove-then-add. Entity notes are unaffected — their
 * node is keyed on the entity, not the path.
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
      changed = (await syncNoteNode(brain.spaceId, path, null)) || changed
    }
    for (const [path, content] of added) {
      changed = (await syncNoteNode(brain.spaceId, path, content)) || changed
    }
    // Loaded after the node writes so newly added notes resolve to their nodes.
    const maps = await loadEntityMaps(brain.spaceId)
    for (const path of removed) {
      changed = (await syncOne(brain.spaceId, path, null, maps)) || changed
    }
    for (const [path, content] of added) {
      changed = (await syncOne(brain.spaceId, path, content, maps)) || changed
    }
    if (changed) {
      bustContextCache()
      scheduleLinkReasons(brain.spaceId)
    }
  } catch (err) {
    logger.error('notes.contextLinks.bulkSync.failed', { err, spaceId: brain.spaceId })
  }
}

/**
 * Rebuild every context link in a space's shared brain from its notes — the
 * backfill for notes written before context-driven links existed. Returns the
 * number of notes processed.
 */
export async function backfillContextLinks(spaceId: string): Promise<number> {
  const notes = await prisma.spaceNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
    select: { path: true, content: true },
  })
  let changed = false
  // Nodes first, for the whole set: a note can only own an edge once its node
  // exists, and the maps are loaded once afterwards rather than per note.
  for (const note of notes) {
    changed = (await syncNoteNode(spaceId, note.path, note.content)) || changed
  }
  const maps = await loadEntityMaps(spaceId)
  for (const note of notes) {
    changed = (await syncOne(spaceId, note.path, note.content, maps)) || changed
  }
  if (changed) bustContextCache()
  return notes.length
}
