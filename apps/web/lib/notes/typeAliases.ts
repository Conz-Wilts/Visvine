// The alias vocabulary of EVERY node type, in one place.
//
// A space's aliases (`Space.aliases`, lib/types/context.ts#SpaceAlias) are
// scoped to a node type: "Founder" narrows a Person, "Portfolio" narrows a
// Space. Person's aliases are also the permission model, so they have their own
// module (./aliases.ts) with the admin invariant and the three-column rename
// cascade; every other type's alias is a label on a directory card and nothing
// more.
//
// This module is the one door for both. Person mutations delegate to
// ./aliases.ts so the permission rules can never be bypassed by coming in
// through the generic path; the rest are written here.
//
// An alias has a stable `id` (lib/spaces/configMerge.ts#newAliasId), and that is
// what everything referencing one points at. `Node.alias` additionally caches
// the NAME, because it is the label a directory card renders and the text entity
// search matches — so a rename refreshes that cache, matched by id.

import { revalidateTag } from 'next/cache'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { updateSpaceConfig } from '@/lib/spaces/spaceConfig'
import { newAliasId } from '@/lib/spaces/configMerge'
import {
  aliasesForType,
  canonicalNodeType,
  findAliasByRef,
  findNodeTypeConfig,
  isAliaslessNodeType,
  nodeTypeSpellings,
  personAliases,
  type NodeTypeConfig,
  type SpaceAlias,
} from '@/lib/types/context'
import { isNodeTypeEnabled } from '@/lib/featureAccess'
import type { SpaceFeatureConfig } from '@/lib/types'
import { logAudit } from './audit'
import { createAlias, deleteAlias, setAliasAdmin, updateAlias } from './aliases'
import { aliasNameError, normalizeAliasColor } from './shared/aliases'

interface Actor {
  userId: string
  name: string
}

/** The type an alias hangs off, resolved to how this space spells it. */
interface ResolvedType {
  /** The space's display spelling — what gets stored in `SpaceAlias.nodeType`. */
  name: string
  color: string
  isPerson: boolean
}

interface SpaceAliasState {
  all: SpaceAlias[]
  types: NodeTypeConfig[] | null
  featureConfig: SpaceFeatureConfig | null
}

async function loadState(spaceId: string): Promise<SpaceAliasState> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { aliases: true, nodeTypes: true, featureConfig: true },
  })
  if (!space) throw new Error('Unknown space')
  return {
    all: (space.aliases ?? []) as unknown as SpaceAlias[],
    types: (space.nodeTypes ?? null) as NodeTypeConfig[] | null,
    featureConfig: (space.featureConfig ?? null) as SpaceFeatureConfig | null,
  }
}

/**
 * Resolve the type an alias is being hung off, refusing the cases that have no
 * alias vocabulary at all: a type this space doesn't have, one its feature
 * switch turns off, and a note-scoped type (a member invented it on a draft —
 * things made under it are notes, and an alias narrows a directory record).
 */
function resolveAliasType(state: SpaceAliasState, nodeType: string): ResolvedType {
  const config = findNodeTypeConfig(nodeType, state.types ?? undefined)
  if (!config) throw new Error(`"${nodeType}" is not a type in this space`)
  if (!isNodeTypeEnabled(state.featureConfig, config.name)) {
    throw new Error(`The tool that owns "${config.name}" is switched off in this space`)
  }
  if (config.scope === 'note') {
    throw new Error(
      `"${config.name}" holds context notes, not directory records, so it carries no aliases`,
    )
  }
  return {
    name: config.name,
    color: config.color,
    isPerson: canonicalNodeType(config.name) === 'person',
  }
}

/** This type's aliases, with Admin grafted in for Person. */
function aliasesOfType(state: SpaceAliasState, type: ResolvedType): SpaceAlias[] {
  return type.isPerson ? personAliases(state.all) : aliasesForType(state.all, type.name)
}

/** Everything NOT scoped to this type — what a write leaves untouched. */
function othersOfType(state: SpaceAliasState, type: ResolvedType): SpaceAlias[] {
  const mine = new Set(aliasesForType(state.all, type.name))
  return state.all.filter((a) => !mine.has(a))
}

/**
 * Run a non-Person alias write under the space lock.
 *
 * The state is rebuilt from what is really stored at the moment of the write,
 * not from a read taken before it, so a concurrent create on another type can't
 * be erased by this one writing back a whole array it assembled earlier. The
 * callback returns the array to store (or null to write nothing) and gets the
 * transaction client, so the `Node.alias` chip sweep commits with it.
 */
async function updateAliases(
  spaceId: string,
  apply: (
    state: SpaceAliasState,
    tx: Prisma.TransactionClient,
  ) => Promise<SpaceAlias[] | null> | SpaceAlias[] | null,
): Promise<void> {
  await updateSpaceConfig(spaceId, async (stored, tx) => {
    const next = await apply(
      { all: stored.aliases ?? [], types: stored.nodeTypes, featureConfig: stored.featureConfig },
      tx,
    )
    return next ? { aliases: next } : {}
  })
}

