/**
 * Watching the egress log.
 *
 * The boundary refuses what it should refuse; this is the part that notices a
 * PATTERN of refusals, or an allowed host suddenly receiving a copy of
 * everything. Neither is proof — a compromised agent and a badly written skill
 * look identical from here — so the job is to put a human in front of the log,
 * not to decide.
 *
 * Level matters and is easy to get wrong. A denial is the policy working, so
 * every signal here is a `warn`; `logger.error` is reserved for a genuine
 * fault, because in production it pages someone and a pile of working denials
 * would bury the thing that actually broke.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { detectAnomalies, type Anomaly, type EgressSample } from '@/lib/vm/shared/limits'

/** How far back a sweep looks. Long enough to see a pattern, short enough to be recent. */
const WINDOW_MINUTES = 60
/** Rows one sweep reads per machine. A machine noisier than this is itself the signal. */
const SAMPLE_CAP = 2_000

export interface AnomalyReport {
  spaceId: string
  agentName: string
  anomalies: Anomaly[]
}

/**
 * Sweep every machine that has been talking, and report what looks wrong.
 *
 * Grouped by (space, agent) because that is the unit a person acts on: one
 * agent hammering refused hosts is a story, and the same count spread over a
 * whole space is a different one.
 */
export async function sweepEgress(now = new Date()): Promise<AnomalyReport[]> {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000)
  const machines = await prisma.agentEgressLog.groupBy({
    by: ['spaceId', 'agentName'],
    where: { at: { gte: since } },
    _count: { _all: true },
  })

  const reports: AnomalyReport[] = []
  for (const machine of machines) {
    const rows = await prisma.agentEgressLog.findMany({
      where: { spaceId: machine.spaceId, agentName: machine.agentName, at: { gte: since } },
      select: { host: true, verdict: true, bytes: true, at: true },
      orderBy: { at: 'desc' },
      take: SAMPLE_CAP,
    })
    const samples: EgressSample[] = rows.map((row) => ({
      host: row.host,
      verdict: row.verdict === 'allow' || row.verdict === 'approval' ? row.verdict : 'deny',
      bytes: row.bytes,
      at: row.at,
    }))
    const anomalies = detectAnomalies(samples)
    if (anomalies.length === 0) continue

    for (const anomaly of anomalies) {
      logger.warn('vm.egress.anomaly', {
        spaceId: machine.spaceId,
        agent: machine.agentName,
        kind: anomaly.kind,
        detail: anomaly.detail,
        hosts: anomaly.hosts,
      })
    }
    reports.push({ spaceId: machine.spaceId, agentName: machine.agentName, anomalies })
  }
  return reports
}

/** Egress records older than this are pruned; the timeline is what is kept. */
const EGRESS_RETENTION_DAYS = 90

/**
 * Prune the egress log.
 *
 * It is the noisiest table the machines produce — one row per request — and it
 * is evidence with a shelf life: what a machine reached three months ago is
 * history, not detection. The timeline (`agent_vm_events`) is the durable
 * record and is not touched here.
 */
export async function pruneEgressLog(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EGRESS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.agentEgressLog.deleteMany({ where: { at: { lt: cutoff } } })
  return count
}
