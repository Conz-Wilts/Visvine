/**
 * The links in a space channel's message, as resources: each becomes (or
 * joins) the space's resource for its canonical URL and is shared on the
 * message — Slack's `link_shared` → `chat.unfurl`, with the resource and the
 * share kept apart. A new link, or one not read for a week, is queued for its
 * unfurl; the card draws from the resource at once and fills in when the job
 * lands (a pull or the tick, lib/resources/jobs.ts).
 */
import prisma from '@/lib/prisma'
import { extractUrls } from '@/lib/links/shared/unfurl'
import { canonicalUrl } from '@/lib/links/shared/providers'
import { upsertLinkResource } from '@/lib/resources/linkRecord'
import { addShares, removeMessageShares, syncGrantsOf } from '@/lib/resources/shares'
import { enqueueJobs } from '@/lib/resources/jobs'

/** Cards under one message, as Slack caps them. */
const MAX_LINK_CARDS = 5

/** A link read longer ago than this is read again when shared again. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000

interface MessagePlace {
  messageId: string
  conversationId: string
  spaceId: string
  senderId: string
}

/** Share the message's links; returns the resources it now carries. */
export async function shareMessageLinks(place: MessagePlace, urls: string[]): Promise<string[]> {
  const ids: string[] = []
  const existing = await prisma.resourceShare.count({ where: { messageId: place.messageId, resource: { source: 'link' } } })
  for (const url of urls.slice(0, Math.max(0, MAX_LINK_CARDS - existing))) {
    const record = await upsertLinkResource({ spaceId: place.spaceId, url, createdBy: place.senderId })
    if (!record) continue
    ids.push(record.id)
    const row = await prisma.resource.findUniqueOrThrow({ where: { id: record.id }, select: { fetchedAt: true, fetchState: true } })
    const stale = !row.fetchedAt || Date.now() - row.fetchedAt.getTime() > STALE_MS
    if (record.created || (stale && row.fetchState !== 'pending')) {
      if (!record.created) await prisma.resource.update({ where: { id: record.id }, data: { fetchState: 'pending' } })
      await enqueueJobs(record.id, [record.created ? 'unfurl' : 'refresh'])
    }
  }
  const already = new Set(
    (await prisma.resourceShare.findMany({ where: { messageId: place.messageId, resourceId: { in: ids } }, select: { resourceId: true } })).map(
      (s) => s.resourceId,
    ),
  )
  await addShares(
    ids
      .filter((id) => !already.has(id))
      .map((resourceId, position) => ({
        resourceId,
        spaceId: place.spaceId,
        conversationId: place.conversationId,
        messageId: place.messageId,
        sharedBy: place.senderId,
        via: 'message' as const,
        position,
      })),
  )
  await syncGrantsOf(ids)
  return ids
}

/**
 * Make a message's link shares follow an edit of its text: a link the edit
 * removed loses its share, a link it added gets one. Only what the EDIT
 * changed — a card the author removed stays removed while its link stays in
 * the text.
 */
export async function reconcileMessageLinks(place: MessagePlace, before: string, after: string): Promise<void> {
  const keyOf = (url: string) => canonicalUrl(url) ?? url
  const had = new Map(extractUrls(before).map((url) => [keyOf(url), url]))
  const has = new Map(extractUrls(after).map((url) => [keyOf(url), url]))
  const removed = [...had.keys()].filter((key) => !has.has(key))
  const added = [...has.entries()].filter(([key]) => !had.has(key)).map(([, url]) => url)
  if (removed.length) {
    const gone = await prisma.resource.findMany({
      where: { spaceId: place.spaceId, canonicalUrl: { in: removed } },
      select: { id: true },
    })
    if (gone.length) await removeMessageShares(place.messageId, gone.map((r) => r.id))
  }
  if (added.length) await shareMessageLinks(place, added)
}
