import { NextRequest, NextResponse } from 'next/server'
import { verifyTickCaller } from '@/lib/agents/internalAuth'
import { tick } from '@/lib/agents/schedule'
import { drainProjections } from '@/lib/notes/projections'
import { runDueCleans } from '@/lib/notes/cleanSchedule'
import { reapExpiredLeases, reconcileSleptMachines } from '@/lib/vm/lease'
import { meterAwakeMachines, stopOverspendingSpaces } from '@/lib/vm/quota'
import { pruneEgressLog, sweepEgress } from '@/lib/vm/anomaly'
import { stop as stopMachine, edgeConfigured } from '@/lib/vm/edge'
import { environment } from '@/lib/vm/lease'
import { logger } from '@/lib/logger'
import { drainJobs } from '@/lib/resources/jobs'
import { reapAbandonedUploads } from '@/lib/resources/upload'
import { purgeTrash } from '@/lib/resources/service'

// The tick awaits the dispatches it fans out (each its own request to the run
// endpoint), so it can last as long as the longest claimed run.
// Segment config must be a literal Next can read statically: MAX_RUN_MS (25 min) + 120s.
export const maxDuration = 1620
export const dynamic = 'force-dynamic'

/**
 * The scheduler tick. One Cloud Scheduler job every minute, OIDC-verified
 * here (Cloud Run is --allow-unauthenticated so IAM can't do it). Carries no
 * user session — /api/internal/ is listed in proxy.ts PUBLIC_PATHS and this
 * route authenticates itself. See lib/agents/schedule.ts.
 */
export async function POST(req: NextRequest) {
  const denied = await verifyTickCaller(req)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })
  const report = await tick(new Date())
  // The note write-path outbox rides this tick. It is unrelated to agents, but
  // it needs a heartbeat and this is the only one the deployment already has —
  // giving the drain its own Cloud Scheduler job would be cleaner and is
  // available at /api/internal/projections/drain, so nothing here is load-bearing.
  // Never allowed to fail the tick: a stuck projection must not stop agent runs.
  const projections = await drainProjections().catch((err) => {
    logger.error('agents.tick.projection_drain_failed', { err })
    return null
  })
  // The spaces' nightly cleans ride this tick for the same reason: a schedule
  // is a wall-clock time in the space's own zone, so it needs a minute
  // heartbeat rather than the 03:10 nightly sweep. Best-effort — a space whose
  // clean throws must not stop agent runs (each pass records its own failure
  // row, lib/notes/cleanSchedule.ts).
  const cleans = await runDueCleans(new Date()).catch((err) => {
    logger.error('notes.clean.tick_failed', { err })
    return null
  })
  // Work resources still owe (renditions, text, unfurls) that no request
  // finished — the backstop drain of lib/resources/jobs.ts — then uploads
  // nobody finished and a trash past its 30 days. Bounded, and never allowed
  // to fail the tick.
  const resourceJobs = await drainJobs({ budgetMs: 20_000 })
    .then(async (drained) => ({
      ...drained,
      abandonedUploads: await reapAbandonedUploads(),
      purgedFromTrash: await purgeTrash(),
    }))
    .catch((err) => {
      logger.error('resources.jobs.tick_failed', { err })
      return null
    })

  // VM leases ride this tick for the same reason the projection drain does: it
  // is the heartbeat the deployment already has, and a lease nobody has touched
  // in a fortnight is not urgent enough to justify a second scheduler job. Never
  // allowed to fail the tick — a stuck reap must not stop agent runs.
  const vmLeases = await reapExpiredLeases().catch((err) => {
    logger.error('vm.reap.failed', { err })
    return null
  })

  // The machines' own housekeeping, all of it best-effort for the same reason:
  // metering, quotas and anomaly detection are about money and attention, and
  // neither is worth failing every agent in the deployment over.
  const machines = edgeConfigured()
    ? await vmHousekeeping().catch((err) => {
        logger.error('vm.housekeeping.failed', { err })
        return null
      })
    : null

  return NextResponse.json({
    ok: true,
    projections,
    cleans,
    resourceJobs,
    vmLeasesReaped: vmLeases,
    machines,
    reclaimed: report.reclaimed,
    pruned: report.pruned,
    considered: report.considered,
    claimed: report.claimed,
    dispatched: report.dispatched.map((d) => ({
      runId: d.runId,
      ok: d.result.ok,
      outcome: d.result.ok ? d.result.outcome : null,
      error: d.result.ok ? null : d.result.error,
    })),
  })
}

/**
 * Everything the machines need doing once a minute: count the awake ones
 * against their spaces' caps after putting the rows back in step with what the
 * edge says is actually awake, stop any space that has gone past, look at the
 * egress log for a pattern worth a human's attention, and prune what has aged
 * out of being evidence.
 *
 * The tick fires every minute, so a minute is what it meters — the platform's
 * timer is what bills, and it is what counts.
 */
async function vmHousekeeping() {
  // Before the meter, never after: a machine the platform put to sleep must
  // stop being billed on the same tick it is found asleep, or the row goes on
  // charging a space for a machine that is doing nothing.
  const slept = await reconcileSleptMachines()
  const metered = await meterAwakeMachines(TICK_SECONDS)
  const stopped = await stopOverspendingSpaces((spaceId, agentName) => stopMachine(environment(), spaceId, agentName))
  const anomalies = await sweepEgress()
  // Pruning is cheap and idempotent; doing it on the tick avoids a second job
  // for a table that only ever grows in one direction.
  const pruned = await pruneEgressLog()
  return { slept, metered, stopped, anomalies: anomalies.length, egressPruned: pruned }
}

/** The scheduler's interval, and therefore the meter's unit. */
const TICK_SECONDS = 60

// Scheduler can be configured with GET as well; accept both.
export const GET = POST
