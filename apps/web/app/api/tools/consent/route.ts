import { NextRequest, NextResponse } from 'next/server'
import { requireToolSession } from '@/lib/tools/route'
import { resolveBridgeTarget } from '@/lib/tools/target'
import { giveConsent } from '@/lib/tools/consents'
import { actingReachOf, actsAsViewer } from '@/lib/tools/shared/listing'
import { toolActionActs } from '@/lib/tools/actionAllowlist'

/**
 * `POST /api/tools/consent { target }` — a member pressing Continue on a
 * listed Tool's first-use notice. The target is resolved like a bridge call,
 * and what is remembered is the acting reach the SERVER derives for it now —
 * never anything the page sends — so the answer covers exactly what the
 * member was shown (lib/tools/consents.ts).
 */
export async function POST(req: NextRequest) {
  const caller = await requireToolSession()
  if (caller instanceof Response) return caller
  const { session, client } = caller
  const body = (await req.json().catch(() => null)) as { target?: unknown } | null
  const resolved = await resolveBridgeTarget(session, body?.target, undefined, client)
  if ('code' in resolved) return NextResponse.json({ error: resolved.message }, { status: 403 })
  if (!resolved.installId || !resolved.foreign || !resolved.reach) {
    return NextResponse.json({ error: 'This tool does not ask.' }, { status: 400 })
  }
  const acting = actingReachOf(resolved.reach, toolActionActs)
  if (!actsAsViewer(acting)) return NextResponse.json({ error: 'This tool does not act as anyone.' }, { status: 400 })
  await giveConsent(resolved.installId, session.userId, acting)
  return NextResponse.json({ ok: true })
}
