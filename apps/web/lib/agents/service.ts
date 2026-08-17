/**
 * The Agents feature's service file — one place touching notes + state rows +
 * runs, mirroring lib/connectors/service.ts. Routes and MCP tools call this;
 * nothing else reads the tables directly.
 */
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/notes/audit'
import { readVisible, visibleVault, writeGated } from '@/lib/notes/contextService'
import { agentNameOfPath, isAgentBriefPath } from '@/lib/notes/entities'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { principalIsSuperAdmin } from '@/lib/notes/shared/permissions'
import { microsToCents } from './budget'
import {
  AGENT_NAME_RE,
  agentActivationPath,
  agentBriefPath,
  describeSchedule,
  newActivationNote,
  parseAgentActivation,
  parseAgentBrief,
  type AgentActivation,
  type AgentBrief,
  type AgentSchedule,
} from './config'
import { deactivateAgent, effectiveTimezone, syncAgentState } from './hooks'
import { DELAYED_AFTER_MS } from './limits'
import { probeModelKey, resolveAgentChatConfig } from './providers'
import { latestRun, spendForMonth, type RunListItem } from './runs'
import { lastHeartbeat } from './schedule'

export type AgentRowState =
  | 'off'
  | 'needs_reactivation'
  | 'needs_key'
  | 'invalid'
  | 'scheduled'
  | 'due'
  | 'delayed'
  | 'running'
  | 'failed'
  | 'budget'
  | 'deactivated'

export interface AgentSummary {
  name: string
  path: string
  title: string
  description: string | null
  model: string | null
  connectors: string[]
  tools: string[]
  /** The brief's parse error, or null. A broken brief still lists. */
  invalid: string | null
  authorUserId: string | null
  activation: {
    active: boolean
    schedule: AgentSchedule | null
    scheduleLabel: string
    timezone: string | null
    invalid: string | null
  }
  state: {
    status: 'idle' | 'running'
    nextRunAt: string | null
    lastRunAt: string | null
    runningSince: string | null
    deactivatedReason: string | null
    deactivatedDetail: string | null
    consecutiveFailures: number
  }
  lastRun: SerializedRun | null
  /** Whether MODEL_KEY_<PROVIDER> is stored for the brief's provider. */
  keyStored: boolean
  rowState: AgentRowState
  /** Admin-only; stripped for members by the route. */
  spend: { monthCents: number | null; budgetMonthlyCents: number | null } | null
}

export interface SerializedRun extends Omit<RunListItem, 'startedAt' | 'endedAt' | 'costMicros'> {
  startedAt: string
  endedAt: string | null
  costCents: number | null
}

export function serializeRun(run: RunListItem): SerializedRun {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt ? run.endedAt.toISOString() : null,
    costCents: microsToCents(run.costMicros),
  }
}

function rowStateOf(
  s: Pick<AgentSummary, 'invalid' | 'activation' | 'state' | 'lastRun' | 'keyStored'>,
  now: Date,
  heartbeatAt: Date | null,
): AgentRowState {
  if (s.invalid || s.activation.invalid) return 'invalid'
  if (s.state.status === 'running') return 'running'
  if (!s.activation.active) {
    if (s.state.deactivatedReason === 'brief_changed') return 'needs_reactivation'
    if (s.state.deactivatedReason && s.state.deactivatedReason !== 'admin') return 'deactivated'
    return 'off'
  }
  if (!s.keyStored) return 'needs_key'
  const last = s.lastRun
  if (last?.terminalReason === 'budget' || last?.terminalReason === 'run_cap') {
    // Paused for the month if the budget hit is the latest word.
    return 'budget'
  }
  if (s.state.nextRunAt) {
    const next = new Date(s.state.nextRunAt).getTime()
    if (next <= now.getTime()) {
      const tickStale = heartbeatAt ? now.getTime() - heartbeatAt.getTime() > DELAYED_AFTER_MS : true
      return now.getTime() - next > DELAYED_AFTER_MS || tickStale ? 'delayed' : 'due'
    }
  }
  if (last?.status === 'failed') return 'failed'
  return 'scheduled'
}