/**
 * The chips on directory cards of this type, renamed or cleared.
 *
 * Matched on the alias id, so the rows swept are exactly the cards wearing THIS
 * alias — `Node.alias` is shared with event slugs and connector kinds, and
 * matching on the name could catch one of those. The name is what gets written,
 * because that column is the label the card renders and search matches; the id
 * is cleared alongside it on a delete.
 */
async function recolourNodes(
  tx: Prisma.TransactionClient,
  spaceId: string,
  type: ResolvedType,
  aliasId: string | undefined,
  nextName: string | null,
): Promise<void> {
  if (!aliasId) return
  await tx.node.updateMany({
    where: { spaceId, aliasId, type: { in: nodeTypeSpellings(type.name) } },
    data: nextName === null ? { alias: null, aliasId: null } : { alias: nextName },
  })
}

export interface TypeAliasInfo {
  name: string
  color: string
  node_type: string
  /** Person only: holders of this alias manage the space. */
  admin: boolean
  /** Built in — it can be held and granted, but not renamed, recoloured or removed. */
  system: boolean
}

function describe(alias: SpaceAlias, type: ResolvedType): TypeAliasInfo {
  return {
    name: alias.name,
    color: alias.color,
    node_type: type.name,
    admin: type.isPerson && (alias.admin === true || alias.system === true),
    system: alias.system === true,
  }
}

/** Every alias this space has, grouped by the type it narrows. */
export async function listAliasesByType(
  spaceId: string,
): Promise<Record<string, TypeAliasInfo[]>> {
  const state = await loadState(spaceId)
  const names = new Set<string>(state.all.map((a) => a.nodeType).filter(Boolean))
  names.add('Person')
  const out: Record<string, TypeAliasInfo[]> = {}
  for (const raw of names) {
    let type: ResolvedType
    try {
      type = resolveAliasType(state, raw)
    } catch {
      // A type the space no longer has: its aliases are dead vocabulary, not
      // something to report as available.
      continue
    }
    if (out[type.name]) continue
    out[type.name] = aliasesOfType(state, type).map((a) => describe(a, type))
  }
  return out
}

/** Add an alias to a type's vocabulary. It starts held by nobody. */
export async function createTypeAlias(
  spaceId: string,
  nodeType: string,
  name: string,
  color: string | undefined,
  actor: Actor,
): Promise<TypeAliasInfo> {
  if (isAliaslessNodeType(nodeType)) throw new Error(`${nodeType} carries no aliases.`)
  const type = resolveAliasType(await loadState(spaceId), nodeType)
  // A colour is required by the Person path and by every chip that renders one;
  // defaulting to the type's own colour is what the console's add row does.
  const hex = normalizeAliasColor(color ?? type.color)
  if (!hex) throw new Error('Pick a #rrggbb colour for this alias.')

  if (type.isPerson) {
    await createAlias(spaceId, name, hex, actor)
    return { name: name.trim(), color: hex, node_type: type.name, admin: false, system: false }
  }

  const created: SpaceAlias = { id: newAliasId(), name: name.trim(), color: hex, nodeType: type.name }
  await updateAliases(spaceId, (state) => {
    // Re-resolved under the lock: the type could have been renamed or its tool
    // switched off between the read above and this write.
    const locked = resolveAliasType(state, nodeType)
    const problem = aliasNameError(name, aliasesOfType(state, locked).map((a) => a.name))
    if (problem) throw new Error(problem)
    return [...state.all, created]
  })

  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: `${type.name} alias "${created.name}" created`,
  })
  return describe(created, type)
}

/**
 * Rename and/or recolour an alias. The rename carries `Node.alias` with it, so
 * the cards wearing the chip keep wearing it.
 */
