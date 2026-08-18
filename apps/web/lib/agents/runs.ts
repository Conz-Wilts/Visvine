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
import { monthBounds } from './budget'

export type RunTrigger = 'scheduled' | 'manual'
export type RunStatus = 'running' | 'succeeded' | 'failed'
export type TerminalReason =
  | 'finished'
  | 'max_turns'
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
  let out = events
  const size = () => JSON.stringify(out).length
  if (size() <= RUN_EVENTS_BYTES_CAP) return out
  // Pass 1: shrink tool results from the front.
  out = out.map((e) => (e.type === 'tool_result' ? { ...e, text: e.text.slice(0, 500) + '…[trimmed]' } : e))
  while (size() > RUN_EVENTS_BYTES_CAP && out.length > 1) {
    out = out.slice(1)
  }
  return out
}

export async function createRun(input: {
  /** Pre-minted by the claim path so agent_state.current_run_id can name it. */
  id?: string
  stateId: string
  spaceId: string
  name: string
  trigger: RunTrigger
  startedBy?: string | null
  model?: string | null
}): Promise<AgentRun> {
  return prisma.agentRun.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      stateId: input.stateId,
      spaceId: input.spaceId,
      name: input.name,
      trigger: input.trigger,
      startedBy: input.startedBy ?? null,
      model: input.model ?? null,
      status: 'running',
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
  await prisma.agentRun.update({
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
  model: string | null
  promptTokens: number
  completionTokens: number
  costMicros: bigint | null
  turns: number
  terminalReason: TerminalReason | null
  summary: string | null
  errorMessage: string | null
}

const LIST_SELECT = {
  id: true,
  trigger: true,
  status: true,
  startedAt: true,
  endedAt: true,
  startedBy: true,
  model: true,
  promptTokens: true,
  completionTokens: true,
  costMicros: true,
  turns: true,
  terminalReason: true,
  summary: true,
  errorMessage: true,
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

/** Retention: drop runs older than RUN_RETENTION_DAYS, keeping the newest RUN_KEEP_PER_AGENT per agent. */
export async function pruneRuns(now = new Date()): Promise<number> {
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
