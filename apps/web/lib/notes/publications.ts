// Cross-brain publish: the source note stays owned by its brain; a live
// replica exists as a REAL note row in the target community's shared brain,
// overwritten on every source save. The replica being real community data is
// the whole design — the visibility lens, search, [[mention]] link sync, the
// graph, and mobile all work on it with zero changes, and NO read path ever
// crosses a community boundary. The only cross-tenant motion is the
// replicating write below: one choke point that stamps provenance and runs
// with origin 'publish' (which is also the cascade guard — a replica write
// never triggers further replication, so publish chains/cycles can't loop).
//
// Import cycle with store.ts (it calls the sync/rename/delete hooks; we call
// store.writeNote for replicas) is benign: both sides only call each other
// inside function bodies, never at module init — same pattern as vaultCache.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import * as store from './store'
import { SHARED_OWNER_KEY, type Actor, type Brain } from './store'
import { logAudit } from './audit'
import { parseFrontmatter, splitFrontmatter, joinFrontmatter } from './shared/markdown'
import { provenanceRef } from './shared/noteLog'

export interface PublicationInfo {
  id: string
  sourceCommunityId: string
  sourcePath: string
  targetCommunityId: string
  targetPath: string
  active: boolean
  lastSyncedAt: number | null
  createdBy: string
  createdAt: number
}

function toInfo(row: {
  id: string
  sourceCommunityId: string
  sourcePath: string
  targetCommunityId: string
  targetPath: string
  active: boolean
  lastSyncedAt: Date | null
  createdBy: string
  createdAt: Date
}): PublicationInfo {
  return {
    id: row.id,
    sourceCommunityId: row.sourceCommunityId,
    sourcePath: row.sourcePath,
    targetCommunityId: row.targetCommunityId,
    targetPath: row.targetPath,
    active: row.active,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.getTime() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
  }
}

/**
 * The replica's content: the source markdown with provenance stamped into the
 * frontmatter (`published-from` + the publisher as author when none is set).
 * Pure — exported for tests. The replica's revision history starts fresh in
 * the destination (origin 'publish'); the source's trail never crosses.
 */
export function replicaContent(sourceContent: string, opts: { ref: string; publisher: string }): string {
  const fm = parseFrontmatter(sourceContent)
  const { body } = splitFrontmatter(sourceContent)
  return joinFrontmatter(
    {
      ...fm,
      author: typeof fm.author === 'string' && fm.author.trim() ? fm.author : opts.publisher,
      'published-from': opts.ref,
    },
    body,
  )
}

function sourceRef(sourceCommunityId: string, sourcePath: string): string {
  return provenanceRef(`${sourceCommunityId}/${sourcePath}`)
}

// --- publish / unpublish ---------------------------------------------------------

export type PublishResult =
  | { status: 'applied'; publication: PublicationInfo }
  | { status: 'denied'; reason: string }

/**
 * Create (or reactivate) a publication and write the first replica. The CALLER
 * must already be validated: read access on the source, edit access at the
 * target folder (the route/proposal flow owns those checks). Suffixes the
 * target path rather than clobbering an existing unrelated note.
 */
export async function publishNote(
  sourceCommunityId: string,
  sourcePath: string,
  targetCommunityId: string,
  targetPath: string,
  actor: Actor,
): Promise<PublishResult> {
  if (sourceCommunityId === targetCommunityId) {
    return { status: 'denied', reason: 'A note cannot be published into its own brain' }
  }
  const source: Brain = { communityId: sourceCommunityId, ownerKey: SHARED_OWNER_KEY }
  const content = await store.readNoteOrNull(source, sourcePath)
  if (content === null) return { status: 'denied', reason: `Note not found: ${sourcePath}` }

  const existing = await prisma.notePublication.findUnique({
    where: {
      publication_identity: { sourceCommunityId, sourcePath, targetCommunityId },
    },
  })
  if (existing?.active) {
    return {
      status: 'denied',
      reason: `Already published to this community (at ${existing.targetPath}) — unlink it first`,
    }
  }

  // Never overwrite someone else's note on first publish — suffix instead.
  const target: Brain = { communityId: targetCommunityId, ownerKey: SHARED_OWNER_KEY }
  let dest = targetPath
  let n = 1
  while (await store.readNoteOrNull(target, dest)) {
    dest = targetPath.replace(/\.md$/i, '') + `-${n++}.md`
  }

  const row = existing
    ? await prisma.notePublication.update({
        where: { id: existing.id },
        data: { active: true, targetPath: dest, createdBy: actor.id },
      })
    : await prisma.notePublication.create({
        data: { sourceCommunityId, sourcePath, targetCommunityId, targetPath: dest, createdBy: actor.id },
      })

  await writeReplica(row.id, targetCommunityId, dest, content, sourceCommunityId, sourcePath, actor)
  void logAudit(targetCommunityId, {
    userId: actor.id,
    name: actor.name,
    action: 'publish',
    path: dest,
    detail: `published from ${sourceCommunityId}/${sourcePath}`,
  })
  return { status: 'applied', publication: toInfo({ ...row, targetPath: dest, active: true, lastSyncedAt: new Date() }) }
}

