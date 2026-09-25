import { NextRequest, NextResponse } from 'next/server'
import { requireToolSession } from '@/lib/tools/route'
import { resolveBridgeTarget } from '@/lib/tools/target'
import { countEvent, maybeFlushTelemetry } from '@/lib/tools/telemetry'

/**
 * `POST /api/tools/telemetry { target, event: 'frame_error' }` — the host
 * saying a Tool's frame crashed. A count, never the error's content
 * (lib/tools/telemetry.ts); resolved like a bridge call, so a viewer counts
 * only a Tool they could open.
 */
export async function POST(req: NextRequest) {
  const caller = await requireToolSession()
  if (caller instanceof Response) return caller
  const body = (await req.json().catch(() => null)) as { target?: unknown; event?: unknown } | null
  if (body?.event !== 'frame_error') return NextResponse.json({ error: 'Unknown event.' }, { status: 400 })
  const resolved = await resolveBridgeTarget(caller.session, body.target, undefined, caller.client)
  if ('code' in resolved) return NextResponse.json({ error: resolved.message }, { status: 403 })
  if (resolved.installId && resolved.versionId) {
    countEvent({ installId: resolved.installId, versionId: resolved.versionId, kind: 'frame_error' })
    await maybeFlushTelemetry()
  }
  return NextResponse.json({ ok: true })
}
