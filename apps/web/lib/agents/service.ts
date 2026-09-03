/**
 * The Agents feature's service file — one place touching notes + state rows +
 * runs, mirroring lib/connectors/service.ts. Routes and MCP tools call this;
 * nothing else reads the tables directly.
 */
import prisma from '@/lib/prisma'
import { defaultModelOf, noModelReason, spaceModels, type SpaceModel } from './spaceModels'
import { connectorReadiness, type ConnectorReadiness } from '@/lib/connectors/service'
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
  /** Whose principal a scheduled run acts as: `runs_as`, else the author. */
  runAsUserId: string | null
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
  /**
   * What this agent would actually run on now, `<provider>/<id>` — the brief's
   * pin, or the space's model when it carries none. Null when the space has no
   * model at all.
   */
  modelEffective: string | null
  /** The connector supplying it, when the model is the space's rather than pinned. */
  /** The path of the model note a brief that names none runs on; null when it pins one or there is none. */
  modelNote: string | null
  /**
   * Why it cannot run at all — no model in the space, no key, a connector
   * switched off — or null when it can. One sentence, already phrased for
   * whoever is about to be stopped by it.
   */
  modelProblem: string | null
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
  s: Pick<AgentSummary, 'invalid' | 'activation' | 'state' | 'lastRun' | 'modelProblem'>,
  now: Date,
  heartbeatAt: Date | null,
): AgentRowState {
  if (s.invalid || s.activation.invalid) return 'invalid'
  if (s.state.status === 'running') return 'running'
  if (!s.activation.active) {
    if (s.state.deactivatedReason && s.state.deactivatedReason !== 'admin') return 'deactivated'
    return 'off'
  }
  if (s.modelProblem) return 'needs_key'
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

/**
 * Which model this agent runs on, and whether it can.
 *
 * Two cases, and they fail differently. A brief that PINS a model is asking
 * for that one, so the answer is about its provider's key. A brief that names
 * none runs on the space's model, so the answer is about whether the space has
 * one at all — and if it does not, saying "no key for Google Gemini" names a
 * provider nobody here ever chose. That is the whole reason this reads the
 * space's connectors rather than a secret row.
 */
function modelStateOf(
  brief: AgentBrief | null,
  models: readonly SpaceModel[],
): Pick<AgentSummary, 'modelEffective' | 'modelNote' | 'modelProblem'> {
  if (!brief) return { modelEffective: null, modelNote: null, modelProblem: null }
  if (brief.modelRef) {
    const ref = `${brief.modelRef.provider.id}/${brief.modelRef.modelId}`
    // A pinned model is served by whichever model note names that provider; the
    // key is per provider, so any of them proves it is payable.
    const behind = models.find((m) => m.provider.id === brief.modelRef!.provider.id && m.problem === null)
    return {
      modelEffective: ref,
      modelNote: null,
      modelProblem: behind
        ? null
        : `This brief pins ${ref}, and this space has no working ${brief.modelRef.provider.label} model. Add one under Models, or clear \`model:\` to use the space's.`,
    }
  }
  const fallback = defaultModelOf(models)
  if (!fallback) return { modelEffective: null, modelNote: null, modelProblem: noModelReason(models) }
  return { modelEffective: fallback.ref, modelNote: fallback.path, modelProblem: null }
}

async function summarise(
  p: ContextPrincipal,
  context: Context,
  name: string,
  path: string,
  briefContent: string,
  opts: { includeSpend: boolean; now: Date; heartbeatAt: Date | null; models: readonly SpaceModel[] },
): Promise<AgentSummary> {
  const spaceId = context.spaceId
  const fm = parseFrontmatter(briefContent)
  const parsedBrief = parseAgentBrief(fm, splitFrontmatter(briefContent).body)
  const brief = parsedBrief.ok ? parsedBrief.brief : null

  // The brief IS the activation; a pre-merge activation.md is the fallback.
  const parsedLive = hasActivationFrontmatter(fm) ? parseAgentActivation(fm) : (await findAgentActivation(spaceId, name)).parsed
  const activation: AgentActivation | null = parsedLive?.ok ? parsedLive.activation : null

  const [state, last, briefRow] = await Promise.all([
    prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } }),
    latestRun(spaceId, name),
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
    runAsUserId: activation?.runsAs ?? state?.runAsUserId ?? briefRow?.createdBy ?? null,
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
    ...modelStateOf(brief, opts.models),
    rowState: 'off',
    spend: null,
  }
  summary.rowState = rowStateOf(summary, opts.now, opts.heartbeatAt)
  if (opts.includeSpend) {
    const month = await spendForMonth(spaceId, name, opts.now)
    // Recorded cost is shown whatever the brief runs on NOW — past runs priced
    // at run time keep their dollars when the model changes. Null only when
    // nothing was ever priced AND the current model has no registry price:
    // that agent is genuinely tokens-only.
    summary.spend = {
      monthCents: month > BigInt(0) || brief?.modelRef?.pricing ? microsToCents(month) : null,
      budgetMonthlyCents: state?.budgetMonthlyCents ?? null,
    }
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
  // One read of the space's models for the whole roster: every row's answer to
  // "can this run" comes out of the same list.
  const [heartbeatAt, { raws }, models] = await Promise.all([
    lastHeartbeat(),
    visibleVault(p, context),
    spaceModels(context.spaceId),
  ])
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
    briefs.map((b) => summarise(p, context, b.name, b.path, b.content, { includeSpend: !!opts.includeSpend, now, heartbeatAt, models })),
  )
  return {
    agents: out.sort((a, b) => a.path.localeCompare(b.path)),
    heartbeatAt: heartbeatAt?.toISOString() ?? null,
  }
}

