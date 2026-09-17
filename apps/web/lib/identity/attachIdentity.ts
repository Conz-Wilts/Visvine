// Attaching a freshly-created directory node to its canonical cross-space
// Identity. Extracted from app/api/data/nodes/route.ts so the note-first create
// endpoint (app/api/directory/entities/route.ts) runs the SAME resolution — two
// copies of this would drift, and the failure mode is silent: a node that simply
// never merges with its identity, with no error anywhere.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { NBNode } from '@/lib/types'
import { entityKindOf } from '@/lib/notes/entities'
import { isOwnSpaceNode } from '@/lib/types/context'
import { tryResolveIdentity, confirmIdentity, type ResolveResult } from './resolve'
import type { IdentityKind } from './match'
import { familyIdentityFor } from './family'
import { nameKey } from './normalize'

/**
 * Which canonical-identity kind (if any) a node participates in.
 *
 * `Identity.kind` keeps its internal 'organization' spelling — it is a matching
 * rule (website domains, no email), not a display label, and renaming it would
 * churn every stored row for nothing.
 *
 * The space's own root node is excluded: it is the space you are in,
 * not an organisation recorded inside it, and merging those across spaces
 * would collapse unrelated spaces onto one identity.
 */
function identityKindFor(node: { id: string; type: string; space_id?: string | null }): IdentityKind | null {
  const t = node.type.toLowerCase()
  if (t === 'person' || t === 'people') return 'person'
  if (entityKindOf(t) === 'space') {
    return isOwnSpaceNode({ id: node.id, spaceId: node.space_id }) ? null : 'organization'
  }
  return null
}

export interface AttachIdentityResult {
  identityId: string | null
  /** Possible-match suggestions for inline confirmation; null when an explicit pick won. */
  resolution: ResolveResult | null
}

/**
 * Resolve the identity for a node about to be (or just) created.
 *
 * An explicit `identityId` from the finder is a human choice, so it's trusted and
 * recorded as confirmed. Without one the server resolves on its own — the client
 * can never silently force a merge.
 *
 * Returns `{ identityId: null, resolution: null }` for types with no identity
 * (resources, events, space-invented types, and a space's own node).
 */
export async function attachIdentity(
  node: Pick<NBNode, 'id' | 'type' | 'name' | 'url' | 'location' | 'metadata' | 'space_id'>,
  opts: { identityId?: string | null; actorUserId?: string | null } = {},
): Promise<AttachIdentityResult> {
  const kind = identityKindFor(node)
  if (!kind) return { identityId: null, resolution: null }

  const meta = (node.metadata as Record<string, unknown>) ?? {}
  const actorUserId = opts.actorUserId ?? null

  if (opts.identityId) {
    // Honour the explicit pick from the finder if it exists.
    const chosen = await prisma.identity.findFirst({
      where: { id: opts.identityId, kind },
      select: { id: true },
    })
    if (chosen) {
      await confirmIdentity(node.id, chosen.id, { actorUserId, reason: 'picked from finder' })
      return { identityId: chosen.id, resolution: null }
    }
  }

  // The same person elsewhere in this space's family (family.ts): a room
  // adding someone its house already holds, or the reverse, joins that record
  // instead of starting a second one.
  if (kind === 'person') {
    const familyId = await familyIdentitySafe(node, meta)
    if (familyId) {
      await confirmIdentity(node.id, familyId, { actorUserId, reason: 'same person in this space family' })
      return { identityId: familyId, resolution: null }
    }
  }

  const resolution = await tryResolveIdentity(
    node.id,
    {
      kind,
      name: node.name,
      // Only EXPLICIT signals feed matching — never coerce subtitle into a
      // company, which would risk auto-merging two same-named people.
      email: kind === 'person' ? ((meta.email as string) ?? null) : null,
      linkedinUrl: (meta.linkedinUrl as string) ?? null,
      website:
        kind === 'organization'
          ? (((meta.website as string) ?? (meta.url as string) ?? node.url) ?? null)
          : null,
      company: kind === 'person' ? ((meta.companyName as string) ?? null) : null,
      location: node.location ?? null,
    },
    { actorUserId },
  )

  return { identityId: resolution?.identityId ?? null, resolution }
}

/** The spaces one family spans: the house and every room under it. */
async function familySpaceIds(spaceId: string): Promise<string[]> {
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { parentId: true } })
  if (!space) return []
  const house = space.parentId ?? spaceId
  const rooms = await prisma.space.findMany({ where: { parentId: house }, select: { id: true } })
  return [house, ...rooms.map((r) => r.id)]
}

async function familyIdentitySafe(
  node: Pick<NBNode, 'id' | 'name' | 'space_id'>,
  meta: Record<string, unknown>,
): Promise<string | null> {
  if (!node.space_id) return null
  try {
    const family = (await familySpaceIds(node.space_id)).filter((id) => id !== node.space_id)
    if (family.length === 0) return null
    const [rows, refused] = await Promise.all([
      prisma.node.findMany({
        where: {
          spaceId: { in: family },
          identityId: { not: null },
          type: { in: ['person', 'Person', 'people', 'People'] },
          OR: [
            { name: { equals: node.name.trim(), mode: 'insensitive' } },
            { identity: { nameKey: nameKey(node.name) } },
          ],
        },
        select: { name: true, identityId: true, identity: { select: { canonicalName: true } } },
        take: 50,
      }),
      prisma.identityResolution.findMany({
        where: { nodeId: node.id, decision: { in: ['rejected', 'split'] } },
        select: { identityId: true },
      }),
    ])
    // A node may be renamed locally, so the identity's canonical name speaks for it too.
    const candidates = rows.flatMap((r) => {
      const identityId = r.identityId as string
      return [r.name, r.identity?.canonicalName ?? ''].map((name) => ({ identityId, name }))
    })
    const rejected = new Set(refused.map((r) => r.identityId).filter((x): x is string => !!x))
    return familyIdentityFor(
      { name: node.name, email: (meta.email as string) ?? null, linkedinUrl: (meta.linkedinUrl as string) ?? null },
      candidates,
      rejected,
    )
  } catch (err) {
    logger.error('identity.family.failed', { err, nodeId: node.id })
    return null
  }
}
