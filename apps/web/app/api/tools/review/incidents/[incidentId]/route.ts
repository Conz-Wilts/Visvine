import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { resolveIncident } from '@/lib/tools/reviewConsole'

const schema = z.object({ action: z.enum(['clear', 'confirm']) })

/**
 * `POST /api/tools/review/incidents/<id> { action }` — a reviewer's word on
 * one incident. Reinstating or removing the listing it held is its own act,
 * on the listing.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) return NextResponse.json({ error: 'Only Visvine reviewers.' }, { status: 403 })
  const body = await parseBody(req, schema)
  if (body instanceof NextResponse) return body
  const result = await resolveIncident(incidentId, { userId: session.userId, email: session.email }, body.action)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
