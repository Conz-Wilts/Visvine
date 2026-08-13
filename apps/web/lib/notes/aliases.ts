// The DB side of Person aliases (shared/aliases.ts holds the pure rules).
//
// The aliases themselves are NOT rows — they live in `Space.aliases`,
// because a space's Person aliases and its permission vocabulary are the
// same list. This module owns their whole life: creating, renaming, recolouring
// and deleting them, who holds each (UserAlias rows), and whether holding one
// means owning the space (the `owner` flag on the stored alias). All of it
// is driven from Console → Aliases.
//
// Because an alias is stored by NAME in three other places — UserAlias.aliasName,
// ContextGrant.subjectId and Node.alias — a rename must carry all three with it and
// a delete must clean all three up. updateAlias and cascadeAliasRemoval are the
// only paths that do so; nothing else should write those columns.
//
// Space admins manage all of it; there is no per-alias manager role.

import prisma from '@/lib/prisma'
import { personAliases, OWNER_ALIAS_NAME, type SpaceAlias } from '@/lib/types/context'
import { logAudit } from './audit'
import {
  LAST_OWNER_MESSAGE,
  SYSTEM_ALIAS_MESSAGE,
  aliasNameError,
  normalizeAliasColor,
  ownerSurvives,
  summarize,
  type AliasChange,
  type AliasSummary,
} from './shared/aliases'

interface AliasHolder {
  userId: string
  name: string
  email: string | null
  image: string | null
}

export interface AliasInfo {
  name: string
  color: string
  /** Whether holding this alias means owning (managing) the space. */
  owner: boolean
  /** The built-in Owner alias: fixed, and rendered in gold. */
  system: boolean
  holders: AliasHolder[]
}

interface Actor {
  userId: string
  name: string
}

/** A space's stored Person aliases, Owner always grafted in. */
export async function loadPersonAliases(spaceId: string): Promise<SpaceAlias[]> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { aliases: true },
  })
  return personAliases((space?.aliases ?? []) as unknown as SpaceAlias[])
}

/** Just enough of every alias to decide the owner invariant. */
export async function loadAliasSummaries(spaceId: string): Promise<AliasSummary[]> {
  const [aliases, holders] = await Promise.all([
    loadPersonAliases(spaceId),
    prisma.userAlias.findMany({ where: { spaceId }, select: { aliasName: true, userId: true } }),
  ])
  return summarize(aliases, holders)
}

/** Throw the shared refusal unless somebody would still manage the space. */
async function assertOwnerSurvives(spaceId: string, change: AliasChange): Promise<void> {
  const aliases = await loadAliasSummaries(spaceId)
  if (!ownerSurvives(aliases, change)) throw new Error(LAST_OWNER_MESSAGE)
}

/** Persist the space's Person aliases, leaving other node types untouched. */
async function writePersonAliases(spaceId: string, next: SpaceAlias[]): Promise<void> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { aliases: true },
  })
  const all = (space?.aliases ?? []) as unknown as SpaceAlias[]
  const others = all.filter((a) => a.nodeType?.toLowerCase() !== 'person')
  await prisma.space.update({
    where: { id: spaceId },
    data: { aliases: [...others, ...next] as unknown as object },
  })
}

/** Every Person alias of a space with its holders (visible to any member). */
export async function listAliases(spaceId: string): Promise<AliasInfo[]> {
  const [aliases, holders] = await Promise.all([
    loadPersonAliases(spaceId),
    prisma.userAlias.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'asc' },
      select: { aliasName: true, userId: true },
    }),
  ])
  const userIds = [...new Set(holders.map((h) => h.userId))]
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, image: true },
      })
    : []
  const userById = new Map(users.map((u) => [u.id, u]))
  return aliases.map((a) => ({
    name: a.name,
    color: a.color,
    owner: a.owner === true || a.system === true,
    system: a.system === true,
    holders: holders
      .filter((h) => h.aliasName === a.name)
      .map((h) => {
        const user = userById.get(h.userId)
        return {
          userId: h.userId,
          name: user?.name ?? 'Former member',
          email: user?.email ?? null,
          image: user?.image ?? null,
        }
      }),
  }))
}

