import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { COOKIE_NAME, createSession } from '@/lib/session'
import { inSpace } from '@/lib/spaces/shared/spaceUrl'
import { verifyReviewTicket } from '@/lib/tools/review/ticket'

/**
 * `GET /api/tools/review-run/enter?ticket=…` — where the dynamic run's browser
 * signs in (lib/tools/review/ticket.ts). The ticket is traded for a short
 * session as the review runner, and only while its run is running and names
 * that runner; the browser then lands on the review page in the run's
 * honeypot. Anything else is a 404 that says nothing.
 */
export const dynamic = 'force-dynamic'

/** Longer than a run's browser session, shorter than anything else. */
const SESSION_TTL_S = 600

export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get('ticket') ?? ''
  const claim = ticket ? await verifyReviewTicket(ticket) : null
  const run = claim
    ? await prisma.appToolReviewRun.findUnique({
        where: { id: claim.runId },
        select: { status: true, runnerUserId: true, honeypotSpaceId: true },
      })
    : null
  if (!claim || !run || run.status !== 'running' || run.runnerUserId !== claim.runnerUserId || !run.honeypotSpaceId) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  const user = await prisma.user.findUnique({ where: { id: claim.runnerUserId }, select: { id: true, name: true, email: true } })
  if (!user) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const token = await createSession({ userId: user.id, name: user.name, email: user.email }, { maxAgeSeconds: SESSION_TTL_S })
  const response = NextResponse.redirect(new URL(inSpace(run.honeypotSpaceId, `/tools/review/${claim.runId}`), req.nextUrl.origin))
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_S,
    path: '/',
  })
  return response
}
