import { NextRequest, NextResponse } from 'next/server'
import { verifyRunToken } from '@/lib/agents/internalAuth'
import { executeRun } from '@/lib/agents/runner'

// This request IS the run. Cloud Run's --timeout must exceed this.
// Segment config must be a literal Next can read statically: MAX_RUN_MS (20 min) + 60s.
export const maxDuration = 1260
export const dynamic = 'force-dynamic'

/**
 * The executor endpoint. Called only by the tick / run-now route on this
 * same service, with a 60-second HS256 token minted from AUTH_SECRET that
 * names the run. Holds the request until the run finishes.
 */
export async function POST(req: NextRequest) {
  const tokenRunId = await verifyRunToken(req)
  if (!tokenRunId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { runId?: unknown } | null
  if (!body || body.runId !== tokenRunId) return NextResponse.json({ error: 'runId mismatch' }, { status: 400 })
  try {
    const outcome = await executeRun(tokenRunId)
    return NextResponse.json({ ok: true, outcome })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'run failed' }, { status: 500 })
  }
}
