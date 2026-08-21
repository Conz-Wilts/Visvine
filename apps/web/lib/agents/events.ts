/**
 * The payload mailbox behind reactive agents (`agent_events`).
 *
 * A note save under an `on.context` glob, an inbound webhook for an
 * `on.webhook` connector, or a human's reply does NOT start a run. It inserts
 * ONE row here and pulls the agent's `next_run_at` forward to now()+debounce
 * (only while idle: a running agent is re-armed at release instead). The
 * tick's compare-and-swap claim stays the only dispatcher; alongside the
 * claim it stamps every pending row with the run id (`claimEvents`) and the
 * executor reads them back as the run's second user message.
 *
 * So there is no consumer loop and no second scheduler; the debounce is the
 * coalescing window, and fifty saves during it become one run with ≤50 events.
 *
 * Callers outside this module: the note-store hook (`fireNoteTriggers` via
 * hooks.ts), the inbound webhook route (`webhookRecipients` + `enqueueAgentEvent`),
 * the tick / manual claim (`claimEvents`), the executor (`eventsForRun`),
 * release (`rearmIfPending`) and pruneRuns (`pruneEvents`).
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { Actor } from '@/lib/notes/store'
import { logAudit } from '@/lib/notes/audit'
import { logger } from '@/lib/logger'
import { agentBriefPath, matchesAnyGlob, type AgentTriggers } from './config'
import { findAgentBrief } from './briefs'

type AgentEventKind = 'note_written' | 'webhook' | 'reply'

/**
 * How far an event is from a human. A person's save, a webhook and a reply
 * are depth 0; a note written by an agent's run is one deeper than the deepest
 * event THAT run consumed. Stored on the payload (`payload.chain`) and copied
 * onto the run's `input.events[].depth` so the next hop can read it back.
 */
interface EventChain {
  depth: number
  /** The agent whose run made the write, or null for a human / external origin. */
  via: string | null
}

/**
 * The loop breaker for agent → agent → agent chains: A writes people/x, which
 * wakes B, which writes people/y, which wakes A … Without a ceiling only the
 * monthly budget would end it. An event more than this many hops from a human
 * is refused (`looped`) and the cut is audited once per run.
 */
export const MAX_EVENT_CHAIN_DEPTH = 3
const HUMAN_CHAIN: EventChain = { depth: 0, via: null }

export interface EnqueueInput {
  spaceId: string
  agentName: string
  kind: AgentEventKind
  /** Note path / connector name / who replied. */
  source: string
  /** One line for the run's "Triggered by" message (≤ 300 chars, clipped). */
  summary: string
  /** Handed to the run as DATA (JSON, ≤ 8 KB after clipping). */
  payload?: unknown
  /** While an identical key is pending for the agent, a second enqueue is a no-op. */
  dedupeKey?: string | null
  /** Hops from a human (default: none — a person's act, a webhook, a reply). */
  chain?: EventChain
}

export type EnqueueResult =
  | { ok: true; id: string }
  | { ok: false; deduped: true }
  | { ok: false; capped: true }
  /** The chain is deeper than MAX_EVENT_CHAIN_DEPTH: refused, nothing enqueued. */
  | { ok: false; looped: true }

/** Unconsumed rows an agent may hold; beyond this, new events are dropped (the run will read the notes anyway). */
export const MAX_PENDING_EVENTS = 20
/** Rows one run consumes at most. */
export const MAX_EVENTS_PER_RUN = 50
/** Consumed or not, rows older than this are pruned. */
const EVENT_RETENTION_DAYS = 7
const SUMMARY_CAP = 300
const PAYLOAD_CAP = 8_000

/** Clip a payload to PAYLOAD_CAP bytes of JSON; oversize payloads keep a note of it. */
function clipPayload(payload: unknown): unknown {
  const text = JSON.stringify(payload ?? {})
  if (text.length <= PAYLOAD_CAP) return payload ?? {}
  return { truncated: true, bytes: text.length, head: text.slice(0, PAYLOAD_CAP - 200) }
}

/**
 * Insert one event and pull the agent forward. Never throws for the caller's
 * sake beyond a DB outage: a dedupe conflict and the pending cap are results,
 * not errors.
 */
