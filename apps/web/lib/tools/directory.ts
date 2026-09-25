/**
 * Tools in Discover: every Tool Visvine lists, one card per LISTING (its
 * newest listed version), and its About for someone who has not installed it
 * — the facts an admin reads before installing, and the source one click away.
 *
 * Browsing opens to every signed-in person only once monitoring can pull a
 * listing back (docs/tools-system-plan.md § 10); until `TOOLS_DIRECTORY=open`
 * the directory answers Visvine's reviewers alone, and a listing is installed
 * by key as before (`directoryOpenTo`).
 */
import prisma from '@/lib/prisma'
import { adminSpaceIds } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/session'
import { describePerimeter } from './perimeter'
import { manifestOf, type ToolConfig } from './config'
import { decodeToolConfig, decodeToolPerimeter, pageByCursor } from './registry'
import { isStaged } from './shared/listing'
import type { ToolManifestFacts } from '@visvine/tool-protocol/manifest'

/** Who may browse the directory now. */
export function directoryOpenTo(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return env.TOOLS_DIRECTORY?.trim().toLowerCase() === 'open' || isSuperAdmin(email)
}

export interface ListingCard {
  listingId: string
  versionId: string
  key: string
  name: string
  title: string
  description: string | null
  iconSvg: string | null
  rail: { label: string; icon: string } | null
  tags: string[]
  release: string | null
  version: number
  publisher: { spaceId: string; name: string | null }
  verified: boolean
  license: string | null
  /** Spaces running it now. */
  installs: number
  /** When Visvine reviewed the version shown. */
  reviewedAt: string | null
  listedAt: string | null
  /** Still in its first days: installable in a bounded number of spaces. */
  staged: boolean
}

export interface ListingAbout extends ListingCard {
  releaseNotes: string | null
  /** Who co-signed it. */
  author: string | null
  /** The declared reach in words, before any slot is bound. */
  reach: string[]
  /** The facts an install binds and consents to. */
  manifest: ToolManifestFacts
  surfaces: ToolConfig['surfaces']
  /** The connectors it names — its only way out of a space. */
  egress: string[]
  history: Array<{ version: number; release: string | null; releaseNotes: string | null; reviewedAt: string | null }>
}

const VERSION_SELECT = {
  id: true,
  listingId: true,
  key: true,
  name: true,
  title: true,
  description: true,
  iconSvg: true,
  tags: true,
  version: true,
  config: true,
  perimeter: true,
  releaseNotes: true,
  marketplaceReviewedAt: true,
  createdAt: true,
} as const

type VersionRow = {
  id: string
  listingId: string | null
  key: string
  name: string
  title: string
  description: string | null
  iconSvg: string | null
  tags: string[]
  version: number
  config: unknown
  perimeter: unknown
  releaseNotes: string | null
  marketplaceReviewedAt: Date | null
  createdAt: Date
}

type ListingRow = {
  id: string
  key: string
  publisherSpaceId: string
  verified: boolean
  license: string | null
  listedAt: Date | null
  stagedUntil: Date | null
  authorUserId: string | null
}

const LISTING_SELECT = {
  id: true,
  key: true,
  publisherSpaceId: true,
  verified: true,
  license: true,
  listedAt: true,
  stagedUntil: true,
  authorUserId: true,
} as const

function cardOf(listing: ListingRow, version: VersionRow, publisher: string | null, installs: number, now: Date): ListingCard {
  const config = decodeToolConfig(version.config, version.name)
  return {
    listingId: listing.id,
    versionId: version.id,
    key: listing.key,
    name: version.name,
    title: config.title || version.title,
    description: version.description,
    iconSvg: version.iconSvg,
    rail: config.surfaces.rail,
    tags: version.tags,
    release: manifestOf(config).release,
    version: version.version,
    publisher: { spaceId: listing.publisherSpaceId, name: publisher },
    verified: listing.verified,
    license: listing.license,
    installs,
    reviewedAt: version.marketplaceReviewedAt?.toISOString() ?? null,
    listedAt: listing.listedAt?.toISOString() ?? null,
    staged: isStaged(listing, now),
  }
}

