/**
 * A node-backed record's write gate, and its field door — shared by
 * `PATCH /api/nodes/<id>` (a Directory cell, a property row) and
 * `lib/records/service.ts#setFields` (the `set_fields` action, a Tool's
 * `records.update`), so every way of changing a record's fields asks the
 * same questions in the same order:
 *
 *   the node exists in the space named → the caller is an active member →
 *   the Directory shows it to them → it is not a Visvine record or a
 *   follower of one → they may write its note → an event's fields are its
 *   managers' → the keys are fields its type declares, each value parsed.
 */
import { revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { spaceMemberForbidden } from '@/lib/auth'
import { isSuperAdmin, type SessionPayload } from '@/lib/session'
import { isGlobalSpace } from '@/lib/spaces/globalSpace'
import { GLOBAL_MODE_KEY, syncGlobalRecordSafe } from '@/lib/global/record'
import { entityLensFor } from '@/lib/notes/context/entityVisibility'
import { isEntityHidden } from '@/lib/notes/shared/entityVisibility'
import { syncEntityNoteFrontmatter } from '@/lib/notes/context/entityNodes'
import { entityNotePath } from '@/lib/notes/entities'
import { principalOf, resolveContext } from '@/lib/notes/resolve'
import { writeDenialFull } from '@/lib/notes/contextService'
import { isEventManager, EVENT_MANAGER_DENIAL } from '@/lib/eventAuth'
import { canonicalType } from '@/lib/types/typeFields'
import { findNodeTypeConfig } from '@/lib/types/context'
import type { NBEvent, NodeTypeConfig } from '@/lib/types'
import { planMetadataWrite } from './fieldWrite'

type Who = Pick<SessionPayload, 'userId' | 'name' | 'email'>

interface GatedNode {
  id: string
  spaceId: string | null
  type: string
  name: string
  alias: string | null
  identityId: string | null
  metadata: Record<string, unknown>
}

export type NodeGate = { ok: true; node: GatedNode } | { ok: false; status: number; error: string }

/** Everything a field write on a node must pass before its values are read. */
export async function gateNodeWrite(who: Who, spaceId: string, nodeId: string, opts: { touchesFields: boolean }): Promise<NodeGate> {
  const row = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, spaceId: true, metadata: true, type: true, identityId: true, name: true, alias: true },
  })
  // The note (and thus its fields) live in the node's own space context; a
  // mismatched space would edit a misbound entity.
  if (!row || row.spaceId !== spaceId) return { ok: false, status: 404, error: 'Node not found' }
  if (await spaceMemberForbidden(who.userId, spaceId, who.email)) return { ok: false, status: 403, error: 'Forbidden' }
  const node: GatedNode = { ...row, metadata: (row.metadata as Record<string, unknown> | null) ?? {} }
  // A record the viewer cannot see reads as absent, exactly as a read answers.
  const lens = await entityLensFor(spaceId, who.userId, who.email)
  if (lens && isEntityHidden(node, lens)) return { ok: false, status: 404, error: 'Node not found' }
  // A global record's fields are gathered, not typed (lib/global/record.ts);
  // a follower's are pushed from the record. Neither takes a local edit.
  if (isGlobalSpace(spaceId) && !isSuperAdmin(who.email)) {
    return {
      ok: false,
      status: 403,
      error: 'Visvine records are built from public spaces and profiles. Edit your profile to change yours.',
    }
  }
  if (node.metadata[GLOBAL_MODE_KEY] === 'follow') {
    return { ok: false, status: 409, error: 'This context follows its Visvine record — detach it to edit here.' }
  }
  // The record is its note: whoever may not write the note may not change it.
  const notePath = entityNotePath(node)
  if (notePath) {
    const resolved = await resolveContext({ userId: who.userId, name: who.name, email: who.email }, spaceId)
    if (resolved instanceof Response) return { ok: false, status: resolved.status, error: 'Forbidden' }
    const denial = await writeDenialFull(await principalOf(resolved), resolved, notePath)
    if (denial) return { ok: false, status: 403, error: denial }
  }
  // An event's name, date, place and the rest are its managers' to change.
  if (opts.touchesFields && canonicalType(node.type) === 'event') {
    const hosts = Array.isArray(node.metadata.hosts) ? (node.metadata.hosts as string[]) : []
    if (!(await isEventManager({ userId: who.userId, email: who.email }, spaceId, { hosts } as unknown as NBEvent))) {
      return { ok: false, status: 403, error: EVENT_MANAGER_DENIAL }
    }
  }
  return { ok: true, node }
}

export type NodeFieldsResult = { ok: true; fields: Record<string, unknown> } | { ok: false; status: number; error: string }

/**
 * Write fields of a node-backed record: the gate above, then only keys its
 * type declares, each parsed (fieldWrite.ts#planMetadataWrite), merged into
 * the metadata, mirrored into its note's frontmatter.
 */
export async function writeNodeFields(
  who: Who,
  spaceId: string,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<NodeFieldsResult> {
  const gate = await gateNodeWrite(who, spaceId, nodeId, { touchesFields: true })
  if (!gate.ok) return gate
  const { node } = gate
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { nodeTypes: true } })
  const config = findNodeTypeConfig(node.type, (space?.nodeTypes ?? []) as unknown as NodeTypeConfig[])
  const plan = planMetadataWrite(node.type, config, patch)
  if (!plan.ok) return { ok: false, status: 400, error: plan.error }
  const updated = await prisma.node.update({
    where: { id: nodeId },
    data: { metadata: { ...node.metadata, ...plan.metadata } as object },
    select: { id: true, type: true, spaceId: true, name: true, location: true, metadata: true },
  })
  if (updated.spaceId) {
    await syncEntityNoteFrontmatter(
      { ...updated, spaceId: updated.spaceId, metadata: (updated.metadata as Record<string, unknown> | null) ?? null },
      { id: who.userId, name: who.name, email: who.email ?? null },
    )
  }
  await syncGlobalRecordSafe(node.identityId)
  revalidateTag('context-data-v2', { expire: 0 })
  return { ok: true, fields: plan.metadata }
}
