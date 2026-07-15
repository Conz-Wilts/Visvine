/**
 * Public .ics download for an event share page (no auth). Used by the
 * "Add to calendar" button on /e/<slug>.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEventBySlug } from '@/lib/eventRepo';
import { makeICS } from '@/lib/eventUtils';
import { handleApiError } from '@/lib/api/route';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const event = await getEventBySlug(slug);
    // Only public events are exposed on this unauthenticated endpoint — keep it in
    // lock-step with the /e/<slug> page and RSVP route.
    if (!event || event.status === 'draft' || event.visibility !== 'public') {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    return new NextResponse(makeICS(event), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.ics"`,
      },
    });
  } catch (error) {
    return handleApiError(error, 'api.public.ics.failed');
  }
}
