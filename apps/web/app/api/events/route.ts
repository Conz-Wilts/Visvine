/**
 * Event creation and listing API
 */

import { NextRequest, NextResponse } from 'next/server';
import { eventCreateInputSchema } from '@/lib/schemas/eventSchemas';
import { generateEventId, slugify } from '@/lib/eventUtils';
import { getEventsData, upsertEvent } from '@/lib/eventRepo';
import { getSession } from '@/lib/auth';
import type { NBEvent } from '@/lib/types';
import { logger } from '@/lib/logger';

/**
 * POST /api/events - Create a new event
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = eventCreateInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const input = parsed.data;

    // Generate event ID
    const eventId = generateEventId(input.title, input.startAt);

    // Generate form slug if not provided
    const formSlug = input.form?.schema ? slugify(input.title) : '';

    // Create event object
    const event: NBEvent = {
      id: eventId as `event:${string}`,
      communityId: input.communityId,
      title: input.title,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      location: input.location,
      hosts: input.hosts || [],
      organizerEmail: input.organizerEmail,
      capacity: input.capacity,
      visibility: input.visibility || 'public',
      form: {
        enabled: input.form?.enabled ?? true,
        slug: formSlug,
        schema: input.form?.schema || [],
        domainAllowlist: input.form?.domainAllowlist,
        requireApproval: input.form?.requireApproval,
      },
      analytics: {
        views: 0,
        rsvpCount: 0,
        checkinCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      metadata: input.metadata,
    };

    // Save event as a node (events ARE nodes now)
    await upsertEvent(input.communityId, event);

    // Add hosted_by connections for hosts
    const prisma = (await import('@/lib/prisma')).default;
    for (const hostId of event.hosts) {
      const hostExists = await prisma.node.findFirst({ where: { id: hostId, communityId: input.communityId } });

      if (hostExists) {
        await prisma.link.create({
          data: {
            sourceId: hostId,
            targetId: eventId,
            relationship: 'sponsors',
            since: event.analytics.createdAt,
            metadata: { role: 'host' },
            communityId: input.communityId,
          },
        });
      }
    }

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    logger.error('api.events.create.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/events?communityId=... - List events for a community
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('communityId');

    if (!communityId) {
      return NextResponse.json(
        { error: 'communityId is required' },
        { status: 400 }
      );
    }

    const eventsData = await getEventsData(communityId);

    // Add summary stats to each event
    const eventsWithStats = eventsData.events.map((event) => {
      const attendees = eventsData.attendees.filter((a) => a.eventId === event.id);
      const registeredCount = attendees.filter((a) => a.status === 'registered').length;
      const waitlistedCount = attendees.filter((a) => a.status === 'waitlisted').length;
      const checkedInCount = attendees.filter((a) => a.status === 'checked_in').length;

      return {
        ...event,
        _stats: {
          totalAttendees: attendees.length,
          registered: registeredCount,
          waitlisted: waitlistedCount,
          checkedIn: checkedInCount,
        },
      };
    });

    return NextResponse.json({ events: eventsWithStats });
  } catch (error) {
    logger.error('api.events.list.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

