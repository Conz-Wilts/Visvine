/**
 * The Agents feature's service file — one place touching notes + state rows +
 * runs, mirroring lib/connectors/service.ts. Routes and MCP tools call this;
 * nothing else reads the tables directly.
 */
import prisma from '@/lib/prisma'
import { defaultModelOf, noModelReason, runnableModels, spaceModels, type SpaceModel } from './spaceModels'
import { connectorReadiness, listConnectors, type ConnectorReadiness } from '@/lib/connectors/service'
import { agentNeeds, hardNeeds, signInsOwed, type AgentNeeds } from './shared/needs'
import { needsCatalog } from './needs'
import { logAudit } from '@/lib/notes/audit'
import { readVisible, visibleVault, writeDenial, writeDenialFull, writeGated } from '@/lib/notes/contextService'

/** The name an unmigrated flat brief (`agents/<name>.md`) carries, or null. */
function agentNameOfAliasPath(path: string): string | null {
  const m = /^agents\/([^/]+)\.md$/.exec(path)
  // agents/index.md is the folder's own index note, never an agent called "index".
  return m && m[1] !== 'index' && AGENT_NAME_RE.test(m[1]) ? m[1] : null
}
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import { principalCanWrite, principalIsSuperAdmin } from '@/lib/notes/shared/permissions'
import {
  AGENT_NAME_RE,
  agentBriefPath,
  DEFAULT_DEBOUNCE_MS,
  describeSchedule,
  describeTriggers,
  newAgentNote,
  type AgentActivation,
  type AgentBrief,
  type AgentSchedule,
  type AgentTriggers,
} from './config'
import { agentConfigOf, composeAgent, findAgentActivation, findAgentBrief, findOwnAgentBrief, readAgent, type ComposedAgent } from './briefs'
import { modelFor, parseRunsFor, runsForDenial, withRunsFor } from './shared/runsFor'
import { inputValuesDenial, inputValuesFor, missingInputs, type AgentInput, type InputValues } from './shared/inputs'
import { applyConfigPatch, configOf, defaultAgentConfig, runsForColumns, type AgentConfig, type AgentConfigPatch } from './shared/agentConfig'
import { listAgentConfigChanges, storeAgentConfig, withAgentRecord, type AgentConfigChangeRow } from './record'
import { adoptNoteConfig, deactivateAgent, syncAgentState } from './hooks'
import { DELAYED_AFTER_MS } from './limits'
import { probeModelKey, resolveAgentChatConfig } from './providers'
import { localRuntimeOf, localRuntimeRefusal } from './local'
import { spaceTrackRecords } from '@/lib/models/service'
import { isLightModel, recommendModel, type ModelAdvice } from './shared/advice'
import { jobShapeOf } from './diagnose'
import { currentStepOf, latestRun, type RunListItem } from './runs'
import { memoryPath } from './shared/memory'
import { agentFolderIn } from './location'
import { landingFolderOf } from '@/lib/notes/landing'
import { agentFolderOfBrief, agentHomeFolder, agentNameOfFolder, briefFolderOf } from './shared/folder'
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
  /** The values each person supplies for themselves (shared/inputs.ts). */
  inputs: AgentInput[]
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
  /** The brief's `tags:` — the roster's groups (the first is the group). */
  tags: string[]
  /**
   * Who a fire runs for: the identity every run acts as, then the subscribers.
   * `names` is at most three; `count` is everyone.
   */
  runsFor: { names: string[]; count: number }
  /** What a running run is doing right now, one line; null when idle. */
  currentStep: string | null
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
  /** The agent's monthly cap. Nothing reports what it spent; the key's cap is the model note's `budget_monthly:`. */
  spend: { budgetMonthlyCents: number | null } | null
}

export interface SerializedRun extends Omit<RunListItem, 'startedAt' | 'endedAt' | 'costMicros'> {
  startedAt: string
  endedAt: string | null
}