export async function enqueueAgentEvent(input: EnqueueInput): Promise<EnqueueResult> {
  const { spaceId, agentName } = input
  const chain = input.chain ?? HUMAN_CHAIN
  if (chain.depth > MAX_EVENT_CHAIN_DEPTH) return { ok: false, looped: true }
  const pending = await prisma.agentEvent.count({ where: { spaceId, agentName, consumedBy: null } })
  if (pending >= MAX_PENDING_EVENTS) return { ok: false, capped: true }

  const clipped = clipPayload(input.payload)
  const stored = clipped && typeof clipped === 'object' && !Array.isArray(clipped) ? { ...clipped, chain } : { value: clipped, chain }
  const payload = JSON.stringify(stored)
  const summary = input.summary.length > SUMMARY_CAP ? input.summary.slice(0, SUMMARY_CAP) + '…' : input.summary
  const dedupeKey = input.dedupeKey ?? null
  // ON CONFLICT DO NOTHING (no target) covers the partial unique dedupe index.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "agent_events" ("space_id", "agent_name", "kind", "source", "summary", "payload", "dedupe_key")
    VALUES (${spaceId}, ${agentName}, ${input.kind}, ${input.source}, ${summary}, ${payload}::jsonb, ${dedupeKey})
    ON CONFLICT DO NOTHING
    RETURNING "id"`
  if (rows.length === 0) return { ok: false, deduped: true }

  await pullForward(spaceId, agentName)
  return { ok: true, id: rows[0].id }
}

/**
 * next_run_at = min(next_run_at, now + debounce) — only for an ACTIVE, IDLE
 * agent. A running one is re-armed by `rearmIfPending` at release; an inactive
 * one keeps its mail until an admin turns it back on (or it prunes).
 */
async function pullForward(spaceId: string, agentName: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "agent_state"
       SET "next_run_at" = LEAST(COALESCE("next_run_at", 'infinity'::timestamp), (now() AT TIME ZONE 'UTC') + ("debounce_ms" * interval '1 millisecond')),
           "updated_at" = (now() AT TIME ZONE 'UTC')
     WHERE "space_id" = ${spaceId} AND "name" = ${agentName} AND "active" = true AND "status" = 'idle'`
}

export interface ClaimedEvent {
  id: string
  kind: AgentEventKind
  source: string
  summary: string
  payload: unknown
  createdAt: Date
}

/** The chain depth stamped on an event's payload (0 when absent — a row from before chains, or a human's). */
export function eventDepthOf(payload: unknown): number {
  const c = payload && typeof payload === 'object' ? (payload as { chain?: { depth?: unknown } }).chain : null
  return c && typeof c.depth === 'number' && c.depth >= 0 ? Math.floor(c.depth) : 0
}

/**
 * The chain an agent's write carries: one hop deeper than the deepest event
 * (or run_agent chain) its CURRENT run consumed. Reads the run's own
 * `input.events[].depth` (agent_state.current_run_id → agent_runs.input) so a
 * hop survives the event prune. An agent with no run in flight (a stale stamp)
 * counts as a fresh hop from a human.
 */
async function chainOfAgentWrite(spaceId: string, agentName: string): Promise<{ chain: EventChain; runId: string | null }> {
  const state = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name: agentName } }, select: { currentRunId: true } })
  const runId = state?.currentRunId ?? null
  let base = 0
  if (runId) {
    const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { input: true } })
    const input = run?.input as { events?: { depth?: unknown }[]; chain?: { depth?: unknown } } | null
    for (const e of input?.events ?? []) if (typeof e.depth === 'number') base = Math.max(base, e.depth)
    if (typeof input?.chain?.depth === 'number') base = Math.max(base, input.chain.depth)
  }
  return { chain: { depth: base + 1, via: agentName }, runId }
}

/**
 * Audit "trigger loop cut" once per run: the run row remembers it did
 * (`input.loopCut`), so a run that writes fifty notes past the ceiling leaves
 * one line, not fifty.
 */
async function auditLoopCut(spaceId: string, agentName: string, runId: string | null, path: string): Promise<void> {
  if (runId) {
    const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { input: true } })
    const input = (run?.input as Record<string, unknown> | null) ?? {}
    if (input.loopCut) return
    await prisma.agentRun.update({ where: { id: runId }, data: { input: { events: [], ...input, loopCut: true } as unknown as object } })
  }
  await logAudit(spaceId, {
    userId: 'system',
    name: 'Visvine',
    action: 'agent',
    path: (await findAgentBrief(spaceId, agentName))?.path ?? agentBriefPath(agentName),
    detail: `trigger loop cut at depth ${MAX_EVENT_CHAIN_DEPTH}: ${path} would wake another agent more than ${MAX_EVENT_CHAIN_DEPTH} hops from a human`,
  })
}

/**
 * Stamp up to `cap` pending rows with the run id, oldest first, and return
 * them. Called right after the state-row CAS succeeded, so only the claiming
 * run ever sees them; SKIP LOCKED keeps two concurrent enqueues out of the way.
 */
