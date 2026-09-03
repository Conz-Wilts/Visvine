/**
 * What an event IS, decided without a database.
 *
 * Two front doors reach the same record — the composer's POST/PATCH and the
 * MCP tools an agent calls — and they must land identically: the same id
 * derivation, the same creator-becomes-a-host rule, the same defaults for
 * waitlisting and the guest list. Those decisions live here, pure, so the
 * tests can hold them to it (tests/events-build.test.ts) and neither door can
 * quietly grow its own dialect. lib/events/write.ts is the half that persists.
 */
import { generateEventId, slugify } from '@/lib/eventUtils'
import type { EventCreateInput, EventUpdateInput } from '@/lib/schemas/eventSchemas'
import type { NBEvent } from '@/lib/types'

/** Who is creating the event — the one caller-derived fact the build needs. */
export interface EventAuthor {
  /** The author's person node, when they have one in this space. */
  /** The creator's person node in the event's space, made a host. */
  hostNodeId?: string | null
}

/**
 * The record a create request becomes. Pure: the id, the slug and every default
 * are decided here, so the composer and an agent cannot produce different
 * events from the same input.
 */
export function buildNewEvent(
  input: EventCreateInput,
  author: EventAuthor,
  now = new Date().toISOString(),
): NBEvent {
  // A client-supplied id keeps a draft stable across autosaves and cover
  // uploads; otherwise it is derived from the title and date.
  const eventId = (input.id ?? generateEventId(input.title, input.startAt)) as `event:${string}`
  const slug = eventId.slice('event:'.length) // unique, reversible public URL segment

  // The creator is always a host, so they can manage the event afterwards.
  const hosts = Array.from(new Set([...(input.hosts || []), ...(author.hostNodeId ? [author.hostNodeId] : [])]))

  return {
    id: eventId,
    spaceId: input.spaceId,
    title: input.title,
    description: input.description,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    location: input.location,
    hosts,
    organizerEmail: input.organizerEmail,
    capacity: input.capacity,
    visibility: input.visibility || 'space',
    coverImageUrl: input.coverImageUrl,
    theme: input.theme,
    status: input.status ?? 'published',
    slug,
    waitlistEnabled: input.waitlistEnabled ?? input.capacity != null,
    guestListVisible: input.guestListVisible ?? true,
    allowPlusOnes: input.allowPlusOnes ?? 0,
    allowedResponses: input.allowedResponses ?? ['going', 'maybe', 'declined'],
    form: {
      enabled: input.form?.enabled ?? true,
      slug: input.form?.schema ? slugify(input.title) : '',
      schema: input.form?.schema || [],
      domainAllowlist: input.form?.domainAllowlist,
      requireApproval: input.form?.requireApproval,
    },
    analytics: { views: 0, rsvpCount: 0, checkinCount: 0, createdAt: now, updatedAt: now },
    metadata: input.metadata,
  }
}

/**
 * An existing event with a partial update applied. Absent keys are left alone —
 * which is the whole reason `eventUpdateInputSchema` strips its defaults — and
 * the form object merges rather than replaces.
 */
export function mergeEventUpdate(
  existing: NBEvent,
  updates: EventUpdateInput,
  now = new Date().toISOString(),
): NBEvent {
  return {
    ...existing,
    ...updates,
    form: updates.form ? { ...existing.form, ...updates.form } : existing.form,
    analytics: { ...existing.analytics, updatedAt: now },
  }
}
