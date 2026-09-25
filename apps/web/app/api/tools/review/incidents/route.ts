import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin, requireSession } from '@/lib/session'
import { listIncidents } from '@/lib/tools/reviewConsole'

/** `GET /api/tools/review/incidents?status=open|all` — what monitoring and members raised. Reviewers only. */
export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  if (!isSuperAdmin(session.email)) return NextResponse.json({ error: 'Only Visvine reviewers.' }, { status: 403 })
  const status = req.nextUrl.searchParams.get('status') === 'all' ? 'all' : 'open'
  return NextResponse.json({ incidents: await listIncidents({ status }) })
}
