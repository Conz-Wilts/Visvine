import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { parseBody } from '@/lib/api/route'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import { answerTransfer, offerTransfer } from '@/lib/tools/listings'
import { decodeToolConfig } from '@/lib/tools/registry'
import type { SpaceListingsResponse } from '@/lib/tools/api'

/**
 * `GET …/tools/listings` — the listings this space publishes, and the ones
 * another space has offered to it. `POST` moves one (lib/tools/listings.ts):
 * `offer` from the publishing space's admins, `accept` or `decline` from the
 * receiving space's. Admins only, both ways.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Only space admins manage listings.', 403)
  const here = ctx.resolved.spaceId
  const rows = await prisma.appToolListing.findMany({
    where: { OR: [{ publisherSpaceId: here, listedAt: { not: null } }, { transferTo: here }] },
    select: { id: true, key: true, publisherSpaceId: true, verified: true, transferTo: true },
  })
  const ids = rows.map((row) => row.id)
  const [titles, counts, spaces] = await Promise.all([
    prisma.appToolVersion.findMany({
      where: { listingId: { in: ids }, marketplaceStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      select: { listingId: true, name: true, config: true, title: true },
    }),
    prisma.appToolInstall.groupBy({ by: ['listingId'], where: { listingId: { in: ids } }, _count: { _all: true } }),
    prisma.space.findMany({
      where: { id: { in: [...new Set(rows.flatMap((row) => [row.publisherSpaceId, row.transferTo ?? '']).filter(Boolean))] } },
      select: { id: true, name: true },
    }),
  ])
  const titleOf = (id: string, key: string) => {
    const row = titles.find((t) => t.listingId === id)
    return row ? decodeToolConfig(row.config, row.name).title || row.title : key.slice(key.indexOf('/') + 1)
  }
  const nameOf = (id: string) => spaces.find((space) => space.id === id)?.name ?? null
  const body: SpaceListingsResponse = {
    listings: rows
      .filter((row) => row.publisherSpaceId === here)
      .map((row) => ({
        listingId: row.id,
        key: row.key,
        title: titleOf(row.id, row.key),
        verified: row.verified,
        installs: counts.find((c) => c.listingId === row.id)?._count._all ?? 0,
        transferTo: row.transferTo ? { id: row.transferTo, name: nameOf(row.transferTo) } : null,
      })),
    offers: rows
      .filter((row) => row.transferTo === here)
      .map((row) => ({ listingId: row.id, key: row.key, title: titleOf(row.id, row.key), from: { id: row.publisherSpaceId, name: nameOf(row.publisherSpaceId) } })),
  }
  return NextResponse.json(body)
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('offer'), listingId: z.string().min(1), toSpaceId: z.string().min(1).nullable() }),
  z.object({ action: z.literal('accept'), listingId: z.string().min(1), name: z.string().optional() }),
  z.object({ action: z.literal('decline'), listingId: z.string().min(1) }),
])

export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const body = await parseBody(req, actionSchema)
  if (body instanceof NextResponse) return body
  const actor = {
    userId: ctx.principal.userId,
    email: ctx.principal.email ?? ctx.principal.userId,
    spaceId: ctx.resolved.spaceId,
    isAdmin: ctx.resolved.isAdmin,
  }
  const result =
    body.action === 'offer'
      ? await offerTransfer({ listingId: body.listingId }, actor, body.toSpaceId)
      : await answerTransfer(body.listingId, actor, { accept: body.action === 'accept', name: body.action === 'accept' ? body.name : undefined })
  if (!result.ok) return bad(result.error, result.status)
  return NextResponse.json({ listingId: result.listingId, key: result.key, transferTo: result.transferTo })
}
