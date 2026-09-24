/**
 * Where a resource is shared. One resource, many shares — the same file posted
 * in two channels, the same Sheet linked five times — and a share is the only
 * thing that makes a resource visible to anyone but its creator
 * (`shared/visibility.ts`). Every change of shares re-derives the note's
 * audience (`grants.ts`), so the context never disagrees with the list.
 */
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
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

/** Move a resource to the trash. Its bytes and note stay until it is purged. */
export async function trashResource(resourceId: string, userId: string): Promise<void> {
  await prisma.resource.update({
    where: { id: resourceId },
    data: { deletedAt: new Date(), deletedBy: userId, state: 'deleted' },
  })
}
