/**
 * The tick, and the one claim path every run (scheduled OR manual) goes through.
 *
 * One Cloud Scheduler job hits /api/internal/agents/tick every minute (a
 * slower job still works; events just wait longer for the next tick).
 * The tick: records a heartbeat → reclaims runs whose instance died → prunes
 * old runs → re-derives any row whose brief changed under it →
 * CLAIMS the due rows with an atomic compare-and-swap on `status` (correct
 * across ten instances; no in-process flag) → creates a run row per claim →
 * dispatches, and returns. Selection is `WHERE active AND next_run_at <=
 * now()` on an index: O(due), never O(all agents).
 *
 * No backfill: dispatch sets `next_run_at` to the next occurrence AFTER now.
 * A nightly agent that missed three nights fires once.
 */
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { dueIdentities, nextFire } from './shared/fanout'
import type { RunsForEntry } from './shared/runsFor'
import { findAgentActivation, findAgentBrief, readAgent } from './briefs'
import { gateWake } from './wakeGate'
import { dispatchRun, type DispatchResult } from './dispatch'
import { claimEvents, eventDepthOf, type ClaimedEvent } from './events'
import { deactivateAgent, effectiveTimezone, syncAgentState } from './hooks'
import { MAX_CONSECUTIVE_FAILURES, MAX_FANOUT_SUBSCRIBERS, MAX_RUN_MS, MAX_RUNS_PER_TICK, RECLAIM_GRACE_MS } from './limits'
import { createRun, failStaleRun, pruneRuns, type RunInput, type RunTrigger } from './runs'

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

/**
 * Rows stuck in `running` past MAX_RUN_MS + RECLAIM_GRACE_MS: their instance
 * died (a live executor times itself out at MAX_RUN_MS and releases well
 * inside the grace). Fail the run, free the row — by CAS on `runningSince`, so
 * an executor releasing at the same moment can't be double-counted — and apply
 * the same repeated-failure policy a live release would, or an agent whose
 * instance dies every run would keep firing forever.
 */
export async function reclaimStale(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MAX_RUN_MS - RECLAIM_GRACE_MS)
  const stale = await prisma.agentState.findMany({
    where: { status: 'running', runningSince: { lt: cutoff } },
    select: { id: true, spaceId: true, name: true, runningSince: true, currentRunId: true, consecutiveFailures: true },
  })
  let reclaimed = 0
  for (const row of stale) {
    const failures = row.consecutiveFailures + 1
    const moved = await prisma.agentState.updateMany({
      where: { id: row.id, status: 'running', runningSince: row.runningSince },
      data: { status: 'idle', runningSince: null, currentRunId: null, consecutiveFailures: failures },
    })
    if (moved.count !== 1) continue // the executor released first; nothing to reclaim
    reclaimed++
    const runId =
      row.currentRunId ??
      (await prisma.agentRun.findFirst({ where: { stateId: row.id, status: 'running' }, orderBy: { startedAt: 'desc' }, select: { id: true } }))?.id ??
      null
    if (runId) await failStaleRun(runId, 'timeout', 'The run did not finish and its instance was reclaimed.')
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      await deactivateAgent(row.spaceId, row.name, 'repeated_failure', `${failures} consecutive failed runs`)
    }
  }
  return reclaimed
}

/**
 * Atomic claim. `scheduled` requires the row to be due and ADVANCES
 * next_run_at (never `+ interval`: always the next occurrence after now);
 * `manual` requires idle, and active only when the caller is not a person
 * (see claimManualRun) — claimManualRun then resets next_run_at to the clock
 * (the mail it takes had pulled it forward). Returns true iff exactly one row moved.
 */
