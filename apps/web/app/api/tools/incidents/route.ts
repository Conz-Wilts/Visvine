import { NextRequest, NextResponse } from 'next/server'
import { requireToolSession } from '@/lib/tools/route'
import { takeToken } from '@/lib/rateLimit'
import { resolveBridgeTarget } from '@/lib/tools/target'
import { incidentSubject, recordIncident } from '@/lib/tools/incidents'

/**
 * `POST /api/tools/incidents { target, kind }` — the host reporting what it saw
 * a frame do. Only `navigation` today: the frame loaded a second document the
 * host never asked for, which is a Tool trying to leave its sandbox with data
 * in the URL. The target is resolved like a bridge call, so a viewer reports
 * only a frame they could open.
 */
export const dynamic = 'force-dynamic'

const KINDS = { navigation: 'severe' } as const

export async function POST(req: NextRequest) {
  const caller = await requireToolSession()
  if (caller instanceof Response) return caller
  const { session, client } = caller
  const body = (await req.json().catch(() => null)) as { target?: unknown; kind?: unknown } | null
  const kind = typeof body?.kind === 'string' && body.kind in KINDS ? (body.kind as keyof typeof KINDS) : null
  if (!kind) return NextResponse.json({ error: 'Unknown incident.' }, { status: 400 })

  const resolved = await resolveBridgeTarget(session, body?.target, undefined, client)
  if ('code' in resolved) return NextResponse.json({ error: resolved.message }, { status: 403 })

  const limit = await takeToken(`tools:incident:${session.userId}`, { capacity: 10, refillPerSec: 0.1 })
  if (!limit.ok) return NextResponse.json({ error: 'Too many reports.' }, { status: 429 })

  await recordIncident({ kind, severity: KINDS[kind], ...incidentSubject(resolved, session.userId) })
  return NextResponse.json({ ok: true })
}
