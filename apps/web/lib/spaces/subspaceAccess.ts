// The database side of sub-spaces (docs/sub-spaces.md): which sub-spaces a
// space holds, whether one may be created, and the sibling-name check. The
// rules are pure, in lib/spaces/subspaces.ts; the read-through of a public
// sub-space's context is lib/notes/federation.ts.
import prisma from '@/lib/prisma'
import { LEVEL_VIEW } from '@/lib/notes/shared/authz'
import { isGlobalSpace } from './globalSpace'
import { normalizePublicName } from './publicName'
import {
  asDoor,
  flowsContext,
  flowsEvents,
  flowsPeople,
  joinOutcome,
  listingOf,
  parentDenial,
  siblingNameTakenMessage,
  type Door,
  type Listing,
  type SubspaceJoinOutcome,
} from './subspaces'

export interface SubspaceRow {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  visibility: string
  parentId: string | null
  listing: Listing
  houseDoor: Door
  worldDoor: Door
  flowContext: boolean
  flowEvents: boolean
  flowPeople: boolean
  parentAdmins: boolean
  memberCount: number
  createdAt: Date
}

/** The dial columns, selected wherever a rule about a room is decided. */
export const DIAL_SELECT = {
  visibility: true,
  parentId: true,
  listing: true,
  houseDoor: true,
  worldDoor: true,
  flowContext: true,
  flowEvents: true,
  flowPeople: true,
  parentAdmins: true,
} as const

const SUBSPACE_SELECT = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  ...DIAL_SELECT,
  createdAt: true,
  _count: { select: { members: { where: { status: 'active' as const } } } },
} as const

function toRow(s: {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  visibility: string
  parentId: string | null
  listing: string
  houseDoor: string
  worldDoor: string
  flowContext: boolean
  flowEvents: boolean
  flowPeople: boolean
  parentAdmins: boolean
  createdAt: Date
  _count: { members: number }
}): SubspaceRow {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    imageUrl: s.imageUrl,
    visibility: s.visibility,
    parentId: s.parentId,
    listing: listingOf(s),
    houseDoor: asDoor(s.houseDoor, 'ask'),
    worldDoor: asDoor(s.worldDoor, 'open'),
    flowContext: s.flowContext,
    flowEvents: s.flowEvents,
    flowPeople: s.flowPeople,
    parentAdmins: s.parentAdmins,
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
  return subspacesWhere(parentId, flowsContext)
}

/** The sub-spaces whose public EVENTS flow up (the room's `flowEvents`). */
export async function eventFlowingSubspacesOf(parentId: string): Promise<Array<{ id: string; name: string }>> {
  return subspacesWhere(parentId, flowsEvents)
}

/** The sub-spaces whose directory flows up (the room's `flowPeople`). */
export async function peopleFlowingSubspacesOf(parentId: string): Promise<Array<{ id: string; name: string }>> {
  return subspacesWhere(parentId, flowsPeople)
}

async function subspacesWhere(
  parentId: string,
  rule: (row: { visibility: string; parentId: string | null; listing: string; flowContext: boolean; flowEvents: boolean; flowPeople: boolean }) => boolean,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.space.findMany({
    where: { parentId },
    select: { id: true, name: true, ...DIAL_SELECT },
    orderBy: { name: 'asc' },
  })
  return rows.filter(rule).map(({ id, name }) => ({ id, name }))
}

/**
 * The space `childId` sits inside, or null for a top-level space. The read
 * every downward flow starts from (lib/notes/federation.ts#parentReader):
 * no visibility predicate, because the sub-space's members are inside the
 * house already — what crosses is decided by the flag on each shared note,
 * not by the parent's door.
 */
export async function parentOfSubspace(childId: string): Promise<{ id: string; name: string } | null> {
  const row = await prisma.space.findUnique({
    where: { id: childId },
    select: { parent: { select: { id: true, name: true } } },
  })
  return row?.parent ?? null
}

/**
 * `childId` as a sub-space of `parentId` whose context flows up, or null —
 * the one check every read-through makes before opening the sub-space's
 * context under the parent's principal.
 */
export async function flowingSubspace(parentId: string, childId: string): Promise<{ id: string; name: string } | null> {
  const row = await prisma.space.findUnique({
    where: { id: childId },
    select: { id: true, name: true, ...DIAL_SELECT },
  })
  if (!row || row.parentId !== parentId || !flowsContext(row)) return null
  return { id: row.id, name: row.name }
}