async function claim(
  stateId: string,
  mode: 'scheduled' | 'manual',
  now: Date,
  nextRunAt: Date | null,
  runId: string,
  opts: { requireActive?: boolean } = {},
): Promise<boolean> {
  const changed =
    mode === 'scheduled'
      ? await prisma.$executeRaw`
          UPDATE "agent_state"
             SET "status" = 'running', "running_since" = ${now}, "current_run_id" = ${runId}, "last_run_at" = ${now}, "next_run_at" = ${nextRunAt}, "updated_at" = ${now}
           WHERE "id" = ${stateId} AND "status" = 'idle' AND "active" = true AND "next_run_at" IS NOT NULL AND "next_run_at" <= ${now}`
      : opts.requireActive === false
        ? await prisma.$executeRaw`
          UPDATE "agent_state"
             SET "status" = 'running', "running_since" = ${now}, "current_run_id" = ${runId}, "last_run_at" = ${now}, "updated_at" = ${now}
           WHERE "id" = ${stateId} AND "status" = 'idle'`
        : await prisma.$executeRaw`
          UPDATE "agent_state"
             SET "status" = 'running', "running_since" = ${now}, "current_run_id" = ${runId}, "last_run_at" = ${now}, "updated_at" = ${now}
           WHERE "id" = ${stateId} AND "status" = 'idle' AND "active" = true`
  return changed === 1
}

/** The agent's next clock occurrence after `now` from its brief, or null (trigger-only / no note). */
async function nextClockOccurrence(spaceId: string, name: string, now: Date): Promise<Date | null> {
  const parsed = (await findAgentActivation(spaceId, name)).parsed
  if (!parsed?.ok || !parsed.activation.schedule) return null
  const tz = await effectiveTimezone(spaceId, parsed.activation.timezone)
  return nextFire(parsed.activation.schedule, tz, await runsForOf(spaceId, name), now)
}

/** Who the agent runs for besides its own identity — the record's runs-for. */
async function runsForOf(spaceId: string, name: string): Promise<RunsForEntry[]> {
  // A run-in copy runs for nobody but the house brief's author.
  const copy = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { sharedFrom: true } })
  if (copy?.sharedFrom) return []
  const agent = await readAgent(spaceId, name)
  return agent?.brief.ok ? agent.brief.brief.runsFor : []
}

/** The run id is minted BEFORE the claim so the claim can name it (release is a CAS on it). */
const newRunId = () => crypto.randomUUID()

