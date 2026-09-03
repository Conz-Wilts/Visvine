/**
 * Bulk host actions over the guest list: approve all pending, promote from the
 * waitlist (capacity-aware, FIFO), bulk check-in / decline / no-show / remove.
 * Target either an explicit `attendeeIds` list or a `scope` (status group).
 * Host or space admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getEvent, getAttendees, setAttendeeStatus, removeAttendee } from '@/lib/eventRepo';
import { requireEventManager } from '@/lib/eventAuth';
import { normalizeStatus, occupiedSpots } from '@/lib/eventUtils';
import type { RSVPStatus } from '@/lib/types';
import { handleApiError } from '@/lib/api/route';

type RouteContext = { params: Promise<{ eventId: string }> };

const bulkSchema = z.object({
  action: z.enum(['approve', 'promote', 'decline', 'checkin', 'no_show', 'remove']),
  attendeeIds: z.array(z.string()).optional(),
  scope: z.enum(['pending', 'waitlisted', 'going', 'maybe', 'checked_in']).optional(),
});

const ACTION_TO_STATUS: Record<string, RSVPStatus> = {
  approve: 'going',
  decline: 'cancelled',
  checkin: 'checked_in',
  no_show: 'no_show',
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const spaceId = new URL(request.url).searchParams.get('spaceId');
    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    const event = await getEvent(spaceId, eventId);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const auth = await requireEventManager(spaceId, event);
    if (auth instanceof Response) return auth;

    const parsed = bulkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation error', details: parsed.error.issues }, { status: 400 });
    }
    const { action, attendeeIds, scope } = parsed.data;

    const all = await getAttendees(eventId);
    let targets = all;
    if (attendeeIds?.length) {
      const set = new Set(attendeeIds);
      targets = all.filter((a) => set.has(a.id));
    } else if (scope === 'maybe') {
      targets = all.filter((a) => a.response === 'maybe');
    } else if (scope) {
      targets = all.filter((a) => normalizeStatus(a.status) === scope);
    } else {
      return NextResponse.json({ error: 'Provide attendeeIds or a scope' }, { status: 400 });
    }

    if (action === 'remove') {
      let removed = 0;
      for (const t of targets) if (await removeAttendee(spaceId, eventId, t.id)) removed++;
      return NextResponse.json({ removed });
    }

    if (action === 'promote') {
      // Promote oldest-first, only while capacity allows (party = 1 + plusOnes).
      let available = event.capacity ? event.capacity - occupiedSpots(all) : Number.POSITIVE_INFINITY;
      const queue = targets
        .filter((t) => normalizeStatus(t.status) === 'waitlisted')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let promoted = 0;
      for (const t of queue) {
        const need = 1 + (t.plusOnes ?? 0);
        if (available < need) continue;
        await setAttendeeStatus(spaceId, eventId, t.id, 'going');
        available -= need;
        promoted++;
      }
      return NextResponse.json({ promoted });
    }

    const status = ACTION_TO_STATUS[action];
    let updated = 0;
    for (const t of targets) {
      await setAttendeeStatus(spaceId, eventId, t.id, status);
      updated++;
    }
    return NextResponse.json({ updated });
  } catch (error) {
    return handleApiError(error, 'api.events.attendees.bulk.failed');
  }
}
