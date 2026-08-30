/**
 * The Agents feature's service file — one place touching notes + state rows +
 * runs, mirroring lib/connectors/service.ts. Routes and MCP tools call this;
 * nothing else reads the tables directly.
 */
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/notes/audit'
import { readVisible, visibleVault, writeDenial, writeDenialFull, writeGated } from '@/lib/notes/contextService'
import { agentNameOfPath, isAgentBriefPath } from '@/lib/notes/entities'

/** The name an unmigrated flat brief (`agents/<name>.md`) carries, or null. */
function agentNameOfAliasPath(path: string): string | null {
  const m = /^agents\/([^/]+)\.md$/.exec(path)
  // agents/index.md is the folder's own index note, never an agent called "index".
  return m && m[1] !== 'index' && AGENT_NAME_RE.test(m[1]) ? m[1] : null
}
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import { principalCanWrite, principalIsSuperAdmin } from '@/lib/notes/shared/permissions'
import { microsToCents } from './budget'
import {
  AGENT_NAME_RE,
  agentBriefPath,
  DEFAULT_DEBOUNCE_MS,
  describeSchedule,
  describeTriggers,
  hasActivationFrontmatter,
  newAgentNote,
  parseAgentActivation,
  parseAgentBrief,
  withActivation,
  type AgentActivation,
  type AgentBrief,
  type AgentSchedule,
  type AgentTriggers,
} from './config'
import { findAgentActivation, findAgentBrief } from './briefs'
import { deactivateAgent, syncAgentState } from './hooks'
import { DELAYED_AFTER_MS } from './limits'
import { probeModelKey, resolveAgentChatConfig } from './providers'
import { latestRun, spendForMonth, type RunListItem } from './runs'
import { lastHeartbeat } from './schedule'

export type AgentRowState =
  | 'off'
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
    /** The raw `every:` (interval or cron) when the clock came from it. */
    every: string | null
    /** Event triggers from the `on:` map, or null. */
    on: AgentTriggers | null
    triggersLabel: string | null
    debounceMs: number
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
  // costMicros is a BigInt, which JSON cannot carry: it leaves as cents.
  const { costMicros, ...rest } = run
  return {
    ...rest,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt ? run.endedAt.toISOString() : null,
    costCents: microsToCents(costMicros),
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
  path: string,
  briefContent: string,
  opts: { includeSpend: boolean; now: Date; heartbeatAt: Date | null },
): Promise<AgentSummary> {
  const spaceId = context.spaceId
  const fm = parseFrontmatter(briefContent)
  const parsedBrief = parseAgentBrief(fm, splitFrontmatter(briefContent).body)
  const brief = parsedBrief.ok ? parsedBrief.brief : null

  // The brief IS the activation; a pre-merge activation.md is the fallback.
  const parsedLive = hasActivationFrontmatter(fm) ? parseAgentActivation(fm) : (await findAgentActivation(spaceId, name)).parsed
  const activation: AgentActivation | null = parsedLive?.ok ? parsedLive.activation : null

  const [state, last, keyStored, briefRow] = await Promise.all([
    prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } }),
    latestRun(spaceId, name),
    keyStoredFor(spaceId, brief),
    prisma.contextNote.findFirst({
      where: { spaceId, ownerKey: 'shared', path, deletedAt: null },
      select: { createdBy: true },
    }),
  ])

  const tz = activation?.timezone ?? null
  const summary: AgentSummary = {
    name,
    path,
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
      every: activation?.every ?? null,
      on: activation?.on ?? null,
      triggersLabel: describeTriggers(activation?.on ?? null),
      debounceMs: activation?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
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

export interface AgentRoster {
  agents: AgentSummary[]
  heartbeatAt: string | null
}

/**
 * Every agent brief the principal can see — valid or broken. One folder is
 * one agent, so there is nothing to dedupe; a flat `agents/<name>.md` left
 * from before the folder era lists too, under its name, until it is moved.
 */
export async function listAgents(
  p: ContextPrincipal,
  context: Context,
  opts: { includeSpend?: boolean } = {},
): Promise<AgentRoster> {
  const now = new Date()
  const [heartbeatAt, { raws }] = await Promise.all([lastHeartbeat(), visibleVault(p, context)])
  const briefs: { name: string; path: string; content: string }[] = []
  const seen = new Set<string>()
  // Folder briefs first, so a leftover alias never shadows the real one.
  for (const raw of raws) {
    const name = isAgentBriefPath(raw.path) ? agentNameOfPath(raw.path) : null
    if (!name || seen.has(name)) continue
    seen.add(name)
    briefs.push({ name, path: raw.path, content: raw.content })
  }
  for (const raw of raws) {
    const name = agentNameOfAliasPath(raw.path)
    if (!name || seen.has(name)) continue
    seen.add(name)
    briefs.push({ name, path: raw.path, content: raw.content })
  }
  const out = await Promise.all(
    briefs.map((b) => summarise(p, context, b.name, b.path, b.content, { includeSpend: !!opts.includeSpend, now, heartbeatAt })),
  )
  return {
    agents: out.sort((a, b) => a.path.localeCompare(b.path)),
    heartbeatAt: heartbeatAt?.toISOString() ?? null,
  }
}

export async function describeAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: { includeSpend?: boolean } = {},
): Promise<(AgentSummary & { brief: string; heartbeatAt: string | null }) | null> {
  if (!AGENT_NAME_RE.test(name)) return null
  const row = await findAgentBrief(context.spaceId, name)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return null
  const heartbeatAt = await lastHeartbeat()
  const summary = await summarise(p, context, name, row.path, content, { includeSpend: !!opts.includeSpend, now: new Date(), heartbeatAt })
  return { ...summary, brief: content, heartbeatAt: heartbeatAt?.toISOString() ?? null }
}

