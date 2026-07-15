/**
 * Community overview API — everything the community detail page needs in one
 * round-trip. Any logged-in user may read the basics ("pitch mode"); the member
 * list, upcoming events, and resources previews are member-only ("hub mode").
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isSuperAdmin } from '@/lib/session';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { getEventsData } from '@/lib/eventRepo';
import { normalizeStatus, isEventPast } from '@/lib/eventUtils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> },
) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const { communityId } = await params;
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: {
        id: true, name: true, description: true, location: true, country: true,
        tags: true, imageUrl: true, emoji: true, nodeTypes: true, createdAt: true,
      },
    });
    if (!community) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const membership = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId: session.userId, communityId } },
      select: { role: true },
    });
    const role = isSuperAdmin(session.email) ? 'admin' : membership?.role ?? null;
    const isMember = role !== null;

    const [memberTotal, nodeCount, resourceCount, memberships, latestResources] =
      await Promise.all([
        prisma.userCommunity.count({ where: { communityId } }),
        prisma.node.count({ where: { communityId } }),
        prisma.resource.count({ where: { communityId } }),
        prisma.userCommunity.findMany({
          where: { communityId },
          orderBy: { joinedAt: 'asc' },
          take: 60,
          include: { user: { select: { id: true, name: true, image: true, person: { select: { id: true, imageUrl: true, subtitle: true } } } } },
        }),
        isMember
          ? prisma.resource.findMany({
              where: { communityId },
              orderBy: { createdAt: 'desc' },
              take: 4,
              select: { id: true, name: true, fileType: true, fileSize: true, createdAt: true },
            })
          : Promise.resolve([]),
      ]);

    const toMember = (m: (typeof memberships)[number]) => ({
      userId: m.userId,
      name: m.user.name,
      image: m.user.person?.imageUrl ?? m.user.image,
      subtitle: m.user.person?.subtitle ?? null,
      personId: m.user.person?.id ?? null,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    });
    const organizers = memberships.filter((m) => m.role === 'admin').map(toMember);
    const members = isMember ? memberships.map(toMember) : [];

    // Events live in the node graph; reuse the event repo rather than re-deriving
    // the metadata unpacking here.
    let events: unknown[] = [];
    let upcomingCount = 0;
    let totalEvents = 0;
    if (isMember) {
      const { events: allEvents, attendees } = await getEventsData(communityId);
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
      community: { ...community, createdAt: community.createdAt.toISOString(), memberCount: memberTotal },
      viewer: { role },
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
    return handleApiError(error, 'api.communities.overview.failed');
  }
}
