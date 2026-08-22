// The global record of a person: one node and one `people/<slug>.md` note in
// the Visvine space per Identity, maintained from whatever is PUBLIC about
// them — their own profile (if the identity is claimed) and their cards in
// public spaces. What the aggregate is, and how the sources rank, is the pure
// module lib/global/shared/aggregate.ts; this file loads the sources, writes
// the result, and pushes node fields down to every node that follows it.
//
// Private spaces never feed the record: a private space's people are exactly
// what makes it worth keeping private (same rule the finder applies in
// app/api/nodes/search/route.ts). A public space with an admins-only directory
// is private for this purpose too.
//
// The note is the one tier-1 artifact here: its machine block is rewritten on
// every sync, and prose the person wrote around the block is kept. Writes use
// origin 'baseline' — a platform projection, not an edit a human approved and
// not an AI write the Freeze-for-AI lock should bind.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { entityNotePath } from '@/lib/notes/entities'
import { syncEntityNode } from '@/lib/notes/context/entityNodes'
import { readNoteOrNull, writeNote, type Actor, type Context } from '@/lib/notes/store'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { ensureGlobalSpace, GLOBAL_SPACE_ID, GLOBAL_SPACE_NAME, isGlobalSpace } from '@/lib/spaces/globalSpace'
import {
  aggregateGlobalRecord,
  applyGlobalBlock,
  renderGlobalBlock,
  type GlobalSource,
} from './shared/aggregate'

/** Writes made by the platform itself, never attributed to a signed-in person. */
const GLOBAL_ACTOR: Actor = { id: 'system', name: GLOBAL_SPACE_NAME, email: null }

// Matches store.ts's SHARED_OWNER_KEY — redeclared (not imported) because this
// module is reached during the store's own initialisation (store → projections
// → hooks → here) and a module-level read of the import would hit the TDZ.
const GLOBAL_CONTEXT: Context = { spaceId: GLOBAL_SPACE_ID, ownerKey: 'shared' }

/** Node metadata key: how a node in an ordinary space relates to the global record. */
export const GLOBAL_MODE_KEY = 'globalMode'
export type GlobalMode = 'follow' | 'fork'

export interface GlobalRecordRef {
  identityId: string
  nodeId: string
  path: string
  name: string
  subtitle: string | null
  imageUrl: string | null
  /** The user who claimed this identity, when someone has. */
  userId: string | null
}

/** The global node for an identity, or null when nothing public exists for it yet. */
export async function globalRecordOf(identityId: string): Promise<GlobalRecordRef | null> {
  const node = await prisma.node.findFirst({
    where: { spaceId: GLOBAL_SPACE_ID, identityId },
    select: {
      id: true, name: true, subtitle: true, imageUrl: true, metadata: true,
      identity: { select: { userId: true } },
    },
  })
  if (!node) return null
  const path = entityNotePath({
    id: node.id,
    type: 'person',
    metadata: (node.metadata as Record<string, unknown> | null) ?? null,
  })
  if (!path) return null
  return {
    identityId,
    nodeId: node.id,
    path,
    name: node.name,
    subtitle: node.subtitle,
    imageUrl: node.imageUrl,
    userId: node.identity?.userId ?? null,
  }
}

/**
 * Whether a space's directory feeds the public record: public, not personal,
 * not the global space itself, and not admins-only.
 */
function spaceIsPublicSource(space: {
  id: string
  visibility: string | null
  personalOwnerId: string | null
  featureConfig: unknown
}): boolean {
  if (isGlobalSpace(space.id) || space.personalOwnerId) return false
  if (space.visibility !== 'public') return false
  const cfg = (space.featureConfig as Record<string, unknown> | null) ?? {}
  return cfg.directoryPrivate !== true && cfg.directoryPrivate !== 'true'
}

async function loadSources(identityId: string): Promise<{ canonicalName: string; sources: GlobalSource[] } | null> {
  const identity = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { id: true, kind: true, canonicalName: true, userId: true },
  })
  if (!identity || identity.kind !== 'person') return null

  const sources: GlobalSource[] = []

  if (identity.userId) {
    const person = await prisma.person.findUnique({
      where: { userId: identity.userId },
      select: { name: true, subtitle: true, bio: true, location: true, website: true, imageUrl: true, tags: true },
    })
    if (person) {
      sources.push({
        kind: 'profile',
        spaceId: null,
        spaceName: null,
        name: person.name,
        subtitle: person.subtitle,
        location: person.location,
        url: person.website,
        imageUrl: person.imageUrl,
        tags: person.tags ?? [],
        bio: person.bio,
      })
    }
  }

  const nodes = await prisma.node.findMany({
    where: { identityId, spaceId: { not: null } },
    select: {
      id: true, name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true,
      space: { select: { id: true, name: true, visibility: true, personalOwnerId: true, featureConfig: true } },
    },
  })
  for (const node of nodes) {
    if (!node.space || !spaceIsPublicSource(node.space)) continue
    // A follower mirrors the record — feeding it back would only echo.
    const mode = ((node.metadata as Record<string, unknown> | null) ?? {})[GLOBAL_MODE_KEY]
    if (mode === 'follow') continue
    sources.push({
      kind: 'node',
      spaceId: node.space.id,
      spaceName: node.space.name,
      nodeId: node.id,
      name: node.name,
      subtitle: node.subtitle,
      location: node.location,
      url: node.url,
      imageUrl: node.imageUrl,
      tags: node.tags ?? [],
    })
  }

  return { canonicalName: identity.canonicalName, sources }
}

