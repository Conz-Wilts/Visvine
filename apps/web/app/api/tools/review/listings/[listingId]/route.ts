import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { parseBody } from '@/lib/api/route'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { holdListing } from '@/lib/tools/verdicts'
import { setPublisherVerified } from '@/lib/tools/publishers'
import { runReviewNow } from '@/lib/tools/review/run'

const schema = z.union([
  z.object({ hold: z.enum(['active', 'suspended', 'revoked']), reason: z.string().max(500).optional() }),
  z.object({ verified: z.boolean(), note: z.string().max(500).optional() }),
  // Visvine's own stages over the newest listed version, again, now.
  z.object({ rerun: z.literal(true) }),
])

/**
 * `POST /api/tools/review/listings/<id>` — Visvine's hold over one listing
 * (suspend, reinstate, remove for good), its word on the listing's
 * publisher, or its own stages run again over the newest listed version — a
 * block there holds the listing at once. Reviewers only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) return NextResponse.json({ error: 'Only Visvine reviewers.' }, { status: 403 })
  const body = await parseBody(req, schema)
  if (body instanceof NextResponse) return body
  const reviewer = { userId: session.userId, email: session.email }
  if ('rerun' in body) {
    const newest = await prisma.appToolVersion.findFirst({
      where: { listingId, marketplaceStatus: 'approved', revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!newest) return NextResponse.json({ error: 'Nothing of it is listed.' }, { status: 404 })
    const status = await runReviewNow(newest.id)
    return NextResponse.json({ ok: status !== 'error', status })
  }
  if ('hold' in body) {
    const held = await holdListing({ listingId }, body.hold, reviewer, body.reason ?? null)
    if (!held.ok) return NextResponse.json({ error: held.error }, { status: held.status })
    return NextResponse.json({ ok: true })
  }
  const listing = await prisma.appToolListing.findUnique({ where: { id: listingId }, select: { publisherSpaceId: true } })
  if (!listing) return NextResponse.json({ error: 'No such listing.' }, { status: 404 })
  const set = await setPublisherVerified(listing.publisherSpaceId, reviewer, body.verified, body.note)
  if (!set.ok) return NextResponse.json({ error: set.error }, { status: set.status })
  return NextResponse.json({ ok: true })
}
