/**
 * GET /api/events/discover — publicly discoverable upcoming events across every
 * space, for the navbar calendar when no space is selected.
 *
 * Deliberately space-agnostic: `/api/events` is community-scoped and gated on
 * membership, so it can't answer "what's on anywhere". Only `visibility: public`
 * events are ever returned, which is the same bar the public `/e/<slug>` page
 * already uses — no membership check is needed beyond being signed in.
 *
 * Prototype-level: reads event nodes and filters in JS rather than pushing the
 * JSON predicates into Postgres. Fine at seed scale; revisit with a metadata
 * path filter + index if this ever serves a real corpus.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { isEventUpcoming } from '@/lib/eventUtils';

const LIMIT = 60;

export async function GET() {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const rows = await prisma.node.findMany({
      where: { type: 'event' },
      select: {
        id: true,
        name: true,
        subtitle: true,
        imageUrl: true,
        alias: true,
        metadata: true,
        community: { select: { id: true, name: true } },
      },
    });

    const visible = rows
      .map((row) => {
        const meta = (row.metadata as Record<string, unknown>) ?? {};
        const location = meta.locationData as { label?: string } | undefined;
        return {
          id: row.id,
          slug: row.alias ?? row.id.replace(/^event:/, ''),
          title: row.name,
          description: (meta.description as string) ?? row.subtitle ?? null,
          startAt: (meta.start_at as string) ?? '',
          locationLabel: location?.label ?? null,
          coverImageUrl: row.imageUrl ?? null,
          communityName: row.community?.name ?? null,
          visibility: (meta.visibility as string) ?? 'community',
          status: (meta.status as string) ?? 'published',
        };
      })
      .filter(
        (e) =>
          e.visibility === 'public' &&
          e.status === 'published' &&
          e.startAt &&
          isEventUpcoming(e.startAt),
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, LIMIT);

    // Drop the fields that only existed to run the gate above.
    const events = visible.map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      description: e.description,
      startAt: e.startAt,
      locationLabel: e.locationLabel,
      coverImageUrl: e.coverImageUrl,
      communityName: e.communityName,
    }));

    return NextResponse.json({ events });
  } catch (error) {
    return handleApiError(error, 'api.events.discover.failed');
  }
}
