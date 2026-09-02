/**
 * What a person picking an agent's settings can choose from in this space: the
 * MODELS it has, the connectors a brief may declare, and the other agents it
 * may chain into. Read by the create surface and the agent page's settings
 * form.
 *
 * The models are the space's model CONNECTORS, not the provider registry. That
 * is the difference between "which models could exist" and "which models we
 * have", and offering the first is what produced briefs pointing at a provider
 * nobody had signed up for. A space with none offers none, and the surface
 * says to go and add one.
 *
 * Member-readable on purpose — a member authors briefs — so it carries names
 * and booleans only. The key itself never leaves ConnectorSecret.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { isConnectorEnabled } from '@/lib/connectors/config'
import { connectorKind } from '@/lib/connectors/model'
import { isAgentBriefPath, agentNameOfPath } from '@/lib/notes/entities'
import { AGENT_TOOL_OPTIONS } from './config'
import { defaultModelOf, noModelReason, spaceModels } from './spaceModels'
import type { ModelPricing } from './registry'

const SHARED_OWNER_KEY = 'shared'

export interface AgentOptions {
  /**
   * The models this space actually has — one per `kind: model` connector, in
   * note order. The broken ones are here too, carrying why: a picker that
   * hides them leaves an admin wondering where the connector went.
   */
  models: Array<{
    /** `<provider>/<id>` — what a brief's `model:` would say. Null when it names none. */
    ref: string | null
    label: string
    providerLabel: string
    /** The note it comes from: `connectors/<connector>.md`. */
    connector: string
    /** Why it cannot run, or null. */
    problem: string | null
    pricing: ModelPricing | null
  }>
  /**
   * The one a brief that names no model runs on — the first that works. Null
   * when the space has none, and then `noModels` says what to do about it.
   */
  spaceModel: { ref: string; label: string; connector: string } | null
  /** Why there is nothing to run on, or null. Already phrased for the reader. */
  noModels: string | null
  connectors: Array<{ name: string; kind: 'http' | 'model'; enabled: boolean }>
  agents: string[]
  tools: typeof AGENT_TOOL_OPTIONS
}

export async function agentOptions(spaceId: string): Promise<AgentOptions> {
  const [models, notes] = await Promise.all([
    spaceModels(spaceId),
    prisma.contextNote.findMany({
      where: {
        spaceId,
        ownerKey: SHARED_OWNER_KEY,
        deletedAt: null,
        OR: [{ path: { startsWith: 'connectors/', endsWith: '.md' } }, { path: { startsWith: 'agents/', endsWith: '.md' } }],
      },
      select: { path: true, content: true },
      orderBy: { path: 'asc' },
    }),
  ])

  const connectors: AgentOptions['connectors'] = []
  const agents: string[] = []
  for (const row of notes) {
    if (row.path.startsWith('connectors/')) {
      const fm = parseFrontmatter(row.content)
      if (fm.type !== 'connector') continue
      connectors.push({
        name: row.path.slice('connectors/'.length, -'.md'.length),
        kind: connectorKind(fm),
        enabled: isConnectorEnabled(fm),
      })
    } else if (isAgentBriefPath(row.path)) {
      const name = agentNameOfPath(row.path)
      if (name && !agents.includes(name)) agents.push(name)
    }
  }

  const fallback = defaultModelOf(models)
  return {
    models: models.map((m) => ({
      ref: m.ref,
      label: m.modelId ?? 'no model named',
      providerLabel: m.provider.label,
      connector: m.connector,
      problem: m.problem,
      pricing: (m.modelId ? m.pricing[m.modelId] : null) ?? null,
    })),
    spaceModel:
      fallback && fallback.ref
        ? { ref: fallback.ref, label: fallback.modelId ?? fallback.ref, connector: fallback.connector }
        : null,
    noModels: noModelReason(models),
    connectors,
    agents: agents.sort(),
    tools: AGENT_TOOL_OPTIONS,
  }
}