export function serializeRun(run: RunListItem): SerializedRun {
  // costMicros stays behind: it is a BigInt JSON cannot carry, and nothing
  // reads a run's cost — the ledger exists for the budget cap, not to report.
  const { costMicros: _costMicros, ...rest } = run
  return {
    ...rest,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt ? run.endedAt.toISOString() : null,
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
    // A member's own plan needs no key here: whether it can run is the
    // desktop app's to say, on the page, for the person looking at it.
    if (localRuntimeOf(ref)) return { modelEffective: ref, modelNote: null, modelProblem: null }
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

/**
 * Which of the space's models would suit this agent better, from how each has
 * done on this space's runs and — with no record yet — how much the brief
 * asks of a model (one judge question, memoised per brief). Advice only.
 */
export async function modelAdviceFor(
  spaceId: string,
  agent: { current: string | null; fallback: string | null; body: string },
): Promise<ModelAdvice | null> {
  const [models, tracks] = await Promise.all([spaceModels(spaceId), spaceTrackRecords(spaceId)])
  const runnable = runnableModels(models).map((m) => m.ref).filter((r): r is string => !!r)
  if (runnable.length < 2 || !agent.current) return null
  const input = { current: agent.current, fallback: agent.fallback, runnable, tracks }
  const advice = recommendModel({ ...input, shape: null })
  // The brief's shape is asked of the judge only when it could change the
  // answer: a light model with no record to go on.
  if (advice || !isLightModel(agent.current)) return advice
  return recommendModel({ ...input, shape: await jobShapeOf(agent.body).catch(() => null) })
}

async function summarise(
  context: Context,
  name: string,
  path: string,
  briefContent: string,
  opts: { includeSpend: boolean; now: Date; heartbeatAt: Date | null; models: readonly SpaceModel[] },
): Promise<{ summary: AgentSummary; config: AgentConfig | null; composed: ComposedAgent }> {
  const spaceId = context.spaceId
  // The note's prose with the record's run keys laid over it (briefs.ts#composeAgent).
  const config = await agentConfigOf(spaceId, name)
  const composed = composeAgent(briefContent, config)
  const fm = composed.fm
  const parsedBrief = composed.brief
  const brief = parsedBrief.ok ? parsedBrief.brief : null

  // An agent from before the record may still keep its activation in a pre-merge activation.md.
  const parsedLive = config ? composed.activation : (await findAgentActivation(spaceId, name)).parsed
  const activation: AgentActivation | null = parsedLive?.ok ? parsedLive.activation : null

  const [state, last, briefRow, subs] = await Promise.all([
    prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } } }),
    latestRun(spaceId, name),
    prisma.contextNote.findFirst({
      where: { spaceId, ownerKey: 'shared', path, deletedAt: null },
      select: { createdBy: true },
    }),
    prisma.agentSubscription.findMany({ where: { spaceId, name }, orderBy: { createdAt: 'asc' }, select: { userId: true } }),
  ])
  const runAsUserId = activation?.runsAs ?? state?.runAsUserId ?? briefRow?.createdBy ?? null
  const others = subs.filter((s) => s.userId !== runAsUserId)
  const forIds = [runAsUserId, ...others.map((s) => s.userId)].filter((id): id is string => !!id)
  const people = forIds.length
    ? await prisma.user.findMany({ where: { id: { in: forIds.slice(0, 3) } }, select: { id: true, name: true } })
    : []
  const nameOfId = new Map(people.map((u) => [u.id, u.name]))
  const forNames = forIds.slice(0, 3).map((id) => nameOfId.get(id) ?? null).filter((n): n is string => !!n)
  const currentStep = state?.status === 'running' && state.currentRunId ? await currentStepOf(state.currentRunId) : null

  const tz = activation?.timezone ?? null
  const summary: AgentSummary = {
    name,
    path,
    title: brief?.title || (typeof fm.title === 'string' && fm.title) || name,
    description: brief?.description ?? (typeof fm.description === 'string' ? fm.description : null),
    model: brief?.model ?? (typeof fm.model === 'string' ? fm.model : null),
    connectors: brief?.connectors ?? [],
    inputs: brief?.inputs ?? [],
    tools: brief?.tools ?? [],
    invalid: parsedBrief.ok ? null : parsedBrief.error,
    authorUserId: briefRow?.createdBy ?? null,
    runAsUserId,
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
    tags: brief?.tags ?? [],
    runsFor: { names: forNames, count: forIds.length },
    currentStep,
    ...modelStateOf(brief, opts.models),
    rowState: 'off',
    spend: null,
  }
  summary.rowState = rowStateOf(summary, opts.now, opts.heartbeatAt)
  if (opts.includeSpend) {
    summary.spend = { budgetMonthlyCents: state?.budgetMonthlyCents ?? null }
  }
  return { summary, config, composed }
}