/** The alias by that name, or a "create it first" refusal. */
async function requireAlias(spaceId: string, name: string): Promise<SpaceAlias> {
  const alias = (await loadPersonAliases(spaceId)).find((a) => a.name === name)
  if (!alias) throw new Error(`Unknown alias "${name}" — create it on the Aliases page first`)
  return alias
}

/** The alias list without the built-in Owner, which personAliases() re-grafts. */
function storable(aliases: SpaceAlias[]): SpaceAlias[] {
  return aliases.filter((a) => a.name !== OWNER_ALIAS_NAME)
}

/** Add a Person alias. It starts with no holders, no grants and no ownership. */
export async function createAlias(
  spaceId: string,
  name: string,
  color: string,
  actor: Actor,
): Promise<void> {
  const before = await loadPersonAliases(spaceId)
  const problem = aliasNameError(name, before.map((a) => a.name))
  if (problem) throw new Error(problem)
  const hex = normalizeAliasColor(color)
  if (!hex) throw new Error('Pick a colour for this alias.')

  await writePersonAliases(spaceId, [
    ...storable(before),
    { name: name.trim(), color: hex, nodeType: 'Person' },
  ])

  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: `alias "${name.trim()}" created`,
  })
}

/**
 * Rename and/or recolour a Person alias.
 *
 * A name is not an id here: holders (`UserAlias.aliasName`), grants
 * (`ContextGrant.subjectId`) and directory chips (`Node.alias`) all store it by
 * value, so a rename has to carry all three with it or the alias silently loses
 * its people and its access. One transaction, so it can't half-happen.
 */
export async function updateAlias(
  spaceId: string,
  name: string,
  changes: { newName?: string; color?: string },
  actor: Actor,
): Promise<void> {
  const alias = await requireAlias(spaceId, name)
  const before = await loadPersonAliases(spaceId)

  let hex: string | null = null
  if (changes.color !== undefined) {
    if (alias.system) throw new Error(SYSTEM_ALIAS_MESSAGE)
    hex = normalizeAliasColor(changes.color)
    if (!hex) throw new Error('That is not a valid colour.')
  }

  const nextName = changes.newName?.trim()
  const renaming = nextName !== undefined && nextName !== name
  if (renaming) {
    if (alias.system) throw new Error(SYSTEM_ALIAS_MESSAGE)
    const problem = aliasNameError(nextName, before.map((a) => a.name), name)
    if (problem) throw new Error(problem)
  }

  const next = storable(before).map((a) =>
    a.name === name
      ? { ...a, ...(renaming ? { name: nextName } : {}), ...(hex ? { color: hex } : {}) }
      : a,
  )

  await prisma.$transaction(async (tx) => {
    const space = await tx.space.findUnique({
      where: { id: spaceId },
      select: { aliases: true },
    })
    const all = (space?.aliases ?? []) as unknown as SpaceAlias[]
    const others = all.filter((a) => a.nodeType?.toLowerCase() !== 'person')
    await tx.space.update({
      where: { id: spaceId },
      data: { aliases: [...others, ...next] as unknown as object },
    })
    if (renaming) {
      await tx.userAlias.updateMany({
        where: { spaceId, aliasName: name },
        data: { aliasName: nextName },
      })
      await tx.contextGrant.updateMany({
        where: { spaceId, subjectType: 'alias', subjectId: name },
        data: { subjectId: nextName },
      })
      await tx.node.updateMany({
        where: { spaceId, alias: name },
        data: { alias: nextName },
      })
    }
  })

  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: renaming ? `alias "${name}" renamed to "${nextName}"` : `alias "${name}" recoloured`,
  })
}

/**
 * Delete a Person alias, taking its holders and grants with it so nothing
 * points at a name that no longer exists. Refused if it would leave the
 * space with nobody owning it, or if it's the built-in Owner alias.
 */
export async function deleteAlias(
  spaceId: string,
  name: string,
  actor?: Actor,
): Promise<void> {
  const alias = await requireAlias(spaceId, name)
  if (alias.system) throw new Error(SYSTEM_ALIAS_MESSAGE)
  await assertOwnerSurvives(spaceId, { kind: 'removeAlias', name })

  const before = await loadPersonAliases(spaceId)
  await writePersonAliases(spaceId, storable(before).filter((a) => a.name !== name))
  await cascadeAliasRemoval(spaceId, [name])

  if (actor) {
    void logAudit(spaceId, {
      userId: actor.userId,
      name: actor.name,
      action: 'folder',
      path: '',
      detail: `alias "${name}" deleted`,
    })
  }
}

