/**
 * Event creation and listing API
 */

import { NextRequest, NextResponse } from 'next/server';
import { eventCreateInputSchema } from '@/lib/schemas/eventSchemas';
import { generateEventId, slugify, normalizeStatus } from '@/lib/eventUtils';
import { getEventsData, upsertEvent } from '@/lib/eventRepo';
import { requireCommunityMember } from '@/lib/eventAuth';
import type { NBEvent } from '@/lib/types';
import { logger } from '@/lib/logger';

/**
 * POST /api/events - Create a new event (any community member; creator becomes a host)
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

    // Must be a member (or admin) of the target community.
    const auth = await requireCommunityMember(input.communityId);
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
      communityId: input.communityId,
      title: input.title,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      location: input.location,
      hosts,
      organizerEmail: input.organizerEmail,
      capacity: input.capacity,
      visibility: input.visibility || 'community',
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

    // Save event as a node (events ARE nodes)
    await upsertEvent(input.communityId, event);

    // Connect each host to the event in the graph (idempotent: skip if it exists).
    const prisma = (await import('@/lib/prisma')).default;
    for (const hostId of event.hosts) {
      const hostExists = await prisma.node.findFirst({ where: { id: hostId, communityId: input.communityId } });
      if (!hostExists) continue;
      const linkExists = await prisma.link.findFirst({
        where: { sourceId: hostId, targetId: eventId, relationship: 'hosting' },
        select: { id: true },
      });
      if (!linkExists) {
        await prisma.link.create({
          data: {
            sourceId: hostId,
            targetId: eventId,
            relationship: 'hosting',
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

    // Events are community-scoped: only members/admins of this community may list them.
    const auth = await requireCommunityMember(communityId);
    if (auth instanceof Response) return auth;

    const eventsData = await getEventsData(communityId);

    // Drafts are only visible inside the composer, never in the public list.
    const visibleEvents = eventsData.events.filter((e) => e.status !== 'draft');

    // Add summary stats to each event ('registered' is legacy for 'going')
    const eventsWithStats = visibleEvents.map((event) => {
      const attendees = eventsData.attendees.filter((a) => a.eventId === event.id);
      const goingCount = attendees.filter((a) => normalizeStatus(a.status) === 'going').length;
      const waitlistedCount = attendees.filter((a) => normalizeStatus(a.status) === 'waitlisted').length;
      const checkedInCount = attendees.filter((a) => normalizeStatus(a.status) === 'checked_in').length;

      return {
        ...event,
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
    logger.error('api.events.list.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

