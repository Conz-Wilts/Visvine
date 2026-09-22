import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleApiError, parseBody, requireApiSession } from '@/lib/api/route'
import { linkForUser, reachableLines, removeLink, startLink } from '@/lib/imessage/links'
import { sendblueConfigured } from '@/lib/imessage/sendblue'
import { codeIsLive } from '@/lib/imessage/shared/link'

/**
 * Settings → Accounts → Phone (docs/imessage.md § Linking).
 *
 * GET     the caller's phone and its state, plus the lines they could text a
 *         pending code to.
 * POST    start linking a number: answers the code to text.
 * DELETE  unlink.
 */
async function state(userId: string) {
  const [link, lines] = await Promise.all([linkForUser(userId), reachableLines(userId)])
  const now = new Date()
  return {
    configured: sendblueConfigured(),
    phone: link?.phone ?? null,
    verified: Boolean(link?.verifiedAt),
    code: link && !link.verifiedAt && codeIsLive(link.code, link.codeExpiresAt, now) ? link.code : null,
    codeExpiresAt: link && !link.verifiedAt && codeIsLive(link.code, link.codeExpiresAt, now) ? link.codeExpiresAt!.toISOString() : null,
    lines,
  }
}

export async function GET() {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await state(session.userId))
  } catch (error) {
    return handleApiError(error, 'api.account.imessage.get.failed')
  }
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  const body = await parseBody(req, z.object({ phone: z.string().min(3).max(32) }))
  if (body instanceof NextResponse) return body
  try {
    const started = await startLink(session.userId, body.phone)
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status })
    return NextResponse.json(await state(session.userId))
  } catch (error) {
    return handleApiError(error, 'api.account.imessage.start.failed')
  }
}

export async function DELETE() {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  try {
    await removeLink(session.userId)
    return NextResponse.json(await state(session.userId))
  } catch (error) {
    return handleApiError(error, 'api.account.imessage.remove.failed')
  }
}
