/**
 * Event attendees API (POST RSVP, GET attendees)
 */

import { NextRequest, NextResponse } from 'next/server';
import { rsvpSubmissionSchema } from '@/lib/schemas/eventSchemas';
import { getEvent, getAttendees, getSpaceNodes, submitRsvp, EventFullError } from '@/lib/eventRepo';
import { isEmailDomainAllowed, missingRequiredAnswers } from '@/lib/eventUtils';
import { rsvpMessage } from '@/lib/eventCopy';
import { requireEventManager } from '@/lib/eventAuth';
import { handleApiError } from '@/lib/api/route';

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
    const spaceId = searchParams.get('spaceId');

    if (!spaceId) {
      return NextResponse.json(
        { error: 'spaceId is required' },
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

    const event = await getEvent(spaceId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    if (event.status === 'draft') {
      return NextResponse.json({ error: 'This event is not open for RSVPs yet' }, { status: 403 });
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

    if (submission.email && !isEmailDomainAllowed(submission.email, event.form.domainAllowlist)) {
      return NextResponse.json(
        { error: 'Email domain not allowed for this event' },
        { status: 403 }
      );
    }

    const missing = missingRequiredAnswers(event.form.schema, submission);
    if (missing.length > 0) {
      return NextResponse.json({ error: `Please answer: ${missing.join(', ')}` }, { status: 400 });
    }

    // Clamp +guests to what the event allows.
    const plusOnes = Math.min(submission.plusOnes ?? 0, event.allowPlusOnes ?? 0);

    const { attendee, status, created } = await submitRsvp(spaceId, event, {
      ...submission,
      plusOnes,
    });

    return NextResponse.json(
      { attendee, status, message: rsvpMessage(status) },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof EventFullError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return handleApiError(error, 'api.events.rsvp.failed');
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
    const spaceId = searchParams.get('spaceId');

    if (!spaceId) {
      return NextResponse.json(
        { error: 'spaceId is required' },
        { status: 400 }
      );
    }

    // Guest list is PII — host or space admin only.
    const event = await getEvent(spaceId, eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    const auth = await requireEventManager(spaceId, event);
    if (auth instanceof Response) return auth;

    const attendees = await getAttendees(eventId);

    // Get person details for each attendee (nodes only — no need to load links)
    const nodes = await getSpaceNodes(spaceId);

    const attendeesWithPersons = attendees.map((attendee) => {
      const person = attendee.personId ? nodes.find((n) => n.id === attendee.personId) : undefined;
      return {
        ...attendee,
        // resolved display name: person node wins, else the typed guest name
        name: person?.name ?? attendee.name,
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
    return handleApiError(error, 'api.events.attendees.list.failed');
  }
}

