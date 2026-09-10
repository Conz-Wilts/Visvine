/**
 * Space overview API — everything the space detail page needs in one
 * round-trip. Any logged-in user may read the basics ("pitch mode"); the member
 * list, upcoming events, and resources previews are member-only ("hub mode").
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isSuperAdmin } from '@/lib/session';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { getEventsData } from '@/lib/eventRepo';
import { normalizeStatus, isEventPast } from '@/lib/eventUtils';
import { personAliases, type SpaceAlias } from '@/lib/types/context';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const { spaceId } = await params;
    const [space, membership] = await Promise.all([
      prisma.space.findUnique({
        where: { id: spaceId },
        select: {
          id: true, name: true, description: true, location: true, country: true,
          tags: true, imageUrl: true, nodeTypes: true, createdAt: true,
          aliases: true,
        },
      }),
      prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId: session.userId, spaceId } },
        select: { id: true },
      }),
    ]);
    if (!space) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Who "organizes" this space = who holds a Person alias that owns it. The
    // owning ids come off the row just read, so only their holders are fetched
    // rather than every alias row in the space.
    const owning = personAliases((space.aliases ?? []) as unknown as SpaceAlias[])
      .filter((a) => a.admin === true || a.system === true)
      .map((a) => a.id)
      .filter((id): id is string => Boolean(id));
    const organizerRows = owning.length
      ? await prisma.userAlias.findMany({
          where: { spaceId, aliasId: { in: owning } },
          select: { userId: true },
        })
      : [];
    const organizerIds = new Set(organizerRows.map((a) => a.userId));
    const isMember = membership !== null || isSuperAdmin(session.email);

    const [memberTotal, nodeCount, resourceCount, memberships, latestResources] =
      await Promise.all([
        prisma.spaceMember.count({ where: { spaceId } }),
        prisma.node.count({ where: { spaceId } }),
        prisma.resource.count({ where: { spaceId } }),
        prisma.spaceMember.findMany({
          where: { spaceId },
          orderBy: { joinedAt: 'asc' },
          take: 60,
          include: { user: { select: { id: true, name: true, image: true, subtitle: true, nodeId: true } } },
        }),
        isMember
          ? prisma.resource.findMany({
              where: { spaceId },
              orderBy: { createdAt: 'desc' },
              take: 4,
              select: { id: true, name: true, fileType: true, fileSize: true, createdAt: true },
            })
          : Promise.resolve([]),
      ]);

    const toMember = (m: (typeof memberships)[number]) => ({
      userId: m.userId,
      name: m.user.name,
      image: m.user.image,
      subtitle: m.user.subtitle,
      personId: m.user.nodeId,
      isAdmin: organizerIds.has(m.userId),
      joinedAt: m.joinedAt.toISOString(),
    });
    const organizers = memberships.filter((m) => organizerIds.has(m.userId)).map(toMember);
    const members = isMember ? memberships.map(toMember) : [];

    // Events live in the node context; reuse the event repo rather than re-deriving
    // the metadata unpacking here.
    let events: unknown[] = [];
    let upcomingCount = 0;
    let totalEvents = 0;
    if (isMember) {
      const { events: allEvents, attendees } = await getEventsData(spaceId);
      const published = allEvents.filter((e) => e.status !== 'draft');
      totalEvents = published.length;
      const upcoming = published
        .filter((e) => !isEventPast(e.endAt, e.startAt))
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      upcomingCount = upcoming.length;
      events = upcoming.slice(0, 3).map((e) => ({
        id: e.id,
        title: e.title,
        startAt: e.startAt,
        endAt: e.endAt,
        locationLabel: e.location?.label ?? null,
        eventType: (e.metadata?.eventType as string) ?? 'in-person',
        coverImageUrl: e.coverImageUrl ?? null,
        themeColor: e.theme?.color ?? null,
        going: attendees.filter(
          (a) => a.eventId === e.id && ['going', 'checked_in'].includes(normalizeStatus(a.status)) && a.response !== 'maybe',
        ).length,
      }));
    }

    return NextResponse.json({
      space: { ...space, createdAt: space.createdAt.toISOString(), memberCount: memberTotal },
      viewer: { isMember, isAdmin: organizerIds.has(session.userId) },
      counts: {
        members: memberTotal,
        nodes: nodeCount,
        resources: resourceCount,
        upcomingEvents: upcomingCount,
        totalEvents,
      },
      organizers,
      members,
      events,
      resources: latestResources.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      lastPostAt: null,
    });
  } catch (error) {
    return handleApiError(error, 'api.spaces.overview.failed');
  }
}