async function keyStoredFor(spaceId: string, brief: AgentBrief | null): Promise<boolean> {
  if (!brief) return false
  const row = await prisma.connectorSecret.findUnique({
    where: { secret_identity: { spaceId, name: brief.modelRef.provider.keySecret } },
    select: { name: true },
  })
  return row !== null
}

async function summarise(
  p: ContextPrincipal,
  context: Context,
  name: string,
  briefContent: string,
  opts: { includeSpend: boolean; now: Date; heartbeatAt: Date | null },
): Promise<AgentSummary> {
  const spaceId = context.spaceId
  const fm = parseFrontmatter(briefContent)
  const parsedBrief = parseAgentBrief(fm, splitFrontmatter(briefContent).body)
  const brief = parsedBrief.ok ? parsedBrief.brief : null

  const liveContent = await readVisible(p, context, agentActivationPath(name))
  const parsedLive = liveContent ? parseAgentActivation(parseFrontmatter(liveContent)) : null
  const activation: AgentActivation | null = parsedLive?.ok ? parsedLive.activation : null

  const [state, last, keyStored, briefRow] = await Promise.all([
    prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } }),
    latestRun(spaceId, name),
    keyStoredFor(spaceId, brief),
    prisma.contextNote.findFirst({
      where: { spaceId, ownerKey: 'shared', path: agentBriefPath(name), deletedAt: null },
      select: { createdBy: true },
    }),
  ])

  const tz = activation?.timezone ?? null
  const summary: AgentSummary = {
    name,
    path: agentBriefPath(name),
    title: brief?.title || (typeof fm.title === 'string' && fm.title) || name,
    description: brief?.description ?? (typeof fm.description === 'string' ? fm.description : null),
    model: brief?.model ?? (typeof fm.model === 'string' ? fm.model : null),
    connectors: brief?.connectors ?? [],
    tools: brief?.tools ?? [],
    invalid: parsedBrief.ok ? null : parsedBrief.error,
    authorUserId: briefRow?.createdBy ?? null,
    activation: {
      active: !!activation?.active,
      schedule: activation?.schedule ?? null,
      scheduleLabel: describeSchedule(activation?.schedule ?? null, tz),
      timezone: tz,
      invalid: parsedLive && !parsedLive.ok ? parsedLive.error : null,
    },
    state: {
      status: (state?.status as 'idle' | 'running') ?? 'idle',
      nextRunAt: state?.nextRunAt?.toISOString() ?? null,
      lastRunAt: state?.lastRunAt?.toISOString() ?? null,
      runningSince: state?.runningSince?.toISOString() ?? null,
      deactivatedReason: state?.deactivatedReason ?? null,
      deactivatedDetail: state?.deactivatedDetail ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
    },
    lastRun: last ? serializeRun(last) : null,
    keyStored,
    rowState: 'off',
    spend: null,
  }
  summary.rowState = rowStateOf(summary, opts.now, opts.heartbeatAt)
  if (opts.includeSpend) {
    const month = await spendForMonth(spaceId, name, opts.now)
    summary.spend = { monthCents: brief?.modelRef.pricing ? microsToCents(month) : null, budgetMonthlyCents: state?.budgetMonthlyCents ?? null }
  }
  return summary
}

/** Every agent brief the principal can see — valid or broken. */
export async function listAgents(
  p: ContextPrincipal,
  context: Context,
  opts: { includeSpend?: boolean } = {},
): Promise<{ agents: AgentSummary[]; heartbeatAt: string | null }> {
  const now = new Date()
  const heartbeatAt = await lastHeartbeat()
  const { raws } = await visibleVault(p, context)
  const out: AgentSummary[] = []
  for (const raw of raws) {
    if (!isAgentBriefPath(raw.path)) continue
    const name = agentNameOfPath(raw.path)
    if (!name) continue
    out.push(await summarise(p, context, name, raw.content, { includeSpend: !!opts.includeSpend, now, heartbeatAt }))
  }
  return {
    agents: out.sort((a, b) => a.name.localeCompare(b.name)),
    heartbeatAt: heartbeatAt?.toISOString() ?? null,
  }
}

