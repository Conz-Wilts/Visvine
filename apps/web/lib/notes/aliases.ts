// The DB side of Person aliases (shared/aliases.ts holds the pure rules).
//
// The aliases themselves are NOT rows — they live in `Space.aliases`,
// because a space's Person aliases and its permission vocabulary are the
// same list. This module owns their whole life: creating, renaming, recolouring
// and deleting them, who holds each (UserAlias rows), and whether holding one
// means owning the space (the `owner` flag on the stored alias). All of it
// is driven from Console → Aliases.
//
// An alias is referenced by its stable `id` everywhere it matters —
// UserAlias.aliasId, ContextGrant.subjectId, Node.aliasId — so a rename is one
// write to Space.aliases and nothing else moves. Names are what the API, the
// console and MCP speak; findAliasByRef translates at the edge.
//
// A DELETE still cascades, because those rows would otherwise point at an alias
// that no longer exists. cascadeAliasRemoval is the only path that does it.
// `Node.alias` also caches the alias NAME for rendering and search, so a rename
// refreshes it — cosmetically, never as a matter of access.
//
// Space admins manage all of it; there is no per-alias manager role.

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  personAliases,
  nodeTypeSpellings,
  findAliasByRef,
  OWNER_ALIAS_NAME,
  type SpaceAlias,
} from '@/lib/types/context'
import { updateSpaceConfig } from '@/lib/spaces/spaceConfig'
import { newAliasId } from '@/lib/spaces/configMerge'
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
  /** Stable id — what grants and holder rows point at. */
  id: string
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
    prisma.userAlias.findMany({ where: { spaceId }, select: { aliasId: true, userId: true } }),
  ])
  return summarize(aliases, holders)
}

/** Throw the shared refusal unless somebody would still manage the space. */
async function assertOwnerSurvives(spaceId: string, change: AliasChange): Promise<void> {
  const aliases = await loadAliasSummaries(spaceId)
  if (!ownerSurvives(aliases, change)) throw new Error(LAST_OWNER_MESSAGE)
}

/** The state a Person-alias write decides from, read under the lock. */
interface LockedAliasState {
  /** The space's Person aliases, Owner grafted in. */
  aliases: SpaceAlias[]
  /** The same list with holders attached — what the owner invariant needs. */
  summaries: AliasSummary[]
}

/**
 * Run a Person-alias write under the space lock.
 *
 * Person aliases ARE the permission model, so every rule they enforce — the
 * owner invariant above all — has to be decided against the vocabulary and the
 * holder rows as they really are at the moment of the write. Deciding from a
 * read taken beforehand is how two concurrent "remove the last owner" calls both
 * pass. The callback returns the Person list to store (or null for no write) and
 * gets the transaction client, so the cascade over UserAlias, ContextGrant and
 * Node commits with the vocabulary change or not at all.
 *
 * Non-Person aliases share the column and are carried through untouched.
 */
async function updatePersonAliases(
  spaceId: string,
  apply: (
    state: LockedAliasState,
    tx: Prisma.TransactionClient,
  ) => Promise<SpaceAlias[] | null> | SpaceAlias[] | null,
): Promise<void> {
  await updateSpaceConfig(spaceId, async (stored, tx) => {
    const all = stored.aliases ?? []
    const aliases = personAliases(all)
    const holders = await tx.userAlias.findMany({
      where: { spaceId },
      select: { aliasId: true, userId: true },
    })
    const next = await apply({ aliases, summaries: summarize(aliases, holders) }, tx)
    if (!next) return {}
    const others = all.filter((a) => a.nodeType?.toLowerCase() !== 'person')
    return { aliases: [...others, ...storable(next)] }
  })
}

/** The owner invariant, checked against state already read under the lock. */
function assertOwnerSurvivesLocked(state: LockedAliasState, change: AliasChange): void {
  if (!ownerSurvives(state.summaries, change)) throw new Error(LAST_OWNER_MESSAGE)
}

