/**
 * Run records (`agent_runs`): create, flush progress, finish, list, prune,
 * roll up spend. Visvine executes the run, so it holds the record first-hand
 * — there is no provider stream to reconcile against.
 *
 * The transcript is the `AgentEvent` trace: tool results clipped, whole trace
 * capped, secrets already redacted upstream by the isolate. Live progress is
 * the executor flushing the trace every couple of seconds and the UI polling
 * the run — correct across many instances, unlike an in-process stream.
 */
import prisma from '@/lib/prisma'
import type { AgentRun } from '@prisma/client'
import { logger } from '@/lib/logger'
import { monthBounds } from './budget'
import { pruneEvents } from './events'

/** scheduled = clock (hourly/daily/weekly), interval = `every:`, event = note events, webhook = only webhook events, manual = Run now. */
export type RunTrigger = 'scheduled' | 'manual' | 'event' | 'webhook' | 'interval'

/** What a run was handed (agent_runs.input) — the transcript's "Triggered by …" block. */
export interface RunInput {
  /** `depth` = hops from a human (lib/agents/events EventChain); absent on rows from before chains = 0. */
  events: { kind: string; source: string; summary: string; at: string; depth?: number }[]
  /** Set when a run_agent call started this run: the parent run and how deep the chain is (root = 0). */
  chain?: { parent: string; depth: number }
  /** Note paths write_context / append_context changed this run (filled in at run end). */
  writes?: string[]
  /** The brief had `dry_run: true`: nothing above was actually written. */
  dryRun?: boolean
  /** A write this run made was refused as a trigger (chain deeper than MAX_EVENT_CHAIN_DEPTH); audited once. */
  loopCut?: boolean
}

/** Merge run-end facts (writes, dryRun) into agent_runs.input without clobbering what dispatch stored. */
export async function recordRunInput(runId: string, patch: Pick<RunInput, 'writes' | 'dryRun'>): Promise<void> {
  const row = await prisma.agentRun.findUnique({ where: { id: runId }, select: { input: true } })
  const current = (row?.input as RunInput | null) ?? null
  const next: RunInput = { events: current?.events ?? [], ...(current ?? {}), ...patch }
  if (!patch.writes?.length) delete next.writes
  if (!patch.dryRun) delete next.dryRun
  if (!next.chain && !next.writes && !next.dryRun && next.events.length === 0) return
  await prisma.agentRun.update({ where: { id: runId }, data: { input: next as unknown as object } })
}
export type RunStatus = 'running' | 'succeeded' | 'failed'
export type TerminalReason =
  | 'finished'
  | 'max_turns'
  | 'narrated'
  | 'budget'
  | 'run_cap'
  | 'timeout'
  | 'crashed'
  | 'error'
  | 'auth'
  | 'quota'
  | 'upstream'
  | 'config'
  | 'author_gone'
  | 'aborted'

export type AgentRunEvent =
  | { at: number; type: 'assistant'; text: string }
  | { at: number; type: 'tool'; tool: string; detail: string }
  | { at: number; type: 'tool_result'; tool: string; text: string }
  | { at: number; type: 'system'; text: string }

const RUN_EVENT_TEXT_CAP = 8_000
export const RUN_EVENTS_BYTES_CAP = 200_000
const RUN_SUMMARY_CAP = 4_000
const RUN_RETENTION_DAYS = 90
const RUN_KEEP_PER_AGENT = 100

export function clipEventText(text: string): string {
  return text.length > RUN_EVENT_TEXT_CAP ? text.slice(0, RUN_EVENT_TEXT_CAP) + '\n…[truncated]' : text
}

/** Keep the trace under the byte cap by dropping the OLDEST tool results first, then the head. */
export function capEvents(events: AgentRunEvent[]): AgentRunEvent[] {
  if (JSON.stringify(events).length <= RUN_EVENTS_BYTES_CAP) return events
  // Pass 1: shrink tool results from the front.
  const out = events.map((e) => (e.type === 'tool_result' ? { ...e, text: e.text.slice(0, 500) + '…[trimmed]' } : e))
  // Pass 2: drop from the head. The serialized array is `[a,b,…]`, so its
  // length is the items' lengths plus one separator per gap plus the brackets.
  const sizes = out.map((e) => JSON.stringify(e).length)
  let total = sizes.reduce((n, s) => n + s, 0) + Math.max(0, out.length - 1) + 2
  let drop = 0
  while (total > RUN_EVENTS_BYTES_CAP && out.length - drop > 1) {
    total -= sizes[drop] + 1
    drop++
  }
  return drop ? out.slice(drop) : out
}

