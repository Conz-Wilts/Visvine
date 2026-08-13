/**
 * Host actions on a single attendee: change status (approve / decline / promote /
 * check-in / no-show / waitlist) or remove them. Host or space admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getEvent, setAttendeeStatus, removeAttendee } from '@/lib/eventRepo';
import { requireEventManager } from '@/lib/eventAuth';
import type { RSVPStatus } from '@/lib/types';
import { handleApiError } from '@/lib/api/route';

type RouteContext = {
  params: Promise<{ eventId: string; attendeeId: string }>;
};

// Host-facing action verbs → operational status.
const ACTION_TO_STATUS: Record<string, RSVPStatus> = {
  approve: 'going',
  going: 'going',
  promote: 'going',
  decline: 'cancelled',
  cancel: 'cancelled',
  waitlist: 'waitlisted',
  checkin: 'checked_in',
  uncheckin: 'going',
  no_show: 'no_show',
};

const patchSchema = z.object({
  action: z.enum(Object.keys(ACTION_TO_STATUS) as [string, ...string[]]),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { eventId, attendeeId } = await context.params;
    const spaceId = new URL(request.url).searchParams.get('spaceId');
    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    const event = await getEvent(spaceId, eventId);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const auth = await requireEventManager(spaceId, event);
    if (auth instanceof Response) return auth;

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation error', details: parsed.error.issues }, { status: 400 });
    }

    const updated = await setAttendeeStatus(
      spaceId, eventId, attendeeId, ACTION_TO_STATUS[parsed.data.action],
    );
    if (!updated) return NextResponse.json({ error: 'Attendee not found' }, { status: 404 });

    return NextResponse.json({ attendee: updated });
  } catch (error) {
    return handleApiError(error, 'api.events.attendee.patch.failed');
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { eventId, attendeeId } = await context.params;
    const spaceId = new URL(request.url).searchParams.get('spaceId');
    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    const event = await getEvent(spaceId, eventId);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const auth = await requireEventManager(spaceId, event);
    if (auth instanceof Response) return auth;

    const ok = await removeAttendee(spaceId, eventId, attendeeId);
    if (!ok) return NextResponse.json({ error: 'Attendee not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'api.events.attendee.delete.failed');
  }
}