export interface AgentRoster {
  agents: AgentSummary[]
  heartbeatAt: string | null
}

/**
 * Every agent brief the principal can see — valid or broken, in `agents/`
 * or a folder of the space's own. One folder is one agent, so there is nothing to dedupe; a flat `agents/<name>.md` left
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
  // An agent under agents/ wins its name over one filed elsewhere — two such
  // briefs is a state the write gate refuses, so this is only the tie rule.
  const ordered = [...raws].sort((a, b) => Number(!a.path.startsWith('agents/')) - Number(!b.path.startsWith('agents/')))
  for (const raw of ordered) {
    const folder = briefFolderOf(raw.path, raw.content)
    const name = folder ? agentNameOfFolder(folder) : null
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
    briefs.map(async (b) => (await summarise(context, b.name, b.path, b.content, { includeSpend: !!opts.includeSpend, now, heartbeatAt, models })).summary),
  )
  return {
    agents: out.sort((a, b) => a.path.localeCompare(b.path)),
    heartbeatAt: heartbeatAt?.toISOString() ?? null,
  }
}

export interface AgentSubscriber {
  userId: string
  name: string | null
  image: string | null
  /** Their own time, zone and model, as the agent's record holds them. */
  at: string | null
  timezone: string | null
  model: string | null
  /** Their own values for the agent's inputs. */
  inputs: InputValues
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
  runAsImage: string | null
  /** The viewer IS that identity, so every fire already runs for them. */
  viewerIsRunAs: boolean
  /**
   * Everything between the brief and a working run for the viewer — the
   * model, the declared connectors, and any service the instructions name
   * that the brief never declared — each with its fix (shared/needs.ts).
   */
  needs: AgentNeeds
}

export async function describeAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: { includeSpend?: boolean } = {},
): Promise<
  | (AgentSummary & {
      brief: string
      /** `agents/<name>/memory.md` as the viewer may read it, or null. */
      memory: string | null
      heartbeatAt: string | null
      subscribers: AgentSubscriber[]
      viewerSubscribed: boolean
      readiness: AgentReadiness
      /** How it runs, as the record holds it — what the Config screen edits. */
      config: AgentConfig
      /** Who last changed how it runs, newest first. */
      configChanges: AgentConfigChangeRow[]
      /** A model of the space's that would suit it better, with the evidence — or null (shared/advice.ts). */
      modelAdvice: ModelAdvice | null
    })
  | null