/** Drop everything keyed to alias names that no longer exist. */
async function cascadeAliasRemoval(spaceId: string, names: string[]): Promise<void> {
  if (!names.length) return
  await prisma.userAlias.deleteMany({ where: { spaceId, aliasName: { in: names } } })
  await prisma.contextGrant.deleteMany({
    where: { spaceId, subjectType: 'alias', subjectId: { in: names } },
  })
}

/** Toggle whether holders of this alias manage the space. */
export async function setAliasOwner(
  spaceId: string,
  name: string,
  owner: boolean,
  actor: Actor,
): Promise<void> {
  const alias = await requireAlias(spaceId, name)
  if (alias.system) throw new Error(SYSTEM_ALIAS_MESSAGE)
  if ((alias.owner === true) === owner) return
  if (!owner) await assertOwnerSurvives(spaceId, { kind: 'setOwner', name, owner: false })

  const next = (await loadPersonAliases(spaceId))
    // Owner is grafted in by personAliases(); it never needs storing back.
    .filter((a) => a.name !== OWNER_ALIAS_NAME)
    .map((a) => (a.name === name ? { ...a, owner } : a))
  await writePersonAliases(spaceId, next)

  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: `alias "${name}" ${owner ? 'now owns' : 'no longer owns'} the space`,
  })
}

/** Give someone an alias — they must be an active member of the space. */
export async function addAliasHolder(
  spaceId: string,
  name: string,
  userId: string,
  actor: Actor,
): Promise<void> {
  await requireAlias(spaceId, name)
  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { status: true },
  })
  if (!membership || membership.status !== 'active') {
    throw new Error('That person is not an active member of this space')
  }
  await prisma.userAlias.upsert({
    where: { user_alias_identity: { spaceId, userId, aliasName: name } },
    create: { spaceId, userId, aliasName: name, addedBy: actor.userId },
    update: {},
  })
}

export async function removeAliasHolder(
  spaceId: string,
  name: string,
  userId: string,
): Promise<void> {
  await requireAlias(spaceId, name)
  await assertOwnerSurvives(spaceId, { kind: 'removeHolder', name, userId })
  await prisma.userAlias.deleteMany({ where: { spaceId, userId, aliasName: name } })
}

/** Guard departures from the space (the caller then removes the rows). */
export async function assertMembersCanLeave(
  spaceId: string,
  userIds: string[],
): Promise<void> {
  await assertOwnerSurvives(spaceId, { kind: 'removeMember', userIds })
}

/**
 * Reconcile a NEW Person alias list — what the Types page saves — against what
 * is stored, and return the list that should actually be persisted.
 *
 * The Types page owns names and colours; it has no UI for `owner`, so it must
 * not be able to clear it: a client holding a stale copy would otherwise wipe
 * who manages the space just by recolouring a chip. Those flags are
 * therefore carried over from storage, never from the payload.
 *
 * Aliases that genuinely disappeared take their holders and grants with them,
 * so nothing points at a name that no longer exists — refused if that would
 * leave the space with nobody owning it. The built-in Owner alias is always
 * kept, whatever the payload says.
 */
export async function reconcilePersonAliases(
  spaceId: string,
  next: SpaceAlias[],
): Promise<SpaceAlias[]> {
  const before = await loadPersonAliases(spaceId)
  const storedByName = new Map(before.map((a) => [a.name, a]))

  // Preserve owner/system from storage; the payload only carries name + colour.
  const merged = personAliases(next).map((a) => {
    const stored = storedByName.get(a.name)
    return {
      ...a,
      ...(stored?.owner ? { owner: true } : {}),
      ...(stored?.system ? { system: true } : {}),
    }
  })

  const keep = new Set(merged.map((a) => a.name))
  const removed = before.filter((a) => !keep.has(a.name))
  for (const alias of removed) {
    await assertOwnerSurvives(spaceId, { kind: 'removeAlias', name: alias.name })
  }
  await cascadeAliasRemoval(spaceId, removed.map((a) => a.name))
  return merged
}
