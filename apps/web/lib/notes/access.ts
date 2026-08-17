// The DB side of the grant-based access model (shared/authz.ts holds the pure
// checks). Loads the caller's pre-scoped ContextAccess per request, seeds a
// space's grant rows on first touch (from the `folders.json` registry when one
// exists, otherwise from current membership), and owns every grant/boundary mutation so they're validated and audited in
// one place. Grants apply to SHARED contexts only; personal spaces bypass the
// model entirely (lib/notes/principal.ts#OPEN_ACCESS).

import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY } from './store'
import { readJson, writeJson } from './sidecar'
import { resolveRegistry } from './registry'
import { logAudit } from './audit'
import {
  LEVEL_EDIT,
  LEVEL_FULL,
  SUBJECT_TYPES,
  levelName,
  migrateLegacyRegistry,
  grantReaches,
  winningGrant,
  type AccessGrant,
  type ContextAccess,
  type GrantSubjectType,
} from './shared/authz'
import { loadAliasSummaries, loadPersonAliases } from './aliases'
import { holdsOwner } from './shared/aliases'
import { findAliasByRef, type SpaceAlias } from '@/lib/types/context'

const STATE_FILE = 'access-state.json'

interface AccessState {
  seededAt?: number
  /** 'aliases' = born after the alias model, so nothing to grandfather. */
  seededFrom?: 'registry' | 'grandfather' | 'aliases'
}

// Seeding runs at most once per space per process; the sidecar marker makes
// it at most once ever (racing instances collide on unique keys harmlessly).
const seeded = new Set<string>()

function sharedContext(spaceId: string) {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/** Normalize a grant/boundary resource path ('' = the context root is valid). */
export function normalizeResourcePath(input: string): string {
  const norm = input
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
    .trim()
  if (norm.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error(`Invalid resource path: ${input}`)
  }
  return norm
}

// seeding (legacy migration / grandfathering)

/**
 * Mark a space's access as already established, so ensureAccessSeeded never
 * grandfathers it. Spaces born after the alias model get this at creation:
 * their standing comes entirely from aliases, and grandfathering would hand a
 * root grant to whoever happened to be a member on first context touch — which
 * would swamp every alias grant with blanket edit-everywhere.
 */
export async function markAccessSeeded(spaceId: string): Promise<void> {
  await writeJson(sharedContext(spaceId), STATE_FILE, {
    seededAt: Date.now(),
    seededFrom: 'aliases',
  } satisfies AccessState)
  seeded.add(spaceId)
}

/**
 * Make sure a normal space's grant rows exist, exactly once:
 * - a legacy `folders.json` registry migrates via authz.migrateLegacyRegistry
 *   (member levels → grants, private folders → restricted, locks carried);
 * - a space with no registry grandfathers its CURRENT active members at the
 *   root (holders of an owner alias full, everyone else edit) — the old ensureContextGate
 *   behavior: joining later grants nothing until someone shares.
 * Personal spaces must never call this (they are never gated).
 */
export async function ensureAccessSeeded(spaceId: string): Promise<void> {
  if (seeded.has(spaceId)) return
  const state = await readJson<AccessState>(sharedContext(spaceId), STATE_FILE, {})
  if (state.seededAt) {
    seeded.add(spaceId)
    return
  }

  const registry = await resolveRegistry(spaceId)
  let seededFrom: AccessState['seededFrom']
  if (registry.folders.length > 0) {
    seededFrom = 'registry'
    const migrated = migrateLegacyRegistry(registry)
    if (migrated.grants.length) {
      await prisma.contextGrant.createMany({
        data: migrated.grants.map((g) => ({
          spaceId,
          subjectType: g.subjectType,
          subjectId: g.subjectId,
          resourcePath: g.resourcePath,
          level: g.level,
          grantedBy: g.grantedBy,
        })),
        skipDuplicates: true,
      })
    }
    for (const path of migrated.restricted) {
      await upsertFolderFlags(spaceId, path, { restricted: true })
    }
    for (const path of migrated.locked) {
      await upsertFolderFlags(spaceId, path, { locked: true })
    }
  } else {
    seededFrom = 'grandfather'
    const [memberships, aliases] = await Promise.all([
      prisma.spaceMember.findMany({
        where: { spaceId, status: 'active' },
        select: { userId: true },
      }),
      loadAliasSummaries(spaceId),
    ])
    if (memberships.length) {
      await prisma.contextGrant.createMany({
        data: memberships.map((m) => ({
          spaceId,
          subjectType: 'user',
          subjectId: m.userId,
          resourcePath: '',
          level: holdsOwner(aliases, m.userId) ? LEVEL_FULL : LEVEL_EDIT,
          grantedBy: 'system',
        })),
        skipDuplicates: true,
      })
    }
  }

  await writeJson(sharedContext(spaceId), STATE_FILE, {
    seededAt: Date.now(),
    seededFrom,
  } satisfies AccessState)
  seeded.add(spaceId)
}

// loading

interface FolderFlags {
  restricted: string[]
  locked: string[]
}

async function loadFolderFlags(spaceId: string): Promise<FolderFlags> {
  const rows = await prisma.contextFolder.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      OR: [{ restricted: true }, { locked: true }],
    },
    select: { path: true, restricted: true, locked: true },
  })
  return {
    restricted: rows.filter((r) => r.restricted).map((r) => r.path),
    locked: rows.filter((r) => r.locked).map((r) => r.path),
  }
}