> {
  if (!AGENT_NAME_RE.test(name)) return null
  const row = await findAgentBrief(context.spaceId, name)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return null
  const heartbeatAt = await lastHeartbeat()
  const { summary, config, composed } = await summarise(context, name, row.path, content, {
    includeSpend: !!opts.includeSpend,
    now: new Date(),
    heartbeatAt,
    models: await spaceModels(context.spaceId),
  })

  const runsFor = composed.brief.ok ? composed.brief.brief.runsFor : []
  const subRows = runsForColumns(runsFor).map((r, i) => ({ ...r, inputs: runsFor[i].inputs }))
  const runAsUserId = summary.runAsUserId
  const userIds = [...new Set([...subRows.map((s) => s.userId), ...(runAsUserId ? [runAsUserId] : [])])]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, image: true } })
    : []
  const nameOf = new Map(users.map((u) => [u.id, u.name]))
  const imageOf = new Map(users.map((u) => [u.id, u.image]))

  const viewer = await connectorReadiness(p, context, summary.connectors, p.userId)
  const runAs =
    runAsUserId && runAsUserId !== p.userId ? await connectorReadiness(p, context, summary.connectors, runAsUserId) : null

  const memory = await readVisible(p, context, memoryPath(agentFolderOfBrief(summary.path, name)))
  const held = await listConnectors(p, context)
  const viewerInputs = composed.brief.ok ? inputValuesFor(composed.brief.brief, p.userId, runAsUserId) : {}
  const needs = agentNeeds({
    declared: viewer,
    instructions: composed.body,
    modelProblem: summary.modelProblem,
    missingInputs: composed.brief.ok ? missingInputs(composed.brief.brief.inputs, viewerInputs) : [],
    catalog: needsCatalog(),
    spaceConnectors: held.map((c) => ({ name: c.name, recipe: c.recipe })),
  })

  return {
    ...summary,
    brief: content,
    memory,
    heartbeatAt: heartbeatAt?.toISOString() ?? null,
    subscribers: subRows.map((s) => ({ ...s, name: nameOf.get(s.userId) ?? null, image: imageOf.get(s.userId) ?? null })),
    viewerSubscribed: subRows.some((s) => s.userId === p.userId),
    config: config ?? (composed.brief.ok && composed.activation.ok ? configOf(composed.brief.brief, composed.activation.activation) : defaultAgentConfig()),
    configChanges: await listAgentConfigChanges(context.spaceId, name),
    modelAdvice: await modelAdviceFor(context.spaceId, {
      current: summary.modelEffective,
      fallback: composed.brief.ok ? composed.brief.brief.fallbackModel : null,
      body: composed.body,
    }).catch(() => null),
    readiness: {
      viewer,
      runAs,
      runAsUserId,
      runAsName: runAsUserId ? (nameOf.get(runAsUserId) ?? null) : null,
      runAsImage: runAsUserId ? (imageOf.get(runAsUserId) ?? null) : null,
      viewerIsRunAs: runAsUserId === p.userId,
      needs,
    },
  }
}

/** What a person may set for their own runs; all optional. */
export interface RunsForSettings {
  /** "HH:MM", their own time of day on a daily or weekly agent. */
  at?: string | null
  timezone?: string | null
  /** A model of the space's, or a `local/*` runtime. */
  model?: string | null
  /** Their own values for the agent's inputs. */
  inputs?: Record<string, string> | null
}

/**
 * Put your own name down: each fire of this agent then runs once FOR you, as
 * your principal, so a `mode: user` connector spends YOUR linked account —
 * at your own time and on your own model when you say so. The entry is
 * written into the agent's record (`agent_subscriptions`, shared/runsFor.ts).
 * Anyone who can READ the brief may add THEMSELVES — the
 * run reaches only what they can already reach, so there is nothing here to
 * approve — which is why the write is the platform's, not the reader's.
 */
export async function subscribeToAgent(p: ContextPrincipal, context: Context, name: string, settings: RunsForSettings = {}): Promise<ActivateResult> {
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  const row = await findOwnAgentBrief(context.spaceId, name)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return { ok: false, status: 404, error: 'No such agent.' }

  const parsed = parseRunsFor([
    { user: p.userId, at: settings.at ?? undefined, timezone: settings.timezone ?? undefined, model: settings.model ?? undefined, inputs: settings.inputs ?? undefined },
  ])
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  const [{ userId: _userId, ...entry }] = parsed.entries
  if (entry.model && !localRuntimeOf(entry.model)) {
    const runnable = runnableModels(await spaceModels(context.spaceId)).some((m) => m.ref === entry.model)
    if (!runnable) return { ok: false, status: 400, error: 'That model is not one of this space’s.' }
  }
  const saved = await withAgentRecord(context.spaceId, name, async (): Promise<ActivateResult> => {
    const current = await currentConfig(context.spaceId, name)
    if (!current.ok) return current
    const next = applyConfigPatch(current.config, { runsFor: withRunsFor(current.config.runsFor, p.userId, entry) })
    if (!next.ok) return { ok: false, status: 400, error: next.error }
    await storeAgentConfig(context.spaceId, name, next.config, { userId: p.userId })
    await syncAgentState(context.spaceId, name)
    return { ok: true, warning: null }
  })
  if (!saved.ok) return saved
  await logAudit(context.spaceId, { userId: p.userId, name: p.name, action: 'agent', path: row.path, detail: 'runs for them' })
  return { ok: true, warning: await runsForWarning(p, context, name) }
}

