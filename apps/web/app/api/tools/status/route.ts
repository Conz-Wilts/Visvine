import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { resolveBridgeTarget } from '@/lib/tools/target'

/**
 * `GET /api/tools/status?target=<BridgeTarget JSON>` — whether a frame the host
 * already has open may keep running. The host asks once a minute, and at once
 * when its changes stream says a verdict moved, so a Tool that makes no calls
 * still stops within a minute of being withdrawn (lib/tools/verdicts.ts).
 * Always 200: `{ ok: true }`, or `{ ok: false, error }` with the bridge's code.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session
  let target: unknown = null
  try {
    const raw = req.nextUrl.searchParams.get('target')
    target = raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    target = null
  }
  const resolved = await resolveBridgeTarget(session, target)
  if ('code' in resolved) return NextResponse.json({ ok: false, error: resolved })
  return NextResponse.json({ ok: true })
}