/** Deactivate a publication — the replica stays behind as a plain editable copy. */
export async function unpublish(id: string, actor: Actor): Promise<PublicationInfo | null> {
  const row = await prisma.notePublication.findUnique({ where: { id } })
  if (!row) return null
  if (row.active) {
    await prisma.notePublication.update({ where: { id }, data: { active: false } })
    void logAudit(row.targetCommunityId, {
      userId: actor.id,
      name: actor.name,
      action: 'publish',
      path: row.targetPath,
      detail: `unlinked from ${row.sourceCommunityId}/${row.sourcePath} (kept as a copy)`,
    })
  }
  return toInfo({ ...row, active: false })
}

export async function getPublication(id: string): Promise<PublicationInfo | null> {
  const row = await prisma.notePublication.findUnique({ where: { id } })
  return row ? toInfo(row) : null
}

// --- read model -------------------------------------------------------------------

export interface PublicationState {
  /** Publications OF this note (it is the source). */
  asSource: PublicationInfo[]
  /** The active publication this note is a replica of, when it is one. */
  asTarget: PublicationInfo | null
}

/** How a path participates in publishing, from one community's point of view. */
export async function publicationStateFor(
  communityId: string,
  path: string,
): Promise<PublicationState> {
  const [asSource, asTarget] = await Promise.all([
    prisma.notePublication.findMany({
      where: { sourceCommunityId: communityId, sourcePath: path },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.notePublication.findFirst({
      where: { targetCommunityId: communityId, targetPath: path, active: true },
    }),
  ])
  return {
    asSource: asSource.map(toInfo),
    asTarget: asTarget ? toInfo(asTarget) : null,
  }
}

/**
 * The write-block for replicas: an ACTIVE publication target is read-only in
 * its destination (edits would be clobbered by the next source save). Returns
 * the denial reason, or null. Deletes are allowed — they deactivate the link.
 */
export async function replicaDenial(communityId: string, path: string): Promise<string | null> {
  const row = await prisma.notePublication.findFirst({
    where: { targetCommunityId: communityId, targetPath: path, active: true },
    select: { sourceCommunityId: true },
  })
  if (!row) return null
  return 'This note is a published copy and stays in sync with its source — unlink it to edit here.'
}

// --- store hooks (called from lib/notes/store.ts, always best-effort) -------------

async function writeReplica(
  publicationId: string,
  targetCommunityId: string,
  targetPath: string,
  sourceContent: string,
  sourceCommunityId: string,
  sourcePath: string,
  actor: Actor,
): Promise<void> {
  const target: Brain = { communityId: targetCommunityId, ownerKey: SHARED_OWNER_KEY }
  const content = replicaContent(sourceContent, {
    ref: sourceRef(sourceCommunityId, sourcePath),
    publisher: actor.name,
  })
  await store.writeNote(target, targetPath, content, actor, 'publish')
  await prisma.notePublication.update({
    where: { id: publicationId },
    data: { lastSyncedAt: new Date() },
  })
}

/**
 * Refresh every active replica of a just-saved source note. Called by
 * store.writeNote AFTER the save lands, EXCEPT for origin 'publish' (the
 * cascade guard). Failures log and never fail the save itself.
 */
export async function syncPublicationsOnWrite(
  brain: Brain,
  path: string,
  content: string,
  actor: Actor,
): Promise<void> {
  if (brain.ownerKey !== SHARED_OWNER_KEY) return
  try {
    const rows = await prisma.notePublication.findMany({
      where: { sourceCommunityId: brain.communityId, sourcePath: path, active: true },
    })
    for (const row of rows) {
      await writeReplica(
        row.id,
        row.targetCommunityId,
        row.targetPath,
        content,
        row.sourceCommunityId,
        row.sourcePath,
        actor,
      )
    }
  } catch (err) {
    logger.error('notes.publications.sync.failed', { err, path, communityId: brain.communityId })
  }
}

/** A rename on either end follows the note — the link itself stays alive. */
export async function syncPublicationsOnRename(
  brain: Brain,
  from: string,
  to: string,
): Promise<void> {
  if (brain.ownerKey !== SHARED_OWNER_KEY) return
  try {
    await prisma.notePublication.updateMany({
      where: { sourceCommunityId: brain.communityId, sourcePath: from },
      data: { sourcePath: to },
    })
    await prisma.notePublication.updateMany({
      where: { targetCommunityId: brain.communityId, targetPath: from },
      data: { targetPath: to },
    })
  } catch (err) {
    logger.error('notes.publications.rename.failed', { err, from, to, communityId: brain.communityId })
  }
}

/**
 * Deleting/trashing either end deactivates the link: a deleted source leaves
 * the replica behind as a stale copy; a deleted replica stops resurrecting on
 * the next source save.
 */
export async function syncPublicationsOnDelete(brain: Brain, paths: string[]): Promise<void> {
  if (brain.ownerKey !== SHARED_OWNER_KEY || paths.length === 0) return
  try {
    await prisma.notePublication.updateMany({
      where: {
        active: true,
        OR: [
          { sourceCommunityId: brain.communityId, sourcePath: { in: paths } },
          { targetCommunityId: brain.communityId, targetPath: { in: paths } },
        ],
      },
      data: { active: false },
    })
  } catch (err) {
    logger.error('notes.publications.delete.failed', { err, communityId: brain.communityId })
  }
}