export type ActivateResult =
  | { ok: true; warning: string | null }
  | { ok: false; status: number; error: string }

/**
 * May this principal turn the agent on or off, change its schedule or run it
 * now? Anyone who can EDIT its brief — a space admin, or a member whose grant
 * reaches agents/<name>/ — so the people who can write what an agent does are
 * the people who decide whether it runs. Money (setBudget) stays admin-only.
 */
function agentManageDenial(p: ContextPrincipal, context: Context, name: string): string | null {
  if (principalIsSuperAdmin(p)) return null
  return writeDenial(p, context, agentBriefPath(name))
}

/**
 * Activation: validate the brief and the key (a 401/403 refuses; other
 * probe failures activate with a warning), write the schedule into the brief
 * through the gate, and re-derive the state row. Anyone who can edit the brief
 * may.
 */
export async function activateAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  input: { schedule: AgentSchedule | null; on?: AgentTriggers | null; debounceMs?: number | null; timezone: string | null },
): Promise<ActivateResult> {
  if (!input.schedule && !(input.on && (input.on.context.length || input.on.webhook))) {
    return { ok: false, status: 400, error: 'An active agent needs a schedule, an interval or a trigger.' }
  }
  // A clock names its zone. Nothing supplies a space-wide default any more, so
  // a scheduled activation without one would silently mean UTC — which is the
  // ambiguity this asks the admin to resolve, once, in writing.
  if (input.schedule && !input.timezone?.trim()) {
    return { ok: false, status: 400, error: 'A scheduled agent must name the timezone it runs in.' }
  }
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  const manage = agentManageDenial(p, context, name)
  if (manage) return { ok: false, status: 403, error: manage }
  const row = await findAgentBrief(context.spaceId, name)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return { ok: false, status: 404, error: 'No such agent.' }
  const parsed = parseAgentBrief(parseFrontmatter(content), splitFrontmatter(content).body)
  if (!parsed.ok) return { ok: false, status: 400, error: `The brief is invalid: ${parsed.error}` }

  const resolved = await resolveAgentChatConfig(context.spaceId, parsed.brief.model)
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.message }
  const probe = await probeModelKey(resolved.config, resolved.ref.provider)
  if (!probe.ok && probe.kind === 'auth') return { ok: false, status: 400, error: probe.message }
  const warning = probe.ok ? null : probe.message

  // The activation is written INTO the brief — one note, one edit, the same
  // people. Round-trip it so a bad glob or interval is refused here, not
  // discovered by the tick.
  const note = withActivation(content, { active: true, schedule: input.schedule, on: input.on ?? null, debounceMs: input.debounceMs ?? null, timezone: input.timezone })
  const check = parseAgentActivation(parseFrontmatter(note))
  if (!check.ok) return { ok: false, status: 400, error: check.error }
  const written = await writeGated(p, context, row.path, note)
  if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }
  await syncAgentState(context.spaceId, name)
  await logAudit(context.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'agent',
    path: row.path,
    detail: `activated: ${[describeSchedule(input.schedule, input.timezone ?? 'UTC'), describeTriggers(input.on ?? null)].filter(Boolean).join('; ')}`,
  })
  return { ok: true, warning }
}

