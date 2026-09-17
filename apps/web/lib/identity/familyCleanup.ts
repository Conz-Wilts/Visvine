/**
 * Apply the family cleanup (family.ts#planFamilyCleanup) to the database:
 * every person node gets an identity, and one person held under several
 * identities across a house and its rooms becomes one. Idempotent — a second
 * run plans nothing. The seed runs it, and so does `db:identity:family`.
 */

import prisma from '@/lib/prisma'
import { GLOBAL_SPACE_ID } from '@/lib/spaces/shared/global'
import { attachIdentity } from './attachIdentity'
import { confirmIdentity } from './resolve'
import { planFamilyCleanup, type CleanupIdentity, type CleanupNode, type CleanupStep } from './family'

export interface FamilyCleanupResult {
  attached: number
  merged: number
  resolved: number
  identitiesDropped: number
  skipped: Array<{ space: string; name: string; reason: string }>
}

const PERSON_TYPES = ['person', 'Person', 'people', 'People']

export async function cleanupFamilyIdentities(opts: { dryRun?: boolean } = {}): Promise<FamilyCleanupResult & { plan: CleanupStep[] }> {
  const result: FamilyCleanupResult = { attached: 0, merged: 0, resolved: 0, identitiesDropped: 0, skipped: [] }
  const plan: CleanupStep[] = []

  const spaces = await prisma.space.findMany({ where: { id: { not: GLOBAL_SPACE_ID } }, select: { id: true, parentId: true } })
  const houses = spaces.filter((s) => !s.parentId)
  const known = new Set(spaces.map((s) => s.id))

  for (const house of houses) {
    const family = [house.id, ...spaces.filter((s) => s.parentId === house.id).map((s) => s.id)]
    const rows = await prisma.node.findMany({
      where: { spaceId: { in: family }, type: { in: PERSON_TYPES } },
      select: { id: true, spaceId: true, name: true, identityId: true },
    })
    if (rows.length === 0) continue
    const nodes: CleanupNode[] = rows.map((r) => ({ id: r.id, spaceId: r.spaceId as string, name: r.name, identityId: r.identityId }))

    const identityIds = [...new Set(nodes.map((n) => n.identityId).filter((x): x is string => !!x))]
    const [identityRows, globalRows, splitRows] = await Promise.all([
      prisma.identity.findMany({
        where: { id: { in: identityIds } },
        select: { id: true, userId: true, email: true, linkedinHandle: true },
      }),
      prisma.node.findMany({ where: { spaceId: GLOBAL_SPACE_ID, identityId: { in: identityIds } }, select: { identityId: true } }),
      prisma.identityResolution.findMany({
        where: { nodeId: { in: nodes.map((n) => n.id) }, decision: { in: ['rejected', 'split'] } },
        select: { nodeId: true, identityId: true },
      }),
    ])
    const global = new Set(globalRows.map((g) => g.identityId))
    const identities = new Map<string, CleanupIdentity>(
      identityRows.map((i) => [i.id, {
        id: i.id,
        claimed: Boolean(i.userId),
        email: i.email,
        linkedinHandle: i.linkedinHandle,
        global: global.has(i.id),
      }]),
    )
    const splits = new Map<string, Set<string>>()
    for (const s of splitRows) {
      if (!s.identityId) continue
      splits.set(s.nodeId, new Set([...(splits.get(s.nodeId) ?? []), s.identityId]))
    }

    const { steps, skipped } = planFamilyCleanup({ houseId: house.id, nodes, identities, splits })
    plan.push(...steps)
    result.skipped.push(...skipped.map((s) => ({ space: house.id, ...s })))
    if (opts.dryRun) continue

    for (const step of steps) {
      if (step.kind === 'attach') {
        await setIdentity(step.nodeId, step.identityId, 'family cleanup: same person in this space family')
        result.attached++
      } else if (step.kind === 'merge') {
        for (const nodeId of step.nodeIds) {
          await prisma.node.update({ where: { id: nodeId }, data: { identityId: step.to } })
          await prisma.identityResolution.create({
            data: { nodeId, identityId: step.to, decision: 'merged', confidence: 1, reason: 'family cleanup: one person across the space family' },
          })
        }
        const left = await prisma.identity.findUnique({ where: { id: step.from }, select: { userId: true, _count: { select: { nodes: true } } } })
        if (left && !left.userId && left._count.nodes === 0) {
          await prisma.identity.delete({ where: { id: step.from } })
          result.identitiesDropped++
        }
        result.merged++
      } else {
        const node = await prisma.node.findUnique({
          where: { id: step.nodeId },
          select: { id: true, type: true, name: true, url: true, location: true, metadata: true, spaceId: true, identityId: true },
        })
        if (!node || node.identityId || !known.has(node.spaceId ?? '')) continue
        const { identityId } = await attachIdentity({
          id: node.id,
          type: node.type,
          name: node.name,
          url: node.url,
          location: node.location,
          metadata: (node.metadata as Record<string, unknown>) ?? {},
          space_id: node.spaceId,
        })
        if (!identityId) continue
        await prisma.node.update({ where: { id: node.id }, data: { identityId } })
        result.resolved++
        for (const follower of step.followers) {
          await setIdentity(follower, identityId, 'family cleanup: same person in this space family')
          result.attached++
        }
      }
    }
  }
  return { ...result, plan }
}

async function setIdentity(nodeId: string, identityId: string, reason: string): Promise<void> {
  await prisma.node.update({ where: { id: nodeId }, data: { identityId } })
  await confirmIdentity(nodeId, identityId, { reason })
}
