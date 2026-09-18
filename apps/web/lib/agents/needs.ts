/**
 * What an agent needs, read from the space. The judgement is
 * `shared/needs.ts#agentNeeds` (pure); this gathers its inputs — the declared
 * connectors' readiness for ONE person, the connectors the space holds, and
 * the catalogue with how each service connects on this deployment.
 */
import { agentNeeds, type AgentNeeds, type NeedsCatalogEntry } from '@/lib/agents/shared/needs'
import { connectorReadiness, listConnectors } from '@/lib/connectors/service'
import { CONNECTOR_CATALOG, catalogConnectStyle } from '@/lib/connectors/catalog'
import { availablePlatformClients } from '@/lib/connectors/platformClients'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { decide } from '@/lib/judge/client'
import { noulOf } from '@/lib/judge/shared/types'
import { IMPLIED_SERVICE_AT, impliedServiceQuestion } from '@/lib/judge/shared/questions'

/** Catalogue rows that are a shape, not a service a brief could be asking for. */
const GENERIC_IDS = new Set(['mcp', 'mcp-server', 'website-login', 'http', 'custom'])

export function needsCatalog(platformClients: readonly string[] = availablePlatformClients()): NeedsCatalogEntry[] {
  return CONNECTOR_CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    connects: catalogConnectStyle(e, platformClients),
    perMember: e.oauth?.mode === 'user',
  }))
}

/** Catalogue services the instructions imply without naming. Empty on no verdict. */
async function impliedServices(instructions: string): Promise<string[]> {
  const text = instructions.trim()
  if (text.length < 40) return []
  const entries = CONNECTOR_CATALOG.filter((e) => !GENERIC_IDS.has(e.id))
  const answers = await decide(
    text.slice(0, 4_000),
    Object.fromEntries(entries.map((e, i) => [`s${i}`, impliedServiceQuestion(e.name, e.description ?? e.name)])),
    { deadlineMs: 2_500 },
  )
  return entries.filter((_, i) => (noulOf(answers, `s${i}`) ?? 0) >= IMPLIED_SERVICE_AT).map((e) => e.id)
}

export async function agentNeedsFor(
  p: ContextPrincipal,
  context: Context,
  input: { connectors: readonly string[]; instructions: string; modelProblem: string | null; forUserId?: string },
): Promise<AgentNeeds> {
  const [declared, held, implied] = await Promise.all([
    connectorReadiness(p, context, input.connectors, input.forUserId ?? p.userId),
    listConnectors(p, context),
    impliedServices(input.instructions).catch(() => []),
  ])
  return agentNeeds({
    declared,
    instructions: input.instructions,
    modelProblem: input.modelProblem,
    catalog: needsCatalog(),
    spaceConnectors: held.map((c) => ({ name: c.name, recipe: c.recipe })),
    implied,
  })
}