/**
 * What stands between a person on the list and a run that works for them —
 * inputs left empty, accounts not connected — said once, when they put their
 * name down, rather than by a failed run at 3am. Null when nothing does.
 */
async function runsForWarning(p: ContextPrincipal, context: Context, name: string): Promise<string | null> {
  const agent = await readAgent(context.spaceId, name)
  if (!agent?.brief.ok) return null
  const brief = agent.brief.brief
  const entry = brief.runsFor.find((e) => e.userId === p.userId)
  const unset = missingInputs(brief.inputs, entry?.inputs ?? {})
  const owed = brief.connectors.length ? signInsOwed(await connectorReadiness(p, context, brief.connectors, p.userId)) : null
  const parts = [unset.length ? `Set ${unset.map((i) => i.label).join(', ')}` : null, owed].filter(Boolean)
  return parts.length ? `Not ready to run for you yet: ${parts.join('; ')}.` : null
}

/** Take a name off the list: your own, or anyone's if you can edit the brief. */
export async function unsubscribeFromAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  userId: string,
): Promise<ActivateResult> {
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  if (userId !== p.userId && (await agentManageDenial(p, context, name))) {
    return { ok: false, status: 403, error: 'Only someone who can edit the agent can remove someone else.' }
  }
  await dropRunsFor(context.spaceId, name, userId, p.userId)
  return { ok: true, warning: null }
}

/** Take one person off who an agent runs for — theirs to ask, the platform's to write. */
export async function dropRunsFor(spaceId: string, name: string, userId: string, by: string | null = null): Promise<void> {
  await withAgentRecord(spaceId, name, async () => {
    const current = await currentConfig(spaceId, name)
    if (!current.ok || !current.config.runsFor.some((e) => e.userId === userId)) return
    const next = applyConfigPatch(current.config, { runsFor: withRunsFor(current.config.runsFor, userId, null) })
    if (!next.ok) return
    await storeAgentConfig(spaceId, name, next.config, { userId: by })
    await syncAgentState(spaceId, name)
  })
}

/**
 * The record as it stands, adopting a note written before it first. An agent
 * whose brief cannot be read has no record to change — its note says why.
 */
async function currentConfig(spaceId: string, name: string): Promise<{ ok: true; config: AgentConfig } | { ok: false; status: number; error: string }> {
  if (!(await findOwnAgentBrief(spaceId, name))) return { ok: false, status: 404, error: 'No such agent.' }
  await adoptNoteConfig(spaceId, name)
  const config = await agentConfigOf(spaceId, name)
  if (!config) return { ok: false, status: 400, error: 'The brief is invalid — fix its note first.' }
  return { ok: true, config }
}

export type ActivateResult =
  | { ok: true; warning: string | null }
  | { ok: false; status: number; error: string }

/**
 * May this principal turn the agent on or off, change its schedule or run it
 * now? Anyone who can EDIT its brief — a space admin, or a member whose grant
 * reaches the agent's folder — so the people who can write what an agent does are
 * the people who decide whether it runs. Money (setBudget) stays admin-only.
 */
async function agentManageDenial(p: ContextPrincipal, context: Context, name: string): Promise<string | null> {
  if (principalIsSuperAdmin(p)) return null
  const folder = (await agentFolderIn(context.spaceId, name)) ?? agentHomeFolder(name)
  return writeDenial(p, context, `${folder}/index.md`)
}

/**
 * THE write of how an agent runs. Each field keeps the gate it had when it
 * lived in the note:
 *   - everything: whoever can EDIT the brief (agentManageDenial);
 *   - `runsAs`: a space admin, or a member naming themselves;
 *   - `runsFor`: anyone may take a person out, but only that person (or an
 *     admin) puts them in or changes their entry (shared/runsFor.ts).
 * Budget is setBudget's, admin only. The patch is checked by the same parsers
 * a brief is, stored with who changed what, and the schedule re-derived.
 */
