/**
 * What a person picking an agent's settings can choose from in this space:
 * the model providers (and whether the space holds a key for each), the
 * connectors a brief may declare, and the other agents it may chain into.
 * Read by the create surface and the agent page's settings form.
 *
 * Member-readable on purpose — a member authors briefs — so it carries names
 * and booleans only. Whether a key exists is already on every roster row
 * (`keyStored`); the key itself never leaves ConnectorSecret.
 */
import prisma from '@/lib/prisma'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { isConnectorEnabled } from '@/lib/connectors/config'
import { connectorKind } from '@/lib/connectors/model'
import { isAgentBriefPath, agentNameOfPath } from '@/lib/notes/entities'
import { DEFAULT_AGENT_MODEL, AGENT_TOOL_OPTIONS } from './config'
import { PROVIDERS, type ModelPricing } from './registry'

const SHARED_OWNER_KEY = 'shared'

export interface AgentOptions {
  providers: Array<{
    id: string
    label: string
    /** MODEL_KEY_<PROVIDER> is stored for this space. */
    keyStored: boolean
    /** `custom` needs a `provider: custom` model connector as well as a key. */
    endpointConfigured: boolean
    models: Array<{ id: string; label: string; pricing: ModelPricing | null }>
  }>
  connectors: Array<{ name: string; kind: 'http' | 'model'; enabled: boolean }>
  agents: string[]
  tools: typeof AGENT_TOOL_OPTIONS
  /** The model a new brief starts on: the first provider with a key, else the registry default. */
  defaultModel: string
}

export async function agentOptions(spaceId: string): Promise<AgentOptions> {
  const [secrets, notes] = await Promise.all([
    prisma.connectorSecret.findMany({ where: { spaceId }, select: { name: true } }),
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
  const stored = new Set(secrets.map((s) => s.name))

  const connectors: AgentOptions['connectors'] = []
  const agents: string[] = []
  let customEndpoint = false
  for (const row of notes) {
    if (row.path.startsWith('connectors/')) {
      const fm = parseFrontmatter(row.content)
      if (fm.type !== 'connector') continue
      const kind = connectorKind(fm)
      const enabled = isConnectorEnabled(fm)
      if (kind === 'model' && enabled && typeof fm.provider === 'string' && fm.provider.trim().toLowerCase() === 'custom') customEndpoint = true
      connectors.push({ name: row.path.slice('connectors/'.length, -'.md'.length), kind, enabled })
    } else if (isAgentBriefPath(row.path)) {
      const name = agentNameOfPath(row.path)
      if (name && !agents.includes(name)) agents.push(name)
    }
  }

  const providers = PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    keyStored: stored.has(p.keySecret),
    endpointConfigured: p.baseURL !== null || customEndpoint,
    models: p.models.map((m) => ({ id: m.id, label: m.label, pricing: m.pricing })),
  }))
  const ready = providers.find((p) => p.keyStored && p.endpointConfigured && p.models.length > 0)
  return {
    providers,
    connectors,
    agents: agents.sort(),
    tools: AGENT_TOOL_OPTIONS,
    defaultModel: ready ? `${ready.id}/${ready.models[0].id}` : DEFAULT_AGENT_MODEL,
  }
}
