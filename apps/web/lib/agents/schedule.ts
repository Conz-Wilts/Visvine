/**
 * The tick, and the one claim path every run (scheduled OR manual) goes through.
 *
 * One Cloud Scheduler job hits /api/internal/agents/tick every five minutes.
 * The tick: records a heartbeat → reclaims runs whose instance died → prunes
 * old runs → re-derives any row whose activation note changed under it →
 * CLAIMS the due rows with an atomic compare-and-swap on `status` (correct
 * across ten instances; no in-process flag) → creates a run row per claim →
 * dispatches, and returns. Selection is `WHERE active AND next_run_at <=
 * now()` on an index: O(due), never O(all agents).
 *
 * No backfill: dispatch sets `next_run_at` to the next occurrence AFTER now.
 * A nightly agent that missed three nights fires once.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { agentActivationPath, nextOccurrence, parseAgentActivation, scheduleHash } from './config'
import { dispatchRun, type DispatchResult } from './dispatch'
import { effectiveTimezone, syncAgentState } from './hooks'
import { MAX_RUN_MS, MAX_RUNS_PER_TICK } from './limits'
import { createRun, failStaleRun, pruneRuns } from './runs'

export interface TickReport {
  reclaimed: number
  pruned: number
  considered: number
  claimed: string[]
  dispatched: { runId: string; result: DispatchResult }[]
}

/** The scheduler's liveness record; the panel shows "delayed" when it stops moving. */
async function heartbeat(now: Date): Promise<void> {
  await prisma.agentHeartbeat.upsert({ where: { id: 1 }, create: { id: 1, lastTickAt: now }, update: { lastTickAt: now } })
}

export async function lastHeartbeat(): Promise<Date | null> {
  const row = await prisma.agentHeartbeat.findUnique({ where: { id: 1 } })
  return row?.lastTickAt ?? null
}

/** Rows stuck in `running` past MAX_RUN_MS: their instance died. Fail the run, free the row. */
async function reclaimStale(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MAX_RUN_MS)
  const stale = await prisma.agentState.findMany({
    where: { status: 'running', runningSince: { lt: cutoff } },
    select: { id: true, consecutiveFailures: true },
  })
  for (const row of stale) {
    const run = await prisma.agentRun.findFirst({
      where: { stateId: row.id, status: 'running' },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    })
    if (run) await failStaleRun(run.id, 'timeout', 'The run did not finish and its instance was reclaimed.')
    await prisma.agentState.update({
      where: { id: row.id },
      data: { status: 'idle', runningSince: null, consecutiveFailures: row.consecutiveFailures + 1 },
    })
  }
  return stale.length
}

/**
 * Atomic claim. `scheduled` requires the row to be due and ADVANCES
 * next_run_at (never `+ interval`: always the next occurrence after now);
 * `manual` requires only active+idle and leaves next_run_at alone (a manual
 * run is extra, not a replacement). Returns true iff exactly one row moved.
 */
async function claim(stateId: string, mode: 'scheduled' | 'manual', now: Date, nextRunAt: Date | null): Promise<boolean> {
  const changed =
    mode === 'scheduled'
      ? await prisma.$executeRaw`
          UPDATE "agent_state"
             SET "status" = 'running', "running_since" = ${now}, "last_run_at" = ${now}, "next_run_at" = ${nextRunAt}, "updated_at" = ${now}
           WHERE "id" = ${stateId} AND "status" = 'idle' AND "active" = true AND "next_run_at" IS NOT NULL AND "next_run_at" <= ${now}`
      : await prisma.$executeRaw`
          UPDATE "agent_state"
             SET "status" = 'running', "running_since" = ${now}, "last_run_at" = ${now}, "updated_at" = ${now}
           WHERE "id" = ${stateId} AND "status" = 'idle' AND "active" = true`
  return changed === 1
}

/** Which spaces already have a run in flight — one at a time per space. */
async function busySpaces(): Promise<Set<string>> {
  const rows = await prisma.agentState.findMany({ where: { status: 'running' }, select: { spaceId: true } })
  return new Set(rows.map((r) => r.spaceId))
}