/** The Person alias ids the user holds inside this space. */
async function aliasIdsOf(spaceId: string, userId: string): Promise<string[]> {
  const rows = await prisma.userAlias.findMany({
    where: { userId, spaceId },
    select: { aliasId: true },
  })
  return rows.map((r) => r.aliasId)
}

/**
 * The pre-scoped ContextAccess for one member: space-wide grants + their
 * aliases' grants + their direct grants, plus the context's folder boundaries.
 * A handful of indexed rows — this is the whole per-request cost.
 */
export async function contextAccessFor(spaceId: string, userId: string): Promise<ContextAccess> {
  const aliasIds = await aliasIdsOf(spaceId, userId)
  const [rows, flags] = await Promise.all([
    prisma.contextGrant.findMany({
      where: {
        spaceId,
        OR: [
          { subjectType: 'space' },
          { subjectType: 'user', subjectId: userId },
          ...(aliasIds.length
            ? [{ subjectType: 'alias' as const, subjectId: { in: aliasIds } }]
            : []),
        ],
      },
      select: { subjectType: true, subjectId: true, resourcePath: true, level: true },
    }),
    loadFolderFlags(spaceId),
  ])
  return {
    grants: rows.map((r) => ({
      subjectType: r.subjectType as GrantSubjectType,
      subjectId: r.subjectId,
      resourcePath: r.resourcePath,
      level: r.level,
    })),
    restricted: flags.restricted,
    locked: flags.locked,
  }
}

/** A stored grant row (id + provenance on top of the pure AccessGrant shape). */
export interface GrantRow extends AccessGrant {
  id: string
  grantedBy: string
  createdAt: number
}

export interface SpaceAccess extends FolderFlags {
  grants: GrantRow[]
}

/** EVERY grant row + folder boundary of a space — overview/Share surfaces. */
export async function loadSpaceAccess(spaceId: string): Promise<SpaceAccess> {
  const [rows, flags] = await Promise.all([
    prisma.contextGrant.findMany({
      where: { spaceId },
      orderBy: [{ resourcePath: 'asc' }, { createdAt: 'asc' }],
    }),
    loadFolderFlags(spaceId),
  ])
  return {
    grants: rows.map((r) => ({
      id: r.id,
      subjectType: r.subjectType as GrantSubjectType,
      subjectId: r.subjectId,
      resourcePath: r.resourcePath,
      level: r.level,
      grantedBy: r.grantedBy,
      createdAt: r.createdAt.getTime(),
    })),
    restricted: flags.restricted,
    locked: flags.locked,
  }
}

// who-has-access (the Share panel's merged list)

