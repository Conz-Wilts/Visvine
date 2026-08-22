// Binding a space's person node to the global record (lib/global/record.ts).
//
// A space no longer has to connect a person to a MEMBER to get a real profile
// behind a card. It binds the node to the identity's global record instead —
// which may be claimed by a member (then the Profile tab lights up exactly as
// before, through Node.identityId → Identity.userId) or may not be.
//
// Two modes, stored on the node as `metadata.globalMode`:
//
//   follow  the node mirrors the record: its fields are pushed from the
//           record on every sync, and its note is a live replica of the
//           global note (a ContextPublication from the Visvine space) and is
//           read-only here — detach to edit.
//   fork    the node is bound (same identity, finder de-duplicates it, the
//           Profile tab still resolves) but local: fields and note are this
//           space's own, and the record's changes do not reach it.
//
// Unbinding drops the identity link entirely, with the resolver's 'split'
// anti-match so the pair is never silently re-attached.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { confirmIdentity } from '@/lib/identity/resolve'
import { disconnectNode } from '@/lib/identity/connection'
import { entityKindOf, entityNotePath } from '@/lib/notes/entities'
import { publishNote, unpublish } from '@/lib/notes/publications'
import type { Actor } from '@/lib/notes/store'
import { GLOBAL_SPACE_ID, isGlobalSpace } from '@/lib/spaces/globalSpace'
import { GLOBAL_MODE_KEY, globalRecordOf, type GlobalMode, type GlobalRecordRef } from './record'

export interface BindingState {
  identityId: string | null
  mode: GlobalMode | null
  /** The record the node is bound to, when one exists for its identity. */
  record: GlobalRecordRef | null
}

type BindError = 'not_found' | 'not_person' | 'no_record' | 'global_node' | 'duplicate'

type BindResult = { ok: true; state: BindingState } | { ok: false; error: BindError; message: string }

async function loadNode(nodeId: string) {
  return prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, type: true, spaceId: true, identityId: true, metadata: true },
  })
}

function modeOf(metadata: unknown): GlobalMode | null {
  const mode = ((metadata as Record<string, unknown> | null) ?? {})[GLOBAL_MODE_KEY]
  return mode === 'follow' || mode === 'fork' ? mode : null
}

export async function bindingStateOf(nodeId: string): Promise<BindingState | null> {
  const node = await loadNode(nodeId)
  if (!node) return null
  const record = node.identityId ? await globalRecordOf(node.identityId) : null
  return { identityId: node.identityId, mode: record ? modeOf(node.metadata) : null, record }
}

async function setMode(nodeId: string, metadata: unknown, mode: GlobalMode | null): Promise<void> {
  const next = { ...((metadata as Record<string, unknown> | null) ?? {}) }
  if (mode) next[GLOBAL_MODE_KEY] = mode
  else delete next[GLOBAL_MODE_KEY]
  await prisma.node.update({ where: { id: nodeId }, data: { metadata: next as object } })
}

/**
 * Bind `nodeId` to the global record of `identityId`, in `mode`. A follow
 * copies the record's fields onto the node and publishes the global note over
 * the node's own note (the local note's prior content is superseded — the
 * caller confirms that with the user; a fork keeps it).
 */
