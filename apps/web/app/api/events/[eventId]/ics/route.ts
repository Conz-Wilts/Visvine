/**
 * Event ICS export API
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/eventRepo';
import { makeICS } from '@/lib/eventUtils';
import { logger } from '@/lib/logger';

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

/**
 * GET /api/events/[eventId]/ics - Generate ICS file for event
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

    const icsContent = makeICS(event);

    return new NextResponse(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${event.id}.ics"`,
      },
    });
  } catch (error) {
    logger.error('api.events.ics.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

