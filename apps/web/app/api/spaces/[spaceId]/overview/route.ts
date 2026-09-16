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
import { subspaceEventsOf } from '@/lib/events/subspaceRollup';
import { mergeByStart } from '@/lib/events/rollup';
import { normalizeStatus, isEventPast } from '@/lib/eventUtils';
import { personAliases, type SpaceAlias } from '@/lib/types/context';
import { listingOf } from '@/lib/spaces/subspaces';
import { isAdmin } from '@/lib/auth';

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
          aliases: true, visibility: true, parentId: true, listing: true,
        },
      }),
      prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId: session.userId, spaceId } },
        select: { id: true },
      }),
    ]);
    if (!space) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // The pitch is as visible as the space's listing (lib/spaces/subspaces.ts
    // #listingOf): a world space to anyone, a house room to its house's
    // members, a secret one to nobody outside it — answered exactly as a space
    // that does not exist, so a link to it says nothing.
    if (membership === null && !isSuperAdmin(session.email)) {
      const listing = listingOf(space);
      const seen =
        listing === 'world' ||
        (listing === 'house' && space.parentId !== null &&
          (await prisma.spaceMember.count({
            where: { userId: session.userId, spaceId: space.parentId, status: 'active' },
          })) > 0) ||
        (await isAdmin(session.userId, spaceId, session.email));
      if (!seen) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
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
      // The space's own events plus what its public sub-spaces show everyone
      // (lib/events/rollup.ts) — the hub is where a parent's members see the
      // rooms' public calendar, badged with the room.
      const [{ events: allEvents, attendees: ownAttendees }, rolled] = await Promise.all([
        getEventsData(spaceId),
        subspaceEventsOf(spaceId),
      ]);
      const attendees = [...ownAttendees, ...rolled.attendees];
      const published = mergeByStart(allEvents.filter((e) => e.status !== 'draft'), rolled.events);
      totalEvents = published.length;
      const upcoming = published.filter((e) => !isEventPast(e.endAt, e.startAt));
      upcomingCount = upcoming.length;
      events = upcoming.slice(0, 3).map((e) => ({
        id: e.id,
        viaSpace: e.viaSpace ?? null,
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

    const { visibility: _visibility, parentId: _parentId, listing: _listing, ...pitch } = space;
    return NextResponse.json({
      space: { ...pitch, createdAt: space.createdAt.toISOString(), memberCount: memberTotal },
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
