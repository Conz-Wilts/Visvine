/**
 * Individual event API (GET, PATCH)
 */

import { NextRequest, NextResponse } from 'next/server';
import { eventUpdateInputSchema } from '@/lib/schemas/eventSchemas';
import { getEvent, upsertEvent, getAttendees, deleteEvent, getCommunityGraphData, updateCommunityGraphData } from '@/lib/eventRepo';
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

    const event = await getEvent(communityId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    const attendees = await getAttendees(communityId, eventId);

    // Calculate stats
    const stats = {
      total: attendees.length,
      registered: attendees.filter((a) => a.status === 'registered').length,
      waitlisted: attendees.filter((a) => a.status === 'waitlisted').length,
      invited: attendees.filter((a) => a.status === 'invited').length,
      checkedIn: attendees.filter((a) => a.status === 'checked_in').length,
      cancelled: attendees.filter((a) => a.status === 'cancelled').length,
      noShow: attendees.filter((a) => a.status === 'no_show').length,
    };

    // Optionally include attendee records with profile data
    const includeAttendees = searchParams.get('includeAttendees') === 'true';
    let attendeeList = undefined;

    if (includeAttendees) {
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
          name: person?.name,
          image_url: person?.imageUrl,
        };
      });
    }

    return NextResponse.json({
      event,
      stats,
      attendeesCount: attendees.length,
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

    // Delete event and attendees from events.json
    await deleteEvent(communityId, eventId);

    // Remove event node and related links from graph
    const graphData = await getCommunityGraphData(communityId);
    
    // Remove event node
    graphData.nodes = graphData.nodes.filter((n) => n.id !== eventId);
    
    // Remove all links connected to this event
    graphData.links = graphData.links.filter((link) => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      return sourceId !== eventId && targetId !== eventId;
    });

    await updateCommunityGraphData(communityId, graphData);

    return NextResponse.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    logger.error('api.events.delete.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