export async function createRun(input: {
  /** Pre-minted by the claim path so agent_state.current_run_id can name it. */
  id?: string
  stateId: string
  spaceId: string
  name: string
  trigger: RunTrigger
  startedBy?: string | null
  /** Whose principal the run acts as; null = the state row's runAsUserId. */
  runAsUserId?: string | null
  model?: string | null
  eventCount?: number
  input?: RunInput | null
}): Promise<AgentRun> {
  return prisma.agentRun.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      stateId: input.stateId,
      spaceId: input.spaceId,
      name: input.name,
      trigger: input.trigger,
      startedBy: input.startedBy ?? null,
      runAsUserId: input.runAsUserId ?? null,
      model: input.model ?? null,
      status: 'running',
      eventCount: input.eventCount ?? 0,
      input: input.input ? (input.input as unknown as object) : undefined,
    },
  })
}

export async function flushRunEvents(runId: string, events: AgentRunEvent[], extra: { turns?: number; model?: string } = {}) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { events: capEvents(events) as object[], ...(extra.turns !== undefined ? { turns: extra.turns } : {}), ...(extra.model ? { model: extra.model } : {}) },
  })
}

export async function finishRun(
  runId: string,
  input: {
    status: Exclude<RunStatus, 'running'>
    terminalReason: TerminalReason
    events: AgentRunEvent[]
    turns: number
    promptTokens: number
    completionTokens: number
    costMicros: bigint | null
    summary: string | null
    errorMessage: string | null
    model?: string | null
  },
): Promise<void> {
  const row = await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: input.status,
      terminalReason: input.terminalReason,
      endedAt: new Date(),
      events: capEvents(input.events) as object[],
      turns: input.turns,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      costMicros: input.costMicros,
      summary: input.summary ? input.summary.slice(0, RUN_SUMMARY_CAP) : null,
      errorMessage: input.errorMessage ? input.errorMessage.slice(0, 2_000) : null,
      ...(input.model ? { model: input.model } : {}),
    },
    select: { spaceId: true, name: true, model: true, startedAt: true },
  })
  // The durable ledger, run rows being prunable. Failed runs metered too — the
  // provider billed those tokens all the same. Its failure never fails the
  // finish: the run record is the fact, the rollup is bookkeeping.
  try {
    await meterModelUsage({
      spaceId: row.spaceId,
      name: row.name,
      model: input.model ?? row.model,
      startedAt: row.startedAt,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      costMicros: input.costMicros,
    })
  } catch (err) {
    logger.error('agents.usage.meter_failed', { err, runId })
  }
}

/**
 * Add one billed model job to agent_model_usage — the month it STARTED in,
 * like spendForMonth. A "run" here is a run OR a teaching (teach route): every
 * time the space's key was spent under an agent's name, so the space cap has
 * one ledger to bind against.
 */
export async function meterModelUsage(run: {
  spaceId: string
  name: string
  model: string | null
  startedAt: Date
  promptTokens: number
  completionTokens: number
  costMicros: bigint | null
}): Promise<void> {
  const month = monthBounds(run.startedAt).start
  const model = run.model ?? 'unknown'
  const priced = run.costMicros !== null
  await prisma.agentModelUsage.upsert({
    where: { usage_identity: { spaceId: run.spaceId, month, name: run.name, model } },
    create: {
      spaceId: run.spaceId,
      month,
      name: run.name,
      model,
      runs: 1,
      promptTokens: BigInt(run.promptTokens),
      completionTokens: BigInt(run.completionTokens),
      costMicros: run.costMicros ?? BigInt(0),
      unpricedRuns: priced ? 0 : 1,
    },
    update: {
      runs: { increment: 1 },
      promptTokens: { increment: BigInt(run.promptTokens) },
      completionTokens: { increment: BigInt(run.completionTokens) },
      costMicros: { increment: run.costMicros ?? BigInt(0) },
      unpricedRuns: { increment: priced ? 0 : 1 },
    },
  })
}

/** Mark a run that its instance never finished (reclaimed by the tick). */
export async function failStaleRun(runId: string, reason: TerminalReason, message: string): Promise<void> {
  await prisma.agentRun.updateMany({
    where: { id: runId, status: 'running' },
    data: { status: 'failed', terminalReason: reason, endedAt: new Date(), errorMessage: message },
  })
}

export interface RunListItem {
  id: string
  trigger: RunTrigger
  status: RunStatus
  startedAt: Date
  endedAt: Date | null
  startedBy: string | null
  runAsUserId: string | null
  model: string | null
  promptTokens: number
  completionTokens: number
  costMicros: bigint | null
  turns: number
  terminalReason: TerminalReason | null
  summary: string | null
  errorMessage: string | null
  eventCount: number
  input: RunInput | null
}