/** The newest listed version of each listing named. */
async function newestListed(listingIds: readonly string[]): Promise<Map<string, VersionRow>> {
  if (listingIds.length === 0) return new Map()
  const rows = await prisma.appToolVersion.findMany({
    where: { listingId: { in: [...listingIds] }, status: 'approved', marketplaceStatus: 'approved', revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: VERSION_SELECT,
  })
  const out = new Map<string, VersionRow>()
  for (const row of rows) if (row.listingId && !out.has(row.listingId)) out.set(row.listingId, row)
  return out
}

async function installCounts(listingIds: readonly string[]): Promise<Map<string, number>> {
  if (listingIds.length === 0) return new Map()
  const rows = await prisma.appToolInstall.groupBy({
    by: ['listingId'],
    where: { listingId: { in: [...listingIds] }, sharedFromSpaceId: null },
    _count: { _all: true },
  })
  return new Map(rows.filter((row) => row.listingId).map((row) => [row.listingId as string, row._count._all]))
}

async function spaceNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.space.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** One page of the directory: listed, active listings, most installed first. */
export async function browseListings(
  opts: { q?: string; cursor?: string; limit?: number } = {},
  now: Date = new Date(),
): Promise<{ items: ListingCard[]; nextCursor: string | null }> {
  const listings = await prisma.appToolListing.findMany({
    where: { state: 'active', listedAt: { not: null } },
    select: LISTING_SELECT,
  })
  const ids = listings.map((l) => l.id)
  const [versions, counts, names] = await Promise.all([
    newestListed(ids),
    installCounts(ids),
    spaceNames(listings.map((l) => l.publisherSpaceId)),
  ])
  const q = opts.q?.trim().toLowerCase() ?? ''
  const cards: ListingCard[] = []
  for (const listing of listings) {
    const version = versions.get(listing.id)
    if (!version) continue
    const card = cardOf(listing, version, names.get(listing.publisherSpaceId) ?? null, counts.get(listing.id) ?? 0, now)
    if (q && ![card.title, card.name, card.description ?? '', ...card.tags, card.publisher.name ?? ''].some((text) => text.toLowerCase().includes(q))) continue
    cards.push(card)
  }
  cards.sort((a, b) => b.installs - a.installs || a.title.localeCompare(b.title) || a.listingId.localeCompare(b.listingId))
  // Paged by listing id, which stays put while its key may move with a transfer.
  const { page, nextCursor } = pageByCursor(
    cards.map((card) => ({ key: card.listingId, card })),
    opts.cursor ?? null,
    opts.limit,
  )
  return { items: page.map((entry) => entry.card), nextCursor }
}

/** A listing's About, or null when it is not listed (or held). */
export async function listingAbout(listingId: string, now: Date = new Date()): Promise<ListingAbout | null> {
  const listing = await prisma.appToolListing.findFirst({
    where: { id: listingId, state: 'active', listedAt: { not: null } },
    select: LISTING_SELECT,
  })
  if (!listing) return null
  const [versions, counts, names] = await Promise.all([
    newestListed([listing.id]),
    installCounts([listing.id]),
    spaceNames([listing.publisherSpaceId]),
  ])
  const version = versions.get(listing.id)
  if (!version) return null
  const config = decodeToolConfig(version.config, version.name)
  const perimeter = decodeToolPerimeter(version.perimeter)
  const [author, history] = await Promise.all([
    listing.authorUserId ? prisma.user.findUnique({ where: { id: listing.authorUserId }, select: { name: true } }) : null,
    prisma.appToolVersion.findMany({
      where: { listingId: listing.id, marketplaceStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { version: true, config: true, name: true, releaseNotes: true, marketplaceReviewedAt: true },
    }),
  ])
  return {
    ...cardOf(listing, version, names.get(listing.publisherSpaceId) ?? null, counts.get(listing.id) ?? 0, now),
    releaseNotes: version.releaseNotes,
    author: author?.name ?? null,
    reach: describePerimeter(perimeter),
    manifest: manifestOf(config),
    surfaces: config.surfaces,
    egress: perimeter.connectors,
    history: history.map((row) => ({
      version: row.version,
      release: manifestOf(decodeToolConfig(row.config, row.name)).release,
      releaseNotes: row.releaseNotes,
      reviewedAt: row.marketplaceReviewedAt?.toISOString() ?? null,
    })),
  }
}

/**
 * The listed version's source, for an admin deciding whether to install it —
 * every installing admin may read what they would run. Null for anyone who
 * administers no space.
 */
export async function listingSource(
  listingId: string,
  viewer: { userId: string; email: string },
): Promise<{ versionId: string; files: Record<string, string> } | null> {
  if (!isSuperAdmin(viewer.email)) {
    const memberships = await prisma.spaceMember.findMany({ where: { userId: viewer.userId, status: 'active' }, select: { spaceId: true } })
    const admin = await adminSpaceIds(viewer.userId, memberships.map((m) => m.spaceId), viewer.email)
    if (admin.size === 0) return null
  }
  const versions = await newestListed([listingId])
  const version = versions.get(listingId)
  if (!version) return null
  const row = await prisma.appToolVersion.findUnique({
    where: { id: version.id },
    select: { indexSource: true, uiSource: true, dataSource: true, modules: true },
  })
  if (!row) return null
  const files: Record<string, string> = { 'README.md': row.indexSource, 'src/ui.tsx': row.uiSource }
  if (row.dataSource.trim()) files['src/data.js'] = row.dataSource
  if (row.modules && typeof row.modules === 'object' && !Array.isArray(row.modules)) {
    for (const [file, code] of Object.entries(row.modules as Record<string, unknown>)) if (typeof code === 'string') files[file] = code
  }
  return { versionId: version.id, files }
}
