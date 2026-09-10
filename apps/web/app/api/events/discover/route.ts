/**
 * GET /api/events/discover — publicly discoverable upcoming events across every
 * space: the Discover page's event board.
 *
 * Deliberately space-agnostic: `/api/events` is space-scoped and gated on
 * membership, so it can't answer "what's on anywhere". Only `visibility: public`
 * events are ever returned, which is the same bar the public `/e/<slug>` page
 * already uses — no membership check is needed beyond being signed in.
 *
 * `visibility: public` is the selective predicate, so it is pushed into the
 * query as a JSON path filter; only the public rows come back, and the status
 * and date checks run in JS over that far smaller set, under a hard cap.
 *
 * The shape is `lib/discover/filters.ts#DiscoverEvent`: the board filters by
 * format (a place or not) and by the host space's country, so both ride along.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { isEventUpcoming } from '@/lib/eventUtils';
import { spaceCountryCode, type DiscoverEvent } from '@/lib/discover/filters';

const LIMIT = 120;
/** The most public event rows one read will consider — a cap, not a page. */
const SCAN_CAP = 1000;

export async function GET() {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const rows = await prisma.node.findMany({
      where: { type: 'event', metadata: { path: ['visibility'], equals: 'public' } },
      orderBy: { createdAt: 'desc' },
      take: SCAN_CAP,
      select: {
        id: true,
        name: true,
        subtitle: true,
        imageUrl: true,
        alias: true,
        metadata: true,
        space: { select: { id: true, name: true, imageUrl: true, country: true, location: true } },
      },
    });

    const visible = rows
      .map((row) => {
        const meta = (row.metadata as Record<string, unknown>) ?? {};
        const location = meta.locationData as { label?: string } | undefined;
        const declaredType = meta.eventType as string | undefined;
        const event: DiscoverEvent = {
          id: row.id,
          slug: row.alias ?? row.id.replace(/^event:/, ''),
          title: row.name,
          description: (meta.description as string) ?? row.subtitle ?? null,
          startAt: (meta.start_at as string) ?? '',
          endAt: (meta.end_at as string) ?? null,
          locationLabel: location?.label ?? null,
          eventType: declaredType === 'virtual' || (!declaredType && !location?.label) ? 'virtual' : 'in-person',
          coverImageUrl: row.imageUrl ?? null,
          themeColor: ((meta.theme as { color?: string } | undefined)?.color) ?? null,
          spaceId: row.space?.id ?? null,
          spaceName: row.space?.name ?? null,
          spaceImageUrl: row.space?.imageUrl ?? null,
          country: row.space
            ? spaceCountryCode({ country: row.space.country ?? undefined, location: row.space.location ?? undefined })
            : null,
        };
        return {
          event,
          visibility: (meta.visibility as string) ?? 'space',
          status: (meta.status as string) ?? 'published',
        };
      })
      .filter(
        (e) =>
          e.visibility === 'public' &&
          e.status === 'published' &&
          e.event.startAt &&
          isEventUpcoming(e.event.startAt),
      )
      .map((e) => e.event)
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, LIMIT);

    return NextResponse.json({ events: visible });
  } catch (error) {
    return handleApiError(error, 'api.events.discover.failed');
  }
}