/**
 * A private sub-space as a member of its PARENT sees it: the name, what it is
 * for, how many people are in it — and nothing else. Never the aliases, the
 * tool config or a line of its context, which is why this is its own shape
 * rather than a `Space` with fields blanked out (the same discipline
 * lib/connectors/service.ts#listHiddenConnectors keeps).
 *
 * `requested` is this caller's own pending membership, so the row can say
 * "asked" instead of offering the button a second time.
 */
export interface LockedSubspace {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  parentId: string
  memberCount: number
  requested: boolean
  /** 'parent' = a member of the parent walks straight in; the door reads "Join". */
  /** The door for the parent's members — 'open' is the row that says Join instead of Ask. */
  houseDoor: Door
}

const LOCKED_SELECT = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  parentId: true,
  houseDoor: true,
  _count: { select: { members: { where: { status: 'active' as const } } } },
} as const

/**
 * Every private sub-space `userId` can SEE but not enter: one sitting under a
 * space they are an active member of, which they do not belong to themselves.
 *
 * A private sub-space is closed, not secret. Hiding it entirely was the older
 * behaviour and it left a member with no way to discover the room they were
 * meant to be in, let alone ask — so the parent's members are told it exists
 * and are given the door. What is behind the door is untouched: no context, no
 * members, no config crosses until an admin of the sub-space approves.
 *
 * Standing in the parent is what earns the sight of it — discovering the
 * parent (public, unjoined) does not.
 */
export async function listLockedSubspaces(
  userId: string,
  parentId?: string,
): Promise<LockedSubspace[]> {
  const rows = await prisma.space.findMany({
    where: {
      visibility: 'private',
      // A secret room is not a door: nothing names it (lib/spaces/subspaces.ts#listingOf).
      listing: { not: 'secret' },
      parentId: parentId ?? { not: null },
      personalOwnerId: null,
      // Standing in the parent...
      parent: { members: { some: { userId, status: 'active' } } },
      // ...and not already inside. A pending row stays visible: that is the
      // one that reads "asked".
      members: { none: { userId, status: 'active' } },
    },
    select: {
      ...LOCKED_SELECT,
      // The caller's own membership row, if any — a filtered relation rather
      // than a second query, so "asked" costs nothing.
      members: { where: { userId }, select: { status: true }, take: 1 },
    },
    orderBy: { name: 'asc' },
  })
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    imageUrl: s.imageUrl,
    parentId: s.parentId ?? '',
    memberCount: s._count.members,
    requested: s.members.length > 0,
    houseDoor: asDoor(s.houseDoor, 'ask'),
  }))
}

/**
 * What pressing Join on `spaceId` writes for `userId` — deny, a pending
 * request, or an active membership — per lib/spaces/subspaces.ts#joinOutcome:
 * the house door for an active member of the parent, the world door for
 * everyone else. One read, so the door is exactly as wide as the listing.
 */
export async function selfJoinOutcome(spaceId: string, userId: string): Promise<SubspaceJoinOutcome> {
  const row = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { ...DIAL_SELECT, personalOwnerId: true },
  })
  if (!row) return 'deny'
  const standing = row.parentId
    ? await prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId: row.parentId } },
        select: { status: true },
      })
    : null
  return joinOutcome(row, standing?.status ?? null)
}

/**
 * The root space-wide view grant a public sub-space needs to flow anything up
 * — created here as well as in provisionSpace, because a sub-space is usually
 * born private and made public later.
 *
 * Without it the parent grafts the folder and reads it under a principal
 * holding no grants (lib/notes/federation.ts#subspaceReader), so members of the
 * parent get an empty `spaces/<id>/` with nothing to explain it. Idempotent,
 * and it never widens an existing grant: admins of the sub-space may narrow or
 * revoke this one afterwards and a later toggle must not undo that.
 */
export async function ensureFlowUpGrant(spaceId: string, grantedBy: string): Promise<void> {
  const identity = {
    spaceId,
    subjectType: 'space',
    subjectId: '',
    resourcePath: '',
  }
  const existing = await prisma.contextGrant.findUnique({
    where: { grant_identity: identity },
    select: { id: true },
  })
  if (existing) return
  await prisma.contextGrant.create({ data: { ...identity, level: LEVEL_VIEW, grantedBy } })
}