export async function describeAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: { includeSpend?: boolean } = {},
): Promise<(AgentSummary & { brief: string; activationNote: string | null; heartbeatAt: string | null }) | null> {
  if (!AGENT_NAME_RE.test(name)) return null
  const content = await readVisible(p, context, agentBriefPath(name))
  if (content === null) return null
  const heartbeatAt = await lastHeartbeat()
  const summary = await summarise(p, context, name, content, { includeSpend: !!opts.includeSpend, now: new Date(), heartbeatAt })
  const activationNote = await readVisible(p, context, agentActivationPath(name))
  return { ...summary, brief: content, activationNote, heartbeatAt: heartbeatAt?.toISOString() ?? null }
}

export type ActivateResult =
  | { ok: true; warning: string | null }
  | { ok: false; status: number; error: string }

/**
 * Admin activation: validate the brief and the key (a 401/403 refuses; other
 * probe failures activate with a warning), write the activation note through
 * the gate, and re-derive the state row.
 */
export async function activateAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  input: { schedule: AgentSchedule; timezone: string | null },
): Promise<ActivateResult> {
  if (!principalIsSuperAdmin(p)) return { ok: false, status: 403, error: 'Only space admins can activate an agent.' }
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  const content = await readVisible(p, context, agentBriefPath(name))
  if (content === null) return { ok: false, status: 404, error: 'No such agent.' }
  const parsed = parseAgentBrief(parseFrontmatter(content), splitFrontmatter(content).body)
  if (!parsed.ok) return { ok: false, status: 400, error: `The brief is invalid: ${parsed.error}` }

  const resolved = await resolveAgentChatConfig(context.spaceId, parsed.brief.model)
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.message }
  const probe = await probeModelKey(resolved.config, resolved.ref.provider)
  if (!probe.ok && probe.kind === 'auth') return { ok: false, status: 400, error: probe.message }
  const warning = probe.ok ? null : probe.message

  const note = newActivationNote({ active: true, schedule: input.schedule, timezone: input.timezone })
  const written = await writeGated(p, context, agentActivationPath(name), note)
  if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }
  await syncAgentState(context.spaceId, name)
  await logAudit(context.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'agent',
    path: agentBriefPath(name),
    detail: `activated: ${describeSchedule(input.schedule, input.timezone ?? (await effectiveTimezone(context.spaceId, null)))}`,
  })
  return { ok: true, warning }
}

export async function deactivateByAdmin(p: ContextPrincipal, context: Context, name: string): Promise<ActivateResult> {
  if (!principalIsSuperAdmin(p)) return { ok: false, status: 403, error: 'Only space admins can deactivate an agent.' }
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  await deactivateAgent(context.spaceId, name, 'admin', null, { userId: p.userId, name: p.name })
  return { ok: true, warning: null }
}

export async function setBudget(
  p: ContextPrincipal,
  context: Context,
  name: string,
  budgetMonthlyCents: number | null,
): Promise<ActivateResult> {
  if (!principalIsSuperAdmin(p)) return { ok: false, status: 403, error: 'Only space admins can set a budget.' }
  if (budgetMonthlyCents !== null && (!Number.isInteger(budgetMonthlyCents) || budgetMonthlyCents < 0)) {
    return { ok: false, status: 400, error: 'Budget must be a whole number of cents, or null.' }
  }
  await syncAgentState(context.spaceId, name) // make sure the row exists
  await prisma.agentState.update({ where: { agent_identity: { spaceId: context.spaceId, name } }, data: { budgetMonthlyCents } })
  await logAudit(context.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'agent',
    path: agentBriefPath(name),
    detail: budgetMonthlyCents === null ? 'budget removed' : `budget set: ${budgetMonthlyCents} cents / month`,
  })
  return { ok: true, warning: null }
}

/** Author-or-admin: may this principal press "Run now" on this agent? */
export async function canTriggerRun(p: ContextPrincipal, spaceId: string, name: string): Promise<boolean> {
  if (principalIsSuperAdmin(p)) return true
  const row = await prisma.contextNote.findFirst({
    where: { spaceId, ownerKey: 'shared', path: agentBriefPath(name), deletedAt: null },
    select: { createdBy: true },
  })
  return row?.createdBy === p.userId
}
