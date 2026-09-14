/**
 * Event creation and listing API
 */

import { NextRequest, NextResponse } from 'next/server';
import { eventCreateInputSchema } from '@/lib/schemas/eventSchemas';
import { normalizeStatus } from '@/lib/eventUtils';
import { getEventsData } from '@/lib/eventRepo';
import { createEventRecord, eventAuthorFor } from '@/lib/events/write';
import { requireSpaceMember } from '@/lib/eventAuth';
import { handleApiError } from '@/lib/api/route';

/**
 * POST /api/events - Create a new event (any space member; creator becomes a host)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = eventCreateInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const input = parsed.data;

    // Must be a member (or admin) of the target space.
    const auth = await requireSpaceMember(input.spaceId);
    if (auth instanceof Response) return auth;

    // Building the record, its hosts and its links is lib/events/write.ts — the
    // same call the MCP create_event tool makes, so the two doors agree.
    const event = await createEventRecord(input, await eventAuthorFor(input.spaceId, auth.userId));

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'api.events.create.failed');
  }
}

/**
 * GET /api/events?spaceId=... - List events for a space
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const spaceId = searchParams.get('spaceId');

    if (!spaceId) {
      return NextResponse.json(
        { error: 'spaceId is required' },
        { status: 400 }
      );
    }

    // Events are space-scoped: only members/admins of this space may list them.
    const auth = await requireSpaceMember(spaceId);
    if (auth instanceof Response) return auth;

    const eventsData = await getEventsData(spaceId);

    // Drafts are only visible inside the composer, never in the public list.
    const visibleEvents = eventsData.events.filter((e) => e.status !== 'draft');

    // Resolve host node ids (e.g. "person:dev_admin") to display names so
    // clients never have to render raw ids. Matched by id alone (ids are
    // globally unique) — host person nodes can live in another space,
    // same as the event detail route's hostNodes lookup.
    const hostIds = Array.from(new Set(visibleEvents.flatMap((e) => e.hosts || [])));
    const prisma = (await import('@/lib/prisma')).default;
    const hostNodes = hostIds.length
      ? await prisma.node.findMany({
          where: { id: { in: hostIds } },
          select: { id: true, name: true },
        })
      : [];
    const hostNameById = new Map(hostNodes.map((n) => [n.id, n.name]));

    // Add summary stats to each event: attendees grouped once, not scanned
    // per event.
    const attendeesByEvent = new Map<string, typeof eventsData.attendees>();
    for (const a of eventsData.attendees) {
      const list = attendeesByEvent.get(a.eventId);
      if (list) list.push(a);
      else attendeesByEvent.set(a.eventId, [a]);
    }
    const eventsWithStats = visibleEvents.map((event) => {
      const attendees = attendeesByEvent.get(event.id) ?? [];
      const goingCount = attendees.filter((a) => normalizeStatus(a.status) === 'going').length;
      const waitlistedCount = attendees.filter((a) => normalizeStatus(a.status) === 'waitlisted').length;
      const checkedInCount = attendees.filter((a) => normalizeStatus(a.status) === 'checked_in').length;

      return {
        ...event,
        hostNames: (event.hosts || [])
          .map((id) => hostNameById.get(id))
          .filter((name): name is string => !!name),
        _stats: {
          totalAttendees: attendees.length,
          // keep the legacy `registered` key for the mobile contract; it now means "going"
          registered: goingCount,
          going: goingCount,
          waitlisted: waitlistedCount,
          checkedIn: checkedInCount,
        },
      };
    });

    return NextResponse.json({ events: eventsWithStats });
  } catch (error) {
    return handleApiError(error, 'api.events.list.failed');
  }
}

