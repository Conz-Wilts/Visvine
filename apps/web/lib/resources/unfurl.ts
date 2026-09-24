/**
 * Unfurl a link resource: read what the page (or the provider's own API) says
 * about it, bring its images home, and make it a proper entity — the job the
 * queue runs for every new link and every stale one (lib/resources/jobs.ts).
 *
 * Precedence, strongest first: the provider's entity through the sharer's
 * connected account (a Google file's real name, owner and date), then the
 * page's oEmbed, JSON-LD, Open Graph, Twitter and `<title>` (lib/links/shared/unfurl.ts).
 * The page's image and favicon are fetched through the SSRF-gated door and
 * re-encoded into this space's own renditions — a browser is never sent to the
 * page's image host, and a hostile image is only ever pixels.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { revalidateTag } from 'next/cache'
import { getOrFetchLinkPreview } from '@/lib/linkPreview'
import { hostOf } from '@/lib/links/shared/unfurl'
import { saveRendition } from '@/lib/resources/renditions'
import { ensureResourceEntity } from '@/lib/resources/entity'
import { syncResourceGrants } from '@/lib/resources/grants'
import { fetchPublicImage } from '@/lib/resources/unfurlFetch'
import { googleDriveEntity, type ProviderEntity } from '@/lib/resources/providers/googleDrive'
import { linkCardOf, resourceImagePath, type StoredUnfurl } from '@/lib/resources/shared/linkCard'
import { publishToUsers } from '@/lib/messages/realtime'
import { resourceNameOf } from '@/lib/resources/shared/fileNode'
import { largestPngInIco } from '@/lib/resources/shared/ico'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_FAVICON_BYTES = 200 * 1024

async function providerEntity(provider: string | null, url: string, sharerId: string | null): Promise<ProviderEntity | null> {
  if (provider?.startsWith('google-')) return googleDriveEntity(url, sharerId)
  return null
}

async function keepImage(resource: { id: string; spaceId: string }, bytes: Buffer | null, kinds: Array<'preview' | 'thumb' | 'favicon'>): Promise<boolean> {
  if (!bytes) return false
  try {
    for (const kind of kinds) await saveRendition(resource, kind, bytes)
    return true
  } catch (err) {
    // Not an image sharp can read (an SVG favicon, a broken file): no image.
    logger.warn('resources.unfurl.image', { resourceId: resource.id, err })
    return false
  }
}

/** The job: unfurl, re-host, name, and tell the channels that hold it. */
export async function unfurlResource(resourceId: string): Promise<void> {
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, spaceId: true, source: true, name: true, url: true, provider: true, createdBy: true, fetchedAt: true },
  })
  if (!resource || resource.source !== 'link' || !resource.url) return
  const url = resource.url

  const [entity, scraped] = await Promise.all([
    providerEntity(resource.provider, url, resource.createdBy),
    // A refresh re-reads the page even when the shared cache is fresh.
    getOrFetchLinkPreview(url, { force: resource.fetchedAt !== null }).then((r) => r.preview),
  ])

  const unfurl: StoredUnfurl = {
    title: entity?.title ?? scraped?.title ?? null,
    description: scraped?.description ?? null,
    siteName: scraped?.siteName ?? null,
    authorName: entity?.owner ?? scraped?.authorName ?? null,
    publishedAt: scraped?.publishedAt?.toISOString() ?? null,
    mediaType: scraped?.mediaType ?? null,
    imageLayout: scraped?.imageLayout === 'summary' ? 'summary' : 'large',
  }

  const image = entity?.thumbnail ?? (scraped?.imageUrl ? await fetchPublicImage(scraped.imageUrl, MAX_IMAGE_BYTES) : null)
  const hasImage = await keepImage(resource, image, ['preview', 'thumb'])
  await keepImage(resource, await fetchFavicon(scraped?.faviconUrl ?? null, url), ['favicon'])

  const ok = Boolean(entity || scraped)
  const placeholder = !resource.name || resource.name === hostOf(url) || resource.name === url
  await prisma.resource.update({
    where: { id: resourceId },
    data: {
      ...(placeholder && unfurl.title ? { name: unfurl.title.slice(0, 200) } : {}),
      unfurl: { ...unfurl, imageLayout: hasImage ? unfurl.imageLayout : null },
      previewPath: hasImage
        ? (await prisma.resourceRendition.findUnique({ where: { resourceId_kind: { resourceId, kind: 'preview' } }, select: { gcsPath: true } }))?.gcsPath ?? null
        : null,
      fetchedAt: new Date(),
      fetchState: ok ? 'ok' : 'failed',
      entitySource: entity ? entity.source : ok ? 'scrape' : null,
      external: entity
        ? { owner: entity.owner, modifiedAt: entity.modifiedAt, size: entity.size, mimeType: entity.mimeType }
        : undefined,
    },
  })

  // The entity is made once the page has told us its name, so the note is
  // `resources/<its-title>/`, not `resources/<its-host>/`.
  const { nodeId } = await ensureResourceEntity(resourceId)
  if (nodeId) {
    await prisma.node.update({
      where: { id: nodeId },
      data: {
        ...(unfurl.description ? { subtitle: unfurl.description.slice(0, 280) } : {}),
        ...(hasImage ? { imageUrl: resourceImagePath(resourceId, 'thumb') } : {}),
        ...(placeholder && unfurl.title ? { name: resourceNameOf(unfurl.title.slice(0, 200)) } : {}),
      },
    })
    try {
      revalidateTag('context-data-v2', { expire: 0 })
    } catch {
      /* outside a request */
    }
  }
  await syncResourceGrants(resourceId)
  await announce(resourceId)
}

/** Tell the members of every channel holding the link that its card is ready. */
async function announce(resourceId: string): Promise<void> {
  const row = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: {
      id: true, name: true, url: true, provider: true, embedUrl: true, unfurl: true, previewPath: true, fetchState: true,
      renditions: { select: { kind: true } },
      shares: { where: { messageId: { not: null } }, select: { conversationId: true } },
    },
  })
  if (!row) return
  const conversations = [...new Set(row.shares.map((s) => s.conversationId).filter((id): id is string => !!id))]
  if (conversations.length === 0) return
  const members = await prisma.conversationMember.findMany({
    where: { conversationId: { in: conversations } },
    select: { userId: true, conversationId: true },
  })
  const card = linkCardOf(row)
  for (const conversationId of conversations) {
    publishToUsers(
      members.filter((m) => m.conversationId === conversationId).map((m) => m.userId),
      { type: 'resource.updated', conversationId, card },
    )
  }
}

/**
 * A page's icon as something sharp can read: the icon it names, the PNG inside
 * an .ico, or the site's apple-touch-icon when neither will do.
 */
async function fetchFavicon(named: string | null, pageUrl: string): Promise<Buffer | null> {
  const icon = named ? await fetchPublicImage(named, MAX_FAVICON_BYTES) : null
  if (icon && !isIco(icon)) return icon
  const inner = icon ? largestPngInIco(icon) : null
  if (inner) return inner
  try {
    return await fetchPublicImage(new URL('/apple-touch-icon.png', pageUrl).toString(), MAX_FAVICON_BYTES)
  } catch {
    return null
  }
}

function isIco(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1
}
