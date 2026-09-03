/**
 * Creating and editing an event, in one place.
 *
 * There are two front doors to the same record — the composer's POST/PATCH and
 * the MCP tools an agent calls — and they must land identically: the same id
 * derivation, the same creator-becomes-a-host rule, the same defaults for
 * waitlisting and the guest list. Route handlers are thin here (AGENTS.md), so
 * that shared middle lives in this module rather than being written twice and
 * drifting once.
 *
 * The build/merge halves are lib/events/build.ts — pure, and tested there.
 */
import prisma from '@/lib/prisma'
import { upsertEvent } from '@/lib/eventRepo'
import { buildNewEvent, mergeEventUpdate, type EventAuthor } from '@/lib/events/build'
import { upsertLink } from '@/lib/notes/context/links'
import type { EventCreateInput, EventUpdateInput } from '@/lib/schemas/eventSchemas'
import type { NBEvent } from '@/lib/types'
import { findMemberNode } from '@/lib/identity/connection'

/**
 * Who a new event is by: the creator's person node in that space, so the
 * record's hosts are node ids the space can render and link. A creator with
 * no node there (a super-admin, say) is still recorded through the links'
 * `createdBy`, just not as a host.
 */
export async function eventAuthorFor(spaceId: string, userId: string): Promise<EventAuthor> {
  const node = await findMemberNode(spaceId, userId)
  return { hostNodeId: node?.id ?? null }
}

/**
 * Persist a new event and connect its hosts to it.
 *
 * Host links are upserted only for host ids that are really nodes in this space,
 * so an id that names nothing quietly stays a host of the record without
 * inventing an edge for it.
 */
export async function createEventRecord(input: EventCreateInput, author: EventAuthor): Promise<NBEvent> {
  const event = buildNewEvent(input, author)
  await upsertEvent(input.spaceId, event)

  const hostNodes = await prisma.node.findMany({
    where: { id: { in: event.hosts }, spaceId: input.spaceId },
    select: { id: true },
  })
  await Promise.all(
    hostNodes.map((host) =>
      upsertLink({
        spaceId: input.spaceId,
        sourceId: host.id,
        targetId: event.id,
        relationship: 'hosting',
        origin: 'event_hosting',
        originRef: event.id,
        since: event.analytics.createdAt,
        metadata: { role: 'host' },
      }),
    ),
  )
  return event
}

/** Apply a partial update to an event that already exists, and persist it. */
export async function updateEventRecord(
  spaceId: string,
  existing: NBEvent,
  updates: EventUpdateInput,
): Promise<NBEvent> {
  const updated = mergeEventUpdate(existing, updates)
  await upsertEvent(spaceId, updated)
  return updated
}