export async function configureAgent(
  p: ContextPrincipal,
  context: Context,
  name: string,
  patch: AgentConfigPatch,
): Promise<ActivateResult & { config?: AgentConfig }> {
  if (!AGENT_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad agent name.' }
  if (context.ownerKey !== SHARED_OWNER_KEY) return { ok: false, status: 400, error: 'Agents live in a space.' }
  const manage = await agentManageDenial(p, context, name)
  if (manage) return { ok: false, status: 403, error: manage }
  return withAgentRecord(context.spaceId, name, () => configureLocked(p, context, name, patch))
}

const sameValues = (a: InputValues, b: InputValues) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)

async function configureLocked(
  p: ContextPrincipal,
  context: Context,
  name: string,
  patch: AgentConfigPatch,
): Promise<ActivateResult & { config?: AgentConfig }> {
  const current = await currentConfig(context.spaceId, name)
  if (!current.ok) return current
  const admin = principalIsSuperAdmin(p)
  if (patch.runsAs !== undefined && patch.runsAs !== null && patch.runsAs !== p.userId && patch.runsAs !== current.config.runsAs && !admin) {
    return { ok: false, status: 403, error: 'Only a space admin can make an agent run as someone else. Leave it as its author, or name yourself.' }
  }
  // The agent's own values are where the identity it runs as posts and reads;
  // when that identity is someone else's, only an admin points them.
  const ownId = current.config.runsAs
  if (patch.inputValues !== undefined && ownId && ownId !== p.userId && !admin && !sameValues(patch.inputValues, current.config.inputValues)) {
    return { ok: false, status: 403, error: 'This agent runs as someone else — only a space admin can change its own inputs.' }
  }
  if (patch.runsFor !== undefined) {
    const denied = runsForDenial(current.config.runsFor, patch.runsFor, { userId: p.userId, isAdmin: admin })
    if (denied) return { ok: false, status: 403, error: denied }
  }
  const next = applyConfigPatch(current.config, patch)
  if (!next.ok) return { ok: false, status: 400, error: next.error }
  // A brief on a member's own plan runs only when that person presses Run in
  // the desktop app; switching it on would promise a schedule nothing can keep.
  const local = next.config.active ? localRuntimeOf(next.config.model) : null
  if (local) return { ok: false, status: 400, error: localRuntimeRefusal(local) }
  if (next.config.active && next.config.schedule && !next.config.timezone?.trim()) {
    return { ok: false, status: 400, error: 'A scheduled agent must name the timezone it runs in.' }
  }
  await storeAgentConfig(context.spaceId, name, next.config, { userId: p.userId })
  await syncAgentState(context.spaceId, name)
  return { ok: true, warning: null, config: next.config }
}

