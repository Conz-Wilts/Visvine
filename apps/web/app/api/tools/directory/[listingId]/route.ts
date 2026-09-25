import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminSpaceIds } from '@/lib/auth'
import { requireSession } from '@/lib/session'
import { directoryOpenTo, listingAbout } from '@/lib/tools/directory'
import { stagedInstallRefusal } from '@/lib/tools/listings'
import type { InstallTargetSpace, ListingAboutResponse } from '@/lib/tools/api'

/**
 * `GET /api/tools/directory/<listingId>` — a listed Tool's About for someone
 * who has not installed it, with the spaces they administer it could go into:
 * each says whether it is there already, or why it cannot go in now.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!directoryOpenTo(session.email)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const about = await listingAbout(listingId)
  if (!about) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.userId, status: 'active', space: { personalOwnerId: null } },
    select: { spaceId: true, space: { select: { name: true } } },
  })
  const admin = await adminSpaceIds(session.userId, memberships.map((m) => m.spaceId), session.email)
  const mine = memberships.filter((m) => admin.has(m.spaceId))
  const installed = new Set(
    (
      await prisma.appToolInstall.findMany({
        where: { spaceId: { in: mine.map((m) => m.spaceId) }, OR: [{ listingId }, { key: about.key }] },
        select: { spaceId: true },
      })
    ).map((row) => row.spaceId),
  )
  const spaces: InstallTargetSpace[] = []
  for (const m of mine) {
    const here = installed.has(m.spaceId)
    spaces.push({
      id: m.spaceId,
      name: m.space.name,
      installed: here,
      refusal: here ? null : await stagedInstallRefusal(listingId, m.spaceId),
    })
  }
  const body: ListingAboutResponse = { about, spaces }
  return NextResponse.json(body)
}