/** Every Person alias of a space with its holders (visible to any member). */
export async function listAliases(spaceId: string): Promise<AliasInfo[]> {
  const [aliases, holders] = await Promise.all([
    loadPersonAliases(spaceId),
    prisma.userAlias.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'asc' },
      select: { aliasId: true, userId: true },
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
    id: a.id ?? '',
    name: a.name,
    color: a.color,
    owner: a.owner === true || a.system === true,
    system: a.system === true,
    holders: holders
      .filter((h) => h.aliasId === a.id)
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

/**
 * The alias by that name (or id), or a "create it first" refusal.
 *
 * The id is guaranteed: the migration stamped one onto every stored alias, and
 * `personAliases` grafts the built-in Owner's in. An entry without one could
 * only come from a database that skipped the migration, and holder and grant
 * rows would have nothing to point at — so it is refused rather than written.
 */
async function requireAlias(
  spaceId: string,
  name: string,
): Promise<SpaceAlias & { id: string }> {
  const alias = findAliasByRef(await loadPersonAliases(spaceId), name, 'Person')
  if (!alias) throw new Error(`Unknown alias "${name}" — create it on the Aliases page first`)
  if (!alias.id) throw new Error(`Alias "${alias.name}" has no id — this space needs migrating`)
  return alias as SpaceAlias & { id: string }
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
  const hex = normalizeAliasColor(color)
  if (!hex) throw new Error('Pick a colour for this alias.')

  await updatePersonAliases(spaceId, ({ aliases }) => {
    const problem = aliasNameError(name, aliases.map((a) => a.name))
    if (problem) throw new Error(problem)
    return [...aliases, { id: newAliasId(), name: name.trim(), color: hex, nodeType: 'Person' }]
  })

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
  let hex: string | null = null
  if (changes.color !== undefined) {
    hex = normalizeAliasColor(changes.color)
    if (!hex) throw new Error('That is not a valid colour.')
  }
  const nextName = changes.newName?.trim()

  let renaming = false
  await updatePersonAliases(spaceId, async ({ aliases }, tx) => {
    const alias = aliases.find((a) => a.name === name)
    if (!alias) throw new Error(`Unknown alias "${name}" — create it on the Aliases page first`)
    if (alias.system && (hex || nextName !== undefined)) throw new Error(SYSTEM_ALIAS_MESSAGE)

    const to = nextName !== undefined && nextName !== name ? nextName : null
    renaming = to !== null
    if (to !== null) {
      const problem = aliasNameError(to, aliases.map((a) => a.name), name)
      if (problem) throw new Error(problem)

      // Holders (`UserAlias`) and grants (`ContextGrant`) point at the alias's
      // id, so a rename does not touch them at all — which is the whole reason
      // the id exists. What is left is `Node.alias`, a copy of the NAME used to
      // render and search the chip on a directory card, refreshed here.
      //
      // Filtered to Person cards, which the delete cascade already did and this
      // did not: the column is shared with event slugs (/e/<slug>) and connector
      // kinds, so an alias whose name happened to match one of those used to
      // rewrite it and break the public URL.
      await tx.node.updateMany({
        where: { spaceId, aliasId: alias.id, type: { in: nodeTypeSpellings('person') } },
        data: { alias: to },
      })
    }

    return aliases.map((a) =>
      a.name === name
        ? { ...a, ...(to !== null ? { name: to } : {}), ...(hex ? { color: hex } : {}) }
        : a,
    )
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
  await updatePersonAliases(spaceId, async (state, tx) => {
    const alias = state.aliases.find((a) => a.name === name)
    if (!alias) throw new Error(`Unknown alias "${name}" — create it on the Aliases page first`)
    if (alias.system) throw new Error(SYSTEM_ALIAS_MESSAGE)
    assertOwnerSurvivesLocked(state, { kind: 'removeAlias', name })

    // Inside the transaction, so the vocabulary removal and the cleanup of
    // everything pointing at it land together. Doing this before the
    // authoritative write — as reconcilePersonAliases did — meant a failed write
    // left the holders and grants already destroyed.
    await cascadeAliasRemoval(tx, spaceId, [alias.id])
    return state.aliases.filter((a) => a.name !== name)
  })

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

/** Drop everything pointing at aliases that no longer exist. */
async function cascadeAliasRemoval(
  tx: Prisma.TransactionClient,
  spaceId: string,
  aliasIds: Array<string | undefined>,
): Promise<void> {
  const ids = aliasIds.filter((id): id is string => Boolean(id))
  if (!ids.length) return
  await tx.userAlias.deleteMany({ where: { spaceId, aliasId: { in: ids } } })
  await tx.contextGrant.deleteMany({
    where: { spaceId, subjectType: 'alias', subjectId: { in: ids } },
  })
  // The directory chip caches the NAME as well, so a card would otherwise keep
  // wearing an alias the space no longer has.
  await tx.node.updateMany({
    where: { spaceId, aliasId: { in: ids }, type: { in: nodeTypeSpellings('person') } },
    data: { alias: null, aliasId: null },
  })
}

/** Toggle whether holders of this alias manage the space. */
export async function setAliasOwner(
  spaceId: string,
  name: string,
  owner: boolean,
  actor: Actor,
): Promise<void> {
  let changed = false
  await updatePersonAliases(spaceId, (state) => {
    const alias = state.aliases.find((a) => a.name === name)
    if (!alias) throw new Error(`Unknown alias "${name}" — create it on the Aliases page first`)
    if (alias.system) throw new Error(SYSTEM_ALIAS_MESSAGE)
    if ((alias.owner === true) === owner) return null
    if (!owner) assertOwnerSurvivesLocked(state, { kind: 'setOwner', name, owner: false })
    changed = true
    return state.aliases.map((a) => (a.name === name ? { ...a, owner } : a))
  })
  if (!changed) return

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
  const alias = await requireAlias(spaceId, name)
  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { status: true },
  })
  if (!membership || membership.status !== 'active') {
    throw new Error('That person is not an active member of this space')
  }
  await prisma.userAlias.upsert({
    where: { user_alias_identity: { spaceId, userId, aliasId: alias.id } },
    create: { spaceId, userId, aliasId: alias.id, addedBy: actor.userId },
    update: {},
  })
}

export async function removeAliasHolder(
  spaceId: string,
  name: string,
  userId: string,
): Promise<void> {
  const alias = await requireAlias(spaceId, name)
  await assertOwnerSurvives(spaceId, { kind: 'removeHolder', name, userId })
  await prisma.userAlias.deleteMany({ where: { spaceId, userId, aliasId: alias.id } })
}

/** Guard departures from the space (the caller then removes the rows). */
export async function assertMembersCanLeave(
  spaceId: string,
  userIds: string[],
): Promise<void> {
  await assertOwnerSurvives(spaceId, { kind: 'removeMember', userIds })
}

// `reconcilePersonAliases` used to live here: it took the Types page's whole
// alias array as authoritative and deleted — with their holders and grants —
// every alias missing from it. A page snapshot cannot know about an alias
// created since it loaded, so that was a delete-by-omission from stale data.
// Deleting an alias is now only ever `deleteAlias`, and the Types page's save
// folds onto storage additively through `mergeAliasList`.
