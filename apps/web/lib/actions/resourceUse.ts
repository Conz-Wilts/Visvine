/**
 * What the actions that touch resources share — `upload_file`, the resource
 * actions, the Drive folder lookup: the record of who used what and through
 * which door, the stamp on a share an action made, and the channel checks a
 * post makes before it speaks.
 */
import { ActionError, readerOf, type ActionCaller } from '@/lib/actions/types'
import { ApiError } from '@/lib/api/route'
import prisma from '@/lib/prisma'
import { resourceFolderPath } from '@/lib/resources/tree'
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

/** A folder of `resources/` named by path (`design`, `resources/design/logos`), or null for none given. */
export async function folderFor(spaceId: string, folder: string | undefined): Promise<string | null> {
  try {
    return await resourceFolderPath(spaceId, folder)
  } catch (err) {
    if (err instanceof ApiError) throw new ActionError(err.status, err.message)
    throw err
  }
}

