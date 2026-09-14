// The database side of the events roll-up (lib/events/rollup.ts): which
// sub-spaces of a space flow up, and their public events, read as of now.

import { getEventsData } from '@/lib/eventRepo'
import type { EventsData, NBEvent } from '@/lib/types/events'
import { eventFlowingSubspacesOf } from '@/lib/spaces/subspaceAccess'
import { rollupEvents, type SubspaceRef } from './rollup'

export type RolledUpEvent = NBEvent & { viaSpace: SubspaceRef }

/**
 * Every public, published event of every public sub-space of `parentId`,
 * each stamped `viaSpace`, with the attendees of those events so the caller
 * can count "going" the same way it does for its own. A top-level space with
 * no sub-spaces, or a sub-space (which holds none), gets empty lists.
 */
export async function subspaceEventsOf(parentId: string): Promise<{ events: RolledUpEvent[]; attendees: EventsData['attendees'] }> {
  const subs = await eventFlowingSubspacesOf(parentId)
  if (subs.length === 0) return { events: [], attendees: [] }
  const data = await Promise.all(subs.map((s) => getEventsData(s.id)))
  const events: RolledUpEvent[] = []
  const attendees: EventsData['attendees'] = []
  subs.forEach((sub, i) => {
    const rolled = rollupEvents(sub, data[i].events)
    const ids = new Set(rolled.map((e) => e.id))
    events.push(...rolled)
    attendees.push(...data[i].attendees.filter((a) => ids.has(a.eventId as NBEvent['id'])))
  })
  return { events, attendees }
}