/** Turn an agent off — the same people who may turn it on. */
export async function switchOffAgent(p: ContextPrincipal, context: Context, name: string): Promise<ActivateResult> {
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  const manage = agentManageDenial(p, context, name)
  if (manage) return { ok: false, status: 403, error: manage }
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
    path: (await findAgentBrief(context.spaceId, name))?.path ?? agentBriefPath(name),
    detail: budgetMonthlyCents === null ? 'budget removed' : `budget set: ${budgetMonthlyCents} cents / month`,
  })
  return { ok: true, warning: null }
}

/**
 * May this principal press "Run now" on this agent, or read its transcripts?
 * Its author, a space admin, or any member whose grant lets them edit the
 * brief — the same people who can turn it on.
 */
export async function canTriggerRun(p: ContextPrincipal, spaceId: string, name: string): Promise<boolean> {
  if (principalIsSuperAdmin(p)) return true
  const row = await findAgentBrief(spaceId, name)
  return row !== null && (row.createdBy === p.userId || principalCanWrite(p, row.path))
}

export type CreateAgentResult =
  | { ok: true; name: string; path: string; brief: AgentBrief }
  | { ok: false; status: number; error: string }

/**
 * Write a new agent's brief.
 *
 * This exists so that authoring an agent is a first-class act rather than a
 * hand-off. `agents/` is frozen for AI ORIGINS (contextService.lockedDenial),
 * and that freeze is about autonomous sweeps: a maintenance pass that
 * reformatted the briefs would silently switch off every agent in the space
 * (lib/agents/hooks auto-deactivates on a member edit), and an agent that could
 * write here could rewrite itself. None of that describes a person asking an
 * assistant to set an agent up, so — exactly as the Tool authoring loop does
 * for the identical `tools/` freeze — the write goes through `writeGated` at
 * its default HUMAN origin. Authoring is not sweeping. `writeDenial` and the
 * caller's own grants still apply in full; this widens nothing but the origin.
 *
 * CREATE ONLY, never overwrite. Rewriting a live agent's instructions from an
 * action would let a caller swap what runs unattended without anyone opening
 * the note. Editing a brief stays a human act at the note itself; this is the
 * same line lib/tools/bridge.ts holds for a Tool writing one.
 *
 * The brief is round-tripped through `parseAgentBrief` before it is saved, so
 * an unparseable model ref or tool extra is refused here rather than
 * discovered by the admin who tries to turn it on.
 */
export async function createAgentBrief(
  p: ContextPrincipal,
  context: Context,
  input: {
    name: string
    title?: string
    description?: string
    model?: string
    connectors?: string[]
    tools?: string[]
    body: string
  },
): Promise<CreateAgentResult> {
  const name = input.name.trim().toLowerCase()
  if (!AGENT_NAME_RE.test(name)) {
    return { ok: false, status: 400, error: `"${input.name}" is not an agent name — lower-case letters, digits, - and _, up to 64 characters.` }
  }
  if (context.ownerKey !== SHARED_OWNER_KEY) {
    return { ok: false, status: 400, error: 'Agents are authored in a space, not in personal context.' }
  }

  const existing = await findAgentBrief(context.spaceId, name)
  if (existing) {
    return { ok: false, status: 409, error: `An agent named "${name}" already exists at ${existing.path}. Edit it there — a brief is only ever created here, never replaced.` }
  }

  const path = agentBriefPath(name)
  const denial = await writeDenialFull(p, context, path)
  if (denial) return { ok: false, status: 403, error: denial }

  const content = newAgentNote({
    name,
    title: input.title,
    description: input.description,
    model: input.model,
    connectors: input.connectors,
    tools: input.tools,
    body: input.body,
  })
  const parsed = parseAgentBrief(parseFrontmatter(content), splitFrontmatter(content).body)
  if (!parsed.ok) return { ok: false, status: 400, error: `That brief is not valid: ${parsed.error}` }

  const written = await writeGated(p, context, path, content)
  if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }

  await logAudit(context.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'agent',
    path,
    detail: `brief created: ${parsed.brief.title}`,
  })
  return { ok: true, name, path, brief: parsed.brief }
}
