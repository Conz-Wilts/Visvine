import { NextRequest, NextResponse } from 'next/server'
import { verifyTickCaller } from '@/lib/agents/internalAuth'
import { runNightlyMaintenance } from '@/lib/notes/nightly'
import { logger } from '@/lib/logger'

/**
 * The nightly maintenance sweep, as an endpoint.
 *
 * On a scale-to-zero runtime an in-process 3am timer is a sweep that never
 * runs: at 3am there is usually no instance holding it. So Cloud Scheduler owns
 * the schedule and this route owns the work — same function either way
 * (lib/notes/nightly.ts), just a different thing deciding when.
 *
 * Authenticates itself with Google OIDC pinned to THIS path, exactly like the
 * agent tick; /api/internal/ carries no session by design (proxy.ts).
 *
 * Provisioned by scripts/provision-scheduler.sh.
 */
const PATH = '/api/internal/maintenance/nightly'

// The sweep walks every space's embeddings and link reasons. 15 minutes is
// generous for today's corpus and still well inside Cloud Run's 30-minute cap.
export const maxDuration = 900
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = await verifyTickCaller(req, PATH)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })

  const started = Date.now()
  try {
    const result = await runNightlyMaintenance()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    // runNightlyMaintenance already swallows per-stage failures; reaching here
    // means something outside them broke, and the scheduler should see a
    // non-2xx so its own failure metric fires.
    logger.error('notes.nightly.endpoint_failed', { err, ms: Date.now() - started })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// Scheduler jobs are often configured with GET; accept both, as the tick does.
export const GET = POST
