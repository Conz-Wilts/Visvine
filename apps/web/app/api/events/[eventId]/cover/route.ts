/**
 * POST /api/events/[eventId]/cover?spaceId=… — set an event's poster from a
 * file that is already in the space's Drive.
 *
 * The browser upload (POST /api/upload) starts from bytes a person just picked;
 * this starts from bytes the space already holds, which is what makes "use the
 * flyer we uploaded last week" a single call for a person and for an agent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getEvent } from '@/lib/eventRepo';
import { updateEventRecord } from '@/lib/events/write';
import { coverUrlFromResource } from '@/lib/events/cover';
import { requireEventManager } from '@/lib/eventAuth';
import { featureAccessForbidden } from '@/lib/auth';
import { handleApiError, parseBody, forbiddenResponse } from '@/lib/api/route';

const bodySchema = z.object({ resourceId: z.string().min(1) });

export async function POST(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const spaceId = request.nextUrl.searchParams.get('spaceId');
    if (!spaceId) return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });

    const event = await getEvent(spaceId, eventId);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const auth = await requireEventManager(spaceId, event);
    if (auth instanceof Response) return auth;

    // Reading the Drive is the Resources feature's own gate — a space that has
    // turned it off, or restricted it to admins, refuses here too.
    if (await featureAccessForbidden(auth.userId, spaceId, 'resources', auth.email)) {
      return forbiddenResponse();
    }

    const body = await parseBody(request, bodySchema);
    if (body instanceof NextResponse) return body;

    const coverImageUrl = await coverUrlFromResource({ spaceId, eventId, resourceId: body.resourceId });
    return NextResponse.json(await updateEventRecord(spaceId, event, { coverImageUrl }));
  } catch (error) {
    return handleApiError(error, 'api.events.cover.failed');
  }
}