/**
 * Rebuild the global record for one identity from its public sources, then
 * push the node fields to every follower. Returns the record, or null when the
 * identity has nothing public (no record is created for a person who only
 * exists in private spaces — that is the privacy guarantee, not an omission).
 */
async function syncGlobalRecord(identityId: string): Promise<GlobalRecordRef | null> {
  const loaded = await loadSources(identityId)
  if (!loaded) return null
  const existing = await prisma.node.findFirst({
    where: { spaceId: GLOBAL_SPACE_ID, identityId },
    select: { id: true, metadata: true },
  })
  const existingMeta = ((existing?.metadata as Record<string, unknown> | null) ?? {})
  if (loaded.sources.length === 0) {
    // Nothing public any more. The record stays (followers still hold it and a
    // person's prose is theirs) but its gathered facts go.
    if (!existing) return null
  }
  await ensureGlobalSpace()

  const record = aggregateGlobalRecord(loaded.sources, loaded.canonicalName)
  const sync = await syncEntityNode({
    spaceId: GLOBAL_SPACE_ID,
    type: 'person',
    nodeId: existing?.id ?? null,
    name: record.fields.name,
    slugSource: record.fields.name,
    subtitle: record.fields.subtitle,
    location: record.fields.location,
    url: record.fields.url,
    imageUrl: record.fields.imageUrl,
    tags: record.fields.tags,
    metadata: { ...existingMeta, identityId },
    skipNote: true,
    actor: GLOBAL_ACTOR,
    revalidate: false,
  })
  if (!existing) {
    await prisma.node.update({ where: { id: sync.nodeId }, data: { identityId } })
  }

  const path = entityNotePath({ id: sync.nodeId, type: 'person', metadata: { ...existingMeta, identityId } })
  if (path) {
    const current = await readNoteOrNull(GLOBAL_CONTEXT, path)
    const block = renderGlobalBlock(record)
    if (current === null) {
      const content = joinFrontmatter(
        {
          type: 'Person',
          title: record.fields.name,
          node: sync.nodeId,
          tags: ['person', ...record.fields.tags.filter((t) => t.toLowerCase() !== 'person')],
        },
        applyGlobalBlock('', block),
      )
      await writeNote(GLOBAL_CONTEXT, path, content, GLOBAL_ACTOR, 'baseline')
    } else {
      const fm = parseFrontmatter(current)
      const { body } = splitFrontmatter(current)
      const next = joinFrontmatter({ ...fm, title: record.fields.name, node: sync.nodeId }, applyGlobalBlock(body, block))
      if (next !== current) await writeNote(GLOBAL_CONTEXT, path, next, GLOBAL_ACTOR, 'baseline')
    }
  }

  await pushFieldsToFollowers(identityId, record.fields)
  const ref = await globalRecordOf(identityId)
  return ref
}

/** Best-effort variant for write paths whose own save already landed. */
export async function syncGlobalRecordSafe(identityId: string | null | undefined): Promise<void> {
  if (!identityId) return
  try {
    await syncGlobalRecord(identityId)
  } catch (err) {
    logger.error('global.record.sync.failed', { err, identityId })
  }
}

/** The identity a user has claimed, if any. */
export async function syncGlobalRecordForUser(userId: string): Promise<void> {
  const identity = await prisma.identity.findUnique({ where: { userId }, select: { id: true } })
  await syncGlobalRecordSafe(identity?.id)
}

/**
 * A follower's node fields mirror the record. Its NOTE follows through the
 * publication lib/global/binding.ts created; the node columns have no such
 * channel, so they are written here.
 */
async function pushFieldsToFollowers(
  identityId: string,
  fields: { name: string; subtitle: string | null; location: string | null; url: string | null; imageUrl: string | null; tags: string[] },
): Promise<void> {
  const followers = await prisma.node.findMany({
    where: {
      identityId,
      spaceId: { not: GLOBAL_SPACE_ID },
      metadata: { path: [GLOBAL_MODE_KEY], equals: 'follow' },
    },
    select: { id: true },
  })
  if (!followers.length) return
  await prisma.node.updateMany({
    where: { id: { in: followers.map((f) => f.id) } },
    data: {
      name: fields.name,
      subtitle: fields.subtitle,
      location: fields.location,
      url: fields.url,
      imageUrl: fields.imageUrl,
      tags: fields.tags,
    },
  })
}

/** Every identity that has anything public: rebuild them all (seed, backfill). */
export async function rebuildGlobalRecords(): Promise<{ identities: number; records: number }> {
  await ensureGlobalSpace()
  const rows = await prisma.identity.findMany({ where: { kind: 'person' }, select: { id: true } })
  let records = 0
  for (const row of rows) {
    const ref = await syncGlobalRecord(row.id)
    if (ref) records++
  }
  return { identities: rows.length, records }
}
