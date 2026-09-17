// GET /api/spaces/<id>/subspaces — the sub-spaces of a space
// (docs/sub-spaces.md). An admin of the space sees every one; a member sees
// the public ones and the private ones they are in. Each row says where the
// caller stands in it and how many events it has coming, so the console's
// Sub-spaces section (SubspacesSection) is one round trip. Creating one is
// POST /api/spaces with `parentId`.
import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { adminSpaceIds, isAdmin, spaceMemberForbidden } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { listSubspaces } from '@/lib/spaces/subspaceAccess';
import { listedToHouse } from '@/lib/spaces/subspaces';
import { isEventPast } from '@/lib/eventUtils';

export type SubspaceViewerStatus = 'admin' | 'member' | 'pending' | 'none';

/**
 * Upcoming published events per space, in one query over the event nodes of
 * every listed sub-space: the same "not past" reading the hub's own card uses
 * (lib/eventUtils.ts#isEventPast), counted here rather than fetched N times.
 */
async function upcomingEventCounts(spaceIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (spaceIds.length === 0) return counts;
  const rows = await prisma.node.findMany({
    where: { type: 'event', spaceId: { in: spaceIds } },
    select: { spaceId: true, metadata: true },
  });
  for (const row of rows) {
    if (!row.spaceId) continue;
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    if (meta.status === 'draft') continue;
    const startAt = typeof meta.start_at === 'string' ? meta.start_at : undefined;
    const endAt = typeof meta.end_at === 'string' ? meta.end_at : undefined;
    if (!startAt || isEventPast(endAt, startAt)) continue;
    counts.set(row.spaceId, (counts.get(row.spaceId) ?? 0) + 1);
  }
  return counts;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const { spaceId } = await params;

    if (await spaceMemberForbidden(session.userId, spaceId, session.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [admin, rows] = await Promise.all([isAdmin(session.userId, spaceId, session.email), listSubspaces(spaceId)]);
    // The caller's own rows in every sub-space, always: they decide what a
    // member may see AND what each row says about their standing.
    const memberships = await prisma.spaceMember.findMany({
      where: { userId: session.userId, spaceId: { in: rows.map((r) => r.id) } },
      select: { spaceId: true, status: true },
    });
    const standing = new Map(memberships.map((m) => [m.spaceId, m.status]));
    const mine = new Set(memberships.filter((m) => m.status === 'active').map((m) => m.spaceId));
    // A member sees the rooms listed to the house or the world, and any they are in; secret rooms only to their members.
    const visible = admin ? rows : rows.filter((r) => listedToHouse(r) || mine.has(r.id));
    const [administered, upcoming] = await Promise.all([
      adminSpaceIds(session.userId, [...mine], session.email),
      upcomingEventCounts(visible.map((r) => r.id)),
    ]);
    const viewerStatus = (id: string): SubspaceViewerStatus => {
      if (administered.has(id)) return 'admin';
      const s = standing.get(id);
      if (s === 'active') return 'member';
      if (s === 'pending') return 'pending';
      return 'none';
    };
    return NextResponse.json({
      subspaces: visible.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? '',
        imageUrl: r.imageUrl ?? undefined,
        visibility: r.visibility,
        listing: r.listing,
        houseDoor: r.houseDoor,
        worldDoor: r.worldDoor,
        flowContext: r.flowContext,
        flowEvents: r.flowEvents,
        parentAdmins: r.parentAdmins,
        memberCount: r.memberCount,
        upcomingEvents: upcoming.get(r.id) ?? 0,
        viewerStatus: viewerStatus(r.id),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, 'api.spaces.subspaces.get.failed');
  }
}
