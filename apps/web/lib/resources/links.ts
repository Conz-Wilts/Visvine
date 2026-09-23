/**
 * A link as a resource — Slack's "remote file": nothing is stored but the URL,
 * and the record wears the link's unfurl (title, description, image) the way
 * a file wears its thumbnail.
 *
 * Two doors: the Resources tab (paste a link, `POST /api/resources/links`) and
 * `add_context` with a resource `url`, which calls `wearUnfurl` after it
 * creates the record. Both create through `createEntity`, the one entity path.
 */
import { revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { createEntity } from '@/lib/directory/createEntity'
import { getOrFetchLinkPreview } from '@/lib/linkPreview'
import { hostOf, isHttpUrl } from '@/lib/links/shared/unfurl'
import { logger } from '@/lib/logger'
import type { ResolvedContext } from '@/lib/notes/resolve'
import type { NBNode } from '@/lib/types'

/**
 * Give a link resource its unfurl where it has none of its own: the image
 * becomes its picture, the description its subtitle. A picture or subtitle a
 * person already set is never replaced. Best-effort — an unreachable link
 * leaves the record as it is.
 */
export async function wearUnfurl(nodeId: string, url: string): Promise<void> {
  if (!isHttpUrl(url)) return
  try {
    const { preview } = await getOrFetchLinkPreview(url)
    if (!preview) return
    const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { imageUrl: true, subtitle: true } })
    if (!node) return
    const data: { imageUrl?: string; subtitle?: string } = {}
    if (!node.imageUrl && preview.imageUrl) data.imageUrl = preview.imageUrl
    if (!node.subtitle && preview.description) data.subtitle = preview.description.slice(0, 280)
    if (Object.keys(data).length === 0) return
    await prisma.node.update({ where: { id: nodeId }, data })
    revalidateTag('context-data-v2', { expire: 0 })
  } catch (err) {
    logger.warn('resources.link.unfurl.failed', { nodeId, err })
  }
}

export interface AddedLink {
  node: NBNode | { id: string; name: string }
  /** False when the space already held this link; that record is returned. */
  created: boolean
}

/** Add `url` to the space as a resource named after what the page calls itself. */
export async function addLinkResource(context: ResolvedContext, rawUrl: string): Promise<AddedLink> {
  const url = rawUrl.trim()
  if (!isHttpUrl(url)) throw new ApiError(400, 'A link must start with http:// or https://')
  const spaceId = context.spaceId
  const existing = await prisma.node.findFirst({
    where: { spaceId, type: 'resource', url },
    select: { id: true, name: true },
  })
  if (existing) return { node: existing, created: false }

  const { preview } = await getOrFetchLinkPreview(url)
  const host = hostOf(url)
  const title = (preview?.title ?? host).slice(0, 120)
  const names = title === host ? [title] : [title, `${title} · ${host}`]
  for (const name of names) {
    const result = await createEntity(context, {
      type: 'resource',
      name,
      fields: { url, ...(preview?.description ? { subtitle: preview.description.slice(0, 280) } : {}) },
    })
    if (result.ok) {
      if (preview?.imageUrl) await wearUnfurl(result.node.id, url)
      return { node: result.node, created: true }
    }
    if (result.status !== 409) throw new ApiError(result.status, result.error)
  }
  throw new ApiError(409, `A resource named "${title}" already exists`)
}
