/**
 * A link as a resource — Slack's "remote file": the URL, the page's unfurl,
 * and an image of it we host ourselves. One per page per space: every share
 * of the same page, however it was written (`/edit#gid=0`, `?utm_source=`),
 * lands on the one row its canonical URL names (`resources_space_id_canonical_url_key`).
 */
import prisma from '@/lib/prisma'
import { canonicalUrl, providerOf } from '@/lib/links/shared/providers'
import { hostOf } from '@/lib/links/shared/unfurl'

export interface LinkRecord {
  id: string
  created: boolean
}

/**
 * The space's resource for `url`, made if it has none. A trashed one is
 * brought back: sharing a link again is asking for it again. Null when the URL
 * is not an http(s) link.
 */
export async function upsertLinkResource(input: {
  spaceId: string
  url: string
  createdBy: string | null
  name?: string | null
}): Promise<LinkRecord | null> {
  const canonical = canonicalUrl(input.url)
  if (!canonical) return null
  const existing = await prisma.resource.findUnique({
    where: { spaceId_canonicalUrl: { spaceId: input.spaceId, canonicalUrl: canonical } },
    select: { id: true, deletedAt: true },
  })
  if (existing) {
    if (existing.deletedAt) {
      await prisma.resource.update({
        where: { id: existing.id },
        data: { deletedAt: null, deletedBy: null, state: 'ready' },
      })
    }
    return { id: existing.id, created: false }
  }
  const known = providerOf(input.url)
  try {
    const row = await prisma.resource.create({
      data: {
        spaceId: input.spaceId,
        name: (input.name?.trim() || hostOf(input.url)).slice(0, 200),
        fileType: 'link',
        kind: 'link',
        source: 'link',
        state: 'ready',
        url: input.url,
        canonicalUrl: canonical,
        provider: known?.provider ?? 'web',
        embedUrl: known?.embedUrl ?? null,
        fetchState: 'pending',
        scanState: 'skipped',
        indexState: 'unsupported',
        uploadedBy: input.createdBy ?? 'system',
        createdBy: input.createdBy,
      },
      select: { id: true },
    })
    return { id: row.id, created: true }
  } catch (err) {
    // Two shares of a new page racing: the loser reads the winner's row.
    const raced = await prisma.resource.findUnique({
      where: { spaceId_canonicalUrl: { spaceId: input.spaceId, canonicalUrl: canonical } },
      select: { id: true },
    })
    if (raced) return { id: raced.id, created: false }
    throw err
  }
}
