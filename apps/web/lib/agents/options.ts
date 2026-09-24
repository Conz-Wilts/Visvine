/**
 * What a person picking an agent's settings can choose from in this space: the
 * MODELS it has, the connectors a brief may declare, and the other agents it
 * may chain into. Read by the create surface and the agent page's settings
 * form.
 *
 * The models are the space's own model NOTES, not the provider registry. That
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
import { connectorNoteRows } from '@/lib/connectors/locate'
import { accountNotesIn } from '@/lib/connectors/accounts'
import { isAgentBriefPath, agentNameOfPath } from '@/lib/notes/entities'
import { AGENT_TOOL_OPTIONS } from './config'
import { defaultModelOf, noModelReason, spaceModels } from './spaceModels'
import { parentOfSubspace } from '@/lib/spaces/subspaceAccess'
import { isSharedDown } from '@/lib/spaces/subspaces'
import { withAgentShares } from './briefs'
import type { ModelPricing } from './registry'

const SHARED_OWNER_KEY = 'shared'

export interface AgentOptions {
  /**
   * The models this space actually has — one per note under `models/`, in
   * note order. The broken ones are here too, carrying why: a picker that
   * hides them leaves an admin wondering where the model went.
   */
  models: Array<{
    /** `<provider>/<id>` — what a brief's `model:` would say. Null when it names none. */
    ref: string | null
    label: string
    providerLabel: string
    /** The note it comes from: `models/<name>.md`. */
    name: string
    /** Why it cannot run, or null. */
    problem: string | null
    pricing: ModelPricing | null
  }>
  /**
   * The one a brief that names no model runs on — the first that works. Null
   * when the space has none, and then `noModels` says what to do about it.
   */
  spaceModel: { ref: string; label: string; name: string } | null
  /** Why there is nothing to run on, or null. Already phrased for the reader. */
  noModels: string | null
  connectors: Array<{ name: string; enabled: boolean }>
  agents: string[]
  /**
   * The parent space's agents shared with this sub-space (`share:
   * subspaces`), which a brief here may name in `agents:` and start with
   * run_agent — listed after the space's own, each saying where it is from.
   * Empty for a top-level space.
   */
  sharedAgents: Array<{ name: string; from: string; mode: 'use' | 'run-in' }>
  tools: typeof AGENT_TOOL_OPTIONS
}

export async function agentOptions(spaceId: string, viewerId: string): Promise<AgentOptions> {
  const [models, connectorNotes, notes, sharedAgents] = await Promise.all([
    spaceModels(spaceId),
    // Wherever the space filed them (lib/connectors/locate.ts).
    connectorNoteRows({ spaceId, ownerKey: SHARED_OWNER_KEY }),
    prisma.contextNote.findMany({
      where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'agents/', endsWith: '.md' } },
      select: { path: true },
      orderBy: { path: 'asc' },
    }),
    sharedParentAgents(spaceId),
  ])

  const connectors: AgentOptions['connectors'] = connectorNotes.map((row) => ({
    name: row.name,
    enabled: isConnectorEnabled(parseFrontmatter(row.content)),
  }))
  // The viewer's own accounts that are on here (lib/connectors/accounts.ts): a
  // brief may declare one, and each person it runs for spends their own. The
  // space's own note wins the name.
  for (const mine of await accountNotesIn(viewerId, spaceId)) {
    if (!connectors.some((c) => c.name === mine.name)) connectors.push({ name: mine.name, enabled: true })
  }
  const agents: string[] = []
  for (const row of notes) {
    if (isAgentBriefPath(row.path)) {
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
      name: m.name,
      problem: m.problem,
      pricing: (m.modelId ? m.pricing[m.modelId] : null) ?? null,
    })),
    spaceModel:
      fallback && fallback.ref
        ? { ref: fallback.ref, label: fallback.modelId ?? fallback.ref, name: fallback.name }
        : null,
    noModels: noModelReason(models),
    connectors,
    agents: agents.sort(),
    sharedAgents,
    tools: AGENT_TOOL_OPTIONS,
  }
}

async function sharedParentAgents(spaceId: string): Promise<AgentOptions['sharedAgents']> {
  const parent = await parentOfSubspace(spaceId)
  if (!parent) return []
  const rows = await prisma.contextNote.findMany({
    where: { spaceId: parent.id, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'agents/', endsWith: '.md' } },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  const out: AgentOptions['sharedAgents'] = []
  const fmOf = await withAgentShares(parent.id)
  for (const row of rows) {
    const fm = fmOf(row.path, parseFrontmatter(row.content))
    // Per room: a brief shared with other rooms is not offered here.
    if (!isAgentBriefPath(row.path) || !isSharedDown(row.path, fm, spaceId)) continue
    const name = agentNameOfPath(row.path)
    const mode = typeof fm.share_as === 'string' && /^run[-_]?in$/i.test(fm.share_as.trim()) ? 'run-in' : 'use'
    if (name && !out.some((a) => a.name === name)) out.push({ name, from: parent.name, mode })
  }
  return out
}