export interface AccessListEntry {
  subjectType: GrantSubjectType
  subjectId: string
  /** Display name: the space's name, the alias's name, or the member's. */
  name: string
  email?: string
  /** Effective level from this subject's own reaching grants (max). */
  level: number
  levelName: string | null
  /** Provenance: the winning grant's resource path ('' = context root). */
  via: string
  /** The subject's grant rows that reach the path (for revoke UI). */
  grants: Array<{ id: string; resourcePath: string; level: number }>
}

/**
 * The merged "who has access" list for a path: one row per subject holding a
 * reaching grant, with its effective level and the winning grant's provenance.
 * (Space admins additionally always have full access — a UI-copy fact, not
 * a row.) This list IS the audit: every answer is one grant.
 */
export async function accessListFor(spaceId: string, path: string): Promise<AccessListEntry[]> {
  const { grants, restricted } = await loadSpaceAccess(spaceId)
  const reaching = grants.filter((g) => grantReaches(g, path, restricted))
  const bySubject = new Map<string, GrantRow[]>()
  for (const g of reaching) {
    const key = `${g.subjectType}:${g.subjectId}`
    const list = bySubject.get(key) ?? []
    list.push(g)
    bySubject.set(key, list)
  }

  // Alias subjects hold an alias ID, so the display name comes from the
  // space's own vocabulary — one read, not a join.
  const userIds = [...bySubject.keys()]
    .filter((k) => k.startsWith('user:'))
    .map((k) => k.slice('user:'.length))
  const [space, users] = await Promise.all([
    prisma.space.findUnique({ where: { id: spaceId }, select: { name: true, aliases: true } }),
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ])
  const userById = new Map(users.map((u) => [u.id, u]))
  const spaceAliases = (space?.aliases ?? []) as unknown as SpaceAlias[]

  const entries: AccessListEntry[] = []
  for (const rows of bySubject.values()) {
    const [subjectType, subjectId] = [rows[0].subjectType, rows[0].subjectId]
    const win = winningGrant(rows, path, restricted)
    if (!win) continue
    const name =
      subjectType === 'space'
        ? `Everyone in ${space?.name ?? 'this space'}`
        : subjectType === 'alias'
          ? // A grant outlives the alias it names only if the delete cascade
            // failed, so falling back to the id is a diagnostic, not a label.
            (findAliasByRef(spaceAliases, subjectId, 'Person')?.name ?? subjectId)
          : (userById.get(subjectId)?.name ?? 'Former member')
    entries.push({
      subjectType,
      subjectId,
      name,
      email: subjectType === 'user' ? (userById.get(subjectId)?.email ?? undefined) : undefined,
      level: win.level,
      levelName: levelName(win.level),
      via: win.resourcePath,
      grants: rows.map((r) => ({ id: r.id, resourcePath: r.resourcePath, level: r.level })),
    })
  }
  // Broadest audience first (space, aliases, people), then by level desc.
  const order: Record<GrantSubjectType, number> = { space: 0, alias: 1, user: 2 }
  return entries.sort(
    (a, b) => order[a.subjectType] - order[b.subjectType] || b.level - a.level || a.name.localeCompare(b.name),
  )
}

// mutations (validated + audited)

export interface GrantInput {
  subjectType: GrantSubjectType
  subjectId: string
  resourcePath: string
  level: number
}

interface Actor {
  userId: string
  name: string
}

/**
 * Create or update one grant (unique per subject × resource — a re-grant is a
 * level change). Validates the subject really belongs to the space: a user
 * must be an active member, an alias must be the space's. The CALLER's
 * authority (full at the path, or space admin) is checked by the route.
 */
