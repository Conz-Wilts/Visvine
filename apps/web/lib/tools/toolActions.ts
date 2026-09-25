/**
 * The lookups behind `actions.run`'s third rule: each argument that names a
 * thing is in the install's space, and a file is inside what the Tool may
 * read. The allowlist and the other three rules are ./actionAllowlist.ts.
 */
import prisma from '@/lib/prisma'
import { getEvent } from '@/lib/eventRepo'
import { entityNotePath } from '@/lib/notes/entities'
import { refuseResourceRead } from '@visvine/tool-protocol/reach'
import type { ToolReach } from '@visvine/tool-protocol/bindings'
import type { TenantThing } from './actionAllowlist'

/**
 * Why an argument may not name this thing: it is not in the install's space,
 * or — a file — it sits outside what the Tool may read. Null when it may. A
 * thing in another space reads as absent, as every other door answers it.
 */
export async function tenantArgDenial(
  thing: TenantThing,
  value: string,
  spaceId: string,
  reach: ToolReach,
): Promise<{ code: 'perimeter' | 'not_found'; message: string } | null> {
  switch (thing) {
    case 'event':
      return (await getEvent(spaceId, value)) ? null : { code: 'not_found', message: `No event ${value} here.` }
    case 'channel': {
      const channel = await prisma.conversation.findUnique({ where: { id: value }, select: { spaceId: true } })
      return channel?.spaceId === spaceId ? null : { code: 'not_found', message: 'No such channel here.' }
    }
    case 'resource': {
      const resource = await prisma.resource.findUnique({
        where: { id: value },
        select: { spaceId: true, node: { select: { id: true, type: true, name: true, alias: true, metadata: true } } },
      })
      if (!resource || resource.spaceId !== spaceId) return { code: 'not_found', message: 'No such file here.' }
      const notePath = resource.node
        ? entityNotePath({ ...resource.node, metadata: resource.node.metadata as Record<string, unknown> | null })
        : null
      const refusal = refuseResourceRead(reach, notePath)
      return refusal ? { code: 'perimeter', message: refusal } : null
    }
  }
}