export interface AgentSubscriber {
  userId: string
  name: string | null
}

/**
 * What one person's runs of this agent would need, judged before anything
 * fires: `viewer` is the person looking at the page (what THEY still have to
 * connect before putting their name down), `runAs` is the identity scheduled
 * runs act as — the Turn-on preflight — or null when that is the viewer.
 */
export interface AgentReadiness {
  viewer: ConnectorReadiness[]
  runAs: ConnectorReadiness[] | null
  runAsUserId: string | null
  runAsName: string | null
  /** The viewer IS that identity, so every fire already runs for them. */
  viewerIsRunAs: boolean
}

export async function describeAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: { includeSpend?: boolean } = {},
): Promise<
  | (AgentSummary & {
      brief: string
      heartbeatAt: string | null
      subscribers: AgentSubscriber[]
      viewerSubscribed: boolean
      readiness: AgentReadiness
    })
  | null
> {
  if (!AGENT_NAME_RE.test(name)) return null
  const row = await findAgentBrief(context.spaceId, name)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return null
  const heartbeatAt = await lastHeartbeat()
  const summary = await summarise(p, context, name, row.path, content, {
    includeSpend: !!opts.includeSpend,
    now: new Date(),
    heartbeatAt,
    models: await spaceModels(context.spaceId),
  })

  const subRows = await prisma.agentSubscription.findMany({
    where: { spaceId: context.spaceId, name },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  })
  const runAsUserId = summary.runAsUserId
  const userIds = [...new Set([...subRows.map((s) => s.userId), ...(runAsUserId ? [runAsUserId] : [])])]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(users.map((u) => [u.id, u.name]))

  const viewer = await connectorReadiness(p, context, summary.connectors, p.userId)
  const runAs =
    runAsUserId && runAsUserId !== p.userId ? await connectorReadiness(p, context, summary.connectors, runAsUserId) : null

  return {
    ...summary,
    brief: content,
    heartbeatAt: heartbeatAt?.toISOString() ?? null,
    subscribers: subRows.map((s) => ({ userId: s.userId, name: nameOf.get(s.userId) ?? null })),
    viewerSubscribed: subRows.some((s) => s.userId === p.userId),
    readiness: {
      viewer,
      runAs,
      runAsUserId,
      runAsName: runAsUserId ? (nameOf.get(runAsUserId) ?? null) : null,
      viewerIsRunAs: runAsUserId === p.userId,
    },
  }
}

/**
 * Put your own name down: each fire of this agent then runs once FOR you, as
 * your principal, so a `mode: user` connector spends YOUR linked account.
 * Anyone who can READ the brief may subscribe THEMSELVES — the run reaches
 * only what they can already reach, so there is nothing here to approve.
 */
export async function subscribeToAgent(p: ContextPrincipal, context: Context, name: string): Promise<ActivateResult> {
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  const row = await findAgentBrief(context.spaceId, name)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return { ok: false, status: 404, error: 'No such agent.' }
  await prisma.agentSubscription.upsert({
    where: { agent_subscription_identity: { spaceId: context.spaceId, name, userId: p.userId } },
    create: { spaceId: context.spaceId, name, userId: p.userId },
    update: {},
  })
  await logAudit(context.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'agent',
    path: row.path,
    detail: 'subscribed to runs',
  })
  return { ok: true, warning: null }
}

/** Take a name off the list: your own, or anyone's if you are a space admin. */
export async function unsubscribeFromAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  userId: string,
): Promise<ActivateResult> {
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  if (userId !== p.userId && !principalIsSuperAdmin(p)) {
    return { ok: false, status: 403, error: 'Only a space admin can remove someone else.' }
  }
  await prisma.agentSubscription
    .delete({ where: { agent_subscription_identity: { spaceId: context.spaceId, name, userId } } })
    .catch(() => undefined)
  return { ok: true, warning: null }
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
