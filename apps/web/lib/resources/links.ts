/**
 * A link added to a space on purpose — pasted into Resources, or made by an AI
 * with `add_context` — as opposed to one that arrived in a message
 * (lib/resources/messageLinks.ts). Either way it is the space's one resource
 * for its canonical URL (linkRecord.ts), here shared to the space itself, and
 * its unfurl runs inside this request within a budget so the record comes back
 * named after the page rather than its host.
 */
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { isHttpUrl } from '@/lib/links/shared/unfurl'
import { canonicalUrl } from '@/lib/links/shared/providers'
import type { ResolvedContext } from '@/lib/notes/resolve'
import { upsertLinkResource } from '@/lib/resources/linkRecord'
import { addShares, type ShareVia } from '@/lib/resources/shares'
import { drainJobs, enqueueJobs } from '@/lib/resources/jobs'
import { ensureResourceEntity } from '@/lib/resources/entity'
import { syncResourceGrants } from '@/lib/resources/grants'

/** How long adding a link waits for its unfurl before answering. */
const ADD_BUDGET_MS = 6_000

export interface AddedLink {
  node: { id: string; name: string }
  resourceId: string
  /** False when the space already held this link; that record is returned. */
  created: boolean
}

/** The node of the space's resource for `url`, when it has one. */
export async function existingLinkNode(spaceId: string, url: string): Promise<{ id: string; name: string } | null> {
  const canonical = canonicalUrl(url)
  if (!canonical) return null
  const row = await prisma.resource.findUnique({
    where: { spaceId_canonicalUrl: { spaceId, canonicalUrl: canonical } },
    select: { deletedAt: true, node: { select: { id: true, name: true } } },
  })
  return row && !row.deletedAt ? row.node : null
}

async function unfurlNow(resourceId: string, created: boolean): Promise<void> {
  if (created) await enqueueJobs(resourceId, ['unfurl'])
  await drainJobs({ budgetMs: ADD_BUDGET_MS, resourceIds: [resourceId] })
}

/** Add `url` to the space as a resource named after what the page calls itself. */
export async function addLinkResource(context: ResolvedContext, rawUrl: string, via: ShareVia = 'link'): Promise<AddedLink> {
  const url = rawUrl.trim()
  if (!isHttpUrl(url)) throw new ApiError(400, 'A link must start with http:// or https://')
  const spaceId = context.spaceId
  const record = await upsertLinkResource({ spaceId, url, createdBy: context.actor.id })
  if (!record) throw new ApiError(400, 'That is not a link Visvine can add')
  await addShares([{ resourceId: record.id, spaceId, sharedBy: context.actor.id, via }])
  await unfurlNow(record.id, record.created)
  const { nodeId } = await ensureResourceEntity(record.id)
  await syncResourceGrants(record.id)
  if (!nodeId) throw new ApiError(500, 'The link was added but its record could not be made')
  const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId }, select: { id: true, name: true } })
  return { node, resourceId: record.id, created: record.created }
}

/**
 * Make a `resource` node an AI just created with a URL the content of the
 * space's resource for that link: bound, shared to the space, unfurled. Used
 * by `add_context`, whose node already carries the name the AI chose.
 */
export async function bindLinkNode(spaceId: string, nodeId: string, url: string, createdBy: string): Promise<string | null> {
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { name: true, metadata: true } })
  if (!node) return null
  const record = await upsertLinkResource({ spaceId, url, createdBy, name: node.name })
  if (!record) return null
  const metadata = { ...((node.metadata as Record<string, unknown> | null) ?? {}), fileId: record.id }
  await prisma.$transaction([
    prisma.resource.updateMany({ where: { nodeId }, data: { nodeId: null } }),
    prisma.resource.update({ where: { id: record.id }, data: { nodeId, name: node.name } }),
    prisma.node.update({ where: { id: nodeId }, data: { metadata } }),
  ])
  await addShares([{ resourceId: record.id, spaceId, sharedBy: createdBy, via: 'action' }])
  await unfurlNow(record.id, record.created)
  return record.id
}