/** The claimed events as the run row's `input` (kept with the run after the events prune). */
function runInputOf(events: ClaimedEvent[]): RunInput | null {
  if (events.length === 0) return null
  return { events: events.map((e) => ({ kind: e.kind, source: e.source, summary: e.summary, at: e.createdAt.toISOString(), depth: eventDepthOf(e.payload) })) }
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
  const claimed: {
    runId: string
    stateId: string
    spaceId: string
    name: string
    /** Everyone else this fire runs for, after the first run. */
    others: string[]
    trigger: RunTrigger
    input: RunInput | null
  }[] = []

  for (const row of due) {
    if (claimed.length >= MAX_RUNS_PER_TICK) break
    if (busy.has(row.spaceId)) continue

    // A row whose agent no longer reads as runnable (its brief deleted or
    // broken under it) is re-derived rather than claimed.
    const parsed = (await findAgentActivation(row.spaceId, row.name)).parsed
    if (!parsed || !parsed.ok || !parsed.activation.active || (!parsed.activation.schedule && !parsed.activation.on)) {
      await syncAgentState(row.spaceId, row.name, { now })
      continue
    }
    const tz = await effectiveTimezone(row.spaceId, parsed.activation.timezone)
    const runsFor = await runsForOf(row.spaceId, row.name)
    // Event-only agents have no clock: next_run_at goes back to null until the
    // next event pulls it forward (or release re-arms it for mail that arrived
    // mid-run).
    const schedule = parsed.activation.schedule
    const next = schedule ? nextFire(schedule, tz, runsFor, now) : null
    const runId = newRunId()
    if (!(await claim(row.id, 'scheduled', now, next, runId))) continue

    // The claim is ours: take the mail with it. What the run is FOR is named by
    // what woke it — events if any arrived, else the clock that was due.
    const mail = await claimEvents(row.spaceId, row.name, runId)
    // Saves the brief would do nothing about are declined before they cost a
    // run (wakeGate.ts). `on.wake: always` opts out.
    const source = parsed.activation.on?.wake === 'always' ? null : await findAgentBrief(row.spaceId, row.name)
    const events = source
      ? await gateWake({ spaceId: row.spaceId, agentName: row.name, runId, briefPath: source.path, briefContent: source.content, events: mail })
      : mail
    // Was the CLOCK due, or only the mail? A scheduled agent woken early by a
    // save that was then declined has nothing to run for yet; its clock stands.
    const clockDue = schedule ? nextFire(schedule, tz, runsFor, row.lastRunAt ?? new Date(0)) <= now : false
    // A trigger-only agent whose mail was taken by a manual run in between (or
    // whose event pull-forward outlived its events, or whose every save was
    // declined) is due for nothing: give the claim straight back — no run row,
    // no paid model call about nothing.
    const allDeclined = mail.length > 0 && events.length === 0
    if (events.length === 0 && (!schedule || (allDeclined && !clockDue))) {
      await prisma.agentState.updateMany({
        where: { id: row.id, currentRunId: runId },
        data: { status: 'idle', runningSince: null, currentRunId: null, nextRunAt: next, lastRunAt: row.lastRunAt },
      })
      continue
    }
    const trigger: RunTrigger = events.length
      ? events.every((e) => e.kind === 'webhook')
        ? 'webhook'
        : 'event'
      : schedule?.kind === 'interval' || schedule?.kind === 'cron'
        ? 'interval'
        : 'scheduled'
    const input = runInputOf(events)
    // Who this fire is for: the agent's own identity and everyone riding its
    // clock when that came round, each person keeping their own time when
    // theirs did — and everyone when events woke it (shared/fanout.ts).
    const who = dueIdentities({
      schedule,
      tz,
      runsFor,
      authorId: row.runAsUserId,
      lastRunAt: row.lastRunAt,
      now,
      woken: events.length > 0,
    })
    // Nobody's time has come (the row drifted ahead of the note): hand the
    // claim back rather than run the author off-schedule.
    if (who.length === 0) {
      await prisma.agentState.updateMany({
        where: { id: row.id, currentRunId: runId },
        data: { status: 'idle', runningSince: null, currentRunId: null, nextRunAt: next, lastRunAt: row.lastRunAt },
      })
      continue
    }
    const [first = null, ...others] = who
    const run = await createRun({ id: runId, stateId: row.id, spaceId: row.spaceId, name: row.name, trigger, eventCount: events.length, input, runAsUserId: first })
    claimed.push({ runId: run.id, stateId: row.id, spaceId: row.spaceId, name: row.name, others: others.filter((id): id is string => id !== null), trigger, input })
    busy.add(row.spaceId)
  }

  // One fire runs once per identity, each under that person's principal, so a
  // `mode: user` connector resolves THEIR linked account. Sequential, each
  // through the same claim CAS (a deactivation mid-group stops it). Event
  // PAYLOADS ride only the first run — it claimed the mail; the rest carry the
  // summaries via `input`.
  const dispatched = (
    await Promise.all(
      claimed.map(async (c) => {
        const results = [{ runId: c.runId, result: await dispatchRun(c.runId) }]
        for (const userId of c.others.slice(0, MAX_FANOUT_SUBSCRIBERS)) {
          const subRunId = newRunId()
          // 'manual' mode: the row is no longer due (the scheduled claim
          // advanced next_run_at), it just has to be active and idle.
          if (!(await claim(c.stateId, 'manual', new Date(), null, subRunId))) break
          const run = await createRun({
            id: subRunId,
            stateId: c.stateId,
            spaceId: c.spaceId,
            name: c.name,
            trigger: c.trigger,
            runAsUserId: userId,
            input: c.input,
          })
          results.push({ runId: run.id, result: await dispatchRun(run.id) })
        }
        return results
      }),
    )
  ).flat()
  return { reclaimed, pruned, considered: due.length, claimed: dispatched.map((c) => c.runId), dispatched }
}

export type RunNowResult =
  | { ok: true; runId: string }
  | { ok: false; code: 'inactive' | 'busy' | 'unknown'; message: string }

