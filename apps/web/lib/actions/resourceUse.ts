/**
 * What the actions that touch resources share — `upload_file`, the resource
 * actions, the Drive folder lookup: the record of who used what and through
 * which door, the stamp on a share an action made, and the channel checks a
 * post makes before it speaks.
 */
import { ActionError, readerOf, type ActionCaller } from '@/lib/actions/types'
import prisma from '@/lib/prisma'
import { listFolders } from '@/lib/resources/folders'
import { MessagingError } from '@/lib/messages/core'
import { inSpace } from '@/lib/spaces/shared/spaceUrl'

/** The record of use's who-and-how, from the caller. */
export function accessOf(ctx: ActionCaller) {
  const { userId, via, agentName, runId } = readerOf(ctx)
  return { userId, via, agentName, runId }
}

/**
 * A share an action made says so — `agent` with the agent's name when a run
 * posted it, `action` otherwise — so the resource's history tells a person's
 * post from an AI's.
 */
export async function stampShare(ctx: ActionCaller, messageId: string, resourceId: string): Promise<void> {
  await prisma.resourceShare.updateMany({
    where: { messageId, resourceId },
    data: ctx.via === 'agent' ? { via: 'agent', agentName: ctx.agentName ?? null } : { via: 'action' },
  })
}

export function messageHref(spaceId: string, channelId: string, messageId: string): string {
  return inSpace(spaceId, `/channels/${encodeURIComponent(channelId)}?message=${encodeURIComponent(messageId)}`)
}

/** The service speaks MessagingError; the doors speak ActionError. */
export async function asMessaging<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof MessagingError) throw new ActionError(err.status, err.message)
    throw err
  }
}

/** A channel of this space the caller is a member of, or a refusal naming which. */
export async function requireChannelIn(ctx: ActionCaller, spaceId: string, channelId: string): Promise<void> {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: channelId, userId: ctx.userId } },
    select: { conversation: { select: { spaceId: true } } },
  })
  if (!member || member.conversation.spaceId !== spaceId) {
    throw new ActionError(404, `No channel '${channelId}' of yours in this space`)
  }
}

/** A Drive folder named by name or path, or null for none given. */
export async function folderIdFor(spaceId: string, folder: string | undefined): Promise<string | null> {
  const wanted = folder?.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!wanted) return null
  const folders = await listFolders(spaceId)
  const byId = new Map(folders.map((f) => [f.id, f]))
  const pathOf = (id: string): string => {
    const parts: string[] = []
    let cursor: string | null = id
    for (let i = 0; cursor && i < 16; i++) {
      const f = byId.get(cursor)
      if (!f) break
      parts.unshift(f.name)
      cursor = f.parentId
    }
    return parts.join('/').toLowerCase()
  }
  const hit = folders.find((f) => pathOf(f.id) === wanted) ?? folders.find((f) => f.name.toLowerCase() === wanted)
  if (!hit) throw new ActionError(404, `No Drive folder named '${folder}'`)
  return hit.id
}