export async function bindToGlobal(
  nodeId: string,
  identityId: string,
  mode: GlobalMode,
  actor: Actor,
): Promise<BindResult> {
  const node = await loadNode(nodeId)
  if (!node || !node.spaceId) return { ok: false, error: 'not_found', message: 'Node not found' }
  if (isGlobalSpace(node.spaceId)) {
    return { ok: false, error: 'global_node', message: 'A global record cannot be bound to itself' }
  }
  if (entityKindOf(node.type) !== 'person') {
    return { ok: false, error: 'not_person', message: 'Only person contexts can be bound to a global record' }
  }
  const record = await globalRecordOf(identityId)
  if (!record) return { ok: false, error: 'no_record', message: 'No global record exists for that identity' }

  if (node.identityId !== identityId) {
    const rival = await prisma.node.findFirst({
      where: { spaceId: node.spaceId, identityId, id: { not: nodeId } },
      select: { name: true },
    })
    if (rival) {
      return { ok: false, error: 'duplicate', message: `"${rival.name}" is already bound to this record in this space` }
    }
    await prisma.node.update({ where: { id: nodeId }, data: { identityId } })
    await confirmIdentity(nodeId, identityId, { actorUserId: actor.id === 'system' ? null : actor.id, reason: 'bound to global record' })
  }

  await setMode(nodeId, node.metadata, mode)

  if (mode === 'follow') {
    const global = await prisma.node.findUnique({
      where: { id: record.nodeId },
      select: { name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true },
    })
    if (global) await prisma.node.update({ where: { id: nodeId }, data: global })
    const localPath = entityNotePath({
      id: nodeId,
      type: node.type,
      metadata: (node.metadata as Record<string, unknown> | null) ?? null,
    })
    if (localPath) {
      const published = await publishNote(GLOBAL_SPACE_ID, record.path, node.spaceId, localPath, actor, { replace: true })
      if (published.status === 'denied') logger.warn('global.binding.publish.denied', { nodeId, reason: published.reason })
    }
  } else {
    await endFollow(node.spaceId, nodeId, node.type, node.metadata, actor)
  }

  const state = await bindingStateOf(nodeId)
  return { ok: true, state: state! }
}

/** Deactivate the follow publication, if any — the replica stays as a plain local copy. */
async function endFollow(spaceId: string, nodeId: string, type: string, metadata: unknown, actor: Actor): Promise<void> {
  const localPath = entityNotePath({ id: nodeId, type, metadata: (metadata as Record<string, unknown> | null) ?? null })
  if (!localPath) return
  const rows = await prisma.contextPublication.findMany({
    where: { sourceSpaceId: GLOBAL_SPACE_ID, targetSpaceId: spaceId, targetPath: localPath, active: true },
    select: { id: true },
  })
  for (const row of rows) await unpublish(row.id, actor)
}

/** Keep the identity, stop following: the node becomes this space's own copy. */
export async function detachFromGlobal(nodeId: string, actor: Actor): Promise<BindResult> {
  const node = await loadNode(nodeId)
  if (!node || !node.spaceId) return { ok: false, error: 'not_found', message: 'Node not found' }
  if (!node.identityId) return { ok: true, state: { identityId: null, mode: null, record: null } }
  await endFollow(node.spaceId, nodeId, node.type, node.metadata, actor)
  await setMode(nodeId, node.metadata, 'fork')
  const state = await bindingStateOf(nodeId)
  return { ok: true, state: state! }
}

/** Drop the identity link entirely. */
export async function unbindFromGlobal(nodeId: string, actor: Actor): Promise<BindResult> {
  const node = await loadNode(nodeId)
  if (!node || !node.spaceId) return { ok: false, error: 'not_found', message: 'Node not found' }
  await endFollow(node.spaceId, nodeId, node.type, node.metadata, actor)
  await setMode(nodeId, node.metadata, null)
  await disconnectNode(nodeId, { actorUserId: actor.id === 'system' ? null : actor.id })
  return { ok: true, state: { identityId: null, mode: null, record: null } }
}

/**
 * Best-effort follow for a node that was just created from a global finder
 * result. The create already attached the identity; this only turns on the
 * mirror. Nothing happens when the identity has no record.
 */
export async function followGlobalSafe(nodeId: string, identityId: string, actor: Actor): Promise<void> {
  try {
    const result = await bindToGlobal(nodeId, identityId, 'follow', actor)
    if (!result.ok && result.error !== 'no_record') {
      logger.warn('global.binding.follow.skipped', { nodeId, identityId, error: result.error })
    }
  } catch (err) {
    logger.error('global.binding.follow.failed', { err, nodeId, identityId })
  }
}