/**
 * "Run now": shares the claim path (same CAS), does not advance the schedule.
 * Returns as soon as the run is claimed and dispatched — the dispatch itself
 * is awaited by the caller if it wants the outcome.
 *
 * ACTIVE is required by DEFAULT, and waived only by a door a person is
 * standing at (`allowInactive`): the Run button and `run_agent`. Switching an agent on is approval for it to run UNATTENDED —
 * at 3am, as its author, with nobody to read what it did — and that is the
 * thing an inactive agent may not do. Somebody who can edit the brief asking
 * for one run, now, as themselves, is not that: it is how you try an agent
 * before you trust it, and refusing it was why a new agent could only be seen
 * working by first turning it loose. Nothing about the row changes — an
 * inactive agent that runs this way is still inactive when it finishes.
 * Everything unattended keeps the gate: a chained `run_agent` from inside
 * another run, and a Tool's `agents.run` (lib/tools/bridge.ts).
 */
export async function claimManualRun(
  spaceId: string,
  name: string,
  startedBy: string,
  now = new Date(),
  opts: {
    /**
     * Set by the run_agent tool: the run that asked and how deep the chain
     * already is. The parent run holds the space's "one at a time" slot, so a
     * chained run only checks that the TARGET agent is idle — otherwise
     * chaining could never start (the parent is always running).
     */
    chain?: { parent: string; depth: number }
    /**
     * Run as the brief's OWN author (the state row's runAsUserId) rather than
     * as `startedBy`. Set when a sub-space's agent starts a shared agent of
     * the parent: the caller may hold nothing in the parent, so the run
     * cannot be theirs — it is the parent brief's, as its author.
     */
    runAs?: 'author'
    /**
     * A person is asking for this run, at a door they are standing at, so the
     * agent need not be switched on. Never set from inside a run.
     */
    allowInactive?: boolean
    /** Input values the person gave for this one run (shared/inputs.ts). */
    inputs?: Record<string, string>
  } = {},
): Promise<RunNowResult & { dispatch?: Promise<DispatchResult> }> {
  const row = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } })
  if (!row) return { ok: false, code: 'unknown', message: 'No such agent.' }
  // A chain is an agent starting an agent — unattended either way, so the
  // waiver never applies to it however the caller asked.
  const requireActive = !opts.allowInactive || Boolean(opts.chain)
  if (requireActive && !row.active) {
    return { ok: false, code: 'inactive', message: 'The agent must be active before it can be run — ask a space admin to activate it.' }
  }
  if (row.status === 'running') return { ok: false, code: 'busy', message: 'The agent is already running.' }
  if (!opts.chain && (await busySpaces()).has(spaceId)) return { ok: false, code: 'busy', message: 'Another agent in this space is running; try again shortly.' }
  const runId = newRunId()
  if (!(await claim(row.id, 'manual', now, null, runId, { requireActive }))) {
    return { ok: false, code: 'busy', message: 'The agent was just claimed by another run.' }
  }
  // A manual run takes any waiting mail too — otherwise "Run now" would do the
  // work and the debounce would fire a second run for the same events. The
  // events had pulled next_run_at forward; with them consumed, it goes back to
  // the clock's next occurrence (or to nothing for a trigger-only agent) —
  // otherwise the tick would claim a run for mail that is no longer there.
  const events = await claimEvents(spaceId, name, runId)
  const next = await nextClockOccurrence(spaceId, name, now)
  await prisma.agentState.updateMany({ where: { id: row.id, currentRunId: runId }, data: { nextRunAt: next } })
  const base: RunInput | null = opts.chain ? { events: runInputOf(events)?.events ?? [], chain: opts.chain } : runInputOf(events)
  const input: RunInput | null = opts.inputs && Object.keys(opts.inputs).length ? { events: [], ...base, inputs: opts.inputs } : base
  // A manual run acts as WHOEVER PRESSED RUN, not as the brief's author — the
  // gate (canTriggerRun) already limits that to people who can edit the brief,
  // and it means a `mode: user` connector spends the presser's own linked
  // account rather than borrowing the author's.
  // ...unless the caller asked for the author (a shared agent started from a
  // sub-space): null here means the runner falls through to the state row.
  const run = await createRun({ id: runId, stateId: row.id, spaceId, name, trigger: 'manual', startedBy, runAsUserId: opts.runAs === 'author' ? null : startedBy, eventCount: events.length, input })
  const dispatch = dispatchRun(run.id)
  return { ok: true, runId: run.id, dispatch }
}