export async function grantAccess(
  spaceId: string,
  input: GrantInput,
  actor: Actor,
): Promise<GrantRow> {
  if (!SUBJECT_TYPES.includes(input.subjectType)) {
    throw new Error(`Unknown subject type: ${input.subjectType}`)
  }
  const resourcePath = normalizeResourcePath(input.resourcePath)
  let subjectId = input.subjectType === 'space' ? '' : input.subjectId
  if (input.subjectType !== 'space' && !subjectId) {
    throw new Error('subjectId is required')
  }
  if (input.subjectType === 'user') {
    const membership = await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: subjectId, spaceId } },
      select: { status: true },
    })
    if (!membership || membership.status !== 'active') {
      throw new Error('That person is not an active member of this space')
    }
  }
  if (input.subjectType === 'alias') {
    // The caller may name the alias or pass its id; the row always stores the
    // id, so the grant survives a rename.
    const alias = findAliasByRef(await loadPersonAliases(spaceId), subjectId, 'Person')
    if (!alias?.id) {
      throw new Error(`Unknown alias "${subjectId}" — add it on the Types page first`)
    }
    subjectId = alias.id
  }

  const row = await prisma.contextGrant.upsert({
    where: {
      grant_identity: {
        spaceId,
        subjectType: input.subjectType,
        subjectId,
        resourcePath,
      },
    },
    create: {
      spaceId,
      subjectType: input.subjectType,
      subjectId,
      resourcePath,
      level: input.level,
      grantedBy: actor.userId,
    },
    update: { level: input.level, grantedBy: actor.userId },
  })
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'grant',
    path: resourcePath,
    detail: `${input.subjectType}${subjectId ? ` ${subjectId}` : ''} → ${levelName(input.level)}`,
  })
  return {
    id: row.id,
    subjectType: row.subjectType as GrantSubjectType,
    subjectId: row.subjectId,
    resourcePath: row.resourcePath,
    level: row.level,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt.getTime(),
  }
}

/** Delete one grant by id (scoped to the space — a foreign id is a no-op). */
export async function revokeAccess(
  spaceId: string,
  grantId: string,
  actor: Actor,
): Promise<boolean> {
  const row = await prisma.contextGrant.findFirst({ where: { id: grantId, spaceId } })
  if (!row) return false
  await prisma.contextGrant.delete({ where: { id: row.id } })
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'grant',
    path: row.resourcePath,
    detail: `revoked ${row.subjectType}${row.subjectId ? ` ${row.subjectId}` : ''} (${levelName(row.level)})`,
  })
  return true
}

async function upsertFolderFlags(
  spaceId: string,
  folderPath: string,
  flags: { restricted?: boolean; locked?: boolean },
): Promise<void> {
  await prisma.contextFolder.upsert({
    where: {
      folder_identity: { spaceId, ownerKey: SHARED_OWNER_KEY, path: folderPath },
    },
    create: { spaceId, ownerKey: SHARED_OWNER_KEY, path: folderPath, ...flags },
    update: flags,
  })
}

/**
 * Restrict / un-restrict a folder: the structural privacy switch. Restricting
 * cuts inheritance at the boundary — only people granted on or inside it keep
 * seeing inside. Implicit (note-derived) folders get their row upserted.
 */
export async function setFolderRestricted(
  spaceId: string,
  folderPath: string,
  restricted: boolean,
  actor: Actor,
): Promise<void> {
  const path = normalizeResourcePath(folderPath)
  if (!path) throw new Error('The context root cannot be restricted')
  await upsertFolderFlags(spaceId, path, { restricted })
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path,
    detail: restricted ? 'restricted' : 'unrestricted',
  })
}

/** Freeze/unfreeze a folder for AI maintenance passes (review fixes, enrichment). */
export async function setFolderLocked(
  spaceId: string,
  folderPath: string,
  locked: boolean,
  actor: Actor,
): Promise<void> {
  const path = normalizeResourcePath(folderPath)
  if (!path) throw new Error('The context root cannot be locked')
  await upsertFolderFlags(spaceId, path, { locked })
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path,
    detail: locked ? 'locked' : 'unlocked',
  })
}

/**
 * Membership-lifecycle cleanup: when someone leaves (or is removed from) a
 * space, their direct grants and the aliases they held there go with them —
 * space/alias grants stop matching by themselves, so nothing else to sweep.
 * The caller must have already checked `adminSurvives` for the departure.
 */
export async function removeMemberAccess(spaceId: string, userId: string): Promise<void> {
  await prisma.contextGrant.deleteMany({
    where: { spaceId, subjectType: 'user', subjectId: userId },
  })
  await prisma.userAlias.deleteMany({ where: { userId, spaceId } })
}
