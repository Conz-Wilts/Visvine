/**
 * Public, no-login RSVP endpoint. Anyone with the share link (/e/<slug>) can
 * RSVP with just a name (+ optional email). Rate-limited by IP. Returns only a
 * status + message — never attendee PII.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rsvpSubmissionSchema } from '@/lib/schemas/eventSchemas';
import { getEventBySlug, submitRsvp, EventFullError } from '@/lib/eventRepo';
import { isEmailDomainAllowed, missingRequiredAnswers } from '@/lib/eventUtils';
import { rsvpMessage } from '@/lib/eventCopy';
import { takeToken } from '@/lib/messages/rateLimit';
import { handleApiError } from '@/lib/api/route';

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const rl = takeToken(`rsvp:${ip}`, { capacity: 10, refillPerSec: 0.2 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const event = await getEventBySlug(slug);
    // Only `public` events accept loginless RSVPs. Space/unlisted events are
    // RSVP'd from inside the app — treat them as not found here so a guessable
    // slug can't be used to inject attendees into a non-public event.
    if (!event || event.status === 'draft' || event.visibility !== 'public') {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    if (!event.form.enabled) {
      return NextResponse.json({ error: 'RSVPs are closed for this event' }, { status: 403 });
    }

    const parsed = rsvpSubmissionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation error', details: parsed.error.issues }, { status: 400 });
    }
    const submission = parsed.data;

    if (submission.email && !isEmailDomainAllowed(submission.email, event.form.domainAllowlist)) {
      return NextResponse.json({ error: 'This event is restricted to certain email domains' }, { status: 403 });
    }

    const missing = missingRequiredAnswers(event.form.schema, submission);
    if (missing.length > 0) {
      return NextResponse.json({ error: `Please answer: ${missing.join(', ')}` }, { status: 400 });
    }

    const plusOnes = Math.min(submission.plusOnes ?? 0, event.allowPlusOnes ?? 0);
    const { status, created } = await submitRsvp(event.spaceId, event, { ...submission, plusOnes });

    return NextResponse.json(
      { status, message: rsvpMessage(status), created },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof EventFullError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return handleApiError(error, 'api.public.rsvp.failed');
  }
}
