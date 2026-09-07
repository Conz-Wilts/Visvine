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

export function needsCatalog(platformClients: readonly string[] = availablePlatformClients()): NeedsCatalogEntry[] {
  return CONNECTOR_CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    connects: catalogConnectStyle(e, platformClients),
    perMember: e.oauth?.mode === 'user',
  }))
}

export async function agentNeedsFor(
  p: ContextPrincipal,
  context: Context,
  input: { connectors: readonly string[]; instructions: string; modelProblem: string | null; forUserId?: string },
): Promise<AgentNeeds> {
  const [declared, held] = await Promise.all([
    connectorReadiness(p, context, input.connectors, input.forUserId ?? p.userId),
    listConnectors(p, context),
  ])
  return agentNeeds({
    declared,
    instructions: input.instructions,
    modelProblem: input.modelProblem,
    catalog: needsCatalog(),
    spaceConnectors: held.map((c) => ({ name: c.name, recipe: c.recipe })),
  })
}
