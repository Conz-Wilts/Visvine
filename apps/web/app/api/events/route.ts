/**
 * Event creation and listing API
 */

import { NextRequest, NextResponse } from 'next/server';
import { eventCreateInputSchema } from '@/lib/schemas/eventSchemas';
import { generateEventId, slugify, normalizeStatus } from '@/lib/eventUtils';
import { getEventsData, upsertEvent } from '@/lib/eventRepo';
import { upsertLink } from '@/lib/notes/context/links';
import { requireSpaceMember } from '@/lib/eventAuth';
import { handleApiError } from '@/lib/api/route';
import type { NBEvent } from '@/lib/types';

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
    const session = auth;

    // Honor a client-supplied draft id (stable across autosaves); else derive one.
    const eventId = (input.id ?? generateEventId(input.title, input.startAt)) as `event:${string}`;
    const slug = eventId.slice('event:'.length); // unique, reversible public URL segment

    // Generate form slug if a form schema is present
    const formSlug = input.form?.schema ? slugify(input.title) : '';

    // The creator is always a host so they can manage the event afterwards.
    const hosts = Array.from(
      new Set([...(input.hosts || []), ...(session.personId ? [session.personId] : [])]),
    );

    const now = new Date().toISOString();
    const event: NBEvent = {
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
        slug: formSlug,
        schema: input.form?.schema || [],
        domainAllowlist: input.form?.domainAllowlist,
        requireApproval: input.form?.requireApproval,
      },
      analytics: { views: 0, rsvpCount: 0, checkinCount: 0, createdAt: now, updatedAt: now },
      metadata: input.metadata,
    };

    await upsertEvent(input.spaceId, event);

    // Connect each host to the event in the context (idempotent: skip if it exists).
    const prisma = (await import('@/lib/prisma')).default;
    for (const hostId of event.hosts) {
      const hostExists = await prisma.node.findFirst({ where: { id: hostId, spaceId: input.spaceId } });
      if (!hostExists) continue;
      await upsertLink({
        spaceId: input.spaceId,
        sourceId: hostId,
        targetId: eventId,
        relationship: 'hosting',
        origin: 'event_hosting',
        originRef: eventId,
        since: event.analytics.createdAt,
        metadata: { role: 'host' },
      });
    }

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
    // `communityId` is the pre-rename spelling. Shipped mobile builds still send
    // it, so it stays accepted here until they roll over; nothing else in the
    // codebase uses the word.
    const spaceId = searchParams.get('spaceId') ?? searchParams.get('communityId');

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

    // Add summary stats to each event ('registered' is legacy for 'going')
    const eventsWithStats = visibleEvents.map((event) => {
      const attendees = eventsData.attendees.filter((a) => a.eventId === event.id);
      const goingCount = attendees.filter((a) => normalizeStatus(a.status) === 'going').length;
      const waitlistedCount = attendees.filter((a) => normalizeStatus(a.status) === 'waitlisted').length;
      const checkedInCount = attendees.filter((a) => normalizeStatus(a.status) === 'checked_in').length;

      return {
        ...event,
        // Pre-rename spelling, still decoded by shipped mobile builds.
        communityId: event.spaceId,
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

