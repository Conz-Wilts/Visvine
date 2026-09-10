'use client';

import { fetchJson } from '@/lib/fetchJson';
import { invalidateRequestCachePrefix, swrFetch } from '@/features/shared/lib/requestCache';
import type { NBEvent, RSVPResponse } from '@/lib/types';

export interface EventStats {
  total: number;
  going?: number;
  registered: number;
  waitlisted: number;
  pending?: number;
  invited: number;
  checkedIn: number;
  cancelled: number;
  noShow: number;
  maybe?: number;
}

export interface ViewerRsvp {
  status: string;
  response: RSVPResponse | null;
  plusOnes: number;
}

export interface GuestPreview {
  name: string;
  personId?: string;
  imageUrl?: string | null;
}

/** What GET /api/events/<id> answers: the event, its counts, the viewer's own
 *  RSVP and the sanitized guest preview. */
export interface EventDetail {
  event?: NBEvent | null;
  stats?: EventStats | null;
  occupied?: number;
  viewer?: ViewerRsvp | null;
  guests?: GuestPreview[];
}

const detailKey = (spaceId: string, eventId: string) => `events:detail:${eventId}:${spaceId}`;

/**
 * One read of an event's page payload, shared by the event page, the manage
 * view and the editor through the request cache: going from the page to Edit
 * and back paints from the same answer instead of asking three times.
 */
export function loadEventDetail(spaceId: string, eventId: string, onData: (detail: EventDetail) => void): Promise<EventDetail> {
  return swrFetch(
    detailKey(spaceId, eventId),
    () => fetchJson<EventDetail>(`/api/events/${encodeURIComponent(eventId)}?spaceId=${encodeURIComponent(spaceId)}`),
    onData,
  );
}

/** Forget an event's cached payload — after an RSVP, a save or a delete.
 *  Keyed by event alone: the space is not always to hand where the write
 *  happens, and an event has one space. */
export function invalidateEventDetail(eventId: string) {
  invalidateRequestCachePrefix(`events:detail:${eventId}:`);
}
