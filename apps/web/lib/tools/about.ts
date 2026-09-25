/**
 * A Tool's About view — its package page, opened from the ⋯ menu on its page
 * (and, for a Tool not yet installed, from wherever it is offered). Everything
 * a member or an admin reads before trusting it: what it is, which release,
 * who made it and where, what it can do in words, whether anything leaves the
 * space through it, and how widely it runs.
 *
 * A Tool's only way out of Visvine is a connector it declared: its frame has
 * `connect-src 'none'` and `data.js` has no `fetch`. So "Egress" is either
 * None or the connectors it names — a stronger claim than most platforms can
 * make, and one worth saying.
 */
import prisma from '@/lib/prisma'
import { describePerimeter } from './perimeter'
import { decodeToolConfig, decodeToolPerimeter, decodeVersionStatus, type ToolVersionStatus } from './registry'
import { decodeListingState, runDenial, type ListingState } from './verdicts'
import { isVerifiedPublisher } from './publishers'

export interface ToolAbout {
  title: string
  description: string | null
  name: string
  version: number
  releaseNotes: string | null
  publishedAt: string
  /** The space that made it; its name only when the viewer may know it. */
  publisher: { spaceId: string; name: string | null; here: boolean }
  author: string | null
  /** The declared reach, in words. */
  reach: string[]
  /** The connectors it can call — its only way out. Empty means none. */
  egress: string[]
  /** How many spaces run this Tool. */
  installs: number
  status: ToolVersionStatus
  listed: boolean
  listing: ListingState | null
  /** The license it was listed under, when it was. */
  license: string | null
  /** Visvine's word that its publisher is who they say they are. */
  verified: boolean
  /** When Visvine reviewed the version it runs. */
  reviewedAt: string | null
  /** Why it no longer runs, when it was pulled back. */
  stopped: string | null
}

/** The About of the install `installId` in `spaceId`, or null when there is none. */
export async function aboutInstall(spaceId: string, installId: string): Promise<ToolAbout | null> {
  const install = await prisma.appToolInstall.findFirst({
    where: { id: installId, spaceId },
    select: {
      key: true,
      spaceId: true,
      sharedFromSpaceId: true,
      listingId: true,
      version: {
        select: {
          name: true,
          title: true,
          description: true,
          version: true,
          releaseNotes: true,
          submittedAt: true,
          sourceSpaceId: true,
          status: true,
          marketplaceStatus: true,
          config: true,
          perimeter: true,
          revokedAt: true,
          revokeReason: true,
          license: true,
          marketplaceReviewedAt: true,
          author: { select: { name: true } },
        },
      },
    },
  })
  if (!install) return null
  const v = install.version
  const perimeter = decodeToolPerimeter(v.perimeter)
  const config = decodeToolConfig(v.config, v.name)
  const here = v.sourceSpaceId === spaceId
  const [installs, listing, source] = await Promise.all([
    prisma.appToolInstall.count({ where: install.listingId ? { listingId: install.listingId } : { key: install.key } }),
    prisma.appToolListing.findFirst({
      where: install.listingId ? { id: install.listingId } : { key: install.key },
      select: { state: true, stateReason: true, license: true, publisherSpaceId: true },
    }),
    // A publisher outside this space is named only when its Tool is listed —
    // listing is the publisher's own choice to be seen.
    here || v.marketplaceStatus === 'approved'
      ? prisma.space.findUnique({ where: { id: v.sourceSpaceId }, select: { name: true } })
      : Promise.resolve(null),
  ])
  const hold = listing ? { state: decodeListingState(listing.state), stateReason: listing.stateReason } : null
  return {
    title: config.title || v.title,
    description: v.description,
    name: v.name,
    version: v.version,
    releaseNotes: v.releaseNotes,
    publishedAt: v.submittedAt.toISOString(),
    publisher: { spaceId: v.sourceSpaceId, name: source?.name ?? null, here },
    author: v.author?.name ?? null,
    reach: describePerimeter(perimeter),
    egress: perimeter.connectors,
    installs,
    status: decodeVersionStatus(v.status),
    listed: v.marketplaceStatus === 'approved',
    listing: hold?.state ?? null,
    license: v.license ?? listing?.license ?? null,
    verified: listing ? await isVerifiedPublisher(listing.publisherSpaceId) : false,
    reviewedAt: v.marketplaceStatus === 'approved' ? (v.marketplaceReviewedAt?.toISOString() ?? null) : null,
    stopped:
      runDenial({
        version: { revokedAt: v.revokedAt, revokeReason: v.revokeReason },
        listing: hold,
        sourceSpaceId: v.sourceSpaceId,
        installSpaceId: install.spaceId,
        sharedFromSpaceId: install.sharedFromSpaceId,
      })?.message ?? null,
  }
}
