/**
 * What a plan knows about the space it targets.
 *
 * Gathered best-effort. A plan that names the caller's role and what the space
 * already has is far more useful than a generic one, but a plan is advice, so
 * nothing here is allowed to fail the call: each probe that throws (no
 * membership, a feature switched off, a space id that does not resolve) simply
 * narrows the plan.
 */
import prisma from '@/lib/prisma'
import { resolveTarget } from '@/lib/actions/resolve'
import { listConnectors } from '@/lib/connectors/service'
import { listAgents } from '@/lib/agents/service'
import { planFeatures, type PlanSpaceFacts } from '@/lib/actions/recipes'
import type { ActionCaller } from '@/lib/actions/types'
import type { SpaceFeatureConfig } from '@/lib/types'

export async function spaceFactsFor(
  caller: ActionCaller,
  spaceId: string | undefined,
): Promise<PlanSpaceFacts | null> {
  if (!spaceId) return null
  try {
    const { principal, context } = await resolveTarget(caller, spaceId)
    const row = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { name: true, featureConfig: true },
    })
    const [connectors, agents] = await Promise.all([
      listConnectors(principal, context, { personal: true }).catch(() => []),
      listAgents(principal, context)
        .then((r) => r.agents)
        .catch(() => []),
    ])
    return {
      id: spaceId,
      name: row?.name ?? spaceId,
      you_are_admin: principal.spaceAdmin === true,
      features: planFeatures((row?.featureConfig ?? null) as SpaceFeatureConfig | null),
      connectors: connectors.map((c) => c.name),
      agents: agents.map((a) => a.name),
    }
  } catch {
    // An unresolvable or unauthorized space just means a generic plan; the
    // action the plan names will report the real error itself.
    return null
  }
}
