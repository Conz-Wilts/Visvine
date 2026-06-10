/**
 * Individual event API (GET, PATCH, DELETE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { eventUpdateInputSchema } from '@/lib/schemas/eventSchemas';
import { getEvent, upsertEvent, getAttendees, deleteEvent } from '@/lib/eventRepo';
import { requireEventManager, requireCommunityMember } from '@/lib/eventAuth';
import { normalizeStatus, occupiedSpots } from '@/lib/eventUtils';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

/**
 * GET /api/events/[eventId] - Get event details with attendee summary
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { eventId } = await context.params;
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('communityId');

    if (!communityId) {
      return NextResponse.json(
        { error: 'communityId is required' },
        { status: 400 }
      );
    }

    // Events are community-scoped: only members/admins may read event details.
    const member = await requireCommunityMember(communityId);
    if (member instanceof Response) return member;

    const event = await getEvent(communityId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    const attendees = await getAttendees(communityId, eventId);

    // Calculate stats ('registered' is legacy for 'going')
    const norm = (a: (typeof attendees)[number]) => normalizeStatus(a.status);
    const goingCount = attendees.filter((a) => norm(a) === 'going').length;
    const stats = {
      total: attendees.length,
      going: goingCount,
      registered: goingCount, // legacy alias
      waitlisted: attendees.filter((a) => norm(a) === 'waitlisted').length,
      pending: attendees.filter((a) => norm(a) === 'pending').length,
      invited: attendees.filter((a) => norm(a) === 'invited').length,
      checkedIn: attendees.filter((a) => norm(a) === 'checked_in').length,
      cancelled: attendees.filter((a) => norm(a) === 'cancelled').length,
      noShow: attendees.filter((a) => norm(a) === 'no_show').length,
      maybe: attendees.filter((a) => a.response === 'maybe').length,
    };

    // The viewer's own RSVP record (matched by person node or session email) —
    // their own data, safe for any member.
    const viewerEmail = member.email?.toLowerCase();
    const viewerAttendee = attendees.find(
      (a) =>
        (member.personId && a.personId === member.personId) ||
        (!!viewerEmail && a.email?.toLowerCase() === viewerEmail),
    );

    // Sanitized confirmed-guest list — the same names the public /e/<slug> page
    // already exposes when the host enables "show guest list", plus avatars.
    let guests: Array<{ name: string; personId?: string; imageUrl?: string | null }> = [];
    if (event.guestListVisible) {
      const confirmed = attendees.filter(
        (a) => ['going', 'checked_in'].includes(norm(a)) && a.response !== 'maybe',
      );
      const guestPersonIds = confirmed
        .map((a) => a.personId)
        .filter((id): id is `person:${string}` => !!id);
      const guestNodes = guestPersonIds.length
        ? await prisma.node.findMany({
            where: { id: { in: guestPersonIds } },
            select: { id: true, name: true, imageUrl: true },
          })
        : [];
      const guestMap = new Map(guestNodes.map((n) => [n.id, n]));
      guests = confirmed.slice(0, 50).flatMap((a) => {
        const person = a.personId ? guestMap.get(a.personId) : undefined;
        const name = person?.name ?? a.name;
        return name ? [{ name, personId: a.personId || undefined, imageUrl: person?.imageUrl ?? null }] : [];
      });
    }

    // Host person nodes for the "Hosted by" row
    const hostNodes = event.hosts.length
      ? await prisma.node.findMany({
          where: { id: { in: event.hosts } },
          select: { id: true, name: true, imageUrl: true, subtitle: true },
        })
      : [];

    // Optionally include attendee records with profile data — guest PII, so host-only.
    const includeAttendees = searchParams.get('includeAttendees') === 'true';
    let attendeeList = undefined;

    if (includeAttendees) {
      const auth = await requireEventManager(communityId, event);
      if (auth instanceof Response) return auth;

      const personIds = attendees
        .map((a) => a.personId)
        .filter((id): id is `person:${string}` => !!id);

      const personNodes = personIds.length > 0
        ? await prisma.node.findMany({
            where: { id: { in: personIds } },
            select: { id: true, name: true, imageUrl: true },
          })
        : [];

      const personMap = new Map(personNodes.map((p) => [p.id, p]));

      attendeeList = attendees.map((a) => {
        const person = a.personId ? personMap.get(a.personId) : undefined;
        return {
          ...a,
          // person name wins; fall back to the typed guest name (loginless RSVP)
          name: person?.name ?? a.name,
          image_url: person?.imageUrl,
        };
      });
    }

    return NextResponse.json({
      event,
      stats,
      attendeesCount: attendees.length,
      occupied: occupiedSpots(attendees),
      viewer: viewerAttendee
        ? {
            status: normalizeStatus(viewerAttendee.status),
            response: viewerAttendee.response ?? null,
            plusOnes: viewerAttendee.plusOnes ?? 0,
          }
        : null,
      guests,
      hostNodes,
      ...(attendeeList && { attendees: attendeeList }),
    });
  } catch (error) {
    logger.error('api.events.get.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/events/[eventId] - Update event
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { eventId } = await context.params;
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('communityId');

    if (!communityId) {
      return NextResponse.json(
        { error: 'communityId is required' },
        { status: 400 }
      );
    }

    const event = await getEvent(communityId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    const auth = await requireEventManager(communityId, event);
    if (auth instanceof Response) return auth;

    const body = await request.json();
    const parsed = eventUpdateInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const updates = parsed.data;

    // Merge updates with existing event
    const updatedEvent = {
      ...event,
      ...updates,
      form: updates.form ? { ...event.form, ...updates.form } : event.form,
      analytics: {
        ...event.analytics,
        updatedAt: new Date().toISOString(),
      },
    };

    await upsertEvent(communityId, updatedEvent);

    return NextResponse.json(updatedEvent);
  } catch (error) {
    logger.error('api.events.update.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/events/[eventId] - Delete event
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { eventId } = await context.params;
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('communityId');

    if (!communityId) {
      return NextResponse.json(
        { error: 'communityId is required' },
        { status: 400 }
      );
    }

    const event = await getEvent(communityId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    const auth = await requireEventManager(communityId, event);
    if (auth instanceof Response) return auth;

    // Delete the event node. Attendee.event and Link.source/target are
    // ON DELETE CASCADE (prisma/schema.prisma), so the DB removes the event's
    // attendees and every connected graph link automatically. (The old
    // read-filter-reupsert-the-whole-graph dance here threw 500s and clobbered
    // node metadata with person-profile enrichment — see eventRepo notes.)
    await deleteEvent(communityId, eventId);

    return NextResponse.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    logger.error('api.events.delete.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