export async function updateTypeAlias(
  spaceId: string,
  nodeType: string,
  name: string,
  changes: { newName?: string; color?: string; admin?: boolean },
  actor: Actor,
): Promise<TypeAliasInfo> {
  const type = resolveAliasType(await loadState(spaceId), nodeType)

  if (type.isPerson) {
    if (changes.newName !== undefined || changes.color !== undefined) {
      await updateAlias(spaceId, name, { newName: changes.newName, color: changes.color }, actor)
    }
    const finalName = changes.newName?.trim() || name
    if (changes.admin !== undefined) await setAliasAdmin(spaceId, finalName, changes.admin, actor)
    const after = personAliases((await loadState(spaceId)).all).find((a) => a.name === finalName)
    if (!after) throw new Error(`Unknown alias "${name}" for ${type.name}`)
    return describe(after, type)
  }

  if (changes.admin !== undefined) {
    throw new Error('Only a Person alias can own the space — admin does not apply here.')
  }

  let hex: string | null = null
  if (changes.color !== undefined) {
    hex = normalizeAliasColor(changes.color)
    if (!hex) throw new Error('That is not a valid colour.')
  }
  const nextName = changes.newName?.trim()
  const renaming = nextName !== undefined && nextName !== name
  if (!renaming && !hex) throw new Error('Nothing to change — pass new_name or color.')

  let updated!: SpaceAlias
  await updateAliases(spaceId, async (state, tx) => {
    const locked = resolveAliasType(state, nodeType)
    const existing = aliasesOfType(state, locked)
    const alias = existing.find((a) => a.name === name)
    if (!alias) throw new Error(`Unknown alias "${name}" for ${locked.name}`)
    if (renaming) {
      const problem = aliasNameError(nextName, existing.map((a) => a.name), name)
      if (problem) throw new Error(problem)
      // The chip is a copy of the name, so it moves with the rename — under the
      // same lock and the same commit, filtered to this type's own cards.
      await recolourNodes(tx, spaceId, locked, alias.id, nextName)
    }
    updated = {
      ...alias,
      ...(renaming ? { name: nextName } : {}),
      ...(hex ? { color: hex } : {}),
    }
    return [
      ...othersOfType(state, locked),
      ...existing.map((a) => (a.name === name ? updated : a)),
    ]
  })

  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: renaming
      ? `${type.name} alias "${name}" renamed to "${nextName}"`
      : `${type.name} alias "${name}" recoloured`,
  })
  return describe(updated, type)
}

/**
 * Put one of a type's aliases on a directory card — or take it off (`name`
 * null). The vocabulary side (create/rename/delete) is admin-only; wearing a
 * chip is collaborative card metadata like tags, gated on membership by the
 * caller. Person is refused here: a person's aliases are held through
 * membership (they are the permission model), not worn on the card.
 */
export async function assignNodeAlias(
  spaceId: string,
  nodeId: string,
  name: string | null,
  actor: Actor,
): Promise<{ nodeId: string; alias: string | null }> {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, spaceId },
    select: { id: true, type: true, name: true },
  })
  if (!node) throw new Error(`No entity "${nodeId}" in this space`)

  const state = await loadState(spaceId)
  const type = resolveAliasType(state, node.type)
  if (type.isPerson) {
    throw new Error(
      'A person holds aliases through membership, not on the card — grant them in the app',
    )
  }

  const trimmed = name?.trim() || null
  if (trimmed) {
    const available = aliasesOfType(state, type)
    const match = findAliasByRef(available, trimmed)
    if (!match) {
      throw new Error(
        available.length
          ? `"${trimmed}" is not a ${type.name} alias here — use one of: ${available.map((a) => a.name).join(', ')}, or create it first`
          : `This space has no ${type.name} aliases — create one first`,
      )
    }
    // The id is what survives a rename; the name rides along as the cached
    // label the card renders and search matches.
    await prisma.node.update({
      where: { id: node.id },
      data: { alias: match.name, aliasId: match.id ?? null },
    })
    revalidateTag('context-data-v2', { expire: 0 })
    void logAudit(spaceId, {
      userId: actor.userId,
      name: actor.name,
      action: 'folder',
      path: '',
      detail: `${type.name} "${node.name}" aliased "${match.name}"`,
    })
    return { nodeId: node.id, alias: match.name }
  }

  await prisma.node.update({ where: { id: node.id }, data: { alias: null, aliasId: null } })
  revalidateTag('context-data-v2', { expire: 0 })
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: `${type.name} "${node.name}" alias cleared`,
  })
  return { nodeId: node.id, alias: null }
}

/**
 * Remove an alias from a type's vocabulary, taking the chips with it. The
 * Person path additionally drops its holders and grants, and refuses to leave
 * the space with nobody administering it.
 */
export async function deleteTypeAlias(
  spaceId: string,
  nodeType: string,
  name: string,
  actor: Actor,
): Promise<void> {
  const type = resolveAliasType(await loadState(spaceId), nodeType)

  if (type.isPerson) {
    await deleteAlias(spaceId, name, actor)
    return
  }

  await updateAliases(spaceId, async (state, tx) => {
    const locked = resolveAliasType(state, nodeType)
    const existing = aliasesOfType(state, locked)
    const removed = existing.find((a) => a.name === name)
    if (!removed) {
      throw new Error(`Unknown alias "${name}" for ${locked.name}`)
    }
    // Clearing the chips commits with the removal, so a card can never be left
    // wearing an alias the space no longer has.
    await recolourNodes(tx, spaceId, locked, removed.id, null)
    return [...othersOfType(state, locked), ...existing.filter((a) => a.name !== name)]
  })

  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'folder',
    path: '',
    detail: `${type.name} alias "${name}" deleted`,
  })
}
