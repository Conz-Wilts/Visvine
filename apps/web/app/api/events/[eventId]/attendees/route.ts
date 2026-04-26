/**
 * Event attendees API (POST RSVP, GET attendees)
 */

import { NextRequest, NextResponse } from 'next/server';
import { rsvpSubmissionSchema } from '@/lib/schemas/eventSchemas';
import {
  getEvent,
  getAttendees,
  upsertAttendee,
  getCommunityGraphData,
  updateCommunityGraphData,
  updateEventAnalytics,
} from '@/lib/eventRepo';
import { findMatchingPerson, createPersonNode, ensureUniquePersonId } from '@/lib/personDedupe';
import { generateAttendeeId, isEmailDomainAllowed } from '@/lib/eventUtils';
import type { NBAttendee, NBLink, RSVPStatus } from '@/lib/types';
import { logger } from '@/lib/logger';

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

// Simple rate limiting (in-memory, per process)
const rsvpRateLimit = new Map<string, number[]>();
const MAX_RSVPS_PER_IP = 10;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempts = rsvpRateLimit.get(ip) || [];

  // Remove old attempts outside the window
  const recentAttempts = attempts.filter((time) => now - time < RATE_LIMIT_WINDOW_MS);

  if (recentAttempts.length >= MAX_RSVPS_PER_IP) {
    return false;
  }

  recentAttempts.push(now);
  rsvpRateLimit.set(ip, recentAttempts);
  return true;
}

/**
 * POST /api/events/[eventId]/attendees - Submit RSVP
 */
export async function POST(
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

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    const event = await getEvent(communityId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    if (!event.form.enabled) {
      return NextResponse.json(
        { error: 'RSVP form is not enabled for this event' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = rsvpSubmissionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const submission = parsed.data;

    // Check domain allowlist
    if (submission.email && !isEmailDomainAllowed(submission.email, event.form.domainAllowlist)) {
      return NextResponse.json(
        { error: 'Email domain not allowed for this event' },
        { status: 403 }
      );
    }

    // Get existing graph data to find/create person
    const graphData = await getCommunityGraphData(communityId);

    // Try to find matching person
    const matchedPerson = findMatchingPerson(graphData.nodes, {
      name: submission.name,
      email: submission.email,
      linkedinUrl: submission.linkedinUrl,
      companyName: submission.companyName,
    });

    let personId: string;

    if (matchedPerson) {
      personId = matchedPerson.id;
    } else {
      // Create new person node
      const newPerson = createPersonNode({
        name: submission.name,
        email: submission.email,
        linkedinUrl: submission.linkedinUrl,
        companyName: submission.companyName,
        roleTitle: submission.roleTitle,
      });

      // Ensure unique ID
      const uniquePerson = ensureUniquePersonId(newPerson, graphData.nodes);
      personId = uniquePerson.id;

      // Add to graph
      graphData.nodes.push(uniquePerson);
      await updateCommunityGraphData(communityId, graphData);
    }

    // Determine RSVP status
    const existingAttendees = await getAttendees(communityId, eventId);
    const registeredCount = existingAttendees.filter((a) => a.status === 'registered').length;

    let status: RSVPStatus;
    if (event.form.requireApproval) {
      status = 'invited';
    } else if (event.capacity && registeredCount >= event.capacity) {
      status = 'waitlisted';
    } else {
      status = 'registered';
    }

    // Check if this person already has an attendee record
    const existingAttendee = existingAttendees.find((a) => a.personId === personId);

    let attendee: NBAttendee;
    const now = new Date().toISOString();

    if (existingAttendee) {
      // Update existing attendee
      attendee = {
        ...existingAttendee,
        email: submission.email || existingAttendee.email,
        linkedinUrl: submission.linkedinUrl || existingAttendee.linkedinUrl,
        companyName: submission.companyName || existingAttendee.companyName,
        roleTitle: submission.roleTitle || existingAttendee.roleTitle,
        answers: { ...existingAttendee.answers, ...submission.answers } as Record<string, string | boolean>,
        status,
        updatedAt: now,
      };
    } else {
      // Create new attendee
      const attendeeId = generateAttendeeId(eventId, submission.email || personId);
      attendee = {
        id: attendeeId as `attendee:${string}`,
        eventId: eventId as `event:${string}`,
        personId: personId as `person:${string}`,
        email: submission.email,
        linkedinUrl: submission.linkedinUrl,
        companyName: submission.companyName,
        roleTitle: submission.roleTitle,
        answers: submission.answers as Record<string, string | boolean> | undefined,
        status,
        createdAt: now,
        updatedAt: now,
      };
    }

    await upsertAttendee(communityId, attendee);

    // Add attended link to graph (if not exists)
    const linkExists = graphData.links.some(
      (link) =>
        ((typeof link.source === 'string' ? link.source : link.source.id) === personId &&
          (typeof link.target === 'string' ? link.target : link.target.id) === eventId) ||
        ((typeof link.source === 'string' ? link.source : link.source.id) === eventId &&
          (typeof link.target === 'string' ? link.target : link.target.id) === personId)
    );

    if (!linkExists) {
      const attendedLink: NBLink = {
        source: personId,
        target: eventId,
        relationship: 'attended',
        since: event.startAt,
        metadata: { status },
      };
      graphData.links.push(attendedLink);
      await updateCommunityGraphData(communityId, graphData);
    }

    // Update event analytics
    if (!existingAttendee) {
      await updateEventAnalytics(communityId, eventId, {
        rsvpCount: event.analytics.rsvpCount + 1,
      });
    }

    return NextResponse.json({
      attendee,
      status,
      message:
        status === 'registered'
          ? 'Successfully registered!'
          : status === 'waitlisted'
            ? 'You have been added to the waitlist.'
            : 'Your RSVP is pending approval.',
    }, { status: existingAttendee ? 200 : 201 });
  } catch (error) {
    logger.error('api.events.rsvp.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/events/[eventId]/attendees - List attendees (admin view)
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

    const attendees = await getAttendees(communityId, eventId);

    // Get person details for each attendee
    const graphData = await getCommunityGraphData(communityId);

    const attendeesWithPersons = attendees.map((attendee) => {
      const person = graphData.nodes.find((n) => n.id === attendee.personId);
      return {
        ...attendee,
        person: person
          ? {
            id: person.id,
            name: person.name,
            subtitle: person.subtitle,
            tags: person.tags,
          }
          : null,
      };
    });

    return NextResponse.json({ attendees: attendeesWithPersons });
  } catch (error) {
    logger.error('api.events.attendees.list.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