export async function claimEvents(spaceId: string, agentName: string, runId: string, cap = MAX_EVENTS_PER_RUN): Promise<ClaimedEvent[]> {
  const rows = await prisma.$queryRaw<{ id: string; kind: string; source: string; summary: string; payload: unknown; created_at: Date }[]>`
    UPDATE "agent_events" e
       SET "consumed_by" = ${runId}
     WHERE e."id" IN (
             SELECT "id" FROM "agent_events"
              WHERE "space_id" = ${spaceId} AND "agent_name" = ${agentName} AND "consumed_by" IS NULL
              ORDER BY "created_at" ASC
              LIMIT ${cap}
              FOR UPDATE SKIP LOCKED)
    RETURNING e."id", e."kind", e."source", e."summary", e."payload", e."created_at"`
  return rows
    .map((r) => ({ id: r.id, kind: r.kind as AgentEventKind, source: r.source, summary: r.summary, payload: r.payload, createdAt: r.created_at }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/** The events a run consumed (for the executor's payload message). */
export async function eventsForRun(runId: string): Promise<ClaimedEvent[]> {
  const rows = await prisma.agentEvent.findMany({ where: { consumedBy: runId }, orderBy: { createdAt: 'asc' } })
  return rows.map((r) => ({ id: r.id, kind: r.kind as AgentEventKind, source: r.source, summary: r.summary, payload: r.payload, createdAt: r.createdAt }))
}

/** Are events waiting for this agent? */
export async function hasPendingEvents(spaceId: string, agentName: string): Promise<boolean> {
  return (await prisma.agentEvent.count({ where: { spaceId, agentName, consumedBy: null } })) > 0
}

/**
 * Release-time re-arm: events that arrived while the agent was running were
 * not allowed to pull `next_run_at` (the row wasn't idle), so pull it now that
 * it is. CAS-safe — the WHERE requires idle, so a row already re-claimed by a
 * newer run is untouched.
 */
export async function rearmIfPending(spaceId: string, agentName: string): Promise<boolean> {
  if (!(await hasPendingEvents(spaceId, agentName))) return false
  await pullForward(spaceId, agentName)
  return true
}

/** The parsed `on:` map on a state row, or null. */
function triggersOf(row: { triggersJson: unknown }): AgentTriggers | null {
  const t = row.triggersJson
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null
  const o = t as { context?: unknown; webhook?: unknown }
  return {
    context: Array.isArray(o.context) ? o.context.filter((g): g is string => typeof g === 'string') : [],
    webhook: typeof o.webhook === 'string' ? o.webhook : null,
  }
}

function activeTriggerRows(spaceId: string) {
  return prisma.agentState.findMany({
    where: { spaceId, active: true, triggersJson: { not: Prisma.DbNull } },
    select: { name: true, triggersJson: true },
  })
}

/** Names of active agents in the space whose `on.context` globs match `path`. */
export async function matchNoteTriggers(spaceId: string, path: string): Promise<string[]> {
  if (path === 'agents' || path.startsWith('agents/')) return []
  const rows = await activeTriggerRows(spaceId)
  const out: string[] = []
  for (const row of rows) {
    const t = triggersOf(row)
    if (t && t.context.length && matchesAnyGlob(path, t.context)) out.push(row.name)
  }
  return out
}

/** Names of active agents in the space whose `on.webhook` is `connector` (the inbound route's recipients). */
export async function webhookRecipients(spaceId: string, connector: string): Promise<string[]> {
  const rows = await activeTriggerRows(spaceId)
  return rows.filter((r) => triggersOf(r)?.webhook === connector).map((r) => r.name)
}

/**
 * A shared-context note was created / saved / renamed-to: enqueue a
 * `note_written` event for every agent listening on the path. `exceptAgent`
 * is the agent whose own run made the write (no self-loops). One pending row
 * per note path — a burst of saves coalesces; the run reads the note itself.
 * Never throws: a mailbox fault must not fail the save.
 */
export async function fireNoteTriggers(
  spaceId: string,
  path: string,
  actor: Actor,
  origin: string,
  opts: { exceptAgent?: string | null; action?: 'saved' | 'created' | 'renamed' } = {},
): Promise<string[]> {
  try {
    const names = (await matchNoteTriggers(spaceId, path)).filter((n) => n !== opts.exceptAgent)
    if (names.length === 0) return []
    // An agent's write is one hop deeper than what woke its run; anything else
    // is a human (webhooks / replies enqueue at depth 0 from their own routes).
    const via = opts.exceptAgent ?? null
    const { chain, runId } = via ? await chainOfAgentWrite(spaceId, via) : { chain: HUMAN_CHAIN, runId: null }
    if (via && chain.depth > MAX_EVENT_CHAIN_DEPTH) {
      await auditLoopCut(spaceId, via, runId, path)
      return []
    }
    const action = opts.action ?? 'saved'
    const at = new Date()
    const time = at.toISOString().slice(11, 16)
    const results = await Promise.all(
      names.map((name) =>
        enqueueAgentEvent({
          spaceId,
          agentName: name,
          kind: 'note_written',
          source: path,
          summary: `${action} by ${actor.name || 'someone'}${origin && origin !== 'edit' ? ` (${origin})` : ''} at ${time} UTC`,
          payload: { path, action, actor: { id: actor.id, name: actor.name }, origin, at: at.toISOString() },
          dedupeKey: `note_written:${path}`,
          chain,
        }),
      ),
    )
    return names.filter((_, i) => results[i].ok)
  } catch (err) {
    logger.warn('agents.triggers.failed', { spaceId, path, err })
    return []
  }
}

/** Retention: every row (consumed or not) older than EVENT_RETENTION_DAYS. Called from pruneRuns. */
export async function pruneEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * 86_400_000)
  const { count } = await prisma.agentEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return count
}
