import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleApiError, parseBody, requireApiSession } from '@/lib/api/route'
import { isSuperAdmin } from '@/lib/session'
import { assignLine, unassignLine } from '@/lib/imessage/lines'
import { pushLineProfile } from '@/lib/imessage/profile'
import { listAccountLines } from '@/lib/imessage/sendblue'

type Params = { params: Promise<{ spaceId: string }> }

/**
 * Line assignment is Visvine's act, not the space's: the line is a paid
 * resource on the deployment's one Sendblue account. Super-admins only.
 */
async function requireSuperAdmin() {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  if (!isSuperAdmin(session.email)) return NextResponse.json({ error: 'permission_denied' }, { status: 403 })
  return session
}

/** GET — the lines on the account, so the super-admin can pick one. */
export async function GET(_req: NextRequest, { params }: Params) {
  await params
  const session = await requireSuperAdmin()
  if (session instanceof NextResponse) return session
  try {
    const lines = await listAccountLines()
    return NextResponse.json({ lines: lines?.map((l) => l.number) ?? null })
  } catch (error) {
    return handleApiError(error, 'api.imessage.lines.failed')
  }
}

/** PUT — assign (or move) a line to this space, and push its card. */
export async function PUT(req: NextRequest, { params }: Params) {
  const { spaceId } = await params
  const session = await requireSuperAdmin()
  if (session instanceof NextResponse) return session
  const body = await parseBody(req, z.object({ number: z.string().min(3).max(32) }))
  if (body instanceof NextResponse) return body
  try {
    const result = await assignLine(spaceId, body.number)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    await pushLineProfile(spaceId).catch(() => undefined)
    return NextResponse.json({ number: result.line.number })
  } catch (error) {
    return handleApiError(error, 'api.imessage.assign.failed')
  }
}

/** DELETE — take the line away. Threads go with it; links are the person's and stay. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { spaceId } = await params
  const session = await requireSuperAdmin()
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json({ removed: await unassignLine(spaceId) })
  } catch (error) {
    return handleApiError(error, 'api.imessage.unassign.failed')
  }
}