/**
 * Activation: validate the brief and the key (a 401/403 refuses; other
 * probe failures activate with a warning), switch the record on with its
 * schedule, and re-derive the state row. Anyone who can edit the brief may.
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
  const manage = await agentManageDenial(p, context, name)
  if (manage) return { ok: false, status: 403, error: manage }
  const row = await findAgentBrief(context.spaceId, name)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return { ok: false, status: 404, error: 'No such agent.' }
  const current = await currentConfig(context.spaceId, name)
  if (!current.ok) return current
  const composed = composeAgent(content, current.config)
  if (!composed.brief.ok) return { ok: false, status: 400, error: `The brief is invalid: ${composed.brief.error}` }
  const brief = composed.brief.brief

  const localRuntime = localRuntimeOf(brief.model)
  if (localRuntime) return { ok: false, status: 400, error: localRuntimeRefusal(localRuntime) }

  // A declared connector that is not there, is off or does not parse fails
  // every run whoever it acts as — so it is refused here, with the fix, rather
  // than found by the first fire. A sign-in is the runner's to do and is a
  // warning; a service the prose names is a reading of the prose, and the
  // page already says it.
  const runAsUserId = current.config.runsAs ?? p.userId
  const [declared, held] = await Promise.all([
    connectorReadiness(p, context, brief.connectors, runAsUserId),
    listConnectors(p, context),
  ])
  const needs = agentNeeds({
    declared,
    instructions: composed.body,
    modelProblem: null,
    catalog: needsCatalog(),
    spaceConnectors: held.map((c) => ({ name: c.name, recipe: c.recipe })),
  })
  const hard = hardNeeds(needs)
  if (hard.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Not turned on: ${hard.map((n) => `${n.why} ${n.fix}`).join(' ')}`,
    }
  }
  const unsigned = needs.needs.filter((n) => n.status === 'needs_connection' || n.status === 'broken')

  const resolved = await resolveAgentChatConfig(context.spaceId, modelFor(brief, p.userId))
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.message }
  const probe = await probeModelKey(resolved.config, resolved.ref.provider)
  if (!probe.ok && probe.kind === 'auth') return { ok: false, status: 400, error: probe.message }
  const warning = [probe.ok ? null : probe.message, ...unsigned.map((n) => `${n.why} ${n.fix}`)].filter(Boolean).join(' ') || null

  const written = await configureAgent(p, context, name, {
    active: true,
    schedule: input.schedule,
    on: input.on ?? null,
    debounceMs: input.debounceMs ?? current.config.debounceMs,
    timezone: input.timezone,
  })
  if (!written.ok) return written
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
  const manage = await agentManageDenial(p, context, name)
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
 * The note and the record are both checked before anything is saved, so
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
    tags?: string[]
    model?: string
    connectors?: string[]
    tools?: string[]
    agents?: string[]
    inputs?: AgentInput[]
    inputValues?: InputValues
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

  // Written where the space's agents land — `agents/`, or wherever it moved it.
  const path = `${await landingFolderOf(context, 'agents')}/${name}/index.md`
  const denial = await writeDenialFull(p, context, path)
  if (denial) return { ok: false, status: 403, error: denial }

  const content = newAgentNote({ name, title: input.title, description: input.description, tags: input.tags, body: input.body })
  // How it runs is the record's, checked before anything is written.
  const config = applyConfigPatch(defaultAgentConfig(), {
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.connectors ? { connectors: input.connectors } : {}),
    ...(input.tools ? { tools: input.tools as AgentConfig['tools'] } : {}),
    ...(input.agents ? { agents: input.agents } : {}),
    ...(input.inputs ? { inputs: input.inputs } : {}),
    ...(input.inputValues ? { inputValues: input.inputValues } : {}),
  })
  if (!config.ok) return { ok: false, status: 400, error: `That agent is not valid: ${config.error}` }
  const parsed = composeAgent(content, config.config).brief
  if (!parsed.ok) return { ok: false, status: 400, error: `That brief is not valid: ${parsed.error}` }

  const written = await writeGated(p, context, path, content)
  if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }
  await storeAgentConfig(context.spaceId, name, config.config, { userId: p.userId })
  await syncAgentState(context.spaceId, name)

  await logAudit(context.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'agent',
    path,
    detail: `brief created: ${parsed.brief.title}`,
  })
  return { ok: true, name, path, brief: parsed.brief }
}

/**
 * The values a manual run by `userId` would use, with what they gave at Run
 * laid over their own — or the inputs still empty, which the Run door asks for
 * rather than starting a run that can only fail.
 */
export async function manualRunInputs(
  spaceId: string,
  name: string,
  userId: string,
  given: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string; missing: AgentInput[] }> {
  const [agent, state] = await Promise.all([
    readAgent(spaceId, name),
    prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name } }, select: { runAsUserId: true } }),
  ])
  if (!agent?.brief.ok) return { ok: true }
  const brief = agent.brief.brief
  const values = { ...inputValuesFor(brief, userId, state?.runAsUserId ?? null), ...given }
  const bad = inputValuesDenial(brief.inputs, values)
  if (bad) return { ok: false, error: bad, missing: [] }
  const missing = missingInputs(brief.inputs, values)
  return missing.length ? { ok: false, error: `Set ${missing.map((i) => i.label).join(', ')} to run it.`, missing } : { ok: true }
}
