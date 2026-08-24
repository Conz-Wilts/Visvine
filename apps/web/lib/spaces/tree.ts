// The database side of nested spaces (docs/sub-spaces.md): ancestor and
// descendant walks, sibling-name lookups, and the membership invariant that a
// child's member is a member of its parent. The rules themselves are pure, in
// lib/spaces/hierarchy.ts.
import prisma from '@/lib/prisma'
import { isGlobalSpace } from './globalSpace'
import {
  MAX_SPACE_DEPTH,
  parentDenial,
  normalizePublicName,
  siblingNameTakenMessage,
} from './hierarchy'

export interface SpaceLineage {
  id: string
  name: string
  parentId: string | null
  visibility: string
  personalOwnerId: string | null
}

const LINEAGE_SELECT = { id: true, name: true, parentId: true, visibility: true, personalOwnerId: true } as const

/**
 * The space and every ancestor above it, nearest first. Depth is capped, so
 * this is at most MAX_SPACE_DEPTH small queries; a cycle (impossible through
 * the app, possible by hand) stops the walk rather than spinning.
 */
export async function ancestorsOf(spaceId: string): Promise<SpaceLineage[]> {
  const out: SpaceLineage[] = []
  const seen = new Set<string>()
  let cur: string | null = spaceId
  while (cur && !seen.has(cur) && out.length <= MAX_SPACE_DEPTH) {
    seen.add(cur)
    const row: SpaceLineage | null = await prisma.space.findUnique({ where: { id: cur }, select: LINEAGE_SELECT })
    if (!row) break
    out.push(row)
    cur = row.parentId
  }
  return out
}

/**
 * spaceId → ids of its ancestors (nearest first), for many spaces in a few
 * queries rather than one walk each. Used by the batched admin check.
 */
export async function ancestorIdsOf(spaceIds: string[]): Promise<Map<string, string[]>> {
  const parentOf = new Map<string, string | null>()
  let frontier = [...new Set(spaceIds)]
  for (let depth = 0; frontier.length && depth < MAX_SPACE_DEPTH; depth++) {
    const rows = await prisma.space.findMany({
      where: { id: { in: frontier } },
      select: { id: true, parentId: true },
    })
    frontier = []
    for (const r of rows) {
      parentOf.set(r.id, r.parentId)
      if (r.parentId && !parentOf.has(r.parentId)) frontier.push(r.parentId)
    }
  }
  const out = new Map<string, string[]>()
  for (const id of spaceIds) {
    const chain: string[] = []
    let cur = parentOf.get(id) ?? null
    while (cur && !chain.includes(cur)) {
      chain.push(cur)
      cur = parentOf.get(cur) ?? null
    }
    out.set(id, chain)
  }
  return out
}

/** Every space below `spaceId`, children before their parents (delete order). */
export async function descendantsOf(spaceId: string): Promise<Array<{ id: string; parentId: string | null; name: string }>> {
  const out: Array<{ id: string; parentId: string | null; name: string }> = []
  let frontier = [spaceId]
  const seen = new Set<string>([spaceId])
  while (frontier.length) {
    const rows = await prisma.space.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, parentId: true, name: true },
    })
    frontier = []
    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
      frontier.push(r.id)
    }
  }
  return out.reverse()
}

/**
 * Why `parentId` cannot take a new child, or null when it can. Unknown parent
 * is a denial too — the caller has already 404'd a space it could not resolve,
 * so this only ever reads as "no".
 */
export async function childOfDenial(parentId: string): Promise<string | null> {
  const chain = await ancestorsOf(parentId)
  const parent = chain[0]
  if (!parent || parent.id !== parentId) return 'Unknown space'
  return parentDenial({
    personalOwnerId: parent.personalOwnerId,
    isGlobal: isGlobalSpace(parent.id),
    depth: chain.length,
  })
}

/**
 * The sibling already using `name` under `parentId`, or null. Compared in JS
 * on the same key as the partial index, for the same reason as
 * findPublicNameConflict: the whitespace collapse is not expressible in Prisma.
 */
export async function findSiblingNameConflict(
  parentId: string,
  name: string,
  excludeId?: string,
): Promise<{ id: string; name: string; message: string } | null> {
  const key = normalizePublicName(name)
  if (!key) return null
  const [siblings, parent] = await Promise.all([
    prisma.space.findMany({
      where: { parentId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true },
    }),
    prisma.space.findUnique({ where: { id: parentId }, select: { name: true } }),
  ])
  const hit = siblings.find((s) => normalizePublicName(s.name) === key)
  return hit ? { ...hit, message: siblingNameTakenMessage(hit.name, parent?.name ?? 'This space') } : null
}

/** Whether the user holds an ACTIVE membership in `spaceId`. */
export async function isActiveMemberOf(userId: string, spaceId: string): Promise<boolean> {
  const row = await prisma.spaceMember.findFirst({
    where: { userId, spaceId, status: 'active' },
    select: { id: true },
  })
  return row !== null
}

/**
 * Leaving (or being removed from) a space leaves every space inside it too —
 * membership of a child is only ever held through membership of the parent.
 * Returns the ids the membership was dropped from, so the caller can clear
 * context access there as well.
 */
export async function removeFromDescendants(spaceId: string, userId: string): Promise<string[]> {
  const below = await descendantsOf(spaceId)
  if (!below.length) return []
  const ids = below.map((s) => s.id)
  await prisma.spaceMember.deleteMany({ where: { userId, spaceId: { in: ids } } })
  await prisma.userAlias.deleteMany({ where: { userId, spaceId: { in: ids } } })
  await prisma.contextGrant.deleteMany({
    where: { spaceId: { in: ids }, subjectType: 'user', subjectId: userId },
  })
  return ids
}