/**
 * The tick. Claims up to MAX_RUNS_PER_TICK due agents (one per space) and
 * dispatches them, awaiting the dispatches so nothing is fire-and-forget.
 */
export async function tick(now = new Date()): Promise<TickReport> {
  await heartbeat(now)
  const reclaimed = await reclaimStale(now)
  const pruned = await pruneRuns(now)

  const due = await prisma.agentState.findMany({
    where: { active: true, status: 'idle', nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: MAX_RUNS_PER_TICK * 4,
  })
  const busy = await busySpaces()
  const claimed: { runId: string; stateId: string }[] = []

  for (const row of due) {
    if (claimed.length >= MAX_RUNS_PER_TICK) break
    if (busy.has(row.spaceId)) continue

    // Derivation discipline: if the activation note changed under the row
    // (a write that bypassed the hook — restore, direct SQL), re-derive first
    // and only claim if the note still says it's due.
    const live = await prisma.contextNote.findFirst({
      where: { spaceId: row.spaceId, ownerKey: 'shared', path: agentActivationPath(row.name), deletedAt: null },
      select: { content: true },
    })
    const parsed = live ? parseAgentActivation(parseFrontmatter(live.content)) : null
    if (!parsed || !parsed.ok || !parsed.activation.active || !parsed.activation.schedule) {
      await syncAgentState(row.spaceId, row.name, { now })
      continue
    }
    const tz = await effectiveTimezone(row.spaceId, parsed.activation.timezone)
    const hash = scheduleHash(parsed.activation, tz)
    if (hash !== row.scheduleHash) {
      const fresh = await syncAgentState(row.spaceId, row.name, { activation: parsed.activation, now })
      if (!fresh.active || !fresh.nextRunAt || fresh.nextRunAt > now) continue
    }
    const next = nextOccurrence(parsed.activation.schedule, now, tz)
    if (!(await claim(row.id, 'scheduled', now, next))) continue

    const run = await createRun({ stateId: row.id, spaceId: row.spaceId, name: row.name, trigger: 'scheduled' })
    claimed.push({ runId: run.id, stateId: row.id })
    busy.add(row.spaceId)
  }

  const dispatched = await Promise.all(
    claimed.map(async ({ runId }) => ({ runId, result: await dispatchRun(runId) })),
  )
  return { reclaimed, pruned, considered: due.length, claimed: claimed.map((c) => c.runId), dispatched }
}

export type RunNowResult =
  | { ok: true; runId: string }
  | { ok: false; code: 'inactive' | 'busy' | 'unknown'; message: string }

/**
 * "Run now": shares the claim path (same CAS), requires the agent to be
 * ACTIVE (a member may not execute a never-approved brief), does not advance
 * the schedule. Returns as soon as the run is claimed and dispatched — the
 * dispatch itself is awaited by the caller if it wants the outcome.
 */
export async function claimManualRun(
  spaceId: string,
  name: string,
  startedBy: string,
  now = new Date(),
): Promise<RunNowResult & { dispatch?: Promise<DispatchResult> }> {
  const row = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } })
  if (!row) return { ok: false, code: 'unknown', message: 'No such agent.' }
  if (!row.active) return { ok: false, code: 'inactive', message: 'The agent must be active before it can be run — ask a space admin to activate it.' }
  if (row.status === 'running') return { ok: false, code: 'busy', message: 'The agent is already running.' }
  if ((await busySpaces()).has(spaceId)) return { ok: false, code: 'busy', message: 'Another agent in this space is running; try again shortly.' }
  if (!(await claim(row.id, 'manual', now, null))) return { ok: false, code: 'busy', message: 'The agent was just claimed by another run.' }
  const run = await createRun({ stateId: row.id, spaceId, name, trigger: 'manual', startedBy })
  const dispatch = dispatchRun(run.id)
  return { ok: true, runId: run.id, dispatch }
}
