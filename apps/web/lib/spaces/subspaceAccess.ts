// The database side of sub-spaces (docs/sub-spaces.md): which sub-spaces a
// space holds, whether one may be created, and the sibling-name check. The
// rules are pure, in lib/spaces/subspaces.ts; the read-through of a public
// sub-space's context is lib/notes/federation.ts.
import prisma from '@/lib/prisma'
import { isGlobalSpace } from './globalSpace'
import { normalizePublicName } from './publicName'
import { flowsUp, parentDenial, siblingNameTakenMessage } from './subspaces'

export interface SubspaceRow {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  visibility: string
  memberCount: number
  createdAt: Date
}

const SUBSPACE_SELECT = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  visibility: true,
  createdAt: true,
  _count: { select: { members: { where: { status: 'active' as const } } } },
} as const

function toRow(s: {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  visibility: string
  createdAt: Date
  _count: { members: number }
}): SubspaceRow {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    imageUrl: s.imageUrl,
    visibility: s.visibility,
    memberCount: s._count.members,
    createdAt: s.createdAt,
  }
}

/**
 * Why `parentId` cannot take a sub-space, or null when it can. An unknown
 * parent is a denial too: the caller has already 404'd a space it could not
 * resolve, so this only ever reads as "no".
 */
export async function subspaceParentDenial(parentId: string): Promise<string | null> {
  const parent = await prisma.space.findUnique({
    where: { id: parentId },
    select: { parentId: true, personalOwnerId: true },
  })
  if (!parent) return 'Unknown space'
  return parentDenial({ ...parent, isGlobal: isGlobalSpace(parentId) })
}

/**
 * The sibling already using `name` under `parentId`, or null. Compared in JS
 * on the same key as the partial index (migration 20260910120000), for the
 * same reason as findPublicNameConflict: the whitespace collapse is not
 * expressible in Prisma, and siblings are few.
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

/** Every sub-space of `parentId`, by name. */
export async function listSubspaces(parentId: string): Promise<SubspaceRow[]> {
  const rows = await prisma.space.findMany({
    where: { parentId },
    select: SUBSPACE_SELECT,
    orderBy: { name: 'asc' },
  })
  return rows.map(toRow)
}

/**
 * The sub-spaces of `parentId` whose context flows up into it — the public
 * ones (lib/spaces/subspaces.ts#flowsUp). A space with no sub-spaces, or one
 * that is itself a sub-space, gets an empty list without a query for the
 * second: nesting is one level, so nothing can be under it.
 */
export async function flowingSubspacesOf(parentId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.space.findMany({
    where: { parentId, visibility: 'public' },
    select: { id: true, name: true, visibility: true },
    orderBy: { name: 'asc' },
  })
  return rows.filter(flowsUp).map(({ id, name }) => ({ id, name }))
}

/**
 * `childId` as a sub-space of `parentId` whose context flows up, or null —
 * the one check every read-through makes before opening the sub-space's
 * context under the parent's principal.
 */
export async function flowingSubspace(parentId: string, childId: string): Promise<{ id: string; name: string } | null> {
  const row = await prisma.space.findUnique({
    where: { id: childId },
    select: { id: true, name: true, parentId: true, visibility: true },
  })
  if (!row || row.parentId !== parentId || !flowsUp(row)) return null
  return { id: row.id, name: row.name }
}
