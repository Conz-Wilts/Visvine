// GET /api/communities/<id>/subspaces — the sub-spaces of a space
// (docs/sub-spaces.md). An admin of the space sees every one; a member sees
// the public ones and the private ones they are in. Creating one is
// POST /api/communities with `parentId`.
import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { isAdmin, spaceMemberForbidden } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { listSubspaces } from '@/lib/spaces/subspaceAccess';
import { flowsUp } from '@/lib/spaces/subspaces';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const { spaceId } = await params;

    if (await spaceMemberForbidden(session.userId, spaceId, session.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [admin, rows] = await Promise.all([isAdmin(session.userId, spaceId, session.email), listSubspaces(spaceId)]);
    let visible = rows;
    if (!admin) {
      const mine = new Set(
        (
          await prisma.spaceMember.findMany({
            where: { userId: session.userId, status: 'active', spaceId: { in: rows.map((r) => r.id) } },
            select: { spaceId: true },
          })
        ).map((m) => m.spaceId),
      );
      visible = rows.filter((r) => flowsUp(r) || mine.has(r.id));
    }
    return NextResponse.json({
      subspaces: visible.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? '',
        imageUrl: r.imageUrl ?? undefined,
        visibility: r.visibility,
        memberCount: r.memberCount,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, 'api.spaces.subspaces.get.failed');
  }
}