const LIST_SELECT = {
  id: true,
  trigger: true,
  status: true,
  startedAt: true,
  endedAt: true,
  startedBy: true,
  runAsUserId: true,
  model: true,
  promptTokens: true,
  completionTokens: true,
  costMicros: true,
  turns: true,
  terminalReason: true,
  summary: true,
  errorMessage: true,
  eventCount: true,
  input: true,
} as const

export async function listRuns(spaceId: string, name: string, limit = 25): Promise<RunListItem[]> {
  const rows = await prisma.agentRun.findMany({
    where: { spaceId, name },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: LIST_SELECT,
  })
  return rows as RunListItem[]
}

export async function latestRun(spaceId: string, name: string): Promise<RunListItem | null> {
  const row = await prisma.agentRun.findFirst({ where: { spaceId, name }, orderBy: { startedAt: 'desc' }, select: LIST_SELECT })
  return (row as RunListItem | null) ?? null
}

/**
 * What a running run is doing RIGHT NOW, as one line — the last tool it called
 * and what about — for the roster's row and the status line. Null when the
 * run has not called a tool yet or is not running.
 */
export async function currentStepOf(runId: string): Promise<string | null> {
  const row = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true, events: true } })
  if (!row || row.status !== 'running') return null
  const events = (row.events as AgentRunEvent[] | null) ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'tool') return e.detail ? `${e.tool} · ${e.detail.replace(/\s+/g, ' ').slice(0, 80)}` : e.tool
  }
  return null
}

export async function getRun(spaceId: string, name: string, runId: string) {
  const row = await prisma.agentRun.findFirst({ where: { id: runId, spaceId, name } })
  if (!row) return null
  return { ...(row as RunListItem & { events: unknown }), events: (row.events as AgentRunEvent[]) ?? [] }
}

/** Sum of known costs for runs started in the UTC month of `at`. */
export async function spendForMonth(spaceId: string, name: string | null, at: Date): Promise<bigint> {
  const { start, end } = monthBounds(at)
  const agg = await prisma.agentRun.aggregate({
    where: { spaceId, ...(name ? { name } : {}), startedAt: { gte: start, lt: end }, costMicros: { not: null } },
    _sum: { costMicros: true },
  })
  return agg._sum.costMicros ?? BigInt(0)
}

/**
 * The space's spend on one provider's key for the UTC month of `at`, from the
 * ledger rather than the prunable run rows — so it includes teachings and
 * every agent. The ledger's `model` is `<provider>/<modelId>`, so every model
 * on the key counts. What the model note's `budget_monthly:` compares against.
 */
export async function ledgerSpendForMonth(spaceId: string, providerId: string, at: Date): Promise<bigint> {
  const agg = await prisma.agentModelUsage.aggregate({
    where: { spaceId, month: monthBounds(at).start, model: { startsWith: `${providerId}/` } },
    _sum: { costMicros: true },
  })
  return agg._sum.costMicros ?? BigInt(0)
}

/**
 * One agent's spend for the UTC month of `at`, from the ledger — runs AND
 * chat turns (lib/agents/chat.ts), which meter under the agent's name but
 * never make a run row. What the agent's own `budgetMonthlyCents` compares
 * against when a chat turn asks.
 */
export async function ledgerSpendForAgent(spaceId: string, name: string, at: Date): Promise<bigint> {
  const agg = await prisma.agentModelUsage.aggregate({
    where: { spaceId, month: monthBounds(at).start, name },
    _sum: { costMicros: true },
  })
  return agg._sum.costMicros ?? BigInt(0)
}

/** Retention: drop runs older than RUN_RETENTION_DAYS, keeping the newest RUN_KEEP_PER_AGENT per agent. */
export async function pruneRuns(now = new Date()): Promise<number> {
  await pruneEvents(now)
  const cutoff = new Date(now.getTime() - RUN_RETENTION_DAYS * 86_400_000)
  const old = await prisma.agentRun.findMany({
    where: { startedAt: { lt: cutoff }, status: { not: 'running' } },
    select: { id: true, stateId: true, startedAt: true },
    orderBy: { startedAt: 'desc' },
  })
  if (old.length === 0) return 0
  // Which of the old rows are still within an agent's newest N? Keep those.
  const byState = new Map<string, number>()
  const recentCounts = await prisma.agentRun.groupBy({
    by: ['stateId'],
    where: { startedAt: { gte: cutoff } },
    _count: { _all: true },
  })
  for (const r of recentCounts) byState.set(r.stateId, r._count._all)
  const toDelete: string[] = []
  for (const row of old) {
    const kept = byState.get(row.stateId) ?? 0
    if (kept < RUN_KEEP_PER_AGENT) {
      byState.set(row.stateId, kept + 1)
      continue
    }
    toDelete.push(row.id)
  }
  if (toDelete.length === 0) return 0
  const { count } = await prisma.agentRun.deleteMany({ where: { id: { in: toDelete } } })
  return count
}
