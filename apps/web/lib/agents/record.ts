/**
 * The one write of an agent's record — how it runs — into `agent_state` and
 * `agent_subscriptions`, with the change it made kept in
 * `agent_config_changes`. Ungated: callers (service.ts#configureAgent, the
 * store hook adopting an older note) have already decided it may happen.
 * Re-deriving the schedule afterwards is the caller's (hooks.ts#syncAgentState).
 */
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { agentConfigOf } from './briefs'
import { configColumns, configDiff, defaultAgentConfig, runsForColumns, type AgentConfig } from './shared/agentConfig'

const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue))

/**
 * Run `fn` holding this agent's record: one change at a time, so two people
 * saving at once each land on the other's result rather than over it. A
 * Postgres advisory lock held by a transaction for as long as `fn` runs — it
 * spans instances, which a lock in memory would not. Never nest it for the
 * same agent: `fn` runs on other connections, so a nested take would wait on
 * itself.
 */
export async function withAgentRecord<T>(spaceId: string, name: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-record:${spaceId}:${name}`}))`
      return fn()
    },
    { timeout: 30_000, maxWait: 10_000 },
  )
}

export async function storeAgentConfig(
  spaceId: string,
  name: string,
  config: AgentConfig,
  by: { userId: string | null; briefNoteId?: string | null },
): Promise<void> {
  const before = (await agentConfigOf(spaceId, name)) ?? defaultAgentConfig()
  const cols = configColumns(config)
  const data = {
    ...cols,
    schedule: json(cols.schedule),
    triggersJson: json(cols.triggersJson),
    configuredAt: new Date(),
    updatedBy: by.userId,
  }
  const subs = runsForColumns(config.runsFor)
  const diff = configDiff(before, config)
  await prisma.$transaction([
    prisma.agentState.upsert({
      where: { agent_identity: { spaceId, name } },
      create: { spaceId, name, ...data, ...(by.briefNoteId ? { briefNoteId: by.briefNoteId } : {}) },
      update: data,
    }),
    prisma.agentSubscription.deleteMany({ where: { spaceId, name, userId: { notIn: subs.map((s) => s.userId) } } }),
    ...subs.map((s) =>
      prisma.agentSubscription.upsert({
        where: { agent_subscription_identity: { spaceId, name, userId: s.userId } },
        create: { spaceId, name, ...s },
        update: { at: s.at, timezone: s.timezone, model: s.model },
      }),
    ),
    ...(Object.keys(diff).length
      ? [prisma.agentConfigChange.create({ data: { spaceId, name, userId: by.userId, patch: diff as Prisma.InputJsonValue } })]
      : []),
  ])
}

export interface AgentConfigChangeRow {
  userId: string | null
  patch: Partial<AgentConfig>
  at: string
}

/** The latest changes to how an agent runs, newest first. */
export async function listAgentConfigChanges(spaceId: string, name: string, take = 20): Promise<AgentConfigChangeRow[]> {
  const rows = await prisma.agentConfigChange.findMany({ where: { spaceId, name }, orderBy: { at: 'desc' }, take })
  return rows.map((r) => ({ userId: r.userId, patch: r.patch as Partial<AgentConfig>, at: r.at.toISOString() }))
}
