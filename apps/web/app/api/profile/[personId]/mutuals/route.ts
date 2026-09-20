/**
 * Mutuals API — the people the viewer and this person both stand beside.
 *
 * GET /api/profile/[personId]/mutuals → { mutuals, total, spaces }
 *
 * A mutual is a member of a space BOTH of you are in — the overlap the
 * platform actually records, not a separate social graph. Personal spaces are
 * not spaces, so they never make a mutual. The viewer and the subject are never
 * their own mutuals, and the list is only as wide as the header draws.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { normalizeImageUrl } from '@/lib/mediaUrl';
import { resolveProfileUserId } from '@/lib/identity/connection';

type RouteContext = { params: Promise<{ personId: string }> };

/** How many mutuals the header can name — the rest are counted. */
const SHOWN = 6;

export interface Mutual {
  userId: string;
  name: string;
  imageUrl: string | null;
  /** The person node to open, when one of the shared spaces records them. */
  nodeId: string | null;
}

async function activeSpaceIds(userId: string): Promise<string[]> {
  const rows = await prisma.spaceMember.findMany({
    where: { userId, status: 'active', space: { personalOwnerId: null } },
    select: { spaceId: true },
  });
  return rows.map((r) => r.spaceId);
}

export async function GET(req: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  // `?all=1` is the full list behind the header's "and N others".
  const all = new URL(req.url).searchParams.get('all') === '1';
  const { personId } = await context.params;
  const userId = await resolveProfileUserId(personId);
  const empty = NextResponse.json({ mutuals: [], total: 0, spaces: 0 });
  if (!userId || userId === session.userId) return empty;

  const [mine, theirs] = await Promise.all([activeSpaceIds(session.userId), activeSpaceIds(userId)]);
  const shared = mine.filter((id) => theirs.includes(id));
  if (shared.length === 0) return empty;

  const rows = await prisma.spaceMember.findMany({
    where: {
      spaceId: { in: shared },
      status: 'active',
      userId: { notIn: [session.userId, userId] },
    },
    select: { userId: true, user: { select: { name: true, image: true, identity: { select: { id: true } } } } },
    orderBy: { joinedAt: 'asc' },
  });

  // One row per person: the same member counts once however many shared
  // spaces they are in.
  const seen = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!seen.has(row.userId)) seen.set(row.userId, row);

  const shown = all ? [...seen.values()] : [...seen.values()].slice(0, SHOWN);
  const identityIds = shown.map((r) => r.user.identity?.id).filter((id): id is string => !!id);
  const nodes = identityIds.length
    ? await prisma.node.findMany({
        where: { identityId: { in: identityIds }, spaceId: { in: shared } },
        select: { id: true, identityId: true },
      })
    : [];
  const nodeFor = new Map(nodes.map((n) => [n.identityId, n.id]));

  const mutuals: Mutual[] = shown.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    imageUrl: normalizeImageUrl(row.user.image) ?? row.user.image,
    nodeId: (row.user.identity?.id && nodeFor.get(row.user.identity.id)) ?? null,
  }));

  return NextResponse.json({ mutuals, total: seen.size, spaces: shared.length });
}
