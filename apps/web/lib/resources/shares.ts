/**
 * Where a resource is shared. One resource, many shares — the same file posted
 * in two channels, the same Sheet linked five times — and a share is the only
 * thing that makes a resource visible to anyone but its creator
 * (`shared/visibility.ts`). Every change of shares re-derives the note's
 * audience (`grants.ts`), so the context never disagrees with the list.
 */
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { syncResourceGrants } from './grants'

export type ShareVia = 'upload' | 'message' | 'link' | 'action' | 'agent'

export interface ShareInput {
  resourceId: string
  spaceId: string
  /** Null shares the resource to the space itself. */
  conversationId?: string | null
  messageId?: string | null
  sharedBy: string | null
  agentName?: string | null
  via: ShareVia
  position?: number
}

type Tx = Prisma.TransactionClient

/**
 * Record shares. Inside a caller's transaction (a message send) pass `tx` and
 * call `syncResourceGrants` for each resource after it commits; outside one,
 * the grants are synced here.
 */
export async function addShares(inputs: ShareInput[], tx?: Tx): Promise<void> {
  if (inputs.length === 0) return
  const db = tx ?? prisma
  for (const input of inputs) {
    const conversationId = input.conversationId ?? null
    const messageId = input.messageId ?? null
    // A space share and a channel share without a message are each one per
    // place: sharing again changes nothing.
    if (!messageId) {
      const existing = await db.resourceShare.findFirst({
        where: { resourceId: input.resourceId, conversationId, messageId: null },
        select: { id: true },
      })
      if (existing) continue
    }
    await db.resourceShare.create({
      data: {
        resourceId: input.resourceId,
        spaceId: input.spaceId,
        conversationId,
        messageId,
        sharedBy: input.sharedBy,
        agentName: input.agentName ?? null,
        via: input.via,
        position: input.position ?? 0,
      },
    })
  }
  if (!tx) await syncGrantsOf(inputs.map((input) => input.resourceId))
}

export async function syncGrantsOf(resourceIds: string[]): Promise<void> {
  for (const id of new Set(resourceIds)) await syncResourceGrants(id)
}

/**
 * Whether losing its last share sends a resource to the trash: a LINK that
 * came in through a message and was never added to the space was only ever
 * that message's card. A file someone uploaded is kept — it is still theirs.
 */
export function orphanGoesToTrash(resource: { source: string }, removedVia: string): boolean {
  return resource.source === 'link' && removedVia === 'message'
}

/**
 * Remove a message's shares of the given resources (the author removing a
 * preview; an edit that drops a link). A resource shared elsewhere lives on;
 * one left shared nowhere is trashed when `orphanGoesToTrash` says so.
 */
export async function removeMessageShares(messageId: string, resourceIds?: string[]): Promise<string[]> {
  const shares = await prisma.resourceShare.findMany({
    where: { messageId, ...(resourceIds ? { resourceId: { in: resourceIds } } : {}) },
    select: { id: true, resourceId: true, via: true },
  })
  if (shares.length === 0) return []
  await prisma.resourceShare.deleteMany({ where: { id: { in: shares.map((share) => share.id) } } })
  const affected = [...new Set(shares.map((share) => share.resourceId))]
  const resources = await prisma.resource.findMany({
    where: { id: { in: affected } },
    select: { id: true, source: true, _count: { select: { shares: true } } },
  })
  const via = new Map(shares.map((share) => [share.resourceId, share.via]))
  const orphans = resources
    .filter((row) => row._count.shares === 0 && orphanGoesToTrash(row, via.get(row.id) ?? ''))
    .map((row) => row.id)
  if (orphans.length) {
    await prisma.resource.updateMany({
      where: { id: { in: orphans } },
      data: { deletedAt: new Date(), deletedBy: 'system', state: 'deleted' },
    })
  }
  await syncGrantsOf(affected)
  return affected
}

/** Move a resource to the trash. Its bytes and note stay until it is purged. */
export async function trashResource(resourceId: string, userId: string): Promise<void> {
  await prisma.resource.update({
    where: { id: resourceId },
    data: { deletedAt: new Date(), deletedBy: userId, state: 'deleted' },
  })
}

export async function restoreResource(resourceId: string): Promise<void> {
  await prisma.resource.update({
    where: { id: resourceId },
    data: { deletedAt: null, deletedBy: null, state: 'ready' },
  })
  await syncResourceGrants(resourceId).catch((err) => logger.error('resources.restore.grants', { resourceId, err }))
}
