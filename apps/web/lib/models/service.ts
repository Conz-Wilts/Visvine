/**
 * Models — the database half of lib/models: what one model's page shows
 * beyond its note. The note says which provider and which model id; this is
 * whether the key behind it is stored, what running on it cost, and who ran.
 *
 * Spend is keyed the way the ledger keys it — `<provider>/<modelId>` on
 * agent_model_usage and agent_runs — and a model note stands for its PROVIDER
 * (one key per provider per space, lib/models/config.ts), so a page's bill is
 * everything under `<provider>/`, broken out by the model ids actually run.
 * A brief that pins `anthropic/claude-haiku-4-5` in a space whose note names
 * Sonnet still spends Anthropic's key, and the page says so.
 *
 * The history is the run rows — pruned at 90 days / 100 per agent
 * (lib/agents/runs.ts), which is why the month totals come from the durable
 * ledger and the who-ran-what list is "recent". Names are looked up for the
 * page; the ids stay on the row for deleteAccount to clear.
 */
import prisma from '@/lib/prisma'
import { readVisible } from '@/lib/notes/contextService'
import type { Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { isConnectorEnabled } from '@/lib/connectors/config'
import { isLegacyModelConnector, isModelNote, modelInfo, modelPath, parseModel, type ModelInfo } from './config'

const HISTORY_LIMIT = 60

export interface ModelDetail {
  name: string
  /** `models/<name>.md`, or the legacy `connectors/<name>.md` until it is moved. */
  path: string
  title: string | null
  recipe: string | null
  description: string | null
  /** `enabled: false` in the note — held in reserve; nothing runs on it. */
  enabled: boolean
  /** Why the frontmatter does not parse, or null. */
  invalid: string | null
  /** The provider facts, when the note parses. Never the key. */
  info: ModelInfo | null
  key: { name: string; set: boolean; updatedAt: string | null } | null
  /** Still at `connectors/<name>.md` — `db:models:migrate` has not run here. */
  legacy: boolean
}

/**
 * One model, by name, through the caller's visibility lens: `models/<name>.md`
 * first, then the legacy connectors path. Null when neither exists (or
 * neither is visible — indistinguishable, as readVisible has it).
 */
export async function describeModel(p: ContextPrincipal, context: Context, name: string): Promise<ModelDetail | null> {
  let path = modelPath(name)
  let content = await readVisible(p, context, path)
  let legacy = false
  if (content === null) {
    path = `connectors/${name}.md`
    content = await readVisible(p, context, path)
    legacy = true
    if (content === null) return null
  }
  const fm = parseFrontmatter(content)
  if (legacy ? !isLegacyModelConnector(fm) : !isModelNote(fm)) return null
  const parsed = parseModel(fm)
  const info = parsed.ok ? modelInfo(parsed.config) : null
  const stored = info
    ? await prisma.connectorSecret.findUnique({
        where: { secret_identity: { spaceId: context.spaceId, name: info.keySecret } },
        select: { updatedAt: true },
      })
    : null
  const body = splitFrontmatter(content).body.trim()
  return {
    name,
    path,
    title: typeof fm.title === 'string' ? fm.title : null,
    recipe: typeof fm.recipe === 'string' ? fm.recipe.trim().toLowerCase() : null,
    description: typeof fm.description === 'string' ? fm.description : body.split('\n')[0] || null,
    enabled: isConnectorEnabled(fm),
    invalid: parsed.ok ? null : parsed.error,
    info,
    key: info ? { name: info.keySecret, set: stored !== null, updatedAt: stored?.updatedAt.toISOString() ?? null } : null,
    legacy,
  }
}

/** One recent run on the provider's key, with the people behind it named. */
export interface ModelRunRow {
  id: string
  agent: string
  trigger: string
  status: string
  startedAt: string
  endedAt: string | null
  /** `<provider>/<modelId>` the run actually used. */
  model: string
  promptTokens: number
  completionTokens: number
  terminalReason: string | null
  /** Whose principal the run acted as — the subscriber a fan-out run served, or the author. */
  ranFor: { id: string; name: string } | null
  /** Who pressed Run, for a manual run. */
  startedBy: { id: string; name: string } | null
}

/** A person's share of the recent runs — the "who has used this" line. */
export interface ModelUserLine {
  user: { id: string; name: string }
  runs: number
  promptTokens: number
  completionTokens: number
  lastAt: string
}

/**
 * The recent runs on this provider's key, newest first, and the same runs
 * folded per person. A run is attributed to whoever it ran FOR (its principal)
 * — that is whose linked accounts and whose name a run carries — falling
 * back to who started it, then to the agent alone.
 */
export async function modelHistory(spaceId: string, provider: string): Promise<{ runs: ModelRunRow[]; users: ModelUserLine[] }> {
  const rows = await prisma.agentRun.findMany({
    where: { spaceId, model: { startsWith: `${provider}/` } },
    orderBy: { startedAt: 'desc' },
    take: HISTORY_LIMIT,
    select: {
      id: true, name: true, trigger: true, status: true, startedAt: true, endedAt: true, startedBy: true,
      runAsUserId: true, model: true, promptTokens: true, completionTokens: true, terminalReason: true,
    },
  })
  const ids = new Set<string>()
  for (const r of rows) {
    if (r.runAsUserId) ids.add(r.runAsUserId)
    if (r.startedBy) ids.add(r.startedBy)
  }
  const people = ids.size
    ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(people.map((u) => [u.id, u.name]))
  const person = (id: string | null) => (id ? { id, name: nameOf.get(id) ?? 'Former member' } : null)

  const runs: ModelRunRow[] = rows.map((r) => ({
    id: r.id,
    agent: r.name,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    model: r.model ?? `${provider}/`,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    terminalReason: r.terminalReason,
    ranFor: person(r.runAsUserId),
    startedBy: person(r.startedBy),
  }))

  const byUser = new Map<string, ModelUserLine>()
  for (const run of runs) {
    const who = run.ranFor ?? run.startedBy
    if (!who) continue
    const line = byUser.get(who.id) ?? { user: who, runs: 0, promptTokens: 0, completionTokens: 0, lastAt: run.startedAt }
    line.runs += 1
    line.promptTokens += run.promptTokens
    line.completionTokens += run.completionTokens

    if (run.startedAt > line.lastAt) line.lastAt = run.startedAt
    byUser.set(who.id, line)
  }
  const users = [...byUser.values()].sort(
    (a, b) =>
      b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens) ||
      b.runs - a.runs ||
      a.user.name.localeCompare(b.user.name),
  )
  return { runs, users }
}
